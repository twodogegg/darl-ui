/** One request at a time; hidden pages pause and aborted requests do not update the UI. */
export function startPolling(task: (signal: AbortSignal) => Promise<unknown>, interval: number, onError: (reason: Error) => void) {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let controller: AbortController | undefined;
  const tick = async () => {
    if (stopped || document.hidden || controller) return;
    const current = controller = new AbortController();
    try { await task(current.signal); }
    catch (error) { if (!current.signal.aborted) onError(error instanceof Error ? error : new Error(String(error))); }
    finally {
      controller = undefined;
      if (!stopped && !document.hidden) timer = setTimeout(tick, interval);
    }
  };
  const visibility = () => {
    clearTimeout(timer);
    if (document.hidden) controller?.abort();
    else void tick();
  };
  document.addEventListener('visibilitychange', visibility);
  void tick();
  return () => { stopped = true; clearTimeout(timer); controller?.abort(); document.removeEventListener('visibilitychange', visibility); };
}
