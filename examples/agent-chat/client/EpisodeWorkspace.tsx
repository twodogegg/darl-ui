import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import type { AgentConfig } from '@darl/ui';
import type { AssetDraft, BreakdownDraft, ShotDraft } from '../server/episode-store';
import './episodes.css';

type Episode = { id:number; projectId:number; title:string; script:string; scriptRevision:number; planRevision:number|null; updatedAt:string };
type PlanResponse = { episode:Episode;shots:ShotDraft[];assets:AssetDraft[];totalSeconds:number };
type LibraryAsset = { id:string;name:string;type:AssetDraft['type'];description?:string };
type AssetState = { id:string;asset_id:string;name:string;description:string;is_main:number };
type Preview = { plan:BreakdownDraft;scriptRevision:number;totalSeconds:number };

async function get<T>(url:string, method='GET', body?:unknown):Promise<T>{
  const response=await fetch('/api/workspace/'+url,{method,headers:body?{'Content-Type':'application/json'}:undefined,
    body:body===undefined?undefined:JSON.stringify(body)});
  const data=await response.json().catch(()=>({}));
  if(!response.ok)throw new Error(data.error||('请求失败：HTTP '+response.status));
  return data.data as T;
}
const types:Record<AssetDraft['type'],string>={character:'人物',scene:'场景',prop:'道具'};
const blankShot=():ShotDraft=>({id:crypto.randomUUID(),framing:'中景',camera:'固定',cut:'硬切',
  scene:'待定',visual:'',dialogue:'—',sound:'—',duration:5});
const fields:Array<{key:keyof Omit<ShotDraft,'id'|'duration'>;label:string}>= [
  {key:'framing',label:'景别'},{key:'camera',label:'运镜'},{key:'cut',label:'切镜方式'},
  {key:'scene',label:'场景'},{key:'visual',label:'画面'},{key:'dialogue',label:'台词/对白'},{key:'sound',label:'音效'},
];
const marker=/<([^<>\\n]{1,80})>/gu;
const toVisible = (source:string)=>source.replace(marker,(_,name:string)=>'@'+name.trim());
const toStored = (source:string,assets:AssetDraft[])=>{
  const names=[...new Set(assets.map(a=>a.name).filter(Boolean))].sort((a,b)=>b.length-a.length);
  let result='';
  for(let i=0;i<source.length;){
    const hit=source[i]==='@'?names.find(name=>source.startsWith(name,i+1)):undefined;
    if(hit){result+='<'+hit+'>';i+=hit.length+1;}
    else{result+=source[i];i++;}
  }
  return result;
};
export function EpisodeWorkspace({projectId,agents,onEditAgent}:{projectId:number;agents:AgentConfig[];onEditAgent:(agentId:string)=>void}){
  const [episodes,setEpisodes]=useState<Episode[]>([]);
  const [selectedId,setSelectedId]=useState<number|null>(null);
  const selectedIdRef=useRef<number|null>(null);
  selectedIdRef.current=selectedId;
  const [episode,setEpisode]=useState<Episode|null>(null);
  const [script,setScript]=useState('');
  const [newTitle,setNewTitle]=useState('');
  const [agentId,setAgentId]=useState('');
  const [draft,setDraft]=useState<BreakdownDraft|null>(null);
  const [draftRevision,setDraftRevision]=useState<number|null>(null);
  const [library,setLibrary]=useState<LibraryAsset[]>([]);
  const [workTab,setWorkTab]=useState<'shots'|'assets'>('shots');
  const [selectedShot,setSelectedShot]=useState(0);
  const [assetDetail,setAssetDetail]=useState<string|null>(null);
  const [assetStates,setAssetStates]=useState<AssetState[]>([]);
  const [stateName,setStateName]=useState('');
  const [stateDescription,setStateDescription]=useState('');
  const [busy,setBusy]=useState('');
  const [error,setError]=useState('');
  const [notice,setNotice]=useState('');
  const availableAgents=agents.filter(a=>a.enabled!==false);
  useEffect(()=>{
    setAgentId(current => availableAgents.some(agent=>agent.id===current)
      ? current : (availableAgents.find(agent=>agent.isDefault) || availableAgents[0])?.id || '');
  },[agents]);

  useEffect(()=>{
    let active=true;
    void get<Episode[]>(`projects/${projectId}/episodes`).then(items=>{
      if(!active)return;setEpisodes(items);setSelectedId(items[0]?.id??null);
    }).catch(e=>{if(active)setError(e.message);});
    return ()=>{active=false;};
  },[projectId]);

  useEffect(()=>{
    if(selectedId==null){setEpisode(null);setDraft(null);return;}
    let active=true;
    void Promise.all([get<PlanResponse>(`episodes/${selectedId}`),get<LibraryAsset[]>(`projects/${projectId}/assets`)])
      .then(([plan,assets])=>{if(!active)return;
        setEpisode(plan.episode);setScript(plan.episode.script);
        setDraft(plan.shots.length?{shots:plan.shots,assets:plan.assets}:null);
        setDraftRevision(plan.episode.planRevision);setLibrary(assets);setError('');setNotice('');
      }).catch(e=>{if(active)setError(e.message);});
    return ()=>{active=false;};
  },[projectId,selectedId]);

  const create=async()=>{
    if(!newTitle.trim())return;
    setBusy('create');setError('');setNotice('');
    try{
      const created=await get<Episode>(`projects/${projectId}/episodes`,'POST',{title:newTitle.trim()});
      setEpisodes(p=>[...p,created]);setSelectedId(created.id);setNewTitle('');
    }catch(e){setError((e as Error).message);}finally{setBusy('');}
  };
  const importFile=async(e:ChangeEvent<HTMLInputElement>)=>{
    const file=e.target.files?.[0];if(!file)return;
    if(!/\.(txt|md)$/i.test(file.name)){setError('只支持 .txt 或 .md 剧本');e.target.value='';return;}
    if(file.size>800_000){setError('剧本文件过大，请控制在 80 万字节以内');e.target.value='';return;}
    try{setScript(await file.text());setNotice('文件已读取，请点击「保存剧本」使其生效');setError('');}
    catch{setError('读取文件失败');}
    e.target.value='';
  };
  const saveScript=async()=>{
    if(!episode)return;setBusy('script');setError('');setNotice('');
    try{
      const saved=await get<Episode>(`episodes/${episode.id}/script`,'PUT',{script,scriptRevision:episode.scriptRevision});
      setEpisode(saved);setEpisodes(list=>list.map(e=>e.id===saved.id?saved:e));
      setNotice('剧本已保存，原文不会被 AI 覆盖');
    }catch(e){setError((e as Error).message);}finally{setBusy('');}
  };
  const analyze=async()=>{
    if(!episode || !agentId || script!==episode.script)return;
    setBusy('analyze');setError('');setNotice('');
    try{
      const result=await get<Preview>(`episodes/${episode.id}/analyze`,'POST',{agentId,scriptRevision:episode.scriptRevision});
      if (selectedIdRef.current!==episode.id) return;
      setDraft(result.plan);setDraftRevision(result.scriptRevision);
      setNotice('Agent 已返回分镜和美术资产草案。检查后点击「保存分镜与资产」。');
    }catch(e){setError((e as Error).message);}finally{setBusy('');}
  };
  const savePlan=async()=>{
    if(!episode||!draft||draftRevision===null)return;
    setBusy('plan');setError('');setNotice('');
    try{
      const saved=await get<PlanResponse>(`episodes/${episode.id}/plan`,'PUT',
        {scriptRevision:draftRevision,plan:draft});
      setDraft({shots:saved.shots,assets:saved.assets});setDraftRevision(saved.episode.planRevision);
      setEpisode(saved.episode);setLibrary(await get<LibraryAsset[]>(`projects/${projectId}/assets`));
      setNotice('分镜与资产已保存到本地 SQLite');
    }catch(e){setError((e as Error).message);}finally{setBusy('');}
  };
  const updateShot=(i:number,key:keyof ShotDraft,value:string|number)=>{
    setDraft(prev=>prev&&({...prev,shots:prev.shots.map((s,j)=>j===i?{...s,[key]:value}:s)}));
  };
  const reorder=(i:number,shift:number)=>{
    setDraft(prev=>{
      if(!prev)return prev;
      const to=i+shift;
      if(to<0||to>=prev.shots.length)return prev;
      const shots=[...prev.shots];[shots[i],shots[to]]=[shots[to],shots[i]];
      const assets=prev.assets.map(a=>({...a,shotNumbers:a.shotNumbers.map(n=>n===i+1?to+1:n===to+1?i+1:n)}));
      return {shots,assets};
    });
  };
  const removeShot=(i:number)=>{
    setDraft(prev=>{
      if(!prev||prev.shots.length<=1)return prev;
      return {shots:prev.shots.filter((_,j)=>j!==i),
        assets:prev.assets.map(a=>({...a,shotNumbers:a.shotNumbers.filter(n=>n!==i+1).map(n=>n>i+1?n-1:n)})).filter(a=>a.shotNumbers.length)};
    });
  };
  const addShot=()=>{
    setDraft(prev=>prev&&({...prev,shots:[...prev.shots,blankShot()]}));
  };
  const updateAsset=(i:number,field:keyof AssetDraft,value:string)=>{
    setDraft(prev=>prev&&({...prev,assets:prev.assets.map((a,j)=>j!==i?a:field==='shotNumbers'
      ?{...a,shotNumbers:value.split(/[,，\s]+/).map(Number).filter(n=>Number.isInteger(n)&&n>0&&n<=prev.shots.length)}
      :{...a,[field]:value})}));
  };
  const openedAsset=library.find(a=>a.id===assetDetail);
  const openAsset=async(id:string)=>{setAssetDetail(id);setAssetStates([]);try{setAssetStates(await get<AssetState[]>(`projects/${projectId}/assets/${id}/states`));}catch(e){setError((e as Error).message);}};
  const saveAssetDescription=async(asset:LibraryAsset,description:string)=>{try{await get(`projects/${projectId}/assets/${asset.id}`,'PATCH',{description});setLibrary(items=>items.map(a=>a.id===asset.id?{...a,description}:a));
    setDraft(prev=>prev&&({...prev,assets:prev.assets.map(a=>a.name===asset.name&&a.type===asset.type?{...a,description}:a)}));
    setNotice('资产描述已保存');}catch(e){setError((e as Error).message);}};
  const addAssetState=async()=>{if(!openedAsset||!stateName.trim())return;try{await get(`projects/${projectId}/assets/${openedAsset.id}/states`,'POST',{name:stateName,description:stateDescription});setAssetStates(await get<AssetState[]>(`projects/${projectId}/assets/${openedAsset.id}/states`));setStateName('');setStateDescription('');}catch(e){setError((e as Error).message);}};
  const total=draft?.shots.reduce((sum,s)=>sum+(Number.isFinite(s.duration)?s.duration:0),0)??0;
  return <section className="workspace-episodes" aria-label="剧集与智能拆镜">
    <header><h2>剧集 · 剧本与智能拆镜</h2><p>原稿不由 AI 改写。分镜与美术资产分开整理，完成后再统一交给生图 Agent。</p></header>
    <div className="workspace-episode-create">
      <input aria-label="新剧集名称" placeholder="例如：第 01 集" maxLength={100} value={newTitle} onChange={e=>setNewTitle(e.target.value)}/>
      <button type="button" onClick={()=>void create()} disabled={!!busy||!newTitle.trim()}>添加剧集</button>
    </div>
    {episodes.length>0&&<nav className="workspace-episode-tabs" aria-label="选择剧集">
      {episodes.map(e=><button type="button" key={e.id} className={e.id===selectedId?'active':''} onClick={()=>setSelectedId(e.id)} disabled={!!busy}>{e.title}</button>)}
    </nav>}
    {error&&<p className="workspace-error" role="alert">{error}</p>}
    {notice&&<p className="workspace-notice" role="status">{notice}</p>}
    {episode&&<>
      <div className="workspace-episode-panel">
        <div className="workspace-episode-title"><h3>本集剧本</h3><small>修订 #{episode.scriptRevision} · 保存即生效</small></div>
        <textarea className="workspace-script-editor" aria-label="本集剧本内容" rows={12}
          value={script} onChange={e=>setScript(e.target.value)} placeholder="粘贴已有的标准剧本，或导入 .txt / .md 文件"/>
        <div className="workspace-episode-actions">
          <input type="file" accept=".txt,.md,text/plain,text/markdown" onChange={e=>void importFile(e)}/>
          <button type="button" disabled={!!busy||script===episode.script} onClick={()=>void saveScript()}>{busy==='script'?'正在保存…':'保存剧本'}</button>
        </div>
        <div className="workspace-episode-analysis">
          <label>执行智能拆镜的专业 Agent
            <select value={agentId} onChange={e=>setAgentId(e.target.value)}>
              <option value="">选择 Agent</option>
              {availableAgents.map(agent=><option key={agent.id} value={agent.id}>{agent.name}{agent.isDefault ? "（默认）" : ""}</option>)}
            </select>
          </label>
          <button type="button" onClick={()=>onEditAgent(agentId)} disabled={!!busy||!agentId} title="在现有 Agents 设置中编辑系统提示词">编辑拆镜 Agent</button>
          <button type="button" className="workspace-primary" onClick={()=>void analyze()}
            disabled={!!busy||!agentId||!episode.script.trim()||script!==episode.script}>
            {busy==='analyze'?'Agent 正在分析…':'AI 智能拆镜 + 提取资产'}
          </button>
        </div>
        {!availableAgents.length&&<p className="workspace-episode-hint">当前没有可用的 Agent。请先到「设置 → Agents」启用一个 Agent；不影响手动保存剧本。</p>}
        {script!==episode.script&&<p className="workspace-episode-hint">剧本有未保存修改，请先保存后再执行智能拆镜。</p>}
      </div>
      {draft&&<div className="workspace-episode-panel">
        <div className="workspace-episode-title"><h3>制作草案</h3><strong>{draft.shots.length} 镜 · 预计 {Number(total.toFixed(2))} 秒</strong></div>
        {draftRevision!==episode.scriptRevision&&<p className="workspace-episode-hint">当前草案基于旧剧本。保留现有镜头，如需更新请重新拆镜。</p>}
        <div className="workspace-work-tabs" role="tablist" aria-label="分镜与资产">
          <button type="button" role="tab" aria-selected={workTab==='shots'} className={workTab==='shots'?'active':''} onClick={()=>setWorkTab('shots')}>分镜 · {draft.shots.length}</button>
          <button type="button" role="tab" aria-selected={workTab==='assets'} className={workTab==='assets'?'active':''} onClick={()=>setWorkTab('assets')}>美术资产 · {draft.assets.length}</button>
        </div>
        {workTab==='shots'?<div className="workspace-shot-layout">
          <aside className="workspace-shot-list" aria-label="镜头列表">
            {draft.shots.map((shot,i)=><button type="button" key={shot.id} className={selectedShot===i?'active':''} onClick={()=>setSelectedShot(i)}>
              <strong>{String(i+1).padStart(2,'0')}</strong><span>{shot.visual.replace(/<([^<>]+)>/g,'@$1').slice(0,55)||'未填写画面'}</span><small>{shot.duration}s</small>
            </button>)}
            <button type="button" onClick={()=>{addShot();setSelectedShot(draft.shots.length);}}>＋ 添加镜头</button>
          </aside>
          {draft.shots[Math.min(selectedShot,draft.shots.length-1)]&&(()=>{
            const index=Math.min(selectedShot,draft.shots.length-1),shot=draft.shots[index];
            return <div className="workspace-shot-detail">
              <div className="workspace-episode-title"><h4>镜头 {String(index+1).padStart(2,'0')}</h4><div className="workspace-shot-ops">
                <button title="上移" onClick={()=>{reorder(index,-1);setSelectedShot(Math.max(0,index-1));}} disabled={index===0}>↑</button>
                <button title="下移" onClick={()=>{reorder(index,1);setSelectedShot(Math.min(draft.shots.length-1,index+1));}} disabled={index===draft.shots.length-1}>↓</button>
                <button title="删除镜头" onClick={()=>{removeShot(index);setSelectedShot(Math.max(0,index-1));}} disabled={draft.shots.length===1}>删除</button>
              </div></div>
              <div className="workspace-shot-fields">
                {fields.map(({key,label})=><label key={key} className={'workspace-shot-field workspace-field-'+key}>
                  <span>{label}</span>
                  <textarea aria-label={`镜头 ${index+1} ${label}`} rows={key==='visual'?5:2} value={(key==='visual'||key==='scene')?toVisible(shot[key]):shot[key]}
                    onChange={e=>updateShot(index,key,(key==='visual'||key==='scene')?toStored(e.target.value,draft.assets):e.target.value)}/>
                </label>)}
                <label className="workspace-shot-field"><span>时长（秒）</span>
                  <input aria-label={`镜头 ${index+1} 时长`} type="number" min="0.1" max="600" step="0.1" value={shot.duration}
                    onChange={e=>updateShot(index,'duration',Number(e.target.value))}/></label>
              </div>
              <div className="workspace-asset-chips" aria-label="镜头关联资产">
                {draft.assets.filter(a=>a.shotNumbers.includes(index+1)).map(a=><button type="button" key={a.type+':'+a.name} onClick={()=>{setWorkTab('assets');const asset=library.find(x=>x.name===a.name&&x.type===a.type);if(asset)void openAsset(asset.id);}}>
                  @{a.name}</button>)}
              </div>
              <p className="workspace-episode-hint">场景/画面只显示一次。输入 @资产名称可引用草案中的资产，标签上方不再重复渲染预览。</p>
            </div>;
          })()}
        </div>:<div className="workspace-asset-workspace">
          <div className="workspace-asset-cards">
            {draft.assets.map((a,i)=>{
              const item=library.find(x=>x.name===a.name&&x.type===a.type);
              return <button key={a.type+':'+a.name+i} type="button" className={assetDetail===item?.id?'active':''}
                onClick={()=>{if(item)void openAsset(item.id);else setAssetDetail(null);}}>
                <span className="workspace-asset-placeholder">◇</span>
                <strong>{a.name}</strong><small>{types[a.type]} · {a.shotNumbers.length} 镜</small>
                <p>{a.description||item?.description||'待补充视觉描述'}</p>
                <span>{item?'已收录项目资产':'待保存到项目'}</span>
              </button>;
            })}
          </div>
          <div className="workspace-asset-editor">
            <h4>美术资产描述</h4>
            {draft.assets.map((asset,i)=><div className="workspace-asset-edit-row" key={i}>
              <div><input aria-label={`资产 ${i+1} 名称`} value={asset.name} onChange={e=>updateAsset(i,'name',e.target.value)}/>
              <select aria-label={`资产 ${i+1} 类型`} value={asset.type} onChange={e=>updateAsset(i,'type',e.target.value)}>{Object.entries(types).map(([type,name])=><option key={type} value={type}>{name}</option>)}</select></div>
              <textarea aria-label={`资产 ${i+1} 描述`} rows={2} placeholder="只写剧本支持的视觉设定，不写生图提示词" value={asset.description||''} onChange={e=>updateAsset(i,'description',e.target.value)}/>
              <small>涉及镜头：{asset.shotNumbers.join('、')}</small>
              <button type="button" onClick={()=>setDraft(prev=>prev&&({...prev,assets:prev.assets.filter((_,j)=>j!==i)}))}>移除</button>
            </div>)}
            <button type="button" onClick={()=>setDraft(prev=>prev&&({...prev,assets:[...prev.assets,{name:'',type:'prop',shotNumbers:[],description:''}]}))}>＋ 添加资产需求</button>
            {openedAsset&&<div className="workspace-state-editor">
              <h4>{openedAsset.name} · 主形象与衍生状态</h4>
              <textarea rows={3} aria-label="已收录资产描述" defaultValue={openedAsset.description||''} key={openedAsset.id}
                onBlur={e=>{if(e.target.value!==(openedAsset.description||''))void saveAssetDescription(openedAsset,e.target.value);}}/>
              <div className="workspace-state-list">{assetStates.map(s=><span key={s.id}>{s.name}{s.is_main?' · 主形象':''}</span>)}</div>
              <label>新增状态名称<input value={stateName} onChange={e=>setStateName(e.target.value)} placeholder={openedAsset.type==='character'?'例如：休闲装':openedAsset.type==='scene'?'仅填写剧本中实际出现的时间状态':'道具默认只保留主形象'}/></label>
              <label>当前状态描述<textarea value={stateDescription} onChange={e=>setStateDescription(e.target.value)} rows={2}/></label>
              <button type="button" onClick={()=>void addAssetState()} disabled={!stateName.trim()||(openedAsset.type==='prop'&&assetStates.length>0)}>添加状态</button>
            </div>}
            <p className="workspace-episode-hint">本阶段只整理资产描述与状态，尚不生成生图提示词；完整资产清单由后续专业生图 Agent 统一处理。</p>
          </div>
        </div>}
        <div className="workspace-episode-actions"><button type="button" className="workspace-primary" onClick={()=>void savePlan()} disabled={!!busy||draftRevision!==episode.scriptRevision}>{busy==='plan'?'正在保存…':'保存分镜与资产'}</button></div>
      </div>}
    </>}
  </section>;
}
