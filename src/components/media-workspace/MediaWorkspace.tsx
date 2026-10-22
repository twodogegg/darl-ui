import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { Button } from '../ui/Button';
import { readableForeground } from '../../theme/DarlUIProvider';
import { MediaComposer } from './MediaComposer';
import { MediaResults } from './MediaResults';
import { ConfirmPopover } from './WorkspaceUI';
import { filterReferences, generationModes, normalizeOptions, referenceLimit, selectedGenerationMode, supportsFrames, type MediaInputMode } from './model';
import { useReferences } from './useReferences';
import type { GenerateRequest, MediaBatch, MediaGenerationMode, MediaModel, MediaResult, MediaWorkspaceProps, PromptOptimizationMode } from './types';

export function MediaWorkspace({ models, tasks, styles = [], onCreateStyle, onUpdateStyle, onOptimizePrompt, routingStrategy = 'selected-binding', activeTaskId, onTaskChange, onCreateTask, onRenameTask, onDeleteTask, onDeleteBatch, onGenerate, onUploadReference, renderReferencePicker, onRetry, onCancel, onRegenerate, onFavoriteChange, accentColor, className = '' }: MediaWorkspaceProps) {
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
  const [generationCount, setGenerationCount] = useState(1);
  const [preferredInputMode, setInputMode] = useState<MediaInputMode>(() => supportsFrames(model) ? 'frames' : 'references');
  const inputMode = supportsFrames(model) && (preferredInputMode === 'frames' || !(['images', 'videos', 'audios'] as const).some((kind) => referenceLimit(model!, kind))) ? 'frames' : 'references';
  const [generationMode, setGenerationMode] = useState<MediaGenerationMode | undefined>(() => model ? selectedGenerationMode(model, inputMode, {}) : undefined);
  const [styleId, setStyleId] = useState<string>();
  const selectedStyle = styles.find((style) => style.id === styleId);
  const [prompt, setPrompt] = useState('');
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const submitting = useRef(false);
  const optimization = useRef<AbortController | null>(null);
  const [optimizing, setOptimizing] = useState(false);
  const [optimizationResult, setOptimizationResult] = useState<{ before: string; after: string } | null>(null);
  const mounted = useRef(true);
  const promptContainer = useRef<HTMLDivElement>(null);
  const scrollContainer = useRef<HTMLDivElement>(null);
  const [scrollState, setScrollState] = useState<{ top: boolean; bottom: boolean }>({ top: false, bottom: false });
  const [renaming, setRenaming] = useState(false);
  const [title, setTitle] = useState('');
  const draft = useReferences(setError, onUploadReference);
  // Hosts can recreate model objects on every render without resetting user edits.
  const modelSignature = JSON.stringify(model);
  const previousModel = useRef(modelSignature);
  useEffect(() => { setOptimizationResult(null); }, [task?.id, modelSignature]);
  useEffect(() => {
    if (previousModel.current !== modelSignature && model) {
      const nextInputMode = supportsFrames(model) ? 'frames' : 'references';
      setOptions(normalizeOptions(model)); setInputMode(nextInputMode); setGenerationMode(selectedGenerationMode(model, nextInputMode, {}));
    }
    previousModel.current = modelSignature;
  }, [modelSignature]);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { setRenaming(false); setError(''); }, [task?.id]);
  useEffect(() => {
    const element = scrollContainer.current;
    if (!element) return;
    const update = () => setScrollState({ top: element.scrollTop > 24, bottom: element.scrollHeight - element.scrollTop - element.clientHeight > 24 });
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    element.querySelector('.darl-mw-content') && observer.observe(element.querySelector('.darl-mw-content')!);
    element.addEventListener('scroll', update, { passive: true });
    return () => { observer.disconnect(); element.removeEventListener('scroll', update); };
  }, [task?.id]);
  const scrollResults = (direction: 'top' | 'bottom') => {
    const element = scrollContainer.current;
    element?.scrollTo({ top: direction === 'top' ? 0 : element.scrollHeight, behavior: 'smooth' });
  };
  const chooseModel = (id: string) => {
    const next = models.find((item) => item.id === id);
    if (!next || next.id === model?.id) return;
    previousModel.current = JSON.stringify(next);
    const nextInputMode = supportsFrames(next) ? 'frames' : 'references';
    setPreferredType(next.type); setModelId(id); setOptions(normalizeOptions(next)); setInputMode(nextInputMode); setGenerationMode(selectedGenerationMode(next, nextInputMode, {})); setError('');
  };
  const chooseType = (type: MediaModel['type']) => {
    if (type === mediaType) return;
    const next = models.find((item) => item.type === type);
    if (!next) return;
    previousModel.current = JSON.stringify(next);
    const nextInputMode = supportsFrames(next) ? 'frames' : 'references';
    setPreferredType(type); setModelId(next.id); setOptions(normalizeOptions(next)); setInputMode(nextInputMode); setGenerationMode(selectedGenerationMode(next, nextInputMode, {})); setError('');
  };
  const violations = model && inputMode === 'references' ? (['images', 'videos', 'audios'] as const).filter((kind) => referenceLimit(model, kind) > 0 && (draft.references[kind]?.length ?? 0) > referenceLimit(model, kind)).map((kind) => `${kind === 'images' ? '参考图片' : kind === 'videos' ? '参考视频' : '参考音频'}超过上限 ${referenceLimit(model, kind)}`) : [];
  const optimizationKey = JSON.stringify([task?.id, model, prompt, options, generationCount, selectedStyle, generationMode, inputMode, draft.references, draft.ready], (_key, value) =>
    value instanceof File ? [value.name, value.type, value.size, value.lastModified] : value);
  const latestOptimizationKey = useRef(optimizationKey);
  latestOptimizationKey.current = optimizationKey;
  useEffect(() => {
    optimization.current?.abort(); optimization.current = null; setOptimizing(false);
    return () => { optimization.current?.abort(); };
  }, [optimizationKey]);
  const optimize = async (mode: PromptOptimizationMode) => {
    if (!onOptimizePrompt || !model || !prompt.trim() || pending || optimization.current) return;
    if (!draft.ready) { setError('请先完成参考素材上传，失败的素材请移除或重试'); return; }
    if (violations.length) { setError(violations.join('；')); return; }
    const controller = new AbortController();
    optimization.current = controller; setOptimizing(true); setError('');
    const references = filterReferences(model, draft.references, inputMode);
    try {
      const result = await onOptimizePrompt({
        optimization: mode, model, modelId: model.id, prompt: prompt.trim(), options: normalizeOptions(model, options), generationCount,
        mode: generationMode || selectedGenerationMode(model, inputMode, references || {}),
        ...(selectedStyle ? { style: selectedStyle } : {}), ...(references ? { references } : {}),
        ...(model.logicalModelId ? { logicalModelId: model.logicalModelId } : {}), ...(model.bindingId ? { bindingId: model.bindingId } : {}),
        ...(model.providerId ? { providerId: model.providerId } : {}), ...(model.upstreamModelId ? { upstreamModelId: model.upstreamModelId } : {}),
        ...(model.protocolKey ? { protocolKey: model.protocolKey } : {}),
      }, { signal: controller.signal });
      if (!controller.signal.aborted && latestOptimizationKey.current === optimizationKey) {
        if (!result.trim()) throw new Error('模型没有返回优化后的提示词');
        setOptimizationResult({ before: prompt, after: result.trim() });
        setPrompt(result.trim());
      }
    } catch (reason) {
      if (!controller.signal.aborted && latestOptimizationKey.current === optimizationKey) setError(reason instanceof Error ? reason.message : '提示词优化失败，请重试');
    } finally {
      if (optimization.current === controller) { optimization.current = null; setOptimizing(false); }
    }
  };
  const canGenerate = Boolean(model && task && prompt.trim() && !pending && !optimizing && draft.ready && !violations.length);
  const generate = async () => {
    if (!canGenerate || !model || !task || submitting.current) return;
    submitting.current = true; setPending(true); setError('');
    const references = filterReferences(model, draft.references, inputMode);
    const mode = generationMode && generationModes(model).includes(generationMode)
      ? generationMode
      : selectedGenerationMode(model, inputMode, references || {});
    const route = routingStrategy === 'auto'
      ? { strategy: 'auto' as const, ...(model.providerId ? { providerId: model.providerId } : {}) }
      : model.bindingId
        ? { strategy: 'selected-binding' as const, bindingId: model.bindingId, ...(model.providerId ? { providerId: model.providerId } : {}) }
        : undefined;
    try {
      await onGenerate({ taskId: task.id, modelId: model.id, ...(generationCount > 1 ? { generationCount } : {}), prompt: prompt.trim(), options: normalizeOptions(model, options), ...(selectedStyle ? { style: selectedStyle } : {}), ...(model.logicalModelId ? { logicalModelId: model.logicalModelId } : {}), ...(model.bindingId ? { bindingId: model.bindingId } : {}), ...(model.providerId ? { providerId: model.providerId } : {}), ...(model.upstreamModelId ? { upstreamModelId: model.upstreamModelId } : {}), ...(model.protocolKey ? { protocolKey: model.protocolKey } : {}), ...(route ? { route } : {}), ...(mode ? { mode } : {}), ...(references ? { references } : {}) });
      if (mounted.current) { setPrompt(''); setOptimizationResult(null); }
    }
    catch (reason) { if (mounted.current) setError(reason instanceof Error ? reason.message : '提交失败，请重试'); }
    finally { submitting.current = false; if (mounted.current) setPending(false); }
  };
  const focusPrompt = () => promptContainer.current?.querySelector('textarea')?.focus();
  const reuse = (batch: MediaBatch) => {
    const next = models.find((item) => item.id === batch.modelId);
    if (!next) { setError('历史模型已不可用，请选择其他模型'); return; }
    setOptimizationResult(null);
    previousModel.current = JSON.stringify(next);
    const nextInputMode = batch.references?.firstFrame || batch.references?.lastFrame ? 'frames' : 'references';
    setPreferredType(next.type); setModelId(next.id); setOptions(normalizeOptions(next, batch.options)); setPrompt(batch.prompt); draft.restore(batch.references); setInputMode(nextInputMode); setGenerationMode(batch.mode || selectedGenerationMode(next, nextInputMode, batch.references || {})); setStyleId(batch.style?.id); setError(''); focusPrompt();
  };
  const reference = (result: MediaResult, type: MediaModel['type']) => {
    const kind = type === 'image' ? 'images' : 'videos';
    const accepts = (item: MediaModel) => referenceLimit(item, kind) > 0;
    const next = model && accepts(model) ? model : models.find(accepts);
    if (!next || !result.url) { setError('没有支持该参考素材的可用模型'); return; }
    if (next.id !== model?.id) { previousModel.current = JSON.stringify(next); setPreferredType(next.type); setModelId(next.id); setOptions(normalizeOptions(next)); }
    // Reference the stable file ID; the result card id (`jobId-index`) is only a display key.
    draft.addRemote(kind, { id: result.fileId ?? result.id, url: result.url, ...(result.thumbnailUrl ? { thumbnailUrl: result.thumbnailUrl } : {}), ...(result.fileId ? { fileId: result.fileId } : {}) });
    setInputMode('references'); setGenerationMode(next.type === 'image' ? 'reference-edit' : 'reference'); setError(''); focusPrompt();
  };
  const style = accentColor ? { '--darl-primary': accentColor, '--darl-primary-foreground': readableForeground(accentColor) } as CSSProperties : undefined;
  return <section className={`darl-media-workspace ${className}`} style={style} aria-label="媒体生成工作台">
    <aside className="darl-mw-sidebar"><div className="darl-mw-brand"><span className="darl-mw-brand-mark">▧</span><div><strong>MediaWorkspace</strong><small>统一图片 / 视频创作</small></div></div><div className="darl-mw-task-heading"><span>创作任务</span>{onCreateTask && <Button variant="secondary" size="sm" onClick={onCreateTask}>＋ 新建任务</Button>}</div><nav className="darl-mw-task-list" aria-label="创作任务">{tasks.map((item) => {
      const thumbnail = item.batches.flatMap((batch) => batch.type === 'image' || models.find((m) => m.id === batch.modelId)?.type === 'image' ? batch.results : []).find((result) => result.status === 'completed' && (result.listThumbnailUrl || result.thumbnailUrl || result.url));
      return <div key={item.id} className="darl-mw-task-row"><Button variant="ghost" className="darl-mw-task" aria-current={item.id === task?.id ? 'page' : undefined} onClick={() => { if (activeTaskId === undefined) setLocalTaskId(item.id); onTaskChange?.(item.id); }}>{thumbnail ? <img src={thumbnail.listThumbnailUrl || thumbnail.thumbnailUrl || thumbnail.url} alt="" loading="lazy"/> : <span className="darl-mw-task-symbol">▧</span>}<span><strong>{item.title}</strong><small>{item.batches.length} 个批次 · 图片与视频</small></span></Button>{onDeleteTask && <ConfirmPopover label={`删除任务 ${item.title}`} message={`确定删除「${item.title}」及其全部生成结果？`} onConfirm={() => onDeleteTask(item.id)} trigger={<Button variant="ghost" size="icon" className="darl-mw-task-delete" aria-label={`删除任务 ${item.title}`}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3m-8 0 1 13h8l1-13M10 11v5m4-5v5"/></svg></Button>} />}</div>;
    })}{!tasks.length && <p className="darl-mw-muted">暂无任务</p>}</nav><div className="darl-mw-sidebar-footer">同一任务，连续创作<br/>生成服务由宿主网站提供</div></aside>
    <div className="darl-mw-main"><header className="darl-mw-topbar"><span>创作工作台 <span>›</span> <strong>{task?.title ?? '未选择任务'}</strong></span><span className="darl-mw-muted">图片 / 视频</span></header><div ref={scrollContainer} className="darl-mw-scroll">{scrollState.top && <div className="darl-mw-scroll-controls darl-mw-scroll-controls--top" aria-label="记录导航"><Button variant="ghost" size="icon" aria-label="滚动到顶部" title="滚动到顶部" onClick={() => scrollResults('top')}>↑</Button></div>}<div className="darl-mw-content"><div className="darl-mw-title">{renaming && task && onRenameTask ? <form className="darl-mw-inline-rename" onSubmit={(event) => { event.preventDefault(); if (title.trim()) { onRenameTask(task.id, title.trim()); setRenaming(false); } }} onKeyDown={(event) => { if (event.key === 'Escape') { event.preventDefault(); setRenaming(false); setTitle(task.title); } }}><input aria-label="任务名称" autoFocus value={title} onChange={(event) => setTitle(event.target.value)} /><Button type="submit" size="sm" disabled={!title.trim()}>保存</Button><Button type="button" variant="ghost" size="sm" onClick={() => { setRenaming(false); setTitle(task.title); }}>取消</Button></form> : <><h2>{task?.title ?? '媒体创作'}</h2>{task && onRenameTask && <Button variant="outline" size="sm" onClick={() => { setTitle(task.title); setRenaming(true); }}>重命名</Button>}</>}</div><p className="darl-mw-subtitle">按生成时间从早到晚排列，可复用参数或收藏结果</p><MediaResults task={task} models={models} onReuse={reuse} onReference={reference} onRetry={onRetry} onCancel={onCancel} onRegenerate={onRegenerate} onDeleteBatch={onDeleteBatch} onFavoriteChange={onFavoriteChange}/></div>{scrollState.bottom && <div className="darl-mw-scroll-controls darl-mw-scroll-controls--bottom" aria-label="记录导航"><Button variant="ghost" size="icon" aria-label="滚动到底部" title="滚动到底部" onClick={() => scrollResults('bottom')}>↓</Button></div>}</div>
      <div ref={promptContainer}><MediaComposer models={models} model={model} mediaType={mediaType} onMediaTypeChange={chooseType} options={options} generationCount={generationCount} onGenerationCountChange={setGenerationCount} onModelChange={chooseModel} onOptionsChange={setOptions} prompt={prompt} onPromptChange={setPrompt} draft={draft} inputMode={inputMode} onInputModeChange={(value) => { setInputMode(value); setGenerationMode(selectedGenerationMode(model, value, draft.references) || generationMode); setError(''); }} generationMode={generationMode} onGenerationModeChange={(value) => { setGenerationMode(value); setInputMode(value === 'first-last-frame' ? 'frames' : 'references'); setError(''); }} styles={styles} styleId={styleId} onStyleChange={setStyleId} onCreateStyle={onCreateStyle} renderReferencePicker={renderReferencePicker} onUpdateStyle={onUpdateStyle} onOptimizePrompt={onOptimizePrompt ? (mode) => { void optimize(mode); } : undefined} optimizing={optimizing} onCancelOptimization={() => { optimization.current?.abort(); optimization.current = null; setOptimizing(false); }} optimizationResult={optimizationResult} onRestoreOptimization={() => { if (optimizationResult) { setPrompt(optimizationResult.before); setOptimizationResult(null); setError(''); focusPrompt(); } }} error={violations.join('；') || error || (!models.length ? '暂无可用模型' : '')} onError={setError} pending={pending} canGenerate={canGenerate} onGenerate={() => { void generate(); }}/></div>

    </div>
  </section>;
}
