import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowUpRight, Check, Clipboard, CloudUpload, Palette, RotateCcw, Settings2, ShieldCheck, Terminal } from 'lucide-react';
import { DarlUIProvider, FileUploader, type UploadFn } from '../../src';
import { Button } from '@/components/ui/button';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { Field, FieldGroup, FieldLabel, FieldLegend, FieldSet } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { Separator } from '@/components/ui/separator';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { DemoLayout, type Page } from './DemoLayout';
import { ComponentHeading, FeatureCards, PalettePicker, PreviewPanel, SettingsPanel, SettingSwitch } from './DemoUI';
import { usePlaygroundTheme } from './usePlaygroundTheme';
import { MediaWorkspaceDemo } from './MediaWorkspaceDemo';
import { VideoCompareDemo } from './VideoCompareDemo';
import { AgentSidebarDemo } from './AgentSidebarDemo';
import { SettingsDemo } from './SettingsDemo';
import { DefaultModelSelectorDemo } from './DefaultModelSelectorDemo';
import { StyleSelectorDemo } from './StyleSelectorDemo';
import { InteractiveConfirmDialogDemo } from './InteractiveConfirmDialogDemo';

type Format = 'all' | 'images' | 'videos' | 'mixed' | 'documents';
type Log = { id: number; status: 'success' | 'error' | 'rejected'; message: string };
const formatOptions: Record<Format, { label: string; accept: string[] }> = {
  all: { label: '不限格式', accept: [] },
  images: { label: '仅图片', accept: ['image/*'] },
  videos: { label: '仅视频', accept: ['video/*'] },
  mixed: { label: '图片 + 视频', accept: ['image/*', 'video/*'] },
  documents: { label: '文档', accept: ['.pdf', '.docx', '.txt'] },
};
const hashes: Record<Page, string> = { intro: 'intro', theme: 'theme', uploader: '', video: 'video-compare', media: 'media-workspace', styles: 'styles', agent: 'agent-sidebar', settings: 'settings', 'default-models': 'default-models', 'confirm-dialog': 'confirm-dialog' };
const currentPage = (): Page => (Object.keys(hashes) as Page[]).find((page) => hashes[page] === location.hash.slice(1)) ?? 'uploader';
const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
function mockUpload(shouldFail: boolean): UploadFn<{ fileId: string; url: string }> {
  return (file, { signal, onProgress }) => new Promise((resolve, reject) => {
    let progress = 0;
    const timer = window.setInterval(() => {
      if (signal.aborted) return;
      progress = Math.min(progress + 7 + Math.floor(Math.random() * 11), 100);
      onProgress(progress);
      if (progress === 100) {
        window.clearInterval(timer);
        if (shouldFail) reject(new Error('模拟网络失败，请点击重试'));
        else resolve({ fileId: `demo-${file.name}-${Date.now()}`, url: `demo:///${encodeURIComponent(file.name)}` });
      }
    }, 160);
    const abort = () => { window.clearInterval(timer); reject(new DOMException('已取消', 'AbortError')); };
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
  });
}

export function App() {
  const { mode, setMode, color, setColor } = usePlaygroundTheme();
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
  const [activeTab, setActiveTab] = useState('preview');
  const [selected, setSelected] = useState<Page>(currentPage);
  const [logs, setLogs] = useState<Log[]>([]);
  const [copyDone, setCopyDone] = useState(false);
  useEffect(() => {
    const update = () => setSelected(currentPage());
    window.addEventListener('hashchange', update);
    return () => window.removeEventListener('hashchange', update);
  }, []);
  const navigate = (page: Page) => { setSelected(page); location.hash = hashes[page]; };
  const addLog = useCallback((status: Log['status'], message: string) => setLogs((current) => [{ id: Date.now() + Math.random(), status, message }, ...current].slice(0, 5)), []);
  const uploadFn = useMemo(() => mockUpload(fail), [fail]);
  const accept = formatOptions[format].accept;
  const configCode = `<DarlUIProvider theme={{\n  mode: "${mode}"${color ? `,\n  primaryColor: "${color}"` : ''}\n}}>\n  <FileUploader\n    upload={uploadToServer}\n    multiple={${multiple}}\n    pasteEnabled={${pasteEnabled}}\n    dragEnabled={${dragEnabled}}\n    accept={${JSON.stringify(accept)}}\n    maxFileSizeMB={${maxSize}}\n    maxFiles={${maxFiles}}\n    concurrency={${concurrency}}\n    autoUpload={${autoUpload}}\n    showPreview={${showPreview}}\n    showProgress={${showProgress}}\n  />\n</DarlUIProvider>`;
  const copyCode = async () => { try { await navigator.clipboard.writeText(configCode); setCopyDone(true); await delay(1300); setCopyDone(false); } catch { addLog('error', '复制失败，请手动选择代码'); } };
  const reset = () => { setColor(''); setFormat('mixed'); setMultiple(true); setPasteEnabled(true); setDragEnabled(true); setAutoUpload(false); setShowPreview(true); setShowProgress(true); setFail(false); setMaxSize(100); setMaxFiles(20); setConcurrency(3); setLogs([]); };

  return <DemoLayout selected={selected} onNavigate={navigate} mode={mode} onModeChange={setMode}>
    {selected === 'confirm-dialog' ? <InteractiveConfirmDialogDemo />
      : selected === 'agent' ? <AgentSidebarDemo />
      : selected === 'settings' ? <SettingsDemo />
      : selected === 'default-models' ? <DefaultModelSelectorDemo />
      : selected === 'media' ? <MediaWorkspaceDemo mode={mode} color={color} onColorChange={setColor} />
      : selected === 'video' ? <VideoCompareDemo color={color} mode={mode} />
      : selected === 'styles' ? <StyleSelectorDemo />
      : selected === 'intro' ? <div className="demo-intro">
        <Badge variant="outline">React 组件库</Badge>
        <h1>为你的项目而构建。<br />简单、可复用、可定制。</h1>
        <p className="demo-description">基于 shadcn/ui，将 React 网站需要的高级交互封装成共享组件。上传、视频对比和媒体创作，开箱即可体验。</p>
        <Button onClick={() => navigate('uploader')} size="lg" className="mt-6">体验 FileUploader<ArrowUpRight data-icon="inline-end" /></Button>
        <FeatureCards features={[
          { title: '文件上传', description: '多选、拖拽、粘贴、批量队列。', icon: CloudUpload },
          { title: '主题可配', description: '白天、黑夜与品牌色实时切换。', icon: Palette },
          { title: '逻辑隔离', description: '业务数据和 API 由宿主管理。', icon: ShieldCheck },
        ]} />
      </div>
      : selected === 'theme' ? <div className="demo-theme-page">
        <ComponentHeading title="主题系统" category="设计基础" description="使用 shadcn 默认主题，所有页面与组件共享同一套配色。" />
        <Card><CardHeader><CardTitle>外观主题</CardTitle><CardDescription>首次打开跟随系统外观，手动选择后会保存在此浏览器。</CardDescription></CardHeader>
          <CardContent><FieldGroup>
            <Field><FieldLabel id="appearance-label">外观模式</FieldLabel><ToggleGroup type="single" value={mode} onValueChange={(value) => { if (value === 'light' || value === 'dark') setMode(value); }} variant="outline" aria-labelledby="appearance-label"><ToggleGroupItem value="light">白天</ToggleGroupItem><ToggleGroupItem value="dark">黑夜</ToggleGroupItem></ToggleGroup></Field>
            <Separator />
            <Field><FieldLabel>品牌色</FieldLabel><PalettePicker color={color} onChange={setColor} /></Field>
            <Separator />
            <Field><FieldLabel>按钮预览</FieldLabel><div className="flex flex-wrap gap-2"><Button onClick={() => navigate('uploader')}>查看组件效果<ArrowUpRight data-icon="inline-end" /></Button><Button variant="outline" onClick={() => setColor('')}>恢复默认配色</Button><Button variant="secondary" disabled>禁用状态</Button></div></Field>
          </FieldGroup></CardContent>
        </Card>
      </div>
      : <>
        <ComponentHeading title="FileUploader" category="表单组件" description="一个组件，搞定点击、多选、拖拽、粘贴和批量上传。" action={<Button variant="outline" onClick={reset}><RotateCcw data-icon="inline-start" />重置参数</Button>} />
        <FeatureCards features={[
          { title: '4 种添加方式', description: '点击 / 多选 / 拖拽 / 粘贴', icon: CloudUpload },
          { title: '参数化配置', description: '格式、大小、数量、并发', icon: Settings2 },
          { title: '逐文件校验', description: '类型、大小与上传控制', icon: ShieldCheck },
        ]} />
        <div className="demo-workspace">
          <PreviewPanel title="FileUploader 预览" tab={activeTab} onTabChange={setActiveTab} code={configCode} action={<Button variant="outline" size="sm" onClick={copyCode}>{copyDone ? <Check data-icon="inline-start" /> : <Clipboard data-icon="inline-start" />}{copyDone ? '已复制' : '复制代码'}</Button>}>
            <DarlUIProvider theme={{ mode, primaryColor: color || undefined, radius: 10 }}><FileUploader multiple={multiple} pasteEnabled={pasteEnabled} dragEnabled={dragEnabled} autoUpload={autoUpload} accept={accept} maxFileSizeMB={maxSize} maxFiles={maxFiles} concurrency={concurrency} showPreview={showPreview} showProgress={showProgress} upload={uploadFn} onSuccess={(file) => addLog('success', `${file.name} 上传完成`)} onError={(file, error) => addLog('error', `${file.name}: ${error.message}`)} onReject={(files) => addLog('rejected', files.map((file) => file.reason).join('；'))} /></DarlUIProvider>
            <p className="demo-mock-hint"><ShieldCheck aria-hidden="true" />本地模拟环境，文件不会上传到服务器。</p>
          </PreviewPanel>
          <SettingsPanel><FieldGroup>
            <FieldSet><FieldLegend variant="label">外观主题</FieldLegend><PalettePicker color={color} onChange={setColor} /></FieldSet>
            <Separator />
            <FieldSet><FieldLegend variant="label">上传行为</FieldLegend><FieldGroup>
              <SettingSwitch label="允许多选" checked={multiple} onChange={setMultiple} />
              <SettingSwitch label="粘贴上传" checked={pasteEnabled} onChange={setPasteEnabled} />
              <SettingSwitch label="拖拽上传" checked={dragEnabled} onChange={setDragEnabled} />
              <SettingSwitch label="自动上传" checked={autoUpload} onChange={setAutoUpload} />
            </FieldGroup></FieldSet>
            <Separator />
            <FieldSet><FieldLegend variant="label">文件限制</FieldLegend><FieldGroup>
              <Field><FieldLabel htmlFor="demo-format">文件格式</FieldLabel><NativeSelect id="demo-format" className="w-full" value={format} onChange={(event) => setFormat(event.target.value as Format)}>{Object.entries(formatOptions).map(([key, option]) => <NativeSelectOption key={key} value={key}>{option.label}</NativeSelectOption>)}</NativeSelect></Field>
              <FieldGroup className="grid grid-cols-2 gap-3"><Field><FieldLabel htmlFor="demo-size">单文件上限 (MB)</FieldLabel><Input id="demo-size" type="number" min={1} max={10000} value={maxSize} onChange={(event) => setMaxSize(Math.max(1, Number(event.target.value) || 1))} /></Field><Field><FieldLabel htmlFor="demo-max-files">最多文件数</FieldLabel><Input id="demo-max-files" type="number" min={1} max={500} value={maxFiles} onChange={(event) => setMaxFiles(Math.max(1, Number(event.target.value) || 1))} /></Field></FieldGroup>
              <Field><FieldLabel htmlFor="demo-concurrency">并发上传数</FieldLabel><NativeSelect id="demo-concurrency" className="w-full" value={concurrency} onChange={(event) => setConcurrency(Number(event.target.value))}>{[1, 2, 3, 4, 5, 6].map((number) => <NativeSelectOption key={number} value={number}>{number} 个</NativeSelectOption>)}</NativeSelect></Field>
            </FieldGroup></FieldSet>
            <Separator />
            <FieldSet><FieldLegend variant="label">显示选项</FieldLegend><FieldGroup><SettingSwitch label="显示文件预览" checked={showPreview} onChange={setShowPreview} /><SettingSwitch label="显示上传进度" checked={showProgress} onChange={setShowProgress} /></FieldGroup></FieldSet>
            <Separator />
            <SettingSwitch label="模拟上传失败" hint="启用后新上传任务会失败" checked={fail} onChange={setFail} />
          </FieldGroup></SettingsPanel>
        </div>
        <Card className="mt-6"><CardHeader><CardTitle className="flex items-center gap-2"><Terminal />事件日志</CardTitle><CardDescription>文件上传回调会显示在这里。</CardDescription><CardAction><Button variant="ghost" size="sm" onClick={() => setLogs([])} disabled={!logs.length}>清空</Button></CardAction></CardHeader>
          <CardContent>{logs.length ? <div className="demo-log-list" aria-live="polite">{logs.map((log) => <div key={log.id}><Badge variant={log.status === 'success' ? 'secondary' : 'destructive'}>{log.status === 'success' ? '完成' : log.status === 'error' ? '失败' : '拒绝'}</Badge><span>{log.message}</span></div>)}</div> : <Empty><EmptyHeader><EmptyMedia variant="icon"><Terminal /></EmptyMedia><EmptyTitle>暂无事件</EmptyTitle><EmptyDescription>选择文件并开始上传，查看实际回调。</EmptyDescription></EmptyHeader></Empty>}</CardContent>
        </Card>
        <section className="demo-docs"><h2>快速开始</h2><p>安装 <code>@darl/ui</code>，导入组件和样式，再接入你自己的上传 API。</p><div className="demo-install"><Terminal aria-hidden="true" /><code>npm install ./darl-ui-0.1.0.tgz</code><Button variant="ghost" size="icon" onClick={() => navigator.clipboard.writeText('npm install ./darl-ui-0.1.0.tgz').catch(() => addLog('error', '复制失败，请手动选择安装命令'))} aria-label="复制安装命令"><Clipboard /></Button></div>
          <Alert className="mt-4"><ShieldCheck /><AlertTitle>本地演示</AlertTitle><AlertDescription>演示站使用模拟上传。生产环境需接入上传服务，并在服务端验证文件类型与大小。</AlertDescription></Alert>
        </section>
      </>}
  </DemoLayout>;
}
