import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { VideoCompare } from '@darl/ui';
import { ArrowLeft, RefreshCw } from 'lucide-react';
import './media-jobs.css';

type ModelId = 'gpt-image-2' | 'minimax-h3-flash';
type MediaJob = {
  id: string;
  modelId: ModelId;
  type: 'image' | 'video';
  status: string;
  prompt: string;
  error?: string;
  createdAt: string;
};
const statusLabels: Record<string, string> = {
  queued: '排队中', running: '生成中', completed: '已完成',
  failed: '失败', uncertain: '待人工核对', cancelled: '已取消',
};
const fileUrl = (id: string) => '/api/media-generation/jobs/' + encodeURIComponent(id) + '/file';

export function MediaJobsPage({ onBack }: { onBack: () => void }) {
  const [jobs, setJobs] = useState<MediaJob[]>([]);
  const [error, setError] = useState('');
  const [submitError, setSubmitError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const [modelId, setModelId] = useState<ModelId>('gpt-image-2');
  const [prompt, setPrompt] = useState('');
  const [imageSize, setImageSize] = useState('1024x1024');
  const [resolution, setResolution] = useState('768');
  const [aspectRatio, setAspectRatio] = useState('9:16');
  const [duration, setDuration] = useState(10);
  const [comparison, setComparison] = useState<string[]>([]);
  const [bestId, setBestId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch('/api/media-generation/jobs');
      const data: unknown = await response.json();
      if (!response.ok) throw new Error((data as { error?: string }).error || '读取生成任务失败');
      if (!Array.isArray(data)) throw new Error('生成任务响应格式错误');
      setJobs(data as MediaJob[]);
      setError('');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '无法读取生成任务');
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => { void load(); }, 3000);
    return () => window.clearInterval(timer);
  }, [load]);

  const completedVideos = jobs.filter((job) => job.type === 'video' && job.status === 'completed');
  const availableIds = new Set(completedVideos.map((job) => job.id));
  const selectedIds = comparison.filter((id) => availableIds.has(id)).slice(0, 3);
  const selectedVideos = selectedIds.flatMap((id) => {
    const job = completedVideos.find((candidate) => candidate.id === id);
    return job ? [{ id: job.id, name: job.prompt.length > 35 ? job.prompt.slice(0, 35) + '…' : job.prompt, src: fileUrl(job.id) }] : [];
  });
  const selectedBest = bestId && selectedIds.includes(bestId) ? bestId : null;

  const toggleCompare = (id: string) => {
    setComparison((current) => current.includes(id) ? current.filter((item) => item !== id)
      : current.length < 3 ? [...current, id] : current);
    if (bestId === id) setBestId(null);
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submittingRef.current || !prompt.trim()) return;
    submittingRef.current = true;
    setSubmitting(true);
    setSubmitError('');
    try {
      const options = modelId === 'gpt-image-2' ? { size: imageSize } : { resolution, aspectRatio, duration };
      // Direct page -> host API -> SQLite worker -> provider. No Agent chat/tool call.
      const response = await fetch('/api/media-generation/jobs', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ modelId, prompt: prompt.trim(), options }),
      });
      const result = await response.json() as { id?: string; error?: string };
      if (!response.ok || !result.id) throw new Error(result.error || '任务提交失败');
      setPrompt('');
      await load();
    } catch (reason) {
      setSubmitError(reason instanceof Error ? reason.message : '任务提交失败');
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  };

  return <main className="example-media-jobs">
    <header className="example-media-jobs-header">
      <button className="darl-button darl-button--outline darl-button-size--default" onClick={onBack}><ArrowLeft size={16} />返回</button>
      <h1>图片 / 视频生成</h1>
      <button className="darl-button darl-button--outline darl-button-size--default" onClick={() => void load()}><RefreshCw size={16} />刷新状态</button>
    </header>
    <p className="example-media-jobs-muted">点击生成后，页面直接向服务端提交任务，不经过 Agents。生成由 SQLite 队列执行；关闭浏览器不影响正在运行的 Node 服务。</p>
    <form className="example-media-jobs-form" onSubmit={(event) => void submit(event)}>
      <h2>新建生成任务</h2>
      <div className="example-media-jobs-fields">
        <label>生成类型
          <select value={modelId} onChange={(event) => setModelId(event.target.value as ModelId)}>
            <option value="gpt-image-2">图片 · GPT Image 2</option>
            <option value="minimax-h3-flash">视频 · MiniMax H3 Flash</option>
          </select>
        </label>
        {modelId === 'gpt-image-2' ? <label>图片尺寸
          <select value={imageSize} onChange={(event) => setImageSize(event.target.value)}>
            <option value="1024x1024">1024 × 1024</option>
            <option value="1536x1024">1536 × 1024</option>
            <option value="1024x1536">1024 × 1536</option>
          </select>
        </label> : <>
          <label>分辨率
            <select value={resolution} onChange={(event) => setResolution(event.target.value)}>
              <option value="768">768</option><option value="480">480</option>
            </select>
          </label>
          <label>画面比例
            <select value={aspectRatio} onChange={(event) => setAspectRatio(event.target.value)}>
              <option value="9:16">9:16 竖屏</option><option value="16:9">16:9 横屏</option>
            </select>
          </label>
          <label>时长（4–15 秒）
            <input type="number" min={4} max={15} step={1} value={duration} onChange={(event) => setDuration(Number(event.target.value))} required />
          </label>
        </>}
      </div>
      <label>生成提示词
        <textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} rows={3} maxLength={16000} required placeholder="输入图片或视频描述" />
      </label>
      <div className="example-media-jobs-actions">
        <span className="example-media-jobs-muted">目前支持基础文生图 / 文生视频；参考素材生成需完成实际网关验证后开放。</span>
        <button className="darl-button darl-button--default darl-button-size--default" type="submit" disabled={submitting || !prompt.trim() || (modelId === 'minimax-h3-flash' && (!Number.isInteger(duration) || duration < 4 || duration > 15))}>
          {submitting ? '正在提交…' : modelId === 'gpt-image-2' ? '生成图片' : '生成视频'}
        </button>
      </div>
      {submitError && <p role="alert" className="example-media-jobs-error">{submitError}</p>}
    </form>

    <section aria-label="生成任务记录">
      <h2>生成任务</h2>
      {error && <p role="alert" className="example-media-jobs-error">{error}</p>}
      {!jobs.length && !error && <p className="example-media-jobs-muted">暂无生成任务。</p>}
      <div className="example-media-jobs-list">
        {jobs.map((job) => <article key={job.id} className="example-media-jobs-card">
          <div className="example-media-jobs-card-head">
            <strong>{job.type === 'image' ? '图片' : '视频'} · {job.modelId}</strong>
            <span>{statusLabels[job.status] || job.status}</span>
          </div>
          <p className="example-media-jobs-prompt">{job.prompt}</p>
          <small className="example-media-jobs-muted">{job.id} · {new Date(job.createdAt).toLocaleString()}</small>
          {job.error && <p role="alert" className="example-media-jobs-error">{job.error}</p>}
          {job.status === 'completed' && <div className="example-media-jobs-result">
            {job.type === 'image' && <img src={fileUrl(job.id)} alt={job.prompt} loading="lazy" />}
            <a href={fileUrl(job.id)} target="_blank" rel="noreferrer">打开生成结果</a>
            {job.type === 'video' && <label className="example-media-jobs-compare-toggle">
              <input type="checkbox" checked={selectedIds.includes(job.id)} disabled={!selectedIds.includes(job.id) && selectedIds.length >= 3}
                onChange={() => toggleCompare(job.id)} />
              加入对比（最多 3 个）
            </label>}
          </div>}
        </article>)}
      </div>
    </section>

    {selectedVideos.length >= 2 && <section className="example-media-jobs-comparison" aria-label="生成视频对比">
      <div className="example-media-jobs-card-head">
        <h2>视频版本对比</h2>
        <button className="darl-button darl-button--outline darl-button-size--default" onClick={() => { setComparison([]); setBestId(null); }}>退出对比</button>
      </div>
      <VideoCompare videos={selectedVideos} bestVideoId={selectedBest} onBestChange={setBestId} onRemove={(id) => toggleCompare(id)} />
      <p className="example-media-jobs-muted">已复用站内 VideoCompare 同步播放器。此处的“最佳”只用于当前对比；待分镜 Shot / Take 数据层接入后再保存为镜头最终版本。</p>
    </section>}
  </main>;
}
