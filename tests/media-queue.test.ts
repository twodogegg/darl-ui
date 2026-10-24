// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MediaJobStore } from '../examples/agent-chat/server/media-job-store';
import { FileStore } from '../examples/agent-chat/server/file-storage';
import { persistMediaReferencesInStore, resolveMediaReferencesInStore } from '../examples/agent-chat/server/media-references';

const createStore = (path: string) => new MediaJobStore(path, new FileStore(path));

describe('SQLite media generation queue',()=>{
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
