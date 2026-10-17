import type { MediaJob } from './media-job-store';
import { createH3Video, getH3Video, downloadH3Video } from './h3-flash';

function url(base: string, endpoint: string) {
  return new URL(endpoint.replace(/^\//,''), base.replace(/\/$/,'')+'/').toString();
}
function ensureHttp(base: string) {
  const parsed = new URL(base);
  if (!['https:','http:'].includes(parsed.protocol) || parsed.username || parsed.password) throw new Error('供应商地址无效');
}
async function checked(response: Response, key: string) {
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    const message = body.replaceAll(key,'[REDACTED]').slice(0,400);
    throw new Error('供应商 HTTP '+response.status+': '+message);
  }
  return response;
}
function imageBytes(value: unknown): { data: Buffer; ext: 'png'|'jpeg'|'webp' } {
  if (!value || typeof value !== 'object') throw new Error('图片结果无效');
  const item=value as { b64_json?:string; url?:string };
  if (!item.b64_json) throw new Error('渠道未返回 b64_json；URL 结果需要先经网关验收再开放');
  const data=Buffer.from(item.b64_json,'base64');
  const png = data.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex'));
  const jpeg=data.subarray(0,3).equals(Buffer.from('ffd8ff','hex'));
  const webp=data.toString('ascii',0,4)==='RIFF'&&data.toString('ascii',8,12)==='WEBP';
  if(!data.length||(!png&&!jpeg&&!webp))throw new Error('图片内容无效');
  return {data,ext:png?'png':jpeg?'jpeg':'webp'};
}
export async function generateImage(job:MediaJob,key:string):Promise<{data:Buffer;ext:'png'|'jpeg'|'webp'}>{
  ensureHttp(job.baseUrl);
  const opts=job.options;
  const size=opts.size ?? '1024x1024';
  if (!['auto','1024x1024','1536x1024','1024x1536'].includes(String(size))) throw new Error('图片尺寸未在当前网关合同中验证');
  if(opts.references) throw new Error('图片参考编辑需确认渠道 multipart 合同，当前暂不支持');
  const response=await checked(await fetch(url(job.baseUrl,'images/generations'),{
    method:'POST',headers:{Authorization:'Bearer '+key,'Content-Type':'application/json'},
    body:JSON.stringify({model:job.upstreamModelId,prompt:job.prompt,size,n:1}),signal:AbortSignal.timeout(180000),
  }),key);
  const result=await response.json() as {data?:unknown[]};
  return imageBytes(result.data?.[0]);
}
export async function submitVideo(job:MediaJob,key:string):Promise<string>{
  ensureHttp(job.baseUrl);
  if(job.options.references)throw new Error('H3 参考素材上传协议尚未实测，不允许直接提交');
  const result=await createH3Video(job.baseUrl,key,{
    prompt:job.prompt, seconds:Number(job.options.duration??10),
    resolution:(job.options.resolution ?? '768') as '480'|'768',
    aspectRatio:(job.options.aspectRatio ?? '9:16') as '16:9'|'9:16',
    mode:'text-to-video',
  },AbortSignal.timeout(30000));
  return result.id;
}
export async function checkVideo(job:MediaJob,key:string):Promise<{state:'running'|'failed'|'completed';error?:string;media?:Buffer}>{
  if(!job.remoteTaskId)throw new Error('视频远端编号未保存');
  ensureHttp(job.baseUrl);
  const remote=await getH3Video(job.baseUrl,key,job.remoteTaskId,AbortSignal.timeout(30000));
  if(remote.status==='failed')return {state:'failed',error:remote.error||'视频生成失败'};
  if(remote.status==='completed')return {state:'completed',media:Buffer.from(await downloadH3Video(job.baseUrl,key,remote,AbortSignal.timeout(120000)))};
  return {state:'running'};
}
