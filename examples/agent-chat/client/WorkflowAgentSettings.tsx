import { useEffect, useState } from 'react';
import { Field, FieldDescription, FieldLabel, NativeSelect, Textarea } from '../../../src/components/ui/FormControls';

type Kind = 'analyze' | 'write-script' | 'extract-assets' | 'storyboard' | 'video-prompts' | 'novel-outline' | 'novel-script' | 'script-assets' | 'script-storyboard';
type Config = { kind: Kind; model: string; formatterModel: string; instructions: string; skillIds: string[]; toolNames: string[] };
type Skill = { id: string; name: string };
type Tool = { name: string; title?: string; risk?: string };
type ModelOption = { id: string; name: string };
type ModelOptions = { text: ModelOption[]; videoAnalysis: ModelOption[]; analysisConfigured: boolean };
const labels: Record<Kind, string> = { analyze: '视频分析', 'write-script': '转绘剧本编写', 'extract-assets': '转绘资产提取', storyboard: '转绘正式分镜', 'video-prompts': '转绘视频提示词拆分', 'novel-outline': '小说转大纲', 'novel-script': '小说转剧本', 'script-assets': '剧本资产提取', 'script-storyboard': '剧本分镜' };
async function request(path: string, body?: unknown) {
  const response = await fetch(`/api/${path}`, { method: body ? 'POST' : 'GET', headers: body ? { 'Content-Type': 'application/json' } : {}, ...(body ? { body: JSON.stringify(body) } : {}) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  return data;
}
export function WorkflowAgentSettings({ initialKind = 'analyze' }: { initialKind?: Kind }) {
  const [configs, setConfigs] = useState<Config[]>([]), [skills, setSkills] = useState<Skill[]>([]), [tools, setTools] = useState<Tool[]>([]);
  const [models, setModels] = useState<ModelOptions>({ text: [], videoAnalysis: [], analysisConfigured: false });
  const [active, setActive] = useState<Kind>(initialKind), [message, setMessage] = useState(''), [saving, setSaving] = useState(false);
  useEffect(() => { let live = true; Promise.all([request('workflow-agents'), request('skills?summary=1'), request('workflow-agents/tools'), request('workflow-agents/models')]).then(([agents, catalog, definitions, modelOptions]) => { if (live) { setConfigs(agents); setSkills(catalog); setTools(definitions); setModels(modelOptions); } }).catch(error => { if (live) setMessage(error.message); }); return () => { live = false; }; }, []);
  const config = configs.find(item => item.kind === active);
  const update = (patch: Partial<Config>) => setConfigs(current => current.map(item => item.kind === active ? { ...item, ...patch } : item));
  const toggle = (key: 'skillIds' | 'toolNames', id: string) => { if (config) update({ [key]: config[key].includes(id) ? config[key].filter(value => value !== id) : [...config[key], id] }); };
  async function save() { setSaving(true); setMessage(''); try { setConfigs(await request('workflow-agents', configs)); setMessage('工作流 Agent 已保存，新任务生效。'); } catch (error) { setMessage(error instanceof Error ? error.message : '保存失败'); } finally { setSaving(false); } }
  return <><section className="darl-agents-settings-card"><header className="darl-settings-card-header"><div><span className="darl-settings-eyebrow">WORKFLOW AGENTS</span><h2>工作流 Agents</h2><p>分别配置视频转绘与剧本模式的工作流。执行模型先生成报告，整理模型再将报告整理为页面字段。</p></div></header>
    <div className="darl-agent-form-stack"><Field><FieldLabel htmlFor="workflow-stage">工作流阶段</FieldLabel><NativeSelect id="workflow-stage" value={active} onChange={event => setActive(event.target.value as Kind)}>{Object.entries(labels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</NativeSelect></Field>
    {config && <><Field><FieldLabel htmlFor="workflow-model">执行模型</FieldLabel><NativeSelect id="workflow-model" value={config.model} onChange={event => update({ model: event.target.value })}>
      {!(active === 'analyze' ? models.videoAnalysis : models.text).some(model => model.id === config.model) && <option value={config.model}>当前配置：{config.model}（未列入可选目录）</option>}
      {(active === 'analyze' ? models.videoAnalysis : models.text).map(model => <option key={model.id} value={model.id}>{model.name === model.id ? model.name : `${model.name} · ${model.id}`}</option>)}
      </NativeSelect><FieldDescription>{active === 'analyze' ? models.analysisConfigured ? '列出与视频分析接口地址相同的供应商模型；实际视频输入能力由该接口决定。' : '请先配置视频分析接口地址，再在模型设置中配置相同地址的供应商。' : '选择模型设置中已启用且已配置供应商凭证的文本模型。'}</FieldDescription></Field>
      <Field><FieldLabel htmlFor="workflow-formatter">整理模型</FieldLabel><NativeSelect id="workflow-formatter" value={config.formatterModel} onChange={event => update({ formatterModel: event.target.value })}>
        {!models.text.some(model => model.id === config.formatterModel) && <option value={config.formatterModel}>当前配置：{config.formatterModel}（未列入可选目录）</option>}
        {models.text.map(model => <option key={model.id} value={model.id}>{model.name === model.id ? model.name : `${model.name} · ${model.id}`}</option>)}
      </NativeSelect><FieldDescription>使用模型设置中的文本模型，将原始输出整理为页面字段；校验未通过时会带着错误自动重新整理，最多两次。</FieldDescription></Field>
      <Field><FieldLabel htmlFor="workflow-instructions">系统提示词</FieldLabel><Textarea id="workflow-instructions" rows={18} value={config.instructions} onChange={event => update({ instructions: event.target.value })} /><FieldDescription>运行该阶段前需要配置并保存系统提示词。</FieldDescription></Field>
      <fieldset><legend>Skills</legend>{skills.map(skill => <label key={skill.id} style={{ display: 'block' }}><input type="checkbox" checked={config.skillIds.includes(skill.id)} onChange={() => toggle('skillIds', skill.id)} /> {skill.name}</label>)}{!skills.length && <small>暂无 Skills</small>}</fieldset>
      <fieldset><legend>可用只读工具</legend><small>仅明确选择的工具可被后台调用。</small>{tools.map(tool => <label key={tool.name} style={{ display: 'block' }}><input type="checkbox" checked={config.toolNames.includes(tool.name)} onChange={() => toggle('toolNames', tool.name)} /> {tool.title || tool.name} ({tool.name})</label>)}</fieldset>
      <button type="button" className="darl-button darl-button--default darl-button-size--default" disabled={saving} onClick={() => void save()}>{saving ? '保存中…' : '保存工作流 Agent'}</button></>}
    {message && <p role="status">{message}</p>}</div></section> </>;
}
