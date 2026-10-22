import { useEffect, useState } from 'react';
import type { AgentModel } from '@darl/ui';
import { Button } from '../../../src/components/ui/Button';
import type { OptimizationModels } from '../server/prompt-optimization';

export function PromptOptimizationSettings({ models }: { models: AgentModel[] }) {
  const [selection, setSelection] = useState<OptimizationModels>({ general: '', h3: '' });
  const [ready, setReady] = useState(false);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/prompt-optimization/settings', { signal: controller.signal }).then(async response => {
      const value = await response.json();
      if (!response.ok) throw new Error(value.error || '无法读取优化模型');
      setSelection(value); setReady(true);
    }).catch(reason => { if (!controller.signal.aborted) setError(reason.message); });
    return () => controller.abort();
  }, []);
  const save = async () => {
    setSaving(true); setNotice(''); setError('');
    try {
      const response = await fetch('/api/prompt-optimization/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(selection) });
      const value = await response.json();
      if (!response.ok) throw new Error(typeof value.error === 'string' ? value.error : value.error?.message || '保存失败');
      setSelection(value); setNotice('已保存，下次优化生效。');
    } catch (reason) { setError(reason instanceof Error ? reason.message : '保存失败'); }
    finally { setSaving(false); }
  };
  return <section className="example-default-models" aria-label="提示词优化模型设置">
    <header><div><span className="example-eyebrow">PROMPT OPTIMIZATION</span><h2>提示词优化模型</h2><p>分别选择普通优化和 H3 优化使用的文本模型。优化规则在「提示词」中配置。</p></div></header>
    <div className="example-default-model-grid">{(['general', 'h3'] as const).map(key => <label key={key}>
      <span>{key === 'general' ? '普通优化模型' : 'H3 优化模型'}</span>
      <select aria-label={key === 'general' ? '普通优化模型' : 'H3 优化模型'} value={selection[key]} disabled={!ready || saving} onChange={event => { setSelection(current => ({ ...current, [key]: event.target.value })); setNotice(''); }}>
        {!models.some(model => model.id === selection[key]) && <option value={selection[key]}>{selection[key] ? `不可用：${selection[key]}` : '请选择文本模型'}</option>}
        {models.map(model => <option key={model.id} value={model.id}>{model.name} · {model.providerName || model.providerId}</option>)}
      </select>
    </label>)}</div>
    <Button size="sm" disabled={!ready || saving || !models.some(model => model.id === selection.general) || !models.some(model => model.id === selection.h3)} onClick={() => void save()}>{saving ? '保存中…' : '保存优化模型'}</Button>
    <span role="status">{notice}</span>{error && <p role="alert">{error}</p>}
  </section>;
}
