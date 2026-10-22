import { createHash } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { dirname, join } from 'node:path';
import { MediaJobStore } from './media-job-store';
import { MediaJobRunner } from './media-runner';
import { createFailureLog } from './failure-log';
import { effectiveCapabilities, type ModelConfiguration } from '../../../src/components/settings/model-config';
import { persistMediaReferencesInStore, resolveMediaReferencesInStore } from './media-references';
import type { StoredProvider } from './models';
import type { MediaStyleOption } from '../../../src/components/media-workspace/types';
import { isLocalOrLanAddress } from './local-access';
import type { FileStore } from './file-storage';
import type { RequestRecordStore } from './request-records';

/** Base64 reference images travel through this JSON endpoint. */
const MAX_MEDIA_BODY = 128 * 1024 * 1024;
function reply(res: ServerResponse,status:number,data:unknown) {
  res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
  res.end(JSON.stringify(data));
}
function parseStyle(value: unknown): MediaStyleOption | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const item = value as Record<string, unknown>;
  if (typeof item.id !== 'string' || typeof item.name !== 'string') throw new Error('视觉风格参数无效');
  return {
    id: item.id.slice(0, 120), name: item.name.slice(0, 120),
    ...(typeof item.description === 'string' && item.description.trim() ? { description: item.description.slice(0, 1000) } : {}),
    ...(typeof item.category === 'string' ? { category: item.category.slice(0, 80) } : {}),
  };
}
async function body(req:IncomingMessage, limit=100_000) {
  let data='';
  for await(const part of req) {
    data+=part.toString();
    if(data.length>limit)throw new Error('任务请求体超过限制');
  }
  return JSON.parse(data) as Record<string,unknown>;
}
/** Resolve stored result files to original/thumbnail URLs without leaking provider credentials. */
function presentJob(job: import('./media-job-store').MediaJob, files: FileStore) {
  const { baseUrl: _, ...safe } = job;
  const resultFiles = (job.resultFileIds || []).flatMap((id) => {
    const file = files.get(id);
    if (!file) return [];
    return [{
      fileId: id,
      url: files.originalUrl(file) || `/api/files/${id}`,
      // Width tiers: 160 sidebar list / 320 result card / 1024 detail preview (WebP via imageMogr2 or sharp).
      ...(file.mimeType.startsWith('image/') ? {
        listThumbnailUrl: files.thumbnailUrl(file, 160),
        thumbnailUrl: files.thumbnailUrl(file, 320),
        previewUrl: files.thumbnailUrl(file, 1024),
      } : {}),
    }];
  });
  return resultFiles.length ? { ...safe, resultFiles } : safe;
}
export function createMediaJobsApi(dbPath:string, config:()=>ModelConfiguration, providers:()=>StoredProvider[], files:FileStore, hooks: { target?: (value: unknown, type: string) => Record<string, unknown>; completed?: (job: import('./media-job-store').MediaJob) => void } = {}, records?: RequestRecordStore){
  const store=new MediaJobStore(dbPath, files, (job) => {
    const provider = providers().find(item => item.id === job.providerId);
    records?.syncMedia(job, { modelName: config().models.find(item => item.id === job.modelId)?.displayName, providerName: provider?.name, secret: provider?.apiKey });
    hooks.completed?.(job);
  });
  const logFailure = createFailureLog(join(dirname(dbPath), 'logs'));
  const runner=new MediaJobRunner(store,(job)=>{
    const provider=providers().find(p=>p.id===job.providerId);
    return provider&&provider.apiKey?{apiKey:provider.apiKey,baseUrl:provider.baseUrl}:undefined;
  }, (job, message, secret) => logFailure({ appId: 'builtin:media', appName: '媒体生成', toolName: job.modelId, stage: 'mcp-tool', code: job.status === 'uncertain' ? 'MEDIA_TASK_UNCERTAIN' : 'MEDIA_TASK_FAILED', message, secret }), hooks.completed);
  runner.start();
  const submit = async (input: Record<string, unknown>) => {
        if(typeof input.taskId!=='string'||!input.taskId.trim()||input.taskId.length>120)throw new Error('任务 ID 无效');
        if(input.batchId!==undefined&&(typeof input.batchId!=='string'||!input.batchId.trim()||input.batchId.length>120))throw new Error('批次 ID 无效');
        if(typeof input.modelId!=='string'||!input.modelId)throw new Error('模型必填');
        if(typeof input.prompt!=='string'||!input.prompt.trim()||input.prompt.length>16000)throw new Error('提示词无效');
        const model=config().models.find(m=>m.id===input.modelId&&m.enabled!==false);
        if(!model||(model.type!=='image'&&model.type!=='video'))throw new Error('模型不存在或不是图片/视频模型');
        const enabled=model.bindings.filter(b=>b.enabled!==false);
        if(enabled.length!==1)throw new Error('每个模型必须且只能绑定一个已启用供应商');
        const binding=enabled[0];
        const provider=providers().find(p=>p.id===binding.providerId);
        if(!provider?.apiKey)throw new Error('供应商缺少 API Key');
        const type=model.type;
        const rawOptions=input.options&&typeof input.options==='object'&&!Array.isArray(input.options)?input.options as Record<string,unknown>:{};
        if(rawOptions.generationCount!==undefined)throw new Error('生成数量必须由宿主拆分为独立任务');
        if(rawOptions.references!==undefined&&!Array.isArray(rawOptions.references))throw new Error('参考素材必须是数组');
        const referenceCount=Array.isArray(rawOptions.references)?rawOptions.references.length:0;
        const effective=effectiveCapabilities(config(),model,binding);
        const maxReferences=effective&&'maxReferenceImages' in effective?effective.maxReferenceImages:0;
        if(referenceCount>maxReferences)throw new Error(`参考图片最多 ${maxReferences} 张`);
        // Large data URLs stay out of the job row; adapters read the saved files.
        const capabilities = effective as { resolutions?: string[]; aspectRatios?: string[]; durations?: number[] | { min: number; max: number } } | undefined;
        if (typeof rawOptions.resolution === 'string' && capabilities?.resolutions && !capabilities.resolutions.includes(rawOptions.resolution)) throw new Error('模型不支持所选分辨率');
        if (typeof rawOptions.aspectRatio === 'string' && capabilities?.aspectRatios && !capabilities.aspectRatios.includes(rawOptions.aspectRatio)) throw new Error('模型不支持所选画幅');
        if (rawOptions.duration !== undefined && capabilities?.durations) {
          const duration = rawOptions.duration, allowed = capabilities.durations;
          if (typeof duration !== 'number' || !Number.isFinite(duration) || (Array.isArray(allowed) ? !allowed.includes(duration) : duration < allowed.min || duration > allowed.max)) throw new Error('片段时长不在模型支持范围内，请调整分镜组合');
        }
        const requestId = input.requestId;
        if (requestId !== undefined && (typeof requestId !== 'string' || !/^[\w:.-]{1,160}$/.test(requestId))) throw new Error('生成请求编号无效');
        const fingerprint = createHash('sha256').update(JSON.stringify([input.modelId,input.prompt,rawOptions,input.style])).digest('hex');
        const existing = () => typeof requestId === 'string' ? store.list().find(job => job.options.studioRequestId === requestId) : undefined;
        const previous = existing();
        if (previous) { if (previous.options.studioFingerprint !== fingerprint) throw new Error('生成请求编号已用于其他内容'); return previous; }
        const target = rawOptions.studioTarget !== undefined ? hooks.target?.(rawOptions.studioTarget, type) : undefined;
        if (rawOptions.studioTarget !== undefined && !target) throw new Error('生成目标不可用');
        const options=await persistMediaReferencesInStore(await resolveMediaReferencesInStore(rawOptions, files), files);
        if (target) options.studioTarget = target;
        if (requestId) { options.studioRequestId = requestId; options.studioFingerprint = fingerprint; }
        const raced = existing();
        if (raced) { if (raced.options.studioFingerprint !== fingerprint) throw new Error('生成请求编号已用于其他内容'); return raced; }
        const style = parseStyle(input.style);
        const job=store.create({taskId:input.taskId.trim(),...(typeof input.batchId==='string'?{batchId:input.batchId.trim()}:{}),modelId:model.id,type,prompt:input.prompt.trim(),...(style ? { style } : {}),providerId:provider.id,upstreamModelId:binding.upstreamModelId,protocolKey:binding.protocolKey,baseUrl:provider.baseUrl,options});

        void runner.tick();
        return job;
  };
  const handle=async(req:IncomingMessage,res:ServerResponse):Promise<boolean>=>{
    const path=new URL(req.url||'/', 'http://localhost').pathname;
    if(!path.startsWith('/api/media-generation/'))return false;
    if(!isLocalOrLanAddress(req.socket.remoteAddress)){reply(res,403,{error:'生成任务 API 仅允许本机或同一局域网调用'});return true;}
    const method=req.method||'GET';
    try{
      if(path==='/api/media-generation/jobs' && method==='GET'){
        reply(res,200,store.list().map((job)=>presentJob(job,files)));return true;
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
        const input=await body(req, MAX_MEDIA_BODY);
        const job = await submit(input);
        void runner.tick();
        reply(res,201,job);return true;
      }
      const match=path.match(/^\/api\/media-generation\/jobs\/([a-f0-9-]+)(\/file)?$/);
      if(match && !match[2] && method==='DELETE'){
        const job=store.get(match[1]);
        let jobs=job?.batchId?store.list().filter((item)=>item.batchId===job.batchId):job?[job]:store.list().filter((item)=>item.batchId===match[1]);
        if(job&&!job.batchId&&typeof job.options.generationCount==='number'&&job.options.generationCount>1){
          jobs=store.list().filter((item)=>!item.batchId&&(item.taskId||item.id)===(job.taskId||job.id)&&item.prompt===job.prompt&&item.createdAt.slice(0,19)===job.createdAt.slice(0,19));
        }
        if(!jobs.length){reply(res,404,{error:'任务不存在'});return true;}
        if(jobs.some((item)=>item.status==='queued'||item.status==='running'))throw new Error('任务仍在生成，请等待完成或失败后再删除');
        store.removeMany(jobs);
        try { await store.removeFiles(jobs); }
        catch(error) { for(const item of jobs) store.put(item); throw error; }
        reply(res,200,{ok:true,deleted:jobs.length});return true;
      }
      const taskMatch=path.match(/^\/api\/media-generation\/tasks\/([^/]+)$/);
      if(taskMatch && method==='DELETE'){
        const jobs=store.deleteTask(decodeURIComponent(taskMatch[1]));
        if(!jobs.length){reply(res,404,{error:'任务不存在'});return true;}
        store.removeMany(jobs);
        try { await store.removeFiles(jobs); }
        catch(error) { for(const job of jobs) store.put(job); throw error; }
        reply(res,200,{ok:true,deleted:jobs.length});return true;
      }
      if(match && method==='GET'){
        const job=store.get(match[1]);
        if(!job){reply(res,404,{error:'任务不存在'});return true;}
        if(match[2]){
          const index=Number(new URL(req.url||'/','http://localhost').searchParams.get('index')||0);
          const file=await runner.media(job,Number.isInteger(index)&&index>=0?index:0);
          if(!file){reply(res,404,{error:'任务结果尚未就绪'});return true;}
          res.writeHead(200,{'Content-Type':file.mime,'Cache-Control':'private,max-age=60','X-Content-Type-Options':'nosniff'});
          res.end(file.bytes);return true;
        }
        const safe=presentJob(job,files);
        reply(res,200,safe);return true;
      }
      reply(res,404,{error:'接口不存在'});
    }catch(error){reply(res,400,{error:error instanceof Error?error.message:'请求错误'});}
    return true;
  };
  return {handle,runner,store,submit};
}
