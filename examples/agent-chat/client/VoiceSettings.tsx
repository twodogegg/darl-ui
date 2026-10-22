import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AgentVoice } from '@darl/ui';
import { Button } from '../../../src/components/ui/Button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, Field, FieldLabel, Input, NativeSelect } from '../../../src/components/ui/FormControls';
import { defaultVoiceSettings, voiceCatalogFilters, type VoiceSettings as Configuration } from '../voice-config';

type Settings = Configuration & { hasApiKey: boolean };
async function result<T>(response: Response): Promise<T> {
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || '语音请求失败');
  return data as T;
}

export const loadVoiceCatalog: AgentVoice['loadVoices'] = async (query, page, signal, filters) => {
  const params = new URLSearchParams({ q: query, page: String(page), language: filters?.language ?? 'zh', sort: filters?.sort || 'score' });
  filters?.tags?.forEach((tag) => params.append('tag', tag));
  return result(await fetch(`/api/voice/voices?${params}`, { signal }));
};

export function useFishVoice() {
  const [settings, setSettings] = useState<Settings>({ ...defaultVoiceSettings, hasApiKey: false });
  const [error, setError] = useState('');
  const [ready, setReady] = useState(false);
  const current = useRef(settings);
  const saved = useRef(settings);
  const writes = useRef(Promise.resolve());
  const revision = useRef(0);
  useEffect(() => {
    const controller = new AbortController();
    void fetch('/api/voice/settings', { signal: controller.signal }).then(result<Settings>).then((value) => { if (!controller.signal.aborted) { current.current = value; saved.current = value; setSettings(value); setReady(true); } }).catch((reason) => { if (!controller.signal.aborted) setError(reason.message); });
    return () => controller.abort();
  }, []);
  const save = useCallback((patch: Partial<Configuration> & { apiKey?: string }) => {
    const version = ++revision.current;
    const next = { ...current.current, ...patch };
    const { apiKey: _secret, ...publicNext } = next;
    current.current = publicNext; setSettings(publicNext); setError('');
    const task = writes.current.then(async () => {
      const value = await result<Settings>(await fetch('/api/voice/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(next) }));
      saved.current = value;
      if (revision.current === version) { current.current = value; setSettings(value); }
    });
    writes.current = task.catch((reason) => {
      setError(reason instanceof Error ? reason.message : '保存语音设置失败');
      if (revision.current === version) { current.current = saved.current; setSettings(saved.current); }
    });
    return task;
  }, []);
  const loadVoices = loadVoiceCatalog;
  const synthesize = useCallback<AgentVoice['synthesize']>(async (text, voiceId, signal) => {
    const response = await fetch('/api/voice/speech', { method: 'POST', signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text, voiceId }) });
    if (!response.ok) { await result(response); throw new Error('语音请求失败'); }
    if (!response.body) throw new Error('语音响应为空');
    return { body: response.body, sampleRate: Number(response.headers.get('X-Audio-Sample-Rate')) };
  }, []);
  const transcribe = useCallback<NonNullable<AgentVoice['transcribe']>>(async (file, signal) => {
    const extension = file.name.split('.').at(-1)?.toLowerCase();
    const mime = file.type || ({ mp3: 'audio/mpeg', wav: 'audio/wav', m4a: 'audio/mp4', webm: 'audio/webm', ogg: 'audio/ogg', opus: 'audio/opus', flac: 'audio/flac' } as Record<string, string>)[extension || ''] || 'application/octet-stream';
    const data = await result<{ text: string }>(await fetch('/api/voice/transcribe', { method: 'POST', signal, headers: { 'Content-Type': mime }, body: file }));
    return data.text;
  }, []);
  const voice = useMemo<AgentVoice>(() => ({
    enabled: settings.enabled, voiceId: settings.voiceId, voiceName: settings.voiceName,
    onEnabledChange: (enabled) => { void save({ enabled }).catch(() => {}); },
    onVoiceChange: ({ id, name }) => { void save({ voiceId: id, voiceName: name }).catch(() => {}); },
    catalogFilters: voiceCatalogFilters, loadVoices, synthesize, transcribe,
  }), [settings, save, loadVoices, synthesize, transcribe]);
  return { settings, voice: ready ? voice : undefined, save, error };
}

export function VoiceSettings({ settings, onSave }: { settings: Settings; onSave: (patch: Partial<Configuration> & { apiKey?: string }) => Promise<void> }) {
  const [apiKey, setApiKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  return <Card><CardHeader><CardTitle>语音 · Fish Audio</CardTitle><CardDescription>语音输入转为可编辑文字；Agent 的语音与文字分别输出。音色在聊天框中选择和试听。</CardDescription></CardHeader><CardContent>
    <form className="example-voice-settings" onSubmit={(event) => {
      event.preventDefault(); setBusy(true); setMessage('');
      void onSave(apiKey ? { apiKey } : {}).then(() => { setApiKey(''); setMessage('设置已保存'); }).catch((reason) => setMessage(reason.message)).finally(() => setBusy(false));
    }}>
      <Field><FieldLabel htmlFor="fish-key">Fish Audio API Key</FieldLabel><Input id="fish-key" type="password" autoComplete="new-password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder={settings.hasApiKey ? '已配置，留空保留' : '填写 API Key'} /></Field>
      <Field><FieldLabel htmlFor="fish-tts-model">语音输出模型</FieldLabel><NativeSelect id="fish-tts-model" value={settings.ttsModel} onChange={(event) => { void onSave({ ttsModel: event.target.value as Configuration['ttsModel'] }).catch(() => {}); }}><option value="s2.1-pro-free">S2.1 Pro Free</option><option value="s2.1-pro">S2.1 Pro</option><option value="s2-pro">S2 Pro</option></NativeSelect></Field>
      <Field><FieldLabel htmlFor="fish-speed">语速</FieldLabel><NativeSelect id="fish-speed" value={settings.speed} onChange={(event) => { void onSave({ speed: Number(event.target.value) }).catch(() => {}); }}>{[0.75, 1, 1.25, 1.5, 2].map((speed) => <option key={speed} value={speed}>{speed}×</option>)}</NativeSelect></Field>
      <p>输入使用 Transcribe-1 Pro。输出为流式音频，开播前缓冲约 0.5 秒。免费模型受供应商当前政策限制，可切换付费模型。</p>
      <Button type="submit" disabled={busy}>{busy ? '保存中…' : '保存'}</Button>{message && <p role="status">{message}</p>}
    </form>
  </CardContent></Card>;
}
