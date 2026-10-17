import { useEffect, useState, type ReactNode, type ChangeEvent } from 'react';
import type { AgentConfig } from '@darl/ui';
import type { AssetDraft, BreakdownDraft, ShotDraft } from '../server/episode-store';
import './episodes.css';

type Episode = { id:number; projectId:number; title:string; script:string; scriptRevision:number; planRevision:number|null; updatedAt:string };
type PlanResponse = { episode:Episode;shots:ShotDraft[];assets:AssetDraft[];totalSeconds:number };
type LibraryAsset = { id:string;name:string;type:AssetDraft['type'] };
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
const marker=/<([^<>\n]{1,80})>/gu;
function AssetText({value,onAsset,assets}:{value:string;onAsset:(name:string)=>void;assets:AssetDraft[]}){
  const parts=[...value.matchAll(marker)];
  if(!parts.length)return <span>{value||'—'}</span>;
  const nodes:ReactNode[]=[];
  let pos=0;
  parts.forEach((part,i)=>{
    const start=part.index??0;
    if(start>pos)nodes.push(value.slice(pos,start));
    const name=part[1].trim(),bound=assets.some(a=>a.name===name);
    nodes.push(<button className={'workspace-asset-mention'+(!bound?' is-unbound':'')} title={bound?'定位资产：'+name:'未找到资产：'+name}
      onClick={()=>onAsset(name)} type="button" key={i}>@{name}</button>);
    pos=start+part[0].length;
  });
  if(pos<value.length)nodes.push(value.slice(pos));
  return <span className="workspace-mentions">{nodes}</span>;
}

export function EpisodeWorkspace({projectId,agents}:{projectId:number;agents:AgentConfig[]}){
  const [episodes,setEpisodes]=useState<Episode[]>([]);
  const [selectedId,setSelectedId]=useState<number|null>(null);
  const [episode,setEpisode]=useState<Episode|null>(null);
  const [script,setScript]=useState('');
  const [newTitle,setNewTitle]=useState('');
  const [agentId,setAgentId]=useState('');
  const [draft,setDraft]=useState<BreakdownDraft|null>(null);
  const [draftRevision,setDraftRevision]=useState<number|null>(null);
  const [library,setLibrary]=useState<LibraryAsset[]>([]);
  const [busy,setBusy]=useState('');
  const [error,setError]=useState('');
  const [notice,setNotice]=useState('');
  const availableAgents=agents.filter(a=>!a.builtIn && a.enabled!==false);

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
  const assetFocus=(name:string)=>{
    const index=draft?.assets.findIndex(a=>a.name===name)??-1;
    if(index<0){setError('资产「'+name+'」尚未列入需求清单');return;}
    document.getElementById('episode-asset-'+index)?.scrollIntoView({behavior:'smooth',block:'center'});
  };
  const total=draft?.shots.reduce((sum,s)=>sum+(Number.isFinite(s.duration)?s.duration:0),0)??0;
  return <section className="workspace-episodes" aria-label="剧集与智能拆镜">
    <header><h2>剧集 · 剧本与智能拆镜</h2><p>用户剧本为准。通过你配置的专业 Agent，一次输出九列分镜和资产需求。</p></header>
    <div className="workspace-episode-create">
      <input aria-label="新剧集名称" placeholder="例如：第 01 集" maxLength={100} value={newTitle} onChange={e=>setNewTitle(e.target.value)}/>
      <button type="button" onClick={()=>void create()} disabled={!!busy||!newTitle.trim()}>添加剧集</button>
    </div>
    {episodes.length>0&&<nav className="workspace-episode-tabs" aria-label="选择剧集">
      {episodes.map(e=><button type="button" key={e.id} className={e.id===selectedId?'active':''} onClick={()=>setSelectedId(e.id)}>{e.title}</button>)}
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
              <option value="">选择已配置的 Agent</option>
              {availableAgents.map(agent=><option key={agent.id} value={agent.id}>{agent.name}</option>)}
            </select>
          </label>
          <button type="button" className="workspace-primary" onClick={()=>void analyze()}
            disabled={!!busy||!agentId||!episode.script.trim()||script!==episode.script}>
            {busy==='analyze'?'Agent 正在分析…':'AI 智能拆镜 + 提取资产'}
          </button>
        </div>
        {!availableAgents.length&&<p className="workspace-episode-hint">请先到「设置 → Agents」创建并启用用于拆镜的专业 Agent；不影响手动保存剧本。</p>}
        {script!==episode.script&&<p className="workspace-episode-hint">剧本有未保存修改，请先保存后再执行智能拆镜。</p>}
      </div>
      {draft&&<div className="workspace-episode-panel">
        <div className="workspace-episode-title"><h3>九列分镜脚本</h3>
          <strong>{draft.shots.length} 镜 · 预计 {Number(total.toFixed(2))} 秒</strong></div>
        {draftRevision!==episode.scriptRevision&&<p className="workspace-episode-hint">这份分镜基于旧版剧本；如果要保存，请先用最新剧本重新拆镜。</p>}
        <p className="workspace-episode-hint">画面中的资产引用以 @资产名 展示；编辑框中保留可解析的 &lt;资产名&gt; 原始写法。</p>
        <div className="workspace-shot-scroll"><table className="workspace-shot-table">
          <thead><tr><th>镜头编号</th><th>景别</th><th>运镜</th><th>切镜方式</th><th>场景</th><th>画面</th><th>台词/对白</th><th>音效</th><th>时长（秒）</th></tr></thead>
          <tbody>{draft.shots.map((shot,i)=><tr key={shot.id}>
            <td><strong>{String(i+1).padStart(2,'0')}</strong><div className="workspace-shot-ops">
              <button title="上移" onClick={()=>reorder(i,-1)} disabled={i===0}>↑</button>
              <button title="下移" onClick={()=>reorder(i,1)} disabled={i===draft.shots.length-1}>↓</button>
              <button title="删除镜头" onClick={()=>removeShot(i)} disabled={draft.shots.length===1}>×</button>
            </div></td>
            {fields.map(({key,label})=><td key={key}>
              <label className="workspace-shot-field"><span>{label}</span>
                <textarea aria-label={`镜头 ${i+1} ${label}`} rows={key==='visual'?4:2} value={shot[key]}
                  onChange={e=>updateShot(i,key,e.target.value)}/>
              </label>
              {(key==='visual'||key==='scene')&&<div className="workspace-shot-preview">
                <AssetText value={shot[key]} assets={draft.assets} onAsset={assetFocus}/>
              </div>}
            </td>)}
            <td><input aria-label={`镜头 ${i+1} 时长`} type="number" min="0.1" step="0.1" max="600" value={shot.duration}
              onChange={e=>updateShot(i,'duration',Number(e.target.value))}/></td>
          </tr>)}</tbody></table></div>
        <button type="button" onClick={addShot}>+ 添加镜头</button>
      </div>}
      {draft&&<div className="workspace-episode-panel">
        <div className="workspace-episode-title"><h3>美术资产需求</h3><small>按项目去重 · 仅规划，不生成图片</small></div>
        {draft.assets.length===0&&<p>尚无资产需求。</p>}
        <div className="workspace-asset-list">{draft.assets.map((asset,i)=>
          <div id={'episode-asset-'+i} className="workspace-asset-item" key={i}>
            <label>名称<input value={asset.name} onChange={e=>updateAsset(i,'name',e.target.value)}/></label>
            <label>类型<select value={asset.type} onChange={e=>updateAsset(i,'type',e.target.value)}>
              {Object.entries(types).map(([type,name])=><option key={type} value={type}>{name}</option>)}
            </select></label>
            <label>涉及镜头（编号，逗号分隔）
              <input key={asset.name+":"+i} defaultValue={asset.shotNumbers.join(', ')} onBlur={e=>updateAsset(i,'shotNumbers',e.target.value)}/>
            </label>
            <span className="workspace-asset-state">{library.some(item=>item.name===asset.name&&item.type===asset.type)?'项目资产已存在':'待准备资产'}</span>
            <button type="button" onClick={()=>setDraft(prev=>prev&&({...prev,assets:prev.assets.filter((_,j)=>j!==i)}))}>移除</button>
          </div>)}</div>
        <button type="button" onClick={()=>setDraft(prev=>prev&&({...prev,assets:[...prev.assets,{name:'',type:'prop',shotNumbers:[]}]}))}>+ 添加资产需求</button>
        <div className="workspace-episode-actions">
          <button type="button" className="workspace-primary" onClick={()=>void savePlan()}
            disabled={!!busy||draftRevision!==episode.scriptRevision}>
            {busy==='plan'?'正在保存…':'保存分镜与资产'}
          </button>
        </div>
      </div>}
    </>}
  </section>;
}
