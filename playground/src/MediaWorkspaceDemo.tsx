import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { DarlUIProvider, MediaWorkspace, type GenerateRequest, type MediaBatch, type MediaModel, type MediaResult, type MediaTask } from '../../src';
import { Braces, CheckCircle2, Component, FileImage, Github, LayoutPanelTop, Moon, Palette, Play, RotateCcw, Settings2, ShieldCheck, Sun, Terminal, Upload, Zap } from 'lucide-react';

const media = (name: string) => `${import.meta.env.BASE_URL}media-workspace/${name}`;
const palettes = [
  { label: '海洋蓝', color: '#2563eb' },
  { label: '梦幻紫', color: '#7c3aed' },
  { label: '森林绿', color: '#059669' },
  { label: '活力橙', color: '#ea580c' },
  { label: '玫瑰粉', color: '#db2777' },
  { label: '石墨黑', color: '#18181b' },
];

const studioModels: MediaModel[] = [
  { id: 'image-a', name: '图片模型 A', type: 'image', capabilities: { images: 10, aspectRatios: ['1:1', '2:3', '3:2', '9:16', '16:9'], resolutions: ['1K', '2K', '4K'], maxOutputs: 4 }, defaults: { aspectRatio: '9:16', resolution: '2K', count: 2 } },
  { id: 'image-b', name: '图片模型 B', type: 'image', capabilities: { images: 1, aspectRatios: ['1:1', '16:9'], resolutions: ['1024x1024', '1536x1024'], maxOutputs: 1 }, defaults: { aspectRatio: '1:1', resolution: '1024x1024' } },
  { id: 'video-a', name: '视频模型 A', type: 'video', capabilities: { images: 30, videos: 2, audios: 1, firstLastFrame: true, aspectRatios: ['16:9', '9:16'], resolutions: ['720p', '1080p'], durations: { min: 4, max: 15 }, generateAudio: true, maxOutputs: 4 }, defaults: { aspectRatio: '9:16', resolution: '1080p', duration: 10, count: 1, generateAudio: true } },
  { id: 'video-b', name: '视频模型 B', type: 'video', capabilities: { images: 9, firstLastFrame: true, aspectRatios: ['16:9', '9:16'], resolutions: ['720p'], durations: [4, 8, 12, 15], maxOutputs: 1 }, defaults: { aspectRatio: '16:9', resolution: '720p', duration: 8, count: 1 } },
];
const campaignModels: MediaModel[] = [
  { id: 'campaign-image', name: '商品海报', type: 'image', capabilities: { images: 2, aspectRatios: ['1:1', '3:4'], resolutions: ['2K'], maxOutputs: 2 }, defaults: { aspectRatio: '3:4', count: 1 } },
  { id: 'campaign-video', name: '宣传短片', type: 'video', capabilities: { aspectRatios: ['16:9'], durations: [5, 10], maxOutputs: 1 }, defaults: { duration: 5 } },
];

function initialTasks(campaign: boolean): MediaTask[] {
  if (campaign) return [{ id: 'campaign', title: '秋季产品宣传', batches: [] }];
  const images: MediaBatch = { id: 'initial-images', modelId: 'image-a', type: 'image', prompt: '雨夜的霓虹街道，电影质感，湿润路面反射彩色灯光', options: { aspectRatio: '16:9', resolution: '2K', count: 4 }, results: [1, 2, 3].map((i) => ({ id: `scene-${i}`, status: 'completed', url: media(`scene-${i}.svg`) })) };
  images.results.push({ id: 'initial-failure', status: 'failed', error: '模拟生成失败，可以重试' });
  return [
    { id: 'city', title: '赛博朋克街景', batches: [images, { id: 'initial-video', modelId: 'video-a', type: 'video', prompt: '沿霓虹街道缓慢前进，让灯光在雨中流动', options: { aspectRatio: '16:9', resolution: '1080p', count: 1, duration: 10, generateAudio: true }, results: [{ id: 'city-video', status: 'completed', url: media('city.mp4') }], references: { firstFrame: { id: 'scene-1', url: media('scene-1.svg') } } }] },
    { id: 'character', title: '人物设定', batches: [] },
    { id: 'product', title: '产品宣传', batches: [] },
  ];
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: (value: boolean) => void }) {
  return <button type="button" role="switch" aria-checked={checked} onClick={() => onChange(!checked)} className={`demo-switch ${checked ? 'demo-switch-on' : ''}`}><span /></button>;
}

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return <div className="demo-field"><div className="demo-field-text"><label>{label}</label>{hint && <small>{hint}</small>}</div>{children}</div>;
}

function DemoHost({ campaign, mode, color, fail, reject }: { campaign: boolean; mode: 'dark' | 'light'; color: string; fail: boolean; reject: boolean }) {
  const models = campaign ? campaignModels : studioModels;
  const [tasks, setTasks] = useState(() => initialTasks(campaign));
  const [active, setActive] = useState(tasks[0].id);
  const [lastRequest, setLastRequest] = useState<GenerateRequest | null>(null);
  const [notice, setNotice] = useState('');
  const regeneration = useRef(0);
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  useEffect(() => () => { timers.current.forEach(clearTimeout); timers.current.clear(); }, []);
  const update = (batchId: string, resultId: string, values: Partial<MediaResult>) => setTasks((prev) => prev.map((task) => ({ ...task, batches: task.batches.map((batch) => batch.id === batchId ? { ...batch, results: batch.results.map((result) => result.id === resultId ? { ...result, ...values } : result) } : batch) })));
  const schedule = (batchId: string, resultId: string, type: 'image' | 'video', shouldFail: boolean, index: number) => {
    const previous = timers.current.get(resultId);
    if (previous) clearTimeout(previous);
    timers.current.set(resultId, setTimeout(() => {
      update(batchId, resultId, { status: 'running', error: undefined });
      timers.current.set(resultId, setTimeout(() => {
        timers.current.delete(resultId);
        update(batchId, resultId, shouldFail ? { status: 'failed', error: '模拟失败：点击重试即可恢复' } : { status: 'completed', error: undefined, url: media(type === 'video' ? 'city.mp4' : `scene-${index % 6 + 1}.svg`) });
      }, 1800 + index * 180));
    }, 650 + index * 120));
  };
  const generate = (request: GenerateRequest) => {
    if (reject) return Promise.reject(new Error('模拟提交失败，请关闭「模拟提交失败」后重试'));
    setLastRequest(request);
    const model = models.find((item) => item.id === request.modelId)!;
    const batch: MediaBatch = { id: crypto.randomUUID(), modelId: model.id, type: model.type, prompt: request.prompt, options: request.options, references: request.references, results: Array.from({ length: request.options.count }, () => ({ id: crypto.randomUUID(), status: 'queued' })) };
    setTasks((prev) => prev.map((task) => task.id === request.taskId ? { ...task, batches: [...task.batches, batch] } : task));
    batch.results.forEach((result, index) => schedule(batch.id, result.id, model.type, fail && index === batch.results.length - 1, index));
  };
  return <div className="demo-media-preview-body">
    <DarlUIProvider theme={{ mode, primaryColor: color, radius: 13 }}>
      <MediaWorkspace accentColor={color} models={models} tasks={tasks} activeTaskId={active} onTaskChange={setActive} onCreateTask={() => { const task = { id: crypto.randomUUID(), title: '未命名任务', batches: [] }; setTasks((prev) => [...prev, task]); setActive(task.id); }} onRenameTask={(id, title) => setTasks((prev) => prev.map((task) => task.id === id ? { ...task, title } : task))} onGenerate={generate} onFavoriteChange={(batchId, resultId, favorited) => { update(batchId, resultId, { favorited }); setNotice(favorited ? '已收藏' : '已取消收藏'); }} onRegenerate={(batchId, resultId) => { const task = tasks.find((item) => item.batches.some((batch) => batch.id === batchId))!; const batch = task.batches.find((item) => item.id === batchId)!; setLastRequest({ taskId: task.id, modelId: batch.modelId, prompt: batch.prompt, references: batch.references, options: { ...batch.options, count: 1 } }); update(batchId, resultId, { status: 'queued', url: undefined, error: undefined }); schedule(batchId, resultId, batch.type ?? 'image', fail, ++regeneration.current); setNotice('正在重新生成这一张'); }} onRetry={(batchId, resultId) => { const batch = tasks.flatMap((task) => task.batches).find((item) => item.id === batchId)!; update(batchId, resultId, { status: 'queued', error: undefined }); schedule(batchId, resultId, batch.type ?? 'image', false, 0); }} onCancel={(batchId, resultId) => { const timer = timers.current.get(resultId); if (timer) clearTimeout(timer); timers.current.delete(resultId); update(batchId, resultId, { status: 'cancelled' }); }} />
    </DarlUIProvider>
    <div className="demo-media-notice" role="status">{notice}</div>
    <details className="demo-media-request"><summary>查看最近提交请求</summary><pre>{lastRequest ? JSON.stringify(lastRequest, (_key, value) => value instanceof File ? { name: value.name, type: value.type, size: value.size } : value, 2) : '填写提示词并点击生成后，查看能力过滤后的请求。'}</pre></details>
  </div>;
}

export function MediaWorkspaceDemo({ onBack }: { onBack: () => void }) {
  const [mode, setMode] = useState<'dark' | 'light'>('light');
  const [color, setColor] = useState('#2563eb');
  const [campaign, setCampaign] = useState(false);
  const [fail, setFail] = useState(false);
  const [reject, setReject] = useState(false);
  const [activeTab, setActiveTab] = useState<'preview' | 'code'>('preview');
  const reset = () => { setMode('light'); setColor('#2563eb'); setCampaign(false); setFail(false); setReject(false); setActiveTab('preview'); };
  const code = `<DarlUIProvider theme={{ mode: '${mode}', primaryColor: '${color}' }}>\n  <MediaWorkspace\n    models={models}\n    tasks={tasks}\n    onGenerate={handleGenerate}\n    onRetry={handleRetry}\n    onRegenerate={handleRegenerate}\n  />\n</DarlUIProvider>`;
  return <div className={`demo-shell ${mode === 'dark' ? 'demo-shell-dark' : ''} demo-media-shell`} style={{ '--demo-brand': color } as CSSProperties}>
    <aside className="demo-sidebar">
      <div className="demo-brand"><div className="demo-logo"><Component size={19} strokeWidth={2.3} /></div><div className="demo-brand-name">darl<span>ui</span></div><div className="demo-version">v0.1</div></div>
      <div className="demo-side-scroll"><div className="demo-nav-group">开始使用</div><button className="demo-nav-item" onClick={onBack}><LayoutPanelTop size={17} /> 概览</button><button className="demo-nav-item" onClick={onBack}><Palette size={17} /> 主题系统</button><div className="demo-nav-group demo-group-spaced">组件 / Components <span>3</span></div><button className="demo-nav-item" onClick={onBack}><Upload size={17} /> FileUploader</button><button className="demo-nav-item" onClick={onBack}><Play size={17} /> VideoCompare</button><button className="demo-nav-item is-active"><FileImage size={17} /> MediaWorkspace <span className="demo-new">NEW</span></button><div className="demo-nav-group demo-group-spaced">即将推出</div><div className="demo-nav-disabled"><FileImage size={17} /> ImageViewer</div></div>
      <div className="demo-sidebar-bottom"><div className="demo-mini-banner"><Zap size={15} /><div><b>轻量化构建</b><p>shadcn/ui + 自主扩展</p></div></div><div className="demo-side-foot">Made for your React projects</div></div>
    </aside>
    <main className="demo-main">
      <header className="demo-topbar"><div className="demo-breadcrumb">Components <span>/</span> <strong>MediaWorkspace</strong></div><div className="demo-top-actions"><button className="demo-media-entry" onClick={onBack}>返回组件列表</button><button className="demo-top-icon" onClick={() => setMode(mode === 'light' ? 'dark' : 'light')} title="切换深浅模式" aria-label="切换深浅模式">{mode === 'light' ? <Moon size={18} /> : <Sun size={18} />}</button><span className="demo-vline" /><a className="demo-top-icon" href="https://github.com/twodogegg/darl-ui" target="_blank" rel="noreferrer" title="GitHub 仓库"><Github size={19} /></a></div></header>
      <div className="demo-content">
        <div className="demo-heading"><div><div className="demo-eyebrow"><span className="demo-eyebrow-dot" /> MEDIA COMPONENTS</div><h1>MediaWorkspace <span className="demo-beta">v0.1</span></h1><p>图片与视频生成工作台。通过模型能力驱动参数、素材和结果交互。</p></div><button className="demo-reset" onClick={reset}><RotateCcw size={15} /> 重置参数</button></div>
        <div className="demo-metrics"><div><div className="demo-metric-icon blue"><Settings2 size={19} /></div><div><strong>模型能力驱动</strong><small>参数和素材自动过滤</small></div></div><div><div className="demo-metric-icon purple"><FileImage size={19} /></div><div><strong>图片 + 视频</strong><small>统一任务与批次管理</small></div></div><div><div className="demo-metric-icon green"><ShieldCheck size={19} /></div><div><strong>本地模拟环境</strong><small>不会上传你的素材</small></div></div></div>
        <div className="demo-workspace demo-media-workspace-card">
          <div className="demo-preview-pane"><div className="demo-pane-tabs"><div className="demo-tabs"><button className={activeTab === 'preview' ? 'is-active' : ''} onClick={() => setActiveTab('preview')}><Play size={14} /> 实时预览</button><button className={activeTab === 'code' ? 'is-active' : ''} onClick={() => setActiveTab('code')}><Terminal size={15} /> 示例代码</button></div><span className="demo-live-dot"><span /> LIVE PREVIEW</span></div>{activeTab === 'preview' ? <DemoHost key={String(campaign)} campaign={campaign} mode={mode} color={color} fail={fail} reject={reject} /> : <div className="demo-code-panel"><div className="demo-code-heading"><div><Braces size={16} /> React / TypeScript</div></div><pre><code>{code}</code></pre><div className="demo-code-info">宿主网站只需要提供模型、任务和异步生成回调，组件负责完整的创作交互。</div></div>}<div className="demo-preview-footer"><span><CheckCircle2 size={15} /> React 18 / 19</span><span><Braces size={15} /> TypeScript</span><span><Palette size={15} /> 主题可配</span></div></div>
          <aside className="demo-controls-pane"><div className="demo-controls-header"><Settings2 size={17} /><span>演示参数</span><span className="demo-controls-caption">PROPS</span></div><div className="demo-controls-scroll"><div className="demo-setting-caption">外观主题</div><div className="demo-palette-mini">{palettes.map((palette) => <button key={palette.color} onClick={() => setColor(palette.color)} aria-label={palette.label} title={palette.label} className={color === palette.color ? 'is-active' : ''} style={{ '--swatch': palette.color } as CSSProperties}><span style={{ background: palette.color }} /></button>)}</div><div className="demo-color-value"><span>主题色</span><code>{color.toUpperCase()}</code></div><div className="demo-setting-divider" /><div className="demo-setting-caption">宿主配置</div><div className="demo-stacked"><label htmlFor="media-host">演示场景</label><div className="demo-select-wrap"><select id="media-host" value={campaign ? 'campaign' : 'studio'} onChange={(event) => setCampaign(event.target.value === 'campaign')}><option value="studio">创作工作室 · 4 个模型</option><option value="campaign">品牌宣传 · 2 个模型</option></select></div></div><div className="demo-setting-divider" /><div className="demo-setting-caption">模拟行为</div><Field label="模拟结果失败" hint="最后一个结果会失败"><Toggle checked={fail} onChange={setFail} /></Field><Field label="模拟提交失败" hint="验证错误处理路径"><Toggle checked={reject} onChange={setReject} /></Field><div className="demo-setting-divider" /><div className="demo-setting-caption">组件能力</div><div className="demo-media-capabilities"><span>任务列表</span><b>支持</b><span>参考素材</span><b>图片 / 视频 / 音频</b><span>生成状态</span><b>排队 · 运行 · 失败</b><span>结果操作</span><b>复用 · 收藏 · 重试</b></div></div></aside>
        </div>
        <div className="demo-docs demo-media-docs"><h2>接入要点</h2><p>MediaWorkspace 只负责 UI 和通用交互。模型能力、任务数据、生成 API 与持久化由宿主网站控制。</p><div className="demo-doc-note"><ShieldCheck size={14} /> 当前为本地模拟：生成、失败、重试和取消均在浏览器内完成。</div></div>
      </div>
      <footer className="demo-footer"><span>darl-ui © 2026</span><span>Built with React · shadcn/ui patterns</span></footer>
    </main>
  </div>;
}
