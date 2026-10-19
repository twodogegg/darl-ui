import type { IncomingMessage, ServerResponse } from 'node:http';
import { dirname, join } from 'node:path';
import { MediaJobStore } from './media-job-store';
import { MediaJobRunner } from './media-runner';
import { createFailureLog } from './failure-log';
import type { ModelConfiguration } from '../../../src/components/settings/model-config';
import type { StoredProvider } from './models';

const localhost = new Set(['127.0.0.1','::1','::ffff:127.0.0.1']);
function reply(res: ServerResponse,status:number,data:unknown) {
  res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
  res.end(JSON.stringify(data));
}
async function body(req:IncomingMessage) {
  let data='';
  for await(const part of req) {
    data+=part.toString();
    if(data.length>100_000)throw new Error('任务请求体超过限制');
  }
  return JSON.parse(data) as Record<string,unknown>;
}
export function createMediaJobsApi(dbPath:string, config:()=>ModelConfiguration, providers:()=>StoredProvider[]){
  const store=new MediaJobStore(dbPath);
  const logFailure = createFailureLog(join(dirname(dbPath), 'logs'));
  const runner=new MediaJobRunner(store,(job)=>{
    const provider=providers().find(p=>p.id===job.providerId);
    return provider&&provider.apiKey?{apiKey:provider.apiKey,baseUrl:provider.baseUrl}:undefined;
  }, (job, message, secret) => logFailure({ appId: 'builtin:media', appName: '媒体生成', toolName: job.modelId, stage: 'mcp-tool', code: job.status === 'uncertain' ? 'MEDIA_TASK_UNCERTAIN' : 'MEDIA_TASK_FAILED', message, secret }));
  runner.start();
  const handle=async(req:IncomingMessage,res:ServerResponse):Promise<boolean>=>{
    const path=new URL(req.url||'/', 'http://localhost').pathname;
    if(!path.startsWith('/api/media-generation/'))return false;
    if(!localhost.has(req.socket.remoteAddress||'')){reply(res,403,{error:'生成任务 API 仅允许本机调用'});return true;}
    const method=req.method||'GET';
    try{
      if(path==='/api/media-generation/jobs' && method==='GET'){
        reply(res,200,store.list().map(({baseUrl:_,...job})=>job));return true;
      }
      if(path==='/api/media-generation/limits' && method==='GET'){reply(res,200,store.limits());return true;}
      if(path==='/api/media-generation/limits' && method==='POST'){
        const input=await body(req);
        if(typeof input.modelId!=='string'||typeof input.concurrency!=='number')throw new Error('模型和并发必填');
        store.setLimit(input.modelId,input.concurrency);
        await runner.tick();
        reply(res,200,store.limits());return true;
      }
      if(path==='/api/media-generation/jobs' && method==='POST'){
        const input=await body(req);
        if(!['gpt-image-2','minimax-h3-flash'].includes(String(input.modelId)))throw new Error('首期只支持 GPT Image 2 和 MiniMax H3 Flash');
        if(typeof input.prompt!=='string'||!input.prompt.trim()||input.prompt.length>16000)throw new Error('提示词无效');
        const model=config().models.find(m=>m.id===input.modelId&&m.enabled!==false);
        if(!model)throw new Error('模型未启用');
        const enabled=model.bindings.filter(b=>b.enabled!==false);
        if(enabled.length!==1)throw new Error('每个模型必须且只能绑定一个已启用供应商');
        const binding=enabled[0];
        const provider=providers().find(p=>p.id===binding.providerId);
        if(!provider?.apiKey)throw new Error('供应商缺少 API Key');
        const type=input.modelId==='gpt-image-2'?'image':'video';
        const options=input.options&&typeof input.options==='object'&&!Array.isArray(input.options)?input.options as Record<string,unknown>:{};
        if(options.references&&type!=='image')throw new Error('视频参考素材模式待真实网关核验后开放');
        // 适配器在提交时再下载/解码参考图，这里只保留原始值。
        const job=store.create({modelId:input.modelId as 'gpt-image-2'|'minimax-h3-flash',type,prompt:input.prompt.trim(),providerId:provider.id,upstreamModelId:binding.upstreamModelId,baseUrl:provider.baseUrl,options});
        void runner.tick();
        reply(res,201,job);return true;
      }
      const match=path.match(/^\/api\/media-generation\/jobs\/([a-f0-9-]+)(\/file)?$/);
      if(match && method==='GET'){
        const job=store.get(match[1]);
        if(!job){reply(res,404,{error:'任务不存在'});return true;}
        if(match[2]){
          const index=Number(new URL(req.url||'/','http://localhost').searchParams.get('index')||0);
          const file=runner.media(job,Number.isInteger(index)&&index>=0?index:0);
          if(!file){reply(res,404,{error:'任务结果尚未就绪'});return true;}
          res.writeHead(200,{'Content-Type':file.mime,'Cache-Control':'private,max-age=60','X-Content-Type-Options':'nosniff'});
          res.end(file.bytes);return true;
        }
        const {baseUrl:_,...safe}=job;
        reply(res,200,safe);return true;
      }
      reply(res,404,{error:'接口不存在'});
    }catch(error){reply(res,400,{error:error instanceof Error?error.message:'请求错误'});}
    return true;
  };
  return {handle,runner,store};
}
