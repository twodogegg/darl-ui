import { useState } from 'react';
import { Blocks, Bot, Monitor, Settings2, SlidersHorizontal, Sparkles } from 'lucide-react';
import { ModelSettingsCard, SettingsPage, type ModelProvider } from '../../src';

const initialProviders: ModelProvider[] = [{
  id: 'darl', name: 'Darl Gateway', baseUrl: 'https://api.darl.cn/v1', protocol: 'openai-completions', hasApiKey: true, status: 'connected', models: [
    { id: 'deepseek-v4.1-flash', name: 'DeepSeek V4 Flash', providerId: 'darl', type: 'text', reasoningEfforts: ['低', '中'], enabled: true },
    { id: 'gpt-image-2', name: 'GPT Image 2', providerId: 'darl', type: 'image', enabled: true },
    { id: 'minimax-h3-flash', name: 'MiniMax H3 Flash', providerId: 'darl', type: 'video', enabled: true },
  ],
}];

export function SettingsDemo() {
  const [providers, setProviders] = useState(initialProviders);
  const sections = [
    { id: 'general', label: '通用设置', icon: <Settings2 /> },
    { id: 'models', label: '模型', icon: <SlidersHorizontal /> },
    { id: 'applications', label: '应用 / MCP', icon: <Blocks /> },
    { id: 'skills', label: 'Skills', icon: <Sparkles /> },
    { id: 'agent-presets', label: 'Agent 预设', icon: <Bot /> },
    { id: 'desktop', label: '桌面设置', icon: <Monitor /> },
  ];
  return <SettingsPage sections={sections} activeSection="models" title="设置"><ModelSettingsCard providers={providers} onProviderSave={(provider) => setProviders((current) => [...current.filter((item) => item.id !== provider.id), provider])} onProviderDelete={(id) => setProviders((current) => current.filter((provider) => provider.id !== id))} onTestConnection={async () => undefined} onFetchModels={async (provider) => provider.models} /></SettingsPage>;
}
