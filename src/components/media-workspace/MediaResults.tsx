import { useEffect, useState } from 'react';
import { Button } from '../ui/Button';
import { Alert, Badge, Empty, Modal } from './WorkspaceUI';
import { VideoCompare, type CompareMedia } from '../video-compare/VideoCompare';
import type { MediaBatch, MediaInput, MediaModel, MediaReferences, MediaResult, MediaTask, MediaWorkspaceProps } from './types';

const statusLabels = { queued: '等待生成', running: '生成中', completed: '生成完成', failed: '生成失败', cancelled: '已取消' };
function BatchReferences({ references }: { references?: MediaReferences }) {
  const items = [
    ...(references?.images ?? []).map((input) => ({ kind: 'image' as const, label: '参考图片', input })),
    ...(references?.videos ?? []).map((input) => ({ kind: 'video' as const, label: '参考视频', input })),
    ...(references?.audios ?? []).map((input) => ({ kind: 'audio' as const, label: '参考音频', input })),
    ...(references?.firstFrame ? [{ kind: 'image' as const, label: '首帧', input: references.firstFrame }] : []),
    ...(references?.lastFrame ? [{ kind: 'image' as const, label: '尾帧', input: references.lastFrame }] : []),
  ];
  if (!items.length) return null;
  const source = (input: MediaInput) => input instanceof File ? undefined : input.thumbnailUrl || input.url;
  return <div className="darl-mw-batch-references" aria-label="本次生成使用的参考素材">{items.slice(0, 4).map(({ kind, label, input }, index) => {
    const thumbnail = kind === 'image' ? source(input) : undefined;
    const name = `${label} ${index + 1}`;
    return <span key={`${kind}-${index}`} className="darl-mw-batch-ref" title={name}>{thumbnail ? <img src={thumbnail} alt={name} loading="lazy"/> : <span aria-hidden="true">{kind === 'video' ? '视频' : kind === 'audio' ? '音频' : '图片'}</span>}</span>;
  })}{items.length > 4 && <span className="darl-mw-batch-ref-more">+{items.length - 4}</span>}</div>;
}
function ResultMedia({ type, result, prompt, onPreview, full = false }: { type: 'image' | 'video'; result: MediaResult; prompt: string; onPreview?: () => void; full?: boolean }) {
  const [failed, setFailed] = useState(false);
  const [play, setPlay] = useState(false);
  useEffect(() => { setFailed(false); setPlay(false); }, [result.url]);
  if (failed) return <Alert>媒体加载失败，请检查结果地址</Alert>;
  if (type === 'video' && !full) return play
    ? <video src={result.url} controls playsInline preload="metadata" onError={() => setFailed(true)} aria-label={`生成视频：${prompt}`}/>
    : <button type="button" className="darl-mw-video-trigger" onClick={() => setPlay(true)} aria-label={`播放视频 ${result.id}`}><span aria-hidden="true">▶</span><small>点击播放</small></button>;
  if (type === 'video') return <video src={result.url} controls playsInline preload="metadata" onError={() => setFailed(true)} aria-label={`生成视频：${prompt}`}/>;
  const image = <img src={full ? result.previewUrl || result.url : result.thumbnailUrl || result.url} alt={prompt} loading={full ? undefined : 'lazy'} onError={() => setFailed(true)}/>;
  return onPreview ? <button type="button" className="darl-mw-preview-trigger" onClick={onPreview} aria-label={`预览图片 ${result.id}`}>{image}</button> : image;
}
export function MediaResults({ task, models, onReuse, onReference, onRetry, onCancel, onRegenerate, onDeleteBatch, onFavoriteChange }: {
  task?: MediaTask; models: MediaModel[]; onReuse: (batch: MediaBatch) => void;
  onReference: (result: MediaResult, type: 'image' | 'video') => void;
} & Pick<MediaWorkspaceProps, 'onRetry' | 'onCancel' | 'onRegenerate' | 'onDeleteBatch' | 'onFavoriteChange'>) {
  const [preview, setPreview] = useState<{ result: MediaResult; prompt: string; type: 'image' | 'video' } | null>(null);
  const [compareItems, setCompareItems] = useState<CompareMedia[]>([]);
  const [compareOpen, setCompareOpen] = useState(false);
  const [bestResultId, setBestResultId] = useState<string | null>(null);
  useEffect(() => setPreview(null), [task?.id]);
  useEffect(() => { setCompareItems([]); setCompareOpen(false); setBestResultId(null); }, [task?.id]);
  if (!task?.batches.length) return <Empty title={task ? '开始你的第一批创作' : '创建一个创作任务'}>填写提示词，选择模型，生成图片或视频。</Empty>;
  const batches = task.batches.every((batch) => batch.createdAt && Number.isFinite(Date.parse(batch.createdAt)))
    ? [...task.batches].sort((a, b) => Date.parse(a.createdAt!) - Date.parse(b.createdAt!))
    : task.batches;
  const toggleCompare = (item: CompareMedia) => {
    const selected = compareItems.some((entry) => entry.id === item.id);
    if (!selected && compareItems.length >= 1 && compareItems.length < 3) setCompareOpen(true);
    setCompareItems((current) => {
      if (current.some((entry) => entry.id === item.id)) return current.filter((entry) => entry.id !== item.id);
      return current.length < 3 ? [...current, item] : current;
    });
  };
  return <><div className="darl-mw-collection"><span>{task.batches.length} 个生成批次</span></div>{compareItems.length > 0 && <div className="darl-mw-compare-summary"><span>已选 {compareItems.length} 个对比素材{compareItems.length < 2 ? '，再选择 1 个即可打开对比' : ''}</span><Button size="sm" variant="outline" disabled={compareItems.length < 2} onClick={() => setCompareOpen(true)}>打开对比</Button><Button size="sm" variant="ghost" onClick={() => setCompareItems([])}>清空</Button></div>}{batches.map((batch, index) => {
    const model = models.find((item) => item.id === batch.modelId);
    const type = batch.type ?? model?.type;
    return <section key={batch.id} className="darl-mw-batch" aria-label={`批次 ${index + 1}`}><div className="darl-mw-batch-header"><div><h3 title={batch.prompt}>{batch.prompt}</h3><div className="darl-mw-batch-meta"><Badge>{model?.name ?? batch.modelId}</Badge>{type && <Badge>{type === 'image' ? '图片' : '视频'}</Badge>}{batch.options.aspectRatio && <Badge>{batch.options.aspectRatio}</Badge>}{batch.options.resolution && <Badge>{batch.options.resolution}</Badge>}{batch.options.duration !== undefined && <Badge>{batch.options.duration}秒</Badge>}{batch.options.generateAudio !== undefined && <Badge>{batch.options.generateAudio ? '有声' : '无声'}</Badge>}</div><BatchReferences references={batch.references}/></div><div className="darl-mw-batch-actions"><Button size="sm" variant="outline" onClick={() => onReuse(batch)}>复用参数</Button>{onDeleteBatch && <Button size="sm" variant="ghost" onClick={() => { if (window.confirm('确定永久删除这一生成批次及其结果文件？')) void onDeleteBatch(batch.id); }}>删除批次</Button>}</div></div>
      <div className="darl-mw-result-grid">{batch.results.map((result, resultIndex) => { const compareId = `${batch.id}:${result.id}`; const isBest = bestResultId === compareId; return <article key={result.id} className={`darl-mw-result ${isBest ? 'darl-mw-result--best' : ''}`} aria-label={`结果 ${resultIndex + 1}：${statusLabels[result.status]}${isBest ? '，最佳' : ''}`}>
        <div className="darl-mw-media" style={/^\d+(?:\.\d+)?:\d+(?:\.\d+)?$/.test(batch.options.aspectRatio ?? '') ? { aspectRatio: batch.options.aspectRatio!.replace(':', '/') } : undefined} data-status={result.status}>
          {result.status === 'completed' && result.url && type ? <ResultMedia type={type} result={result} prompt={batch.prompt} onPreview={() => setPreview({ result, prompt: batch.prompt, type })}/> : <>
            {(result.status === 'queued' || result.status === 'running') && <div className="darl-mw-skeleton" aria-hidden="true"/>}<span>{statusLabels[result.status]}</span>
            {result.status === 'failed' && <p>{result.error ?? '请重试'}</p>}
            {result.status === 'completed' && (!result.url || !type) && <p>{!result.url ? '结果地址不可用' : '请为历史批次配置输出类型'}</p>}
            {result.status === 'failed' && onRetry && <Button size="sm" variant="outline" onClick={() => onRetry(batch.id, result.id)}>重试</Button>}
            {(result.status === 'queued' || result.status === 'running') && onCancel && <Button size="sm" variant="ghost" onClick={() => onCancel(batch.id, result.id)}>取消</Button>}
          </>}
        </div>
        <div className="darl-mw-result-actions">{isBest && <span className="darl-mw-best-badge">✓ 最佳</span>}{result.status === 'completed' && result.url && <>
          {onRegenerate && <Button variant="ghost" size="icon" title="重新生成这一张" aria-label={`重新生成结果 ${result.id}`} onClick={() => onRegenerate(batch.id, result.id)}><svg data-icon="inline-start" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7"/></svg></Button>}
          {type && <Button variant="ghost" size="sm" onClick={() => onReference(result, type)}>用作参考</Button>}
          {type && <Button variant="ghost" size="sm" aria-pressed={compareItems.some((item) => item.id === compareId)} disabled={!compareItems.some((item) => item.id === compareId) && compareItems.length >= 3} title={!compareItems.some((item) => item.id === compareId) && compareItems.length >= 3 ? '最多同时对比 3 个素材' : undefined} onClick={() => toggleCompare({ id: compareId, name: `${type === 'image' ? '图片' : '视频'} ${resultIndex + 1}`, type, src: result.url!, ...(result.thumbnailUrl ? { poster: result.thumbnailUrl } : {}) })}>{compareItems.some((item) => item.id === compareId) ? '移出对比' : '加入对比'}</Button>}
          <a href={result.url} download={`media-${result.id}`} target="_blank" rel="noreferrer" aria-label={`下载结果 ${result.id}`}>下载</a>
          {onFavoriteChange && <Button className="darl-mw-favorite" variant="ghost" size="icon" title={result.favorited ? '取消收藏' : '收藏'} aria-label={`${result.favorited ? '取消收藏' : '收藏'}结果 ${result.id}`} aria-pressed={result.favorited ?? false} onClick={() => onFavoriteChange(batch.id, result.id, !result.favorited)}><svg data-icon="inline-start" width="15" height="15" viewBox="0 0 24 24" fill={result.favorited ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="M20.8 4.8c-2.7-2.7-6.2-1-8.8 1.6C9.4 3.8 5.9 2.1 3.2 4.8c-2.7 2.7-1.6 6 .5 8.4L12 21l8.3-7.8c2.1-2.4 3.2-5.7.5-8.4Z"/></svg></Button>}
        </>}</div>
      </article>; })}</div>
      {!batch.results.length && <Empty title="暂无结果">宿主更新任务后会显示生成状态。</Empty>}
    </section>;
  })}<Modal title="结果预览" open={Boolean(preview)} onOpenChange={(open) => { if (!open) setPreview(null); }}>{preview && <><div className="darl-mw-preview"><ResultMedia type={preview.type} result={preview.result} prompt={preview.prompt} full/></div><p className="darl-mw-preview-caption">{preview.prompt}</p></>}</Modal><Modal title="媒体对比" open={compareOpen} onOpenChange={setCompareOpen}><VideoCompare videos={[]} media={compareItems} bestMediaId={bestResultId} onBestChange={(id) => { setBestResultId(id); window.setTimeout(() => { setCompareItems([]); setCompareOpen(false); }, 0); }} onRemove={(id) => setCompareItems((current) => current.filter((item) => item.id !== id))} /></Modal></>;
}
