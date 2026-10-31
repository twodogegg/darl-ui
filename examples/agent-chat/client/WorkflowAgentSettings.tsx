import { useEffect, useState } from 'react';
import { Field, FieldDescription, FieldLabel, Input, NativeSelect, Textarea } from '../../../src/components/ui/FormControls';

type Kind = 'analyze' | 'write-script' | 'extract-assets' | 'storyboard' | 'video-prompts';
type Config = { kind: Kind; model: string; formatterModel: string; instructions: string; skillIds: string[]; toolNames: string[] };
type Skill = { id: string; name: string };
type Tool = { name: string; title?: string; risk?: string };
type ButtonInstruction = { action: string; label: string; instructions: string };
const labels: Record<Kind, string> = { analyze: '视频分析', 'write-script': '剧本编写', 'extract-assets': '资产提取', storyboard: '正式分镜', 'video-prompts': '视频提示词拆分' };
async function request(path: string, body?: unknown) {
  const response = await fetch(`/api/${path}`, { method: body ? 'POST' : 'GET', headers: body ? { 'Content-Type': 'application/json' } : {}, ...(body ? { body: JSON.stringify(body) } : {}) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  return data;
}
export function WorkflowAgentSettings() {
  const [configs, setConfigs] = useState<Config[]>([]), [skills, setSkills] = useState<Skill[]>([]), [tools, setTools] = useState<Tool[]>([]);
  const [buttons, setButtons] = useState<ButtonInstruction[]>([]), [buttonAction, setButtonAction] = useState(''), [buttonMessage, setButtonMessage] = useState(''), [buttonSaving, setButtonSaving] = useState(false);
  const [active, setActive] = useState<Kind>('analyze'), [message, setMessage] = useState(''), [saving, setSaving] = useState(false);
  useEffect(() => { let live = true; Promise.all([request('workflow-agents'), request('skills?summary=1'), request('workflow-agents/tools'), request('studio-agent-buttons')]).then(([agents, catalog, definitions, buttonConfigs]) => { if (live) { setConfigs(agents); setSkills(catalog); setTools(definitions); setButtons(buttonConfigs); setButtonAction(buttonConfigs[0]?.action || ''); } }).catch(error => { if (live) setMessage(error.message); }); return () => { live = false; }; }, []);
  const config = configs.find(item => item.kind === active);
  const update = (patch: Partial<Config>) => setConfigs(current => current.map(item => item.kind === active ? { ...item, ...patch } : item));
  const toggle = (key: 'skillIds' | 'toolNames', id: string) => { if (config) update({ [key]: config[key].includes(id) ? config[key].filter(value => value !== id) : [...config[key], id] }); };
  async function save() { setSaving(true); setMessage(''); try { setConfigs(await request('workflow-agents', configs)); setMessage('工作流 Agent 已保存，新任务生效。'); } catch (error) { setMessage(error instanceof Error ? error.message : '保存失败'); } finally { setSaving(false); } }
  const button = buttons.find(item => item.action === buttonAction);
  async function saveButton() { if (!button) return; setButtonSaving(true); setButtonMessage(''); try { await request('studio-agent-buttons', { action: button.action, instructions: button.instructions }); setButtonMessage('按钮指令已保存，新任务生效。'); } catch (error) { setButtonMessage(error instanceof Error ? error.message : '保存失败'); } finally { setButtonSaving(false); } }
  return <><section className="darl-agents-settings-card"><header className="darl-settings-card-header"><div><span className="darl-settings-eyebrow">WORKFLOW AGENTS</span><h2>视频转绘工作流 Agents</h2><p>分别配置五个后台阶段。每个阶段分别配置执行模型和整理模型。</p></div></header>
    <div className="darl-agent-form-stack"><Field><FieldLabel htmlFor="workflow-stage">工作流阶段</FieldLabel><NativeSelect id="workflow-stage" value={active} onChange={event => setActive(event.target.value as Kind)}>{Object.entries(labels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</NativeSelect></Field>
    {config && <><Field><FieldLabel htmlFor="workflow-model">执行模型 ID</FieldLabel><Input id="workflow-model" value={config.model} onChange={event => update({ model: event.target.value })} /><FieldDescription>{active === 'analyze' ? '使用视频分析接口中的模型 ID。' : '使用模型设置中的文本模型 ID。'}</FieldDescription></Field>
      <Field><FieldLabel htmlFor="workflow-formatter">整理模型 ID</FieldLabel><Input id="workflow-formatter" value={config.formatterModel} onChange={event => update({ formatterModel: event.target.value })} /><FieldDescription>使用模型设置中的文本模型，将原始输出整理为页面字段。</FieldDescription></Field>
      <Field><FieldLabel htmlFor="workflow-instructions">系统提示词</FieldLabel><Textarea id="workflow-instructions" rows={18} value={config.instructions} onChange={event => update({ instructions: event.target.value })} /></Field>
      <fieldset><legend>Skills</legend>{skills.map(skill => <label key={skill.id} style={{ display: 'block' }}><input type="checkbox" checked={config.skillIds.includes(skill.id)} onChange={() => toggle('skillIds', skill.id)} /> {skill.name}</label>)}{!skills.length && <small>暂无 Skills</small>}</fieldset>
      <fieldset><legend>可用只读工具</legend><small>仅明确选择的工具可被后台调用。</small>{tools.map(tool => <label key={tool.name} style={{ display: 'block' }}><input type="checkbox" checked={config.toolNames.includes(tool.name)} onChange={() => toggle('toolNames', tool.name)} /> {tool.title || tool.name} ({tool.name})</label>)}</fieldset>
      <button type="button" className="darl-button darl-button--default darl-button-size--default" disabled={saving} onClick={() => void save()}>{saving ? '保存中…' : '保存工作流 Agent'}</button></>}
    {message && <p role="status">{message}</p>}</div></section>
    <section className="darl-agents-settings-card"><header className="darl-settings-card-header"><div><h2>工作台 Agent 按钮</h2><p>配置工作台按钮发送给 Agent 的任务指令。</p></div></header><div className="darl-agent-form-stack">
      <Field><FieldLabel htmlFor="studio-agent-button">按钮</FieldLabel><NativeSelect id="studio-agent-button" value={buttonAction} onChange={event => { setButtonAction(event.target.value); setButtonMessage(''); }}>{buttons.map(item => <option key={item.action} value={item.action}>{item.label} ({item.action})</option>)}</NativeSelect></Field>
      {button && <><Field><FieldLabel htmlFor="studio-agent-instructions">任务指令</FieldLabel><Textarea id="studio-agent-instructions" rows={18} value={button.instructions} onChange={event => setButtons(current => current.map(item => item.action === buttonAction ? { ...item, instructions: event.target.value } : item))} /></Field><button type="button" className="darl-button darl-button--default darl-button-size--default" disabled={buttonSaving || !button.instructions.trim()} onClick={() => void saveButton()}>{buttonSaving ? '保存中…' : '保存按钮指令'}</button></>}
      {buttonMessage && <p role="status">{buttonMessage}</p>}
    </div></section></>;
}
