import { useState } from 'react';
import { Check, ListChecks, Settings2 } from 'lucide-react';
import { DefaultModelSelector, type DefaultModelOption, type DefaultModelSelection } from '../../src';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { ComponentHeading, PreviewPanel, SettingSwitch } from './DemoUI';

const initial: DefaultModelOption[] = [
  { id: 'deepseek', name: 'DeepSeek V4 Flash', type: 'text', description: 'deepseek-v4.1-flash' },
  { id: 'gpt-text', name: 'GPT Text', type: 'text', description: 'gpt-text' },
  { id: 'gpt-image', name: 'GPT Image 2', type: 'image', capabilities: { resolutions: ['1K', '2K', '4K'], aspectRatios: ['3:4', '4:3', '16:9', '9:16'] }, defaults: { resolution: '2K', aspectRatio: '9:16' } },
  { id: 'image-small', name: 'Image Lite', type: 'image', capabilities: { resolutions: ['1K'], aspectRatios: ['4:3', '9:16'] } },
  { id: 'audio-a', name: 'Audio Model A', type: 'audio', description: 'audio-a' },
  { id: 'audio-b', name: 'Audio Model B', type: 'audio', description: 'audio-b' },
  { id: 'h3-flash', name: 'MiniMax H3 Flash', type: 'video', capabilities: { resolutions: ['480P', '720P', '1080P'] }, defaults: { resolution: '720P', aspectRatio: '9:16' } },
  { id: 'h3-alt', name: 'Video 768P', type: 'video', capabilities: { resolutions: ['480P', '768P'], aspectRatios: ['16:9', '9:16'] }, defaults: { resolution: '768P', aspectRatio: '9:16' } },
];

export function DefaultModelSelectorDemo() {
  const [models, setModels] = useState(initial);
  const [open, setOpen] = useState(false);
  const [saved, setSaved] = useState<DefaultModelSelection | null>(null);
  const [activeTab, setActiveTab] = useState('preview');
  const code = `<DefaultModelSelector\n  open={open}\n  onOpenChange={setOpen}\n  models={models}\n  onComplete={saveDefaults}\n/>`;

  return <div>
    <ComponentHeading title="DefaultModelSelector" category="高级组件" description="用一个弹窗完成四类默认模型配置，模型数量多时使用下拉框选择。" />
    <div className="demo-workspace">
      <PreviewPanel title="DefaultModelSelector 预览" tab={activeTab} onTabChange={setActiveTab} code={code}>
        <div className="flex min-h-64 flex-col items-center justify-center gap-4 rounded-xl border border-dashed p-8 text-center">
          <div className="grid size-12 place-items-center rounded-full bg-muted"><ListChecks aria-hidden="true" /></div>
          <div><h2 className="font-semibold">配置默认模型</h2><p className="mt-1 text-sm text-muted-foreground">点击按钮打开四步模型选择弹窗。</p></div>
          <Button onClick={() => setOpen(true)}>打开默认模型选择器</Button>
          {saved && <p className="flex items-center gap-1 text-sm text-muted-foreground"><Check size={15} />已保存四类默认模型</p>}
        </div>
      </PreviewPanel>
      <Card className="demo-controls-pane">
        <CardHeader><CardTitle className="flex items-center gap-2"><Settings2 />演示参数</CardTitle><CardDescription>修改模型列表，观察弹窗中的下拉选项。</CardDescription></CardHeader>
        <CardContent className="space-y-4">
          <SettingSwitch label="提供 768P 视频模型" checked={models.some((item) => item.id === 'h3-alt')} onChange={(checked) => setModels((items) => checked ? [...items, initial.find((item) => item.id === 'h3-alt')!] : items.filter((item) => item.id !== 'h3-alt'))} />
          <Separator />
          <p className="text-xs text-muted-foreground">当前传入 {models.length} 个模型。组件只负责选择和回传配置，不调用模型接口。</p>
        </CardContent>
      </Card>
    </div>
    <DefaultModelSelector models={models} open={open} onOpenChange={setOpen} onComplete={(result) => { setSaved(result); setOpen(false); }} />
  </div>;
}
