// @vitest-environment node
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LocalStorage } from '../examples/agent-chat/server/storage';
import { ProjectStore } from '../examples/agent-chat/server/project-store';
import { FileStore } from '../examples/agent-chat/server/file-storage';
import { EpisodeStore, assetMentions, parseAgentBreakdown, validateBreakdown } from '../examples/agent-chat/server/episode-store';

let root: string;
let path: string;
let store: EpisodeStore;
let projectId: number;
beforeEach(() => {
  root=mkdtempSync(join(tmpdir(),'darl-episodes-'));
  path=new LocalStorage(root).path;
  const projects=new ProjectStore(path, new FileStore(path));
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
    const script='  <路明非> 坐在卧室前，他说：还没结束。\n\n';
    expect(store.saveScript(episode.id,script,0)?.script).toBe(script);
    expect(store.get(episode.id)?.scriptRevision).toBe(1);
    expect(new EpisodeStore(path).get(episode.id)?.script).toBe(script);
    expect(new ProjectStore(path, new FileStore(path)).get(projectId)?.episode_count).toBe(1);
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
    store.savePlan(other.id,1,parseAgentBreakdown(output()));
    expect(new EpisodeStore(path).assets(projectId)).toHaveLength(3);
    expect(new EpisodeStore(path).plan(other.id)?.assets).toHaveLength(3);
    expect(new EpisodeStore(path).plan(ep.id)?.shots[0].id).toBe(saved.shots[0].id);
  });
  it('preserves descriptions across saves and supports main character states',()=>{
    const ep=store.create(projectId,'第 01 集')!;
    store.saveScript(ep.id,'原稿',0);
    const parsed=parseAgentBreakdown(output());
    parsed.assets[0].description='剧本明确的身份与外观描述';
    store.savePlan(ep.id,1,parsed);
    const asset=store.assets(projectId)!.find(a=>a.name==='路明非')!;
    expect(asset.description).toBe('剧本明确的身份与外观描述');
    expect(store.saveAssetDescription(projectId,asset.id,'用户编辑的视觉描述')?.description).toBe('用户编辑的视觉描述');
    const state=store.saveAssetState(projectId,asset.id,{name:'主形象',description:'剧情中最常见的服装'});
    expect(state?.isMain).toBe(true);
    expect(store.assetStates(projectId,asset.id)).toHaveLength(1);
    expect(new EpisodeStore(path).assets(projectId)?.find(a=>a.id===asset.id)?.description).toBe('用户编辑的视觉描述');
    expect(new EpisodeStore(path).assetStates(projectId,asset.id)).toHaveLength(1);
  });
  it('keeps edited descriptions when re-saving a plan without descriptions',()=>{
    const ep=store.create(projectId,'第 01 集')!;
    store.saveScript(ep.id,'原稿',0);
    store.savePlan(ep.id,1,parseAgentBreakdown(output()));
    const asset=store.assets(projectId)!.find(a=>a.name==='路明非')!;
    store.saveAssetDescription(projectId,asset.id,'用户编辑的视觉描述');
    const revised=store.plan(ep.id)!;
    store.savePlan(ep.id,1,{shots:revised.shots,assets:revised.assets.map(({description:_,...rest})=>rest)});
    expect(store.assets(projectId)?.find(a=>a.id===asset.id)?.description).toBe('用户编辑的视觉描述');
  });
  it('blocks extra prop states but allows character and scene states',()=>{
    const ep=store.create(projectId,'第 01 集')!;
    store.saveScript(ep.id,'原稿',0);
    store.savePlan(ep.id,1,parseAgentBreakdown(output()));
    const library=store.assets(projectId)!;
    const prop=library.find(a=>a.type==='prop')!;
    const character=library.find(a=>a.type==='character')!;
    store.saveAssetState(projectId,prop.id,{name:'主形象',description:'剧本描述'});
    expect(()=>store.saveAssetState(projectId,prop.id,{name:'破损',description:'无剧本依据'})).toThrow('道具默认仅有一个主要形象');
    store.saveAssetState(projectId,character.id,{name:'主形象',description:'剧情最常见造型'});
    expect(store.saveAssetState(projectId,character.id,{name:'休闲装',description:'第二集家中便服'})?.isMain).toBe(false);
    expect(store.assetStates(projectId,character.id)?.map(s=>s.is_main)).toEqual([1,0]);
  });
  it('does not delete retained shot records when saving edited plans',()=>{
    const ep=store.create(projectId,'第 01 集')!;
    store.saveScript(ep.id,'原稿',0);
    const initial=store.savePlan(ep.id,1,parseAgentBreakdown(output()))!;
    const revised={shots:[...initial.shots].reverse(),assets:initial.assets.map(a=>({...a,shotNumbers:[1,2]}))};
    store.savePlan(ep.id,1,revised);
    expect(store.plan(ep.id)?.shots.map(s=>s.id)).toEqual(revised.shots.map(s=>s.id));
  });
  it('keeps the same asset id and shot links when an asset is renamed',()=>{
    const ep=store.create(projectId,'第 01 集')!;
    store.saveScript(ep.id,'原稿',0);
    const initial=store.savePlan(ep.id,1,parseAgentBreakdown(output()))!;
    const character=initial.assets.find(a=>a.name==='路明非')!;
    const renamed=initial.assets.map(a=>a===character?{...a,name:'路鸣泽'}:a);
    store.savePlan(ep.id,1,{shots:initial.shots.map(s=>({...s,
      visual:s.visual.split('<路明非>').join('<路鸣泽>')})),assets:renamed});
    const plan=store.plan(ep.id)!;
    expect(plan.assets.find(a=>a.name==='路鸣泽')?.id).toBe(character.id);
    expect(plan.assets.find(a=>a.id===character.id)?.shotNumbers).toEqual([1,2]);
    expect(store.assets(projectId)?.filter(a=>a.type==='character')).toHaveLength(1);
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
