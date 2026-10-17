import { useEffect, useState } from 'react';
import { ArrowLeft, RefreshCcw } from 'lucide-react';
import './media-jobs.css';

interface Job {
  id: string; type: 'image' | 'video'; status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
  phase: string; modelId: string; prompt: string; remoteTaskId?: string | null; error?: string | null;
  createdAt: string; results: Array<{ index: number; url: string; mime: string }>;
}
interface Settings { submitConcurrency: number; pollConcurrency: number; pollSeconds: number }
const labels: Record<Job['status'], string> = {
  queued: '等待中', running: '生成中', completed: '已完成', failed: '失败', cancelled: '已取消',
};
const phaseLabel: Record<string, string> = {
  waiting: '队列等待', submitting: '提交到供应商', remote: '远端生成中',
  'download-retry': '等待重试下载', 'unknown-submission': '提交结果未知', failed: '失败', done: '完成',
};

async function readJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const value = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(value.error || '请求失败');
  return value;
}

export function MediaJobsPanel({ onBack }: { onBack: () => void }) {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [lastUpdated, setLastUpdated] = useState('');
  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const rows = await readJson<Job[]>('/api/media-jobs');
        if (alive) { setJobs(rows); setLastUpdated(new Date().toLocaleTimeString()); setError(''); }
      } catch (err) { if (alive) setError(err instanceof Error ? err.message : '刷新失败'); }
    };
    void load();
    void readJson<Settings>('/api/media-runtime-settings').then((value) => { if (alive) setSettings(value); }).catch(() => {});
    const id = window.setInterval(() => { if (!document.hidden) void load(); }, 5000);
    return () => { alive = false; clearInterval(id); };
  }, []);
  const save = async () => {
    if (!settings) return;
    setSaving(true); setError('');
    try {
      const result = await readJson<Settings>('/api/media-runtime-settings', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(settings),
      });
      setSettings(result);
    } catch (err) { setError(err instanceof Error ? err.message : '保存失败'); }
    finally { setSaving(false); }
  };
  const active = jobs.filter((job) => job.status === 'queued' || job.status === 'running').length;
  return <main className="media-jobs-page">
    <div className="media-jobs-heading">
      <div><button type="button" onClick={onBack} className="media-jobs-back"><ArrowLeft size={16}/>返回</button>
        <h1>生成任务</h1><p>{active} 个正在排队或生成 · 后台独立运行，刷新页面不会取消</p></div>
      <button type="button" onClick={() => void readJson<Job[]>('/api/media-jobs').then((value) => { setJobs(value); setLastUpdated(new Date().toLocaleTimeString()); }).catch((e) => setError(e.message))}>
        <RefreshCcw size={16}/>刷新状态
      </button>
    </div>
    {error && <p className="media-jobs-error" role="alert">{error}</p>}
    {settings && <details className="media-jobs-settings">
      <summary>队列设置（模型的独立最大并发在「模型管理 → 编辑绑定」中设置）</summary>
      <div className="media-jobs-config">
        {([['submitConcurrency', '本地同时提交数'], ['pollConcurrency', '视频同时查询数'], ['pollSeconds', '视频查询间隔（秒）']] as const).map(([key, name]) =>
          <label key={key}>{name}<input type="number" min={1} max={key === 'submitConcurrency' ? 10000 : key === 'pollConcurrency' ? 2000 : 300}
            value={settings[key]} onChange={(event) => setSettings((v) => v ? { ...v, [key]: Number(event.target.value) } : v)} /></label>)}
        <button type="button" disabled={saving} onClick={() => void save()}>{saving ? '保存中…' : '保存设置'}</button>
      </div>
    </details>}
    <div className="media-jobs-summary">最近 {jobs.length} 个任务{lastUpdated ? ' · 更新于 ' + lastUpdated : ''}</div>
    {jobs.length === 0 ? <div className="media-jobs-empty">暂无生成任务。向网站助手提出生图或视频生成请求，即可创建任务。</div> :
    <div className="media-jobs-list">{jobs.map((job) => <article key={job.id} className="media-jobs-card">
      <div className="media-jobs-card-header"><span>{job.type === 'image' ? '图片' : '视频'} · {job.modelId}</span><strong data-status={job.status}>{labels[job.status]}</strong></div>
      <p>{job.prompt}</p><small>任务 {job.id} · {phaseLabel[job.phase] || job.phase} · {new Date(job.createdAt).toLocaleString()}</small>
      {job.remoteTaskId && <small>远端任务：{job.remoteTaskId}</small>}
      {job.error && <p className="media-jobs-error">{job.error}</p>}
      {job.results.length > 0 && <div className="media-jobs-results">{job.results.map((item) =>
        <div key={item.index}>{job.type === 'video' ?
          <video controls preload="metadata" src={item.url} /> : <img loading="lazy" src={item.url} alt={job.prompt} />}
          <a href={item.url} download={'media-' + job.id + '-' + item.index}>下载结果 {item.index + 1}</a>
        </div>)}</div>}
    </article>)}</div>}
  </main>;
}
