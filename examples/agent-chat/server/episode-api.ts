import type { IncomingMessage, ServerResponse } from 'node:http';
import { EpisodeStore, parseAgentBreakdown, type BreakdownDraft } from './episode-store';

const LOCAL = new Set(['127.0.0.1','::1','::ffff:127.0.0.1']);
type Analyze = (agentId: string, script: string, signal: AbortSignal) => Promise<string>;
class HttpError extends Error { constructor(readonly status: number, message: string) { super(message); } }
async function readJson(request: IncomingMessage) {
  if (!(request.headers['content-type'] || '').startsWith('application/json')) throw new HttpError(415,'只接受 JSON');
  let size=0;
  const chunks: Buffer[]=[];
  for await(const chunk of request) {
    const bytes=Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk);
    size+=bytes.length;
    if (size>1024*1024) throw new HttpError(413,'请求内容超过 1MB');
    chunks.push(bytes);
  }
  try {
    const result=JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
    if (!result || typeof result !== 'object' || Array.isArray(result)) throw new Error('invalid body');
    return result as Record<string, unknown>;
  }catch {throw new HttpError(400,'JSON 格式无效');}
}
const num=(value:string)=>{const n=Number(value);if(!Number.isSafeInteger(n)||n<1)throw new HttpError(400,'剧集或项目编号无效');return n;};

export function createEpisodeApi(store:EpisodeStore, analyze:Analyze) {
  return async (req:IncomingMessage,res:ServerResponse):Promise<boolean> => {
    const path=new URL(req.url||'/', 'http://localhost').pathname;
    if (!path.startsWith('/api/workspace/')) return false;
    const project=path.match(/^\/api\/workspace\/projects\/(\d+)\/(episodes|assets)$/);
    const episode=path.match(/^\/api\/workspace\/episodes\/(\d+)(?:\/(script|analyze|plan))?$/);
    if (!project && !episode) return false;
    const send=(code:number,data:unknown)=>{
      res.writeHead(code,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
      res.end(JSON.stringify(data));
    };
    if(!LOCAL.has(req.socket.remoteAddress||'')){send(403,{error:'项目工作台仅允许本机访问'});return true;}
    try {
      const method=req.method || 'GET';
      if(project){
        const id=num(project[1]);
        if(project[2]==='assets' && method==='GET'){
          const value=store.assets(id);
          if(!value)throw new HttpError(404,'项目不存在');
          send(200,{code:'OK',data:value});return true;
        }
        if(project[2]==='episodes'){
          if(method==='GET') {
            const value=store.episodes(id);
            if(!value)throw new HttpError(404,'项目不存在');
            send(200,{code:'OK',data:value});return true;
          }
          if(method==='POST'){
            const input=await readJson(req);
            const value=store.create(id,input.title);
            if(!value)throw new HttpError(404,'项目不存在');
            send(201,{code:'CREATED',data:value});return true;
          }
        }
      }
      if(episode){
        const id=num(episode[1]);
        const current=store.get(id);
        if(!current)throw new HttpError(404,'剧集不存在');
        const kind=episode[2];
        if(!kind && method==='GET'){send(200,{code:'OK',data:store.plan(id)});return true;}
        if(kind==='script' && method==='PUT'){
          const input=await readJson(req);
          const saved=store.saveScript(id,input.script,input.scriptRevision);
          send(200,{code:'OK',data:saved});return true;
        }
        if(kind==='plan' && method==='PUT'){
          const input=await readJson(req);
          const saved=store.savePlan(id,input.scriptRevision,input.plan);
          send(200,{code:'OK',data:saved});return true;
        }
        if(kind==='analyze' && method==='POST'){
          const input=await readJson(req);
          if(typeof input.agentId!=='string'||!input.agentId)throw new HttpError(422,'请选择已配置的 Agent');
          if(input.scriptRevision!==current.scriptRevision)throw new HttpError(409,'剧本有更新，请先刷新');
          if(!current.script.trim())throw new HttpError(422,'请先保存本集剧本');
          const controller=new AbortController();
          const timeout=AbortSignal.timeout(180000);
          const signal=AbortSignal.any([controller.signal,timeout]);
          const onClose=()=>{if(!res.writableEnded)controller.abort();};
          res.on('close',onClose);
          try {
            const raw=await analyze(input.agentId,current.script,signal);
            const draft:BreakdownDraft=parseAgentBreakdown(raw);
            if(store.get(id)?.scriptRevision!==current.scriptRevision)throw new HttpError(409,'分析期间剧本已更新，请重新拆镜');
            send(200,{code:'OK',data:{plan:draft,scriptRevision:current.scriptRevision,totalSeconds:draft.shots.reduce((sum,s)=>sum+s.duration,0)}});
          } finally {res.off('close',onClose);}
          return true;
        }
      }
      throw new HttpError(404,'接口不存在');
    }catch(error){
      const message=error instanceof Error?error.message:'剧集操作失败';
      const status=error instanceof HttpError?error.status : /剧本已在|剧本在分析|剧本有更新/.test(message)?409 : 422;
      if(!res.writableEnded && !res.destroyed)send(status,{error:message});
    }
    return true;
  };
}
