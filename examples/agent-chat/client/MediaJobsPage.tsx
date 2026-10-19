import { useEffect, useState } from 'react';
import { ArrowLeft, RefreshCw } from 'lucide-react';

type Job={id:string;modelId:string;type:'image'|'video';status:string;prompt:string;phase?:string;error?:string;resultForm?:string;resultPath?:string;resultPaths?:string[];providerResponse?:unknown;createdAt:string};
const status:Record<string,string>={queued:'排队中',running:'生成中',completed:'已完成',failed:'失败',uncertain:'待人工核对',cancelled:'已取消'};
export function MediaJobsPage({onBack}:{onBack:()=>void}){
  const [jobs,setJobs]=useState<Job[]>([]);
  const [error,setError]=useState('');
  const [busy,setBusy]=useState(false);
  async function load(){
    try{
      const response=await fetch('/api/media-generation/jobs');
      const data=await response.json();
      if(!response.ok)throw new Error(data.error||'读取任务失败');
      setJobs(data);setError('');
    }catch(e){setError(e instanceof Error?e.message:'无法读取生成任务');}
  }
  useEffect(()=>{
    void load();
    const timer=setInterval(()=>void load(),3000);
    return ()=>clearInterval(timer);
  },[]);
  return <main style={{maxWidth:1050,margin:'0 auto',padding:24}}>
    <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:12,flexWrap:'wrap'}}>
      <button className="darl-button darl-button--outline darl-button-size--default" onClick={onBack}><ArrowLeft size={16}/> 返回</button>
      <h1 style={{fontSize:24}}>生成任务</h1>
      <button className="darl-button darl-button--outline darl-button-size--default" disabled={busy} onClick={()=>{setBusy(true);void load().finally(()=>setBusy(false));}}><RefreshCw size={16}/> 刷新</button>
    </div>
    <p>由主 Agent 提交图片或视频任务。关闭页面不影响 Node 服务后台执行；此处展示 SQLite 中的真实任务状态。</p>
    {error&&<p role="alert" style={{color:'#ef4444'}}>{error}</p>}
    {!jobs.length&&!error&&<p>暂无生成任务，请在主 Agent 对话中提出生成图片或视频的要求。</p>}
    <div style={{display:'grid',gap:12}}>
      {jobs.map(job=><article key={job.id} style={{border:'1px solid var(--darl-border)',borderRadius:10,padding:16}}>
        <div style={{display:'flex',alignItems:'center',gap:12,justifyContent:'space-between',flexWrap:'wrap'}}>
          <strong>{job.type==='image'?'图片':'视频'} · {job.modelId}</strong>
          <span>{status[job.status]||job.status}</span>
        </div>
        <p style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{job.prompt}</p>
        <small>{job.id} · {job.createdAt}{job.resultForm?` · 返回形态 ${job.resultForm}`:''}</small>
        {job.error&&<p role="alert">{job.error}</p>}
        {job.status==='completed'&&<div style={{display:'flex',flexWrap:'wrap',gap:12,marginTop:8}}>{(job.resultPaths?.length?job.resultPaths:[job.resultPath]).filter(Boolean).map((_,index)=><a key={index} href={`/api/media-generation/jobs/${job.id}/file${index?`?index=${index}`:''}`} target="_blank" rel="noreferrer">查看结果{index?` ${index+1}`:''}</a>)}</div>}
        {job.providerResponse!==undefined&&<details style={{marginTop:8}}><summary>供应商原始返回</summary><pre style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere',fontSize:12}}>{JSON.stringify(job.providerResponse,null,2)}</pre></details>}
      </article>)}
    </div>
  </main>;
}
