import { useEffect, useId, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { ToggleGroup } from 'radix-ui';
import { ArrowLeft, ChevronLeft, ChevronRight, Copy, Download, Film, History, Play, RefreshCw, X } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeSanitize from 'rehype-sanitize';
import { Button } from '../ui/Button';
import { Badge, Field, FieldGroup, FieldLabel, Input, NativeSelect, Switch } from '../ui/FormControls';
import type { RequestRecord, RequestRecordFilters, RequestRecordMedia, RequestRecordPage, RequestRecordRetention, RequestRecordsProps } from './types';
import '../settings/settings.css';
import './request-records.css';

const types = { text: '文本', image: '图片', audio: '音频', video: '视频' };
const statuses = { queued: '排队中', running: '进行中', success: '成功', error: '失败', cancelled: '已取消', timeout: '已超时', uncertain: '结果待确认' };
const initialFilters: RequestRecordFilters = { page: 1, pageSize: 20 };
const date = (value: string) => new Date(value).toLocaleString();
const duration = (value?: number) => value === undefined ? '—' : value < 1000 ? `${value} ms` : `${(value / 1000).toFixed(1)} s`;
const safeUrl = (value?: string) => value && /^(?:https?:\/\/|\/(?!\/))/.test(value) ? value : undefined;

function RecordMedia({ media, onPreview }: { media: RequestRecordMedia; onPreview: (media: RequestRecordMedia) => void }) {
  const [failed, setFailed] = useState(false);
  const url = safeUrl(media.url);
  const unavailable = media.unavailable || failed || !url;
  return <figure className="darl-request-media">
    {unavailable ? <div className="darl-request-unavailable">素材不可用</div>
      : media.type === 'image' ? <button type="button" className="darl-request-image-trigger" onClick={() => onPreview(media)} aria-label={`放大 ${media.name}`}><img src={safeUrl(media.thumbnailUrl) || url} alt={media.name} loading="lazy" onError={() => setFailed(true)} /></button>
      : media.type === 'video' ? <video src={url} controls playsInline preload="none" onError={() => setFailed(true)} aria-label={media.name} />
      : <audio src={url} controls preload="none" onError={() => setFailed(true)} aria-label={media.name} />}
    <figcaption><span>{media.name}</span>{!unavailable && <a href={`${url}${media.fileId ? '?download=1' : ''}`} download rel="noreferrer" aria-label={`下载 ${media.name}`}><Download size={15} /></a>}</figcaption>
  </figure>;
}

/** List-row thumbnail. Images load lazily; videos only fetch metadata for a still frame and never autoplay. */
function RecordThumb({ record }: { record: RequestRecord }) {
  const [failed, setFailed] = useState(false);
  const media = record.thumbnail ?? (record.type === 'image' || record.type === 'video'
    ? record.results?.find(item => item.type === record.type && !item.unavailable)
    : undefined);
  if (!media) return <span className="darl-request-thumb darl-request-thumb--none" aria-hidden="true" />;
  const url = safeUrl(media.url);
  if (!url) return <span className="darl-request-thumb darl-request-thumb--none" aria-hidden="true" />;
  if (media.type === 'image') {
    return <span className="darl-request-thumb darl-request-thumb--image" aria-hidden="true">
      {failed ? <Film size={18} className="darl-request-thumb-fallback" /> : <img src={safeUrl(media.thumbnailUrl) || url} alt="" loading="lazy" onError={() => setFailed(true)} />}
    </span>;
  }
  return <span className="darl-request-thumb darl-request-thumb--video" aria-hidden="true">
    {failed ? <Film size={18} className="darl-request-thumb-fallback" /> : <>
      <video src={url} preload="metadata" muted playsInline onLoadedMetadata={event => { const el = event.currentTarget; try { el.currentTime = 0.1; } catch { /* Ignore cross-origin seek rejection. */ } }} onError={() => setFailed(true)} />
      <Play size={14} className="darl-request-thumb-play" />
    </>}
  </span>;
}

export function RequestRecords({ loadRecords, loadRecord, loadRetention, saveRetention, onOpenSession, onOpenTask, className = '' }: RequestRecordsProps) {
  const id = useId();
  const [container, setContainer] = useState<HTMLElement | null>(null);
  const [filters, setFilters] = useState(initialFilters);
  const [query, setQuery] = useState('');
  const [data, setData] = useState<RequestRecordPage>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const [selected, setSelected] = useState<string>();
  const [detail, setDetail] = useState<RequestRecord>();
  const [detailError, setDetailError] = useState('');
  const [preview, setPreview] = useState<RequestRecordMedia>();
  const [retention, setRetention] = useState<RequestRecordRetention>();
  const [days, setDays] = useState('30');
  const [saving, setSaving] = useState(false);
  const [retentionError, setRetentionError] = useState('');
  const [notice, setNotice] = useState('');
  const [copyNotice, setCopyNotice] = useState('');

  useEffect(() => {
    if (query.trim() === (filters.query || '')) return;
    const timer = setTimeout(() => setFilters(current => ({ ...current, query: query.trim() || undefined, page: 1 })), 300);
    return () => clearTimeout(timer);
  }, [query, filters.query]);
  useEffect(() => {
    const controller = new AbortController();
    let busy = false;
    setData(undefined); setLoading(true); setError('');
    const load = async () => {
      if (busy) return;
      busy = true;
      try {
        const value = await loadRecords(filters, controller.signal);
        if (!controller.signal.aborted) {
          if (value.total && (filters.page - 1) * filters.pageSize >= value.total) setFilters(current => ({ ...current, page: Math.ceil(value.total / current.pageSize) }));
          else setData(value);
          setError('');
        }
      } catch (reason) { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : '加载请求记录失败'); }
      finally { busy = false; if (!controller.signal.aborted) setLoading(false); }
    };
    void load();
    const timer = setInterval(() => { if (!document.hidden) void load(); }, 5000);
    return () => { controller.abort(); clearInterval(timer); };
  }, [filters, revision, loadRecords]);
  useEffect(() => {
    const controller = new AbortController();
    loadRetention(controller.signal).then(value => { if (!controller.signal.aborted) { setRetention(value); setDays(String(value.days)); } })
      .catch(reason => { if (!controller.signal.aborted) setRetentionError(reason instanceof Error ? reason.message : '加载清理设置失败'); });
    return () => controller.abort();
  }, [loadRetention, revision]);
  useEffect(() => {
    setDetail(undefined); setDetailError(''); setPreview(undefined); setCopyNotice('');
    if (!selected) return;
    const controller = new AbortController();
    let busy = false;
    const load = async () => {
      if (busy) return;
      busy = true;
      try { const value = await loadRecord(selected, controller.signal); if (!controller.signal.aborted) { setDetail(value); setDetailError(''); } }
      catch (reason) { if (!controller.signal.aborted) { setDetail(undefined); setDetailError(reason instanceof Error ? reason.message : '加载详情失败'); } }
      finally { busy = false; }
    };
    void load();
    const timer = setInterval(() => { if (!document.hidden) void load(); }, 5000);
    return () => { controller.abort(); clearInterval(timer); };
  }, [selected, loadRecord]);

  const updateFilter = (patch: Partial<RequestRecordFilters>) => setFilters(current => ({ ...current, ...patch, page: 1 }));
  const save = async () => {
    if (!retention || saving) return;
    const value = Number(days);
    if (!Number.isSafeInteger(value) || value < 1 || value > 3650) { setRetentionError('保留天数须为 1–3650 的整数'); return; }
    setSaving(true); setRetentionError(''); setNotice('');
    try { const saved = await saveRetention({ ...retention, days: value }); setRetention(saved); setDays(String(saved.days)); setNotice('清理设置已保存'); setRevision(current => current + 1); }
    catch (reason) { setRetentionError(reason instanceof Error ? reason.message : '保存失败，请重试'); }
    finally { setSaving(false); }
  };
  const copy = async (text: string) => {
    try { await navigator.clipboard.writeText(text); setCopyNotice('已复制'); }
    catch { setCopyNotice('复制失败，请手动选择内容'); }
  };
  const mediaSection = (label: string, items?: RequestRecordMedia[]) => <section className="darl-request-section"><h3>{label}</h3>{items?.length ? <div className="darl-request-gallery">{items.map((media, index) => <RecordMedia key={`${media.fileId || media.url}-${index}`} media={media} onPreview={setPreview} />)}</div> : <p className="darl-request-muted">{label === '参考素材' ? '无参考素材' : detail && ['queued','running'].includes(detail.status) ? '结果尚未生成' : '无媒体结果'}</p>}</section>;

  return <section ref={setContainer} className={`darl-request-records ${className}`} aria-label="请求记录">
    <header className="darl-request-header"><div><h2>请求记录</h2><p>查看模型请求、参考素材和生成结果。</p></div><Button variant="outline" onClick={() => setRevision(current => current + 1)}><RefreshCw size={15} />刷新</Button></header>
    <ToggleGroup.Root type="single" value={filters.type || 'all'} onValueChange={value => { if (value) updateFilter({ type: value === 'all' ? undefined : value as RequestRecordFilters['type'] }); }} className="darl-request-types" aria-label="模型类型">
      {Object.entries({ all: '全部', ...types }).map(([value, label]) => <ToggleGroup.Item key={value} value={value}>{label}</ToggleGroup.Item>)}
    </ToggleGroup.Root>
    <FieldGroup className="darl-request-filters">
      <Field><FieldLabel htmlFor={`${id}-query`}>搜索</FieldLabel><Input id={`${id}-query`} value={query} onChange={event => setQuery(event.target.value)} placeholder="请求 ID、模型或错误" /></Field>
      <Field><FieldLabel htmlFor={`${id}-status`}>状态</FieldLabel><NativeSelect id={`${id}-status`} value={filters.status || ''} onChange={event => updateFilter({ status: event.target.value as RequestRecordFilters['status'] || undefined })}><option value="">全部状态</option>{Object.entries(statuses).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</NativeSelect></Field>
      <Field><FieldLabel htmlFor={`${id}-provider`}>供应商</FieldLabel><NativeSelect id={`${id}-provider`} value={filters.providerId || ''} onChange={event => updateFilter({ providerId: event.target.value || undefined })}><option value="">全部供应商</option>{data?.providers.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</NativeSelect></Field>
      <Field><FieldLabel htmlFor={`${id}-model`}>模型</FieldLabel><NativeSelect id={`${id}-model`} value={filters.modelId || ''} onChange={event => updateFilter({ modelId: event.target.value || undefined })}><option value="">全部模型</option>{data?.models.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</NativeSelect></Field>
      <Field><FieldLabel htmlFor={`${id}-from`}>开始日期</FieldLabel><Input id={`${id}-from`} type="date" value={filters.from || ''} max={filters.to} onChange={event => updateFilter({ from: event.target.value || undefined })} /></Field>
      <Field><FieldLabel htmlFor={`${id}-to`}>结束日期</FieldLabel><Input id={`${id}-to`} type="date" value={filters.to || ''} min={filters.from} onChange={event => updateFilter({ to: event.target.value || undefined })} /></Field>
    </FieldGroup>
    {error && <p role="alert" className="darl-request-error">{error}<Button variant="ghost" onClick={() => setRevision(current => current + 1)}>重试</Button></p>}
    <div className="darl-request-list" aria-busy={loading}>
      <div className="darl-request-table-head" aria-hidden="true"><span>模型 / 供应商</span><span>类型</span><span>状态</span><span>时间 / 耗时</span></div>
      {data?.items.map(record => <button type="button" className="darl-request-row" key={record.id} onClick={() => setSelected(record.id)} aria-label={`查看 ${record.modelName} ${statuses[record.status]} 请求详情`}>
        <RecordThumb record={record} />
        <span className="darl-request-model"><strong>{record.modelName}</strong><small>{record.providerName} · {record.requestId?.slice(0, 8) || record.id.slice(0, 8)}</small></span>
        <span>{types[record.type]}</span><Badge className={`darl-request-status darl-request-status--${record.status}`}>{statuses[record.status]}</Badge>
        <span className="darl-request-time">{date(record.createdAt)}<small>{duration(record.durationMs)}</small></span><ChevronRight size={16} />
      </button>)}
      {!data?.items.length && <div className="darl-request-empty"><History size={28} /><strong>{loading ? '正在加载请求记录…' : '暂无请求记录'}</strong><span>{loading ? '请稍候' : '新请求会自动记录，也可以调整筛选条件。'}</span></div>}
    </div>
    <footer className="darl-request-pagination"><span>共 {data?.total || 0} 条 · 第 {filters.page} 页</span><div className="darl-request-pagination-side"><label className="darl-request-pagesize">每页<NativeSelect value={String(filters.pageSize)} onChange={event => setFilters(current => ({ ...current, pageSize: Number(event.target.value), page: 1 }))} aria-label="每页数量">{[20, 50, 100].map(size => <option key={size} value={size}>{size}</option>)}</NativeSelect></label><Button variant="outline" size="sm" disabled={loading || filters.page <= 1} onClick={() => setFilters(current => ({ ...current, page: current.page - 1 }))}><ChevronLeft size={14} />上一页</Button><Button variant="outline" size="sm" disabled={loading || !data || filters.page * filters.pageSize >= data.total} onClick={() => setFilters(current => ({ ...current, page: current.page + 1 }))}>下一页<ChevronRight size={14} /></Button></div></footer>
    <details className="darl-request-retention-details">
      <summary>自动清理设置{retention ? `（保留 ${retention.days} 天${retention.enabled ? '' : '，已关闭'}）` : ''}</summary>
      <form className="darl-request-retention" onSubmit={event => { event.preventDefault(); void save(); }}>
        <div><h3>自动清理</h3><p>按保留天数每小时检查，保存时立即清理过期记录。进行中的请求和素材文件会保留。</p></div>
        <FieldGroup className="darl-request-retention-fields"><Switch checked={retention?.enabled || false} disabled={!retention || saving} onChange={event => { setRetention(current => current && { ...current, enabled: event.target.checked }); setNotice(''); }}>自动清理过期记录</Switch><Field><FieldLabel htmlFor={`${id}-days`}>保留天数</FieldLabel><Input id={`${id}-days`} type="number" min={1} max={3650} required value={days} disabled={!retention || saving} aria-invalid={Boolean(retentionError)} onChange={event => { setDays(event.target.value); setNotice(''); setRetentionError(''); }} /></Field><Button type="submit" disabled={!retention || saving}>{saving ? '保存中…' : '保存清理设置'}</Button></FieldGroup>
        {retentionError && <p className="darl-request-error" role="alert">{retentionError}</p>}{notice && <p role="status">{notice}</p>}
      </form>
    </details>
    <Dialog.Root open={Boolean(selected)} onOpenChange={open => { if (!open) setSelected(undefined); }}>
      <Dialog.Portal container={container || undefined}>
        <Dialog.Overlay className="darl-confirm-overlay" />
        <Dialog.Content className="darl-confirm-dialog darl-request-detail">
          <header className="darl-request-detail-header"><div><Dialog.Title>请求详情</Dialog.Title><Dialog.Description>{detail ? `${types[detail.type]} · ${detail.modelName} · ${statuses[detail.status]}` : '加载请求详情与素材'}</Dialog.Description></div><Dialog.Close asChild><Button variant="ghost" size="icon" aria-label="关闭请求详情"><X size={19} /></Button></Dialog.Close></header>
          <div className="darl-request-detail-body">
            {detailError && <p className="darl-request-error" role="alert">{detailError}</p>}
            {!detail && !detailError && <p role="status">正在加载详情…</p>}
            {preview ? <div className="darl-request-full-image"><Button variant="outline" onClick={() => setPreview(undefined)}><ArrowLeft size={15} />返回详情</Button><RecordMedia media={{ ...preview, thumbnailUrl: undefined }} onPreview={() => {}} /></div> : detail && <>
              <dl className="darl-request-meta"><div><dt>请求 ID</dt><dd>{detail.requestId || detail.id}</dd></div><div><dt>供应商</dt><dd>{detail.providerName}</dd></div><div><dt>开始时间</dt><dd>{date(detail.createdAt)}</dd></div><div><dt>耗时</dt><dd>{duration(detail.durationMs)}</dd></div>{detail.inputTokens !== undefined && <div><dt>输入 Token</dt><dd>{detail.inputTokens}</dd></div>}{detail.outputTokens !== undefined && <div><dt>输出 Token</dt><dd>{detail.outputTokens}</dd></div>}{detail.upstreamTaskId && <div><dt>上游任务 ID</dt><dd>{detail.upstreamTaskId}</dd></div>}{detail.url && <div className="darl-request-meta-wide"><dt>服务地址</dt><dd>{detail.method} {detail.url}</dd></div>}</dl>
              {(detail.sessionId && onOpenSession || detail.taskId && onOpenTask) && <div className="darl-request-related">{detail.sessionId && onOpenSession && <Button variant="outline" onClick={() => onOpenSession(detail.sessionId!)}>打开关联对话</Button>}{detail.taskId && onOpenTask && <Button variant="outline" onClick={() => onOpenTask(detail.taskId!)}>打开媒体任务</Button>}</div>}
              {detail.error && <section className="darl-request-section"><h3>错误信息</h3><p className="darl-request-error">{detail.error}</p></section>}
              {mediaSection('参考素材', detail.references)}
              {detail.text && <section className="darl-request-section"><div className="darl-request-section-heading"><h3>文本结果</h3><Button size="sm" variant="ghost" onClick={() => void copy(detail.text!)}><Copy size={14} />复制</Button></div><div className="darl-request-markdown"><ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSanitize]}>{detail.text}</ReactMarkdown></div></section>}
              {mediaSection('生成结果', detail.results)}
              {detail.parameters !== undefined && <details className="darl-request-json"><summary>请求参数</summary><pre>{JSON.stringify(detail.parameters, null, 2)}</pre></details>}
              {detail.response !== undefined && <details className="darl-request-json"><summary>响应摘要</summary><pre>{JSON.stringify(detail.response, null, 2)}</pre></details>}
              <Button variant="outline" onClick={() => void copy(detail.requestId || detail.id)}><Copy size={14} />复制请求 ID</Button><span role="status">{copyNotice}</span>
            </>}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  </section>;
}
