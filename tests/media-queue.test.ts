// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { MediaJobStore } from '../examples/agent-chat/server/media-job-store';
import { FileStore } from '../examples/agent-chat/server/file-storage';
import { persistMediaReferencesInStore, resolveMediaReferencesInStore } from '../examples/agent-chat/server/media-references';
import { createMediaJobsApi } from '../examples/agent-chat/server/media-jobs-api';
import { defaultModelConfiguration } from '../src/components/settings/model-config';

const createStore = (path: string) => new MediaJobStore(path, new FileStore(path));

describe('SQLite media generation queue',()=>{
  it('retains completed files and reports attachment failures without recursively invoking completion notifications', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'media-writeback-'));
    let api: ReturnType<typeof createMediaJobsApi> | undefined;
    try {
      const path = join(dir, 'db.sqlite'), files = new FileStore(path), store = new MediaJobStore(path, files);
      const file = await files.put(Buffer.from('saved-result'), 'video/mp4', 'result.mp4');
      const job = store.create({ modelId: 'minimax-h3-flash', type: 'video', prompt: 'A', providerId: 'darl', upstreamModelId: 'minimax-h3-flash', baseUrl: 'https://example.invalid', options: {} });
      job.status = 'completed'; job.resultFileIds = [file.id]; store.put(job);
      let calls = 0;
      api = createMediaJobsApi(path, defaultModelConfiguration, () => [], files, { completed: () => { calls++; throw new Error('历史片段校验失败'); } });
      expect(calls).toBe(1);
      expect(api.store.get(job.id)).toMatchObject({ status: 'completed', resultFileIds: [file.id], error: '生成已完成，写回失败：历史片段校验失败' });
      expect((await api.runner.media(api.store.get(job.id)!))?.bytes.toString()).toBe('saved-result');
      api.store.put(api.store.get(job.id)!);
      expect(calls).toBe(1);
      api.runner.stop();
      api = createMediaJobsApi(path, defaultModelConfiguration, () => [], files, { completed: () => { calls++; } });
      expect(calls).toBe(2);
      expect(api.store.get(job.id)).toMatchObject({ status: 'completed', resultFileIds: [file.id] });
      expect(api.store.get(job.id)?.error).toBeUndefined();
    } finally { api?.runner.stop(); rmSync(dir, { recursive: true, force: true }); }
  });
  it('cleans historical signatures on startup without changing job state or result files', () => {
    const dir = mkdtempSync(join(tmpdir(), 'media-signatures-'));
    try {
      const path = join(dir, 'db.sqlite'), store = createStore(path);
      const job = store.create({ modelId: 'gemini-3-pro-image-preview', type: 'image', prompt: 'A', providerId: 'darl', upstreamModelId: 'gemini-3-pro-image-preview', baseUrl: 'https://example.invalid', options: {} });
      job.status = 'completed'; job.resultFileIds = ['saved-image'];
      const original = { ...job, providerResponse: { candidates: [{ content: { parts: [
        { text: '生成完成', thoughtSignature: 'unused-signature' },
        { thought_signature: 'unused-legacy-signature' },
      ] } }] } };
      const database = new DatabaseSync(path);
      try {
        database.prepare('UPDATE media_generation_jobs SET data=? WHERE id=?').run(JSON.stringify(original), job.id);
        const expected = { ...job, providerResponse: { candidates: [{ content: { parts: [{ text: '生成完成' }, {}] } }] } };
        expect(createStore(path).get(job.id)).toEqual(expected);
        expect(JSON.parse(database.prepare('SELECT data FROM media_generation_jobs WHERE id=?').get(job.id)!.data as string)).toEqual(expected);
        expect(createStore(path).get(job.id)).toEqual(expected);
      } finally { database.close(); }
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('persists audio and video references by file ID, checks their MIME types, and protects them from deletion', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'media-references-'));
    try {
      const path = join(dir, 'db.sqlite'), files = new FileStore(path), store = new MediaJobStore(path, files);
      const audio = await files.put(Buffer.from('audio-reference'), 'audio/wav', 'voice.wav');
      const video = await files.put(Buffer.from('video-reference'), 'video/mp4', 'motion.mp4');
      const options = await persistMediaReferencesInStore(await resolveMediaReferencesInStore({ referenceAudios: [`/api/files/${audio.id}`], referenceVideos: [`/api/files/${video.id}`] }, files), files);
      expect(options).toMatchObject({ referenceAudios: [{ fileId: audio.id, mimeType: 'audio/wav' }], referenceVideos: [{ fileId: video.id, mimeType: 'video/mp4' }] });
      const job = store.create({ modelId: 'minimax-h3-flash', type: 'video', prompt: 'reference', providerId: 'darl', upstreamModelId: 'minimax-h3-flash', baseUrl: 'https://example.invalid/v1', options });
      expect(files.references(audio.id)).toBe(true);
      expect(files.references(video.id)).toBe(true);
      await expect(files.removeUnreferenced(audio.id)).resolves.toBe(false);
      await expect(resolveMediaReferencesInStore({ references: [`/api/files/${audio.id}`] }, files)).rejects.toThrow('必须是图片');
      await expect(persistMediaReferencesInStore({ referenceAudios: [{ fileId: video.id }] }, files)).rejects.toThrow('必须是音频');
      store.removeMany([job]);
      expect(files.references(audio.id)).toBe(false);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
  it('persists queue and per-model limits, and recovers remote video without resubmission',()=>{
    const dir=mkdtempSync(join(tmpdir(),'media-queue-'));
    try{
      const path=join(dir,'data.sqlite');
      const db=createStore(path);
      expect(db.limit('gpt-image-2')).toBe(4);
      db.setLimit('gpt-image-2',100);
      expect(createStore(path).limit('gpt-image-2')).toBe(100);
      const first=db.create({taskId:'task-1',modelId:'gpt-image-2',type:'image',prompt:'A',providerId:'darl',upstreamModelId:'gpt-image-2',baseUrl:'https://example.invalid/v1',options:{}});
      first.status='running';
      db.put(first);
      const second=db.create({modelId:'minimax-h3-flash',type:'video',prompt:'B',providerId:'darl',upstreamModelId:'minimax-h3-flash',baseUrl:'https://example.invalid/v1',options:{}});
      second.status='running';second.remoteTaskId='video_123';db.put(second);
      const restarted=createStore(path);
      restarted.recover();
      expect(restarted.get(first.id)?.status).toBe('uncertain');
      expect(restarted.get(first.id)?.taskId).toBe('task-1');
      expect(restarted.get(second.id)?.status).toBe('running');
      expect(restarted.get(second.id)?.remoteTaskId).toBe('video_123');
    }finally{rmSync(dir,{recursive:true,force:true});}
  });
  it('validates limits before persisting',()=>{
    const dir=mkdtempSync(join(tmpdir(),'media-queue-'));
    try{
      const db=createStore(join(dir,'db.sqlite'));
      expect(()=>db.setLimit('gpt-image-2',100001)).toThrow();
      expect(()=>db.setLimit('other',10)).toThrow();
    }finally{rmSync(dir,{recursive:true,force:true});}
  });
  it('reuses content-addressed files on a repeated completion poll',async()=>{
    const dir=mkdtempSync(join(tmpdir(),'media-queue-'));
    try{
      const db=createStore(join(dir,'db.sqlite'));
      const first=await db.saveFile(Buffer.from('first'),'video/mp4','first.mp4');
      const second=await db.saveFile(Buffer.from('first'),'video/mp4','again.mp4');
      expect(second.id).toBe(first.id);
    }finally{rmSync(dir,{recursive:true,force:true});}
  });
  it('keeps a shared result file until every referencing job is removed',async()=>{
    const dir=mkdtempSync(join(tmpdir(),'media-queue-'));
    try{
      const path=join(dir,'db.sqlite');
      const files=new FileStore(path);
      const db=new MediaJobStore(path,files);
      const result=await files.put(Buffer.from('shared-result'),'image/png','result.png');
      const first=db.create({modelId:'gpt-image-2',type:'image',prompt:'A',providerId:'darl',upstreamModelId:'gpt-image-2',baseUrl:'https://example.invalid/v1',options:{}});
      const second=db.create({modelId:'gpt-image-2',type:'image',prompt:'B',providerId:'darl',upstreamModelId:'gpt-image-2',baseUrl:'https://example.invalid/v1',options:{}});
      first.status='completed';first.resultFileIds=[result.id];db.put(first);
      second.status='completed';second.resultFileIds=[result.id];db.put(second);
      await expect(db.removeFiles([first])).rejects.toThrow('仍被其他任务引用');
      db.removeMany([first]);
      db.removeMany([second]);
      await db.removeFiles([second]);
      expect(files.get(result.id)).toBeUndefined();
    }finally{rmSync(dir,{recursive:true,force:true});}
  });
  it('does not delete a file that a media job uses as a reference',async()=>{
    const dir=mkdtempSync(join(tmpdir(),'media-queue-'));
    try{
      const path=join(dir,'db.sqlite');
      const files=new FileStore(path);
      const db=new MediaJobStore(path,files);
      const reference=await files.put(Buffer.from('reference'),'image/png','reference.png');
      const result=await files.put(Buffer.from('result'),'image/png','result.png');
      const job=db.create({modelId:'gpt-image-2',type:'image',prompt:'A',providerId:'darl',upstreamModelId:'gpt-image-2',baseUrl:'https://example.invalid/v1',options:{references:[{fileId:reference.id}]}});
      job.status='completed';job.resultFileIds=[result.id];db.put(job);
      expect(files.references(reference.id)).toBe(true);
      db.removeMany([job]);
      expect(files.references(reference.id)).toBe(false);
      expect(files.get(reference.id)).toBeDefined();
    }finally{rmSync(dir,{recursive:true,force:true});}
  });
});
