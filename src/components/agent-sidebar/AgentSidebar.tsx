import { AgentComposerInput, ReferenceText, referenceIds } from './AgentComposerInput';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AlertCircle, ArrowLeft, Bot, Check, ChevronDown, Clipboard, Copy, History, LoaderCircle, Paperclip, Pencil, Plus, RefreshCw, Search, Send, Sparkles, Square, Upload, Wrench, X } from 'lucide-react';
import { Button } from '../ui/Button';
import type { AgentApplication, AgentSidebarProps, AgentSkill, AgentToolCall } from './types';
import { SkillManager } from './SkillManager';
import { importSkillPackage } from './skill-package';

function formatToolValue(value: unknown): string {
  if (value === undefined) return '';
  if (typeof value === 'string') return value;
  try { return JSON.stringify(value, null, 2); } catch { return String(value); }
}

function InlineMarkdown({ text }: { text: string }) {
  const tokens = text.split(/(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^\s)]+\))/g).filter(Boolean);
  return <>{tokens.map((token, index) => {
    const strong = token.match(/^\*\*(.+)\*\*$/);
    if (strong) return <strong key={index}>{strong[1]}</strong>;
    const code = token.match(/^`(.+)`$/);
    if (code) return <code key={index} className="darl-agent-inline-code">{code[1]}</code>;
    const link = token.match(/^\[([^\]]+)\]\(([^\s)]+)\)$/);
    if (link && /^(https?:|#|\/)/.test(link[2])) return <a key={index} href={link[2]} target={link[2].startsWith('http') ? '_blank' : undefined} rel={link[2].startsWith('http') ? 'noreferrer' : undefined}>{link[1]}</a>;
    return <span key={index}>{token}</span>;
  })}</>;
}

function Markdown({ content, onCopyCode }: { content: string; onCopyCode: (code: string) => void }) {
  const lines = content.split('\n');
  const blocks: ReactNode[] = [];
  let code: string[] | null = null;
  let language = '';
  let paragraph: string[] = [];
  let listItems: string[] = [];
  const flushParagraph = () => {
    if (!paragraph.length) return;
    blocks.push(<p key={`p-${blocks.length}`}><InlineMarkdown text={paragraph.join(' ')} /></p>);
    paragraph = [];
  };
  const flushList = () => {
    if (!listItems.length) return;
    blocks.push(<ul key={`ul-${blocks.length}`}>{listItems.map((item, itemIndex) => <li key={itemIndex}><InlineMarkdown text={item} /></li>)}</ul>);
    listItems = [];
  };
  lines.forEach((line, index) => {
    const fence = line.match(/^```(.*)$/);
    if (fence) {
      if (code) {
        const source = code.join('\n');
        blocks.push(<div className="darl-agent-code" key={`code-${index}`}><div className="darl-agent-code-head"><span>{language || 'code'}</span><button type="button" onClick={() => onCopyCode(source)}><Copy size={13} />复制代码</button></div><pre><code>{source}</code></pre></div>);
        code = null;
        language = '';
      } else {
        flushParagraph(); flushList();
        code = [];
        language = fence[1].trim();
      }
      return;
    }
    if (code) { code.push(line); return; }
    if (!line.trim()) { flushParagraph(); flushList(); return; }
    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    if (heading) { flushParagraph(); flushList(); const Tag = `h${heading[1].length}` as 'h1' | 'h2' | 'h3'; blocks.push(<Tag key={`h-${index}`}><InlineMarkdown text={heading[2]} /></Tag>); return; }
    const bullet = line.match(/^[-*]\s+(.+)$/);
    if (bullet) {
      flushParagraph(); listItems.push(bullet[1]);
      return;
    }
    flushList();
    paragraph.push(line);
  });
  if (code !== null) {
    const source = (code as string[]).join('\n');
    blocks.push(<div className="darl-agent-code" key="code-end"><div className="darl-agent-code-head"><span>{language || 'code'}</span><button type="button" onClick={() => onCopyCode(source)}><Copy size={13} />复制代码</button></div><pre><code>{source}</code></pre></div>);
  }
  flushParagraph(); flushList();
  return <div className="darl-agent-markdown">{blocks}</div>;
}

function ToolCallCard({ call }: { call: AgentToolCall }) {
  const [expanded, setExpanded] = useState(false);
  const status = { pending: '等待调用', running: '执行中', success: '已完成', error: '调用失败', confirmation: '等待确认' }[call.status];
  const StatusIcon = call.status === 'running' ? LoaderCircle : call.status === 'error' ? AlertCircle : call.status === 'success' ? Check : Wrench;
  return <article className={`darl-agent-tool-call darl-agent-tool-call--${call.status}`}>
    <button type="button" className="darl-agent-tool-summary" onClick={() => setExpanded((value) => !value)} aria-expanded={expanded}>
      <span className="darl-agent-tool-icon"><StatusIcon size={14} className={call.status === 'running' ? 'darl-agent-spin' : undefined} /></span>
      <span className="darl-agent-tool-title"><strong>{call.appName}</strong><span>{call.toolTitle || call.toolName}</span></span>
      <span className="darl-agent-tool-status">{status}<ChevronDown size={14} className={expanded ? 'darl-agent-rotate' : undefined} /></span>
    </button>
    {expanded && <div className="darl-agent-tool-detail">
      {call.input !== undefined && <div><span>参数</span><pre>{formatToolValue(call.input)}</pre></div>}
      {call.output !== undefined && <div><span>结果</span><pre>{formatToolValue(call.output)}</pre></div>}
      {call.error && <p className="darl-agent-tool-error">{call.error}</p>}
    </div>}
  </article>;
}

function Picker({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  return <div className="darl-agent-picker" role="dialog" aria-label={title}><div className="darl-agent-picker-head"><strong>{title}</strong><Button variant="ghost" size="icon" aria-label={`关闭${title}`} onClick={onClose}><X size={16} /></Button></div>{children}</div>;
}

function statusText(status: AgentApplication['status']): string {
  return status === 'connected' ? '已连接' : status === 'needs-auth' ? '需要授权' : '未连接';
}

export function AgentSidebar({ open, onOpenChange, sessions, activeSessionId, onSessionChange, onNewSession, onSend, onRegenerate, isGenerating = false, onStop, applications = [], skills = [], onSkillUpload, onSkillImport, onSkillSave, onSkillDelete, onSkillFavoriteChange, onFileUpload, models = [], onSelectedApplicationIdsChange, onSelectedSkillIdsChange, selectedModelId: controlledModelId, onSelectedModelIdChange, selectedReasoningEffort: controlledEffort, onSelectedReasoningEffortChange, className = '' }: AgentSidebarProps) {
  const [view, setView] = useState<'chat' | 'history'>('chat');
  const [picker, setPicker] = useState<'add' | 'apps' | 'skills' | 'models' | 'effort' | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const submitting = useRef(false);
  const [historyQuery, setHistoryQuery] = useState('');
  const [copyState, setCopyState] = useState('');
  const [insertion, setInsertion] = useState<{ token: string; key: number } | null>(null);
  const [skillManagerOpen, setSkillManagerOpen] = useState(false);
  const [localSkills, setLocalSkills] = useState<AgentSkill[]>(skills);
  const skillsPropRef = useRef(skills);

  const [localModelId, setLocalModelId] = useState(models[0]?.id);
  const [localEffort, setLocalEffort] = useState(models[0]?.reasoningEfforts?.[0] || '中');
  const [attachments, setAttachments] = useState<Record<string, File[]>>({});
  const [uploadKind, setUploadKind] = useState<'file' | 'skill'>('skill');
  const fileInput = useRef<HTMLInputElement>(null);
  const copyTimer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(copyTimer.current), []);
  useEffect(() => {
    const changed = skillsPropRef.current.length !== skills.length || skillsPropRef.current.some((skill, index) => skill.id !== skills[index]?.id || skill.version !== skills[index]?.version);
    if (changed) {
      skillsPropRef.current = skills;
      setLocalSkills(skills);
    }
  }, [skills]);
  const availableSkills = localSkills;
  const activeSession = sessions.find((session) => session.id === activeSessionId) ?? sessions[0];
  const modelId = controlledModelId ?? localModelId;
  const selectedModel = models.find((model) => model.id === modelId) ?? models[0];
  const supportedEfforts = selectedModel?.reasoningEfforts ?? [];
  const preferredEffort = controlledEffort ?? localEffort;
  const effort = supportedEfforts.includes(preferredEffort) ? preferredEffort : supportedEfforts[0];
  const draftKey = activeSession?.id ?? '';
  const draft = drafts[draftKey] ?? '';
  const applicationIds = referenceIds(draft, 'app');
  const skillIds = referenceIds(draft, 'skill');
  const files = attachments[draftKey] ?? [];
  const setDraft = (value: string) => { setDrafts((current) => ({ ...current, [draftKey]: value })); onSelectedApplicationIdsChange?.(referenceIds(value, 'app')); onSelectedSkillIdsChange?.(referenceIds(value, 'skill')); };
  const filteredSessions = useMemo(() => sessions.filter((session) => `${session.title} ${session.messages.at(-1)?.content ?? ''}`.toLowerCase().includes(historyQuery.toLowerCase())), [historyQuery, sessions]);
  useEffect(() => { setError(''); setPicker(null); }, [activeSession?.id]);

  if (!open) return null;
  const setModelId = (id: string) => { setLocalModelId(id); onSelectedModelIdChange?.(id); };
  const setEffort = (value: string) => { setLocalEffort(value); onSelectedReasoningEffortChange?.(value); };
  const copy = async (value: string, id: string) => { try { await navigator.clipboard.writeText(value); setCopyState(id); window.clearTimeout(copyTimer.current); copyTimer.current = window.setTimeout(() => setCopyState((current) => current === id ? '' : current), 1200); } catch { setError('复制失败，请手动选择文本复制'); } };
  const submit = async () => {
    const content = draft.trim();
    if (!content || !activeSession || !onSend || isGenerating || submitting.current) return;
    submitting.current = true; setPending(true); setError('');
    try {
      await onSend({ sessionId: activeSession.id, content, applicationIds, skillIds, modelId: selectedModel?.id, reasoningEffort: effort, ...(files.length ? { files } : {}) });
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
  const activeMessages = activeSession?.messages ?? [];

  return <aside className={`darl-agent-sidebar ${className}`} aria-label="Agent 辅助侧栏" onKeyDown={(event) => { if (event.key === 'Escape') setPicker(null); }}>
    <header className="darl-agent-header">
      {view === 'history' ? <Button variant="ghost" size="icon" aria-label="返回当前对话" onClick={() => setView('chat')}><ArrowLeft size={17} /></Button> : <span className="darl-agent-brand-mark"><Bot size={17} /></span>}
      <div className="darl-agent-heading"><strong>{view === 'history' ? '历史记录' : '网站助手'}</strong>{view === 'chat' && <span><i />辅助 Agent</span>}</div>
      <div className="darl-agent-header-actions">
        {view === 'chat' && <Button variant="ghost" size="icon" aria-label="新开对话" title="新开对话" onClick={createSession}><Plus size={17} /></Button>}
        {view === 'chat' && <Button variant="ghost" size="icon" aria-label="查看历史记录" title="历史记录" onClick={() => setView('history')}><History size={17} /></Button>}
        {view === 'history' && <Button variant="ghost" size="sm" onClick={createSession}><Plus size={14} />新对话</Button>}
        <Button variant="ghost" size="icon" aria-label="关闭 Agent 侧栏" title="关闭" onClick={() => onOpenChange(false)}><X size={17} /></Button>
      </div>
    </header>

    {view === 'history' ? <section className="darl-agent-history" aria-label="对话历史">
      <label className="darl-agent-search"><Search size={15} /><input value={historyQuery} onChange={(event) => setHistoryQuery(event.target.value)} placeholder="搜索对话" aria-label="搜索对话" /></label>
      {filteredSessions.map((session) => <button key={session.id} type="button" className="darl-agent-history-row" aria-current={session.id === activeSession?.id ? 'page' : undefined} onClick={() => { onSessionChange?.(session.id); setView('chat'); }}><span><strong>{session.title}</strong><small>{session.messages.at(-1)?.content || '暂无消息'}</small></span><time>{session.updatedAt || ''}</time></button>)}
      {!filteredSessions.length && <p className="darl-agent-empty">没有匹配的对话</p>}
    </section> : <>
      <section className="darl-agent-messages" aria-live="polite">
        {!activeMessages.length && <div className="darl-agent-empty-state"><span className="darl-agent-empty-icon"><Sparkles size={22} /></span><h2>需要我帮你做什么？</h2><p>选择应用和 Skill，把它们插入消息中。</p></div>}
        {activeMessages.map((message) => <article key={message.id} className={`darl-agent-message darl-agent-message--${message.role}`}>
          <div className="darl-agent-message-label">{message.role === 'user' ? '你' : 'Agent'}</div>
          <div className="darl-agent-message-body">{message.role === 'assistant' ? <Markdown content={message.content} onCopyCode={(code) => void copy(code, `${message.id}-code`)} /> : <p><ReferenceText value={message.content} /></p>}{message.attachments?.map((name, index) => <span className="darl-agent-chip" key={index}><Paperclip size={12} />{name}</span>)}{message.toolCalls?.map((call) => <ToolCallCard key={call.id} call={call} />)}</div>
          {message.role === 'assistant' && <div className="darl-agent-message-actions"><Button variant="ghost" size="sm" onClick={() => void copy(message.content, message.id)}><Clipboard size={13} />{copyState === message.id ? '已复制' : '复制'}</Button>{onRegenerate && <Button variant="ghost" size="sm" onClick={() => onRegenerate(message.id)}><RefreshCw size={13} />重新生成</Button>}</div>}
        </article>)}
      </section>
      <footer className="darl-agent-composer-shell">

        <div className="darl-agent-contexts">{files.map((file, index) => <span className="darl-agent-chip" key={index}><Paperclip size={12} />{file.name}<button aria-label={`移除附件 ${file.name}`} onClick={() => setAttachments((current) => ({ ...current, [draftKey]: files.filter((_, i) => i !== index) }))}><X size={12} /></button></span>)}</div><div className="darl-agent-composer"><AgentComposerInput applications={applications} skills={availableSkills} key={draftKey} value={draft} onChange={setDraft} onSubmit={() => void submit()} insertion={insertion} onInserted={() => setInsertion(null)} />
          <div className="darl-agent-composer-controls"><Button variant="ghost" size="icon" aria-label="添加材料或能力" aria-expanded={picker === 'add'} onClick={() => setPicker(picker === 'add' ? null : 'add')}><Plus size={17} /></Button><span className="darl-agent-composer-spacer" />{models.length > 0 && <Button variant="outline" size="sm" onClick={() => setPicker(picker === 'models' ? null : 'models')}><span>{selectedModel?.name || '选择模型'}</span><ChevronDown size={13} /></Button>}{supportedEfforts.length > 0 && <Button variant="outline" size="sm" onClick={() => setPicker(picker === 'effort' ? null : 'effort')}><span>思考：{effort}</span><ChevronDown size={13} /></Button>}{isGenerating ? <Button variant="outline" size="icon" aria-label="停止生成" onClick={onStop}><Square size={14} /></Button> : <Button variant="default" size="icon" aria-label="发送消息" disabled={!draft.trim() || !onSend || !activeSession || pending} onClick={submit}><Send size={16} /></Button>}</div>
        </div>
        {error && <p role="alert">{error}</p>}<small className="darl-agent-composer-note">@ 应用 · / Skill · Enter 发送</small>
      </footer>
    </>}

    {picker === 'add' && <Picker title="添加" onClose={closePicker}><div className="darl-agent-add-list"><button type="button" onClick={() => { setUploadKind('file'); fileInput.current?.click(); }}><Paperclip size={16} /><span><strong>上传文件</strong><small>添加图片、文档或其他材料</small></span></button><button type="button" onClick={() => setPicker('apps')}><Wrench size={16} /><span><strong>选择应用</strong><small>启用网站的 MCP 工具</small></span></button><button type="button" onClick={() => setPicker('skills')}><Sparkles size={16} /><span><strong>选择 Skill</strong><small>选择可复用的工作流程</small></span></button></div></Picker>}
    {picker === 'apps' && <Picker title="选择应用" onClose={closePicker}><div className="darl-agent-picker-list">{applications.map((app) => <button key={app.id} type="button" className="darl-agent-picker-row" aria-pressed={applicationIds.includes(app.id)} disabled={app.status !== undefined && app.status !== 'connected'} onClick={() => toggleApplication(app.id)}><span className="darl-agent-picker-icon">{app.icon || <Wrench size={15} />}</span><span className="darl-agent-picker-copy"><strong>{app.name}</strong><small>{app.description || `${app.tools?.length || 0} 个工具`} · {statusText(app.status)}</small></span>{applicationIds.includes(app.id) && <Check size={16} />}</button>)}{!applications.length && <p className="darl-agent-empty">暂无可用应用</p>}</div></Picker>}
    {picker === 'skills' && <Picker title="选择 Skill" onClose={closePicker}><div className="darl-agent-picker-toolbar"><span>已安装的 Skill</span><span className="darl-agent-picker-toolbar-actions"><button type="button" onClick={() => { setPicker(null); setSkillManagerOpen(true); }}><Pencil size={14} />管理 Skill</button><button type="button" onClick={() => { setUploadKind('skill'); fileInput.current?.click(); }}><Upload size={14} />上传</button></span></div><div className="darl-agent-picker-list">{availableSkills.filter((skill) => skill.enabled !== false).map((skill) => <button key={skill.id} type="button" className="darl-agent-picker-row" aria-pressed={skillIds.includes(skill.id)} onClick={() => toggleSkill(skill.id)}><span className="darl-agent-picker-icon darl-agent-picker-icon--skill"><Sparkles size={15} /></span><span className="darl-agent-picker-copy"><strong>{skill.name}</strong><small>{skill.description || '可复用的 Agent 工作流程'}{skill.version ? ` · v${skill.version}` : ''}</small></span>{skillIds.includes(skill.id) && <Check size={16} />}</button>)}{!availableSkills.length && <p className="darl-agent-empty">暂无 Skill</p>}</div></Picker>}
    {picker === 'models' && <Picker title="选择模型" onClose={closePicker}><div className="darl-agent-picker-list">{models.map((model) => <button key={model.id} type="button" className="darl-agent-picker-row" onClick={() => { setModelId(model.id); setPicker(null); }}><span className="darl-agent-picker-icon"><Bot size={15} /></span><span className="darl-agent-picker-copy"><strong>{model.name}</strong><small>{model.description || '对话模型'}</small></span>{model.id === modelId && <Check size={16} />}</button>)}</div></Picker>}
    {picker === 'effort' && selectedModel && <Picker title="思考强度" onClose={closePicker}><div className="darl-agent-effort-list">{supportedEfforts.map((value) => <button type="button" key={value} data-selected={value === effort} onClick={() => { setEffort(value); setPicker(null); }}><strong>{value}</strong><small>{value === '低' ? '更快响应' : value === '高' ? '更深入分析' : '平衡速度和质量'}</small>{value === effort && <Check size={15} />}</button>)}</div></Picker>}
    <input ref={fileInput} aria-label="选择上传文件" type="file" hidden multiple={uploadKind === 'file'} onChange={(event) => { const files = Array.from(event.target.files ?? []); const first = files[0]; if (uploadKind === 'skill' && files.length) void Promise.resolve().then(async () => { const imported = await importSkillPackage(files); setLocalSkills((current) => [...current.filter((item) => item.id !== imported.id), imported]); await onSkillImport?.(imported); if (first) await onSkillUpload?.(first); }).catch((reason) => setError(reason instanceof Error ? reason.message : '导入失败')); if (uploadKind === 'file' && files.length) { setAttachments((current) => ({ ...current, [draftKey]: [...(current[draftKey] ?? []), ...files] })); if (onFileUpload) void Promise.resolve().then(() => onFileUpload(files)).catch(() => setError('附件处理失败')); } setPicker(null); event.currentTarget.value = ''; }} accept={uploadKind === 'skill' ? '.md,.zip,text/markdown,application/zip' : undefined} />
    <SkillManager open={skillManagerOpen} skills={availableSkills} onClose={() => setSkillManagerOpen(false)} onUse={(skill) => { insertReference('skill', skill.id, skill.name); setSkillManagerOpen(false); }} onImport={async (skill) => { setLocalSkills((current) => [...current.filter((item) => item.id !== skill.id), skill]); await onSkillImport?.(skill); }} onSave={async (skill) => { setLocalSkills((current) => [...current.filter((item) => item.id !== skill.id), skill]); await onSkillSave?.(skill); }} onDelete={async (skillId) => { setLocalSkills((current) => current.filter((skill) => skill.id !== skillId)); await onSkillDelete?.(skillId); }} onFavoriteChange={async (skillId, favorite) => { setLocalSkills((current) => current.map((skill) => skill.id === skillId ? { ...skill, favorite } : skill)); await onSkillFavoriteChange?.(skillId, favorite); }} />
  </aside>;
}

export type { AgentApplication, AgentMessage, AgentModel, AgentSession, AgentSkill, AgentTool, AgentToolCall } from './types';
