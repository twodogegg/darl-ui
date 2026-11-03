import { useEffect, useId, useRef, useState } from 'react';
import { Check, LoaderCircle, Mic, Search, SlidersHorizontal, Square, Upload, Volume2, X } from 'lucide-react';
import { Button } from '../ui/Button';
import { Badge, NativeSelect } from '../ui/FormControls';
import type { AgentVoice, AgentVoiceOption } from './types';

export function AgentVoiceInput({ transcribe, onText, disabled, onBegin, onBusyChange }: { transcribe: NonNullable<AgentVoice['transcribe']>; onText: (text: string) => void; disabled: boolean; onBegin: () => void; onBusyChange: (busy: boolean) => void }) {
  const [state, setState] = useState<'idle' | 'requesting' | 'recording' | 'transcribing'>('idle');
  const [error, setError] = useState('');
  const recorder = useRef<MediaRecorder | undefined>(undefined);
  const stream = useRef<MediaStream | undefined>(undefined);
  const pending = useRef<AbortController | undefined>(undefined);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const upload = useRef<HTMLInputElement>(null);
  const cancel = () => {
    pending.current?.abort(); pending.current = undefined;
    if (recorder.current) { recorder.current.onstop = null; recorder.current.ondataavailable = null; if (recorder.current.state !== 'inactive') recorder.current.stop(); }
    recorder.current = undefined;
    stream.current?.getTracks().forEach((track) => track.stop()); stream.current = undefined;
    clearTimeout(timer.current); setState('idle');
  };
  useEffect(() => { onBusyChange(state !== 'idle'); }, [state, onBusyChange]);
  useEffect(() => () => { cancel(); onBusyChange(false); }, []);
  useEffect(() => { if (disabled) cancel(); }, [disabled]);

  const convert = async (file: File, controller: AbortController) => {
    setState('transcribing');
    try {
      const text = await transcribe(file, controller.signal);
      if (!controller.signal.aborted) onText(text);
    } catch (reason) { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : '转写失败，请重试'); }
    finally { if (pending.current === controller) { pending.current = undefined; setState('idle'); } }
  };
  const start = async () => {
    cancel(); setError(''); onBegin();
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') { setError('录音需要 HTTPS 或 localhost；也可以上传音频文件'); return; }
    const controller = new AbortController(); pending.current = controller;
    setState('requesting');
    try {
      const media = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      if (controller.signal.aborted) { media.getTracks().forEach((track) => track.stop()); return; }
      stream.current = media;
      const mimeType = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/ogg;codecs=opus'].find((type) => MediaRecorder.isTypeSupported(type));
      const recording = new MediaRecorder(media, mimeType ? { mimeType } : undefined);
      recorder.current = recording;
      const chunks: Blob[] = [];
      let size = 0;
      recording.ondataavailable = ({ data }) => {
        size += data.size;
        if (size > 25 * 1024 * 1024) { cancel(); setError('录音超过 25MB，请缩短后重试'); return; }
        if (data.size) chunks.push(data);
      };
      recording.onerror = () => { cancel(); setError('录音失败，请检查麦克风后重试'); };
      recording.onstop = () => {
        clearTimeout(timer.current);
        media.getTracks().forEach((track) => track.stop()); stream.current = undefined; recorder.current = undefined;
        if (!controller.signal.aborted) {
          const type = recording.mimeType || mimeType || 'audio/webm';
          void convert(new File(chunks, `recording.${type.includes('mp4') ? 'mp4' : type.includes('ogg') ? 'ogg' : 'webm'}`, { type }), controller);
        }
      };
      recording.start(1000); setState('recording');
      timer.current = setTimeout(() => { if (recording.state === 'recording') recording.stop(); }, 120_000);
    } catch (reason) {
      if (!controller.signal.aborted) { cancel(); setError(reason instanceof Error && reason.name === 'NotAllowedError' ? '麦克风权限被拒绝，请在浏览器中允许录音' : '无法启动录音，请检查麦克风'); }
    }
  };

  return <div className="darl-agent-voice-input">
    <Button variant="ghost" size="icon" disabled={disabled || state === 'requesting' || state === 'transcribing'} aria-label={state === 'recording' ? '结束录音并转写' : '语音输入'} title={state === 'recording' ? '结束录音并转写' : '语音输入'} onClick={() => state === 'recording' ? recorder.current?.stop() : void start()}>{state === 'recording' ? <Square size={15} /> : state === 'requesting' || state === 'transcribing' ? <LoaderCircle size={15} className="darl-agent-spin" /> : <Mic size={16} />}</Button>
    {state !== 'idle' && <><span role="status">{state === 'recording' ? '录音中（最长 2 分钟）' : state === 'transcribing' ? '正在转文字…' : '等待麦克风…'}</span><Button variant="ghost" size="icon" aria-label="取消语音输入" onClick={cancel}><X size={14} /></Button></>}
    {state === 'idle' && <Button variant="ghost" size="icon" aria-label="上传语音文件" title="上传语音文件" disabled={disabled} onClick={() => upload.current?.click()}><Upload size={15} /></Button>}
    <input ref={upload} type="file" hidden accept="audio/*,.mp3,.wav,.m4a,.webm,.ogg,.opus,.flac" onChange={(event) => {
      const file = event.target.files?.[0]; event.target.value = '';
      if (!file) return;
      cancel(); setError(''); onBegin();
      if (!file.size || file.size > 25 * 1024 * 1024) { setError('音频为空或超过 25MB'); return; }
      const controller = new AbortController(); pending.current = controller; void convert(file, controller);
    }} />
    {error && <p role="alert">{error}</p>}
  </div>;
}

export function AgentVoicePicker({ voice, onPreview, previewId }: { voice: AgentVoice; onPreview: (item: AgentVoiceOption) => void; previewId?: string }) {
  const [query, setQuery] = useState('');
  const [retry, setRetry] = useState(0);
  const [page, setPage] = useState(1);
  const [voices, setVoices] = useState<AgentVoiceOption[]>([]);
  const catalog = voice.catalogFilters;
  const [language, setLanguage] = useState(catalog?.defaultLanguage || '');
  const [sort, setSort] = useState(catalog?.sorts[0]?.value || '');
  const [tags, setTags] = useState<string[]>([]);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const filtersId = useId();
  const resultsRef = useRef<HTMLDivElement>(null);
  const tagLabels = new Map(catalog?.tagGroups.flatMap((group) => group.options.map((option) => [option.value, option.label] as const)));
  useEffect(() => { resultsRef.current?.scrollTo?.({ top: 0 }); }, [query, language, sort, tags]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError('');
    if (page === 1) { setVoices([]); setHasMore(false); }
    const timer = setTimeout(() => {
      void voice.loadVoices(query, page, controller.signal, catalog ? { language, sort, tags } : undefined).then((result) => {
        if (controller.signal.aborted) return;
        setVoices((current) => page === 1 ? result.voices : [...current, ...result.voices.filter((item) => !current.some((previous) => previous.id === item.id))]);
        setHasMore(result.hasMore);
      }).catch((reason) => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : '音色加载失败'); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    }, 250);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [voice.loadVoices, query, page, retry, language, sort, tags, catalog]);
  return <div className="darl-agent-voice-picker">
    <div className="darl-agent-voice-toolbar">
      <label className="darl-agent-search"><Search size={18} /><input aria-label="搜索音色" placeholder="搜索音色名称" value={query} onChange={(event) => { setQuery(event.target.value); setPage(1); }} /></label>
      {catalog && <>
        <NativeSelect aria-label="音色语言" value={language} onChange={(event) => { setLanguage(event.target.value); setPage(1); }}>{catalog.languages.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</NativeSelect>
        <NativeSelect aria-label="音色排序" value={sort} onChange={(event) => { setSort(event.target.value); setPage(1); }}>{catalog.sorts.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</NativeSelect>
        <Button variant="outline" aria-label="筛选音色" aria-expanded={filtersOpen} aria-controls={filtersId} onClick={() => setFiltersOpen(!filtersOpen)}><SlidersHorizontal size={16} />筛选{tags.length > 0 && ` · ${tags.length}`}</Button>
      </>}
    </div>
    {catalog && filtersOpen && <div className="darl-agent-voice-filters" id={filtersId}>
      <div className="darl-agent-voice-filter-heading"><strong>音色筛选</strong><Button variant="ghost" size="sm" disabled={!tags.length} onClick={() => { setTags([]); setPage(1); }}>重置标签</Button></div>
      {catalog.tagGroups.map((group) => <fieldset key={group.label}><legend>{group.label}</legend><div>{group.options.map((option) => <label key={option.value} className="darl-agent-voice-tag"><input type="checkbox" checked={tags.includes(option.value)} onChange={(event) => { setTags((current) => event.target.checked ? [...current, option.value] : current.filter((tag) => tag !== option.value)); setPage(1); }} /><span>{option.label}</span></label>)}</div></fieldset>)}
    </div>}
    <div className="darl-agent-voice-results" ref={resultsRef} aria-busy={loading}>
      <div className="darl-agent-voice-grid">{voices.map((item) => <div key={item.id} className="darl-agent-voice-card" data-selected={voice.voiceId === item.id}>
        <button type="button" className="darl-agent-voice-select" aria-pressed={voice.voiceId === item.id} onClick={() => voice.onVoiceChange(item)}>
          <span className="darl-agent-voice-avatar" aria-hidden="true">{voice.voiceId === item.id ? <Check size={20} /> : <Volume2 size={20} />}</span>
          <span className="darl-agent-voice-copy"><strong>{item.name}</strong><small>{voice.voiceId === item.id ? '当前音色' : '选择此音色'}</small></span>
        </button>
        {item.description && <p className="darl-agent-voice-description" title={item.description}>{item.description}</p>}
        <div className="darl-agent-voice-card-footer"><div className="darl-agent-voice-badges">{item.tags?.slice(0, 3).map((tag) => <Badge key={tag}>{tagLabels.get(tag) || tag}</Badge>)}</div><Button variant="outline" size="sm" disabled={!item.previewUrl} title={item.previewUrl ? undefined : '此音色尚未提供试听样本'} onClick={() => onPreview(item)} aria-label={`${!item.previewUrl ? '暂无试听' : previewId === item.id ? '停止试听' : '试听'} ${item.name}`}>{previewId === item.id ? <Square size={14} /> : <Volume2 size={14} />}{!item.previewUrl ? '暂无试听' : previewId === item.id ? '停止' : '试听'}</Button></div>
      </div>)}</div>
      {loading && <p className="darl-agent-voice-status" role="status">正在加载音色…</p>}
      {error && <div className="darl-agent-voice-status"><p role="alert">{error}</p><Button variant="outline" size="sm" onClick={() => setRetry((value) => value + 1)}>重试</Button></div>}
      {!loading && !error && !voices.length && <p className="darl-agent-voice-status">未找到音色，请调整搜索或筛选条件。</p>}
      {hasMore && !error && <div className="darl-agent-voice-status"><Button variant="outline" disabled={loading} onClick={() => setPage((value) => value + 1)}>加载更多</Button></div>}
    </div>
  </div>;
}
