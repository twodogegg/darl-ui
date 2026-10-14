import { useId, type ReactNode } from 'react';
import { Braces, Check, CheckCircle2, Code2, Palette, Play, Settings2, type LucideIcon } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, FieldContent, FieldDescription, FieldLabel } from '@/components/ui/field';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';

const palettes = [
  { label: '默认', color: '' },
  { label: '海洋蓝', color: '#2563eb' },
  { label: '梦幻紫', color: '#7c3aed' },
  { label: '森林绿', color: '#059669' },
  { label: '活力橙', color: '#ea580c' },
  { label: '玫瑰粉', color: '#db2777' },
  { label: '石墨黑', color: '#18181b' },
];

export function PalettePicker({ color, onChange }: { color: string; onChange: (color: string) => void }) {
  return <div className="demo-palette">
    <ToggleGroup type="single" value={color || 'default'} onValueChange={(value) => { if (value) onChange(value === 'default' ? '' : value); }} size="sm" spacing={1} variant="outline" aria-label="品牌色" className="flex-wrap">
      {palettes.map((palette) => <ToggleGroupItem key={palette.label} value={palette.color || 'default'} aria-label={palette.label} title={palette.label} className="px-1.5">
        <span className="demo-swatch" style={{ background: palette.color || 'var(--foreground)' }}>{color === palette.color && <Check aria-hidden="true" />}</span>
      </ToggleGroupItem>)}
    </ToggleGroup>
    <div className="demo-color-value"><span>主题色</span><code>{color.toUpperCase() || 'shadcn 默认'}</code></div>
  </div>;
}

export function SettingSwitch({ label, hint, checked, onChange }: { label: string; hint?: string; checked: boolean; onChange: (value: boolean) => void }) {
  const id = useId();
  return <Field orientation="horizontal">
    <FieldContent><FieldLabel htmlFor={id}>{label}</FieldLabel>{hint && <FieldDescription>{hint}</FieldDescription>}</FieldContent>
    <Switch id={id} checked={checked} onCheckedChange={onChange} />
  </Field>;
}

export function ComponentHeading({ title, description, category = '组件', action }: { title: string; description: string; category?: string; action?: ReactNode }) {
  return <div className="demo-heading"><div><p className="demo-eyebrow">{category}</p><div className="flex flex-wrap items-center gap-3"><h1>{title}</h1><Badge variant="secondary">v0.1</Badge></div><p className="demo-description">{description}</p></div>{action}</div>;
}

export function FeatureCards({ features }: { features: { title: string; description: string; icon: LucideIcon }[] }) {
  return <div className="demo-features">{features.map(({ title, description, icon: Icon }) => <Card key={title} size="sm"><CardHeader><CardTitle className="flex items-center gap-2"><Icon aria-hidden="true" />{title}</CardTitle><CardDescription>{description}</CardDescription></CardHeader></Card>)}</div>;
}

export function PreviewPanel({ title, code, children, tab, onTabChange, action }: { title: string; code: string; children: ReactNode; tab: string; onTabChange: (tab: string) => void; action?: ReactNode }) {
  return <Card className="demo-preview-pane">
    <Tabs value={tab} onValueChange={onTabChange} className="flex-1">
      <CardHeader><CardTitle className="sr-only">{title}</CardTitle><CardDescription className="sr-only">交互预览与 React 示例代码</CardDescription><div className="demo-preview-header">
        <TabsList><TabsTrigger value="preview"><Play data-icon="inline-start" />实时预览</TabsTrigger><TabsTrigger value="code"><Code2 data-icon="inline-start" />示例代码</TabsTrigger></TabsList>
        <Badge variant="outline" className="hidden sm:inline-flex">本地演示</Badge>
      </div></CardHeader>
      <TabsContent value="preview"><CardContent className="demo-preview-content">{children}</CardContent></TabsContent>
      <TabsContent value="code"><CardContent><div className="demo-code-heading"><span>React / TypeScript</span>{action}</div><pre className="demo-code"><code>{code}</code></pre></CardContent></TabsContent>
    </Tabs>
    <CardFooter className="flex-wrap gap-4"><span className="demo-compatibility"><CheckCircle2 />React 18 / 19</span><span className="demo-compatibility"><Braces />TypeScript</span><span className="demo-compatibility"><Palette />主题可配</span></CardFooter>
  </Card>;
}

export function SettingsPanel({ title = '组件参数', children }: { title?: string; children: ReactNode }) {
  return <Card className="demo-controls-pane"><CardHeader><CardTitle className="flex items-center gap-2"><Settings2 />{title}</CardTitle><CardDescription>调整参数，查看实时效果。</CardDescription></CardHeader><CardContent>{children}</CardContent></Card>;
}
