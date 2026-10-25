import { useCallback, useEffect, useRef, useState, type SetStateAction } from 'react';
import type { AgentSession } from '@darl/ui';

type Summary = AgentSession & { version: number };
type Saved = { session: AgentSession; version: number };
const pathFor = (id: string) => `/api/sessions/${encodeURIComponent(id)}`;
const serializable = (session: AgentSession): AgentSession => ({ ...session, messagePreview: undefined, messages: session.messages.map(message => ({ ...message,
  attachments: message.attachments?.map(attachment => typeof attachment === 'string' ? attachment : { ...attachment, url: attachment.url?.startsWith('data:') ? undefined : attachment.url }),
  toolCalls: message.toolCalls?.map(({ output: _output, ...call }) => call),
})) });

async function request<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const response = await fetch(path, { method, ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}) });
  const result = await response.json();
  if (!response.ok) throw Object.assign(new Error(typeof result.error === 'string' ? result.error : result.error?.message || '聊天记录请求失败'), { status: response.status });
  return result;
}

export function useChatSessions(create: () => AgentSession, recover: (session: AgentSession) => AgentSession) {
  const [sessions, renderSessions] = useState<AgentSession[]>(() => [create()]);
  const current = useRef(sessions);
  const [activeId, setActiveId] = useState(sessions[0].id);
  const [ready, setReady] = useState(false);
  const readyRef = useRef(false);
  const [loadingIds, setLoadingIds] = useState<Set<string>>(new Set());
  const [loadFailure, setLoadFailure] = useState<{ id?: string; message: string }>();
  const [saveError, setSaveError] = useState('');
  const versions = useRef(new Map<string, number>());
  const loaded = useRef(new Set([sessions[0].id]));
  const pending = useRef(new Map<string, AgentSession>());
  const blocked = useRef(new Set<string>());
  const requests = useRef(new Map<string, Promise<void>>());
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const nextAttempt = useRef(0);
  const mounted = useRef(true);

  const commit = useCallback((next: AgentSession[]) => { current.current = next; renderSessions(next); }, []);
  const setSessions = useCallback((action: SetStateAction<AgentSession[]>) => {
    const previous = current.current;
    const next = typeof action === 'function' ? action(previous) : action;
    for (const session of next) {
      if (session === previous.find(item => item.id === session.id)) continue;
      if (!versions.current.has(session.id)) loaded.current.add(session.id);
      if (loaded.current.has(session.id)) {
        if (session.messages.length) pending.current.set(session.id, session);
        else pending.current.delete(session.id);
      }
    }
    commit(next);
  }, [commit]);

  const enqueue = useCallback(<T,>(work: () => Promise<T>) => {
    const result = queue.current.catch(() => {}).then(work);
    queue.current = result;
    return result;
  }, []);

  const flush = useCallback((sessionId?: string) => enqueue(async () => {
    if (!readyRef.current) throw new Error('聊天目录尚未加载，请稍后重试');
    let failure: unknown;
    for (const [id, session] of pending.current) {
      if (sessionId && sessionId !== id) continue;
      if (blocked.current.has(id)) { failure = new Error('对话在其他页面已更新，当前修改尚未保存'); continue; }
      try {
        const saved = await request<{ version: number }>(pathFor(id), 'PUT', { session: serializable(session), version: versions.current.get(id) || 0 });
        versions.current.set(id, saved.version);
        if (pending.current.get(id) === session) pending.current.delete(id);
      } catch (error) {
        if ((error as { status?: number }).status === 409) blocked.current.add(id);
        nextAttempt.current = Date.now() + 3000;
        if (mounted.current) setSaveError(`聊天记录尚未保存：${error instanceof Error ? error.message : '网络异常'}`);
        failure = error;
      }
    }
    if (failure) throw failure;
    if (mounted.current && !pending.current.size) setSaveError('');
  }), [enqueue]);

  const loadCatalog = useCallback(async () => {
    try {
      const catalog = await request<Summary[]>('/api/sessions');
      if (!mounted.current) return;
      catalog.forEach(session => versions.current.set(session.id, session.version));
      const existing = current.current;
      commit([...existing, ...catalog.filter(session => !existing.some(item => item.id === session.id))]);
      readyRef.current = true;
      setReady(true); setLoadFailure(undefined);
    } catch (error) { if (mounted.current) setLoadFailure({ message: `聊天目录加载失败：${error instanceof Error ? error.message : '网络异常'}` }); }
  }, [commit]);

  useEffect(() => {
    mounted.current = true;
    void loadCatalog();
    // Throttle rather than debounce: a continuously streaming answer is saved periodically.
    const timer = window.setInterval(() => {
      if (readyRef.current && [...pending.current.keys()].some(id => !blocked.current.has(id)) && Date.now() >= nextAttempt.current) void flush().catch(() => {});
    }, 1000);
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (!pending.current.size) return;
      event.preventDefault();
      event.returnValue = '';
    };
    const onHide = () => { if (document.visibilityState === 'hidden' && pending.current.size) void flush().catch(() => {}); };
    window.addEventListener('beforeunload', beforeUnload);
    document.addEventListener('visibilitychange', onHide);
    return () => { mounted.current = false; window.clearInterval(timer); window.removeEventListener('beforeunload', beforeUnload); document.removeEventListener('visibilitychange', onHide); };
  }, [flush, loadCatalog]);

  const loadSession = useCallback((id: string): Promise<void> => {
    if (loaded.current.has(id)) return Promise.resolve();
    const existing = requests.current.get(id);
    if (existing) return existing;
    setLoadFailure(undefined); setLoadingIds(ids => new Set(ids).add(id));
    const task = request<Saved>(pathFor(id)).then(saved => {
      if (!mounted.current || !current.current.some(session => session.id === id)) return;
      versions.current.set(id, saved.version);
      loaded.current.add(id);
      commit(current.current.map(session => session.id === id ? recover(saved.session) : session));
    }).catch(error => { if (mounted.current) setLoadFailure({ id, message: `对话加载失败：${error instanceof Error ? error.message : '网络异常'}` }); })
      .finally(() => { requests.current.delete(id); if (mounted.current) setLoadingIds(ids => { const next = new Set(ids); next.delete(id); return next; }); });
    requests.current.set(id, task);
    return task;
  }, [commit, recover]);

  const selectSession = (id: string) => { setActiveId(id); void loadSession(id); };
  const renameSession = async (id: string, title: string) => {
    await requests.current.get(id);
    if (loaded.current.has(id)) {
      setSessions(items => items.map(session => session.id === id ? { ...session, title, updatedAt: new Date().toLocaleString() } : session));
      await flush(id);
    } else await enqueue(async () => {
      const saved = await request<{ version: number }>(pathFor(id), 'PATCH', { title, version: versions.current.get(id) });
      versions.current.set(id, saved.version);
      commit(current.current.map(session => session.id === id ? { ...session, title } : session));
    });
  };
  const removeSession = (id: string) => enqueue(async () => {
    const version = versions.current.get(id);
    if (version) await request(pathFor(id), 'DELETE', { version });
    pending.current.delete(id); loaded.current.delete(id); versions.current.delete(id); blocked.current.delete(id);
    const remaining = current.current.filter(session => session.id !== id);
    // Deleting a conversation must not implicitly load another history entry.
    if (id === activeId) {
      const fresh = create();
      loaded.current.add(fresh.id);
      commit([fresh, ...remaining]); setActiveId(fresh.id);
    } else commit(remaining);
  });

  return { sessions, setSessions, activeId, setActiveId, selectSession, renameSession, removeSession, flush,
    ready, loading: loadingIds.has(activeId), activeLoaded: loaded.current.has(activeId), loadError: loadFailure && (!loadFailure.id || loadFailure.id === activeId) ? loadFailure.message : '', saveError,
    retryLoad: () => ready ? loadSession(activeId) : loadCatalog(), retrySave: () => { void flush().catch(() => {}); } };
}
