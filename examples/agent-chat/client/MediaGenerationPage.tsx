import { useCallback, useEffect, useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import { MediaWorkspace, toMediaModels, type GenerateRequest, type MediaInput, type MediaModel, type MediaStyleOption, type MediaTask, type ModelConfiguration, type StyleCreateRequest } from '@darl/ui';
import { Button } from '../../../src/components/ui/Button';
import { jobGroups, jobToBatch, jobsToBatchId, jobsToTasks, type MediaJob } from './media-job-view';
import { styleOptionsFromCatalog, type StyleCatalog } from './workspace-styles';
import type { UploadContext } from '../../../src/components/file-uploader/types';

async function request<T>(path: string, body?: unknown, method?: string): Promise<T> {
  const init: RequestInit = body instanceof FormData
    ? { method: 'POST', body }
    : body
      ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
      : method ? { method } : {};
  const response = await fetch(`/api/${path}`, init);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof data.error === 'string' ? data.error : data.error?.message || `请求失败：HTTP ${response.status}`);
  return data as T;
}

async function styleForm(input: StyleCreateRequest): Promise<FormData> {
  const data = new FormData();
  data.set('name', input.name);
  data.set('prompt', input.description);
  if (input.referenceImage) data.set('reference_image', input.referenceImage);
  return data;
}

function newTask(): MediaTask {
  return { id: crypto.randomUUID(), title: '新任务', batches: [] };
}

/** H3 accepts image references; video/audio references and first/last frames are not enabled yet. */
function supportedModels(configuration: ModelConfiguration): MediaModel[] {
  return toMediaModels(configuration).map((model) => model.type === 'video'
    ? { ...model, capabilities: { ...model.capabilities, images: Math.min(model.capabilities.images ?? 0, 9), videos: 0, audios: 0, generationModes: ['text-to-video', 'reference'], firstLastFrame: false } }
    : model);
}

export function MediaGenerationPage({ onBack, initialTaskId }: { onBack: () => void; initialTaskId?: string }) {
  const [models, setModels] = useState<MediaModel[]>([]);
  const [styles, setStyles] = useState<MediaStyleOption[]>([]);
  const [tasks, setTasks] = useState<MediaTask[]>([]);
  const [activeTaskId, setActiveTaskId] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const loadStyles = useCallback(async () => {
    const catalog = await request<{ data: StyleCatalog }>('workspace/styles');
    const next = styleOptionsFromCatalog(catalog.data || {});
    setStyles(next);
    return next;
  }, []);

  const createStyle = async (input: StyleCreateRequest) => {
    await request<{ data: { id: number } }>('workspace/styles', await styleForm(input));
    await loadStyles();
  };

  const mergeJobs = useCallback((jobs: MediaJob[]) => {
    setTasks((current) => {
      const groups = jobGroups(jobs);
      const batches = new Map(groups.map((group) => [jobsToBatchId(group), jobToBatch(group[0], group)]));
      const next = current.map((task) => {
        const taskBatches = new Map(groups.filter((group) => (group[0].taskId || group[0].id) === task.id).map((group) => [jobsToBatchId(group), jobToBatch(group[0], group)]));
        const currentBatches = task.batches.map((batch) => {
          const updated = batches.get(batch.id);
          if (!updated) return batch;
          const favorites = new Set(batch.results.filter((result) => result.favorited).map((result) => result.id));
          return { ...updated, ...(batch.references ? { references: batch.references } : {}), results: updated.results.map((result) => favorites.has(result.id) ? { ...result, favorited: true } : result) };
        });
        const known = new Set(currentBatches.map((batch) => batch.id));
        return { ...task, batches: [...currentBatches, ...[...taskBatches].filter(([id]) => !known.has(id)).map(([, batch]) => batch)] };
      });
      const newTasks = jobsToTasks(jobs.filter((job) => !current.some((task) => task.id === (job.taskId || job.id))));
      return [...next, ...newTasks];
    });
  }, []);

  useEffect(() => {
    let alive = true;
    const bootstrap = async () => {
      try {
        const [configuration, jobs, styleCatalog] = await Promise.all([
          request<ModelConfiguration>('model-config'),
          request<MediaJob[]>('media-generation/jobs'),
          request<{ data: StyleCatalog }>('workspace/styles'),
        ]);
        if (!alive) return;
        setModels(supportedModels(configuration));
        setStyles(styleOptionsFromCatalog(styleCatalog.data || {}));
        const loaded = jobsToTasks(jobs);
        const draft = newTask();
        setTasks(loaded.length ? loaded : [draft]);
        setActiveTaskId(loaded.find(task => task.id === initialTaskId)?.id || loaded[0]?.id || draft.id);
        if (initialTaskId && !loaded.some(task => task.id === initialTaskId)) setError('关联媒体任务已删除');
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
  }, [mergeJobs, initialTaskId]);

  const createTask = () => {
    const task = newTask();
    setTasks((current) => [task, ...current]);
    setActiveTaskId(task.id);
  };

  const deleteTask = async (taskId: string) => {
    const task = tasks.find((item) => item.id === taskId);
    if (!task) return;
    setError('');
    try {
      await request(`media-generation/tasks/${encodeURIComponent(taskId)}`, undefined, 'DELETE');
      const remaining = tasks.filter((item) => item.id !== taskId);
      const next = remaining.length ? remaining : [newTask()];
      setTasks(next);
      if (activeTaskId === taskId) setActiveTaskId(next[0].id);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '删除任务失败');
    }
  };

  const deleteBatch = async (batchId: string) => {
    setError('');
    try {
      await request(`media-generation/jobs/${encodeURIComponent(batchId)}`, undefined, 'DELETE');
      setTasks((current) => current.map((task) => ({ ...task, batches: task.batches.filter((batch) => batch.id !== batchId) })));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '删除生成批次失败');
    }
  };

  const uploadReference = (file: File, context: UploadContext) => new Promise<MediaInput>((resolve, reject) => {
    if (file.size > 50 * 1024 * 1024) { reject(new Error(`${file.name} 超过 50MB`)); return; }
    const request = new XMLHttpRequest();
    request.open('POST', '/api/files');
    request.responseType = 'json';
    request.upload.onprogress = (event) => { if (event.lengthComputable) context.onProgress(Math.round(event.loaded / event.total * 100)); };
    request.onerror = () => reject(new Error(`${file.name} 上传失败`));
    request.onabort = () => reject(new DOMException('上传已取消', 'AbortError'));
    request.onload = () => {
      const payload = request.response as { fileId?: string; url?: string; thumbnailUrl?: string; error?: string } | null;
      if (request.status < 200 || request.status >= 300 || !payload?.fileId) { reject(new Error(payload?.error || `${file.name} 上传失败（HTTP ${request.status}）`)); return; }
      resolve({ id: payload.fileId, fileId: payload.fileId, url: payload.url || `/api/files/${payload.fileId}`, ...(payload.thumbnailUrl ? { thumbnailUrl: payload.thumbnailUrl } : {}) });
    };
    context.signal.addEventListener('abort', () => request.abort(), { once: true });
    const form = new FormData();
    form.set('file', file);
    request.send(form);
  });

  const submit = async (taskId: string, payload: { modelId: string; prompt: string; options: GenerateRequest['options']; references?: GenerateRequest['references']; style?: GenerateRequest['style'] }) => {
    const job = await request<MediaJob>('media-generation/jobs', {
      modelId: payload.modelId,
      taskId,
      prompt: payload.prompt,
      options: { ...payload.options, ...(payload.references ? { references: payload.references.images?.map((input) => input instanceof File ? input : { ...(input.fileId ? { fileId: input.fileId } : {}), url: input.url }) } : {}) },
      ...(payload.style ? { style: payload.style } : {}),
    });
    return job;
  };

  const generate = async (request_: GenerateRequest) => {
    setError('');
    try {
      const count = Math.max(1, Math.min(4, Math.floor(request_.generationCount ?? 1)));
      const batchId = crypto.randomUUID();
      const requests = Array.from({ length: count }, () => ({ batchId, modelId: request_.modelId, prompt: request_.prompt, options: request_.options, ...(request_.references ? { references: request_.references } : {}), ...(request_.style ? { style: request_.style } : {}) }));
      const created = await Promise.all(requests.map((payload) => request<MediaJob>('media-generation/jobs', { ...payload, taskId: request_.taskId })));
      const batch = { ...jobToBatch(created[0], created), ...(request_.references ? { references: request_.references } : {}), ...(request_.style ? { style: request_.style } : {}) };
      setTasks((current) => {
        const exists = current.some((task) => task.id === request_.taskId);
        if (!exists) return [{ id: request_.taskId, title: request_.prompt.slice(0, 24) || '媒体任务', batches: [batch] }, ...current];
        return current.map((task) => task.id === request_.taskId
          ? { ...task, title: task.title === '新任务' ? request_.prompt.slice(0, 24) || task.title : task.title, batches: [...task.batches, batch] }
          : task);
      });
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
      await submit(owner.id, { modelId: batch.modelId, prompt: batch.prompt, options: batch.options, ...(batch.references ? { references: batch.references } : {}), ...(batch.style ? { style: batch.style } : {}) });
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
      styles={styles}
      tasks={tasks}
      activeTaskId={activeTaskId}
      onTaskChange={setActiveTaskId}
      onCreateTask={createTask}
      onRenameTask={(taskId, title) => setTasks((current) => current.map((task) => task.id === taskId ? { ...task, title } : task))}
      onDeleteTask={deleteTask}
      onDeleteBatch={deleteBatch}
      onGenerate={generate}
      onUploadReference={uploadReference}
      onCreateStyle={createStyle}
      onRetry={(batchId) => { void retry(batchId); }}
      onRegenerate={(batchId) => { void retry(batchId); }}
      onFavoriteChange={favorite}
    />}
  </main>;
}
