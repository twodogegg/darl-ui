// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MediaJobStore } from '../examples/agent-chat/server/media-job-store';
import { validateMediaJobOptions } from '../examples/agent-chat/server/media-jobs-api';

describe('SQLite media generation queue',()=>{
  it('persists queue and per-model limits, and recovers remote video without resubmission',()=>{
    const dir=mkdtempSync(join(tmpdir(),'media-queue-'));
    try{
      const path=join(dir,'data.sqlite');
      const db=new MediaJobStore(path);
      expect(db.limit('gpt-image-2')).toBe(4);
      db.setLimit('gpt-image-2',100);
      expect(new MediaJobStore(path).limit('gpt-image-2')).toBe(100);
      const first=db.create({modelId:'gpt-image-2',type:'image',prompt:'A',providerId:'darl',upstreamModelId:'gpt-image-2',baseUrl:'https://example.invalid/v1',options:{}});
      first.status='running';
      db.put(first);
      const second=db.create({modelId:'minimax-h3-flash',type:'video',prompt:'B',providerId:'darl',upstreamModelId:'minimax-h3-flash',baseUrl:'https://example.invalid/v1',options:{}});
      second.status='running';second.remoteTaskId='video_123';db.put(second);
      const restarted=new MediaJobStore(path);
      restarted.recover();
      expect(restarted.get(first.id)?.status).toBe('uncertain');
      expect(restarted.get(second.id)?.status).toBe('running');
      expect(restarted.get(second.id)?.remoteTaskId).toBe('video_123');
    }finally{rmSync(dir,{recursive:true,force:true});}
  });
  it('validates limits before persisting',()=>{
    const dir=mkdtempSync(join(tmpdir(),'media-queue-'));
    try{
      const db=new MediaJobStore(join(dir,'db.sqlite'));
      expect(()=>db.setLimit('gpt-image-2',100001)).toThrow();
      expect(()=>db.setLimit('other',10)).toThrow();
    }finally{rmSync(dir,{recursive:true,force:true});}
  });
  it('accepts only supported direct generation fields before tasks are enqueued', () => {
    expect(validateMediaJobOptions('gpt-image-2',{size:'1024x1536'})).toEqual({size:'1024x1536'});
    expect(validateMediaJobOptions('minimax-h3-flash',{resolution:'768',aspectRatio:'9:16',duration:10}))
      .toEqual({resolution:'768',aspectRatio:'9:16',duration:10});
    expect(()=>validateMediaJobOptions('gpt-image-2',{references:['x']})).toThrow('尚未接通');
    expect(()=>validateMediaJobOptions('minimax-h3-flash',{duration:20})).toThrow('4–15');
    expect(()=>validateMediaJobOptions('minimax-h3-flash',{aspectRatio:'1:1'})).toThrow('画面比例');
  });
});
