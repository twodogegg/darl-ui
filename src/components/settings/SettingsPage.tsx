import { useState } from 'react';
import { Bot, Blocks, Monitor, Settings2, SlidersHorizontal, Sparkles } from 'lucide-react';
import { Button } from '../ui/Button';
import type { SettingsPageProps } from './types';
import './settings.css';

const defaultSections = [
  { id: 'general', label: '通用设置', icon: <Settings2 /> },
  { id: 'models', label: '模型', icon: <SlidersHorizontal /> },
  { id: 'applications', label: '应用 / MCP', icon: <Blocks /> },
  { id: 'skills', label: 'Skills', icon: <Sparkles /> },
  { id: 'agent-presets', label: 'Agent 预设', icon: <Bot /> },
  { id: 'desktop', label: '桌面设置', icon: <Monitor /> },
];

export function SettingsPage({ activeSection: controlledSection, onSectionChange, sections = defaultSections, title = '设置', children, className = '' }: SettingsPageProps) {
  const [localSection, setLocalSection] = useState(sections[0]?.id || 'general');
  const activeSection = controlledSection ?? localSection;
  const changeSection = (id: string) => { setLocalSection(id); onSectionChange?.(id); };
  return <section className={`darl-settings-page ${className}`} aria-label={title}>
    <header className="darl-settings-header"><h1>{title}</h1></header>
    <div className="darl-settings-layout">
      <nav className="darl-settings-nav" aria-label="设置导航">{sections.map((section) => <Button key={section.id} variant={section.id === activeSection ? 'secondary' : 'ghost'} className="darl-settings-nav-item" aria-current={section.id === activeSection ? 'page' : undefined} onClick={() => changeSection(section.id)}>{section.icon}<span>{section.label}</span></Button>)}</nav>
      <div className="darl-settings-content">{children || <div className="darl-settings-empty">选择左侧设置项开始配置。</div>}</div>
    </div>
  </section>;
}
