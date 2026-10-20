import { AgentComposerInput, ReferenceText, referenceIds } from './AgentComposerInput';
import { createContext, useContext, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { AlertCircle, ArrowDown, ArrowLeft, ArrowUp, Bot, Check, ChevronDown, ChevronRight, Clipboard, Clock3, Copy, History, LoaderCircle, Maximize2, Minimize2, Paperclip, Pencil, Plus, RefreshCw, Search, Send, Sparkles, Square, Trash2, Upload, Wrench, X } from 'lucide-react';
import ReactMarkdown, { type Components } from 'react-markdown';
import rehypeSanitize from 'rehype-sanitize';
import remarkGfm from 'remark-gfm';
import { Button } from '../ui/Button';
import { InteractiveConfirmDialog } from '../interactive-confirm-dialog/InteractiveConfirmDialog';
import type { AgentApplication, AgentAttachment, AgentErrorInfo, AgentExecutionEvent, AgentImageAttachment, AgentSession, AgentSidebarProps, AgentSkill, AgentToolCall } from './types';
import { importSkillPackage } from './skill-package';

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
  const components: Components = {
    a: ({ href, children }) => <a href={href} target={href?.startsWith('http') ? '_blank' : undefined} rel={href?.startsWith('http') ? 'noreferrer' : undefined}>{children}</a>,
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

function ToolCallCard({ call }: { call: AgentToolCall }) {
  const status = { pending: '等待调用', running: '执行中', retrying: '重试中', success: '已完成', error: '调用失败', confirmation: '等待确认' }[call.status];
  const StatusIcon = call.status === 'running' || call.status === 'retrying' ? LoaderCircle : call.status === 'error' ? AlertCircle : call.status === 'success' ? Check : Wrench;
  const delegationTask = call.appId.startsWith('agent:') && call.input && typeof call.input === 'object' && 'task' in call.input && typeof call.input.task === 'string' ? call.input.task : '';
  return <article className={`darl-agent-tool-call darl-agent-tool-call--${call.status}`}>
    <div className="darl-agent-tool-summary">
      <span className="darl-agent-tool-icon"><StatusIcon size={14} className={call.status === 'running' || call.status === 'retrying' ? 'darl-agent-spin' : undefined} /></span>
      <span className="darl-agent-tool-title"><strong>{call.agentId ? `子 Agent · ${call.appName}` : call.appName}</strong><span>{call.toolTitle || call.toolName}</span></span>
      <span className="darl-agent-tool-status">{status}</span>
    </div>
    {delegationTask && <div className="darl-agent-tool-detail">
      {delegationTask && <div><span>委派任务</span><pre>{delegationTask}</pre></div>}
    </div>}
    {call.errorInfo ? <AgentErrorCard error={call.errorInfo} /> : call.error && <p className="darl-agent-tool-error">{call.error}</p>}
  </article>;
}

function AgentErrorCard({ error }: { error: AgentErrorInfo }) {
  const stage = { model: '模型请求', 'mcp-connection': 'MCP 连接', 'mcp-tool': 'MCP 工具', delegation: '子 Agent 委派', 'tool-validation': '工具参数', validation: '请求校验', cancellation: '已取消', timeout: '请求超时' }[error.stage];
  return <div className="darl-agent-error-card" role="alert"><div className="darl-agent-error-card-head"><AlertCircle size={15} /><strong>{stage}失败</strong><span>{error.retryable ? '可以重试' : '请修改后重试'}</span></div><p>{error.message}</p><div className="darl-agent-error-card-meta"><span>错误码：{error.code}</span>{error.requestId && <span>requestId：{error.requestId}</span>}{error.runId && <span>runId：{error.runId}</span>}</div><small>{error.suggestion}</small></div>;
}

const executionStatusText: Record<AgentExecutionEvent['status'], string> = {
  pending: '等待调用', started: '已开始', running: '执行中', retrying: '重试中', confirmation: '等待确认', success: '已完成', error: '失败', cancelled: '已取消', timeout: '已超时',
};

function executionSourceText(event: AgentExecutionEvent) {
  return event.source === 'tool' ? 'MCP 工具' : event.agentId ? '子 Agent' : '主 Agent';
}

function executionDuration(event: AgentExecutionEvent, now: number, events: AgentExecutionEvent[] = []) {
  if (typeof event.durationMs === 'number' && Number.isFinite(event.durationMs)) return event.durationMs;
  const key = event.toolCallId || event.runId || event.id;
  const terminal = [...events].reverse().find((candidate) => (candidate.toolCallId || candidate.runId || candidate.id) === key && ['success', 'error', 'cancelled', 'timeout'].includes(candidate.status) && typeof candidate.durationMs === 'number');
  if (terminal?.durationMs !== undefined) return terminal.durationMs;
  const start = Date.parse(event.startedAt || event.timestamp);
  if (!Number.isFinite(start)) return 0;
  return Math.max(0, now - start);
}

function formatDuration(milliseconds: number) {
  const seconds = Math.floor(milliseconds / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${String(seconds % 60).padStart(2, '0')}s`;
}

function hasSubAgentActivity(events: AgentExecutionEvent[] | undefined) {
  return Boolean(events?.some((event) => event.source === 'agent' && Boolean(event.agentId)));
}

function ExecutionTimeline({ events, calls = [] }: { events: AgentExecutionEvent[]; calls?: AgentToolCall[] }) {
  const [expanded, setExpanded] = useState(false);
  const hasLiveEvents = events.some((event) => ['pending', 'started', 'running', 'retrying', 'confirmation'].includes(event.status));
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!hasLiveEvents) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [hasLiveEvents]);
  if (!events.length) return null;
  const activityMap = new Map<string, AgentExecutionEvent[]>();
  events.forEach((event) => {
    const key = event.toolCallId || event.runId || event.id;
    activityMap.set(key, [...(activityMap.get(key) || []), event]);
  });
  const activities = [...activityMap.entries()].map(([key, activityEvents]) => ({ key, events: activityEvents, first: activityEvents[0], latest: activityEvents.at(-1)! }));
  const runDepth = new Map<string, number>();
  events.filter((event) => event.source === 'agent').forEach((event) => {
    if (!event.runId || runDepth.has(event.runId)) return;
    const parentDepth = event.parentRunId ? runDepth.get(event.parentRunId) : undefined;
    runDepth.set(event.runId, Math.min(3, (parentDepth ?? -1) + 1));
  });
  const current = events.at(-1)!;
  return <section className={`darl-agent-execution${expanded ? ' is-expanded' : ''}`} aria-label="Agent 执行时间线">
    <button type="button" className="darl-agent-execution-summary" aria-expanded={expanded} onClick={() => setExpanded((value) => !value)}>
      <span className="darl-agent-execution-icon"><Clock3 size={14} /></span>
      <span className="darl-agent-execution-heading"><strong>执行时间线</strong><small>{activities.length} 个活动 · {executionStatusText[current.status]}</small></span>
      <span className="darl-agent-execution-duration">{formatDuration(executionDuration(current, now, events))}</span><ChevronDown size={14} className={expanded ? 'is-open' : undefined} />
    </button>
    {expanded && <ol className="darl-agent-execution-list">
      {activities.map((activity) => {
        const { first, latest, events: activityEvents } = activity;
        const call = latest.toolCallId ? calls.find((item) => item.id === latest.toolCallId) : undefined;
        const confirmation = latest.status === 'confirmation' && call ? { ...call, status: 'confirmation' as const } : undefined;
        const isLive = ['pending', 'started', 'running', 'retrying', 'confirmation'].includes(latest.status);
        const transitions = activityEvents.map((event) => executionStatusText[event.status]).filter((label, index, values) => index === 0 || label !== values[index - 1]);
        const retryCount = activityEvents.filter((event) => event.status === 'retrying').length;
        const hasDetails = Boolean(first.summary || latest.error || confirmation || transitions.length > 1);
        const depth = Math.min(3, (runDepth.get(latest.runId || '') || 0) + (latest.source === 'tool' ? 1 : 0));
        return <li key={activity.key} className={`darl-agent-execution-item darl-agent-execution-item--${latest.status}${isLive ? '' : ' is-history'}`} style={{ '--darl-agent-depth': depth } as CSSProperties}>
          <div className="darl-agent-execution-row"><span className="darl-agent-execution-dot">{isLive && (latest.status === 'running' || latest.status === 'retrying') ? <LoaderCircle size={12} className="darl-agent-spin" /> : latest.status === 'success' ? <Check size={12} /> : latest.status === 'error' || latest.status === 'cancelled' || latest.status === 'timeout' ? <AlertCircle size={12} /> : <ChevronRight size={12} />}</span><span className="darl-agent-execution-copy"><strong>{executionSourceText(latest)}</strong><span>{latest.name}</span></span>{retryCount > 0 && <span className="darl-agent-execution-retry">重试 {retryCount}</span>}<span className="darl-agent-execution-state">{executionStatusText[latest.status]}</span><time>{formatDuration(executionDuration(latest, now, events))}</time></div>
          {hasDetails && <details className="darl-agent-execution-details"><summary>查看详情</summary>{first.summary && <p>{first.summary}</p>}{transitions.length > 1 && <small className="darl-agent-execution-transitions">{transitions.join(' → ')}</small>}{latest.error && <div className="darl-agent-execution-error"><strong>{latest.error.message}</strong><small>{latest.error.code} · {latest.error.suggestion}</small></div>}{confirmation && <ToolCallCard call={confirmation} />}</details>}
        </li>;
      })}
    </ol>}
  </section>;
}

function Picker({ title, children, onClose, className = '' }: { title: string; children: ReactNode; onClose: () => void; className?: string }) {
  return <div className={`darl-agent-picker ${className}`.trim()} role="dialog" aria-label={title}><div className="darl-agent-picker-head"><strong>{title}</strong><Button variant="ghost" size="icon" aria-label={`关闭${title}`} onClick={onClose}><X size={16} /></Button></div>{children}</div>;
}

function AgentPickerAvatar({ agent }: { agent: { name: string; avatar?: string } }) {
  const value = agent.avatar;
  if (value?.startsWith('/') || value?.startsWith('http') || value?.startsWith('data:image/')) return <img className="darl-agent-picker-avatar" src={value} alt="" />;
  return <span className="darl-agent-picker-avatar" aria-hidden="true">{value || agent.name.slice(0, 1).toUpperCase()}</span>;
}

function statusText(status: AgentApplication['status']): string {
  return status === 'connected' ? '已连接' : status === 'needs-auth' ? '需要授权' : '未连接';
}

export function AgentSidebar({ open, onOpenChange, sessions, activeSessionId, onSessionChange, onSessionRename, onSessionDelete, onNewSession, onSend, onRegenerate, onToolConfirm, isGenerating = false, onStop, applications = [], skills = emptySkills, onSkillUpload, onSkillImport, onFileUpload, uploadAttachment, models = [], agents = [], selectedAgentId: controlledAgentId, onSelectedAgentIdChange, onSelectedApplicationIdsChange, onSelectedSkillIdsChange, selectedModelId: controlledModelId, onSelectedModelIdChange, selectedReasoningEffort: controlledEffort, onSelectedReasoningEffortChange, className = '' }: AgentSidebarProps) {
  const [view, setView] = useState<'chat' | 'history'>('chat');
  const [confirmBusy, setConfirmBusy] = useState(false);
  const [handledConfirmation, setHandledConfirmation] = useState<string | null>(null);
  const [confirmError, setConfirmError] = useState('');
  const [expanded, setExpanded] = useState(false);
  const [picker, setPicker] = useState<'add' | 'apps' | 'skills' | 'models' | 'effort' | 'agents' | null>(null);
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
  const [localAgentId, setLocalAgentId] = useState<string | null>(null);
  const [localEffort, setLocalEffort] = useState(models[0]?.reasoningEfforts?.[0] || '中');
  const [attachments, setAttachments] = useState<Record<string, File[]>>({});
  const [attachmentPreviews, setAttachmentPreviews] = useState<Record<string, string>>({});
  const attachmentPreviewUrls = useRef<Record<string, string>>({});
  const [uploadKind, setUploadKind] = useState<'file' | 'skill'>('skill');
  const [imagePreview, setImagePreview] = useState<ImagePreview | null>(null);
  const sidebarRef = useRef<HTMLElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const messagesRef = useRef<HTMLElement>(null);
  const followOutput = useRef(true);
  const copyTimer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(copyTimer.current), []);
  useEffect(() => { if (!open) setImagePreview(null); }, [open]);
  useEffect(() => {
    const changed = skillsPropRef.current !== skills;
    if (changed) {
      skillsPropRef.current = skills;
      setLocalSkills(skills);
    }
  }, [skills]);
  const availableSkills = localSkills;
  const activeSession = sessions.find((session) => session.id === activeSessionId) ?? sessions[0];
  const modelId = controlledModelId ?? localModelId;
  const selectedModel = models.find((model) => model.id === modelId) ?? models[0];
  const selectableAgents = useMemo(() => agents.filter((agent) => (agent.type || 'main_agent') === 'main_agent' && agent.selectable !== false && agent.enabled !== false), [agents]);
  const requestedAgentId = controlledAgentId ?? localAgentId;
  const selectedAgent = selectableAgents.find((agent) => agent.id === requestedAgentId);
  const agentId = selectedAgent?.id;
  const supportedEfforts = selectedModel?.reasoningEfforts ?? [];
  const preferredEffort = controlledEffort ?? localEffort;
  const effort = supportedEfforts.includes(preferredEffort) ? preferredEffort : supportedEfforts[0];
  const draftKey = activeSession?.id ?? '';
  const draft = drafts[draftKey] ?? '';
  const applicationIds = referenceIds(draft, 'app');
  const skillIds = referenceIds(draft, 'skill');
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
  const setDraft = (value: string) => { setDrafts((current) => ({ ...current, [draftKey]: value })); onSelectedApplicationIdsChange?.(referenceIds(value, 'app')); onSelectedSkillIdsChange?.(referenceIds(value, 'skill')); };
  const filteredSessions = useMemo(() => sessions.filter((session) => `${session.title} ${session.messages.at(-1)?.content ?? ''}`.toLowerCase().includes(historyQuery.toLowerCase())), [historyQuery, sessions]);
  useEffect(() => { setError(''); setPicker(null); }, [activeSession?.id]);

  const pendingConfirmation = activeSession?.messages.flatMap(message => message.toolCalls || []).find(call => call.status === 'confirmation');
  const pendingInput = pendingConfirmation?.input && typeof pendingConfirmation.input === 'object' ? pendingConfirmation.input as Record<string, unknown> : {};
  const isMediaConfirmation = pendingConfirmation?.appId === 'builtin:media';
  const mediaKind = ['gpt-image-2', 'gpt-image-2.5', 'gemini-3-pro-image-preview'].includes(String(pendingInput.modelId)) ? '图片' : '视频';
  const mediaModelLabel = ({ 'gpt-image-2': 'GPT Image 2', 'gpt-image-2.5': 'GPT Image 2.5', 'gemini-3-pro-image-preview': 'Gemini 3 Pro Image Preview', 'minimax-h3-flash': 'MiniMax H3 Flash' } as Record<string, string>)[String(pendingInput.modelId)] ?? String(pendingInput.modelId || '—');
  const mediaRows = mediaOptionRows(pendingInput.options, mediaKind === '图片' ? 'image' : 'video');
  const confirmAction = async (approved: boolean) => {
    if (!pendingConfirmation || !onToolConfirm || confirmBusy) return;
    setConfirmBusy(true); setConfirmError('');
    try { await onToolConfirm(pendingConfirmation.id, approved); setHandledConfirmation(pendingConfirmation.id); }
    catch (reason) { setConfirmError(reason instanceof Error ? reason.message : '确认失败，请重试'); }
    finally { setConfirmBusy(false); }
  };
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
  const setAgentId = (id: string) => { setLocalAgentId(id || null); onSelectedAgentIdChange?.(id); setPicker(null); };
  const setEffort = (value: string) => { setLocalEffort(value); onSelectedReasoningEffortChange?.(value); };
  const copy = async (value: string, id: string) => { try { await navigator.clipboard.writeText(value); setCopyState(id); setCopyNotice('已复制'); window.clearTimeout(copyTimer.current); copyTimer.current = window.setTimeout(() => { setCopyState((current) => current === id ? '' : current); setCopyNotice(''); }, 1200); } catch { setError('复制失败，请手动选择文本复制'); } };
  const submit = async () => {
    const content = draft.trim();
    if ((!content && !files.length) || !activeSession || !onSend || isGenerating || submitting.current) return;
    submitting.current = true; setPending(true); setError('');
    try {
      const imageFiles = files.filter((file) => file.type.startsWith('image/'));
      const attachments: AgentImageAttachment[] = [];
      for (const file of imageFiles) attachments.push(await readImage(file));
      const uploadedFiles = uploadAttachment ? await Promise.all(files.map(uploadAttachment)) : [];
      await onSend({ sessionId: activeSession.id, content, applicationIds, skillIds, modelId: selectedModel?.id, reasoningEffort: effort, ...(agentId !== undefined ? { agentId: agentId || null } : {}), ...(files.length ? { files } : {}), ...(uploadedFiles.length ? { uploadedAttachments: uploadedFiles } : {}), ...(attachments.length ? { attachments } : {}) });
      setAttachments((current) => ({ ...current, [draftKey]: [] }));
      setDrafts((current) => current[draftKey] === draft ? { ...current, [draftKey]: '' } : current);
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
  const openFilePicker = (kind: 'file' | 'skill') => {
    setUploadKind(kind);
    const input = fileInput.current;
    if (!input) return;
    input.accept = kind === 'skill' ? skillFileAccept : 'image/*,.png,.jpg,.jpeg,.webp,.gif';
    input.multiple = kind === 'file';
    input.click();
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

  return <ImagePreviewContext.Provider value={openImagePreview}><div className={`darl-agent-expanded-backdrop${expanded ? ' is-visible' : ''}`} aria-hidden="true" onClick={() => setExpanded(false)} /><aside ref={sidebarRef} className={`darl-agent-sidebar${expanded ? ' darl-agent-sidebar--expanded' : ''} ${className}`} role={expanded ? 'dialog' : 'complementary'} aria-modal={expanded ? 'true' : undefined} aria-label="Agent 辅助侧栏" onKeyDown={(event) => { if (event.key === 'Escape') { setPicker(null); setExpanded(false); } }}>
    <header className="darl-agent-header">
      {view === 'history' ? <Button variant="ghost" size="icon" aria-label="返回当前对话" onClick={() => setView('chat')}><ArrowLeft size={17} /></Button> : <span className="darl-agent-brand-mark"><Bot size={17} /></span>}
      <div className="darl-agent-heading"><strong>{view === 'history' ? '历史记录' : '网站助手'}</strong>{view === 'chat' && <span><i />辅助 Agent</span>}</div>
      <div className="darl-agent-header-actions">
        {view === 'chat' && <Button variant="ghost" size="icon" aria-label="新开对话" title="新开对话" onClick={createSession}><Plus size={17} /></Button>}
        {view === 'chat' && <Button variant="ghost" size="icon" aria-label="查看历史记录" title="历史记录" onClick={() => setView('history')}><History size={17} /></Button>}
        {view === 'chat' && <Button variant="ghost" size="icon" aria-label={expanded ? '收起对话' : '展开对话'} title={expanded ? '收起对话' : '展开对话'} onClick={() => setExpanded((value) => !value)}>{expanded ? <Minimize2 size={17} /> : <Maximize2 size={17} />}</Button>}
        {view === 'history' && <Button variant="ghost" size="sm" onClick={createSession}><Plus size={14} />新对话</Button>}
        <Button variant="ghost" size="icon" aria-label="关闭 Agent 侧栏" title="关闭" onClick={() => onOpenChange(false)}><X size={17} /></Button>
      </div>
    </header>

    {view === 'history' ? <section className="darl-agent-history" aria-label="对话历史">
      <label className="darl-agent-search"><Search size={15} /><input value={historyQuery} onChange={(event) => setHistoryQuery(event.target.value)} placeholder="搜索对话" aria-label="搜索对话" /></label>
      {filteredSessions.map((session) => renamingId === session.id ? <form key={session.id} className="darl-agent-history-row darl-agent-history-row--editing" onSubmit={(event) => { event.preventDefault(); void saveRename(session.id); }}><input aria-label="会话名称" autoFocus value={renameDraft} onChange={(event) => setRenameDraft(event.target.value)} onKeyDown={(event) => { if (event.key === 'Escape') setRenamingId(null); }} /><Button size="sm" type="submit">保存</Button><Button variant="ghost" size="sm" type="button" onClick={() => setRenamingId(null)}>取消</Button></form> : <div key={session.id} className={`darl-agent-history-row${session.id === activeSession?.id ? ' is-active' : ''}`} aria-current={session.id === activeSession?.id ? 'page' : undefined}><button type="button" className="darl-agent-history-select" onClick={() => { onSessionChange?.(session.id); setView('chat'); }}><span><strong>{session.title}</strong><small>{session.messages.at(-1)?.content || '暂无消息'}</small></span><time>{session.updatedAt || ''}</time></button><div className="darl-agent-history-actions">{onSessionRename && <Button variant="ghost" size="icon" aria-label={`重命名 ${session.title}`} title="重命名" onClick={() => beginRename(session)}><Pencil size={14} /></Button>}{onSessionDelete && <Button variant="ghost" size="icon" className="darl-agent-history-delete" aria-label={`删除 ${session.title}`} title="删除" onClick={(event) => requestDelete(session, event.currentTarget)}><Trash2 size={14} /></Button>}</div></div>)}
      {!filteredSessions.length && <p className="darl-agent-empty">没有匹配的对话</p>}
    </section> : <>
      <section ref={messagesRef} className="darl-agent-messages" aria-live="polite" onScroll={(event) => { const element = event.currentTarget; followOutput.current = element.scrollHeight - element.scrollTop - element.clientHeight < 80; }}>
        {!activeMessages.length && <div className="darl-agent-empty-state"><span className="darl-agent-empty-icon"><Sparkles size={22} /></span><h2>需要我帮你做什么？</h2><p>选择应用和 Skill，把它们插入消息中。</p></div>}
        {activeMessages.map((message) => <article key={message.id} className={`darl-agent-message darl-agent-message--${message.role}`}>
          <div className="darl-agent-message-label">{message.role === 'user' ? '你' : 'Agent'}</div>
          <div className="darl-agent-message-body">{message.streaming && !message.content && <span role="status"><LoaderCircle size={14} className="darl-agent-spin" /> 正在生成…</span>}{message.role === 'assistant' ? <Markdown content={message.content} onCopyCode={(code) => void copy(code, `${message.id}-code`)} /> : <p><ReferenceText value={message.content} /></p>}{hasSubAgentActivity(message.timeline) ? <ExecutionTimeline events={message.timeline!} calls={message.toolCalls} /> : message.toolCalls?.map((call) => <ToolCallCard key={call.id} call={call} />)}{message.error && <AgentErrorCard error={message.error} />}{message.attachments?.map((attachment, index) => { const name = attachmentName(attachment); const fileId = typeof attachment === 'string' ? undefined : attachment.fileId; const url = fileId ? `/api/files/${fileId}` : typeof attachment === 'string' ? undefined : attachment.url; return url?.startsWith('data:image/') || url?.startsWith('http') || url?.startsWith('/api/files/') ? <figure className="darl-agent-image-attachment" key={`${name}-${index}`}><button type="button" className="darl-agent-image-trigger" onClick={() => openImagePreview({ src: url, alt: name })} title="点击放大预览"><img src={url} alt={name} loading="lazy" /></button></figure> : <span className="darl-agent-chip" key={`${name}-${index}`}><Paperclip size={12} />{name}</span>; })}</div>
          {message.role === 'assistant' && !message.streaming && <div className="darl-agent-message-actions"><Button variant="ghost" size="sm" onClick={() => void copy(message.content, message.id)}><Clipboard size={13} />{copyState === message.id ? '已复制' : '复制'}</Button>{onRegenerate && <Button variant="ghost" size="sm" disabled={isGenerating} onClick={() => onRegenerate(message.id)}><RefreshCw size={13} />重新生成</Button>}</div>}
        </article>)}
        <div className="darl-agent-scroll-controls" aria-label="消息导航"><Button variant="ghost" size="icon" aria-label="滚动到顶部" title="滚动到顶部" onClick={() => scrollMessages('top')}><ArrowUp size={15} /></Button><Button variant="ghost" size="icon" aria-label="滚动到底部" title="滚动到底部" onClick={() => scrollMessages('bottom')}><ArrowDown size={15} /></Button></div>
      </section>
      <footer className="darl-agent-composer-shell">

        <div className="darl-agent-contexts">{files.map((file, index) => { const preview = attachmentPreviews[`${file.name}:${file.size}:${file.lastModified}`]; return <span className="darl-agent-chip darl-agent-attachment-chip" key={index}>{preview && <img src={preview} alt="" /> }{!preview && <Paperclip size={12} />}{!preview && file.name}<button aria-label={`移除附件 ${file.name}`} onClick={() => setAttachments((current) => ({ ...current, [draftKey]: files.filter((_, i) => i !== index) }))}><X size={12} /></button></span>; })}</div><div className="darl-agent-composer"><AgentComposerInput applications={applications} skills={availableSkills} key={draftKey} value={draft} onChange={setDraft} onSubmit={() => void submit()} insertion={insertion} onInserted={() => setInsertion(null)} />
          <div className="darl-agent-composer-controls"><Button variant="ghost" size="icon" aria-label="添加材料或能力" aria-expanded={picker === 'add'} onClick={() => setPicker(picker === 'add' ? null : 'add')}><Plus size={17} /></Button><span className="darl-agent-composer-spacer" />{selectableAgents.length > 0 && <Button variant="outline" size="sm" title="选择 Agent" onClick={() => setPicker(picker === 'agents' ? null : 'agents')}><span>{selectedAgent?.name || '选择 Agent'}</span><ChevronDown size={13} /></Button>}{models.length > 0 && <Button variant="outline" size="sm" title="选择模型" onClick={() => setPicker(picker === 'models' ? null : 'models')}><span>{selectedModel?.name || '选择模型'}</span><ChevronDown size={13} /></Button>}{supportedEfforts.length > 0 && <Button variant="outline" size="sm" title="选择推理等级" onClick={() => setPicker(picker === 'effort' ? null : 'effort')}><span>思考：{effort}</span><ChevronDown size={13} /></Button>}{isGenerating ? <Button variant="outline" size="icon" aria-label="停止生成" onClick={onStop}><Square size={14} /></Button> : <Button variant="default" size="icon" aria-label="发送消息" disabled={(!draft.trim() && !files.length) || !onSend || !activeSession || pending} onClick={submit}><Send size={16} /></Button>}</div>
        </div>
        {error && <p role="alert">{error}</p>}<small className="darl-agent-composer-note">@ 应用或 Skill · Enter 发送</small>
      </footer>
      {copyNotice && <div className="darl-agent-copy-toast" role="status" aria-live="polite">{copyNotice}</div>}
    </>}

    {picker === 'add' && <Picker title="添加" onClose={closePicker}><div className="darl-agent-add-list"><button type="button" onClick={() => openFilePicker('file')}><Paperclip size={16} /><span><strong>上传图片</strong><small>支持 PNG、JPEG、WebP 和 GIF</small></span></button><button type="button" onClick={() => setPicker('apps')}><Wrench size={16} /><span><strong>选择应用</strong><small>启用网站的 MCP 工具</small></span></button><button type="button" onClick={() => setPicker('skills')}><Sparkles size={16} /><span><strong>选择 Skill</strong><small>选择可复用的工作流程</small></span></button></div></Picker>}
    {picker === 'apps' && <Picker title="选择应用" onClose={closePicker}><div className="darl-agent-picker-list">{applications.map((app) => <button key={app.id} type="button" className="darl-agent-picker-row" aria-pressed={applicationIds.includes(app.id)} disabled={app.status !== undefined && app.status !== 'connected'} onClick={() => toggleApplication(app.id)}><span className="darl-agent-picker-icon">{app.icon || <Wrench size={15} />}</span><span className="darl-agent-picker-copy"><strong>{app.name}</strong><small>{app.description || `${app.tools?.length || 0} 个工具`} · {statusText(app.status)}</small></span>{applicationIds.includes(app.id) && <Check size={16} />}</button>)}{!applications.length && <p className="darl-agent-empty">暂无可用应用</p>}</div></Picker>}
    {picker === 'skills' && <Picker title="选择 Skill" onClose={closePicker}><div className="darl-agent-picker-toolbar"><span>已安装的 Skill</span><span className="darl-agent-picker-toolbar-actions"><button type="button" onClick={() => openFilePicker('skill')}><Upload size={14} />上传</button></span></div><div className="darl-agent-picker-list">{availableSkills.map((skill) => <button key={skill.id} type="button" className="darl-agent-picker-row" aria-pressed={skillIds.includes(skill.id)} onClick={() => toggleSkill(skill.id)}><span className="darl-agent-picker-icon darl-agent-picker-icon--skill"><Sparkles size={15} /></span><span className="darl-agent-picker-copy"><strong>{skill.name}</strong><small>{skill.description || '可复用的 Agent 工作流程'}{skill.version ? ` · v${skill.version}` : ''}</small></span>{skillIds.includes(skill.id) && <Check size={16} />}</button>)}{!availableSkills.length && <p className="darl-agent-empty">暂无 Skill</p>}</div></Picker>}
    {picker === 'models' && <Picker title="选择模型" onClose={closePicker}><div className="darl-agent-picker-list">{models.map((model) => <button key={model.id} type="button" className="darl-agent-picker-row" onClick={() => { setModelId(model.id); setPicker(null); }}><span className="darl-agent-picker-icon"><Bot size={15} /></span><span className="darl-agent-picker-copy"><strong>{model.name}</strong><small>{model.description || '对话模型'}</small></span>{model.id === modelId && <Check size={16} />}</button>)}</div></Picker>}
    {picker === 'agents' && <Picker title="选择 Agent" className="darl-agent-picker--agents" onClose={closePicker}><div className="darl-agent-picker-cards">{selectableAgents.map((agent) => <button key={agent.id} type="button" className={`darl-agent-picker-card${agent.id === agentId ? ' is-selected' : ''}`} onClick={() => setAgentId(agent.id)}><div className="darl-agent-picker-card-visual"><AgentPickerAvatar agent={agent} />{agent.id === agentId && <span className="darl-agent-picker-card-check"><Check size={14} /></span>}</div><span className="darl-agent-picker-card-copy"><strong>{agent.name}</strong><small>{agent.description || '专业 Agent'}</small><em>{agent.builtIn ? '系统默认' : agent.isDefault ? '默认' : '已启用'}</em></span></button>)}</div>{!selectableAgents.length && <p className="darl-agent-empty">暂无可用主 Agent</p>}</Picker>}
    {picker === 'effort' && selectedModel && <Picker title="思考强度" onClose={closePicker}><div className="darl-agent-effort-list">{supportedEfforts.map((value) => <button type="button" key={value} data-selected={value === effort} onClick={() => { setEffort(value); setPicker(null); }}><strong>{value}</strong><small>{value === '低' ? '更快响应' : value === '高' ? '更深入分析' : '平衡速度和质量'}</small>{value === effort && <Check size={15} />}</button>)}</div></Picker>}
    <input ref={fileInput} aria-label="选择上传文件" type="file" hidden multiple={uploadKind === 'file'} onChange={(event) => { const files = Array.from(event.target.files ?? []); const first = files[0]; if (uploadKind === 'skill' && files.length) void Promise.resolve().then(async () => { const imported = await importSkillPackage(files); await onSkillImport?.(imported); if (first) await onSkillUpload?.(first); setLocalSkills((current) => [...current.filter((item) => item.id !== imported.id), imported]); }).catch((reason) => setError(reason instanceof Error ? reason.message : '导入失败')); if (uploadKind === 'file' && files.length) { const images = files.filter((file) => file.type.startsWith('image/')); if (images.length !== files.length) setError('仅支持图片附件，请选择 PNG、JPEG、WebP 或 GIF'); if (images.length) { setAttachments((current) => ({ ...current, [draftKey]: [...(current[draftKey] ?? []), ...images] })); if (onFileUpload) void Promise.resolve().then(() => onFileUpload(images)).catch(() => setError('附件处理失败')); } } setPicker(null); event.currentTarget.value = ''; }} accept={uploadKind === 'skill' ? skillFileAccept : 'image/*,.png,.jpg,.jpeg,.webp,.gif'} />
  </aside>
    <InteractiveConfirmDialog
      open={Boolean(pendingConfirmation && onToolConfirm && pendingConfirmation.id !== handledConfirmation)}
      onOpenChange={(open) => { if (!open) void confirmAction(false); }}
      title={isMediaConfirmation ? `确认生成${mediaKind}` : '确认执行 MCP 工具'}
      description={isMediaConfirmation ? '请核对以下生成设置，提交后将开始生成并可能产生费用。' : '即将调用外部工具，请核对操作与参数。'}
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
    />
    <ImageLightbox image={imagePreview} onClose={() => setImagePreview(null)} />
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
  </ImagePreviewContext.Provider>;
}

export type { AgentApplication, AgentAttachment, AgentImageAttachment, AgentMessage, AgentModel, AgentSession, AgentSkill, AgentTool, AgentToolCall } from './types';
