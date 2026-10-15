import { useEffect, useRef, useState } from 'react';
import { AgentSidebar, AgentSettingsCard, DarlUIProvider, ModelSettingsCard, SettingsPage, type AgentApplication, type AgentToolCall, type AgentModelConfig, type AgentSendRequest, type AgentSession, type AgentSkill, type ModelProvider } from '@darl/ui';
import { ArrowLeft, BookOpen, Bot, MessageSquare, Settings2, Wrench } from 'lucide-react';
import { lines } from '../stream';
import { Guide } from './Guide';

const storageKey = 'darl-agent-chat-v1';
const persistedSessions = (sessions: AgentSession[]) => sessions.map((session) => ({ ...session, messages: session.messages.map((message) => ({ ...message, toolCalls: message.toolCalls?.map(({ output: _output, ...call }) => call) })) }));
const newSession = (): AgentSession => ({ id: crypto.randomUUID(), title: '新对话', messages: [] });
function restore(): { sessions: AgentSession[]; activeId: string; skills: AgentSkill[]; error?: string } {
  let error: string | undefined;
  try {
    const raw = localStorage.getItem(storageKey);
    const value = JSON.parse(raw || 'null');
    if (raw) error = '历史记录格式异常，未能恢复。';
    if (value && Array.isArray(value.sessions) && value.sessions.length && value.sessions.every((session: AgentSession) => typeof session.id === 'string' && Array.isArray(session.messages)) && Array.isArray(value.skills)) {
      return { ...value, activeId: value.sessions.some((session: AgentSession) => session.id === value.activeId) ? value.activeId : value.sessions[0].id, sessions: value.sessions.map((session: AgentSession) => ({ ...session, messages: session.messages.map((message) => ({ ...message, toolCalls: message.toolCalls?.map((call) => ['pending', 'running', 'confirmation'].includes(call.status) ? { ...call, status: 'error' as const, error: '运行已中断，请重新发起请求。' } : call), streaming: false, content: message.content || (message.streaming ? '生成已中断，请重新生成。' : '') })) })) };
    }
  } catch { error = '浏览器存储不可用或历史记录无法读取。'; }
  const session = newSession();
  return { sessions: [session], activeId: session.id, skills: [], error };
}
async function api<T>(path: string, body?: unknown, method = body ? 'POST' : 'GET'): Promise<T> {
  const response = await fetch(`/api/${path}`, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, ...(body ? { body: JSON.stringify(body) } : {}) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `请求失败：HTTP ${response.status}`);
  return data;
}

export function App() {
  const [initial] = useState(restore);
  const [sessions, setSessions] = useState(initial.sessions);
  const [activeId, setActiveId] = useState(initial.activeId);
  const [skills, setSkills] = useState(initial.skills);
  const [providers, setProviders] = useState<ModelProvider[]>([]);
  const [applications, setApplications] = useState<AgentApplication[]>([]);
  const [applicationRevision, setApplicationRevision] = useState(0);
  const [applicationsLoading, setApplicationsLoading] = useState(false);
  const [applicationError, setApplicationError] = useState('');
  const [settingsSection, setSettingsSection] = useState('models');
  const [systemPrompt, setSystemPrompt] = useState<string | null>(null);
  const [promptError, setPromptError] = useState('');
  const [promptRevision, setPromptRevision] = useState(0);
  const [modelId, setModelId] = useState('');
  const [effort, setEffort] = useState<string | undefined>();
  const [open, setOpen] = useState(true);
  const [settings, setSettings] = useState(false);
  const [guide, setGuide] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState(initial.error || '');
  const [storageError, setStorageError] = useState('');
  const running = useRef<AbortController | null>(null);
  const models = providers.flatMap((provider) => provider.models.filter((model) => model.type === 'text' && model.enabled !== false).map((model) => ({ ...model, id: `${provider.id}/${encodeURIComponent(model.id)}` })));
  const availableModelId = models.some((model) => model.id === modelId) ? modelId : models[0]?.id;

  useEffect(() => {
    let active = true;
    api<ModelProvider[]>('providers').then((value) => { if (active) setProviders(value); }).catch((reason) => { if (active) setError(reason.message); });
    return () => { active = false; };
  }, []);
  useEffect(() => {
    if (!settings || settingsSection !== 'agent') return;
    let active = true;
    setSystemPrompt(null); setPromptError('');
    api<{ systemPrompt: string }>('agent-settings').then((value) => { if (active) setSystemPrompt(value.systemPrompt); })
      .catch((reason) => { if (active) setPromptError(reason.message); });
    return () => { active = false; };
  }, [settings, settingsSection, promptRevision]);
  useEffect(() => {
    const controller = new AbortController();
    setApplicationsLoading(true); setApplicationError('');
    fetch('/api/applications', { signal: controller.signal }).then(async (response) => {
      const value = await response.json();
      if (!response.ok) throw new Error(value.error || '应用加载失败');
      if (!controller.signal.aborted) setApplications(value);
    }).catch((reason) => { if (!controller.signal.aborted) setApplicationError(reason.message); })
      .finally(() => { if (!controller.signal.aborted) setApplicationsLoading(false); });
    return () => controller.abort();
  }, [applicationRevision]);
  useEffect(() => {
    try { localStorage.setItem(storageKey, JSON.stringify({ sessions: persistedSessions(sessions), activeId, skills })); setStorageError(''); }
    catch { setStorageError('浏览器存储已满或不可用，当前更改无法在刷新后恢复。'); }
  }, [sessions, activeId, skills]);
  useEffect(() => () => running.current?.abort(), []);

  const patchMessage = (sessionId: string, messageId: string, content: (previous: string) => string, streaming: boolean) => {
    setSessions((current) => current.map((session) => session.id === sessionId ? { ...session, updatedAt: new Date().toLocaleString(), messages: session.messages.map((message) => message.id === messageId ? { ...message, content: content(message.content), streaming } : message) } : session));
  };
  const run = async (request: AgentSendRequest, previous?: AgentSession['messages']) => {
    if (running.current) throw new Error('请先停止当前生成');
    if (request.files?.length) throw new Error('本示例暂只支持文本，附件尚未接入模型');
    const selected = models.find((model) => model.id === request.modelId);
    if (!selected) throw new Error('请先在模型设置中配置并启用文本模型');
    const source = sessions.find((session) => session.id === request.sessionId);
    if (!source) throw new Error('会话不存在');
    const user = { id: crypto.randomUUID(), role: 'user' as const, content: request.content };
    const history = previous ?? [...source.messages, user];
    const answer = { id: crypto.randomUUID(), role: 'assistant' as const, content: '', streaming: true };
    const controller = new AbortController();
    running.current = controller;
    setGenerating(true); setError('');
    setSessions((current) => current.map((session) => session.id === source.id ? { ...session, title: history.find((message) => message.role === 'user')?.content.replace(/\[([^\]]+)\]\((?:skill|app):[^)]+\)/g, '$1').slice(0, 32) || '新对话', messages: [...history, answer] } : session));
    const finish = () => {
      setSessions((current) => current.map((session) => session.id === source.id ? { ...session, messages: session.messages.map((message) => message.id === answer.id ? { ...message, toolCalls: message.toolCalls?.map((call) => ['pending', 'running', 'confirmation'].includes(call.status) ? { ...call, status: 'error' as const, error: '工具调用已中断，请重新发起请求。' } : call) } : message) } : session));
      patchMessage(source.id, answer.id, (value) => value || '生成已停止。', false);
      if (running.current === controller) { running.current = null; setGenerating(false); }
    };
    try {
      const usedSkills = skills.filter((skill) => skill.enabled !== false && (request.skillIds.includes(skill.id) || history.some((message) => message.role === 'user' && message.content.includes(`(skill:${encodeURIComponent(skill.id)})`))));
      if (usedSkills.some((skill) => !skill.instructions?.trim())) throw new Error('选中的 Skill 没有指令，请先编辑');
      const response = await fetch('/api/chat', {
        method: 'POST', signal: controller.signal, headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ applicationIds: request.applicationIds, providerId: selected.providerId, modelId: decodeURIComponent(selected.id.slice(selected.id.indexOf('/') + 1)), effort: request.reasoningEffort, messages: history.filter((message) => message.content).map(({ role, content }) => ({ role, content })), skills: usedSkills.map(({ name, instructions }) => ({ name, instructions })) }),
      });
      if (!response.ok) throw new Error((await response.json()).error || `HTTP ${response.status}`);
      if (!response.body) throw new Error('响应为空');
      // Resolve on connection so AgentSidebar clears the sent draft while output streams.
      void (async () => {
        let done = false;
        try {
          for await (const line of lines(response.body!)) {
            if (!line) continue;
            const event = JSON.parse(line);
            if (event.type === 'error') throw new Error(event.error);
            if (event.type === 'tool') {
              const call = event.call as AgentToolCall;
              setSessions((current) => current.map((session) => session.id === source.id ? { ...session, messages: session.messages.map((message) => message.id === answer.id ? { ...message, toolCalls: [...(message.toolCalls || []).filter((item) => item.id !== call.id), call] } : message) } : session));
            }
            if (event.type === 'text') patchMessage(source.id, answer.id, (value) => value + event.text, true);
            if (event.type === 'done') done = true;
          }
          if (!done && !controller.signal.aborted) throw new Error('连接中断，请重新生成');
        } catch (reason) {
          if (!controller.signal.aborted) patchMessage(source.id, answer.id, (value) => `${value}\n\n生成失败：${reason instanceof Error ? reason.message : '请求失败'}`, false);
        } finally { finish(); }
      })();
    } catch (reason) {
      if (!controller.signal.aborted) {
        setSessions((current) => current.map((session) => session.id === source.id ? { ...session, messages: source.messages } : session));
        finish();
        throw reason;
      }
      finish();
    }
  };
  const regenerate = (messageId: string) => {
    const session = sessions.find((item) => item.id === activeId);
    const index = session?.messages.findIndex((message) => message.id === messageId) ?? -1;
    if (!session || index < 1 || running.current) return;
    const history = session.messages.slice(0, index);
    const user = history.at(-1);
    if (user?.role !== 'user') return;
    void run({ sessionId: session.id, content: user.content, skillIds: [], applicationIds: [...user.content.matchAll(/\]\(app:([^)]*)\)/g)].flatMap((match) => { try { return [decodeURIComponent(match[1])]; } catch { return []; } }), modelId: availableModelId, reasoningEffort: models.find((model) => model.id === availableModelId)?.reasoningEfforts?.includes(effort || '') ? effort : undefined }, history).catch((reason) => setError(reason.message));
  };
  const saveSkill = async (skill: AgentSkill) => {
    const next = [...skills.filter((item) => item.id !== skill.id), skill];
    // Fail before the component reports success if persistence is unavailable.
    localStorage.setItem(storageKey, JSON.stringify({ sessions: persistedSessions(sessions), activeId, skills: next }));
    setSkills(next);
  };
  const showSettings = () => { setOpen(false); setGuide(false); setSettings(true); };
  const showGuide = () => { setOpen(false); setSettings(false); setGuide(true); };
  const renameSession = (sessionId: string, title: string) => {
    setSessions((current) => current.map((session) => session.id === sessionId ? { ...session, title, updatedAt: new Date().toLocaleString() } : session));
  };
  const buttonClass = 'darl-button darl-button--outline darl-button-size--default';

  return <DarlUIProvider theme={{ mode: 'dark', primaryColor: '#8ba4c5' }} className="chat-example">
    <div className={`example-page ${open ? 'with-agent' : ''}`}>
      <header className="example-header"><a href="http://localhost:5188">Darl UI <span>/ Agent Chat</span></a><div><button className={buttonClass} onClick={showGuide}><BookOpen size={16} />开发说明</button><button className={buttonClass} onClick={showSettings}><Settings2 size={16} />设置</button><button className={buttonClass} onClick={() => { setGuide(false); setSettings(false); setOpen((value) => !value); }}><MessageSquare size={16} />聊天</button></div></header>
      {(error || storageError) && <p className="example-error" role="alert">{error || storageError}</p>}
      {guide ? <Guide onBack={() => { setGuide(false); setOpen(true); }} /> : settings ? <main className="example-settings"><button className={buttonClass} onClick={() => { setSettings(false); setOpen(true); }}><ArrowLeft size={15} />返回聊天</button><SettingsPage title="设置" activeSection={settingsSection} onSectionChange={setSettingsSection} sections={[{ id: 'models', label: '模型', icon: <Settings2 /> }, { id: 'agent', label: 'Agent', icon: <Bot /> }, { id: 'applications', label: '应用 / MCP', icon: <Wrench /> }]}>{settingsSection === 'agent' ? systemPrompt !== null ? <AgentSettingsCard systemPrompt={systemPrompt} onSave={async (value) => { const saved = await api<{ systemPrompt: string }>('agent-settings', { systemPrompt: value }); setSystemPrompt(saved.systemPrompt); }} /> : <div>{promptError ? <><p role="alert">{promptError}</p><button className={buttonClass} onClick={() => setPromptRevision((value) => value + 1)}>重新加载提示词</button></> : <p role="status">正在加载提示词…</p>}</div> : settingsSection === 'applications' ? <section className="example-applications"><h2>应用 / MCP</h2><p>服务端配置连接，工具目录由 MCP 动态发现。在对话中 @ 引用一次应用，后续消息即可继续使用它的工具。</p><button className={buttonClass} disabled={applicationsLoading} onClick={() => setApplicationRevision((value) => value + 1)}>{applicationsLoading ? '正在连接…' : '重新连接'}</button>{applicationError && <p role="alert">{applicationError}</p>}{!applicationsLoading && !applications.length && <p>暂无应用，请在服务端配置 applications.json。</p>}{applications.map((app) => <article key={app.id}><h3>{app.name} · {app.status === 'connected' ? '已连接' : '未连接'}</h3><p>{app.description}</p><ul>{app.tools?.map((tool) => <li key={tool.name}><strong>{tool.title || tool.name}</strong><span>{tool.risk === 'read' ? '只读' : '执行前确认'}</span><p>{tool.description}</p></li>)}</ul></article>)}</section> : <ModelSettingsCard providers={providers}
        onProviderSave={async (provider, apiKey) => setProviders(await api<ModelProvider[]>('providers', { provider, apiKey }))}
        onProviderDelete={async (id) => setProviders(await api<ModelProvider[]>(`providers/${id}`, undefined, 'DELETE'))}
        onTestConnection={async (provider) => setProviders(await api<ModelProvider[]>(`providers/${provider.id}/test`, {}))}
        onFetchModels={(provider) => api<AgentModelConfig[]>(`providers/${provider.id}/models`, {})}
      />}</SettingsPage></main> : <main className="example-home"><span className="example-eyebrow">AGENT CHAT EXAMPLE</span><h1>让网站助手<br />真正开始工作。</h1><p>使用现有聊天 UI，连接真实模型。对话、历史和 Skills 保存在当前浏览器。</p><div className="example-actions"><button className="darl-button darl-button--default darl-button-size--default" onClick={() => setOpen(true)}><MessageSquare size={16} />打开助手</button><button className={buttonClass} onClick={showSettings}><Settings2 size={16} />模型设置</button></div><div className="example-info"><div><span>模型</span><strong>{models.find((model) => model.id === availableModelId)?.name || '尚未配置'}</strong></div><div><span>会话</span><strong>{sessions.length}</strong></div><div><span>Skills</span><strong>{skills.length}</strong></div></div><small>支持文本对话与 MCP 工具调用。用 @ 引用一次即可在本对话持续使用；写入或未知工具执行前需要确认。Skill 指令会发送给模型，附带脚本不会在本机执行。附件和多媒体生成尚未接入。</small></main>}
    </div>
    <AgentSidebar open={open} onOpenChange={setOpen} sessions={sessions} activeSessionId={activeId} onSessionChange={setActiveId} onSessionRename={renameSession}
      onNewSession={() => { const session = newSession(); setSessions((current) => [session, ...current]); setActiveId(session.id); }}
      onSend={run} onStop={() => running.current?.abort()} isGenerating={generating} onRegenerate={regenerate}
      applications={applications} onToolConfirm={async (id, approved) => { await api(`tool-confirmations/${id}`, { approved }); }}
      models={models} selectedModelId={availableModelId} onSelectedModelIdChange={setModelId} selectedReasoningEffort={effort} onSelectedReasoningEffortChange={setEffort}
      skills={skills} onSkillImport={saveSkill} onSkillSave={saveSkill}
      onSkillDelete={async (id) => { const next = skills.filter((skill) => skill.id !== id); localStorage.setItem(storageKey, JSON.stringify({ sessions: persistedSessions(sessions), activeId, skills: next })); setSkills(next); }}
      onSkillFavoriteChange={async (id, favorite) => { const skill = skills.find((item) => item.id === id); if (skill) await saveSkill({ ...skill, favorite }); }}
    />
  </DarlUIProvider>;
}
