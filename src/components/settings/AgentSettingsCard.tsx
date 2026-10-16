import { useEffect, useId, useState } from 'react';
import { Button } from '../ui/Button';
import type { AgentSettingsCardProps } from './types';
import './settings.css';

export function AgentSettingsCard({ systemPrompt, onSave }: AgentSettingsCardProps) {
  const inputId = useId();
  const [draft, setDraft] = useState(systemPrompt);
  const [saved, setSaved] = useState(systemPrompt);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  useEffect(() => { setDraft(systemPrompt); setSaved(systemPrompt); setError(''); }, [systemPrompt]);

  const save = async () => {
    if (saving) return;
    setError(''); setNotice('');
    if (!draft.trim()) { setError('系统提示词不能为空'); return; }
    setSaving(true);
    try { await onSave(draft); setSaved(draft); setNotice('已保存，下次发送消息时生效。'); }
    catch (reason) { setError(reason instanceof Error ? reason.message : '保存失败，请重试'); }
    finally { setSaving(false); }
  };

  return <section className="darl-agent-settings-card" aria-label="Agent 设置">
    <header className="darl-settings-card-header"><div><h2>Agent</h2><p>设置助手的回答方式与工具使用规则。</p></div></header>
    <div className="darl-agent-settings-body">
      <label htmlFor={inputId}>系统提示词</label>
      <textarea id={inputId} value={draft} disabled={saving} spellCheck={false} onChange={(event) => { setDraft(event.target.value); setNotice(''); setError(''); }} />
      <div className="darl-agent-settings-actions"><Button disabled={saving || draft === saved} onClick={() => void save()}>{saving ? '正在保存…' : '保存提示词'}</Button><span role="status">{notice}</span></div>
      {error && <p role="alert" className="darl-agent-settings-error">{error}</p>}
    </div>
  </section>;
}
