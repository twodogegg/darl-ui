import { createPortal } from 'react-dom';
import { AgentVoiceInput, AgentVoicePicker } from './AgentVoiceControls';
import { StreamingSpeechPlayer, speechTranscript, type SpeechState } from './voice-playback';
import { Switch } from '../ui/FormControls';
import { AgentComposerInput, ReferenceText, referenceIds } from './AgentComposerInput';
import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { AlertCircle, ArrowDown, ArrowLeft, ArrowUp, Bot, Check, ChevronDown, ChevronRight, Clipboard, Clock3, Copy, Download, History, LoaderCircle, Maximize2, Minimize2, Paperclip, Pencil, Plus, RefreshCw, Search, Send, Sparkles, Square, Trash2, Upload, Volume2, VolumeX, Wrench, X } from 'lucide-react';
import ReactMarkdown, { type Components } from 'react-markdown';
import rehypeSanitize from 'rehype-sanitize';
import remarkGfm from 'remark-gfm';
import { Button } from '../ui/Button';
import { InteractiveConfirmDialog, type ConfirmAnswers } from '../interactive-confirm-dialog/InteractiveConfirmDialog';
import { useDarlTheme } from '../../theme/DarlUIProvider';
import type { AgentApplication, AgentAttachment, AgentErrorInfo, AgentExecutionEvent, AgentImageAttachment, AgentSession, AgentSidebarProps, AgentSkill, AgentToolCall } from './types';
import { ApprovalModeSelector } from './ApprovalModeSelector';
import { importSkillPackage } from './skill-package';
import { defaultReasoningEffort } from '../settings/model-config';

const emptySkills: AgentSkill[] = [];
const emptyFiles: File[] = [];
const skillFileAccept = '.md,.zip,text/markdown,application/zip';
type MarkdownNode = { type?: string; lang?: string; children?: MarkdownNode[] };

function markCodeBlocks() {
  return (tree: MarkdownNode) => {
    const visit = (node: MarkdownNode) => {
      if (node.type === 'code' && !node.lang) node.lang = 'plain';
      node.children?.forEach(visit);
    };
    visit(tree);
  };
}

function formatToolValue(value: unknown): string {
  if (value === undefined) return '';
  if (typeof value === 'string') return value;
  try { return JSON.stringify(value, null, 2); } catch { return String(value); }
}

function formatMediaSize(value: unknown): string {
  const size = String(value).trim();
  const upper = size.toUpperCase();
  if (['1K', '2K', '4K'].includes(upper)) return upper;
  if (size === 'auto') return '自动';
  const match = /^(\d+)x(\d+)$/i.exec(size);
  if (!match) return size;
  const longestEdge = Math.max(Number(match[1]), Number(match[2]));
  if (longestEdge >= 3000) return '4K';
  if (longestEdge >= 1400) return '2K';
  return '1K';
}

function formatMediaResolution(value: unknown): string {
  const resolution = String(value).trim();
  return /^\d+$/.test(resolution) ? `${resolution}P` : resolution;
}

type MediaOptionRow = { key: string; label: string; value: string };

/** Media options are shown as readable fields; never dump the raw JSON payload at the user. */
function mediaOptionRows(options: unknown, type: 'image' | 'video' = 'image'): MediaOptionRow[] {
  if (!options || typeof options !== 'object' || Array.isArray(options)) return [];
  const values = options as Record<string, unknown>;
  const rows: MediaOptionRow[] = [];
  const resolution = values.size !== undefined
    ? formatMediaSize(values.size)
    : values.resolution !== undefined ? formatMediaResolution(values.resolution) : undefined;
  if (resolution) rows.push({ key: 'resolution', label: '分辨率', value: resolution });
  if (values.aspectRatio !== undefined) rows.push({ key: 'aspectRatio', label: '画幅', value: String(values.aspectRatio) });
  if (values.duration !== undefined) rows.push({ key: 'duration', label: '时长', value: `${String(values.duration)} 秒` });
  if (values.count !== undefined) rows.push({ key: 'count', label: '数量', value: `${String(values.count)} ${type === 'image' ? '张' : '个'}` });
  if (Array.isArray(values.references) && values.references.length) rows.push({ key: 'references', label: '参考素材', value: `${values.references.length} 个` });
  return rows;
}

function readImage(file: File): Promise<AgentImageAttachment> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(`无法读取图片：${file.name}`));
    reader.onload = () => resolve({ name: file.name, type: file.type || 'image/*', data: String(reader.result), size: file.size });
    reader.readAsDataURL(file);
  });
}

function attachmentName(attachment: string | AgentAttachment) {
  return typeof attachment === 'string' ? attachment : attachment.name;
}

function attachmentDownloadUrl(attachment: string | AgentAttachment, fileId: string) {
  const value = typeof attachment === 'string' ? undefined : attachment.url;
  if (!value) return `/api/files/${fileId}?download=1`;
  if (!value.startsWith('/api/')) return value;
  const url = new URL(value, 'https://host.invalid');
  url.searchParams.set('download', '1');
  return `${url.pathname}${url.search}`;
}

function originalImageUrl(content: string, source: string): string {
  const images = Array.from(content.matchAll(/!\[[^\]]*\]\((<[^>]+>|[^)\s]+)(?:\s+["'][^"']*["'])?\)/g));
  for (let index = 0; index < images.length; index += 1) {
    const image = images[index];
    if (image[1].replace(/^<|>$/g, '') !== source) continue;
    const start = (image.index ?? 0) + image[0].length;
    const end = images[index + 1]?.index ?? content.length;
    const links = content.slice(start, end).matchAll(/\[([^\]]+)\]\((<[^>]+>|[^)\s]+)(?:\s+["'][^"']*["'])?\)/g);
    for (const match of links) {
      const label = match[1];
      const href = match[2].replace(/^<|>$/g, '');
      if (href !== source && /原图|原始|查看|下载|original|full[- ]?size/i.test(label) && !/^(?:javascript|vbscript|data:(?!image\/))/i.test(href)) return href;
    }
  }
  return source;
}

/** Shared lightbox so Markdown images and message attachments both zoom in-place instead of opening a new tab (signed URLs expire). */
type ImagePreviewTheme = CSSProperties & Record<`--${string}`, string>;
type ImagePreview = { src: string; alt: string; theme?: ImagePreviewTheme };
const ImagePreviewContext = createContext<((image: Pick<ImagePreview, 'src' | 'alt'>) => void) | null>(null);
type DocumentPreview = { url: string; name: string; theme?: ImagePreviewTheme };
const DocumentPreviewContext = createContext<((document: Omit<DocumentPreview, 'theme'>) => void) | null>(null);

function isMarkdownFile(name: string, url: string) {
  return /\.md(?:own)?$/i.test(name.trim()) && /^\/api\/files\/[a-f0-9-]+(?:\?.*)?$/i.test(url);
}

function readAgentTheme(element: HTMLElement): ImagePreviewTheme {
  const styles = getComputedStyle(element);
  const value = (property: string, fallback: string) => styles.getPropertyValue(property).trim() || fallback;
  const background = value('background-color', '#fff');
  const surfaceColor = value('--darl-agent-surface', '#f8fafc');
  const text = value('--darl-agent-text', '#0f172a');
  const mutedColor = value('--darl-agent-muted', '#64748b');
  const borderColor = value('--darl-agent-border', '#e2e8f0');
  const primaryColor = value('--darl-agent-primary', '#2563eb');
  const primaryForeground = value('--darl-agent-primary-foreground', '#fff');
  const danger = value('--darl-danger', '#ef4444');
  const radius = value('--darl-radius', '12px');
  return {
    '--darl-agent-bg': background,
    '--darl-agent-surface': surfaceColor,
    '--darl-agent-text': text,
    '--darl-agent-muted': mutedColor,
    '--darl-agent-border': borderColor,
    '--darl-agent-primary': primaryColor,
    '--darl-agent-primary-foreground': primaryForeground,
    '--darl-agent-danger': danger,
    '--darl-background': background,
    '--darl-surface': surfaceColor,
    '--darl-text': text,
    '--darl-muted': mutedColor,
    '--darl-border': borderColor,
    '--darl-primary': primaryColor,
    '--darl-primary-foreground': primaryForeground,
    '--darl-danger': danger,
    '--darl-radius': radius,
  };
}

function useImagePreview() {
  return useContext(ImagePreviewContext);
}

function ImageLightbox({ image, onClose }: { image: ImagePreview | null; onClose: () => void }) {
  return <DialogPrimitive.Root open={Boolean(image)} onOpenChange={(open) => { if (!open) onClose(); }}>
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="darl-agent-lightbox-overlay" />
      <DialogPrimitive.Content className="darl-agent-lightbox" role="dialog" aria-describedby={undefined} style={image?.theme}>
        <DialogPrimitive.Title className="darl-agent-lightbox-title">{image?.alt || '图片预览'}</DialogPrimitive.Title>
        {image && <img src={image.src} alt={image.alt} />}
        <DialogPrimitive.Close asChild><Button variant="ghost" size="icon" className="darl-agent-lightbox-close" aria-label="关闭预览"><X size={18} /></Button></DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  </DialogPrimitive.Root>;
}

function Markdown({ content, onCopyCode, depth = 0 }: { content: string; onCopyCode: (code: string) => void; depth?: number }) {
  const openImage = useImagePreview();
  const openDocument = useContext(DocumentPreviewContext);
  const components: Components = {
    a: ({ href, children }) => {
      const name = Array.isArray(children) ? children.filter((child) => typeof child === 'string').join('') : typeof children === 'string' ? children : '';
      return <a href={href} target={href?.startsWith('http') ? '_blank' : undefined} rel={href?.startsWith('http') ? 'noreferrer' : undefined} onClick={(event) => { if (href && openDocument && isMarkdownFile(name, href) && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) { event.preventDefault(); openDocument({ url: href, name }); } }}>{children}</a>;
    },
    img: ({ src, alt }) => typeof src === 'string' && src ? <button type="button" className="darl-agent-markdown-image" onClick={() => openImage?.({ src: originalImageUrl(content, src), alt: alt || '' })} title="点击放大预览"><img src={src} alt={alt || ''} loading="lazy" /></button> : null,
    pre: ({ children }) => <>{children}</>,
    code: ({ className, children, ...props }) => {
      const language = /language-([\w-]+)/.exec(className || '')?.[1]?.toLowerCase() || '';
      const source = String(children).replace(/\n$/, '');
      const isInline = !className;
      if (isInline) return <code className="darl-agent-inline-code" {...props}>{children}</code>;
      if (depth < 2 && ['md', 'markdown', 'mdx'].includes(language)) {
        return <div className="darl-agent-code darl-agent-rendered-markdown"><div className="darl-agent-code-head"><span>Markdown</span><button type="button" onClick={() => onCopyCode(source)}><Copy size={13} />复制 Markdown</button></div><Markdown content={source} onCopyCode={onCopyCode} depth={depth + 1} /></div>;
      }
      return <div className="darl-agent-code"><div className="darl-agent-code-head"><span>{language || 'code'}</span><button type="button" onClick={() => onCopyCode(source)}><Copy size={13} />复制代码</button></div><pre><code>{source}</code></pre></div>;
    },
  };
  return <div className="darl-agent-markdown"><ReactMarkdown remarkPlugins={[remarkGfm, markCodeBlocks]} rehypePlugins={[rehypeSanitize]} components={components}>{content}</ReactMarkdown></div>;
}

function MarkdownPreview({ document, onClose, onCopyCode }: { document: DocumentPreview | null; onClose: () => void; onCopyCode: (code: string) => void }) {
  const [content, setContent] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!document) return;
    const controller = new AbortController();
    setContent(''); setError(''); setLoading(true);
    const previewUrl = new URL(document.url, window.location.href);
    previewUrl.searchParams.set('preview', 'markdown');
    fetch(previewUrl, { signal: controller.signal }).then(async (response) => {
      if (!response.ok) throw new Error(`读取文件失败（${response.status}）`);
      return response.text();
    }).then(setContent).catch((reason) => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : '读取文件失败'); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [document]);
  return <DialogPrimitive.Root modal={false} open={Boolean(document)} onOpenChange={(open) => { if (!open) onClose(); }}>
    <DialogPrimitive.Portal><DialogPrimitive.Content className="darl-agent-document-preview" style={document?.theme} aria-describedby={undefined}>
      <header><DialogPrimitive.Title>{document?.name}</DialogPrimitive.Title><div>{document && <a href={document.url} download aria-label="下载文件" title="下载文件"><Download size={17} /></a>}<DialogPrimitive.Close asChild><Button variant="ghost" size="icon" aria-label="关闭文件预览"><X size={18} /></Button></DialogPrimitive.Close></div></header>
      <div className="darl-agent-document-body">{loading ? <p role="status">正在读取文件…</p> : error ? <p role="alert">{error}</p> : <Markdown content={content} onCopyCode={onCopyCode} />}</div>
    </DialogPrimitive.Content></DialogPrimitive.Portal>
  </DialogPrimitive.Root>;
}

function toolDelegationTask(call?: AgentToolCall) {
  return call?.appId.startsWith('agent:') && call.input && typeof call.input === 'object' && 'task' in call.input && typeof call.input.task === 'string' ? call.input.task : '';
}

function UserInputAnswers({ call }: { call?: AgentToolCall }) {
  const answers = call?.userInput && call.output && typeof call.output === 'object' && 'answers' in call.output ? call.output.answers as ConfirmAnswers : undefined;
  if (!answers) return null;
  return <div className="darl-agent-tool-detail">{call!.userInput!.questions.map(question => {
    const value = answers[question.id];
    const selected = Array.isArray(value) ? value.filter(item => typeof item === 'string') : typeof value === 'string' && value ? [value] : [];
    return <div key={question.id}><span>{question.label}</span><pre>{selected.map(item => question.options?.find(option => option.value === item)?.label ?? item).join('、') || '未填写'}</pre></div>;
  })}</div>;
}

function AgentErrorCard({ error }: { error: AgentErrorInfo }) {
  if (error.stage === 'cancellation') return <p className="darl-agent-status-note" role="status">{error.message}</p>;
  const stage = { model: '模型请求', 'mcp-connection': 'MCP 连接', 'mcp-tool': 'MCP 工具', runtime: '本机执行', delegation: '子 Agent 委派', 'tool-validation': '工具参数', validation: '请求校验', cancellation: '已取消', timeout: '请求超时' }[error.stage];
  return <div className="darl-agent-error-card" role="alert"><div className="darl-agent-error-card-head"><AlertCircle size={15} /><strong>{stage}失败</strong><span>{error.retryable ? '可以重试' : '请修改后重试'}</span></div><p>{error.message}</p><div className="darl-agent-error-card-meta"><span>错误码：{error.code}</span>{error.requestId && <span>requestId：{error.requestId}</span>}{error.runId && <span>runId：{error.runId}</span>}</div><small>{error.suggestion}</small></div>;
}

const executionStatusText: Record<AgentExecutionEvent['status'], string> = {
  pending: '等待调用', started: '已开始', running: '执行中', retrying: '重试中', confirmation: '等待确认', success: '已完成', error: '失败', cancelled: '已取消', timeout: '已超时',
};

function executionSourceText(event: AgentExecutionEvent) {
  return event.source === 'tool' ? '工具' : event.parentRunId ? '协作 Agent' : '主 Agent';
}

const liveExecutionStatuses = new Set<AgentExecutionEvent['status']>(['pending', 'started', 'running', 'retrying', 'confirmation']);

function executionKey(event: AgentExecutionEvent) {
  if (event.source === 'commentary') return `commentary:${event.id}`;
  return event.toolCallId || event.source === 'tool' ? `tool:${event.toolCallId || event.id}` : `agent:${event.runId || event.id}`;
}

function executionDuration(event: AgentExecutionEvent, now: number, events: AgentExecutionEvent[] = []) {
  if (typeof event.durationMs === 'number' && Number.isFinite(event.durationMs)) return Math.max(0, event.durationMs);
  const first = events.find((candidate) => executionKey(candidate) === executionKey(event));
  const start = Date.parse(event.startedAt || first?.startedAt || (first && liveExecutionStatuses.has(first.status) ? first.timestamp : ''));
  const end = liveExecutionStatuses.has(event.status) ? now : Date.parse(event.endedAt || event.timestamp);
  return Number.isFinite(start) && Number.isFinite(end) ? Math.max(0, end - start) : undefined;
}

function formatDuration(milliseconds: number) {
  if (milliseconds < 1000) return '<1s';
  const seconds = Math.floor(milliseconds / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${String(seconds % 60).padStart(2, '0')}s`;
}

function hasExecutionActivity(events: AgentExecutionEvent[] | undefined, calls: AgentToolCall[] = []) {
  return calls.length > 0 || Boolean(events?.some((event) => event.source !== 'agent' || event.parentRunId));
}

function ExecutionTimeline({ events = [], calls = [], streaming = false, error, onCopyCode }: { events?: AgentExecutionEvent[]; calls?: AgentToolCall[]; streaming?: boolean; error?: AgentErrorInfo; onCopyCode: (code: string) => void }) {
  const [expanded, setExpanded] = useState(false);
  const activityMap = new Map<string, AgentExecutionEvent[]>();
  events.forEach((event) => {
    const key = executionKey(event);
    activityMap.set(key, [...(activityMap.get(key) || []), event]);
  });
  calls.forEach((call) => {
    const key = `tool:${call.id}`;
    const history = activityMap.get(key) || [];
    const previous = history.at(-1);
    const snapshot: AgentExecutionEvent = {
      ...previous, id: call.id, source: 'tool', name: call.toolTitle || call.toolName,
      status: call.errorInfo?.stage === 'cancellation' ? 'cancelled' : call.errorInfo?.stage === 'timeout' && call.status === 'error' ? 'timeout' : call.status,
      timestamp: call.endedAt || previous?.timestamp || call.startedAt || '',
      startedAt: call.startedAt || previous?.startedAt, endedAt: call.endedAt || previous?.endedAt,
      durationMs: call.durationMs ?? previous?.durationMs, runId: call.runId || previous?.runId,
      parentRunId: call.parentRunId || previous?.parentRunId, toolCallId: call.id,
      attempt: call.attempt ?? previous?.attempt,
      error: call.status === 'success' ? undefined : call.errorInfo || previous?.error,
    };
    activityMap.set(key, [...history, snapshot]);
  });
  const activities = [...activityMap.entries()].map(([key, history]) => ({ key, events: history, first: history[0], latest: history.at(-1)!, call: calls.find((call) => key === `tool:${call.id}`) })).sort((a, b) => {
    const difference = Date.parse(a.first.startedAt || a.first.timestamp) - Date.parse(b.first.startedAt || b.first.timestamp);
    return Number.isFinite(difference) ? difference : 0;
  });
  const root = activities.find(({ latest }) => latest.source === 'agent' && !latest.parentRunId);
  const tools = activities.filter(({ latest }) => latest.source === 'tool');
  const live = activities.filter(({ latest }) => liveExecutionStatuses.has(latest.status));
  const failures = activities.filter((activity) => activity !== root && (activity.latest.status === 'error' || activity.latest.status === 'timeout'));
  const rootFinished = root && !liveExecutionStatuses.has(root.latest.status);
  const running = !error && !rootFinished && (streaming || live.length > 0);
  const current = live.find(({ latest }) => latest.status === 'confirmation') || live.filter(({ latest }) => latest.source === 'tool').at(-1);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [running]);
  if (!hasExecutionActivity(events, calls)) return null;
  const runDepth = new Map<string, number>();
  events.filter((event) => event.source === 'agent').forEach((event) => {
    if (!event.runId || runDepth.has(event.runId)) return;
    const parentDepth = event.parentRunId ? runDepth.get(event.parentRunId) : undefined;
    runDepth.set(event.runId, Math.min(3, (parentDepth ?? -1) + 1));
  });
  const stopped = error?.stage === 'cancellation' || (rootFinished ? root.latest.status === 'cancelled' : !running && tools.some(({ latest }) => latest.status === 'cancelled'));
  const failed = Boolean(error && error.stage !== 'cancellation') || root?.latest.status === 'error' || root?.latest.status === 'timeout';
  const heading = running ? current ? `${executionStatusText[current.latest.status]} · ${current.latest.name}` : '处理中' : failed ? '处理失败' : stopped ? '已停止' : failures.length && !rootFinished ? '处理结束' : '处理完成';
  const SummaryIcon = running ? current?.latest.status === 'confirmation' ? Wrench : LoaderCircle : failed || failures.length ? AlertCircle : stopped ? Square : Clock3;
  const starts = activities.map(({ first, latest }) => Date.parse(latest.startedAt || first.startedAt || (liveExecutionStatuses.has(first.status) ? first.timestamp : ''))).filter(Number.isFinite);
  const ends = activities.filter(({ latest }) => !liveExecutionStatuses.has(latest.status)).map(({ latest }) => Date.parse(latest.endedAt || latest.timestamp)).filter(Number.isFinite);
  const duration = root ? executionDuration(root.latest, now, root.events) : starts.length && (running || ends.length) ? Math.max(0, (running ? now : Math.max(...ends)) - Math.min(...starts)) : undefined;
  const renderActivity = ({ key, first, latest, events: history, call }: typeof activities[number]) => {
    const transitions = history.map((event) => executionStatusText[event.status]).filter((label, index, values) => index === 0 || label !== values[index - 1]);
    const retryCount = Math.max((latest.attempt || 1) - 1, transitions.filter((label) => label === executionStatusText.retrying).length);
    const stepDuration = executionDuration(latest, now, history);
    const depth = Math.max(0, Math.min(2, (runDepth.get(latest.runId || '') || 0) - (latest.source === 'agent' ? 1 : 0)));
    return <li key={key} className={`darl-agent-execution-item darl-agent-execution-item--${latest.status}`} style={{ '--darl-agent-depth': depth } as CSSProperties}>
      <details className="darl-agent-execution-step">
        <summary className="darl-agent-execution-row"><span className="darl-agent-execution-dot">{running && ['running', 'retrying'].includes(latest.status) ? <LoaderCircle size={13} className="darl-agent-spin" /> : latest.status === 'success' ? <Check size={13} /> : latest.status === 'error' || latest.status === 'timeout' ? <AlertCircle size={13} /> : latest.status === 'cancelled' ? <Square size={12} /> : <Wrench size={13} />}</span><span className="darl-agent-execution-copy"><strong>{latest.name}</strong><span>{call?.appName || executionSourceText(latest)}</span></span>{retryCount > 0 && <span className="darl-agent-execution-retry">重试 {retryCount}</span>}<span className="darl-agent-execution-state">{call?.errorInfo?.code === 'TOOL_REJECTED' ? '已拒绝' : executionStatusText[latest.status]}</span><ChevronRight size={12} /></summary>
        <div className="darl-agent-execution-details"><span>来源：{call?.appName || executionSourceText(latest)}{call && ` · ${call.toolName}`}</span>{first.summary && <p>{first.summary}</p>}{stepDuration !== undefined && <span>耗时 {formatDuration(stepDuration)}</span>}{transitions.length > 1 && <small className="darl-agent-execution-transitions">{transitions.join(' → ')}</small>}{latest.error ? <AgentErrorCard error={latest.error} /> : call?.error && <p className="darl-agent-tool-error">{call.error}</p>}{toolDelegationTask(call) && <div><span>委派任务</span><p>{toolDelegationTask(call)}</p></div>}<UserInputAnswers call={call} /></div>
      </details>
    </li>;
  };
  return <section className={`darl-agent-execution${expanded ? ' is-expanded' : ''}`} aria-label="执行过程">
    {activities.filter(({ latest }) => latest.source === 'commentary').map(({ key, latest }) => <div key={key} className="darl-agent-progress"><Markdown content={latest.summary || ''} onCopyCode={onCopyCode} /></div>)}
    <button type="button" className="darl-agent-execution-summary" aria-label={`执行过程：${heading}`} aria-expanded={expanded} onClick={() => setExpanded((value) => !value)}>
      <SummaryIcon size={14} className={running && current?.latest.status !== 'confirmation' ? 'darl-agent-spin' : undefined} />
      <span className="darl-agent-execution-heading"><strong>{heading}</strong><small>{tools.length ? `${tools.length} 次调用` : `${activities.length - (root ? 1 : 0)} 项活动`}{running && live.filter(({ latest }) => latest.source === 'tool').length > 1 && ` · ${live.filter(({ latest }) => latest.source === 'tool').length} 项进行中`}{failures.length > 0 && ` · ${failures.length} 项失败`}</small></span>
      {duration !== undefined && <span className="darl-agent-execution-duration">{formatDuration(duration)}</span>}<ChevronRight size={13} className={expanded ? 'is-open' : undefined} />
    </button>
    {expanded && <ol className="darl-agent-execution-list">{activities.filter((activity) => activity !== root && activity.latest.source !== 'commentary').map(renderActivity)}</ol>}
  </section>;
}

function Picker({ title, children, onClose, className = '' }: { title: string; children: ReactNode; onClose: () => void; className?: string }) {
  return <div className={`darl-agent-picker ${className}`.trim()} role="dialog" aria-label={title}><div className="darl-agent-picker-head"><strong>{title}</strong><Button variant="ghost" size="icon" aria-label={`关闭${title}`} onClick={onClose}><X size={16} /></Button></div>{children}</div>;
}

function AgentAvatar({ agent }: { agent: { name: string; avatar?: string } }) {
  const value = agent.avatar;
  if (value?.startsWith('/') || value?.startsWith('http') || value?.startsWith('data:image/')) return <img className="darl-agent-header-avatar" src={value} alt={`${agent.name}头像`} />;
  return <span className="darl-agent-header-avatar" aria-hidden="true">{value || agent.name.slice(0, 1).toUpperCase()}</span>;
}

function statusText(status: AgentApplication['status']): string {
  return status === 'connected' ? '已连接' : status === 'needs-auth' ? '需要授权' : '未连接';
}

export function AgentSidebar({ embedded = false, draft: controlledDraft, onDraftChange, references, onReference, composerHeader, composerFooter, messageHeader, renderMessageActions, voice, open, onOpenChange, sessions, hideEmptySessions = false, activeSessionId, onSessionChange, onSessionRename, onSessionDelete, onNewSession, onSend, onRegenerate, onToolConfirm, onUserInput, approvalMode, onApprovalModeChange, approvalModePending = false, isGenerating = false, onStop, applications = [], skills = emptySkills, onSkillUpload, onSkillImport, onSkillCreate, onFileUpload, uploadAttachment, models = [], agents = [], selectedAgentId: controlledAgentId, selectedApplicationIds, selectedSkillIds, onSelectedApplicationIdsChange, onSelectedSkillIdsChange, selectedModelId: controlledModelId, onSelectedModelIdChange, selectedReasoningEffort: controlledEffort, onSelectedReasoningEffortChange, className = '' }: AgentSidebarProps) {
  const [view, setView] = useState<'chat' | 'history'>('chat');
  const [confirmBusy, setConfirmBusy] = useState(false);
  const [handledConfirmations, setHandledConfirmations] = useState<Set<string>>(() => new Set());
  const [confirmError, setConfirmError] = useState('');
  const [expanded, setExpanded] = useState(false);
  const [expandedTheme, setExpandedTheme] = useState<ImagePreviewTheme>();
  const [picker, setPicker] = useState<'add' | 'apps' | 'skills' | 'models' | 'voices' | null>(null);
  const [skillFilter, setSkillFilter] = useState<'all' | 'builtin' | 'mine' | 'favorite'>('all');
  const [skillQuery, setSkillQuery] = useState('');
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const submitting = useRef(false);
  const [historyQuery, setHistoryQuery] = useState('');
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<AgentSession | null>(null);
  const [deleteError, setDeleteError] = useState('');
  const [deleteTheme, setDeleteTheme] = useState<ImagePreviewTheme>();
  const deleteButtonRef = useRef<HTMLButtonElement>(null);
  const [copyState, setCopyState] = useState('');
  const [copyNotice, setCopyNotice] = useState('');
  const [insertion, setInsertion] = useState<{ token: string; key: number } | null>(null);
  const [localSkills, setLocalSkills] = useState<AgentSkill[]>(skills);
  const skillsPropRef = useRef(skills);

  const [localModelId, setLocalModelId] = useState(models[0]?.id);
  const [localEffort, setLocalEffort] = useState(defaultReasoningEffort(models[0]));
  const [attachments, setAttachments] = useState<Record<string, File[]>>({});
  const [attachmentPreviews, setAttachmentPreviews] = useState<Record<string, string>>({});
  const attachmentPreviewUrls = useRef<Record<string, string>>({});
  const [uploadKind, setUploadKind] = useState<'file' | 'skill'>('skill');
  const [imagePreview, setImagePreview] = useState<ImagePreview | null>(null);
  const [documentPreview, setDocumentPreview] = useState<DocumentPreview | null>(null);
  const sidebarRef = useRef<HTMLElement>(null);
  const voiceButtonRef = useRef<HTMLButtonElement>(null);
  const [voiceTheme, setVoiceTheme] = useState<ImagePreviewTheme>();
  const fileInput = useRef<HTMLInputElement>(null);
  const messagesRef = useRef<HTMLElement>(null);
  const followOutput = useRef(true);
  const copyTimer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(copyTimer.current), []);
  useEffect(() => { if (!open) { setImagePreview(null); setDocumentPreview(null); setPicker(null); } }, [open]);
  useEffect(() => {
    const changed = skillsPropRef.current !== skills;
    if (changed) {
      skillsPropRef.current = skills;
      setLocalSkills(skills);
    }
  }, [skills]);
  const availableSkills = localSkills;
  const skillGroups = [
    { id: 'all', label: '全部 Skills', items: availableSkills },
    { id: 'builtin', label: '内置 Skills', items: availableSkills.filter(skill => skill.scope === 'builtin') },
    { id: 'mine', label: '我创建的', items: availableSkills.filter(skill => skill.scope !== 'builtin') },
    { id: 'favorite', label: '我收藏的', items: availableSkills.filter(skill => skill.favorite) },
  ] as const;
  const skillSearch = skillQuery.trim().toLocaleLowerCase();
  const visibleSkills = skillGroups.find(group => group.id === skillFilter)!.items.filter(skill =>
    !skillSearch || [skill.name, skill.slug].some(name => name?.toLocaleLowerCase().includes(skillSearch)));
  const activeSession = sessions.find((session) => session.id === activeSessionId) ?? sessions[0];
  const modelId = controlledModelId ?? localModelId;
  const selectedModel = models.find((model) => model.id === modelId) ?? models[0];
  const requestedAgentId = activeSession?.agentId ?? controlledAgentId;
  const selectedAgent = agents.find(agent => agent.id === requestedAgentId);
  const agentId = requestedAgentId;
  const supportedEfforts = selectedModel?.reasoningEfforts ?? [];
  const preferredEffort = controlledEffort ?? localEffort;
  const effort = supportedEfforts.includes(preferredEffort ?? '') ? preferredEffort : defaultReasoningEffort(selectedModel);
  const draftKey = activeSession?.id ?? '';
  const draft = controlledDraft ?? drafts[draftKey] ?? '';
  const latestDraft = useRef(draft);
  latestDraft.current = draft;
  const applicationIds = selectedApplicationIds ?? referenceIds(draft, 'app');
  const skillIds = selectedSkillIds ?? referenceIds(draft, 'skill');
  const files = attachments[draftKey] || emptyFiles;
  useEffect(() => {
    const activeKeys = new Set(files.map((file) => `${file.name}:${file.size}:${file.lastModified}`));
    setAttachmentPreviews((current) => {
      const next = { ...current };
      Object.keys(next).forEach((key) => { if (!activeKeys.has(key)) { if (typeof URL.revokeObjectURL === 'function') URL.revokeObjectURL(next[key]); delete next[key]; } });
      files.forEach((file) => {
        const key = `${file.name}:${file.size}:${file.lastModified}`;
        if (!next[key] && file.type.startsWith('image/') && typeof URL.createObjectURL === 'function') next[key] = URL.createObjectURL(file);
      });
      attachmentPreviewUrls.current = next;
      return next;
    });
  }, [files]);
  useEffect(() => () => { if (typeof URL.revokeObjectURL === 'function') Object.values(attachmentPreviewUrls.current).forEach((url) => URL.revokeObjectURL(url)); }, []);
  const setDraft = (value: string) => { onDraftChange?.(value); setDrafts((current) => ({ ...current, [draftKey]: value })); onSelectedApplicationIdsChange?.(referenceIds(value, 'app')); onSelectedSkillIdsChange?.(referenceIds(value, 'skill')); };
  const filteredSessions = useMemo(() => sessions.filter((session) => (!hideEmptySessions || (session.messageCount ?? session.messages.length) > 0) && `${session.title} ${session.messages.at(-1)?.content ?? session.messagePreview ?? ''}`.toLowerCase().includes(historyQuery.toLowerCase())), [hideEmptySessions, historyQuery, sessions]);
  useEffect(() => { setError(''); setPicker(null); }, [activeSession?.id]);

  const pendingConfirmation = activeSession?.messages.flatMap(message => message.toolCalls || []).find(call => call.status === 'confirmation' && !handledConfirmations.has(call.id));
  const userInput = pendingConfirmation?.userInput;
  const theme = useDarlTheme();
  const [questionTheme, setQuestionTheme] = useState<CSSProperties>();
  useLayoutEffect(() => {
    if (!userInput || !sidebarRef.current) return;
    const colors = readAgentTheme(sidebarRef.current);
    setQuestionTheme({
      ...colors,
      colorScheme: theme?.resolvedMode,
      '--darl-confirm-bg': colors['--darl-background'],
      '--darl-confirm-text': colors['--darl-text'],
      '--darl-confirm-muted': colors['--darl-muted'],
      '--darl-confirm-border': colors['--darl-border'],
      '--darl-confirm-accent': colors['--darl-primary'],
      '--darl-confirm-accent-foreground': colors['--darl-primary-foreground'],
    } as CSSProperties);
  }, [userInput, theme, open, expanded]);
  const pendingInput = pendingConfirmation?.input && typeof pendingConfirmation.input === 'object' ? pendingConfirmation.input as Record<string, unknown> : {};
  const isMediaConfirmation = pendingConfirmation?.appId === 'builtin:media';
  const mediaKind = ['gpt-image-2', 'gpt-image-2.5', 'gemini-3-pro-image-preview'].includes(String(pendingInput.modelId)) ? '图片' : '视频';
  const mediaModelLabel = ({ 'gpt-image-2': 'GPT Image 2', 'gpt-image-2.5': 'GPT Image 2.5', 'gemini-3-pro-image-preview': 'Gemini 3 Pro Image Preview', 'minimax-h3-flash': 'MiniMax H3 Flash' } as Record<string, string>)[String(pendingInput.modelId)] ?? String(pendingInput.modelId || '—');
  const mediaRows = mediaOptionRows(pendingInput.options, mediaKind === '图片' ? 'image' : 'video');
  const confirmAction = async (approved: boolean, answers?: ConfirmAnswers) => {
    if (!pendingConfirmation || confirmBusy || (userInput ? !onUserInput : !onToolConfirm)) return;
    setConfirmBusy(true); setConfirmError('');
    try {
      if (userInput) await onUserInput!(pendingConfirmation.id, approved ? answers ?? {} : null);
      else await onToolConfirm!(pendingConfirmation.id, approved);
      setHandledConfirmations(current => new Set(current).add(pendingConfirmation.id));
    }
    catch (reason) { setConfirmError(reason instanceof Error ? reason.message : '确认失败，请重试'); }
    finally { setConfirmBusy(false); }
  };
  const [speechState, setSpeechState] = useState<SpeechState>({ id: '', state: 'idle' });
  const [voiceInputBusy, setVoiceInputBusy] = useState(false);
  const voiceRef = useRef(voice);
  voiceRef.current = voice;
  const [player] = useState(() => new StreamingSpeechPlayer((...args) => {
    if (!voiceRef.current) return Promise.reject(new Error('语音服务未配置'));
    return voiceRef.current.synthesize(...args);
  }, setSpeechState));
  const spokenCounts = useRef(new Map<string, number>());
  const silencedMessages = useRef(new Set<string>());
  const liveMessages = useRef(new Set<string>());
  const stopSpeech = () => { if (speechState.id) silencedMessages.current.add(speechState.id); player.stop(); };
  useEffect(() => () => player.dispose(), [player]);
  useEffect(() => { player.stop(); }, [player, open, activeSession?.id, voice?.enabled, voice?.voiceId]);
  useEffect(() => {
    for (const message of activeSession?.messages || []) {
      const outputs = message.outputs || [];
      const previous = spokenCounts.current.get(message.id) ?? 0;
      if (message.streaming) liveMessages.current.add(message.id);
      const live = liveMessages.current.has(message.id);
      if (!message.streaming) liveMessages.current.delete(message.id);
      // Always mark seen: enabling voice or restoring history must never replay old speech.
      spokenCounts.current.set(message.id, outputs.length);
      if (!open || !voice?.enabled || !live || message.error || voiceInputBusy || silencedMessages.current.has(message.id)) continue;
      for (const output of outputs.slice(previous)) if (output.output_type === 'speech') player.enqueue(output.content, voice.voiceId, message.id);
    }
    if (activeSession?.messages.at(-1)?.error) player.stop();
  }, [activeSession, open, voice?.enabled, voice?.voiceId, player, voiceInputBusy]);
  useEffect(() => { if (speechState.state === 'error' && speechState.id) silencedMessages.current.add(speechState.id); }, [speechState]);
  const prepareSpeech = () => { if (voice?.enabled) void player.prepare().catch(() => {}); };
  const lastMessage = activeSession?.messages.at(-1);
  useEffect(() => {
    followOutput.current = true;
    const element = messagesRef.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [activeSession?.id, open, view]);
  useEffect(() => {
    const element = messagesRef.current;
    if (element && followOutput.current) element.scrollTop = element.scrollHeight;
  }, [lastMessage?.id, lastMessage?.content]);

  if (!open) return null;
  const setModelId = (id: string) => { setLocalModelId(id); onSelectedModelIdChange?.(id); };
  const setEffort = (value: string) => { setLocalEffort(value); onSelectedReasoningEffortChange?.(value); };
  const copy = async (value: string, id: string) => { try { await navigator.clipboard.writeText(value); setCopyState(id); setCopyNotice('已复制'); window.clearTimeout(copyTimer.current); copyTimer.current = window.setTimeout(() => { setCopyState((current) => current === id ? '' : current); setCopyNotice(''); }, 1200); } catch { setError('复制失败，请手动选择文本复制'); } };
  const submit = async () => {
    const content = draft.trim();
    if ((!content && !files.length) || !activeSession || !onSend || isGenerating || approvalModePending || submitting.current) return;
    player.stop(); prepareSpeech();
    submitting.current = true; setPending(true); setError('');
    try {
      const imageFiles = files.filter((file) => file.type.startsWith('image/'));
      const attachments: AgentImageAttachment[] = [];
      for (const file of imageFiles) attachments.push(await readImage(file));
      const uploadedFiles = uploadAttachment ? await Promise.all(files.map(uploadAttachment)) : [];
      await onSend({ ...(voice ? { voiceMode: voice.enabled } : {}), sessionId: activeSession.id, content, applicationIds, skillIds, modelId: selectedModel?.id, reasoningEffort: effort, ...(agentId !== undefined ? { agentId: agentId || null } : {}), ...(files.length ? { files } : {}), ...(uploadedFiles.length ? { uploadedAttachments: uploadedFiles } : {}), ...(attachments.length ? { attachments } : {}) });
      setAttachments((current) => ({ ...current, [draftKey]: [] }));
      if (controlledDraft === undefined) setDrafts((current) => current[draftKey] === draft ? { ...current, [draftKey]: '' } : current);
    } catch (reason) { setError(reason instanceof Error ? reason.message : '发送失败，请重试'); }
    finally { submitting.current = false; setPending(false); }
  };
  const createSession = () => { setView('chat'); setPicker(null); onNewSession?.(); };
  const insertReference = (kind: 'app' | 'skill', id: string, name: string) => {
    setInsertion({ token: `[${name.replace(/[\[\]]/g, '')}](${kind}:${encodeURIComponent(id)})`, key: Date.now() }); setPicker(null);
  };
  const toggleApplication = (id: string) => { const app = applications.find((item) => item.id === id); if (app) insertReference('app', id, app.name); };
  const toggleSkill = (id: string) => { const skill = availableSkills.find((item) => item.id === id); if (skill) insertReference('skill', id, skill.name); };
  const closePicker = () => setPicker(null);
  const openVoicePicker = () => {
    if (sidebarRef.current) setVoiceTheme(readAgentTheme(sidebarRef.current));
    setPicker('voices');
  };
  const closeVoicePicker = () => {
    if (speechState.id?.startsWith('preview:')) player.stop();
    setPicker(null);
  };
  const openFilePicker = (kind: 'file' | 'skill') => {
    setUploadKind(kind);
    const input = fileInput.current;
    if (!input) return;
    input.accept = kind === 'skill' ? skillFileAccept : uploadAttachment ? '' : 'image/*,.png,.jpg,.jpeg,.webp,.gif';
    input.multiple = kind === 'file';
    input.click();
  };
  const addAttachments = (files: File[]) => {
    const acceptedFiles = uploadAttachment ? files : files.filter((file) => file.type.startsWith('image/'));
    if (acceptedFiles.length !== files.length) setError('仅支持图片附件，请选择 PNG、JPEG、WebP 或 GIF');
    if (!acceptedFiles.length) return;
    setAttachments((current) => ({ ...current, [draftKey]: [...(current[draftKey] ?? []), ...acceptedFiles] }));
    if (onFileUpload) void Promise.resolve().then(() => onFileUpload(acceptedFiles)).catch(() => setError('附件处理失败'));
  };
  const beginRename = (session: AgentSession) => { setRenamingId(session.id); setRenameDraft(session.title); };
  const saveRename = async (sessionId: string) => {
    const title = renameDraft.trim();
    if (!title) return;
    try { await onSessionRename?.(sessionId, title); setRenamingId(null); }
    catch (reason) { setError(reason instanceof Error ? reason.message : '重命名失败，请重试'); }
  };
  const requestDelete = (session: AgentSession, trigger: HTMLButtonElement) => {
    deleteButtonRef.current = trigger;
    if (sidebarRef.current) setDeleteTheme(readAgentTheme(sidebarRef.current));
    setRenamingId(null);
    setDeleteError('');
    setDeleteTarget(session);
  };
  const confirmDelete = async () => {
    const target = deleteTarget;
    if (!target || !onSessionDelete || confirmBusy) return;
    setConfirmBusy(true); setDeleteError('');
    try { await onSessionDelete(target.id); setDeleteError(''); setDeleteTarget(null); }
    catch (reason) { setDeleteError(reason instanceof Error ? reason.message : '删除失败，请重试'); }
    finally { setConfirmBusy(false); }
  };
  const scrollMessages = (direction: 'top' | 'bottom') => {
    messagesRef.current?.scrollTo({ top: direction === 'top' ? 0 : messagesRef.current.scrollHeight, behavior: 'smooth' });
  };
  const activeMessages = activeSession?.messages ?? [];
  const openImagePreview = (image: Pick<ImagePreview, 'src' | 'alt'>) => {
    const sidebar = sidebarRef.current;
    if (!sidebar) { setImagePreview(image); return; }
    setImagePreview({ ...image, theme: readAgentTheme(sidebar) });
  };

  const openDocumentPreview = (document: Omit<DocumentPreview, 'theme'>) => setDocumentPreview({ ...document, theme: sidebarRef.current ? readAgentTheme(sidebarRef.current) : undefined });
  const content = <DocumentPreviewContext.Provider value={openDocumentPreview}><ImagePreviewContext.Provider value={openImagePreview}><div className={`darl-agent-expanded-backdrop${expanded ? ' is-visible' : ''}`} aria-hidden="true" onClick={() => setExpanded(false)} /><aside ref={sidebarRef} style={embedded && expanded ? expandedTheme : undefined} className={`darl-agent-sidebar${embedded ? ' darl-agent-sidebar--embedded' : ''}${expanded ? ' darl-agent-sidebar--expanded' : ''} ${className}`} role={expanded ? 'dialog' : 'complementary'} aria-modal={expanded ? 'true' : undefined} aria-label="Agent 辅助侧栏" onKeyDown={(event) => { if (event.key === 'Escape') { setPicker(null); setExpanded(false); } }}>
    <header className="darl-agent-header">
      {view === 'history' ? <Button variant="ghost" size="icon" aria-label="返回当前对话" onClick={() => setView('chat')}><ArrowLeft size={17} /></Button> : <span className="darl-agent-brand-mark">{selectedAgent ? <AgentAvatar agent={selectedAgent} /> : <Bot size={17} />}</span>}
      <div className="darl-agent-heading"><strong>{view === 'history' ? '历史记录' : selectedAgent?.name || (agentId ? 'Agent 不可用' : '网站助手')}</strong>{view === 'chat' && <span><i />辅助 Agent</span>}</div>
      <div className="darl-agent-header-actions">
        {view === 'chat' && <Button variant="ghost" size="icon" aria-label="新开对话" title="新开对话" onClick={createSession}><Plus size={17} /></Button>}
        {view === 'chat' && <Button variant="ghost" size="icon" aria-label="查看历史记录" title="历史记录" onClick={() => setView('history')}><History size={17} /></Button>}
        {view === 'chat' && <Button variant="ghost" size="icon" aria-label={expanded ? '收起对话' : '展开对话'} title={expanded ? '收起对话' : '展开对话'} onClick={() => { if (!expanded && sidebarRef.current) setExpandedTheme(readAgentTheme(sidebarRef.current)); setExpanded((value) => !value); }}>{expanded ? <Minimize2 size={17} /> : <Maximize2 size={17} />}</Button>}
        {view === 'history' && <Button variant="ghost" size="sm" onClick={createSession}><Plus size={14} />新对话</Button>}
        {!embedded && <Button variant="ghost" size="icon" aria-label="关闭 Agent 侧栏" title="关闭" onClick={() => onOpenChange(false)}><X size={17} /></Button>}
      </div>
    </header>

    {view === 'history' ? <section className="darl-agent-history" aria-label="对话历史">
      <label className="darl-agent-search"><Search size={15} /><input value={historyQuery} onChange={(event) => setHistoryQuery(event.target.value)} placeholder="搜索对话" aria-label="搜索对话" /></label>
      {filteredSessions.map((session) => renamingId === session.id ? <form key={session.id} className="darl-agent-history-row darl-agent-history-row--editing" onSubmit={(event) => { event.preventDefault(); void saveRename(session.id); }}><input aria-label="会话名称" autoFocus value={renameDraft} onChange={(event) => setRenameDraft(event.target.value)} onKeyDown={(event) => { if (event.key === 'Escape') setRenamingId(null); }} /><Button size="sm" type="submit">保存</Button><Button variant="ghost" size="sm" type="button" onClick={() => setRenamingId(null)}>取消</Button></form> : <div key={session.id} className={`darl-agent-history-row${session.id === activeSession?.id ? ' is-active' : ''}`} aria-current={session.id === activeSession?.id ? 'page' : undefined}><button type="button" className="darl-agent-history-select" onClick={() => { onSessionChange?.(session.id); setView('chat'); }}><span><strong>{session.title}</strong><small>{session.messages.at(-1)?.content || session.messagePreview || '暂无消息'}</small></span><time>{session.updatedAt || ''}</time></button><div className="darl-agent-history-actions">{onSessionRename && <Button variant="ghost" size="icon" aria-label={`重命名 ${session.title}`} title="重命名" onClick={() => beginRename(session)}><Pencil size={14} /></Button>}{onSessionDelete && <Button variant="ghost" size="icon" className="darl-agent-history-delete" aria-label={`删除 ${session.title}`} title="删除" onClick={(event) => requestDelete(session, event.currentTarget)}><Trash2 size={14} /></Button>}</div></div>)}
      {!filteredSessions.length && <p className="darl-agent-empty">没有匹配的对话</p>}
    </section> : <>
      <section ref={messagesRef} className="darl-agent-messages" aria-live="polite" onScroll={(event) => { const element = event.currentTarget; followOutput.current = element.scrollHeight - element.scrollTop - element.clientHeight < 80; }}>{messageHeader}
        {!activeMessages.length && <div className="darl-agent-empty-state"><span className="darl-agent-empty-icon"><Sparkles size={22} /></span><h2>需要我帮你做什么？</h2><p>输入 @ 联系其他 Agent，或引用应用和 Skill。</p></div>}
        {activeMessages.map((message) => <article key={message.id} className={`darl-agent-message darl-agent-message--${message.role}`}>
          <div className="darl-agent-message-label">{message.role === 'user' ? '你' : 'Agent'}</div>
          <div className="darl-agent-message-body">{message.role === 'assistant' && <ExecutionTimeline events={message.timeline} calls={message.toolCalls} streaming={message.streaming} error={message.error} onCopyCode={(code) => void copy(code, `${message.id}-code`)} />}{message.streaming && !message.content && !message.outputs?.length && !hasExecutionActivity(message.timeline, message.toolCalls) && <span role="status"><LoaderCircle size={14} className="darl-agent-spin" /> 正在生成…</span>}{message.role === 'assistant' ? <Markdown content={message.content || speechTranscript(message.outputs)} onCopyCode={(code) => void copy(code, `${message.id}-code`)} /> : <p><ReferenceText value={message.content} /></p>}{message.error && <AgentErrorCard error={message.error} />}{message.attachments?.map((attachment, index) => { const name = attachmentName(attachment); const fileId = typeof attachment === 'string' ? undefined : attachment.fileId; const url = typeof attachment !== 'string' && attachment.url ? attachment.url : fileId ? `/api/files/${fileId}` : undefined; const isImage = typeof attachment !== 'string' && (!attachment.type || attachment.type.startsWith('image/')); return isImage && url && /^(?:data:image\/|https?:\/\/|\/api\/files\/)/.test(url) ? <figure className="darl-agent-image-attachment" key={`${name}-${index}`}><button type="button" className="darl-agent-image-trigger" onClick={() => openImagePreview({ src: url, alt: name })} title="点击放大预览"><img src={url} alt={name} loading="lazy" /></button></figure> : <span className="darl-agent-chip" key={`${name}-${index}`}><Paperclip size={12} />{fileId ? <a href={attachmentDownloadUrl(attachment, fileId)} onClick={(event) => { const fileUrl = `/api/files/${fileId}?download=1`; if (isMarkdownFile(name, fileUrl) && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) { event.preventDefault(); openDocumentPreview({ url: fileUrl, name }); } }}>{name}</a> : name}</span>; })}</div>
          {message.role === 'assistant' && message.content && message.outputs?.some((output) => output.output_type === 'speech') && <details className="darl-agent-speech-transcript"><summary>语音内容</summary><p>{speechTranscript(message.outputs)}</p></details>}
          {message.role === 'assistant' && voice && message.outputs?.some((output) => output.output_type === 'speech') && <div className="darl-agent-message-actions"><Button variant="ghost" size="sm" aria-label={speechState.id === message.id && ['buffering', 'playing'].includes(speechState.state) ? '停止语音' : '播放语音'} onClick={() => speechState.id === message.id && ['buffering', 'playing'].includes(speechState.state) ? stopSpeech() : (() => { player.stop(); void player.prepare().catch(() => {}); for (const output of message.outputs || []) if (output.output_type === 'speech') player.enqueue(output.content, voice.voiceId, message.id); })()}><Volume2 size={14} />{speechState.id === message.id && speechState.state === 'buffering' ? '缓冲中 · 停止' : speechState.id === message.id && speechState.state === 'playing' ? '播放中 · 停止' : '播放语音'}</Button></div>}
          {renderMessageActions?.(message)}{message.role === 'assistant' && !message.streaming && <div className="darl-agent-message-actions"><Button variant="ghost" size="sm" onClick={() => void copy(message.content || speechTranscript(message.outputs), message.id)}><Clipboard size={13} />{copyState === message.id ? '已复制' : '复制'}</Button>{onRegenerate && <Button variant="ghost" size="sm" disabled={isGenerating} onClick={() => onRegenerate(message.id)}><RefreshCw size={13} />重新生成</Button>}</div>}
        </article>)}
        <div className="darl-agent-scroll-controls" aria-label="消息导航"><Button variant="ghost" size="icon" aria-label="滚动到顶部" title="滚动到顶部" onClick={() => scrollMessages('top')}><ArrowUp size={15} /></Button><Button variant="ghost" size="icon" aria-label="滚动到底部" title="滚动到底部" onClick={() => scrollMessages('bottom')}><ArrowDown size={15} /></Button></div>
      </section>
      <footer className="darl-agent-composer-shell">{composerHeader}
        {voice && <div className="darl-agent-voice-controls">
          <Switch aria-label="语音回复" checked={voice.enabled} onChange={(event) => { player.stop(); if (event.target.checked) void player.prepare().catch(() => {}); voice.onEnabledChange(event.target.checked); if (event.target.checked && !voice.voiceId) openVoicePicker(); }}>语音回复</Switch>
          <Button variant="ghost" size="sm" ref={voiceButtonRef} onClick={openVoicePicker} title="选择音色" aria-haspopup="dialog" aria-expanded={picker === 'voices'}><Volume2 size={14} /><span>{voice.voiceName || '选择音色'}</span></Button>
          {['playing', 'buffering'].includes(speechState.state) && <Button variant="ghost" size="icon" aria-label="停止语音播放" onClick={stopSpeech}><VolumeX size={15} /></Button>}
          {voice.transcribe && <AgentVoiceInput key={draftKey} transcribe={voice.transcribe} onBegin={() => player.stop()} onBusyChange={setVoiceInputBusy} disabled={isGenerating || pending} onText={(text) => setDraft([latestDraft.current, text].filter(Boolean).join('\n'))} />}
        </div>}
        {speechState.state === 'error' && <p role="alert">{speechState.error}</p>}


        <div className="darl-agent-contexts">{files.map((file, index) => { const preview = attachmentPreviews[`${file.name}:${file.size}:${file.lastModified}`]; return <span className="darl-agent-chip darl-agent-attachment-chip" key={index}>{preview && <img src={preview} alt="" /> }{!preview && <Paperclip size={12} />}{!preview && file.name}<button aria-label={`移除附件 ${file.name}`} onClick={() => setAttachments((current) => ({ ...current, [draftKey]: files.filter((_, i) => i !== index) }))}><X size={12} /></button></span>; })}</div><div className="darl-agent-composer"><AgentComposerInput references={references} onReference={onReference} agents={agents.filter(agent => agent.id !== agentId && agent.enabled !== false && agent.callable !== false)} applications={applications} skills={availableSkills} key={draftKey} value={draft} onChange={setDraft} onSubmit={() => void submit()} onPasteImages={addAttachments} insertion={insertion} onInserted={() => setInsertion(null)} />
          {approvalMode && onApprovalModeChange && <div className="darl-agent-approval-row"><ApprovalModeSelector value={approvalMode} onChange={onApprovalModeChange} disabled={isGenerating || pending || approvalModePending} /></div>}
          <div className="darl-agent-composer-controls"><Button variant="ghost" size="icon" aria-label="添加材料或能力" aria-expanded={picker === 'add'} onClick={() => setPicker(picker === 'add' ? null : 'add')}><Plus size={17} /></Button><span className="darl-agent-composer-spacer" />{models.length > 0 && <Button variant="outline" size="sm" className="darl-agent-model-trigger" title="选择模型与思考等级" aria-expanded={picker === 'models'} onClick={() => setPicker(picker === 'models' ? null : 'models')}><span>{selectedModel?.name || '选择模型'}</span>{effort && <small>· {effort}</small>}<ChevronDown size={13} /></Button>}{isGenerating ? <Button variant="outline" size="icon" aria-label="停止生成" onClick={() => { player.stop(); onStop?.(); }}><Square size={14} /></Button> : <Button variant="default" size="icon" aria-label="发送消息" disabled={(!draft.trim() && !files.length) || !onSend || !activeSession || pending || approvalModePending} onClick={submit}><Send size={16} /></Button>}</div>
        </div>
        {composerFooter}{error && <p role="alert">{error}</p>}<small className="darl-agent-composer-note">@ Agent、应用或 Skill · Enter 发送</small>
      </footer>
      {copyNotice && <div className="darl-agent-copy-toast" role="status" aria-live="polite">{copyNotice}</div>}
    </>}

    {picker === 'add' && <Picker title="添加" onClose={closePicker}><div className="darl-agent-add-list"><button type="button" onClick={() => openFilePicker('file')}><Paperclip size={16} /><span><strong>{uploadAttachment ? '上传文件' : '上传图片'}</strong><small>{uploadAttachment ? '上传图片、文档或其他任务材料' : '支持 PNG、JPEG、WebP 和 GIF'}</small></span></button><button type="button" onClick={() => setPicker('apps')}><Wrench size={16} /><span><strong>选择应用</strong><small>启用网站的 MCP 工具</small></span></button><button type="button" onClick={() => { setSkillFilter('all'); setSkillQuery(''); setPicker('skills'); }}><Sparkles size={16} /><span><strong>选择 Skill</strong><small>选择可复用的工作流程</small></span></button></div></Picker>}
    {picker === 'apps' && <Picker title="选择应用" onClose={closePicker}><div className="darl-agent-picker-list">{applications.map((app) => <button key={app.id} type="button" className="darl-agent-picker-row" aria-pressed={applicationIds.includes(app.id)} disabled={app.status !== undefined && app.status !== 'connected'} onClick={() => toggleApplication(app.id)}><span className="darl-agent-picker-icon">{app.icon || <Wrench size={15} />}</span><span className="darl-agent-picker-copy"><strong>{app.name}</strong><small>{app.description || `${app.tools?.length || 0} 个工具`} · {statusText(app.status)}</small></span>{applicationIds.includes(app.id) && <Check size={16} />}</button>)}{!applications.length && <p className="darl-agent-empty">暂无可用应用</p>}</div></Picker>}
    {picker === 'skills' && <Picker title="选择 Skill" onClose={closePicker} className="darl-agent-skill-picker"><div className="darl-agent-picker-toolbar"><span>已安装的 Skill</span><span className="darl-agent-picker-toolbar-actions">{onSkillCreate && <button type="button" disabled={isGenerating || pending || approvalModePending} onClick={() => { setPicker(null); void Promise.resolve().then(onSkillCreate).catch(reason => setError(reason instanceof Error ? reason.message : '无法开始创建 Skill')); }}><Sparkles size={14} />通过对话创建</button>}<button type="button" onClick={() => openFilePicker('skill')}><Upload size={14} />上传</button></span></div>
      <label className="darl-agent-manager-search"><Search /><input value={skillQuery} onChange={event => setSkillQuery(event.target.value)} placeholder="搜索名称或原名" aria-label="搜索 Skill" /></label>
      <div className="darl-agent-skill-picker-filters" role="group" aria-label="Skill 分类">{skillGroups.map(group => <button key={group.id} type="button" aria-pressed={skillFilter === group.id} onClick={() => setSkillFilter(group.id)}>{group.label}<span>{group.items.length}</span></button>)}</div>
      <div className="darl-agent-picker-list">{visibleSkills.map((skill) => <button key={skill.id} type="button" className="darl-agent-picker-row" aria-pressed={skillIds.includes(skill.id)} onClick={() => toggleSkill(skill.id)}><span className="darl-agent-picker-icon darl-agent-picker-icon--skill"><Sparkles size={15} /></span><span className="darl-agent-picker-copy"><strong>{skill.name}</strong><small>{skill.description || '可复用的 Agent 工作流程'}{skill.version ? ` · v${skill.version}` : ''}</small></span>{skillIds.includes(skill.id) && <Check size={16} />}</button>)}{!visibleSkills.length && <p className="darl-agent-empty" role="status">{skillSearch ? '没有匹配的 Skill' : skillFilter === 'favorite' ? '暂无收藏的 Skill' : skillFilter === 'mine' ? '暂无自己创建的 Skill' : skillFilter === 'builtin' ? '暂无内置 Skill' : '暂无 Skill'}</p>}</div></Picker>}
    {picker === 'models' && <Picker title="模型与思考等级" onClose={closePicker}><div className="darl-agent-picker-list">{models.map((model) => <button key={model.id} type="button" className="darl-agent-picker-row" aria-pressed={model.id === selectedModel?.id} onClick={() => { setModelId(model.id); if (!model.reasoningEfforts?.length) setPicker(null); }}><span className="darl-agent-picker-icon"><Bot size={15} /></span><span className="darl-agent-picker-copy"><strong>{model.name}</strong><small>{model.description || '对话模型'}</small></span>{model.id === selectedModel?.id && <Check size={16} />}</button>)}</div>{supportedEfforts.length > 0 && <fieldset className="darl-agent-model-efforts"><legend>思考等级</legend><div className="darl-agent-effort-list">{supportedEfforts.map(value => <Button key={value} variant="ghost" size="sm" aria-pressed={value === effort} onClick={() => { setEffort(value); setPicker(null); }}>{value}{value === effort && <Check size={14} />}</Button>)}</div></fieldset>}</Picker>}
    <input ref={fileInput} aria-label="选择上传文件" type="file" hidden multiple={uploadKind === 'file'} onChange={(event) => { const files = Array.from(event.target.files ?? []); const first = files[0]; if (uploadKind === 'skill' && files.length) void Promise.resolve().then(async () => { const imported = await importSkillPackage(files); await onSkillImport?.(imported); if (first) await onSkillUpload?.(first); setLocalSkills((current) => [...current.filter((item) => item.id !== imported.id), imported]); }).catch((reason) => setError(reason instanceof Error ? reason.message : '导入失败')); if (uploadKind === 'file' && files.length) addAttachments(files); setPicker(null); event.currentTarget.value = ''; }} accept={uploadKind === 'skill' ? skillFileAccept : uploadAttachment ? undefined : 'image/*,.png,.jpg,.jpeg,.webp,.gif'} />
  </aside>
    {userInput ? <InteractiveConfirmDialog
        key={pendingConfirmation?.id}
        open={Boolean(onUserInput)}
        onOpenChange={(open) => { if (!open) void confirmAction(false); }}
        title={userInput.title}
        description={userInput.description}
        questions={userInput.questions}
        style={questionTheme}
        confirmText="提交选择"
        onConfirm={(answers) => confirmAction(true, answers)}
        details={confirmError && <p role="alert">{confirmError}</p>}
      /> : <InteractiveConfirmDialog
      key={pendingConfirmation?.id ?? 'no-confirmation'}
      open={Boolean(pendingConfirmation && onToolConfirm)}
      onOpenChange={(open) => { if (!open) void confirmAction(false); }}
      title={isMediaConfirmation ? `确认生成${mediaKind}` : '确认执行工具'}
      description={isMediaConfirmation ? '请核对以下生成设置，提交后将开始生成并可能产生费用。' : '请核对以下工具、操作与参数。'}
      questions={[]}
      showCancel
      cancelText="拒绝"
      cancelVariant="destructive"
      confirmText={isMediaConfirmation ? '确认生成' : '允许执行'}
      className={isMediaConfirmation ? 'darl-agent-media-confirm darl-agent-approval-confirm' : 'darl-agent-approval-confirm'}
      onConfirm={() => confirmAction(true)}
      details={pendingConfirmation && (isMediaConfirmation
        ? <div className="darl-media-confirm">
          <dl className="darl-media-confirm-summary">
            <div><dt>模型</dt><dd>{mediaModelLabel}</dd></div>
            {mediaRows.map((row) => <div key={row.key}><dt>{row.label}</dt><dd>{row.value}</dd></div>)}
          </dl>
          <div className="darl-media-confirm-prompt">
            <span>生成内容</span>
            <p>{String(pendingInput.prompt ?? '')}</p>
          </div>
          {confirmError && <p role="alert" className="darl-confirm-error">{confirmError}</p>}
          {confirmBusy && <p role="status" className="darl-confirm-status">正在提交审批…</p>}
        </div>
        : <div className="darl-agent-confirm-details">
          <div><strong>应用</strong><span>{pendingConfirmation.appName}</span></div>
          <div><strong>工具</strong><span>{pendingConfirmation.toolTitle || pendingConfirmation.toolName}</span></div>
          <div><strong>风险</strong><span>{pendingConfirmation.risk === 'dangerous' ? '危险操作' : pendingConfirmation.risk === 'write' ? '写操作' : pendingConfirmation.risk === 'read' ? '只读' : '—'}</span></div>
          <div className="darl-agent-confirm-input"><strong>调用参数</strong><pre>{formatToolValue(pendingConfirmation.input)}</pre></div>
          {confirmError && <p role="alert">{confirmError}</p>}
          {confirmBusy && <p role="status">正在提交审批…</p>}
        </div>)}
    />}
    {voice && <DialogPrimitive.Root open={picker === 'voices'} onOpenChange={(next) => { if (!next) closeVoicePicker(); }}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="darl-agent-confirm-overlay" />
        <DialogPrimitive.Content className="darl-agent-confirm darl-agent-voice-dialog" style={voiceTheme} onKeyDown={(event) => event.stopPropagation()} onCloseAutoFocus={(event) => { event.preventDefault(); voiceButtonRef.current?.focus(); }}>
          <header className="darl-agent-voice-dialog-header"><div><DialogPrimitive.Title>选择音色</DialogPrimitive.Title><DialogPrimitive.Description>找到适合你的声音，试听后点击音色即可选择。</DialogPrimitive.Description></div><DialogPrimitive.Close asChild><Button variant="ghost" size="icon" aria-label="关闭音色选择"><X size={20} /></Button></DialogPrimitive.Close></header>
          {speechState.state === 'error' && speechState.id?.startsWith('preview:') && <p className="darl-agent-confirm-error" role="alert">{speechState.error}</p>}
          <AgentVoicePicker voice={voice} previewId={['playing', 'buffering'].includes(speechState.state) ? speechState.id.replace(/^preview:/, '') : undefined} onPreview={(item) => { if (speechState.id === `preview:${item.id}` && ['playing', 'buffering'].includes(speechState.state)) player.stop(); else if (item.previewUrl) player.playSample(item.previewUrl, `preview:${item.id}`); }} />
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>}
    <ImageLightbox image={imagePreview} onClose={() => setImagePreview(null)} />
    <MarkdownPreview document={documentPreview} onClose={() => setDocumentPreview(null)} onCopyCode={(code) => void copy(code, 'document-code')} />
    <DialogPrimitive.Root open={Boolean(deleteTarget)} onOpenChange={(next) => { if (!next && !confirmBusy) setDeleteTarget(null); }}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="darl-agent-confirm-overlay" />
        <DialogPrimitive.Content className="darl-agent-confirm" style={deleteTheme} aria-describedby={undefined} onKeyDown={(event) => { event.stopPropagation(); if (event.key === 'Enter' && !confirmBusy) { event.preventDefault(); void confirmDelete(); } }} onCloseAutoFocus={(event) => { event.preventDefault(); deleteButtonRef.current?.focus(); }}>
          <div className="darl-agent-confirm-icon"><Trash2 size={18} /></div>
          <DialogPrimitive.Title className="darl-agent-confirm-title">删除对话</DialogPrimitive.Title>
          {deleteTarget && <p className="darl-agent-confirm-text">确定删除「{deleteTarget.title}」？该对话的消息记录将被移除，无法恢复。</p>}
          {deleteError && <p className="darl-agent-confirm-error" role="alert">{deleteError}</p>}
          <div className="darl-agent-confirm-actions">
            <DialogPrimitive.Close asChild><Button variant="ghost" size="sm" disabled={confirmBusy}>取消</Button></DialogPrimitive.Close>
            <Button variant="default" size="sm" className="darl-agent-danger-button" disabled={confirmBusy} onClick={() => void confirmDelete()}>{confirmBusy ? '删除中…' : '删除'}</Button>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  </ImagePreviewContext.Provider></DocumentPreviewContext.Provider>;
  return embedded && expanded ? createPortal(content, document.body) : content;
}

export type { AgentApplication, AgentAttachment, AgentImageAttachment, AgentMessage, AgentModel, AgentSession, AgentSkill, AgentTool, AgentToolCall } from './types';
