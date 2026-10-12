import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { Check, Pause, Play, RotateCcw, Star, Volume2, VolumeX, X } from 'lucide-react';
import { Button } from '../ui/Button';
import './video-compare.css';

export interface CompareVideo {
  id: string;
  name: string;
  src: string;
  poster?: string;
}

export type VideoCompareLayout = 'auto' | 'vertical' | 'horizontal';
export interface VideoCompareProps {
  videos: CompareVideo[];
  audioSourceId?: string | null;
  defaultAudioSourceId?: string | null;
  onAudioSourceChange?: (id: string | null) => void;
  bestVideoId?: string | null;
  defaultBestVideoId?: string | null;
  onBestChange?: (id: string | null) => void;
  onRemove?: (id: string) => void;
  onError?: (id: string, error: Error) => void;
  layout?: VideoCompareLayout;
  loop?: boolean;
  accentColor?: string;
  className?: string;
}

type VideoMeta = { src: string; duration: number; width: number; height: number };
const rates = [0.5, 1, 1.5, 2] as const;
const MAX_VIDEOS = 3;
const DRIFT_TOLERANCE_SECONDS = 0.25;
const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);
const formatTime = (seconds: number) => {
  if (!Number.isFinite(seconds)) return '00:00';
  const whole = Math.floor(Math.max(0, seconds));
  return `${String(Math.floor(whole / 60)).padStart(2, '0')}:${String(whole % 60).padStart(2, '0')}`;
};

/** All comparison media elements share one logical clock; none owns the timeline. */
export function VideoCompare({
  videos, audioSourceId, defaultAudioSourceId, onAudioSourceChange,
  bestVideoId, defaultBestVideoId, onBestChange, onRemove, onError,
  layout = 'auto', loop = false, accentColor, className = ''
}: VideoCompareProps) {
  const items = useMemo(() => videos.slice(0, MAX_VIDEOS), [videos]);
  const signature = items.map((item) => `${item.id}\u0000${item.src}`).join('\u0001');
  const ids = items.map((item) => item.id);
  const [metadata, setMetadata] = useState<Record<string, VideoMeta>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [internalAudio, setInternalAudio] = useState<string | null>(defaultAudioSourceId !== undefined ? defaultAudioSourceId : items[0]?.id ?? null);
  const [internalBest, setInternalBest] = useState<string | null>(defaultBestVideoId ?? null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [rate, setRate] = useState(1);
  const [looping, setLooping] = useState(loop);
  const mediaRefs = useRef(new Map<string, HTMLVideoElement>());
  const clock = useRef({ time: 0, at: 0, rate: 1 });
  const errorCallback = useRef(onError);
  const audioChangeCallback = useRef(onAudioSourceChange);
  const bestChangeCallback = useRef(onBestChange);
  const previousSelection = useRef({ audio: audioSourceId !== undefined ? audioSourceId : internalAudio, best: bestVideoId !== undefined ? bestVideoId : internalBest });
  errorCallback.current = onError;
  audioChangeCallback.current = onAudioSourceChange;
  bestChangeCallback.current = onBestChange;

  const audioWanted = audioSourceId !== undefined ? audioSourceId : internalAudio;
  const audioActive = audioWanted && ids.includes(audioWanted) ? audioWanted : null;
  const bestWanted = bestVideoId !== undefined ? bestVideoId : internalBest;
  const bestActive = bestWanted && ids.includes(bestWanted) ? bestWanted : null;
  const readyCount = items.filter((item) => metadata[item.id]?.src === item.src).length;
  const resolvedCount = items.filter((item) => metadata[item.id]?.src === item.src || errors[item.id]).length;
  const total = Math.max(0, ...items.map((item) => metadata[item.id]?.src === item.src ? metadata[item.id].duration : 0));
  const firstMeta = items[0] ? metadata[items[0].id] : undefined;
  const resolvedLayout: 'vertical' | 'horizontal' | 'pending' = layout === 'auto'
    ? firstMeta && firstMeta.src === items[0]?.src ? (firstMeta.width >= firstMeta.height ? 'vertical' : 'horizontal') : 'pending'
    : layout;
  const available = items.length >= 2 && readyCount > 0 && resolvedCount === items.length && total > 0;
  const sourcesSignature = signature;

  // Update independent, uncontrolled selections when an item is removed.
  useEffect(() => {
    const old = previousSelection.current;
    if (old.audio && !ids.includes(old.audio)) {
      const fallback = items[0]?.id ?? null;
      if (audioSourceId === undefined) setInternalAudio(fallback);
      audioChangeCallback.current?.(fallback);
    }
    if (old.best && !ids.includes(old.best)) {
      if (bestVideoId === undefined) setInternalBest(null);
      bestChangeCallback.current?.(null);
    }
    previousSelection.current = { audio: audioWanted, best: bestWanted };
  }, [sourcesSignature, audioWanted, bestWanted, audioSourceId, bestVideoId]);

  // Never leave two video elements unmuted during an audio source change.
  useLayoutEffect(() => {
    mediaRefs.current.forEach((media) => { media.muted = true; });
    if (audioActive) {
      const chosen = mediaRefs.current.get(audioActive);
      if (chosen) chosen.muted = false;
    }
  }, [audioActive, sourcesSignature]);

  const readClock = useCallback(() => clock.current.time + (playing ? (performance.now() - clock.current.at) / 1000 * clock.current.rate : 0), [playing]);
  const syncMedia = useCallback((seconds: number, force = false) => {
    items.forEach((item) => {
      const video = mediaRefs.current.get(item.id);
      const meta = metadata[item.id];
      if (!video || !meta || meta.src !== item.src) return;
      const limit = Math.max(0, meta.duration - 0.001);
      const target = clamp(seconds, 0, limit);
      if (video.readyState >= HTMLMediaElement.HAVE_METADATA && (force || Math.abs(video.currentTime - target) > DRIFT_TOLERANCE_SECONDS)) {
        try { video.currentTime = target; } catch { /* Seek can fail for an unready stream. */ }
      }
      video.playbackRate = rate;
      if (seconds >= meta.duration - 0.02) video.pause();
    });
  }, [items, metadata, rate]);

  const seek = useCallback((seconds: number) => {
    const next = clamp(seconds, 0, total);
    clock.current = { time: next, at: performance.now(), rate };
    setTime(next);
    syncMedia(next, true);
    if (next >= total && !looping) setPlaying(false);
  }, [total, rate, syncMedia, looping]);

  const startMedia = useCallback(() => {
    items.forEach((item) => {
      const video = mediaRefs.current.get(item.id);
      const meta = metadata[item.id];
      if (!video || !meta || meta.src !== item.src || clock.current.time >= meta.duration - 0.02) return;
      video.playbackRate = rate;
      void video.play().catch((reason: unknown) => {
        if ((reason as { name?: string })?.name === 'AbortError') return;
        const error = reason instanceof Error ? reason : new Error('无法播放该视频');
        setErrors((old) => ({ ...old, [item.id]: error.message }));
        errorCallback.current?.(item.id, error);
      });
    });
  }, [items, metadata, rate]);

  const startRef = useRef(startMedia);
  const syncRef = useRef(syncMedia);
  startRef.current = startMedia;
  syncRef.current = syncMedia;

  useEffect(() => {
    if (!playing) {
      mediaRefs.current.forEach((video) => video.pause());
      return;
    }
    clock.current = { time: clock.current.time, at: performance.now(), rate };
    const timer = window.setInterval(() => {
      const now = performance.now();
      const current = clock.current.time + (now - clock.current.at) / 1000 * clock.current.rate;
      if (current >= total) {
        if (looping && total > 0) {
          clock.current = { time: 0, at: now, rate: clock.current.rate };
          setTime(0);
          syncRef.current(0, true);
          startRef.current();
        } else {
          setTime(total);
          syncRef.current(total, true);
          clock.current = { time: total, at: now, rate: clock.current.rate };
          setPlaying(false);
        }
        return;
      }
      setTime(current);
      syncRef.current(current);
      // A shorter video may have ended; resume it only after a new loop/seek.
    }, 110);
    const handleVisible = () => {
      if (document.visibilityState === 'visible') {
        const target = clamp(clock.current.time + (performance.now() - clock.current.at) / 1000 * clock.current.rate, 0, total);
        syncRef.current(target, true);
      }
    };
    document.addEventListener('visibilitychange', handleVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', handleVisible);
    };
  }, [playing, total, looping, rate, sourcesSignature]);

  // List changes are a fresh comparison; drop stale metadata and pause removed media.
  useEffect(() => {
    setMetadata({});
    setErrors({});
    setPlaying(false);
    setTime(0);
    clock.current = { time: 0, at: performance.now(), rate: clock.current.rate };
    mediaRefs.current.forEach((video) => video.pause());
  }, [sourcesSignature]);

  useEffect(() => { setLooping(loop); }, [loop]);

  const toggle = () => {
    if (!available) return;
    if (playing) {
      const current = clamp(readClock(), 0, total);
      clock.current = { time: current, at: performance.now(), rate };
      setTime(current);
      setPlaying(false);
    } else {
      const current = time >= total - 0.02 ? 0 : time;
      clock.current = { time: current, at: performance.now(), rate };
      syncRef.current(current, true);
      setTime(current);
      // Browser media activation must happen in the user's click handler.
      startRef.current();
      setPlaying(true);
    }
  };

  const changeRate = (next: number) => {
    const current = clamp(readClock(), 0, total);
    clock.current = { time: current, at: performance.now(), rate: next };
    setTime(current);
    setRate(next);
    mediaRefs.current.forEach((video) => { video.playbackRate = next; });
  };

  const changeAudio = (id: string | null) => {
    // Mute first, synchronously, so quick switching cannot mix two soundtracks.
    mediaRefs.current.forEach((video) => { video.muted = true; });
    if (id) {
      const chosen = mediaRefs.current.get(id);
      if (chosen) chosen.muted = false;
    }
    if (audioSourceId === undefined) setInternalAudio(id);
    onAudioSourceChange?.(id);
  };
  const changeBest = (id: string) => {
    const next = bestActive === id ? null : id;
    if (bestVideoId === undefined) setInternalBest(next);
    onBestChange?.(next);
  };
  const onMetadata = (item: CompareVideo, element: HTMLVideoElement) => {
    const duration = element.duration;
    if (!Number.isFinite(duration) || duration <= 0) {
      reportError(item.id, new Error('此视频时长无法用于同步比较'));
      return;
    }
    setMetadata((old) => ({ ...old, [item.id]: { src: item.src, duration, width: element.videoWidth, height: element.videoHeight } }));
    setErrors((old) => {
      const next = { ...old }; delete next[item.id]; return next;
    });
    const desired = clock.current.time;
    if (desired > 0) element.currentTime = clamp(desired, 0, duration - 0.001);
    element.playbackRate = clock.current.rate;
    element.muted = audioActive !== item.id;
  };
  const reportError = (id: string, error: Error) => {
    setErrors((old) => ({ ...old, [id]: error.message }));
    errorCallback.current?.(id, error);
  };

  const style = accentColor ? { '--darl-primary': accentColor } as CSSProperties : undefined;
  const overLimit = videos.length > MAX_VIDEOS;
  return (
    <section className={`darl-compare ${className}`} style={style} aria-label="视频对比播放器">
      <header className="darl-compare-header">
        <div><strong>视频对比</strong><span>{items.length} / {MAX_VIDEOS} 个视频</span></div>
        {overLimit && <small role="alert">最多支持 3 个视频，后续视频未显示</small>}
      </header>
      <div className={`darl-compare-grid darl-compare-grid--${resolvedLayout}`}>
        {items.map((item, index) => {
          const error = errors[item.id];
          const meta = metadata[item.id];
          const isBest = item.id === bestActive;
          return (
            <article key={`${item.id}:${item.src}`} className={`darl-compare-card ${isBest ? 'darl-compare-card--best' : ''}`}>
              <div className="darl-compare-card-head">
                <div className="darl-compare-title"><span className="darl-compare-letter">{String.fromCharCode(65 + index)}</span><strong title={item.name}>{item.name}</strong>{isBest && <span className="darl-compare-best-label"><Star size={12} fill="currentColor"/> 最佳</span>}{audioActive === item.id && <Volume2 size={15} aria-label="当前音源"/>}</div>
                {onRemove && <Button size="icon" variant="ghost" aria-label={`移除 ${item.name}`} onClick={() => onRemove(item.id)}><X size={16}/></Button>}
              </div>
              <div className="darl-compare-stage">
                <video
                  ref={(element) => { if (element) mediaRefs.current.set(item.id, element); else mediaRefs.current.delete(item.id); }}
                  src={item.src} poster={item.poster} playsInline preload="metadata"
                  muted={audioActive !== item.id}
                  onLoadedMetadata={(event) => onMetadata(item, event.currentTarget)}
                  onError={() => reportError(item.id, new Error('视频加载失败或格式不受支持'))}
                  aria-label={item.name}
                />
                {error && <div className="darl-compare-overlay darl-compare-overlay--error" role="alert">{error}</div>}
                {!error && (!meta || meta.src !== item.src) && <div className="darl-compare-overlay">正在读取视频…</div>}
              </div>
              <div className="darl-compare-card-foot">
                <span>{meta?.src === item.src ? `${formatTime(meta.duration)} · ${meta.width}×${meta.height}` : error ? '不可播放' : '正在加载'}</span>
                <Button variant={isBest ? 'default' : 'outline'} size="sm" aria-pressed={isBest} onClick={() => changeBest(item.id)}>
                  {isBest ? <Check size={14}/> : <Star size={14}/>} {isBest ? '已选最佳' : '选为最佳'}
                </Button>
              </div>
            </article>
          );
        })}
      </div>
      {items.length < 2 && <p className="darl-compare-empty">至少添加 2 个视频才能开始对比。</p>}
      {items.length >= 2 && <div className="darl-compare-controls">
        <div className="darl-compare-transport">
          <Button variant="outline" size="icon" onClick={toggle} disabled={!available} aria-label={playing ? '暂停全部视频' : '播放全部视频'}>{playing ? <Pause size={17}/> : <Play size={17}/>}</Button>
          <Button variant="ghost" size="icon" onClick={() => { seek(0); if (playing) startRef.current(); }} disabled={!available} aria-label="重新开始"><RotateCcw size={16}/></Button>
          <span className="darl-compare-time">{formatTime(time)}</span>
          <input aria-label="统一视频进度" type="range" min={0} max={total || 1} step="0.01" value={clamp(time, 0, total)} disabled={!available}
            onChange={(event) => { seek(Number(event.target.value)); if (playing) startRef.current(); }} />
          <span className="darl-compare-time">{formatTime(total)}</span>
          <label className="darl-compare-rate">速度 <select aria-label="播放速度" value={rate} onChange={(event) => changeRate(Number(event.target.value))}>{rates.map((value) => <option key={value} value={value}>{value}×</option>)}</select></label>
          <label className="darl-compare-loop"><input type="checkbox" checked={looping} onChange={(event) => setLooping(event.target.checked)}/> 循环</label>
        </div>
        <div className="darl-compare-sound"><span>{audioActive ? <Volume2 size={17}/> : <VolumeX size={17}/>} 声音来源</span>
          <select aria-label="选择声音来源" value={audioActive ?? ''} onChange={(event) => changeAudio(event.target.value || null)}>
            <option value="">全部静音</option>
            {items.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
          {resolvedCount < items.length && <span className="darl-compare-pending" role="status">等待视频加载完成</span>}
        </div>
      </div>}
    </section>
  );
}
