import { useState, type ReactNode } from 'react';
import { Bot, Component, FileImage, Github, Layers3, LayoutPanelTop, Menu, Moon, Palette, Play, Settings, Sun, Upload, ListChecks } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import type { Mode } from './usePlaygroundTheme';

export type Page = 'intro' | 'theme' | 'uploader' | 'video' | 'media' | 'styles' | 'agent' | 'settings' | 'confirm-dialog';
const pages = [
  { id: 'intro', label: '概览', title: 'Introduction', icon: LayoutPanelTop },
  { id: 'theme', label: '主题系统', title: 'Theme', icon: Palette },
  { id: 'uploader', label: 'FileUploader', title: 'FileUploader', icon: Upload },
  { id: 'video', label: 'VideoCompare', title: 'VideoCompare', icon: Play },
  { id: 'media', label: 'MediaWorkspace', title: 'MediaWorkspace', icon: FileImage },
  { id: 'styles', label: 'StyleSelector', title: 'StyleSelector', icon: Palette },
  { id: 'agent', label: 'AgentSidebar', title: 'AgentSidebar', icon: Bot },
  { id: 'settings', label: 'SettingsPage', title: 'SettingsPage', icon: Settings },
  { id: 'confirm-dialog', label: 'InteractiveConfirmDialog', title: 'InteractiveConfirmDialog', icon: ListChecks },
] as const;

export function DemoLayout({ selected, onNavigate, mode, onModeChange, children }: {
  selected: Page; onNavigate: (page: Page) => void; mode: Mode; onModeChange: (mode: Mode) => void; children: ReactNode;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const navigate = (page: Page) => { onNavigate(page); setMenuOpen(false); };
  const navigation = <nav aria-label="组件导航" className="demo-navigation">
    <p className="demo-nav-caption">开始使用</p>
    {pages.map((page, index) => <div key={page.id}>
      {index === 2 && <p className="demo-nav-caption mt-6">组件 <Badge variant="secondary">7</Badge></p>}
      <Button variant={selected === page.id ? 'secondary' : 'ghost'} className="w-full justify-start" aria-current={selected === page.id ? 'page' : undefined} onClick={() => navigate(page.id)}>
        <page.icon data-icon="inline-start" />{page.label}
      </Button>
    </div>)}
    <p className="demo-nav-caption mt-6">即将推出</p>
    <Button variant="ghost" disabled className="w-full justify-start"><FileImage data-icon="inline-start" />ImageViewer</Button>
    <Button variant="ghost" disabled className="w-full justify-start"><Layers3 data-icon="inline-start" />AssetPicker</Button>
  </nav>;

  return <div className="demo-shell">
    <aside className="demo-sidebar">
      <a href="#" className="demo-brand" onClick={(event) => { event.preventDefault(); navigate('intro'); }} aria-label="darl ui 概览">
        <Component aria-hidden="true" /><span>darl ui</span><Badge variant="outline">v0.1</Badge>
      </a>
      <Separator />
      {navigation}
      <div className="demo-sidebar-bottom"><Separator /><p>为 React 项目构建<br /><span>轻量、可复用、可定制。</span></p></div>
    </aside>
    <main className="demo-main" id="main-content">
      <header className="demo-topbar">
        <div className="flex min-w-0 items-center gap-3">
          <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
            <SheetTrigger asChild><Button variant="ghost" size="icon" className="md:hidden" aria-label="打开导航菜单"><Menu /></Button></SheetTrigger>
            <SheetContent side="left" className="w-72">
              <SheetHeader><SheetTitle>darl ui</SheetTitle><SheetDescription>组件实验室</SheetDescription></SheetHeader>
              {navigation}
            </SheetContent>
          </Sheet>
          <div className="demo-breadcrumb"><span className="hidden sm:inline">组件实验室 <span className="mx-2">/</span></span><strong>{pages.find((page) => page.id === selected)?.title}</strong></div>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="hidden sm:inline-flex">React 18 / 19</Badge>
          <Button variant="ghost" size="icon" onClick={() => onModeChange(mode === 'light' ? 'dark' : 'light')} title={mode === 'light' ? '切换到黑夜' : '切换到白天'} aria-label={mode === 'light' ? '切换到黑夜' : '切换到白天'}>{mode === 'light' ? <Moon /> : <Sun />}</Button>
          <Button asChild variant="ghost" size="icon"><a href="https://github.com/twodogegg/darl-ui" target="_blank" rel="noreferrer" aria-label="GitHub 仓库"><Github /></a></Button>
        </div>
      </header>
      <div className="demo-content">{children}</div>
      <footer className="demo-footer"><span>darl-ui © 2026</span><span>React · shadcn/ui</span></footer>
    </main>
  </div>;
}
