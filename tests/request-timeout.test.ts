// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RequestTimeout } from '../examples/agent-chat/server/request-timeout';
import { ToolConfirmations } from '../examples/agent-chat/server/mcp';

afterEach(() => vi.useRealTimers());

describe('request inactivity timeout', () => {
  it('allows progress beyond three minutes and stops a stalled request', () => {
    vi.useFakeTimers();
    const timeout = new RequestTimeout();
    for (let step = 0; step < 5; step++) { vi.advanceTimersByTime(120_000); timeout.touch(); }
    expect(timeout.signal.aborted).toBe(false);
    vi.advanceTimersByTime(180_000);
    expect(timeout.signal.reason.name).toBe('TimeoutError');
    timeout.dispose();
  });

  it('keeps confirmations alive and resumes the inactivity limit after approval', async () => {
    vi.useFakeTimers();
    const timeout = new RequestTimeout();
    const confirmations = new ToolConfirmations();
    const resume = timeout.pause();
    const decision = confirmations.wait('approval', timeout.signal).finally(resume);
    vi.advanceTimersByTime(600_000);
    timeout.touch();
    expect(timeout.signal.aborted).toBe(false);
    confirmations.decide('approval', true);
    expect(await decision).toBe(true);
    vi.advanceTimersByTime(179_999);
    expect(timeout.signal.aborted).toBe(false);
    vi.advanceTimersByTime(1);
    expect(timeout.signal.aborted).toBe(true);
    timeout.dispose();
  });

  it('still cancels while awaiting confirmation and releases its timer on cleanup', async () => {
    vi.useFakeTimers();
    const timeout = new RequestTimeout();
    const user = new AbortController();
    const resume = timeout.pause();
    const confirmations = new ToolConfirmations();
    const decision = confirmations.wait('approval', AbortSignal.any([user.signal, timeout.signal])).finally(resume);
    user.abort();
    await expect(decision).rejects.toThrow('工具调用已停止');
    expect(() => confirmations.decide('approval', true)).toThrow('已过期');
    timeout.dispose();
    timeout.touch();
    vi.advanceTimersByTime(600_000);
    expect(timeout.signal.aborted).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('waits for all concurrent confirmations and ignores duplicate resume calls', () => {
    vi.useFakeTimers();
    const timeout = new RequestTimeout();
    const first = timeout.pause(), second = timeout.pause();
    first(); first();
    vi.advanceTimersByTime(600_000);
    expect(timeout.signal.aborted).toBe(false);
    second();
    vi.advanceTimersByTime(180_000);
    expect(timeout.signal.aborted).toBe(true);
    timeout.dispose();
  });
});
