import { useState } from 'react';
import { Blocks, History, Monitor, Settings2, SlidersHorizontal, Sparkles } from 'lucide-react';
import { DefaultModelSelector, ModelManagementCard, SettingsPage, defaultModelConfiguration, type DefaultModelDraft, type DefaultModelOption, type ModelConfiguration, type ModelProvider } from '../../src';

import { RequestRecordsDemo } from './RequestRecordsDemo';
import { Button } from '@/components/ui/button';

const initialProviders: ModelProvider[] = [{
  id: 'darl', name: 'Darl Gateway', baseUrl: 'https://api.darl.cn/v1', protocol: 'openai-completions', hasApiKey: true, status: 'connected', models: [
    { id: 'deepseek-v4.1-flash', name: 'DeepSeek V4 Flash', providerId: 'darl', type: 'text', reasoningEfforts: ['低', '中'], enabled: true },
    { id: 'gpt-image-2', name: 'GPT Image 2', providerId: 'darl', type: 'image', enabled: true },
    { id: 'gpt-image-2.5-sunburst', name: 'GPT Image 2.5', providerId: 'darl', type: 'image', enabled: true },
    { id: 'gemini-3-pro-image-preview', name: 'Gemini 3 Pro Image Preview', providerId: 'darl', type: 'image', enabled: true },
    { id: 'minimax-h3-flash', name: 'MiniMax H3 Flash', providerId: 'darl', type: 'video', enabled: true },
  ],
}];

const defaultModels: DefaultModelOption[] = [
  { id: 'gpt-image-2', name: 'GPT Image 2', type: 'image', capabilities: { resolutions: ['1K', '2K'], aspectRatios: ['1:1', '16:9'] }, defaults: { resolution: '2K', aspectRatio: '16:9' } },
  { id: 'minimax-h3-flash', name: 'MiniMax H3 Flash', type: 'video', capabilities: { resolutions: ['480P', '768P'], aspectRatios: ['9:16', '16:9'] }, defaults: { resolution: '480P', aspectRatio: '16:9' } },
];

export function SettingsDemo() {
  const [providers, setProviders] = useState(initialProviders);
  const [configuration, setConfiguration] = useState<ModelConfiguration>(() => defaultModelConfiguration());
  const [activeSection, setActiveSection] = useState('models');
  const [defaultOpen, setDefaultOpen] = useState(false);
  const [defaults, setDefaults] = useState<DefaultModelDraft>({});
  const sections = [
    { id: 'general', label: '通用设置', icon: <Settings2 /> },
    { id: 'models', label: '模型', icon: <SlidersHorizontal /> },
    { id: 'requests', label: '请求记录', icon: <History /> },
    { id: 'applications', label: '应用 / MCP', icon: <Blocks /> },
    { id: 'skills', label: 'Skills', icon: <Sparkles /> },
    { id: 'desktop', label: '桌面设置', icon: <Monitor /> },
  ];
  return <SettingsPage sections={sections} activeSection={activeSection} onSectionChange={(section) => { if (section === 'models' || section === 'requests') setActiveSection(section); }} title="设置">{activeSection === 'requests' ? <RequestRecordsDemo /> : <><Button variant="outline" onClick={() => setDefaultOpen(true)}>默认模型</Button><DefaultModelSelector models={defaultModels} kinds={['image', 'video']} value={defaults} onChange={setDefaults} open={defaultOpen} onOpenChange={setDefaultOpen} onComplete={selection => { setDefaults(selection); setDefaultOpen(false); }} /><ModelManagementCard configuration={configuration} providers={providers} onSave={setConfiguration} onProviderSave={(provider) => setProviders((current) => [...current.filter((item) => item.id !== provider.id), provider])} onProviderDelete={(id) => setProviders((current) => current.filter((provider) => provider.id !== id))} onTestConnection={async () => undefined} /></>}</SettingsPage>;
}
