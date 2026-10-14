import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { Button } from '../ui/Button';
import { readableForeground } from '../../theme/DarlUIProvider';
import { MediaComposer } from './MediaComposer';
import { MediaResults } from './MediaResults';
import { filterReferences, normalizeOptions, referenceLimit, supportsFrames, type MediaInputMode } from './model';
import { useReferences } from './useReferences';
import type { GenerateRequest, MediaBatch, MediaModel, MediaResult, MediaWorkspaceProps } from './types';

export function MediaWorkspace({ models, tasks, activeTaskId, onTaskChange, onCreateTask, onRenameTask, onGenerate, onRetry, onCancel, onRegenerate, onFavoriteChange, accentColor, className = '' }: MediaWorkspaceProps) {
  const [localTaskId, setLocalTaskId] = useState(tasks[0]?.id);
  const activeId = activeTaskId ?? localTaskId;
  const task = tasks.find((item) => item.id === activeId) ?? (activeTaskId === undefined ? tasks[0] : undefined);
  const [preferredType, setPreferredType] = useState<MediaModel['type']>('image');
  const hasType = (type: MediaModel['type']) => models.some((item) => item.type === type);
  // Defaults to image output; falls back to whichever type the host actually provides.
  const mediaType: MediaModel['type'] = hasType(preferredType) ? preferredType : hasType('image') ? 'image' : 'video';
  const [modelId, setModelId] = useState(models[0]?.id);
  const typeModels = models.filter((item) => item.type === mediaType);
  const model = typeModels.find((item) => item.id === modelId) ?? typeModels[0];
  const [options, setOptions] = useState<GenerateRequest['options']>(() => model ? normalizeOptions(model) : { count: 1 });
  const [preferredInputMode, setInputMode] = useState<MediaInputMode>(() => supportsFrames(model) ? 'frames' : 'references');
  const inputMode = supportsFrames(model) && (preferredInputMode === 'frames' || !(['images', 'videos', 'audios'] as const).some((kind) => referenceLimit(model!, kind))) ? 'frames' : 'references';
  const [prompt, setPrompt] = useState('');
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const submitting = useRef(false);
  const mounted = useRef(true);
  const promptContainer = useRef<HTMLDivElement>(null);
  const [renaming, setRenaming] = useState(false);
  const [title, setTitle] = useState('');
  const draft = useReferences(setError);
  // Hosts can recreate model objects on every render without resetting user edits.
  const modelSignature = JSON.stringify(model);
  const previousModel = useRef(modelSignature);
  useEffect(() => {
    if (previousModel.current !== modelSignature && model) { setOptions(normalizeOptions(model)); setInputMode(supportsFrames(model) ? 'frames' : 'references'); }
    previousModel.current = modelSignature;
  }, [modelSignature]);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { setRenaming(false); setError(''); }, [task?.id]);
  const chooseModel = (id: string) => {
    const next = models.find((item) => item.id === id);
    if (!next || next.id === model?.id) return;
    previousModel.current = JSON.stringify(next);
    setPreferredType(next.type); setModelId(id); setOptions(normalizeOptions(next)); setInputMode(supportsFrames(next) ? 'frames' : 'references'); setError('');
  };
  const chooseType = (type: MediaModel['type']) => {
    if (type === mediaType) return;
    const next = models.find((item) => item.type === type);
    if (!next) return;
    previousModel.current = JSON.stringify(next);
    setPreferredType(type); setModelId(next.id); setOptions(normalizeOptions(next)); setInputMode(supportsFrames(next) ? 'frames' : 'references'); setError('');
  };
  const violations = model && inputMode === 'references' ? (['images', 'videos', 'audios'] as const).filter((kind) => referenceLimit(model, kind) > 0 && (draft.references[kind]?.length ?? 0) > referenceLimit(model, kind)).map((kind) => `${kind === 'images' ? '参考图片' : kind === 'videos' ? '参考视频' : '参考音频'}超过上限 ${referenceLimit(model, kind)}`) : [];
  const canGenerate = Boolean(model && task && prompt.trim() && !pending && !violations.length);
  const generate = async () => {
    if (!canGenerate || !model || !task || submitting.current) return;
    submitting.current = true; setPending(true); setError('');
    const references = filterReferences(model, draft.references, inputMode);
    try { await onGenerate({ taskId: task.id, modelId: model.id, prompt: prompt.trim(), options: normalizeOptions(model, options), ...(references ? { references } : {}) }); }
    catch (reason) { if (mounted.current) setError(reason instanceof Error ? reason.message : '提交失败，请重试'); }
    finally { submitting.current = false; if (mounted.current) setPending(false); }
  };
  const focusPrompt = () => promptContainer.current?.querySelector('textarea')?.focus();
  const reuse = (batch: MediaBatch) => {
    const next = models.find((item) => item.id === batch.modelId);
    if (!next) { setError('历史模型已不可用，请选择其他模型'); return; }
    previousModel.current = JSON.stringify(next);
    setPreferredType(next.type); setModelId(next.id); setOptions(normalizeOptions(next, batch.options)); setPrompt(batch.prompt); draft.restore(batch.references); setInputMode(batch.references?.firstFrame || batch.references?.lastFrame ? 'frames' : 'references'); setError(''); focusPrompt();
  };
  const reference = (result: MediaResult, type: MediaModel['type']) => {
    const kind = type === 'image' ? 'images' : 'videos';
    const accepts = (item: MediaModel) => referenceLimit(item, kind) > 0;
    const next = model && accepts(model) ? model : models.find(accepts);
    if (!next || !result.url) { setError('没有支持该参考素材的可用模型'); return; }
    if (next.id !== model?.id) { previousModel.current = JSON.stringify(next); setPreferredType(next.type); setModelId(next.id); setOptions(normalizeOptions(next)); }
    draft.addRemote(kind, { id: result.id, url: result.url });
    setInputMode('references'); setError(''); focusPrompt();
  };
  const style = accentColor ? { '--darl-primary': accentColor, '--darl-primary-foreground': readableForeground(accentColor) } as CSSProperties : undefined;
  return <section className={`darl-media-workspace ${className}`} style={style} aria-label="媒体生成工作台">
    <aside className="darl-mw-sidebar"><div className="darl-mw-brand"><span className="darl-mw-brand-mark">▧</span><div><strong>MediaWorkspace</strong><small>统一图片 / 视频创作</small></div></div><div className="darl-mw-task-heading"><span>创作任务</span>{onCreateTask && <Button variant="secondary" size="sm" onClick={onCreateTask}>＋ 新建任务</Button>}</div><nav className="darl-mw-task-list" aria-label="创作任务">{tasks.map((item) => {
      const thumbnail = item.batches.flatMap((batch) => batch.type === 'image' || models.find((m) => m.id === batch.modelId)?.type === 'image' ? batch.results : []).find((result) => result.status === 'completed' && result.url);
      return <Button key={item.id} variant="ghost" className="darl-mw-task" aria-current={item.id === task?.id ? 'page' : undefined} onClick={() => { if (activeTaskId === undefined) setLocalTaskId(item.id); onTaskChange?.(item.id); }}>{thumbnail ? <img src={thumbnail.url} alt=""/> : <span className="darl-mw-task-symbol">▧</span>}<span><strong>{item.title}</strong><small>{item.batches.length} 个批次 · 图片与视频</small></span></Button>;
    })}{!tasks.length && <p className="darl-mw-muted">暂无任务</p>}</nav><div className="darl-mw-sidebar-footer">同一任务，连续创作<br/>生成服务由宿主网站提供</div></aside>
    <div className="darl-mw-main"><header className="darl-mw-topbar"><span>创作工作台 <span>›</span> <strong>{task?.title ?? '未选择任务'}</strong></span><span className="darl-mw-muted">图片 / 视频</span></header><div className="darl-mw-scroll"><div className="darl-mw-content"><div className="darl-mw-title">{renaming && task && onRenameTask ? <form className="darl-mw-inline-rename" onSubmit={(event) => { event.preventDefault(); if (title.trim()) { onRenameTask(task.id, title.trim()); setRenaming(false); } }} onKeyDown={(event) => { if (event.key === 'Escape') { event.preventDefault(); setRenaming(false); setTitle(task.title); } }}><input aria-label="任务名称" autoFocus value={title} onChange={(event) => setTitle(event.target.value)} /><Button type="submit" size="sm" disabled={!title.trim()}>保存</Button><Button type="button" variant="ghost" size="sm" onClick={() => { setRenaming(false); setTitle(task.title); }}>取消</Button></form> : <><h2>{task?.title ?? '媒体创作'}</h2>{task && onRenameTask && <Button variant="outline" size="sm" onClick={() => { setTitle(task.title); setRenaming(true); }}>重命名</Button>}</>}</div><p className="darl-mw-subtitle">生成批次按顺序排列，可复用参数或收藏结果</p><MediaResults task={task} models={models} onReuse={reuse} onReference={reference} onRetry={onRetry} onCancel={onCancel} onRegenerate={onRegenerate} onFavoriteChange={onFavoriteChange}/></div></div>
      <div ref={promptContainer}><MediaComposer models={models} model={model} mediaType={mediaType} onMediaTypeChange={chooseType} options={options} onModelChange={chooseModel} onOptionsChange={setOptions} prompt={prompt} onPromptChange={setPrompt} draft={draft} inputMode={inputMode} onInputModeChange={(value) => { setInputMode(value); setError(''); }} error={violations.join('；') || error || (!models.length ? '暂无可用模型' : '')} onError={setError} pending={pending} canGenerate={canGenerate} onGenerate={() => { void generate(); }}/></div>
    </div>
  </section>;
}
