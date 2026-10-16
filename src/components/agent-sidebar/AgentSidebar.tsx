import { AgentComposerInput, ReferenceText, referenceIds } from './AgentComposerInput';
import { createContext, useContext, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { AlertCircle, ArrowDown, ArrowLeft, ArrowUp, Bot, Check, ChevronDown, Clipboard, Copy, History, LoaderCircle, Maximize2, Minimize2, Paperclip, Pencil, Plus, RefreshCw, Search, Send, Sparkles, Square, Upload, Wrench, X } from 'lucide-react';
import ReactMarkdown, { type Components } from 'react-markdown';
import rehypeSanitize from 'rehype-sanitize';
import remarkGfm from 'remark-gfm';
import { Button } from '../ui/Button';
import type { AgentApplication, AgentAttachment, AgentErrorInfo, AgentImageAttachment, AgentSession, AgentSidebarProps, AgentSkill, AgentToolCall } from './types';
import { SkillManager } from './SkillManager';
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

function ToolCallCard({ call, onConfirm }: { call: AgentToolCall; onConfirm?: AgentSidebarProps['onToolConfirm'] }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { setPending(false); setError(''); }, [call.status]);
  const decide = async (approved: boolean) => {
    if (!onConfirm || pending) return;
    setPending(true); setError('');
    try { await onConfirm(call.id, approved); }
    catch (reason) { setError(reason instanceof Error ? reason.message : '确认失败，请重试'); setPending(false); }
  };
  const status = { pending: '等待调用', running: '执行中', success: '已完成', error: '调用失败', confirmation: '等待确认' }[call.status];
  const StatusIcon = call.status === 'running' ? LoaderCircle : call.status === 'error' ? AlertCircle : call.status === 'success' ? Check : Wrench;
  const delegationTask = call.appId.startsWith('agent:') && call.input && typeof call.input === 'object' && 'task' in call.input && typeof call.input.task === 'string' ? call.input.task : '';
  return <article className={`darl-agent-tool-call darl-agent-tool-call--${call.status}`}>
    <div className="darl-agent-tool-summary">
      <span className="darl-agent-tool-icon"><StatusIcon size={14} className={call.status === 'running' ? 'darl-agent-spin' : undefined} /></span>
      <span className="darl-agent-tool-title"><strong>{call.agentId ? `子 Agent · ${call.appName}` : call.appName}</strong><span>{call.toolTitle || call.toolName}</span></span>
      <span className="darl-agent-tool-status">{status}</span>
    </div>
    {(delegationTask || call.status === 'confirmation') && <div className="darl-agent-tool-detail">
      {delegationTask && <div><span>委派任务</span><pre>{delegationTask}</pre></div>}
      {call.status === 'confirmation' && call.input !== undefined && <div><span>参数</span><pre>{formatToolValue(call.input)}</pre></div>}
    </div>}
    {call.errorInfo ? <AgentErrorCard error={call.errorInfo} /> : call.error && <p className="darl-agent-tool-error">{call.error}</p>}
    {call.status === 'confirmation' && <div className="darl-agent-tool-confirm">
      <span>此操作需要你的确认。</span>
      {onConfirm ? <div><Button size="sm" disabled={pending} onClick={() => void decide(true)}>允许执行</Button><Button variant="outline" size="sm" disabled={pending} onClick={() => void decide(false)}>拒绝</Button></div> : <span>等待宿主处理确认。</span>}
      {error && <p role="alert" className="darl-agent-tool-error">{error}</p>}
    </div>}
  </article>;
}

function AgentErrorCard({ error }: { error: AgentErrorInfo }) {
  const stage = { model: '模型请求', 'mcp-connection': 'MCP 连接', 'mcp-tool': 'MCP 工具', delegation: '子 Agent 委派', 'tool-validation': '工具参数', validation: '请求校验', cancellation: '已取消', timeout: '请求超时' }[error.stage];
  return <div className="darl-agent-error-card" role="alert"><div className="darl-agent-error-card-head"><AlertCircle size={15} /><strong>{stage}失败</strong><span>{error.retryable ? '可以重试' : '请修改后重试'}</span></div><p>{error.message}</p><div className="darl-agent-error-card-meta"><span>错误码：{error.code}</span>{error.requestId && <span>requestId：{error.requestId}</span>}{error.runId && <span>runId：{error.runId}</span>}</div><small>{error.suggestion}</small></div>;
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

export function AgentSidebar({ open, onOpenChange, sessions, activeSessionId, onSessionChange, onSessionRename, onNewSession, onSend, onRegenerate, onToolConfirm, isGenerating = false, onStop, applications = [], skills = emptySkills, onSkillUpload, onSkillImport, onSkillSave, onSkillDelete, onSkillFavoriteChange, onFileUpload, models = [], agents = [], selectedAgentId: controlledAgentId, onSelectedAgentIdChange, onSelectedApplicationIdsChange, onSelectedSkillIdsChange, selectedModelId: controlledModelId, onSelectedModelIdChange, selectedReasoningEffort: controlledEffort, onSelectedReasoningEffortChange, className = '' }: AgentSidebarProps) {
  const [view, setView] = useState<'chat' | 'history'>('chat');
  const [expanded, setExpanded] = useState(false);
  const [picker, setPicker] = useState<'add' | 'apps' | 'skills' | 'models' | 'effort' | 'agents' | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const submitting = useRef(false);
  const [historyQuery, setHistoryQuery] = useState('');
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [copyState, setCopyState] = useState('');
  const [copyNotice, setCopyNotice] = useState('');
  const [insertion, setInsertion] = useState<{ token: string; key: number } | null>(null);
  const [skillManagerOpen, setSkillManagerOpen] = useState(false);
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
  const agentId = controlledAgentId ?? localAgentId;
  const selectedAgent = agents.find((agent) => agent.id === agentId);
  const selectableAgents = useMemo(() => agents.filter((agent) => agent.enabled !== false), [agents]);
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
      await onSend({ sessionId: activeSession.id, content, applicationIds, skillIds, modelId: selectedModel?.id, reasoningEffort: effort, ...(agentId !== undefined ? { agentId: agentId || null } : {}), ...(files.length ? { files } : {}), ...(attachments.length ? { attachments } : {}) });
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
  const scrollMessages = (direction: 'top' | 'bottom') => {
    messagesRef.current?.scrollTo({ top: direction === 'top' ? 0 : messagesRef.current.scrollHeight, behavior: 'smooth' });
  };
  const activeMessages = activeSession?.messages ?? [];
  const openImagePreview = (image: Pick<ImagePreview, 'src' | 'alt'>) => {
    const sidebar = sidebarRef.current;
    if (!sidebar) { setImagePreview(image); return; }
    const computed = (element: Element, property: string, fallback: string) => getComputedStyle(element).getPropertyValue(property).trim() || fallback;
    const surface = sidebar.querySelector('.darl-agent-composer') || sidebar;
    const muted = sidebar.querySelector('.darl-agent-heading span') || sidebar;
    const border = sidebar.querySelector('.darl-agent-header') || sidebar;
    const primary = sidebar.querySelector('.darl-agent-brand-mark') || sidebar;
    const background = computed(sidebar, 'background-color', '#fff');
    const surfaceColor = computed(surface, 'background-color', '#f8fafc');
    const text = computed(sidebar, 'color', '#0f172a');
    const mutedColor = computed(muted, 'color', '#64748b');
    const borderColor = computed(border, 'border-bottom-color', '#e2e8f0');
    const primaryColor = computed(primary, 'background-color', '#2563eb');
    const primaryForeground = computed(primary, 'color', '#fff');
    const radius = getComputedStyle(sidebar).getPropertyValue('--darl-radius').trim() || '12px';
    setImagePreview({ ...image, theme: {
      '--darl-agent-bg': background,
      '--darl-agent-surface': surfaceColor,
      '--darl-agent-text': text,
      '--darl-agent-muted': mutedColor,
      '--darl-agent-border': borderColor,
      '--darl-agent-primary': primaryColor,
      '--darl-agent-primary-foreground': primaryForeground,
      '--darl-background': background,
      '--darl-surface': surfaceColor,
      '--darl-text': text,
      '--darl-muted': mutedColor,
      '--darl-border': borderColor,
      '--darl-primary': primaryColor,
      '--darl-primary-foreground': primaryForeground,
      '--darl-radius': radius,
    } });
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
      {filteredSessions.map((session) => renamingId === session.id ? <form key={session.id} className="darl-agent-history-row darl-agent-history-row--editing" onSubmit={(event) => { event.preventDefault(); void saveRename(session.id); }}><input aria-label="会话名称" autoFocus value={renameDraft} onChange={(event) => setRenameDraft(event.target.value)} onKeyDown={(event) => { if (event.key === 'Escape') setRenamingId(null); }} /><Button size="sm" type="submit">保存</Button><Button variant="ghost" size="sm" type="button" onClick={() => setRenamingId(null)}>取消</Button></form> : <div key={session.id} className={`darl-agent-history-row${session.id === activeSession?.id ? ' is-active' : ''}`} aria-current={session.id === activeSession?.id ? 'page' : undefined}><button type="button" className="darl-agent-history-select" onClick={() => { onSessionChange?.(session.id); setView('chat'); }}><span><strong>{session.title}</strong><small>{session.messages.at(-1)?.content || '暂无消息'}</small></span><time>{session.updatedAt || ''}</time></button>{onSessionRename && <Button variant="ghost" size="icon" aria-label={`重命名 ${session.title}`} title="重命名" onClick={() => beginRename(session)}><Pencil size={14} /></Button>}</div>)}
      {!filteredSessions.length && <p className="darl-agent-empty">没有匹配的对话</p>}
    </section> : <>
      <section ref={messagesRef} className="darl-agent-messages" aria-live="polite" onScroll={(event) => { const element = event.currentTarget; followOutput.current = element.scrollHeight - element.scrollTop - element.clientHeight < 80; }}>
        {!activeMessages.length && <div className="darl-agent-empty-state"><span className="darl-agent-empty-icon"><Sparkles size={22} /></span><h2>需要我帮你做什么？</h2><p>选择应用和 Skill，把它们插入消息中。</p></div>}
        {activeMessages.map((message) => <article key={message.id} className={`darl-agent-message darl-agent-message--${message.role}`}>
          <div className="darl-agent-message-label">{message.role === 'user' ? '你' : 'Agent'}</div>
          <div className="darl-agent-message-body">{message.streaming && !message.content && <span role="status"><LoaderCircle size={14} className="darl-agent-spin" /> 正在生成…</span>}{message.role === 'assistant' ? <Markdown content={message.content} onCopyCode={(code) => void copy(code, `${message.id}-code`)} /> : <p><ReferenceText value={message.content} /></p>}{message.error && <AgentErrorCard error={message.error} />}{message.attachments?.map((attachment, index) => { const name = attachmentName(attachment); const url = typeof attachment === 'string' ? undefined : attachment.url; return url?.startsWith('data:image/') || url?.startsWith('http') ? <figure className="darl-agent-image-attachment" key={`${name}-${index}`}><button type="button" className="darl-agent-image-trigger" onClick={() => openImagePreview({ src: url, alt: name })} title="点击放大预览"><img src={url} alt={name} loading="lazy" /></button><figcaption><Paperclip size={12} />{name}</figcaption></figure> : <span className="darl-agent-chip" key={`${name}-${index}`}><Paperclip size={12} />{name}</span>; })}{message.toolCalls?.map((call) => <ToolCallCard key={call.id} call={call} onConfirm={onToolConfirm} />)}</div>
          {message.role === 'assistant' && !message.streaming && <div className="darl-agent-message-actions"><Button variant="ghost" size="sm" onClick={() => void copy(message.content, message.id)}><Clipboard size={13} />{copyState === message.id ? '已复制' : '复制'}</Button>{onRegenerate && <Button variant="ghost" size="sm" disabled={isGenerating} onClick={() => onRegenerate(message.id)}><RefreshCw size={13} />重新生成</Button>}</div>}
        </article>)}
        <div className="darl-agent-scroll-controls" aria-label="消息导航"><Button variant="ghost" size="icon" aria-label="滚动到顶部" title="滚动到顶部" onClick={() => scrollMessages('top')}><ArrowUp size={15} /></Button><Button variant="ghost" size="icon" aria-label="滚动到底部" title="滚动到底部" onClick={() => scrollMessages('bottom')}><ArrowDown size={15} /></Button></div>
      </section>
      <footer className="darl-agent-composer-shell">

        <div className="darl-agent-contexts">{files.map((file, index) => { const preview = attachmentPreviews[`${file.name}:${file.size}:${file.lastModified}`]; return <span className="darl-agent-chip darl-agent-attachment-chip" key={index}>{preview && <img src={preview} alt="" /> }<Paperclip size={12} />{file.name}<button aria-label={`移除附件 ${file.name}`} onClick={() => setAttachments((current) => ({ ...current, [draftKey]: files.filter((_, i) => i !== index) }))}><X size={12} /></button></span>; })}</div><div className="darl-agent-composer"><AgentComposerInput applications={applications} skills={availableSkills} key={draftKey} value={draft} onChange={setDraft} onSubmit={() => void submit()} insertion={insertion} onInserted={() => setInsertion(null)} />
          <div className="darl-agent-composer-controls"><Button variant="ghost" size="icon" aria-label="添加材料或能力" aria-expanded={picker === 'add'} onClick={() => setPicker(picker === 'add' ? null : 'add')}><Plus size={17} /></Button><span className="darl-agent-composer-spacer" />{selectableAgents.length > 0 && <Button variant="outline" size="sm" onClick={() => setPicker(picker === 'agents' ? null : 'agents')}><span>{selectedAgent?.name || '选择 Agent'}</span><ChevronDown size={13} /></Button>}{!selectedAgent && models.length > 0 && <Button variant="outline" size="sm" onClick={() => setPicker(picker === 'models' ? null : 'models')}><span>{selectedModel?.name || '选择模型'}</span><ChevronDown size={13} /></Button>}{!selectedAgent && supportedEfforts.length > 0 && <Button variant="outline" size="sm" onClick={() => setPicker(picker === 'effort' ? null : 'effort')}><span>思考：{effort}</span><ChevronDown size={13} /></Button>}{isGenerating ? <Button variant="outline" size="icon" aria-label="停止生成" onClick={onStop}><Square size={14} /></Button> : <Button variant="default" size="icon" aria-label="发送消息" disabled={(!draft.trim() && !files.length) || !onSend || !activeSession || pending} onClick={submit}><Send size={16} /></Button>}</div>
        </div>
        {error && <p role="alert">{error}</p>}<small className="darl-agent-composer-note">@ 应用 · / Skill · Enter 发送</small>
      </footer>
      {copyNotice && <div className="darl-agent-copy-toast" role="status" aria-live="polite">{copyNotice}</div>}
    </>}

    {picker === 'add' && <Picker title="添加" onClose={closePicker}><div className="darl-agent-add-list"><button type="button" onClick={() => openFilePicker('file')}><Paperclip size={16} /><span><strong>上传图片</strong><small>支持 PNG、JPEG、WebP 和 GIF</small></span></button><button type="button" onClick={() => setPicker('apps')}><Wrench size={16} /><span><strong>选择应用</strong><small>启用网站的 MCP 工具</small></span></button><button type="button" onClick={() => setPicker('skills')}><Sparkles size={16} /><span><strong>选择 Skill</strong><small>选择可复用的工作流程</small></span></button></div></Picker>}
    {picker === 'apps' && <Picker title="选择应用" onClose={closePicker}><div className="darl-agent-picker-list">{applications.map((app) => <button key={app.id} type="button" className="darl-agent-picker-row" aria-pressed={applicationIds.includes(app.id)} disabled={app.status !== undefined && app.status !== 'connected'} onClick={() => toggleApplication(app.id)}><span className="darl-agent-picker-icon">{app.icon || <Wrench size={15} />}</span><span className="darl-agent-picker-copy"><strong>{app.name}</strong><small>{app.description || `${app.tools?.length || 0} 个工具`} · {statusText(app.status)}</small></span>{applicationIds.includes(app.id) && <Check size={16} />}</button>)}{!applications.length && <p className="darl-agent-empty">暂无可用应用</p>}</div></Picker>}
    {picker === 'skills' && <Picker title="选择 Skill" onClose={closePicker}><div className="darl-agent-picker-toolbar"><span>已安装的 Skill</span><span className="darl-agent-picker-toolbar-actions"><button type="button" onClick={() => { setPicker(null); setSkillManagerOpen(true); }}><Pencil size={14} />管理 Skill</button><button type="button" onClick={() => openFilePicker('skill')}><Upload size={14} />上传</button></span></div><div className="darl-agent-picker-list">{availableSkills.filter((skill) => skill.enabled !== false).map((skill) => <button key={skill.id} type="button" className="darl-agent-picker-row" aria-pressed={skillIds.includes(skill.id)} onClick={() => toggleSkill(skill.id)}><span className="darl-agent-picker-icon darl-agent-picker-icon--skill"><Sparkles size={15} /></span><span className="darl-agent-picker-copy"><strong>{skill.name}</strong><small>{skill.description || '可复用的 Agent 工作流程'}{skill.version ? ` · v${skill.version}` : ''}</small></span>{skillIds.includes(skill.id) && <Check size={16} />}</button>)}{!availableSkills.length && <p className="darl-agent-empty">暂无 Skill</p>}</div></Picker>}
    {picker === 'models' && <Picker title="选择模型" onClose={closePicker}><div className="darl-agent-picker-list">{models.map((model) => <button key={model.id} type="button" className="darl-agent-picker-row" onClick={() => { setModelId(model.id); setPicker(null); }}><span className="darl-agent-picker-icon"><Bot size={15} /></span><span className="darl-agent-picker-copy"><strong>{model.name}</strong><small>{model.description || '对话模型'}</small></span>{model.id === modelId && <Check size={16} />}</button>)}</div></Picker>}
    {picker === 'agents' && <Picker title="选择 Agent" className="darl-agent-picker--agents" onClose={closePicker}><div className="darl-agent-picker-cards">{selectableAgents.map((agent) => <button key={agent.id} type="button" className={`darl-agent-picker-card${agent.id === agentId ? ' is-selected' : ''}`} onClick={() => setAgentId(agent.id)}><div className="darl-agent-picker-card-visual"><AgentPickerAvatar agent={agent} />{agent.id === agentId && <span className="darl-agent-picker-card-check"><Check size={14} /></span>}</div><span className="darl-agent-picker-card-copy"><strong>{agent.name}</strong><small>{agent.description || '专业 Agent'}</small><em>{agent.builtIn ? '系统默认' : agent.isDefault ? '默认' : '已启用'}</em></span></button>)}</div>{!selectableAgents.length && <p className="darl-agent-empty">暂无可用主 Agent</p>}</Picker>}
    {picker === 'effort' && selectedModel && <Picker title="思考强度" onClose={closePicker}><div className="darl-agent-effort-list">{supportedEfforts.map((value) => <button type="button" key={value} data-selected={value === effort} onClick={() => { setEffort(value); setPicker(null); }}><strong>{value}</strong><small>{value === '低' ? '更快响应' : value === '高' ? '更深入分析' : '平衡速度和质量'}</small>{value === effort && <Check size={15} />}</button>)}</div></Picker>}
    <input ref={fileInput} aria-label="选择上传文件" type="file" hidden multiple={uploadKind === 'file'} onChange={(event) => { const files = Array.from(event.target.files ?? []); const first = files[0]; if (uploadKind === 'skill' && files.length) void Promise.resolve().then(async () => { const imported = await importSkillPackage(files); await onSkillImport?.(imported); if (first) await onSkillUpload?.(first); setLocalSkills((current) => [...current.filter((item) => item.id !== imported.id), imported]); }).catch((reason) => setError(reason instanceof Error ? reason.message : '导入失败')); if (uploadKind === 'file' && files.length) { const images = files.filter((file) => file.type.startsWith('image/')); if (images.length !== files.length) setError('仅支持图片附件，请选择 PNG、JPEG、WebP 或 GIF'); if (images.length) { setAttachments((current) => ({ ...current, [draftKey]: [...(current[draftKey] ?? []), ...images] })); if (onFileUpload) void Promise.resolve().then(() => onFileUpload(images)).catch(() => setError('附件处理失败')); } } setPicker(null); event.currentTarget.value = ''; }} accept={uploadKind === 'skill' ? skillFileAccept : 'image/*,.png,.jpg,.jpeg,.webp,.gif'} />
    <SkillManager open={skillManagerOpen} skills={availableSkills} onClose={() => setSkillManagerOpen(false)} onUse={(skill) => { insertReference('skill', skill.id, skill.name); setSkillManagerOpen(false); }} onImport={async (skill) => { await onSkillImport?.(skill); setLocalSkills((current) => [...current.filter((item) => item.id !== skill.id), skill]); }} onSave={async (skill) => { await onSkillSave?.(skill); setLocalSkills((current) => [...current.filter((item) => item.id !== skill.id), skill]); }} onDelete={async (skillId) => { await onSkillDelete?.(skillId); setLocalSkills((current) => current.filter((skill) => skill.id !== skillId)); }} onFavoriteChange={async (skillId, favorite) => { await onSkillFavoriteChange?.(skillId, favorite); setLocalSkills((current) => current.map((skill) => skill.id === skillId ? { ...skill, favorite } : skill)); }} />
  </aside><ImageLightbox image={imagePreview} onClose={() => setImagePreview(null)} /></ImagePreviewContext.Provider>;
}

export type { AgentApplication, AgentAttachment, AgentImageAttachment, AgentMessage, AgentModel, AgentSession, AgentSkill, AgentTool, AgentToolCall } from './types';
