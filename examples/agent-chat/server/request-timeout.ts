/** Bound inactivity, rather than total task duration. Confirmation waits do not consume it. */
export class RequestTimeout {
  private controller = new AbortController();
  private timer?: ReturnType<typeof setTimeout>;
  private paused = 0;
  private disposed = false;
  readonly signal = this.controller.signal;

  constructor(private milliseconds = 180_000) { this.touch(); }

  touch = () => {
    clearTimeout(this.timer);
    if (this.disposed || this.paused || this.signal.aborted) return;
    this.timer = setTimeout(() => this.controller.abort(new DOMException('长时间未收到模型或工具进展，请求已超时。已保存内容和工作区文件保留，可继续对话。', 'TimeoutError')), this.milliseconds);
    this.timer.unref();
  };

  pause() {
    this.paused++;
    clearTimeout(this.timer);
    let resumed = false;
    return () => {
      if (resumed) return;
      resumed = true;
      this.paused--;
      this.touch();
    };
  }

  dispose() { this.disposed = true; clearTimeout(this.timer); }
}
