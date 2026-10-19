import { useCallback, useEffect, useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import { MediaWorkspace, toMediaModels, type GenerateRequest, type MediaModel, type MediaTask, type ModelConfiguration } from '@darl/ui';
import { Button } from '../../../src/components/ui/Button';
import { jobToBatch, jobToTask, type MediaJob } from './media-job-view';

async function request<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(`/api/${path}`, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {});
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof data.error === 'string' ? data.error : data.error?.message || `请求失败：HTTP ${response.status}`);
  return data as T;
}

function newTask(): MediaTask {
  return { id: crypto.randomUUID(), title: '新任务', batches: [] };
}

function readFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error(`读取 ${file.name} 失败`));
    reader.onerror = () => reject(new Error(`读取 ${file.name} 失败`));
    reader.readAsDataURL(file);
  });
}

/** The H3 adapter is still text-to-video only; do not offer unverified reference modes. */
function supportedModels(configuration: ModelConfiguration): MediaModel[] {
  return toMediaModels(configuration).map((model) => model.type === 'video'
    ? { ...model, capabilities: { ...model.capabilities, images: 0, videos: 0, audios: 0, generationModes: ['text-to-video'], firstLastFrame: false } }
    : model);
}

async function referenceImages(references: GenerateRequest['references']): Promise<string[]> {
  const inputs = references?.images || [];
  return Promise.all(inputs.map(async (input) => {
    if (!(input instanceof File)) return input.url;
    if (!input.type.startsWith('image/')) throw new Error('参考素材只支持图片');
    if (input.size > 50 * 1024 * 1024) throw new Error(`${input.name} 超过 50MB`);
    return readFile(input);
  }));
}

export function MediaGenerationPage({ onBack }: { onBack: () => void }) {
  const [models, setModels] = useState<MediaModel[]>([]);
  const [tasks, setTasks] = useState<MediaTask[]>([]);
  const [activeTaskId, setActiveTaskId] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const mergeJobs = useCallback((jobs: MediaJob[]) => {
    setTasks((current) => {
      const batches = new Map(jobs.map((job) => [job.id, jobToBatch(job)]));
      const next = current.map((task) => ({
        ...task,
        batches: task.batches.map((batch) => {
          const updated = batches.get(batch.id);
          if (!updated) return batch;
          const favorites = new Set(batch.results.filter((result) => result.favorited).map((result) => result.id));
          return {
            ...updated,
            ...(batch.references ? { references: batch.references } : {}),
            results: updated.results.map((result) => favorites.has(result.id) ? { ...result, favorited: true } : result),
          };
        }),
      }));
      const known = new Set(next.flatMap((task) => task.batches.map((batch) => batch.id)));
      return [...jobs.filter((job) => !known.has(job.id)).map(jobToTask), ...next];
    });
  }, []);

  useEffect(() => {
    let alive = true;
    const bootstrap = async () => {
      try {
        const [configuration, jobs] = await Promise.all([request<ModelConfiguration>('model-config'), request<MediaJob[]>('media-generation/jobs')]);
        if (!alive) return;
        setModels(supportedModels(configuration));
        const loaded = jobs.map(jobToTask);
        const draft = newTask();
        setTasks(loaded.length ? loaded : [draft]);
        setActiveTaskId(loaded[0]?.id || draft.id);
      } catch (reason) {
        if (alive) setError(reason instanceof Error ? reason.message : '无法读取模型或任务');
      } finally {
        if (alive) setLoading(false);
      }
    };
    void bootstrap();
    const timer = setInterval(() => {
      request<MediaJob[]>('media-generation/jobs').then((jobs) => { if (alive) mergeJobs(jobs); }).catch(() => {});
    }, 2500);
    return () => { alive = false; clearInterval(timer); };
  }, [mergeJobs]);

  const createTask = () => {
    const task = newTask();
    setTasks((current) => [task, ...current]);
    setActiveTaskId(task.id);
  };

  const submit = async (taskId: string, payload: { modelId: string; prompt: string; options: GenerateRequest['options']; references?: GenerateRequest['references'] }) => {
    const references = await referenceImages(payload.references);
    const job = await request<MediaJob>('media-generation/jobs', {
      modelId: payload.modelId,
      prompt: payload.prompt,
      options: { ...payload.options, ...(references.length ? { references } : {}) },
    });
    const batch = { ...jobToBatch(job), ...(payload.references ? { references: payload.references } : {}) };
    setTasks((current) => {
      const exists = current.some((task) => task.id === taskId);
      if (!exists) return [{ id: taskId, title: payload.prompt.slice(0, 24) || '媒体任务', batches: [batch] }, ...current];
      return current.map((task) => task.id === taskId
        ? { ...task, title: task.title === '新任务' ? payload.prompt.slice(0, 24) || task.title : task.title, batches: [...task.batches, batch] }
        : task);
    });
    return job;
  };

  const generate = async (request_: GenerateRequest) => {
    setError('');
    try {
      await submit(request_.taskId, { modelId: request_.modelId, prompt: request_.prompt, options: request_.options, ...(request_.references ? { references: request_.references } : {}) });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '提交生成任务失败');
      throw reason;
    }
  };

  const retry = async (batchId: string) => {
    const owner = tasks.find((task) => task.batches.some((batch) => batch.id === batchId));
    const batch = owner?.batches.find((item) => item.id === batchId);
    if (!owner || !batch) return;
    setError('');
    try {
      await submit(owner.id, { modelId: batch.modelId, prompt: batch.prompt, options: batch.options, ...(batch.references ? { references: batch.references } : {}) });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '重新生成失败');
    }
  };

  const favorite = (_batchId: string, resultId: string, favorited: boolean) => {
    setTasks((current) => current.map((task) => ({
      ...task,
      batches: task.batches.map((batch) => ({ ...batch, results: batch.results.map((result) => result.id === resultId ? { ...result, favorited } : result) })),
    })));
  };

  return <main className="example-media-generation">
    <header className="example-media-generation-head">
      <Button variant="outline" size="sm" onClick={onBack}><ArrowLeft size={15} />返回</Button>
      <div><span className="example-eyebrow">MEDIA WORKSPACE</span><h1>媒体生成</h1><p>选择已配置的图片或视频模型，提交真实生成任务并查看结果。</p></div>
    </header>
    {error && <p className="example-media-generation-error" role="alert">{error}</p>}
    {loading ? <p className="example-media-generation-loading">正在读取模型与任务…</p> : <MediaWorkspace
      models={models}
      tasks={tasks}
      activeTaskId={activeTaskId}
      onTaskChange={setActiveTaskId}
      onCreateTask={createTask}
      onRenameTask={(taskId, title) => setTasks((current) => current.map((task) => task.id === taskId ? { ...task, title } : task))}
      onGenerate={generate}
      onRetry={(batchId) => { void retry(batchId); }}
      onRegenerate={(batchId) => { void retry(batchId); }}
      onFavoriteChange={favorite}
    />}
  </main>;
}
