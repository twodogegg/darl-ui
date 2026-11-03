import { useEffect, useRef, useState } from 'react';
import { MessageSquare } from 'lucide-react';
import { AgentSidebar, defaultReasoningEffort, type AgentApplication, type AgentApprovalMode, type AgentModel, type AgentSendRequest, type AgentSession, type AgentSkill, type AgentToolCall } from '@darl/ui';
import { lines } from '../stream';
import { useChatSessions } from './use-chat-sessions';

const newSession = (): AgentSession => ({ id: crypto.randomUUID(), title: '新对话', messages: [] });
const recover = (session: AgentSession): AgentSession => ({ ...session, messages: session.messages.map(message => ({ ...message, streaming: false, toolCalls: message.toolCalls?.map(call => ['pending', 'running', 'retrying', 'confirmation'].includes(call.status) ? { ...call, status: 'cancelled' } : call) })) });
async function api<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(`/api/${path}`, body === undefined ? undefined : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const value = await response.json();
  if (!response.ok) throw new Error(typeof value.error === 'string' ? value.error : value.error?.message || '请求失败');
  return value;
}

export function ChatAssistant({ models, skills, applications, onSkillImport, onSkillsChanged }: { models: AgentModel[]; skills: AgentSkill[]; applications: AgentApplication[]; onSkillImport: (skill: AgentSkill) => Promise<void>; onSkillsChanged: () => void }) {
  const { sessions, setSessions, activeId, setActiveId, selectSession, renameSession, removeSession, flush, ready, activeLoaded, loadError, saveError, retryLoad, retrySave } = useChatSessions(newSession, recover);
  const [open, setOpen] = useState(false);
  const [modelId, setModelId] = useState('');
  const [effort, setEffort] = useState<string>();
  const [approval, setApproval] = useState<AgentApprovalMode>('auto');
  const [approvalReady, setApprovalReady] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState('');
  const running = useRef<AbortController | null>(null);
  const model = models.find(item => item.id === modelId) || models[0];
  useEffect(() => { api<{ mode: AgentApprovalMode }>('approval-settings').then(value => { setApproval(value.mode); setApprovalReady(true); }).catch(reason => setError(reason.message)); }, []);
  useEffect(() => () => running.current?.abort(), []);
  const run = async (request: AgentSendRequest, previous?: AgentSession['messages']) => {
    if (running.current || !ready || !activeLoaded) throw new Error('请等待当前请求或会话加载完成');
    const selected = models.find(item => item.id === request.modelId) || model;
    if (!selected?.providerId) throw new Error('请先配置并启用文本模型');
    const session = sessions.find(item => item.id === request.sessionId);
    if (!session) throw new Error('会话不存在');
    const user = { id: crypto.randomUUID(), role: 'user' as const, content: request.content, attachments: request.uploadedAttachments, modelSkillIds: request.skillIds }; 
    const history = previous || [...session.messages, user];
    const answer = { id: crypto.randomUUID(), role: 'assistant' as const, content: '', streaming: true };
    const controller = new AbortController(); running.current = controller; setGenerating(true); setError('');
    const update = (fn: (message: AgentSession['messages'][number]) => AgentSession['messages'][number]) => setSessions(current => current.map(item => item.id !== session.id ? item : { ...item, messages: item.messages.map(message => message.id === answer.id ? fn(message) : message) }));
    setSessions(current => current.map(item => item.id !== session.id ? item : { ...item, title: history.find(message => message.role === 'user')?.content.slice(0, 32) || '新对话', messages: [...history, answer] }));
    try {
      await flush(session.id);
      const params = new URLSearchParams(location.search);
      const response = await fetch('/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: controller.signal, body: JSON.stringify({ sessionId: session.id, providerId: selected.providerId, modelId: decodeURIComponent(selected.id.slice(selected.id.indexOf('/') + 1)), effort: request.reasoningEffort, approvalMode: approval, skillIds: [...new Set([...request.skillIds, ...history.flatMap(message => (message.modelSkillIds || []).filter(id => skills.some(skill => skill.id === id)))])], applicationIds: request.applicationIds, messages: history.map(({ role, content, attachments }) => { const files = (attachments || []).filter((item): item is Exclude<typeof item, string> => typeof item !== 'string' && Boolean(item.fileId)); const images = files.filter(item => item.type?.startsWith('image/')).map(item => ({ type: 'image', name: item.name, mimeType: item.type, fileId: item.fileId })); const text = [content, files.length ? `<USER_FILES untrusted="true">${JSON.stringify(files.map(({ fileId, name, type }) => ({ fileId, name, mimeType: type })))}</USER_FILES>` : ''].filter(Boolean).join('\n\n'); return { role, content: images.length ? [{ type: 'text', text }, ...images] : text }; }), websiteContext: { page: location.pathname, projectId: params.get('projectId'), episodeId: params.get('episodeId') } }) });
      if (!response.ok) { const result = await response.json(); throw new Error(typeof result.error === 'string' ? result.error : result.error?.message || '请求失败'); }
      if (!response.body) throw new Error('模型响应为空');
      let done = false;
      for await (const line of lines(response.body)) {
        if (!line) continue;
        const event = JSON.parse(line);
        if (event.type === 'text') update(message => ({ ...message, content: message.content + event.text }));
        if (event.type === 'tool') update(message => ({ ...message, toolCalls: [...(message.toolCalls || []).filter(call => call.id !== event.call.id), event.call as AgentToolCall] }));
        if (event.type === 'studio-changed') window.dispatchEvent(new Event('studio-changed'));
        if (event.type === 'skills-changed') onSkillsChanged();
        if (event.type === 'error') throw new Error(typeof event.error === 'string' ? event.error : event.error?.message || '模型请求失败');
        if (event.type === 'done') done = true;
      }
      if (!done && !controller.signal.aborted) throw new Error('连接中断，请重新生成');
      update(message => ({ ...message, streaming: false }));
    } catch (reason) {
      const message = controller.signal.aborted ? '生成已停止' : reason instanceof Error ? reason.message : '请求失败';
      update(current => ({ ...current, streaming: false, error: { code: controller.signal.aborted ? 'REQUEST_CANCELLED' : 'MODEL_REQUEST_FAILED', stage: controller.signal.aborted ? 'cancellation' : 'model', message, retryable: !controller.signal.aborted, suggestion: '检查模型和服务设置后重试。' } }));
    } finally { running.current = null; setGenerating(false); void flush(session.id).catch(() => {}); }
  };
  return <>
    <button className="example-chat-launcher" type="button" onClick={() => setOpen(true)} aria-label="打开 Agent 助手"><MessageSquare size={20} /> <span>Agent 助手</span></button>
    {error && <p className="example-chat-error" role="alert">{error}</p>}
    {loadError && <button type="button" className="example-chat-error" onClick={retryLoad}>{loadError}，点击重试</button>}
    {saveError && <button type="button" className="example-chat-error" onClick={retrySave}>{saveError}，点击重试</button>}
    <AgentSidebar open={open} onOpenChange={setOpen} sessions={sessions} activeSessionId={activeId} hideEmptySessions onSessionChange={selectSession} onSessionRename={renameSession} onSessionDelete={removeSession} onNewSession={() => { const next = newSession(); setSessions(current => [next, ...current]); setActiveId(next.id); }} models={models} selectedModelId={model?.id} onSelectedModelIdChange={setModelId} selectedReasoningEffort={effort || (model ? defaultReasoningEffort(model) : undefined)} onSelectedReasoningEffortChange={setEffort} skills={skills} onSkillImport={onSkillImport} applications={applications} uploadAttachment={async file => { const form = new FormData(); form.append('file', file); const response = await fetch('/api/files', { method: 'POST', body: form }); const value = await response.json(); if (!response.ok) throw new Error(value.error || '上传失败'); return { name: file.name, type: value.mimeType, size: value.size, fileId: value.fileId, url: value.url }; }} approvalMode={approval} approvalModePending={!approvalReady} onApprovalModeChange={async mode => { setApprovalReady(false); try { setApproval((await api<{ mode: AgentApprovalMode }>('approval-settings', { mode })).mode); } finally { setApprovalReady(true); } }} isGenerating={generating} onStop={() => running.current?.abort()} onSend={run} onRegenerate={id => { const session = sessions.find(item => item.id === activeId); const index = session?.messages.findIndex(item => item.id === id) ?? -1; if (!session || index < 1) return; const history = session.messages.slice(0, index); const last = history.at(-1); if (last?.role === 'user') void run({ sessionId: session.id, content: last.content, applicationIds: [], skillIds: [], modelId: model?.id, reasoningEffort: effort }, history); }} onToolConfirm={async (id, approved) => { await api(`tool-confirmations/${encodeURIComponent(id)}`, { approved }); }} />
  </>;
}
