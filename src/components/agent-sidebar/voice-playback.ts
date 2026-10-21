import type { AgentOutput, AgentVoice } from './types';

/** Presentation-only transcript. Original speech retains Fish's control cues. */
export function speechTranscript(outputs: AgentOutput[] | undefined): string {
  return (outputs || []).filter((output) => output.output_type === 'speech').map((output) => output.content.replace(/\[[^\]\r\n]+\]/g, '').replace(/[ \t]+/g, ' ').trim()).filter(Boolean).join('\n');
}

/** A second safety boundary: never send code blocks or link addresses to TTS. */
export function spokenText(text: string) {
  return text.replace(/```[\s\S]*?(?:```|$)|~~~[\s\S]*?(?:~~~|$)/g, '')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/https?:\/\/\S+/g, '')
    .split('\n').filter((line) => !/^\s*\|/.test(line)).join('\n')
    .replace(/`[^`]*`/g, '').replace(/^[#>*\s-]+/gm, '').replace(/\*\*/g, '').trim();
}

export type SpeechState = { id: string; state: 'buffering' | 'playing' | 'idle' | 'error'; error?: string };

/** Plays PCM as it arrives. Only the initial 500 ms is buffered, not the full file. */
export class StreamingSpeechPlayer {
  private context?: AudioContext;
  private sample?: HTMLAudioElement;
  private controller?: AbortController;
  private sources = new Set<AudioBufferSourceNode>();
  private queue: Array<{ text: string; voiceId: string; id: string }> = [];
  private nextTime = 0;
  private draining = false;
  private activeId = '';

  constructor(private readonly synthesize: AgentVoice['synthesize'], private readonly notify: (state: SpeechState) => void) {}

  async prepare() {
    if (!this.context || this.context.state === 'closed') this.context = new AudioContext();
    await this.context.resume();
    if (this.context.state !== 'running') throw new Error('浏览器阻止了播放，请点击语音消息重试');
  }

  stop() {
    if (this.sample) {
      const audio = this.sample;
      this.sample = undefined;
      audio.onplaying = audio.onwaiting = audio.onended = audio.onerror = null;
      audio.pause(); audio.removeAttribute('src'); audio.load();
    }
    this.controller?.abort();
    this.controller = undefined;
    this.queue = [];
    this.draining = false;
    for (const source of this.sources) { source.onended = null; source.stop(); source.disconnect(); }
    this.sources.clear();
    this.nextTime = 0;
    this.notify({ id: this.activeId, state: 'idle' });
  }

  dispose() { this.stop(); void this.context?.close(); }

  playSample(url: string, id: string) {
    this.stop();
    this.activeId = id;
    const audio = new Audio();
    this.sample = audio;
    audio.preload = 'none';
    const fail = () => {
      if (this.sample !== audio) return;
      this.stop();
      this.notify({ id, state: 'error', error: '试听音频加载失败，请重试' });
    };
    audio.onplaying = () => { if (this.sample === audio) this.notify({ id, state: 'playing' }); };
    audio.onwaiting = () => { if (this.sample === audio) this.notify({ id, state: 'buffering' }); };
    audio.onended = () => { if (this.sample === audio) this.stop(); };
    audio.onerror = fail;
    audio.src = url;
    this.notify({ id, state: 'buffering' });
    void audio.play().catch(fail);
  }

  enqueue(text: string, voiceId: string, id: string) {
    const clean = spokenText(text);
    if (!clean) return;
    if (this.sample) this.stop();
    this.queue.push({ text: clean, voiceId, id });
    if (!this.draining) {
      const controller = this.controller ?? new AbortController();
      this.controller = controller;
      void this.drain(controller);
    }
  }

  private async drain(controller: AbortController) {
    this.draining = true;
    const signal = controller.signal;
    try {
      while (this.queue.length) {
        signal.throwIfAborted();
        const item = this.queue.shift()!;
        this.activeId = item.id;
        this.notify({ id: item.id, state: 'buffering' });
        await this.prepare();
        signal.throwIfAborted();
        const audio = await this.synthesize(item.text, item.voiceId, signal);
        signal.throwIfAborted();
        if (!Number.isInteger(audio.sampleRate) || audio.sampleRate < 8000 || audio.sampleRate > 48000) throw new Error('音频采样率无效');
        const reader = audio.body.getReader();
        let leftover: number | undefined;
        let buffered: Float32Array[] = [];
        let sampleCount = 0;
        let received = 0;
        let started = false;
        const schedule = () => {
          const context = this.context!;
          for (const samples of buffered) {
            const buffer = context.createBuffer(1, samples.length, audio.sampleRate);
            buffer.getChannelData(0).set(samples);
            const source = context.createBufferSource();
            source.buffer = buffer;
            source.connect(context.destination);
            this.sources.add(source);
            source.onended = () => {
              source.disconnect(); this.sources.delete(source);
              if (!this.sources.size && !this.draining && !this.queue.length && !signal.aborted) this.notify({ id: item.id, state: 'idle' });
            };
            this.nextTime = Math.max(context.currentTime + 0.02, this.nextTime);
            source.start(this.nextTime);
            this.nextTime += buffer.duration;
          }
          buffered = []; sampleCount = 0; started = true;
          this.notify({ id: item.id, state: 'playing' });
        };
        const cancelReader = () => { void reader.cancel().catch(() => {}); };
        signal.addEventListener('abort', cancelReader, { once: true });
        try {
          while (true) {
            const { value, done } = await reader.read();
            signal.throwIfAborted();
            if (done) break;
            received += value.byteLength;
            if (received > 25 * 1024 * 1024) throw new Error('音频流超过大小限制');
            let bytes = value;
            if (leftover !== undefined) { bytes = new Uint8Array(value.length + 1); bytes[0] = leftover; bytes.set(value, 1); }
            leftover = bytes.length % 2 ? bytes.at(-1) : undefined;
            const samples = new Float32Array(Math.floor(bytes.length / 2));
            const view = new DataView(bytes.buffer, bytes.byteOffset, samples.length * 2);
            for (let i = 0; i < samples.length; i += 1) samples[i] = view.getInt16(i * 2, true) / 32768;
            if (started && this.nextTime <= this.context!.currentTime) { started = false; this.notify({ id: item.id, state: 'buffering' }); }
            if (samples.length) { buffered.push(samples); sampleCount += samples.length; }
            if (sampleCount && (started || sampleCount / audio.sampleRate >= 0.5)) schedule();
            // Bound scheduled audio and let the fetch stream apply backpressure.
            while (this.nextTime - this.context!.currentTime > 3) {
              await new Promise<void>((resolve, reject) => {
                const abort = () => { clearTimeout(timer); reject(signal.reason); };
                const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, 50);
                signal.addEventListener('abort', abort, { once: true });
                if (signal.aborted) abort();
              });
            }
          }
          if (!received || leftover !== undefined) throw new Error('音频流为空或不完整');
          if (sampleCount) schedule();
        } finally { signal.removeEventListener('abort', cancelReader); await reader.cancel().catch(() => {}); reader.releaseLock(); }
      }
    } catch (reason) {
      if (!signal.aborted) {
        this.stop();
        this.notify({ id: this.activeId, state: 'error', error: reason instanceof Error ? reason.message : '语音播放失败' });
      }
    } finally {
      if (this.controller === controller) {
        this.draining = false;
        if (!this.sources.size && !signal.aborted) this.notify({ id: this.activeId, state: 'idle' });
      }
    }
  }
}
