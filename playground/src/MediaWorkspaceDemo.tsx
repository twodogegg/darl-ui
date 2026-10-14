import { useEffect, useRef, useState } from 'react';
import { DarlUIProvider, MediaWorkspace, type GenerateRequest, type MediaBatch, type MediaModel, type MediaResult, type MediaTask } from '../../src';
import { FileImage, RotateCcw, Settings2, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Field, FieldGroup, FieldLabel, FieldLegend, FieldSet } from '@/components/ui/field';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { Separator } from '@/components/ui/separator';
import { ComponentHeading, FeatureCards, PalettePicker, PreviewPanel, SettingsPanel, SettingSwitch } from './DemoUI';
import type { Mode } from './usePlaygroundTheme';

const media = (name: string) => `${import.meta.env.BASE_URL}media-workspace/${name}`;
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
    <DarlUIProvider theme={{ mode, primaryColor: color || undefined, radius: 10 }}>
      <MediaWorkspace accentColor={color || undefined} models={models} tasks={tasks} activeTaskId={active} onTaskChange={setActive} onCreateTask={() => { const task = { id: crypto.randomUUID(), title: '未命名任务', batches: [] }; setTasks((prev) => [...prev, task]); setActive(task.id); }} onRenameTask={(id, title) => setTasks((prev) => prev.map((task) => task.id === id ? { ...task, title } : task))} onGenerate={generate} onFavoriteChange={(batchId, resultId, favorited) => { update(batchId, resultId, { favorited }); setNotice(favorited ? '已收藏' : '已取消收藏'); }} onRegenerate={(batchId, resultId) => { const task = tasks.find((item) => item.batches.some((batch) => batch.id === batchId))!; const batch = task.batches.find((item) => item.id === batchId)!; setLastRequest({ taskId: task.id, modelId: batch.modelId, prompt: batch.prompt, references: batch.references, options: { ...batch.options, count: 1 } }); update(batchId, resultId, { status: 'queued', url: undefined, error: undefined }); schedule(batchId, resultId, batch.type ?? 'image', fail, ++regeneration.current); setNotice('正在重新生成这一张'); }} onRetry={(batchId, resultId) => { const batch = tasks.flatMap((task) => task.batches).find((item) => item.id === batchId)!; update(batchId, resultId, { status: 'queued', error: undefined }); schedule(batchId, resultId, batch.type ?? 'image', false, 0); }} onCancel={(batchId, resultId) => { const timer = timers.current.get(resultId); if (timer) clearTimeout(timer); timers.current.delete(resultId); update(batchId, resultId, { status: 'cancelled' }); }} />
    </DarlUIProvider>
    <div className="demo-media-notice" role="status">{notice}</div>
    <details className="demo-media-request"><summary>查看最近提交请求</summary><pre>{lastRequest ? JSON.stringify(lastRequest, (_key, value) => value instanceof File ? { name: value.name, type: value.type, size: value.size } : value, 2) : '填写提示词并点击生成后，查看能力过滤后的请求。'}</pre></details>
  </div>;
}

export function MediaWorkspaceDemo({ mode, color, onColorChange }: { mode: Mode; color: string; onColorChange: (color: string) => void }) {
  const [campaign, setCampaign] = useState(false);
  const [fail, setFail] = useState(false);
  const [reject, setReject] = useState(false);
  const [activeTab, setActiveTab] = useState('preview');
  const reset = () => { onColorChange(''); setCampaign(false); setFail(false); setReject(false); setActiveTab('preview'); };
  const code = `<DarlUIProvider theme={{ mode: '${mode}'${color ? `, primaryColor: '${color}'` : ''} }}>\n  <MediaWorkspace\n    models={models}\n    tasks={tasks}\n    onGenerate={handleGenerate}\n    onRetry={handleRetry}\n    onRegenerate={handleRegenerate}\n  />\n</DarlUIProvider>`;
  return <>
    <ComponentHeading title="MediaWorkspace" category="媒体组件" description="图片与视频生成工作台。通过模型能力驱动参数、素材和结果交互。" action={<Button variant="outline" onClick={reset}><RotateCcw data-icon="inline-start" />重置参数</Button>} />
    <FeatureCards features={[
      { title: '模型能力驱动', description: '参数和素材自动过滤', icon: Settings2 },
      { title: '图片 + 视频', description: '统一任务与批次管理', icon: FileImage },
      { title: '本地模拟环境', description: '不会上传你的素材', icon: ShieldCheck },
    ]} />
    <div className="demo-workspace demo-media-workspace-card">
      <PreviewPanel title="MediaWorkspace 预览" tab={activeTab} onTabChange={setActiveTab} code={code}>
        <DemoHost key={String(campaign)} campaign={campaign} mode={mode} color={color} fail={fail} reject={reject} />
      </PreviewPanel>
      <SettingsPanel title="演示参数"><FieldGroup>
        <FieldSet><FieldLegend variant="label">外观主题</FieldLegend><PalettePicker color={color} onChange={onColorChange} /></FieldSet>
        <Separator />
        <Field><FieldLabel htmlFor="media-host">演示场景</FieldLabel><NativeSelect id="media-host" className="w-full" value={campaign ? 'campaign' : 'studio'} onChange={(event) => setCampaign(event.target.value === 'campaign')}><NativeSelectOption value="studio">创作工作室 · 4 个模型</NativeSelectOption><NativeSelectOption value="campaign">品牌宣传 · 2 个模型</NativeSelectOption></NativeSelect></Field>
        <Separator />
        <FieldSet><FieldLegend variant="label">模拟行为</FieldLegend><FieldGroup>
          <SettingSwitch label="模拟结果失败" hint="最后一个结果会失败" checked={fail} onChange={setFail} />
          <SettingSwitch label="模拟提交失败" hint="验证错误处理路径" checked={reject} onChange={setReject} />
        </FieldGroup></FieldSet>
        <Separator />
        <FieldSet><FieldLegend variant="label">组件能力</FieldLegend><dl className="demo-media-capabilities"><dt>任务列表</dt><dd>支持</dd><dt>参考素材</dt><dd>图片 / 视频 / 音频</dd><dt>生成状态</dt><dd>排队 · 运行 · 失败</dd><dt>结果操作</dt><dd>复用 · 收藏 · 重试</dd></dl></FieldSet>
      </FieldGroup></SettingsPanel>
    </div>
    <section className="demo-docs"><h2>接入要点</h2><p>模型能力、任务数据、生成 API 与持久化由宿主网站控制。</p><Alert><ShieldCheck /><AlertTitle>本地演示</AlertTitle><AlertDescription>生成、失败、重试和取消均在浏览器内模拟，示例媒体为本地示意素材。</AlertDescription></Alert></section>
  </>;
}
