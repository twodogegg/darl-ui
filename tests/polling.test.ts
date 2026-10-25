import { afterEach, expect, it, vi } from 'vitest';
import { startPolling } from '../examples/agent-chat/client/polling';

afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });
it('waits for completion before scheduling another request and aborts on disposal', async () => {
  vi.useFakeTimers();
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
  let finish!: () => void;
  const task = vi.fn((_signal: AbortSignal) => new Promise<void>(resolve => { finish = resolve; }));
  const stop = startPolling(task, 3000, () => {});
  await vi.advanceTimersByTimeAsync(15000);
  expect(task).toHaveBeenCalledTimes(1);
  finish();
  await vi.advanceTimersByTimeAsync(3000);
  expect(task).toHaveBeenCalledTimes(2);
  stop();
  expect(task.mock.calls[1][0]?.aborted).toBe(true);
  finish();
  await vi.advanceTimersByTimeAsync(15000);
  expect(task).toHaveBeenCalledTimes(2);
});
it('pauses when hidden and refreshes when the page becomes visible', async () => {
  vi.useFakeTimers();
  const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
  const task = vi.fn(async (_signal: AbortSignal) => {});
  const stop = startPolling(task, 2500, () => {});
  await vi.advanceTimersByTimeAsync(10000);
  expect(task).not.toHaveBeenCalled();
  hidden.mockReturnValue(false); document.dispatchEvent(new Event('visibilitychange'));
  await vi.advanceTimersByTimeAsync(0);
  expect(task).toHaveBeenCalledTimes(1);
  hidden.mockReturnValue(true); document.dispatchEvent(new Event('visibilitychange'));
  await vi.advanceTimersByTimeAsync(10000);
  expect(task).toHaveBeenCalledTimes(1);
  stop();
});
