import type { AgentContextPolicy } from '../../../src/index';
import type { ChatMessage } from './models';
import type { StructuredAgentResult } from './context';
import { compactContextMessages } from './context';
import type { LocalStorage, SubAgentThreadKey } from './storage';

/** In-process FIFO lock. A cancelled waiter cannot bypass an active run. */
export class SubAgentThreadLocks {
  private readonly tails = new Map<string, Promise<void>>();

  async run<T>(key: string, signal: AbortSignal, operation: () => Promise<T>): Promise<T> {
    const previous = this.tails.get(key) ?? Promise.resolve();
    let release!: () => void;
    const occupied = new Promise<void>((resolve) => { release = resolve; });
    const tail = previous.then(() => occupied);
    this.tails.set(key, tail);
    void tail.then(() => { if (this.tails.get(key) === tail) this.tails.delete(key); });

    try {
      await new Promise<void>((resolve, reject) => {
        if (signal.aborted) { reject(signal.reason ?? new Error('子 Agent 任务已取消')); return; }
        const onAbort = () => { cleanup(); reject(signal.reason ?? new Error('子 Agent 任务已取消')); };
        const onReady = () => { cleanup(); resolve(); };
        const cleanup = () => signal.removeEventListener('abort', onAbort);
        signal.addEventListener('abort', onAbort, { once: true });
        void previous.then(onReady, (error: unknown) => { cleanup(); reject(error); });
      });
      signal.throwIfAborted();
      return await operation();
    } finally {
      release();
    }
  }
}

/**
 * Restore only this child thread's own history, never the root Agent's complete chat.
 * Resolve the child model, instructions and MCP permissions from current config on every call.
 * Persist tasks and final responses, not hidden reasoning or raw MCP results.
 */
export async function continueSubAgentConversation(
  storage: LocalStorage,
  locks: SubAgentThreadLocks,
  key: SubAgentThreadKey,
  task: string,
  policy: AgentContextPolicy,
  contextChars: number,
  signal: AbortSignal,
  execute: (messages: ChatMessage[]) => Promise<StructuredAgentResult>,
): Promise<{ threadId: string; result: StructuredAgentResult }> {
  const lockKey = JSON.stringify([key.scope, key.rootSessionId, key.parentAgentId, key.childAgentId]);
  return locks.run(lockKey, signal, async () => {
    const previous = storage.getSubAgentThread(key);
    // Leave headroom for system instructions, tool schemas and source boundary markers.
    const budget = Math.max(4_000, Math.floor(contextChars * 0.85));
    const messages = compactContextMessages(
      [...(previous?.messages ?? []), { role: 'user', content: task }],
      policy,
      budget,
    );
    signal.throwIfAborted();
    const result = await execute(messages);
    signal.throwIfAborted();
    if (!result.result.trim()) throw new Error('子 Agent 没有返回可保存的结果');
    const completed = compactContextMessages(
      [...messages, { role: 'assistant', content: result.result }],
      policy,
      budget,
    );
    const saved = storage.saveSubAgentThread(key, completed, previous?.version ?? 0);
    return { threadId: saved.id, result };
  });
}
