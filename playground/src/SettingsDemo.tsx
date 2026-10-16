import { useState } from 'react';
import { Blocks, Bot, Monitor, Settings2, SlidersHorizontal, Sparkles } from 'lucide-react';
import { AgentSettingsCard, ModelManagementCard, SettingsPage, defaultModelConfiguration, type ModelConfiguration, type ModelProvider } from '../../src';

import initialPrompt from '../../examples/agent-chat/prompts/system.md?raw';

const initialProviders: ModelProvider[] = [{
  id: 'darl', name: 'Darl Gateway', baseUrl: 'https://api.darl.cn/v1', protocol: 'openai-completions', hasApiKey: true, status: 'connected', models: [
    { id: 'deepseek-v4.1-flash', name: 'DeepSeek V4 Flash', providerId: 'darl', type: 'text', reasoningEfforts: ['低', '中'], enabled: true },
    { id: 'gpt-image-2', name: 'GPT Image 2', providerId: 'darl', type: 'image', enabled: true },
    { id: 'minimax-h3-flash', name: 'MiniMax H3 Flash', providerId: 'darl', type: 'video', enabled: true },
  ],
}];

export function SettingsDemo() {
  const [providers, setProviders] = useState(initialProviders);
  const [configuration, setConfiguration] = useState<ModelConfiguration>(() => defaultModelConfiguration());
  const [activeSection, setActiveSection] = useState('models');
  const [systemPrompt, setSystemPrompt] = useState(initialPrompt);
  const sections = [
    { id: 'general', label: '通用设置', icon: <Settings2 /> },
    { id: 'models', label: '模型', icon: <SlidersHorizontal /> },
    { id: 'applications', label: '应用 / MCP', icon: <Blocks /> },
    { id: 'skills', label: 'Skills', icon: <Sparkles /> },
    { id: 'agent-presets', label: 'Agent 预设', icon: <Bot /> },
    { id: 'desktop', label: '桌面设置', icon: <Monitor /> },
  ];
  return <SettingsPage sections={sections} activeSection={activeSection} onSectionChange={(section) => { if (section === 'models' || section === 'agent-presets') setActiveSection(section); }} title="设置">{activeSection === 'agent-presets' ? <><AgentSettingsCard systemPrompt={systemPrompt} onSave={setSystemPrompt} /><p className="demo-mock-hint">本地编辑演示，仅保存在当前页面内存中。真实 Markdown 文件编辑请使用 Agent Chat 示例。</p></> : <ModelManagementCard configuration={configuration} providers={providers} onSave={setConfiguration} onProviderSave={(provider) => setProviders((current) => [...current.filter((item) => item.id !== provider.id), provider])} onProviderDelete={(id) => setProviders((current) => current.filter((provider) => provider.id !== id))} onTestConnection={async () => undefined} />}</SettingsPage>;
}
