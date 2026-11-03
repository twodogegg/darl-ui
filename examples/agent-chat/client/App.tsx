import { useEffect, useState } from 'react';
import { DefaultModelSelector, DarlUIProvider, ModelManagementCard, PromptSettingsCard, SettingsPage, SkillManager, defaultModelConfiguration, toAgentModels, toMediaModels, type AgentModelConfig, type AgentApplication, type AgentSkill, type DefaultModelDraft, type DefaultModelOption, type DefaultModelSelection, type ModelConfiguration, type ModelProvider, type PromptSettingsPrompts } from '@darl/ui';
import { ArrowLeft, Blocks, Bot, Database, FileText, History, MessageSquare, Settings2, Sparkles, Wrench } from 'lucide-react';
import { StudioApp } from './studio/StudioApp';
import { PromptOptimizationSettings } from './PromptOptimizationSettings';
import { MediaConcurrencySettings } from './MediaConcurrencySettings';
import { MediaGenerationPage } from './MediaGenerationPage';
import { McpSettings } from './McpSettings';
import { ToolsSettings } from './ToolsSettings';
import { WorkflowAgentSettings } from './WorkflowAgentSettings';
import { StorageSettings } from './StorageSettings';
import { RequestRecordsPage } from './RequestRecordsPage';
import { useFishVoice, VoiceSettings } from './VoiceSettings';

const defaultMediaModels: DefaultModelOption[] = [
  { id: 'gpt-image-2', name: 'GPT Image 2', type: 'image', description: '图片生成模型', capabilities: { resolutions: ['1K', '2K', '4K'], aspectRatios: ['1:1', '2:3', '3:2', '3:4', '4:3', '9:16', '16:9'] }, defaults: { resolution: '2K', aspectRatio: '16:9' } },
  { id: 'gpt-image-2.5', name: 'GPT Image 2.5', type: 'image', description: '图片生成模型', capabilities: { resolutions: ['1K', '2K', '4K'], aspectRatios: ['1:1', '2:3', '3:2', '3:4', '4:3', '9:16', '16:9'] }, defaults: { resolution: '2K', aspectRatio: '16:9' } },
  { id: 'gemini-3-pro-image-preview', name: 'Gemini 3 Pro Image Preview', type: 'image', description: '图片生成模型', capabilities: { resolutions: ['1K', '2K', '4K'], aspectRatios: ['1:1', '2:3', '3:2', '3:4', '4:3', '9:16', '16:9'] }, defaults: { resolution: '2K', aspectRatio: '16:9' } },
  { id: 'minimax-h3-flash', name: 'MiniMax H3 Flash', type: 'video', description: '快速视频生成模型', capabilities: { resolutions: ['480P', '768P', '1080P'], aspectRatios: ['adaptive', '21:9', '16:9', '4:3', '1:1', '3:4', '9:16'] }, defaults: { resolution: '480P', aspectRatio: '16:9' } },
  { id: 'minimax-h3-standard', name: 'MiniMax H3 Standard', type: 'video', description: '标准视频生成模型', capabilities: { resolutions: ['480P', '768P'], aspectRatios: ['adaptive', '21:9', '16:9', '4:3', '1:1', '3:4', '9:16'] }, defaults: { resolution: '768P', aspectRatio: '16:9' } },
  { id: 'h3-nsfw', name: 'H3 NSFW', type: 'video', description: '使用原提示词', capabilities: { resolutions: ['480P', '768P', '1080P'], aspectRatios: ['16:9', '9:16'] }, defaults: { resolution: '480P', aspectRatio: '16:9' } },
  { id: 'h3-nsfw-opt', name: 'H3 NSFW（提示词优化）', type: 'video', description: '自动优化提示词', capabilities: { resolutions: ['480P', '768P', '1080P'], aspectRatios: ['16:9', '9:16'] }, defaults: { resolution: '480P', aspectRatio: '16:9' } },
];
const initialDefaultMediaSelection: DefaultModelDraft = {
  image: { modelId: 'gpt-image-2', resolution: '2K', aspectRatio: '16:9' },
  video: { modelId: 'minimax-h3-flash', resolution: '480P', aspectRatio: '16:9' },
};
async function api<T>(path: string, body?: unknown, method = body ? 'POST' : 'GET'): Promise<T> {
  let response: Response;
  try { response = await fetch(`/api/${path}`, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, ...(body ? { body: JSON.stringify(body) } : {}) }); }
  catch { throw new Error('无法连接 Agent 服务，请确认本地 5197 服务已启动'); }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof data.error === 'string' ? data.error : data.error?.message || `请求失败：HTTP ${response.status}`);
  return data;
}

export function App() {
  const fishVoice = useFishVoice();
  const [skills, setSkills] = useState<AgentSkill[]>([]);
  const [providers, setProviders] = useState<ModelProvider[]>([]);
  const [modelConfiguration, setModelConfiguration] = useState<ModelConfiguration>(() => defaultModelConfiguration());
  const [applications, setApplications] = useState<AgentApplication[]>([]);
  const [applicationRevision, setApplicationRevision] = useState(0);
  const [prompts, setPrompts] = useState<PromptSettingsPrompts>({ system: '', voice: '' });
  const [defaultMediaSelection, setDefaultMediaSelection] = useState<DefaultModelDraft>(initialDefaultMediaSelection);
  const [defaultMediaModelsOpen, setDefaultMediaModelsOpen] = useState(false);
  const [skillManagerOpen, setSkillManagerOpen] = useState(false);
  const [settingsSection, setSettingsSection] = useState('models');
  const [workflowSettingsKind, setWorkflowSettingsKind] = useState<'analyze' | 'novel-outline' | 'novel-script'>('analyze');
  const [page, setPage] = useState<'studio' | 'settings' | 'media'>('studio');
  const [returnPage, setReturnPage] = useState<'studio' | 'media'>('studio');
  const [mediaTaskToOpen, setMediaTaskToOpen] = useState<string>();
  const [error, setError] = useState('');
  const models = toAgentModels(modelConfiguration, providers).filter(model => model.type === 'text' && model.enabled !== false);

  useEffect(() => {
    let active = true;
    const load = <T,>(path: string, setter: (value: T) => void) => api<T>(path).then(value => { if (active) setter(value); }).catch(reason => { if (active) setError(reason.message); });
    void load('providers', setProviders);
    void load('skills?summary=1', setSkills);
    void load('model-config', setModelConfiguration);
    void load('prompts', setPrompts);
    void load('default-models', setDefaultMediaSelection);
    return () => { active = false; };
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/applications${applicationRevision ? '?refresh=1' : ''}`, { signal: controller.signal }).then(async response => {
      const value = await response.json();
      if (!response.ok) throw new Error(value.error || '应用加载失败');
      if (!controller.signal.aborted) setApplications(value);
    }).catch(reason => { if (!controller.signal.aborted) setError(reason.message); });
    return () => controller.abort();
  }, [applicationRevision]);
  const saveSkill = async (skill: AgentSkill) => setSkills(await api<AgentSkill[]>('skills?summary=1', { skill }));
  const buttonClass = 'darl-button darl-button--outline darl-button-size--default';
  const showSettings = () => { setReturnPage(page === 'media' ? 'media' : 'studio'); setPage('settings'); };
  const studioNavigate = (target: string) => {
    if (target === 'workflow-agents' || target === 'workflow-outline-agent') {
      setWorkflowSettingsKind(target === 'workflow-outline-agent' ? 'novel-outline' : 'novel-script');
      setSettingsSection('workflow-agents');
    }
    if (target === 'settings' || target === 'workflow-agents' || target === 'workflow-outline-agent') showSettings();
  };
  const saveDefaultMediaModels = async (selection: DefaultModelSelection) => {
    setDefaultMediaSelection(await api<DefaultModelDraft>('default-models', { selection }));
    setDefaultMediaModelsOpen(false);
    window.dispatchEvent(new Event('studio-defaults-changed'));
  };
  return <DarlUIProvider theme={{ mode: 'dark', primaryColor: '#8ba4c5' }} className="chat-example">
    <div className="example-page">
      {(error || fishVoice.error) && <p className="example-error" role="alert">{error || fishVoice.error}</p>}
      <div hidden={page !== 'studio'}><StudioApp onNavigate={studioNavigate} models={[...models, ...toMediaModels(modelConfiguration)]} /></div>
      {page === 'media' && <MediaGenerationPage initialTaskId={mediaTaskToOpen} onBack={() => { setMediaTaskToOpen(undefined); setPage('studio'); }} />}
      {page === 'settings' && <main className="example-settings"><button className={buttonClass} onClick={() => setPage(returnPage)}><ArrowLeft size={15} />{returnPage === 'studio' ? '返回短剧工作台' : '返回媒体生成'}</button>
        <SettingsPage title="设置" activeSection={settingsSection} onSectionChange={setSettingsSection} sections={[{ id: 'models', label: '模型', icon: <Settings2 /> }, { id: 'requests', label: '请求记录', icon: <History /> }, { id: 'prompts', label: '提示词', icon: <FileText /> }, { id: 'voice', label: '语音', icon: <MessageSquare /> }, { id: 'storage', label: '存储', icon: <Database /> }, { id: 'tools', label: 'Tools', icon: <Wrench /> }, { id: 'skills', label: 'Skills', icon: <Sparkles /> }, { id: 'workflow-agents', label: '工作流 Agents', icon: <Bot /> }, { id: 'applications', label: '应用 / MCP', icon: <Blocks /> }]}>
          {settingsSection === 'requests' ? <RequestRecordsPage onOpenTask={id => { setMediaTaskToOpen(id); setPage('media'); }} /> :
           settingsSection === 'prompts' ? <PromptSettingsCard visibleKeys={['optimization', 'h3Optimization']} prompts={prompts} onSave={async patch => setPrompts(await api<PromptSettingsPrompts>('prompts', patch))} /> :
           settingsSection === 'workflow-agents' ? <WorkflowAgentSettings initialKind={workflowSettingsKind} /> :
           settingsSection === 'voice' ? <VoiceSettings settings={fishVoice.settings} onSave={fishVoice.save} /> :
           settingsSection === 'storage' ? <StorageSettings /> :
           settingsSection === 'tools' ? <ToolsSettings /> :
           settingsSection === 'applications' ? <McpSettings applications={applications} onChanged={() => setApplicationRevision(value => value + 1)} /> :
           settingsSection === 'skills' ? <section className="example-skills-settings"><header><div><span className="example-eyebrow">SKILL LIBRARY</span><h2>Skills</h2><p>管理工作流可使用的 Skills。</p></div><button className={buttonClass} onClick={() => setSkillManagerOpen(true)}><Sparkles size={15} />管理 Skills</button></header><div className="example-skills-settings-summary"><strong>{skills.length} 个 Skill</strong></div>{skillManagerOpen && <SkillManager open skills={skills} onClose={() => setSkillManagerOpen(false)} onImport={saveSkill} onSave={saveSkill} loadSkill={skill => api<AgentSkill>(`skills/${encodeURIComponent(skill.id)}`)} onDelete={async id => setSkills(await api<AgentSkill[]>(`skills/${encodeURIComponent(id)}?summary=1`, undefined, 'DELETE'))} onFavoriteChange={async (id, favorite) => { const skill = skills.find(item => item.id === id); if (skill) await saveSkill({ ...(skill.instructions !== undefined ? skill : await api<AgentSkill>(`skills/${encodeURIComponent(id)}`)), favorite }); }} />}</section> :
           <div className="example-model-settings"><section className="example-default-models"><header><div><span className="example-eyebrow">DEFAULT MEDIA MODELS</span><h2>默认模型</h2><p>为网站设置默认图片和视频模型。</p></div><button className={buttonClass} onClick={() => setDefaultMediaModelsOpen(true)}><Settings2 size={15} />配置默认模型</button></header><div className="example-default-model-grid"><div><span>图片</span><strong>{defaultMediaSelection.image?.modelId || '未设置'} · {defaultMediaSelection.image?.resolution || '—'} · {defaultMediaSelection.image?.aspectRatio || '—'}</strong></div><div><span>视频</span><strong>{defaultMediaSelection.video?.modelId || '未设置'} · {defaultMediaSelection.video?.resolution || '—'} · {defaultMediaSelection.video?.aspectRatio || '—'}</strong></div></div></section><DefaultModelSelector models={defaultMediaModels} kinds={['image', 'video']} value={defaultMediaSelection} onChange={setDefaultMediaSelection} open={defaultMediaModelsOpen} onOpenChange={setDefaultMediaModelsOpen} onComplete={saveDefaultMediaModels} /><PromptOptimizationSettings models={models} /><MediaConcurrencySettings /><ModelManagementCard configuration={modelConfiguration} providers={providers} onSave={async configuration => setModelConfiguration(await api<ModelConfiguration>('model-config', { configuration }))} onProviderSave={async (provider, apiKey) => setProviders(await api<ModelProvider[]>('providers', { provider, apiKey }))} onProviderDelete={async id => setProviders(await api<ModelProvider[]>(`providers/${id}`, undefined, 'DELETE'))} onFetchModels={(provider, apiKey) => api<AgentModelConfig[]>('providers/models', { provider, ...(apiKey ? { apiKey } : {}) })} onTestConnection={async provider => setProviders(await api<ModelProvider[]>(`providers/${provider.id}/test`, {}))} /></div>}
        </SettingsPage></main>}
    </div>
  </DarlUIProvider>;
}
