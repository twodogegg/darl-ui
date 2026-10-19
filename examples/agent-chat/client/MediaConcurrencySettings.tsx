import { useEffect, useState } from 'react';
import { Button } from '../../../src/components/ui/Button';
import { Input } from '../../../src/components/ui/FormControls';

type Limits = Record<string, number>;
const names: Array<{ id: string; title: string }> = [
  { id: 'gpt-image-2', title: 'GPT Image 2 图片并发' },
  { id: 'gpt-image-2.5', title: 'GPT Image 2.5 图片并发' },
  { id: 'gemini-3-pro-image-preview', title: 'Gemini 3 Pro Image Preview 图片并发' },
  { id: 'minimax-h3-flash', title: 'MiniMax H3 Flash 视频并发' },
];

export function MediaConcurrencySettings() {
  const [limits, setLimits] = useState<Limits>(Object.fromEntries(names.map((item) => [item.id, 4])));
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState('');
  useEffect(() => {
    let alive = true;
    fetch('/api/media-generation/limits')
      .then(async (response) => { const value = await response.json(); if (!response.ok) throw new Error(value.error || '读取失败'); if (alive) setLimits(value); })
      .catch((error) => { if (alive) setMessage(error.message); });
    return () => { alive = false; };
  }, []);
  async function save(modelId: string) {
    setPending(true); setMessage('');
    try {
      const response = await fetch('/api/media-generation/limits', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ modelId, concurrency: limits[modelId] }) });
      const value = await response.json();
      if (!response.ok) throw new Error(value.error || '保存失败');
      setLimits(value); setMessage('并发限制已保存，后续调度将采用新配置。');
    } catch (error) { setMessage(error instanceof Error ? error.message : '保存失败'); }
    finally { setPending(false); }
  }
  return <section className="example-media-concurrency" aria-labelledby="example-media-concurrency-title">
    <header>
      <div>
        <span className="example-eyebrow">MEDIA CONCURRENCY</span>
        <h2 id="example-media-concurrency-title">生成任务并发</h2>
        <p>每个模型分别限制同时在途的任务数量。配置减少时不会取消已经提交的视频。</p>
      </div>
    </header>
    <div className="example-media-concurrency-list">
      {names.map(({ id, title }) => <div className="example-media-concurrency-row" key={id}>
        <label htmlFor={`limit-${id}`}>{title}</label>
        <Input id={`limit-${id}`} type="number" inputMode="numeric" min={1} max={100000} step={1} value={limits[id]}
          onChange={(event) => setLimits((current) => ({ ...current, [id]: Number(event.target.value) }))} />
        <Button variant="outline" size="sm" disabled={pending || !Number.isSafeInteger(limits[id]) || limits[id] < 1 || limits[id] > 100000}
          onClick={() => void save(id)}>保存</Button>
      </div>)}
    </div>
    {message && <p className="example-media-concurrency-message" role="status">{message}</p>}
  </section>;
}
