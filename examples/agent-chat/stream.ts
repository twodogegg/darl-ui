/** Handles UTF-8 characters and event boundaries split across network chunks. */
export async function* lines(body: ReadableStream<Uint8Array>) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let pending = '';
  try {
    while (true) {
      const { value, done } = await reader.read();
      pending += decoder.decode(value, { stream: !done });
      if (pending.length > 2_000_000) throw new Error('响应数据过大');
      let end: number;
      while ((end = pending.indexOf('\n')) !== -1) {
        yield pending.slice(0, end).replace(/\r$/, '');
        pending = pending.slice(end + 1);
      }
      if (done) break;
    }
    if (pending) yield pending.replace(/\r$/, '');
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
