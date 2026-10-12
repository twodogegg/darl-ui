import { VideoCompareDemo } from './VideoCompareDemo';
import { useCallback, useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import { DarlUIProvider, FileUploader, type UploadFn } from '../../src';
import { ArrowUpRight, Braces, Check, CheckCircle2, ChevronDown, Clipboard, CloudUpload, Code2, Component, FileImage, Github, Layers3, LayoutPanelTop, Moon, Palette, Play, RotateCcw, Settings2, ShieldCheck, Sun, Terminal, Upload, Zap } from 'lucide-react';

type Mode = 'light' | 'dark';
type Format = 'all' | 'images' | 'videos' | 'mixed' | 'documents';
type Log = { id: number; status: 'success' | 'error' | 'rejected'; message: string };
const palettes = [
  { label: '海洋蓝', color: '#2563eb' },
  { label: '梦幻紫', color: '#7c3aed' },
  { label: '森林绿', color: '#059669' },
  { label: '活力橙', color: '#ea580c' },
  { label: '玫瑰粉', color: '#db2777' },
  { label: '石墨黑', color: '#18181b' }
];
const formatOptions: Record<Format, { label: string; accept: string[] }> = {
  all: { label: '不限格式', accept: [] },
  images: { label: '仅图片', accept: ['image/*'] },
  videos: { label: '仅视频', accept: ['video/*'] },
  mixed: { label: '图片 + 视频', accept: ['image/*', 'video/*'] },
  documents: { label: '文档', accept: ['.pdf', '.docx', '.txt'] }
};
const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
function mockUpload(shouldFail: boolean): UploadFn<{ fileId: string; url: string }> {
  return (file, { signal, onProgress }) => new Promise((resolve, reject) => {
    let progress = 0;
    const ms = 160;
    const timer = window.setInterval(() => {
      if (signal.aborted) return;
      progress = Math.min(progress + 7 + Math.floor(Math.random() * 11), 100);
      onProgress(progress);
      if (progress === 100) {
        window.clearInterval(timer);
        if (shouldFail) reject(new Error('模拟网络失败，请点击重试'));
        else resolve({ fileId: `demo-${file.name}-${Date.now()}`, url: `demo:///${encodeURIComponent(file.name)}` });
      }
    }, ms);
    const abort = () => { window.clearInterval(timer); reject(new DOMException('已取消', 'AbortError')); };
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
  });
}
function Toggle({ checked, onChange }: { checked: boolean; onChange: (value: boolean) => void }) {
  return <button type="button" role="switch" aria-checked={checked} onClick={() => onChange(!checked)} className={`demo-switch ${checked ? 'demo-switch-on' : ''}`}><span/></button>;
}
function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return <div className="demo-field"><div className="demo-field-text"><label>{label}</label>{hint && <small>{hint}</small>}</div>{children}</div>;
}
export function App() {
  const [mode, setMode] = useState<Mode>('light');
  const [color, setColor] = useState('#2563eb');
  const [format, setFormat] = useState<Format>('mixed');
  const [multiple, setMultiple] = useState(true);
  const [pasteEnabled, setPasteEnabled] = useState(true);
  const [dragEnabled, setDragEnabled] = useState(true);
  const [autoUpload, setAutoUpload] = useState(false);
  const [showPreview, setShowPreview] = useState(true);
  const [showProgress, setShowProgress] = useState(true);
  const [fail, setFail] = useState(false);
  const [maxSize, setMaxSize] = useState(100);
  const [maxFiles, setMaxFiles] = useState(20);
  const [concurrency, setConcurrency] = useState(3);
  const [activeTab, setActiveTab] = useState<'preview' | 'code'>('preview');
  const [selected, setSelected] = useState<'uploader' | 'video' | 'theme' | 'intro'>('uploader');
  const [logs, setLogs] = useState<Log[]>([]);
  const [copyDone, setCopyDone] = useState(false);
  const addLog = useCallback((status: Log['status'], message: string) => setLogs((current) => [{ id: Date.now() + Math.random(), status, message }, ...current].slice(0, 5)), []);
  const uploadFn = useMemo(() => mockUpload(fail), [fail]);
  const accept = formatOptions[format].accept;
  const configCode = `<DarlUIProvider theme={{\n  mode: "${mode}",\n  primaryColor: "${color}"\n}}>\n  <FileUploader\n    upload={uploadToServer}\n    multiple={${multiple}}\n    pasteEnabled={${pasteEnabled}}\n    dragEnabled={${dragEnabled}}\n    accept={${JSON.stringify(accept)}}\n    maxFileSizeMB={${maxSize}}\n    maxFiles={${maxFiles}}\n    concurrency={${concurrency}}\n    autoUpload={${autoUpload}}\n    showPreview={${showPreview}}\n    showProgress={${showProgress}}\n  />\n</DarlUIProvider>`;
  const copyCode = async () => { try { await navigator.clipboard.writeText(configCode); setCopyDone(true); await delay(1300); setCopyDone(false); } catch { addLog('error', '复制失败，请手动选择代码'); } };
  const reset = () => { setMode('light'); setColor('#2563eb'); setFormat('mixed'); setMultiple(true); setPasteEnabled(true); setDragEnabled(true); setAutoUpload(false); setShowPreview(true); setShowProgress(true); setFail(false); setMaxSize(100); setMaxFiles(20); setConcurrency(3); setLogs([]); };
  return <div className={`demo-shell ${mode === 'dark' ? 'demo-shell-dark' : ''}`} style={{ '--demo-brand': color } as CSSProperties}>
    <aside className="demo-sidebar">
      <div className="demo-brand"><div className="demo-logo"><Component size={19} strokeWidth={2.3}/></div><div className="demo-brand-name">darl<span>ui</span></div><div className="demo-version">v0.1</div></div>
      <div className="demo-side-scroll">
        <div className="demo-nav-group">开始使用</div>
        <button className={`demo-nav-item ${selected === 'intro' ? 'is-active' : ''}`} onClick={() => setSelected('intro')}><LayoutPanelTop size={17}/> 概览</button>
        <button className={`demo-nav-item ${selected === 'theme' ? 'is-active' : ''}`} onClick={() => setSelected('theme')}><Palette size={17}/> 主题系统</button>
        <div className="demo-nav-group demo-group-spaced">组件 / Components <span>2</span></div>
        <button className={`demo-nav-item ${selected === 'uploader' ? 'is-active' : ''}`} onClick={() => setSelected('uploader')}><Upload size={17}/> FileUploader <span className="demo-new">NEW</span></button>
        <button className={`demo-nav-item ${selected === 'video' ? 'is-active' : ''}`} onClick={() => setSelected('video')}><Play size={17}/> VideoCompare <span className="demo-new">NEW</span></button>
        <div className="demo-nav-group demo-group-spaced">即将推出</div>
        <div className="demo-nav-disabled"><FileImage size={17}/> ImageViewer</div>
        <div className="demo-nav-disabled"><Layers3 size={17}/> AssetPicker</div>
      </div>
      <div className="demo-sidebar-bottom"><div className="demo-mini-banner"><Zap size={15}/><div><b>轻量化构建</b><p>shadcn/ui + 自主扩展</p></div></div><div className="demo-side-foot">Made for your React projects</div></div>
    </aside>
    <main className="demo-main">
      <header className="demo-topbar"><div className="demo-breadcrumb">Components <span>/</span> <strong>{selected === 'uploader' ? 'FileUploader' : selected === 'video' ? 'VideoCompare' : selected === 'theme' ? 'Theme' : 'Introduction'}</strong></div><div className="demo-top-actions"><button className="demo-top-icon" onClick={() => setMode(mode === 'light' ? 'dark' : 'light')} title="切换深浅模式" aria-label="切换深浅模式">{mode === 'light' ? <Moon size={18}/> : <Sun size={18}/>}</button><span className="demo-vline"/><a className="demo-top-icon" href="https://github.com/twodogegg/darl-ui" target="_blank" rel="noreferrer" title="GitHub 仓库"><Github size={19}/></a></div></header>
      <div className="demo-content">
        {selected === 'intro' ? <div className="demo-intro"><div className="demo-eyebrow"><span className="demo-eyebrow-dot"/> REACT COMPONENT LIBRARY</div><h1>为你的项目而构建。<br/><span>简单、可复用、可定制。</span></h1><p>基于 shadcn/ui 的设计理念，将多个 React 网站真正需要的高级交互封装成共享组件。第一版从文件上传开始。</p><button onClick={() => setSelected('uploader')} className="demo-primary-action">体验 FileUploader <ArrowUpRight size={16}/></button><div className="demo-intro-cards"><div><CloudUpload size={24}/><b>文件上传</b><small>多选、拖拽、粘贴、批量队列</small></div><div><Palette size={24}/><b>主题可配</b><small>实时修改品牌色与外观</small></div><div><ShieldCheck size={24}/><b>逻辑隔离</b><small>不绑定任何存储服务或后端</small></div></div></div> : selected === 'theme' ? <div className="demo-theme-page"><div className="demo-eyebrow">DESIGN TOKENS</div><h1>主题系统</h1><p>全局配色采用 CSS Variables，同一组件可跟随不同网站的品牌色。</p><h3>主色调</h3><div className="demo-theme-palette">{palettes.map((p) => <button key={p.color} className={`demo-theme-swatch ${color === p.color ? 'is-selected' : ''}`} onClick={() => setColor(p.color)}><span style={{ background: p.color }}/><b>{p.label}</b><code>{p.color}</code></button>)}</div><h3>外观模式</h3><div className="demo-theme-choices"><button className={mode === 'light' ? 'is-selected' : ''} onClick={() => setMode('light')}><Sun size={19}/> 浅色模式</button><button className={mode === 'dark' ? 'is-selected' : ''} onClick={() => setMode('dark')}><Moon size={19}/> 深色模式</button></div><button className="demo-primary-action" onClick={() => setSelected('uploader')}>查看组件效果 <ArrowUpRight size={16}/></button></div> : selected === 'video' ? <VideoCompareDemo color={color} mode={mode}/> : <>
          <div className="demo-heading"><div><div className="demo-eyebrow"><span className="demo-eyebrow-dot"/> FORM COMPONENTS</div><h1>FileUploader <span className="demo-beta">v0.1</span></h1><p>现代化文件上传组件。一个组件，搞定点击、多选、拖拽、粘贴和批量上传。</p></div><button className="demo-reset" onClick={reset}><RotateCcw size={15}/> 重置参数</button></div>
          <div className="demo-metrics"><div><div className="demo-metric-icon blue"><CloudUpload size={19}/></div><div><strong>4 种添加方式</strong><small>点击 / 多选 / 拖拽 / 粘贴</small></div></div><div><div className="demo-metric-icon purple"><Settings2 size={19}/></div><div><strong>参数化配置</strong><small>格式、大小、数量、并发</small></div></div><div><div className="demo-metric-icon green"><ShieldCheck size={19}/></div><div><strong>自带安全校验</strong><small>类型检查与上传控制</small></div></div></div>
          <div className="demo-workspace"><div className="demo-preview-pane"><div className="demo-pane-tabs"><div className="demo-tabs"><button className={activeTab === 'preview' ? 'is-active' : ''} onClick={() => setActiveTab('preview')}><Play size={14}/> 实时预览</button><button className={activeTab === 'code' ? 'is-active' : ''} onClick={() => setActiveTab('code')}><Code2 size={15}/> 示例代码</button></div><span className="demo-live-dot"><span/>LIVE PREVIEW</span></div>
            {activeTab === 'preview' ? <div className="demo-preview-content"><DarlUIProvider theme={{ mode, primaryColor: color, radius: 12 }}><FileUploader multiple={multiple} pasteEnabled={pasteEnabled} dragEnabled={dragEnabled} autoUpload={autoUpload} accept={accept} maxFileSizeMB={maxSize} maxFiles={maxFiles} concurrency={concurrency} showPreview={showPreview} showProgress={showProgress} upload={uploadFn} onSuccess={(file) => addLog('success', `${file.name} 上传完成`)} onError={(file, e) => addLog('error', `${file.name}: ${e.message}`)} onReject={(files) => addLog('rejected', files.map((f) => f.reason).join('；'))}/></DarlUIProvider><div className="demo-mock-hint"><ShieldCheck size={14}/> 模拟上传环境 · 文件仅在当前浏览器中处理，不会上传到服务器</div></div> : <div className="demo-code-panel"><div className="demo-code-heading"><div><Terminal size={16}/> React / TypeScript</div><button onClick={copyCode}>{copyDone ? <Check size={15}/> : <Clipboard size={15}/>} {copyDone ? '已复制' : '复制代码'}</button></div><pre><code>{configCode}</code></pre><div className="demo-code-info">提示：业务项目中需要实现 <code>uploadToServer</code> 并返回 Promise。</div></div>}
            <div className="demo-preview-footer"><span><CheckCircle2 size={15}/> React 18 / 19</span><span><Braces size={15}/> TypeScript</span><span><Palette size={15}/> 主题可配</span></div>
          </div>
          <div className="demo-controls-pane"><div className="demo-controls-header"><Settings2 size={17}/><span>组件参数</span><span className="demo-controls-caption">PROPS</span></div><div className="demo-controls-scroll"><div className="demo-setting-caption">外观主题</div><div className="demo-palette-mini">{palettes.map((p) => <button key={p.color} onClick={() => setColor(p.color)} aria-label={p.label} title={p.label} className={color === p.color ? 'is-active' : ''} style={{ '--swatch': p.color } as CSSProperties}><span style={{ background: p.color }}/></button>)}</div><div className="demo-color-value"><span>主题色</span><code>{color.toUpperCase()}</code></div>
            <div className="demo-setting-divider"/><div className="demo-setting-caption">上传行为</div>
            <Field label="允许多选"><Toggle checked={multiple} onChange={setMultiple}/></Field>
            <Field label="粘贴上传"><Toggle checked={pasteEnabled} onChange={setPasteEnabled}/></Field>
            <Field label="拖拽上传"><Toggle checked={dragEnabled} onChange={setDragEnabled}/></Field>
            <Field label="自动上传"><Toggle checked={autoUpload} onChange={setAutoUpload}/></Field>
            <div className="demo-setting-divider"/><div className="demo-setting-caption">文件限制</div>
            <div className="demo-stacked"><label htmlFor="demo-format">文件格式</label><div className="demo-select-wrap"><select id="demo-format" value={format} onChange={(e) => setFormat(e.target.value as Format)}>{Object.entries(formatOptions).map(([key, opt]) => <option key={key} value={key}>{opt.label}</option>)}</select><ChevronDown size={15}/></div></div>
            <div className="demo-input-row"><div><label htmlFor="demo-size">单文件上限 (MB)</label><input id="demo-size" type="number" min={1} max={10000} value={maxSize} onChange={(e) => setMaxSize(Math.max(1, Number(e.target.value) || 1))}/></div><div><label htmlFor="demo-max-files">最多文件数</label><input id="demo-max-files" type="number" min={1} max={500} value={maxFiles} onChange={(e) => setMaxFiles(Math.max(1, Number(e.target.value) || 1))}/></div></div>
            <div className="demo-stacked"><label htmlFor="demo-concurrency">并发上传数</label><div className="demo-select-wrap"><select id="demo-concurrency" value={concurrency} onChange={(e) => setConcurrency(Number(e.target.value))}>{[1,2,3,4,5,6].map((n)=><option key={n} value={n}>{n} 个</option>)}</select><ChevronDown size={15}/></div></div>
            <div className="demo-setting-divider"/><div className="demo-setting-caption">显示选项</div>
            <Field label="显示文件预览"><Toggle checked={showPreview} onChange={setShowPreview}/></Field>
            <Field label="显示上传进度"><Toggle checked={showProgress} onChange={setShowProgress}/></Field>
            <div className="demo-setting-divider"/><div className="demo-setting-caption">调试工具</div>
            <Field label="模拟上传失败" hint="启用后新上传任务会失败"><Toggle checked={fail} onChange={setFail}/></Field>
          </div></div></div>
          <div className="demo-output"><div className="demo-output-head"><div><Terminal size={16}/><strong>事件日志</strong></div><button onClick={() => setLogs([])}>清空</button></div>{logs.length ? <div className="demo-log-list">{logs.map((log) => <div key={log.id}><span className={`demo-log-dot ${log.status}`}/><span>{log.message}</span></div>)}</div> : <div className="demo-log-empty">开始上传文件后，这里会显示回调事件。</div>}</div>
          <div className="demo-docs"><h2>快速开始</h2><p>将 <code>@darl/ui</code> 安装到你的 React 项目，导入组件和样式，再接入你自己的上传 API。</p><div className="demo-install"><Terminal size={17}/><code>npm install ./darl-ui-0.1.0.tgz</code><button onClick={() => navigator.clipboard?.writeText('npm install ./darl-ui-0.1.0.tgz')} title="复制安装命令"><Clipboard size={17}/></button></div><div className="demo-doc-note">核心上传器不依赖后端服务。演示站使用的是模拟上传函数；生产环境仍需由服务器验证文件类型与大小。</div></div>
        </>}
      </div><footer className="demo-footer"><span>darl-ui © 2026</span><span>Built with React · shadcn/ui patterns</span></footer>
    </main>
  </div>;
}
