import { useEffect, useState } from 'react';

type Limits = Record<string, number>;
const names: Array<{ id:string; title:string }>=[
  {id:'gpt-image-2',title:'GPT Image 2 图片并发'},
  {id:'gpt-image-2.5',title:'GPT Image 2.5 图片并发'},
  {id:'gemini-3-pro-image-preview',title:'Gemini 3 Pro Image Preview 图片并发'},
  {id:'minimax-h3-flash',title:'MiniMax H3 Flash 视频并发'},
];
export function MediaConcurrencySettings(){
  const [limits,setLimits]=useState<Limits>(Object.fromEntries(names.map((item)=>[item.id,4])));
  const [pending,setPending]=useState(false);
  const [message,setMessage]=useState('');
  useEffect(()=>{
    let alive=true;
    fetch('/api/media-generation/limits').then(async r=>{const x=await r.json();if(!r.ok)throw new Error(x.error||'读取失败');if(alive)setLimits(x);}).catch(e=>{if(alive)setMessage(e.message);});
    return ()=>{alive=false;};
  },[]);
  async function save(modelId:keyof Limits){
    setPending(true);setMessage('');
    try{
      const r=await fetch('/api/media-generation/limits',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({modelId,concurrency:limits[modelId]})});
      const v=await r.json();
      if(!r.ok)throw new Error(v.error||'保存失败');
      setLimits(v);setMessage('并发限制已保存，后续调度将采用新配置。');
    }catch(e){setMessage(e instanceof Error?e.message:'保存失败');}
    finally{setPending(false);}
  }
  return <section className="example-media-concurrency" aria-label="媒体并发配置">
    <h3>生成任务并发</h3>
    <p>每个模型分别限制同时在途的任务数量。配置减少时不会取消已经提交的视频。</p>
    {names.map(({id,title})=><div key={id} style={{display:'flex',alignItems:'center',gap:10,margin:'12px 0'}}>
      <label htmlFor={'limit-'+id} style={{flex:1}}>{title}</label>
      <input id={'limit-'+id} style={{width:100,padding:8}} type="number" min={1} max={100000} step={1} value={limits[id]}
        onChange={e=>setLimits(v=>({...v,[id]:Number(e.target.value)}))}/>
      <button className="darl-button darl-button--outline darl-button-size--default" disabled={pending||!Number.isSafeInteger(limits[id])||limits[id]<1||limits[id]>100000}
        onClick={()=>void save(id)}>保存</button>
    </div>)}
    {message&&<p role="status">{message}</p>}
  </section>;
}
