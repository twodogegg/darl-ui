import { useFishVoice, VoiceSettings } from './VoiceSettings';
import { useEffect, useRef, useState } from 'react';
import { AgentPlaza, AgentSidebar, ApprovalModeSelector, type AgentApprovalMode, AgentsSettingsCard, DefaultModelSelector, DarlUIProvider, ModelManagementCard, SettingsPage, SkillManager, defaultModelConfiguration, defaultReasoningEffort, toAgentModels, type AgentApplication, type AgentAttachment, type AgentConfig, type AgentErrorInfo, type AgentExecutionEvent, type AgentToolCall, type AgentSendRequest, type AgentSession, type AgentSkill, type DefaultModelDraft, type DefaultModelOption, type DefaultModelSelection, type ModelConfiguration, type ModelProvider } from '@darl/ui';
import { ArrowLeft, Blocks, BookOpen, Bot, Database, MessageSquare, Settings2, Sparkles, Wrench } from 'lucide-react';
import createSkillPrompt from '../prompts/create-skill.md?raw';
import { lines } from '../stream';
import { Guide } from './Guide';
import { ProjectsPage } from './ProjectsPage';
import { MediaConcurrencySettings } from './MediaConcurrencySettings';
import { MediaGenerationPage } from './MediaGenerationPage';
import { McpSettings } from './McpSettings';
import { ToolsSettings } from './ToolsSettings';
import { StorageSettings } from './StorageSettings';
import { finishToolCalls, messageTextForModel } from './message-history';

const persistedSessions = (sessions: AgentSession[]) => sessions.map((session) => ({ ...session, messages: session.messages.map((message) => ({ ...message, attachments: message.attachments?.map((attachment) => typeof attachment === 'string' ? attachment : { ...attachment, url: attachment.url?.startsWith('data:') ? undefined : attachment.url }), toolCalls: message.toolCalls?.map(({ output: _output, ...call }) => call) })) }));
const interruptedExecutionStatuses = new Set<AgentExecutionEvent['status']>(['pending', 'started', 'running', 'retrying', 'confirmation']);
const terminalExecutionStatuses = new Set<AgentExecutionEvent['status']>(['success', 'error', 'cancelled', 'timeout']);
function recoverTimeline(timeline: AgentExecutionEvent[] | undefined) {
  if (!timeline?.length) return timeline;
  const recoveredAt = new Date().toISOString();
  const cleaned = timeline.filter((event, index) => {
    if (event.status !== 'cancelled') return true;
    const key = event.toolCallId || event.runId || event.id;
    return !timeline.slice(index + 1).some((candidate) => (candidate.toolCallId || candidate.runId || candidate.id) === key && candidate.status === 'success');
  });
  return cleaned.map((event, index) => {
    if (!interruptedExecutionStatuses.has(event.status)) return event;
    const key = event.toolCallId || event.runId || event.id;
    let latestIndex = -1;
    for (let candidateIndex = timeline.length - 1; candidateIndex >= 0; candidateIndex -= 1) {
      const candidate = timeline[candidateIndex];
      if ((candidate.toolCallId || candidate.runId || candidate.id) === key) { latestIndex = candidateIndex; break; }
    }
    if (latestIndex !== index || terminalExecutionStatuses.has(timeline[latestIndex]?.status)) return event;
    return { ...event, status: 'cancelled' as const, endedAt: recoveredAt, error: { code: 'REQUEST_CANCELLED', stage: 'cancellation', message: '运行已中断，请重新发起请求。', retryable: true, suggestion: '可以点击“重新生成”继续请求。', runId: event.runId, parentRunId: event.parentRunId } };
  });
}
const newSession = (agentId?: string): AgentSession => ({ id: crypto.randomUUID(), ...(agentId ? { agentId } : {}), title: '新对话', messages: [] });
const defaultMediaModels: DefaultModelOption[] = [
  { id: 'gpt-image-2', name: 'GPT Image 2', type: 'image', description: '图片生成模型', capabilities: { resolutions: ['1K', '2K', '4K'], aspectRatios: ['1:1', '2:3', '3:2', '3:4', '4:3', '9:16', '16:9'] }, defaults: { resolution: '2K', aspectRatio: '16:9' } },
  { id: 'gpt-image-2.5', name: 'GPT Image 2.5', type: 'image', description: '图片生成模型', capabilities: { resolutions: ['1K', '2K', '4K'], aspectRatios: ['1:1', '2:3', '3:2', '3:4', '4:3', '9:16', '16:9'] }, defaults: { resolution: '2K', aspectRatio: '16:9' } },
  { id: 'gemini-3-pro-image-preview', name: 'Gemini 3 Pro Image Preview', type: 'image', description: '图片生成模型', capabilities: { resolutions: ['1K', '2K', '4K'], aspectRatios: ['1:1', '2:3', '3:2', '3:4', '4:3', '9:16', '16:9'] }, defaults: { resolution: '2K', aspectRatio: '16:9' } },
  { id: 'minimax-h3-flash', name: 'MiniMax H3 Flash', type: 'video', description: '快速视频生成模型', capabilities: { resolutions: ['480', '768'], aspectRatios: ['16:9', '9:16'] }, defaults: { resolution: '480', aspectRatio: '16:9' } },
];
const initialDefaultMediaSelection: DefaultModelDraft = {
  image: { modelId: 'gpt-image-2', resolution: '2K', aspectRatio: '16:9' },
  video: { modelId: 'minimax-h3-flash', resolution: '480', aspectRatio: '16:9' },
};
async function api<T>(path: string, body?: unknown, method = body ? 'POST' : 'GET'): Promise<T> {
  let response: Response;
  try { response = await fetch(`/api/${path}`, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, ...(body ? { body: JSON.stringify(body) } : {}) }); }
  catch { throw new Error('无法连接 Agent 服务，请确认本地 5197 服务已启动'); }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof data.error === 'string' ? data.error : data.error?.message || `请求失败：HTTP ${response.status}`);
  return data;
}

export function App() {
  const fishVoice = useFishVoice();
  const [sessions, setSessions] = useState<AgentSession[]>(() => [newSession()]);
  const [activeId, setActiveId] = useState(() => sessions[0].id);
  const [skills, setSkills] = useState<AgentSkill[]>([]);
  const [providers, setProviders] = useState<ModelProvider[]>([]);
  const [modelConfiguration, setModelConfiguration] = useState<ModelConfiguration>(() => defaultModelConfiguration());
  const [applications, setApplications] = useState<AgentApplication[]>([]);
  const [agents, setAgents] = useState<AgentConfig[]>([]);
  const [approvalMode, setApprovalMode] = useState<AgentApprovalMode>('auto');
  const [approvalReady, setApprovalReady] = useState(false);
  const [approvalSaving, setApprovalSaving] = useState(false);
  const [defaultMediaSelection, setDefaultMediaSelection] = useState<DefaultModelDraft>(initialDefaultMediaSelection);
  const [defaultMediaModelsOpen, setDefaultMediaModelsOpen] = useState(false);
  const [applicationRevision, setApplicationRevision] = useState(0);
  const [, setApplicationsLoading] = useState(false);
  const [, setApplicationError] = useState('');
  const [settingsSection, setSettingsSection] = useState('models');
  const [skillManagerOpen, setSkillManagerOpen] = useState(false);
  const [modelId, setModelId] = useState('');
  const agentId = sessions.find(session => session.id === activeId)?.agentId;
  const [effort, setEffort] = useState<string | undefined>();
  const [open, setOpen] = useState(true);
  const [settings, setSettings] = useState(false);
  const [settingsReturn, setSettingsReturn] = useState<'chat' | 'media'>('chat');
  const [guide, setGuide] = useState(false);
  const [projectsVisible, setProjectsVisible] = useState(false);
  const [mediaJobsVisible, setMediaJobsVisible] = useState(false);
  const [plazaVisible, setPlazaVisible] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState('');
  const [hydrated, setHydrated] = useState(false);
  const running = useRef<AbortController | null>(null);
  const models = toAgentModels(modelConfiguration, providers).filter((model) => model.type === 'text' && model.enabled !== false);
  const availableModelId = models.some((model) => model.id === modelId) ? modelId : models[0]?.id;
  const availableModel = models.find((model) => model.id === availableModelId);
  // 用户尚未选择时，沿用模型配置的默认思考等级；没配置就是空，不按列表顺序臆造。
  const activeEffort = availableModel?.reasoningEfforts?.includes(effort ?? '') ? effort : defaultReasoningEffort(availableModel);

  useEffect(() => { let active = true; api<{ mode: AgentApprovalMode }>('approval-settings').then(value => { if (active) { setApprovalMode(value.mode); setApprovalReady(true); } }).catch(reason => { if (active) setError(reason.message); }); return () => { active = false; }; }, []);
  const updateApprovalMode = async (mode: AgentApprovalMode) => {
    setApprovalSaving(true);
    try { setApprovalMode((await api<{ mode: AgentApprovalMode }>('approval-settings', { mode })).mode); setApprovalReady(true); }
    finally { setApprovalSaving(false); }
  };
  useEffect(() => {
    let active = true;
    api<ModelProvider[]>('providers').then((value) => { if (active) setProviders(value); }).catch((reason) => { if (active) setError(reason.message); });
    return () => { active = false; };
  }, []);
  useEffect(() => {
    let active = true;
    api<{ sessions: AgentSession[]; activeId?: string; skills: AgentSkill[] }>('state').then((value) => {
      if (!active) return;
      const restored = (value.sessions.length ? value.sessions.map((session) => ({ ...session, agentId: session.agentId || session.messages.find(message => message.role === 'user' && message.agentId)?.agentId || (session.messages.length ? 'default' : undefined), messages: session.messages.map((message) => ({ ...message, toolCalls: finishToolCalls(message.toolCalls, { code: 'REQUEST_CANCELLED', stage: 'cancellation', message: '运行已中断。', retryable: false, suggestion: '可继续对话或重新发起任务。' }), timeline: recoverTimeline(message.timeline), streaming: false, content: message.content || (message.streaming && message.error?.stage !== 'cancellation' ? '生成已中断，请重新生成。' : '') })) })) : [newSession()]) as AgentSession[];
      setSessions(restored);
      setActiveId(restored.some((session) => session.id === value.activeId) ? value.activeId! : restored[0].id);
      const current = restored.find(session => session.id === value.activeId) || restored[0];
      if (!current.agentId) { setPlazaVisible(true); setOpen(false); }
      setSkills(Array.isArray(value.skills) ? value.skills : []);
      setHydrated(true);
    }).catch((reason) => { if (active) { setError(reason.message); setHydrated(true); } });
    return () => { active = false; };
  }, []);
  useEffect(() => {
    let active = true;
    api<ModelConfiguration>('model-config').then((value) => { if (active) setModelConfiguration(value); }).catch((reason) => { if (active) setError(reason.message); });
    return () => { active = false; };
  }, []);
  useEffect(() => {
    let active = true;
    api<AgentConfig[]>('agents').then((value) => { if (active) setAgents(value); }).catch((reason) => { if (active) setError(reason.message); });
    return () => { active = false; };
  }, []);
  useEffect(() => {
    let active = true;
    api<DefaultModelDraft>('default-models').then((value) => { if (active) setDefaultMediaSelection(value); }).catch((reason) => { if (active) setError(reason.message); });
    return () => { active = false; };
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    setApplicationsLoading(true); setApplicationError('');
    fetch(`/api/applications${applicationRevision ? '?refresh=1' : ''}`, { signal: controller.signal }).then(async (response) => {
      const value = await response.json();
      if (!response.ok) throw new Error(value.error || '应用加载失败');
      if (!controller.signal.aborted) { setApplications(value); }
    }).catch((reason) => { if (!controller.signal.aborted) setApplicationError(reason.message); })
      .finally(() => { if (!controller.signal.aborted) setApplicationsLoading(false); });
    return () => controller.abort();
  }, [applicationRevision]);
  useEffect(() => {
    if (!hydrated) return;
    const timer = window.setTimeout(() => { void api('state', { sessions: persistedSessions(sessions), activeId }).catch((reason) => setError(reason.message)); }, 250);
    return () => window.clearTimeout(timer);
  }, [sessions, activeId, hydrated]);
  useEffect(() => () => running.current?.abort(), []);

  const patchMessage = (sessionId: string, messageId: string, content: (previous: string) => string, streaming: boolean, error?: AgentErrorInfo) => {
    setSessions((current) => current.map((session) => session.id === sessionId ? { ...session, updatedAt: new Date().toLocaleString(), messages: session.messages.map((message) => message.id === messageId ? { ...message, content: content(message.content), streaming, ...(error ? { error } : {}) } : message) } : session));
  };
  const appendTimeline = (sessionId: string, messageId: string, event: AgentExecutionEvent) => {
    setSessions((current) => current.map((session) => session.id === sessionId ? { ...session, messages: session.messages.map((message) => message.id === messageId ? { ...message, timeline: [...(message.timeline || []), event] } : message) } : session));
  };
  const finishTimeline = (sessionId: string, messageId: string, status: AgentExecutionEvent['status'], runId: string, requestId: string, error?: AgentErrorInfo, completed = false) => {
    setSessions((current) => current.map((session) => session.id === sessionId ? { ...session, messages: session.messages.map((message) => {
      if (message.id !== messageId || !message.timeline?.length) return message;
      const now = new Date().toISOString();
      const active = message.timeline.filter((event) => {
        if (!interruptedExecutionStatuses.has(event.status)) return false;
        const key = event.toolCallId || event.runId || event.id;
        const latest = [...message.timeline!].reverse().find((candidate) => (candidate.toolCallId || candidate.runId || candidate.id) === key);
        return latest?.id === event.id;
      });
      const next = [...message.timeline];
      active.forEach((event) => next.push({ ...event, id: crypto.randomUUID(), status, timestamp: now, endedAt: now, durationMs: event.startedAt ? Math.max(0, Date.now() - Date.parse(event.startedAt)) : undefined, ...(error ? { error } : {}) }));
      const root = next.find((event) => event.source === 'agent' && event.runId === runId);
      if (completed && !next.some((event) => event.source === 'agent' && event.runId === runId && ['success', 'error', 'cancelled', 'timeout'].includes(event.status))) next.push({ id: crypto.randomUUID(), source: 'agent', status: 'success', name: root?.name || 'Agent', timestamp: now, startedAt: root?.startedAt, endedAt: now, durationMs: root?.startedAt ? Math.max(0, Date.now() - Date.parse(root.startedAt)) : undefined, runId, requestId: requestId || undefined });
      return { ...message, timeline: next };
    }) } : session));
  };
  const run = async (request: AgentSendRequest, previous?: AgentSession['messages'], newSource?: AgentSession) => {
    if (running.current) throw new Error('请先停止当前生成');
    const selected = models.find((model) => model.id === request.modelId);
    if (!selected && !request.agentId) throw new Error('请先在模型设置中配置并启用文本模型');
    const source = newSource || sessions.find((session) => session.id === request.sessionId);
    if (!source) throw new Error('会话不存在');
    if (!source.agentId) throw new Error('请先从 Agent 广场选择 Agent 开始对话');
    const conversationAgentId = source.agentId;
    const userAttachments: AgentAttachment[] | undefined = request.uploadedAttachments?.length
      ? request.uploadedAttachments
      : request.attachments?.map((attachment) => ({ name: attachment.name, type: attachment.type, size: attachment.size, url: attachment.data }));
    const user = { id: crypto.randomUUID(), role: 'user' as const, content: request.content, agentId: conversationAgentId, ...(userAttachments?.length ? { attachments: userAttachments } : {}) };
    const history: AgentSession['messages'] = previous ?? [...source.messages, user];
    const answer = { id: crypto.randomUUID(), role: 'assistant' as const, content: '', streaming: true };
    const controller = new AbortController();
    let requestId = '';
    let runId = '';
    let streamError: AgentErrorInfo | undefined;
    let streamDone = false;
    running.current = controller;
    setGenerating(true); setError('');
    setSessions((current) => current.map((session) => session.id === source.id ? { ...session, title: history.find((message) => message.role === 'user')?.content.replace(/\[([^\]]+)\]\((?:skill|app|agent):[^)]+\)/g, '$1').slice(0, 32) || '新对话', messages: [...history, answer] } : session));
    const finish = (errorInfo?: AgentErrorInfo, completed = streamDone) => {
      const cancelled = controller.signal.aborted && !errorInfo ? { code: 'REQUEST_CANCELLED', stage: 'cancellation' as const, message: '生成已停止', requestId: requestId || undefined, runId: runId || undefined, retryable: false, suggestion: '可继续对话或重新发起任务。' } : errorInfo;
      setSessions((current) => current.map((session) => session.id === source.id ? { ...session, messages: session.messages.map((message) => message.id === answer.id ? { ...message, toolCalls: finishToolCalls(message.toolCalls, cancelled) } : message) } : session));
      const timelineStatus: AgentExecutionEvent['status'] = cancelled?.stage === 'timeout' ? 'timeout' : cancelled?.stage === 'cancellation' ? 'cancelled' : cancelled ? 'error' : 'success';
      finishTimeline(source.id, answer.id, timelineStatus, runId, requestId, cancelled, completed);
      patchMessage(source.id, answer.id, (value) => value || (cancelled ? '' : completed ? '' : '生成已停止。'), false, cancelled);
      if (running.current === controller) { running.current = null; setGenerating(false); }
    };
    try {
      const usedSkills = skills.filter((skill) => request.skillIds.includes(skill.id)
        || history.some((message) => message.role === 'user' && message.content.includes(`(skill:${encodeURIComponent(skill.id)})`)));
      if (usedSkills.some((skill) => !skill.instructions?.trim())) throw new Error('选中的 Skill 没有指令，请先编辑');
      const apiMessages = history.filter((message) => message.content || message.outputs?.length || message.attachments?.length || ('toolCalls' in message && message.toolCalls?.length)).map((message) => {
        const { role, attachments } = message;
        const fileContext = (attachments || []).flatMap((attachment) => typeof attachment !== 'string' && attachment.fileId ? [{ fileId: attachment.fileId, name: attachment.name, mimeType: attachment.type }] : []);
        const modelText = [messageTextForModel(message), fileContext.length ? `<USER_FILES untrusted="true">${JSON.stringify(fileContext)}</USER_FILES>` : ''].filter(Boolean).join('\n\n');
        const images = (attachments || []).flatMap((attachment) => {
          if (typeof attachment === 'string') return [];
        if (!attachment.type?.startsWith('image/')) return [];
        if (attachment.fileId) return [{ type: 'image' as const, name: attachment.name, mimeType: attachment.type || 'image/png', fileId: attachment.fileId, data: '', size: attachment.size }];
        if (!attachment.url?.startsWith('data:image/')) return [];
          return [{ type: 'image' as const, name: attachment.name, mimeType: attachment.type || 'image/png', data: attachment.url, size: attachment.size }];
        });
        return { role, content: images.length ? [{ type: 'text' as const, text: modelText }, ...images] : modelText };
      });
      let response: Response;
      try {
        response = await fetch('/api/chat', {
          method: 'POST', signal: controller.signal, headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ voiceMode: request.voiceMode === true, approvalMode, sessionId: request.sessionId, agentId: conversationAgentId, skillIds: usedSkills.map((skill) => skill.id), applicationIds: request.applicationIds, providerId: selected?.providerId, modelId: selected ? decodeURIComponent(selected.id.slice(selected.id.indexOf('/') + 1)) : undefined, effort: request.reasoningEffort, messages: apiMessages }),
        });
      } catch (reason) {
        if (controller.signal.aborted) throw reason;
        throw new Error('无法连接 Agent 服务，请确认本地 5197 服务已启动');
      }
      requestId = response.headers.get('X-Request-Id') || '';
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        const details = payload.error;
        const error = details && typeof details === 'object' ? details as AgentErrorInfo : undefined;
        if (error?.requestId) requestId = error.requestId;
        throw Object.assign(new Error(error?.message || (typeof details === 'string' ? details : `请求失败：HTTP ${response.status}`)), { agentError: error });
      }
      if (!response.body) throw new Error('响应为空');
      // Resolve on connection so AgentSidebar clears the sent draft while output streams.
      void (async () => {
        let done = false;
        try {
          for await (const line of lines(response.body!)) {
            if (!line) continue;
            const event = JSON.parse(line);
            if (event.type === 'meta') {
              requestId = event.requestId || requestId;
              runId = event.runId || '';
              setSessions((current) => current.map((session) => session.id === source.id ? { ...session, messages: session.messages.map((message) => message.id === answer.id ? { ...message, requestId: requestId || undefined, runId: runId || undefined } : message) } : session));
              continue;
            }
            if (event.type === 'skills-changed') { setSkills(await api<AgentSkill[]>('skills')); continue; }
            if (event.type === 'error') { streamError = typeof event.error === 'object' ? event.error as AgentErrorInfo : { code: 'MODEL_REQUEST_FAILED', stage: 'model', message: String(event.error || '请求失败'), requestId: requestId || undefined, runId: runId || undefined, retryable: true, suggestion: '检查模型、提供方和网络设置后重试。' }; break; }
            if (event.type === 'execution') {
              appendTimeline(source.id, answer.id, (event.event || event) as AgentExecutionEvent);
            }
            if (event.type === 'tool') {
              const call = event.call as AgentToolCall;
              setSessions((current) => current.map((session) => session.id === source.id ? { ...session, messages: session.messages.map((message) => {
                if (message.id !== answer.id) return message;
                const previous = message.toolCalls?.find((item) => item.id === call.id);
                const merged = { ...previous, ...call, ...(call.input === undefined && previous?.input !== undefined ? { input: previous.input } : {}) } as AgentToolCall;
                return { ...message, toolCalls: [...(message.toolCalls || []).filter((item) => item.id !== call.id), merged] };
              }) } : session));
            }
            if (event.type === 'image' && event.image) {
              setSessions((current) => current.map((session) => session.id === source.id ? { ...session, messages: session.messages.map((message) => message.id === answer.id ? { ...message, attachments: [...(message.attachments || []), event.image] } : message) } : session));
            }
            if (event.type === 'output') {
              setSessions((current) => current.map((session) => session.id === source.id ? { ...session, messages: session.messages.map((message) => message.id === answer.id ? { ...message, outputs: [...(message.outputs || []), event.output], content: event.output.output_type === 'text' ? message.content + event.output.content : message.content } : message) } : session));
            }
            if (event.type === 'text') patchMessage(source.id, answer.id, (value) => value + event.text, true);
            if (event.type === 'done') { done = true; streamDone = true; }
          }
          if (!done && !controller.signal.aborted && !streamError) throw new Error('连接中断，请重新生成');
        } catch (reason) {
          if (!controller.signal.aborted) streamError = (reason as { agentError?: AgentErrorInfo }).agentError || { code: 'MODEL_REQUEST_FAILED', stage: 'model', message: reason instanceof Error ? reason.message : '请求失败', requestId: requestId || undefined, runId: runId || undefined, retryable: true, suggestion: '检查模型、提供方和网络设置后重试。' };
        } finally { finish(streamError); }
      })();
    } catch (reason) {
      if (!controller.signal.aborted) {
        const details = (reason as { agentError?: AgentErrorInfo }).agentError;
        const errorInfo = details || { code: 'MODEL_REQUEST_FAILED', stage: 'model' as const, message: reason instanceof Error ? reason.message : '请求失败', requestId: requestId || undefined, runId: runId || undefined, retryable: true, suggestion: '检查模型、提供方和网络设置后重试。' };
        setSessions((current) => current.map((session) => session.id === source.id ? { ...session, messages: [...history, { ...answer, content: '', streaming: false, requestId: requestId || undefined, runId: runId || undefined, error: errorInfo }] } : session));
        finish(errorInfo);
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
      const imageAttachments = (user.attachments || []).flatMap((attachment) => {
        if (typeof attachment === 'string') return [];
        if (!attachment.type?.startsWith('image/')) return [];
        if (attachment.fileId) return [{ name: attachment.name, type: attachment.type || 'image/png', fileId: attachment.fileId, data: '', size: attachment.size }];
        if (!attachment.url?.startsWith('data:image/')) return [];
        return [{ name: attachment.name, type: attachment.type || 'image/png', data: attachment.url, size: attachment.size }];
      });
      void run({ voiceMode: fishVoice.voice?.enabled, sessionId: session.id, content: user.content, skillIds: [], applicationIds: [...user.content.matchAll(/\]\(app:([^)]*)\)/g)].flatMap((match) => { try { return [decodeURIComponent(match[1])]; } catch { return []; } }), modelId: availableModelId, agentId: session.agentId, reasoningEffort: activeEffort, attachments: imageAttachments }, history).catch((reason) => setError(reason.message));
  };
  const createSkillViaChat = async () => {
    if (running.current) throw new Error('请先停止当前生成');
    if (!availableModelId) throw new Error('请先配置文本模型');
    if (!approvalReady || approvalSaving) throw new Error('审批设置尚未就绪，请稍后再试');
    const session = newSession(agentId || 'default');
    setSessions(current => [session, ...current]);
    setActiveId(session.id);
    setSkillManagerOpen(false); setSettings(false); setGuide(false); setPlazaVisible(false); setProjectsVisible(false); setMediaJobsVisible(false); setOpen(true);
    await run({ sessionId: session.id, agentId: session.agentId, content: createSkillPrompt.trim(), skillIds: ['builtin:skill-creator'], applicationIds: [], modelId: availableModelId, reasoningEffort: activeEffort }, undefined, session);
  };
  const saveSkill = async (skill: AgentSkill) => {
    setSkills(await api<AgentSkill[]>('skills', { skill }));
  };
  const buttonClass = 'darl-button darl-button--outline darl-button-size--default';
  const skillsSettings = <section className="example-skills-settings" aria-labelledby="example-skills-settings-title"><header><div><span className="example-eyebrow">SKILL LIBRARY</span><h2 id="example-skills-settings-title">Skills</h2><p>模型先读取技能目录，按需加载指令和资源。也可以在聊天中 @ 引用指定技能。</p></div><button className={buttonClass} onClick={() => setSkillManagerOpen(true)}><Sparkles size={15} />管理 Skills</button></header><div className="example-skills-settings-summary"><strong>{skills.length} 个 Skill</strong><span>可以在聊天中描述需求创建 Skill，或发送链接让 Agent 下载并安装。</span></div>{skillManagerOpen && <SkillManager open skills={skills} onClose={() => setSkillManagerOpen(false)} onCreateViaChat={createSkillViaChat} createViaChatDisabled={generating || !approvalReady || approvalSaving} onImport={saveSkill} onSave={saveSkill} onDelete={async (id) => { setSkills(await api<AgentSkill[]>(`skills/${encodeURIComponent(id)}`, undefined, 'DELETE')); }} onFavoriteChange={async (id, favorite) => { const skill = skills.find((item) => item.id === id); if (skill) await saveSkill({ ...skill, favorite }); }} />}</section>;
  const showSettings = () => { setSettingsReturn(mediaJobsVisible ? 'media' : 'chat'); setOpen(false); setGuide(false); setPlazaVisible(false); setProjectsVisible(false); setMediaJobsVisible(false); setSettings(true); };
  const leaveSettings = () => {
    setSettings(false);
    if (settingsReturn === 'media') { setMediaJobsVisible(true); setOpen(false); return; }
    setOpen(true);
  };
  const showGuide = () => { setOpen(false); setSettings(false); setGuide(true); };
  const showPlaza = () => { setOpen(false); setGuide(false); setSettings(false); setProjectsVisible(false); setMediaJobsVisible(false); setPlazaVisible(true); };
  const renameSession = (sessionId: string, title: string) => {
    setSessions((current) => current.map((session) => session.id === sessionId ? { ...session, title, updatedAt: new Date().toLocaleString() } : session));
  };
  const deleteSession = (sessionId: string) => {
    if (sessions.length <= 1) {
      const session = newSession();
      setSessions([session]);
      setActiveId(session.id);
      showPlaza();
      return;
    }
    const remaining = sessions.filter((session) => session.id !== sessionId);
    setSessions(remaining);
    if (activeId === sessionId) setActiveId(remaining[0].id);
  };
  const saveDefaultMediaModels = async (selection: DefaultModelSelection) => {
    const saved = await api<DefaultModelDraft>('default-models', { selection });
    setDefaultMediaSelection(saved);
    setDefaultMediaModelsOpen(false);
  };
  const defaultModelSettings = <section className="example-default-models" aria-labelledby="example-default-models-title">
    <header><div><span className="example-eyebrow">DEFAULT MEDIA MODELS</span><h2 id="example-default-models-title">默认模型</h2><p>为网站开发设置默认图片和视频模型，暂不配置文本与音频。</p></div><button className={buttonClass} onClick={() => setDefaultMediaModelsOpen(true)}><Settings2 size={15} />配置默认模型</button></header>
    <div className="example-default-model-grid"><div><span>图片</span><strong>{defaultMediaSelection.image?.modelId || '未设置'} · {defaultMediaSelection.image?.resolution || '—'} · {defaultMediaSelection.image?.aspectRatio || '—'}</strong></div><div><span>视频</span><strong>{defaultMediaSelection.video?.modelId || '未设置'} · {defaultMediaSelection.video?.resolution || '—'} · {defaultMediaSelection.video?.aspectRatio || '—'}</strong></div></div>
  </section>;
  const approvalSettings = <section className="example-default-models" aria-label="审批模式设置"><header><div><span className="example-eyebrow">TOOL APPROVAL</span><h2>审批模式</h2><p>与聊天输入框共用同一设置，保存在本机，主 Agent 与子 Agent 一起生效。</p></div></header><ApprovalModeSelector value={approvalMode} onChange={updateApprovalMode} disabled={approvalSaving || generating} /><p>帮我批准：自动执行工作区文件操作、新增 Skill、简单只读命令及明确标记为非破坏且封闭的 MCP 写操作；付费生成、复杂命令和未知操作仍询问。完全访问：不再逐次确认，包括媒体生成费用与危险操作；命令拥有后端系统用户的权限。</p></section>;
  const agentsSettings = <AgentsSettingsCard agents={agents} onSave={async (agent) => setAgents(await api<AgentConfig[]>('agents', { agent }))} onDelete={async (id) => setAgents(await api<AgentConfig[]>(`agents/${id}`, undefined, 'DELETE'))} />;
  const modelSettings = <div className="example-model-settings">{defaultModelSettings}<DefaultModelSelector models={defaultMediaModels} kinds={['image', 'video']} value={defaultMediaSelection} onChange={setDefaultMediaSelection} open={defaultMediaModelsOpen} onOpenChange={setDefaultMediaModelsOpen} onComplete={saveDefaultMediaModels} /><MediaConcurrencySettings /><ModelManagementCard configuration={modelConfiguration} providers={providers}
    onSave={async (configuration) => setModelConfiguration(await api<ModelConfiguration>('model-config', { configuration }))}
    onProviderSave={async (provider, apiKey) => setProviders(await api<ModelProvider[]>('providers', { provider, apiKey }))}
    onProviderDelete={async (id) => setProviders(await api<ModelProvider[]>(`providers/${id}`, undefined, 'DELETE'))}
    onTestConnection={async (provider) => setProviders(await api<ModelProvider[]>(`providers/${provider.id}/test`, {}))}
  /></div>;

  return <DarlUIProvider theme={{ mode: 'dark', primaryColor: '#8ba4c5' }} className="chat-example">
    <div className={`example-page ${open ? 'with-agent' : ''}`}>
      <header className="example-header"><a href="http://localhost:5188">Darl UI <span>/ Agent Chat</span></a><div><button className={buttonClass} onClick={showPlaza}><Bot size={16} />Agent 广场</button><button className={buttonClass} onClick={() => { setGuide(false); setSettings(false); setPlazaVisible(false); setProjectsVisible(false); setMediaJobsVisible(true); setOpen(false); }}>媒体生成</button><button className={buttonClass} onClick={() => { setGuide(false); setSettings(false); setPlazaVisible(false); setMediaJobsVisible(false); setProjectsVisible(true); setOpen(false); }}><BookOpen size={16} />项目</button><button className={buttonClass} onClick={showGuide}><BookOpen size={16} />开发说明</button><button className={buttonClass} onClick={showSettings}><Settings2 size={16} />设置</button><button className={buttonClass} onClick={() => setOpen((value) => !value)}><MessageSquare size={16} />聊天</button></div></header>
      {(error || fishVoice.error) && <p className="example-error" role="alert">{error || fishVoice.error}</p>}
      {plazaVisible ? <main className="example-settings example-agent-plaza"><AgentPlaza agents={agents} selectedAgentId={agentId} onSelect={(agent) => { const session = newSession(agent.id); setSessions(current => [session, ...current.filter(item => item.agentId || item.messages.length)]); setActiveId(session.id); setPlazaVisible(false); setOpen(true); }} /></main> : mediaJobsVisible ? <MediaGenerationPage onBack={() => setMediaJobsVisible(false)} /> : projectsVisible ? <ProjectsPage onBack={() => setProjectsVisible(false)} /> : guide ? <Guide onBack={() => { setGuide(false); setOpen(true); }} /> : settings ? <main className="example-settings"><button className={buttonClass} onClick={leaveSettings}><ArrowLeft size={15} />{settingsReturn === 'media' ? '返回媒体生成' : '返回聊天'}</button><SettingsPage title="设置" activeSection={settingsSection} onSectionChange={setSettingsSection} sections={[{ id: 'models', label: '模型', icon: <Settings2 /> }, { id: 'voice', label: '语音', icon: <MessageSquare /> }, { id: 'storage', label: '存储', icon: <Database /> }, { id: 'tools', label: 'Tools', icon: <Wrench /> }, { id: 'skills', label: 'Skills', icon: <Sparkles /> }, { id: 'agents', label: 'Agents', icon: <Bot /> }, { id: 'applications', label: '应用 / MCP', icon: <Blocks /> }, { id: 'approvals', label: '审批模式', icon: <Settings2 /> }]}>{settingsSection === 'agents' ? agentsSettings : settingsSection === 'voice' ? <VoiceSettings settings={fishVoice.settings} onSave={fishVoice.save} /> : settingsSection === 'storage' ? <StorageSettings /> : settingsSection === 'skills' ? skillsSettings : settingsSection === 'tools' ? <ToolsSettings /> : settingsSection === 'applications' ? <McpSettings applications={applications} onChanged={() => setApplicationRevision((value) => value + 1)} /> : settingsSection === 'approvals' ? approvalSettings : modelSettings}</SettingsPage></main> : <main className="example-home"><span className="example-eyebrow">AGENT CHAT EXAMPLE</span><h1>让网站助手<br />真正开始工作。</h1><p>使用现有聊天 UI，连接真实模型。对话、历史和 Skills 保存在本机 SQLite。</p><div className="example-actions"><button className="darl-button darl-button--default darl-button-size--default" onClick={() => setOpen(true)}><MessageSquare size={16} />打开助手</button><button className={buttonClass} onClick={showPlaza}><Bot size={16} />Agent 广场</button><button className={buttonClass} onClick={showSettings}><Settings2 size={16} />模型设置</button></div><div className="example-info"><div><span>模型</span><strong>{models.find((model) => model.id === availableModelId)?.name || '尚未配置'}</strong></div><div><span>会话</span><strong>{sessions.length}</strong></div><div><span>Skills</span><strong>{skills.length}</strong></div></div><small>支持文本和图片消息与 MCP 工具调用。用 @ 引用一次即可在本对话持续使用；通过输入框的审批模式控制执行前确认。Skills 按需加载；命令在本机后端执行，文件产物可下载。</small></main>}
    </div>
    <AgentSidebar voice={fishVoice.voice} approvalMode={approvalMode} onApprovalModeChange={updateApprovalMode} approvalModePending={!approvalReady || approvalSaving} open={open} onOpenChange={setOpen} sessions={sessions} activeSessionId={activeId} onSessionChange={setActiveId} onSessionRename={renameSession} onSessionDelete={deleteSession}
      onNewSession={showPlaza}
      onSend={run} onStop={() => running.current?.abort()} isGenerating={generating} onRegenerate={regenerate}
      applications={applications} onToolConfirm={async (id, approved) => { await api(`tool-confirmations/${id}`, { approved }); }}
      agents={agents} selectedAgentId={agentId} models={models} selectedModelId={availableModelId} onSelectedModelIdChange={setModelId} selectedReasoningEffort={activeEffort} onSelectedReasoningEffortChange={setEffort}
      uploadAttachment={async (file) => {
        const body = new FormData();
        body.set('file', file);
        const response = await fetch('/api/files', { method: 'POST', body });
        const saved = await response.json().catch(() => ({})) as { fileId?: string; url?: string; thumbnailUrl?: string; mimeType?: string; error?: string };
        if (!response.ok || !saved.fileId) throw new Error(saved.error || `${file.name} 上传失败`);
        return { name: file.name, type: saved.mimeType || file.type || 'application/octet-stream', size: file.size, fileId: saved.fileId, url: saved.thumbnailUrl || saved.url || `/api/files/${saved.fileId}` };
      }}
      skills={skills} onSkillImport={saveSkill} onSkillCreate={createSkillViaChat}
    />
  </DarlUIProvider>;
}
