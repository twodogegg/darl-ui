import { MediaJobStore, type MediaJob } from './media-job-store';
import { generateImages, generateGeminiImages, submitVideo, checkVideo } from './media-adapters';


type Credentials = { baseUrl: string; apiKey: string };
type CredentialsResolver = (job: MediaJob) => Credentials | undefined;
type FailureReporter = (job: MediaJob, message: string, secret: string) => void;

/** Persistent jobs, in-memory local executor. Does not attempt multi-process coordination. */
export class MediaJobRunner {
  private active = new Set<string>();
  private timer: ReturnType<typeof setInterval> | undefined;
  private busy = false;
  constructor(readonly store: MediaJobStore, private credentials: CredentialsResolver, private onFailure: FailureReporter = () => {}, private onCompleted: (job: MediaJob) => void = () => {}) {}

  start() {
    this.store.recover();
    for (const job of this.store.list()) if (job.status === 'completed') this.completed(job);
    if (!this.timer) {
      this.timer = setInterval(() => { void this.tick(); }, 2500);
      this.timer.unref?.();
      void this.tick();
    }
  }
  stop() { if (this.timer) clearInterval(this.timer); this.timer=undefined; }
  async tick() {
    if(this.busy)return;
    this.busy=true;
    try{
      const all=this.store.list();
      const running = new Map<string,number>();
      for(const job of all) if(job.status==='running')running.set(job.modelId,(running.get(job.modelId)||0)+1);
      for(const job of all){
        if(job.status==='running'&&job.type==='video'&&job.remoteTaskId&&!this.active.has(job.id)&&(!job.nextPollAt||job.nextPollAt<=Date.now())){
          this.active.add(job.id);
          void this.poll(job).finally(()=>this.active.delete(job.id));
        }
      }
      for(const job of [...all].reverse()){
        if(job.status!=='queued'||this.active.has(job.id))continue;
        const count=running.get(job.modelId)||0;
        if(count>=this.store.limit(job.modelId))continue;
        running.set(job.modelId,count+1);
        job.status='running';job.phase='submitting';job.attempts++;
        this.store.put(job);
        this.active.add(job.id);
        void this.run(job).finally(()=>this.active.delete(job.id));
      }
    }finally{this.busy=false;}
  }
  private resolve(job:MediaJob):Credentials {
    const config=this.credentials(job);
    if(!config?.apiKey || !config.baseUrl)throw new Error('模型供应商缺少 API Key 或 URL');
    return config;
  }
  private async run(job:MediaJob){
    let config:Credentials|undefined;
    try{
      config=this.resolve(job);
      if(job.type==='image'){
        const localMedia = async (url: string) => {
          const match = /^\/api\/files\/([^/?]+)/.exec(url);
          if (match) return this.fileMedia(decodeURIComponent(match[1]));
          return undefined;
        };
        const result=job.protocolKey==='gemini-generate-content'?await generateGeminiImages(job,config.apiKey,localMedia):await generateImages(job,config.apiKey,localMedia);
        job.resultFileIds=[];
        for (const [index, image] of result.images.entries()) {
          let bytes: Buffer;
          let mime: string;
          if (image.kind === 'b64') { bytes=image.data; mime=`image/${image.ext === 'jpeg' ? 'jpeg' : image.ext}`; }
          else {
            const response = await fetch(image.url, { signal: AbortSignal.timeout(180000) });
            if (!response.ok) throw new Error(`图片结果下载失败（HTTP ${response.status}）`);
            bytes = Buffer.from(await response.arrayBuffer());
            mime = response.headers.get('content-type')?.split(';')[0] || 'image/png';
          }
          const file = await this.store.saveFile(bytes, mime, `generated-${index}.${mime.split('/')[1] || 'bin'}`);
          job.resultFileIds.push(file.id);
        }
        job.status='completed';job.phase='completed';job.error=undefined;
        job.resultForm=result.images[0]?.kind==='url'?'url':'b64_json';
        job.providerResponse=result.provider as Record<string,unknown>;
      }else{
        const id=await submitVideo(job,config.apiKey,(url)=>{
          const match=/^\/api\/files\/([^/?]+)/.exec(url);
          return match?this.fileMedia(decodeURIComponent(match[1])):undefined;
        });
        job.remoteTaskId=id;job.phase='remote-running';job.nextPollAt=Date.now()+5000;
      }
    }catch(error){
      // Only an interrupted submission is genuinely unknown; a failed download is not.
      job.status=job.phase==='submitting'?'uncertain':'failed';
      job.error=(error instanceof Error?error.message:String(error)).slice(0,1200);
      job.phase='error';
      this.onFailure(job, job.error, config?.apiKey || '');
    }
    this.store.put(job);
    if (job.status === 'completed') this.completed(job);
  }
  private async poll(job:MediaJob){
    try{
      const {apiKey}=this.resolve(job);
      const result=await checkVideo(job,apiKey);
      if(result.state==='failed'){job.status='failed';job.error=result.error;this.onFailure(job,result.error||'远端任务失败',apiKey);}
      if(result.state==='completed'){
        if(!result.media)throw new Error('缺少视频内容');
        job.resultFileIds=[];
        const file = await this.store.saveFile(Buffer.from(result.media), 'video/mp4', `generated-${job.id}.mp4`);
        job.resultFileIds.push(file.id);
        job.status='completed';job.error=undefined;job.resultForm='url';
      }
      job.phase=job.status==='completed'?'completed':'remote-running';
      job.nextPollAt=job.status==='running'?Date.now()+5000:undefined;
    }catch(error){
      // A transient polling/download error never creates another paid video job.
      job.error=(error instanceof Error?error.message:String(error)).slice(0,600);
      job.nextPollAt=Date.now()+15000;
      this.onFailure(job, job.error, this.credentials(job)?.apiKey || '');
    }
    this.store.put(job);
    if (job.status === 'completed') this.completed(job);
  }
  private completed(job: MediaJob) {
    try { this.onCompleted(job); }
    catch (error) { job.error = `生成已完成，写回失败：${error instanceof Error ? error.message : '未知错误'}`; this.store.put(job); }
  }
  async media(job:MediaJob,index=0):Promise<{bytes:Buffer;mime:string}|undefined>{
    if(job.status!=='completed')return undefined;
    const fileId=job.resultFileIds?.[index];
    if(fileId){
      const result=await this.store.files.getBytes(fileId);
      return result ? {bytes:result.bytes,mime:result.file.mimeType} : undefined;
    }
    return undefined;
  }
  private async fileMedia(id:string) {
    const result = await this.store.files.getBytes(id);
    return result ? {bytes:result.bytes,mime:result.file.mimeType} : undefined;
  }
}
