import { useEffect, useId, useMemo, useState } from 'react';
import { Button } from '../ui/Button';
import type { PromptSettingsCardProps, PromptKey } from './types';
import './settings.css';

const meta: { key: PromptKey; label: string; eyebrow: string; description: string; empty: string }[] = [
  { key: 'system', label: '系统提示词', eyebrow: 'SYSTEM PROMPT', description: '定义助手整体角色、边界与输出方式，全局生效（system.md）。', empty: '系统提示词不能为空' },
  { key: 'voice', label: '语音提示词', eyebrow: 'VOICE PROMPT', description: '语音输出模式下追加给模型的提示，控制语音与文字的表达（voice.md）。', empty: '语音提示词不能为空' },
  { key: 'optimization', label: '普通提示词优化', eyebrow: 'PROMPT OPTIMIZATION', description: '根据当前生成模型、参数、风格和参考素材优化提示词（optimize-prompt.md）。', empty: '优化提示词不能为空' },
  { key: 'h3Optimization', label: 'H3 提示词优化', eyebrow: 'H3 PROMPT OPTIMIZATION', description: 'H3 视频专用优化规则，按当前时长和生成方式组织镜头（optimize-h3-prompt.md）。', empty: 'H3 优化提示词不能为空' },
];

/** 提示词设置：查看/编辑宿主提供的提示词，支持恢复默认。 */
export function PromptSettingsCard({ prompts, onSave, onReset }: PromptSettingsCardProps) {
  const [active, setActive] = useState<PromptKey>('system');
  const [draft, setDraft] = useState(prompts.system);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const inputId = useId();
  const current = meta.find((item) => item.key === active)!;
  const dirty = draft !== prompts[active];

  useEffect(() => { setDraft(prompts[active] ?? ''); setNotice(''); setError(''); }, [active, prompts]);

  const save = async () => {
    if (saving) return;
    setNotice(''); setError('');
    if (!draft.trim()) { setError(current.empty); return; }
    setSaving(true);
    try { await onSave({ [active]: draft }); setNotice('已保存，下次请求生效。'); }
    catch (reason) { setError(reason instanceof Error ? reason.message : '保存失败，请重试'); }
    finally { setSaving(false); }
  };

  const restore = () => {
    setNotice(''); setError('');
    const value = prompts.defaults?.[active];
    if (typeof value !== 'string') { setError('没有可用的默认内容'); return; }
    setDraft(value);
    onReset?.(prompts);
    setNotice('已载入默认内容，点击保存后生效。');
  };

  const rows = useMemo(() => meta.filter((item) => prompts[item.key] !== undefined).map((item) => {
    const fallback = prompts.defaults?.[item.key];
    // 与默认内容比较时忽略首尾空白，避免换行差异误判为“已修改”。
    const changed = typeof fallback === 'string' ? prompts[item.key]?.trim() !== fallback.trim() : false;
    return { ...item, changed };
  }), [prompts]);

  return <section className="darl-prompt-settings-card" aria-label="提示词设置">
    <header className="darl-settings-card-header"><div><span className="darl-settings-eyebrow">PROMPTS</span><h2>提示词设置</h2><p>管理当前网站使用的提示词，保存后下次请求生效。</p></div></header>
    <div className="darl-prompt-settings-layout">
      <nav className="darl-prompt-tabs" aria-label="提示词项">
        {rows.map((row) => <button type="button" key={row.key} className="darl-prompt-tab" data-active={row.key === active ? '' : undefined} aria-current={row.key === active ? 'page' : undefined} onClick={() => setActive(row.key)}><span><strong>{row.label}</strong><small>{row.eyebrow}</small></span><em>{row.changed ? '已修改' : '默认'}</em></button>)}
      </nav>
      <div className="darl-prompt-editor">
        <header><div><h3>{current.label}</h3><p>{current.description}</p></div><span className="darl-prompt-badge" data-changed={dirty || undefined}>{dirty ? '未保存' : '已同步'}</span></header>
        <label htmlFor={inputId} className="darl-visually-hidden">{current.label}</label>
        <textarea id={inputId} aria-label={current.label} value={draft} disabled={saving} spellCheck={false} onChange={(event) => { setDraft(event.target.value); setNotice(''); setError(''); }} />
        <div className="darl-prompt-actions">
          <Button variant="outline" size="sm" disabled={saving || !prompts.defaults?.[active]} onClick={restore}>恢复默认</Button>
          <Button size="sm" disabled={saving || !dirty} onClick={() => void save()}>{saving ? '正在保存…' : '保存'}</Button>
          <span role="status">{notice}</span>
        </div>
        {error && <p role="alert" className="darl-agent-settings-error">{error}</p>}
      </div>
    </div>
  </section>;
}
