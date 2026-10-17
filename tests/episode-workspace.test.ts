// @vitest-environment node
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LocalStorage } from '../examples/agent-chat/server/storage';
import { ProjectStore } from '../examples/agent-chat/server/project-store';
import { EpisodeStore, assetMentions, parseAgentBreakdown, validateBreakdown } from '../examples/agent-chat/server/episode-store';

let root: string;
let path: string;
let store: EpisodeStore;
let projectId: number;
beforeEach(() => {
  root=mkdtempSync(join(tmpdir(),'darl-episodes-'));
  path=new LocalStorage(root).path;
  const projects=new ProjectStore(path);
  projectId=projects.create({name:'剧本原稿',description:null,aspect_ratio:'9:16',style_catalog_id:4}).project_id;
  store=new EpisodeStore(path);
});
afterEach(()=>rmSync(root,{recursive:true,force:true}));

const output=()=>JSON.stringify({
  shots:[
    {framing:'中近景',camera:'固定',cut:'—',scene:'<卧室>／内／夜',visual:'<路明非>在<卧室>使用<电脑>',dialogue:'路明非：还没结束',sound:'风扇声',duration:4},
    {framing:'特写',camera:'推近',cut:'硬切·反应切',scene:'<卧室>／内／夜',visual:'<路明非>盯着<电脑>',dialogue:'—',sound:'—',duration:6}
  ],
  assets:[
    {name:'路明非',type:'character',shotNumbers:[1,2]},
    {name:'卧室',type:'scene',shotNumbers:[1,2]},
    {name:'电脑',type:'prop',shotNumbers:[1,2]}
  ]
});

describe('episode screenplay + shot and asset planning',()=>{
  it('saves the original script without Agent confirmation and survives store reopening',()=>{
    const episode=store.create(projectId,'第 01 集')!;
    const script='<路明非> 坐在卧室前，他说：还没结束。';
    expect(store.saveScript(episode.id,script,0)?.script).toBe(script);
    expect(store.get(episode.id)?.scriptRevision).toBe(1);
    expect(new EpisodeStore(path).get(episode.id)?.script).toBe(script);
    expect(new ProjectStore(path).get(projectId)?.episode_count).toBe(1);
    expect(()=>store.saveScript(episode.id,'被旧页面覆盖',0)).toThrow('更新');
    expect(store.get(episode.id)?.script).toBe(script);
  });
  it('parses model JSON and preserves asset mentions without inventing image numbers',()=>{
    const parsed=parseAgentBreakdown('```json\n'+output()+'\n```');
    expect(parsed.shots).toHaveLength(2);
    expect(parsed.shots.map(s=>s.duration).reduce((a,b)=>a+b,0)).toBe(10);
    expect(parsed.shots[0].visual).toContain('<路明非>');
    expect(assetMentions(parsed.shots[0].visual)).toEqual(['路明非','卧室','电脑']);
    expect(JSON.stringify(parsed)).not.toContain('@图片');
    expect(parsed.assets).toHaveLength(3);
  });
  it('atomically saves and restores nine-column shots linked to deduplicated project assets',()=>{
    const ep=store.create(projectId,'第 01 集')!;
    store.saveScript(ep.id,'原稿',0);
    const parsed=parseAgentBreakdown(output());
    const saved=store.savePlan(ep.id,1,parsed)!;
    expect(saved.shots).toHaveLength(2);
    expect(saved.totalSeconds).toBe(10);
    expect(saved.assets.find(a=>a.name==='路明非')?.shotNumbers).toEqual([1,2]);
    expect(store.assets(projectId)).toHaveLength(3);
    const other=store.create(projectId,'第 02 集')!;
    store.saveScript(other.id,'第二集',0);
    store.savePlan(other.id,1,parsed);
    expect(new EpisodeStore(path).assets(projectId)).toHaveLength(3);
    expect(new EpisodeStore(path).plan(other.id)?.assets).toHaveLength(3);
    expect(new EpisodeStore(path).plan(ep.id)?.shots[0].id).toBe(saved.shots[0].id);
  });
  it('does not lose previously saved shots when new results are invalid or script revision is stale',()=>{
    const ep=store.create(projectId,'第 01 集')!;
    store.saveScript(ep.id,'原稿',0);
    store.savePlan(ep.id,1,parseAgentBreakdown(output()));
    store.saveScript(ep.id,'用户更新原稿',1);
    expect(()=>store.savePlan(ep.id,1,parseAgentBreakdown(output()))).toThrow('剧本在分析');
    expect(()=>parseAgentBreakdown('不是 JSON')).toThrow('Agent 没有返回有效 JSON');
    expect(()=>validateBreakdown({shots:[{visual:'<不存在>',scene:'卧室',duration:4}],assets:[]})).toThrow();
    expect(store.plan(ep.id)?.shots).toHaveLength(2);
    expect(store.plan(ep.id)?.episode.script).toBe('用户更新原稿');
  });
  it('keeps shot IDs on edits, refuses cross-episode IDs and validates linked numbers',()=>{
    const ep=store.create(projectId,'第 01 集')!;
    const other=store.create(projectId,'第 02 集')!;
    store.saveScript(ep.id,'原稿',0);
    store.saveScript(other.id,'原稿',0);
    const one=store.savePlan(ep.id,1,parseAgentBreakdown(output()))!;
    const next={shots:[...one.shots].reverse(),assets:one.assets.map(a=>({...a,shotNumbers:[1,2]}))};
    const revised=store.savePlan(ep.id,1,next)!;
    expect(revised.shots[0].id).toBe(one.shots[1].id);
    expect(revised.shots[0].cut).toBe('—');
    expect(()=>store.savePlan(other.id,1,next)).toThrow('其他剧集');
    expect(()=>validateBreakdown({...next,assets:[{name:'电脑',type:'prop',shotNumbers:[99]}]})).toThrow('镜头序号');
  });
});
