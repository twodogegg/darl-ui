import { useCallback, useEffect, useRef, useState } from 'react';
import type { AgentVoiceFilters, AgentVoiceOption } from '@darl/ui';
import { Button } from '../../../src/components/ui/Button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, Field, FieldLabel, Input } from '../../../src/components/ui/FormControls';
import { defaultVoiceSettings, type VoiceSettings as Configuration } from '../voice-config';

type Settings = Configuration & { hasApiKey: boolean };
async function result<T>(response: Response): Promise<T> {
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || '语音请求失败');
  return data as T;
}

export const loadVoiceCatalog = async (query: string, page: number, signal: AbortSignal, filters?: AgentVoiceFilters): Promise<{ voices: AgentVoiceOption[]; hasMore: boolean }> => {
  const params = new URLSearchParams({ q: query, page: String(page), language: filters?.language ?? 'zh', sort: filters?.sort || 'score' });
  filters?.tags?.forEach((tag) => params.append('tag', tag));
  return result(await fetch(`/api/voice/voices?${params}`, { signal }));
};

export function useFishVoice() {
  const [settings, setSettings] = useState<Settings>({ ...defaultVoiceSettings, hasApiKey: false });
  const [error, setError] = useState('');
  const current = useRef(settings);
  const saved = useRef(settings);
  const writes = useRef(Promise.resolve());
  const revision = useRef(0);
  useEffect(() => {
    const controller = new AbortController();
    void fetch('/api/voice/settings', { signal: controller.signal }).then(result<Settings>).then((value) => { if (!controller.signal.aborted) { current.current = value; saved.current = value; setSettings(value); } }).catch((reason) => { if (!controller.signal.aborted) setError(reason.message); });
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
  return { settings, save, error };
}

export function VoiceSettings({ settings, onSave }: { settings: Settings; onSave: (patch: Partial<Configuration> & { apiKey?: string }) => Promise<void> }) {
  const [apiKey, setApiKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  return <Card><CardHeader><CardTitle>语音 · Fish Audio</CardTitle><CardDescription>配置 Fish Audio，供工作台的公共音色库使用。</CardDescription></CardHeader><CardContent>
    <form className="example-voice-settings" onSubmit={(event) => {
      event.preventDefault(); setBusy(true); setMessage('');
      void onSave(apiKey ? { apiKey } : {}).then(() => { setApiKey(''); setMessage('设置已保存'); }).catch((reason) => setMessage(reason.message)).finally(() => setBusy(false));
    }}>
      <Field><FieldLabel htmlFor="fish-key">Fish Audio API Key</FieldLabel><Input id="fish-key" type="password" autoComplete="new-password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder={settings.hasApiKey ? '已配置，留空保留' : '填写 API Key'} /></Field>
      <Button type="submit" disabled={busy}>{busy ? '保存中…' : '保存'}</Button>{message && <p role="status">{message}</p>}
    </form>
  </CardContent></Card>;
}
