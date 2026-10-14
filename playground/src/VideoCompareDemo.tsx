import { useEffect, useRef, useState } from 'react';
import { Info, Plus, Trash2 } from 'lucide-react';
import { DarlUIProvider, VideoCompare, type CompareVideo, type VideoCompareLayout } from '../../src';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { ComponentHeading } from './DemoUI';

interface Props { mode: 'light' | 'dark'; color: string }

export function VideoCompareDemo({ mode, color }: Props) {
  const [videos, setVideos] = useState<CompareVideo[]>([]);
  const [best, setBest] = useState<string | null>(null);
  const [sound, setSound] = useState<string | null | undefined>(undefined);
  const [layout, setLayout] = useState<VideoCompareLayout>('auto');
  const [message, setMessage] = useState('');
  const objects = useRef(new Set<string>());
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => () => {
    objects.current.forEach((url) => URL.revokeObjectURL(url));
    objects.current.clear();
  }, []);
  const remove = (id: string) => {
    setVideos((old) => {
      const item = old.find((video) => video.id === id);
      if (item) { URL.revokeObjectURL(item.src); objects.current.delete(item.src); }
      return old.filter((video) => video.id !== id);
    });
    if (best === id) setBest(null);
    if (sound === id) setSound(undefined);
  };
  const add = (files: FileList | null) => {
    if (!files?.length) return;
    const available = Math.max(0, 3 - videos.length);
    const valid = Array.from(files).filter((file) => file.type.startsWith('video/') || /\.(mp4|webm|mov|m4v|ogg)$/i.test(file.name));
    const accepted = valid.slice(0, available);
    setMessage(accepted.length < files.length ? '只支持视频文件，且最多同时对比 3 个。' : '');
    if (accepted.length) {
      const entries = accepted.map((file) => {
        const src = URL.createObjectURL(file);
        objects.current.add(src);
        return { id: crypto.randomUUID(), name: file.name, src };
      });
      setVideos((old) => [...old, ...entries].slice(0, 3));
    }
    if (input.current) input.current.value = '';
  };
  const reset = () => { videos.forEach((item) => { URL.revokeObjectURL(item.src); objects.current.delete(item.src); }); setVideos([]); setBest(null); setSound(undefined); setMessage(''); };
  const code = `import { VideoCompare } from '@darl/ui';\nimport '@darl/ui/styles.css';\n\n<VideoCompare\n  videos={[\n    { id: 'a', name: '版本 A', src: '/video-a.mp4' },\n    { id: 'b', name: '版本 B', src: '/video-b.mp4' },\n  ]}\n  layout="auto"\n  bestVideoId={bestId}\n  onBestChange={setBestId}\n  onAudioSourceChange={(id) => console.log(id)}\n/>`;
  return <div className="demo-video-page">
    <ComponentHeading title="VideoCompare" category="媒体组件" description="最多 3 个视频，一条时间轴同步对比；横屏上下，竖屏左右，并且可以选定最佳版本。" />
    <div className="demo-video-toolbar">
      <input ref={input} type="file" accept="video/*,.m4v,.mov" multiple hidden aria-label="选择本地对比视频" onChange={(event) => add(event.target.files)}/>
      <Button disabled={videos.length >= 3} onClick={() => input.current?.click()}><Plus data-icon="inline-start" />添加本地视频（{videos.length}/3）</Button>
      <FieldGroup className="w-56"><Field orientation="horizontal"><FieldLabel htmlFor="video-layout">排列方式</FieldLabel><NativeSelect id="video-layout" value={layout} onChange={(event) => setLayout(event.target.value as VideoCompareLayout)}><NativeSelectOption value="auto">自动按画幅</NativeSelectOption><NativeSelectOption value="vertical">上下排列</NativeSelectOption><NativeSelectOption value="horizontal">左右排列</NativeSelectOption></NativeSelect></Field></FieldGroup>
      <Button variant="outline" onClick={reset} disabled={!videos.length}><Trash2 data-icon="inline-start" />清空</Button>
    </div>
    {message && <Alert variant="destructive" className="mb-4"><AlertDescription>{message}</AlertDescription></Alert>}
    <Card><CardHeader><CardTitle>视频对比</CardTitle><CardDescription>选择 2–3 个本地视频，体验同步播放与最佳版本选择。</CardDescription></CardHeader><CardContent>
      <DarlUIProvider theme={{ mode, primaryColor: color || undefined, radius: 10 }}>
        <VideoCompare videos={videos} layout={layout} bestVideoId={best} onBestChange={setBest} audioSourceId={sound} onAudioSourceChange={setSound} onRemove={remove} onError={(id, error) => setMessage(`视频 ${id.slice(0, 6)}：${error.message}`)}/>
      </DarlUIProvider>
      <div className="demo-video-status"><Info size={15}/> 全部使用浏览器本地文件 URL，无需服务器；最佳版本：<b>{videos.find((item) => item.id === best)?.name ?? '未选择'}</b></div>
    </CardContent></Card>
    <section className="demo-docs"><h2>React 使用示例</h2><p>业务系统通过 <code>onBestChange</code> 获取最佳版本 ID，自行保存选择。</p><pre className="demo-code"><code>{code}</code></pre></section>
  </div>;
}
