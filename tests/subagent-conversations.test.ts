// @vitest-environment node
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { LocalStorage, type SubAgentThreadKey } from '../examples/agent-chat/server/storage';
import { SubAgentThreadLocks, continueSubAgentConversation } from '../examples/agent-chat/server/subagent-conversations';
import { DEFAULT_CONTEXT_POLICY, structuredAgentResult } from '../examples/agent-chat/server/context';
import type { ChatMessage } from '../examples/agent-chat/server/models';

const key: SubAgentThreadKey = { scope: 'local', rootSessionId: 'chat-1', parentAgentId: 'director', childAgentId: 'writer' };
const signal = () => new AbortController().signal;
const run = (
  store: LocalStorage, locks: SubAgentThreadLocks, thread: SubAgentThreadKey, task: string,
  execute: (messages: ChatMessage[]) => Promise<ReturnType<typeof structuredAgentResult>>,
  abortSignal = signal(), budget = 50_000,
) => continueSubAgentConversation(store, locks, thread, task, DEFAULT_CONTEXT_POLICY, budget, abortSignal, execute);

describe('Sub Agent persistent conversations', () => {
  it('continues the same child conversation after reopening SQLite', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'darl-subagent-'));
    try {
      const store = new LocalStorage(directory);
      const locks = new SubAgentThreadLocks();
      const first = await run(store, locks, key, '写前三场戏', async (messages) => {
        expect(messages).toEqual([{ role: 'user', content: '写前三场戏' }]);
        return structuredAgentResult('第一至三场');
      });
      const reopened = new LocalStorage(directory);
      const second = await run(reopened, new SubAgentThreadLocks(), key, '继续第四场', async (messages) => {
        expect(messages).toEqual([
          { role: 'user', content: '写前三场戏' },
          { role: 'assistant', content: '第一至三场' },
          { role: 'user', content: '继续第四场' },
        ]);
        return structuredAgentResult('第四场');
      });
      expect(second.threadId).toBe(first.threadId);
      expect(reopened.getSubAgentThread(key)?.version).toBe(2);
      expect(reopened.getSubAgentThread(key)?.messages.at(-1)).toEqual({ role: 'assistant', content: '第四场' });
    } finally { await rm(directory, { recursive: true, force: true }); }
  });

  it('separates child, parent, root session and scope', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'darl-subagent-isolation-'));
    try {
      const store = new LocalStorage(directory);
      const locks = new SubAgentThreadLocks();
      const distinct = [
        key,
        { ...key, childAgentId: 'artist' },
        { ...key, parentAgentId: 'producer' },
        { ...key, rootSessionId: 'chat-2' },
        { ...key, scope: 'other-user' },
      ];
      const threads = await Promise.all(distinct.map((item, index) =>
        run(store, locks, item, '任务' + index, async () => structuredAgentResult('回答' + index))));
      expect(new Set(threads.map((thread) => thread.threadId)).size).toBe(distinct.length);
      for (let index = 0; index < distinct.length; index += 1) {
        expect(store.getSubAgentThread(distinct[index])?.messages).toEqual([
          { role: 'user', content: '任务' + index },
          { role: 'assistant', content: '回答' + index },
        ]);
      }
    } finally { await rm(directory, { recursive: true, force: true }); }
  });

  it('does not persist errors, cancellations or empty answers', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'darl-subagent-failure-'));
    try {
      const store = new LocalStorage(directory);
      const locks = new SubAgentThreadLocks();
      await run(store, locks, key, '成功', async () => structuredAgentResult('已完成'));
      await expect(run(store, locks, key, '失败', async () => { throw new Error('模型失败'); })).rejects.toThrow('模型失败');
      await expect(run(store, locks, key, '空文本', async () => structuredAgentResult(''))).rejects.toThrow('没有返回');
      const controller = new AbortController();
      await expect(run(store, locks, key, '取消', async () => {
        controller.abort(new Error('用户取消'));
        return structuredAgentResult('不应写入');
      }, controller.signal)).rejects.toThrow('用户取消');
      expect(store.getSubAgentThread(key)?.version).toBe(1);
      expect(store.getSubAgentThread(key)?.messages).toHaveLength(2);
    } finally { await rm(directory, { recursive: true, force: true }); }
  });

  it('serializes simultaneous delegates without losing their history', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'darl-subagent-race-'));
    try {
      const store = new LocalStorage(directory);
      const locks = new SubAgentThreadLocks();
      let allowFirst!: () => void;
      let firstStarted!: () => void;
      const started = new Promise<void>((resolve) => { firstStarted = resolve; });
      const blocked = new Promise<void>((resolve) => { allowFirst = resolve; });
      const first = run(store, locks, key, '第一个任务', async () => {
        firstStarted();
        await blocked;
        return structuredAgentResult('第一个回答');
      });
      await started;
      let seen: ChatMessage[] = [];
      const second = run(store, locks, key, '第二个任务', async (messages) => {
        seen = messages;
        return structuredAgentResult('第二个回答');
      });
      allowFirst();
      await Promise.all([first, second]);
      expect(seen).toEqual([
        { role: 'user', content: '第一个任务' },
        { role: 'assistant', content: '第一个回答' },
        { role: 'user', content: '第二个任务' },
      ]);
      expect(store.getSubAgentThread(key)?.version).toBe(2);
    } finally { await rm(directory, { recursive: true, force: true }); }
  });

  it('never lets an aborted waiting delegate bypass the active lock', async () => {
    const locks = new SubAgentThreadLocks();
    const controller = new AbortController();
    let finishFirst!: () => void;
    let firstStarted!: () => void;
    const started = new Promise<void>((resolve) => { firstStarted = resolve; });
    const active = locks.run('same', signal(), async () => {
      firstStarted();
      await new Promise<void>((resolve) => { finishFirst = resolve; });
      return 'done';
    });
    await started;
    const pending = locks.run('same', controller.signal, async () => 'should not run');
    controller.abort(new Error('cancelled'));
    await expect(pending).rejects.toThrow('cancelled');
    let thirdEntered = false;
    const third = locks.run('same', signal(), async () => { thirdEntered = true; });
    await Promise.resolve();
    expect(thirdEntered).toBe(false);
    finishFirst();
    await Promise.all([active, third]);
    expect(thirdEntered).toBe(true);
  });

  it('rejects stale SQLite writes and compacts long child-only history', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'darl-subagent-version-'));
    try {
      const a = new LocalStorage(directory);
      const b = new LocalStorage(directory);
      a.saveSubAgentThread(key, [{ role: 'user', content: 'first' }], 0);
      const stale = b.getSubAgentThread(key)!;
      a.saveSubAgentThread(key, [{ role: 'user', content: 'second' }], 1);
      expect(() => b.saveSubAgentThread(key, stale.messages, stale.version)).toThrow('已被其他请求更新');
      const history = Array.from({ length: 30 }, (_, index) => ({
        role: (index % 2 ? 'assistant' : 'user') as 'assistant' | 'user',
        content: ('旧内容' + index).repeat(2_000),
      }));
      a.saveSubAgentThread(key, history, a.getSubAgentThread(key)!.version);
      await run(a, new SubAgentThreadLocks(), key, '新的任务', async (messages) => {
        expect(messages.at(-1)).toEqual({ role: 'user', content: '新的任务' });
        expect(messages.some((message) => typeof message.content === 'string' && message.content.includes('历史上下文摘要'))).toBe(true);
        return structuredAgentResult('新的回答');
      }, signal(), 20_000);
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
});
