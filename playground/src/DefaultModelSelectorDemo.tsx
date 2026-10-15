import { useState } from 'react';
import { DefaultModelSelector, type DefaultModelOption, type DefaultModelSelection } from '../../src';

const initial: DefaultModelOption[] = [
  { id: 'deepseek', name: 'DeepSeek V4 Flash', type: 'text' },
  { id: 'gpt-text', name: 'GPT Text', type: 'text' },
  { id: 'gpt-image', name: 'GPT Image 2', type: 'image', capabilities: { resolutions: ['1K', '2K', '4K'], aspectRatios: ['3:4', '4:3', '16:9', '9:16'] }, defaults: { resolution: '2K', aspectRatio: '9:16' } },
  { id: 'image-small', name: 'Image Lite', type: 'image', capabilities: { resolutions: ['1K'], aspectRatios: ['4:3', '9:16'] } },
  { id: 'audio-a', name: 'Audio Model A', type: 'audio' },
  { id: 'audio-b', name: 'Audio Model B', type: 'audio' },
  { id: 'h3-flash', name: 'MiniMax H3 Flash', type: 'video', capabilities: { resolutions: ['480P', '720P', '1080P'] }, defaults: { resolution: '720P', aspectRatio: '9:16' } },
  { id: 'h3-alt', name: 'Video 768P', type: 'video', capabilities: { resolutions: ['480P', '768P'], aspectRatios: ['16:9', '9:16'] }, defaults: { resolution: '768P', aspectRatio: '9:16' } },
];

export function DefaultModelSelectorDemo() {
  const [models, setModels] = useState(initial);
  const [saved, setSaved] = useState<DefaultModelSelection | null>(null);
  return <div style={{ display: 'grid', gap: 18 }}>
    <div>
      <h1 style={{ fontSize: 24, fontWeight: 650, marginBottom: 4 }}>DefaultModelSelector</h1>
      <p style={{ color: 'var(--muted-foreground)' }}>四步配置默认模型；支持模型能力、分辨率和画幅联动。</p>
    </div>
    <DefaultModelSelector models={models} onComplete={(result) => setSaved(result)} />
    <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
      <label style={{ fontSize: 13 }}><input type="checkbox" checked={models.some((item) => item.id === 'h3-alt')}
        onChange={(event) => setModels((items) => event.target.checked ? [...items, initial.find((item) => item.id === 'h3-alt')!] : items.filter((item) => item.id !== 'h3-alt'))} /> 提供 768P 视频模型</label>
    </div>
    {saved && <section aria-label="提交结果"><strong>最近一次完成结果</strong><pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', marginTop: 9, fontSize: 12 }}>{JSON.stringify(saved, null, 2)}</pre></section>}
  </div>;
}
