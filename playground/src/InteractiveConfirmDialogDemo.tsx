import { useState } from 'react';
import { InteractiveConfirmDialog, type ConfirmAnswers, type ConfirmDialogTheme, type ConfirmQuestion } from '../../src';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ComponentHeading } from './DemoUI';

const questions: ConfirmQuestion[] = [
  { id: 'duration', label: '目标成片时长', type: 'single', required: true, defaultValue: '6m', options: [
    { value: '3-4m', label: '3–4 分钟（紧凑版）' },
    { value: '6m', label: '6 分钟（推荐，保留情绪铺垫）' },
    { value: '8-10m', label: '8–10 分钟（更充分的情绪与人物刻画）' },
  ] },
  { id: 'adaptation', label: '改编方向', type: 'single', required: true, defaultValue: 'faithful', options: [
    { value: 'faithful', label: '忠实原著，适度影视化' },
    { value: 'strict', label: '严格还原原著情节和对白' },
    { value: 'dramatic', label: '允许增强戏剧冲突和人物互动' },
  ] },
  { id: 'flashback', label: '昔日天才经历的表现方式', type: 'single', required: true, defaultValue: 'brief', options: [
    { value: 'brief', label: '短暂回忆画面' },
    { value: 'present', label: '不使用回忆，全部通过当下场景交代' },
  ] },
  { id: 'notes', label: '其他修改要求（可选）', type: 'textarea', placeholder: '例如：保留全部原著关键台词、不要新增人物……' },
];

/** 两种渲染环境：跟随 Playground 的 Provider，或模拟没有 Provider 的深色宿主，用于验证回退。 */
type Host = 'provider' | 'host';

export function InteractiveConfirmDialogDemo() {
  const [open, setOpen] = useState(false);
  const [host, setHost] = useState<Host>('provider');
  const [theme, setTheme] = useState<'' | ConfirmDialogTheme>('');
  const [answer, setAnswer] = useState<ConfirmAnswers | null>(null);
  const [fail, setFail] = useState(false);
  const dialog = <InteractiveConfirmDialog
    open={open} onOpenChange={setOpen} title="六、确认本次改编方案" questions={questions}
    theme={theme || undefined}
    confirmText="确认方案，开始正式剧本写作"
    onConfirm={async (result) => {
      if (fail) throw new Error('模拟提交失败，请检查后重试');
      setAnswer(result); setOpen(false);
    }}
  />;
  return <div>
    <ComponentHeading title="InteractiveConfirmDialog" category="交互组件" description="问题、选项、默认值和按钮均由宿主传入；适合 Agent 在执行工作流前向用户确认。明暗外观跟随 DarlUIProvider，没有 Provider 时跟随宿主的 color-scheme。" />
    <div className="demo-workspace">
      <Card><CardHeader><CardTitle>改编方案确认 · 实际交互</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">点击打开弹窗，选择答案后查看完整回调结果；勾选测试项可验证异步失败保留选择。</p>
          <Button onClick={() => setOpen(true)}>打开确认弹窗</Button>
          <div className="flex flex-wrap items-center gap-4 text-sm">
            <label className="flex items-center gap-2"><input type="checkbox" checked={host === 'host'} onChange={(e) => setHost(e.target.checked ? 'host' : 'provider')} />模拟未接入 Provider 的深色宿主</label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={fail} onChange={(e) => setFail(e.target.checked)} />模拟提交失败</label>
            <label className="flex items-center gap-2">外观覆盖
              <select className="rounded-md border bg-background px-2 py-1" value={theme} onChange={(e) => setTheme(e.target.value as '' | ConfirmDialogTheme)} aria-label="外观覆盖">
                <option value="">跟随宿主</option>
                <option value="dark">强制深色</option>
                <option value="light">强制浅色</option>
              </select>
            </label>
          </div>
          {answer && <pre className="max-w-full overflow-auto rounded-lg border p-4 text-xs" aria-label="确认回调结果">{JSON.stringify(answer, null, 2)}</pre>}
        </CardContent>
      </Card>
    </div>
    {host === 'host' && <div className="darl-confirm-host-demo" style={{ colorScheme: 'dark', background: '#101113', color: '#e7e8eb', borderColor: '#2d3036' }}>
      <span>这个深色容器没有 DarlUIProvider，也没有 --darl-* / --background 变量，弹窗应保持深色而不是纯白。</span>
    </div>}
    {dialog}
  </div>;
}
