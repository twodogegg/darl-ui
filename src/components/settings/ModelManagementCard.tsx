import { useMemo, useState, type ReactNode } from 'react';
import { Check, Copy, Link2, Pencil, Plus, RefreshCcw, Search, Trash2, X } from 'lucide-react';
import { Button } from '../ui/Button';
import { effectiveCapabilities, resolveCapabilities, validateModelConfiguration, type CapabilityTemplate, type CapabilityValues, type LogicalModel, type ModelBinding, type ModelConfiguration } from './model-config';
import type { AgentModelType, ModelManagementCardProps, ModelProvider } from './types';

type Tab = 'models' | 'providers';
type DraftModel = { id: string; displayName: string; type: AgentModelType; capabilityTemplateId: string; enabled: boolean; description: string };
type DraftBinding = ModelBinding & { providerId: string; upstreamModelId: string; protocolKey: string };

const typeLabels: Record<AgentModelType, string> = { text: '文本', image: '图片', video: '视频', audio: '音频' };
const typeIcons: Record<AgentModelType, string> = { text: '✦', image: '▧', video: '▷', audio: '♫' };
const emptyModel = (templates: CapabilityTemplate[], type: AgentModelType = 'text'): DraftModel => ({ id: '', displayName: '', type, capabilityTemplateId: templates.find((item) => item.type === type)?.id || '', enabled: true, description: '' });

function cloneConfiguration(configuration: ModelConfiguration): ModelConfiguration {
  return JSON.parse(JSON.stringify(configuration)) as ModelConfiguration;
}

function listValue(value: unknown): string {
  return Array.isArray(value) ? value.join(', ') : value === undefined ? '' : String(value);
}

function capabilitySummary(value: CapabilityValues | undefined, type: AgentModelType): string[] {
  if (!value) return ['未关联能力模板'];
  if (type === 'text' && 'reasoningEfforts' in value) return [`思考 ${value.reasoningEfforts.join(' / ')}`, `默认 ${value.defaultReasoningEffort}`];
  if (type === 'image' && 'sizes' in value && 'maxReferenceImages' in value) return [`参考图 ${value.maxReferenceImages}`, `尺寸 ${(value.sizes || []).slice(0, 2).join(' / ') || '未配置'}`];
  if (type === 'video' && 'resolutions' in value && 'maxReferenceVideos' in value && Array.isArray(value.modes)) return [`${value.modes.length} 种生成方式`, `图片 ${value.maxReferenceImages} · 视频 ${value.maxReferenceVideos} · 音频 ${value.maxReferenceAudios}`, `分辨率 ${(value.resolutions || []).join(' / ')}`];
  return [];
}

function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return <label className="darl-model-config-field"><span>{label}</span>{children}{hint && <small>{hint}</small>}</label>;
}

export function ModelManagementCard({ configuration, providers = [], onSave, onProviderSave, onProviderDelete, onTestConnection }: ModelManagementCardProps) {
  const [tab, setTab] = useState<Tab>('models');
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState(configuration.models[0]?.id || '');
  const [modelDraft, setModelDraft] = useState<DraftModel | null>(null);
  const [modelDraftExistingId, setModelDraftExistingId] = useState<string | null>(null);
  const [bindingDraft, setBindingDraft] = useState<{ modelId: string; value: DraftBinding; isNew: boolean } | null>(null);
  const [providerDraft, setProviderDraft] = useState<ModelProvider | null>(null);
  const [apiKey, setApiKey] = useState('');
  const [message, setMessage] = useState('');
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const selected = configuration.models.find((model) => model.id === selectedId) || configuration.models[0];
  const templates = configuration.templates;
  const protocols = configuration.protocols;
  const visibleModels = useMemo(() => configuration.models.filter((model) => `${model.displayName} ${model.id}`.toLowerCase().includes(query.trim().toLowerCase())), [configuration.models, query]);

  const commit = async (next: ModelConfiguration, success: string): Promise<boolean> => {
    const validation = validateModelConfiguration(next);
    if (validation.length) { setErrors(validation.slice(0, 4).map((item) => item.message)); return false; }
    if (!onSave) { setMessage('宿主尚未接入模型配置保存。'); return false; }
    setBusy(true); setErrors([]);
    try { await onSave(next); setMessage(success); return true; }
    catch (reason) { setMessage(reason instanceof Error ? reason.message : '保存失败，请重试'); return false; }
    finally { setBusy(false); }
  };

  const openCreate = (source?: LogicalModel) => {
    const draft = source ? { id: `${source.id}-copy`, displayName: `${source.displayName} 副本`, type: source.type, capabilityTemplateId: source.capabilityTemplateId, enabled: source.enabled !== false, description: source.description || '' } : emptyModel(templates);
    let nextId = draft.id;
    let suffix = 2;
    while (configuration.models.some((item) => item.id === nextId)) nextId = `${draft.id}-copy-${suffix++}`;
    setModelDraft({ ...draft, id: nextId }); setModelDraftExistingId(null); setErrors([]); setMessage('');
  };

  const saveModel = async () => {
    if (!modelDraft?.displayName.trim() || !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(modelDraft.id.trim())) { setErrors(['请填写有效的模型名称和逻辑 ID。']); return; }
    if (!modelDraft.capabilityTemplateId) { setErrors(['请选择与模型类型匹配的能力模板。']); return; }
    const next = cloneConfiguration(configuration);
    const existing = modelDraftExistingId ? next.models.findIndex((item) => item.id === modelDraftExistingId) : -1;
    const record: LogicalModel = { id: modelDraft.id.trim(), displayName: modelDraft.displayName.trim(), type: modelDraft.type, capabilityTemplateId: modelDraft.capabilityTemplateId, enabled: modelDraft.enabled, bindings: existing >= 0 ? next.models[existing].bindings : [], ...(modelDraft.description.trim() ? { description: modelDraft.description.trim() } : {}) };
    if (next.models.some((item) => item.id === record.id && item.id !== selectedId)) { setErrors(['逻辑模型 ID 已存在。']); return; }
    if (existing >= 0) next.models[existing] = record; else next.models.push(record);
    if (await commit(next, existing >= 0 ? '模型已保存。' : '模型已创建，可继续添加渠道绑定。')) { setSelectedId(record.id); setModelDraft(null); setModelDraftExistingId(null); }
  };

  const removeModel = async () => {
    if (!selected) return;
    if (!window.confirm(`确定删除「${selected.displayName}」？`)) return;
    const next = cloneConfiguration(configuration); next.models = next.models.filter((item) => item.id !== selected.id);
    setSelectedId(next.models[0]?.id || ''); await commit(next, '模型已删除。');
  };

  const openBinding = (model: LogicalModel, binding?: ModelBinding) => {
    const firstProtocol = protocols.find((protocol) => protocol.implemented !== false && protocol.types.includes(model.type));
    const value: DraftBinding = binding ? JSON.parse(JSON.stringify(binding)) as DraftBinding : { id: `${model.id}-${Date.now()}`, providerId: providers[0]?.id || '', upstreamModelId: model.id, protocolKey: firstProtocol?.key || '', enabled: true, maxConcurrency: 64, capabilityOverrides: {} };
    setBindingDraft({ modelId: model.id, value, isNew: !binding }); setErrors([]); setMessage('');
  };

  const updateOverride = (key: string, value: string, asNumber = false) => {
    setBindingDraft((current) => {
      if (!current) return current;
      const next = { ...(current.value.capabilityOverrides || {}) } as Record<string, unknown>;
      next[key] = asNumber ? Number(value) : value.split(',').map((item) => item.trim()).filter(Boolean);
      return { ...current, value: { ...current.value, capabilityOverrides: next } };
    });
  };

  const toggleOverride = (key: string, template: CapabilityValues) => {
    setBindingDraft((current) => {
      if (!current) return current;
      const next = { ...(current.value.capabilityOverrides || {}) } as Record<string, unknown>;
      if (Object.prototype.hasOwnProperty.call(next, key)) delete next[key]; else next[key] = JSON.parse(JSON.stringify((template as Record<string, unknown>)[key]));
      return { ...current, value: { ...current.value, capabilityOverrides: next } };
    });
  };

  const saveBinding = async () => {
    if (!bindingDraft?.value.providerId || !bindingDraft.value.upstreamModelId.trim() || !bindingDraft.value.protocolKey) { setErrors(['请填写供应商、上游模型 ID 和已实现的调用协议。']); return; }
    const next = cloneConfiguration(configuration);
    const model = next.models.find((item) => item.id === bindingDraft.modelId);
    if (!model) return;
    const binding = JSON.parse(JSON.stringify(bindingDraft.value)) as ModelBinding;
    if (bindingDraft.isNew && (model.type === 'image' || model.type === 'video') && model.bindings.some((item) => item.enabled !== false)) {
      setErrors(['每个图片/视频模型只能有一个有效供应商，请编辑原绑定。']); return;
    }
    if (bindingDraft.isNew) model.bindings.push(binding); else model.bindings = model.bindings.map((item) => item.id === binding.id ? binding : item);
    if (await commit(next, '渠道绑定已保存。')) setBindingDraft(null);
  };

  const editProvider = (provider?: ModelProvider) => { setProviderDraft(provider ? { ...provider, models: provider.models.map((model) => ({ ...model })) } : { id: '', name: '', baseUrl: '', protocol: 'openai-completions', models: [] }); setApiKey(''); setErrors([]); };
  const saveProvider = async () => {
    if (!providerDraft?.id.trim() || !providerDraft.name.trim() || !providerDraft.baseUrl.trim()) { setErrors(['请填写 Provider ID、显示名称和 API 地址。']); return; }
    if (!onProviderSave) { setMessage('宿主尚未接入供应商保存。'); return; }
    setBusy(true); setErrors([]);
    try { await onProviderSave({ ...providerDraft, id: providerDraft.id.trim(), name: providerDraft.name.trim(), baseUrl: providerDraft.baseUrl.trim() }, apiKey || undefined); setProviderDraft(null); setMessage('供应商已保存。'); }
    catch (reason) { setMessage(reason instanceof Error ? reason.message : '供应商保存失败。'); }
    finally { setBusy(false); }
  };

  const selectedTemplate = selected ? templates.find((template) => template.id === selected.capabilityTemplateId) : undefined;
  const selectedBinding = bindingDraft ? configuration.models.find((model) => model.id === bindingDraft.modelId) : undefined;
  const bindingTemplate = selectedBinding ? templates.find((template) => template.id === selectedBinding.capabilityTemplateId) : undefined;
  const bindingEffective = selectedBinding && bindingTemplate ? resolveCapabilities(bindingTemplate, bindingDraft?.value.capabilityOverrides) : undefined;

  return <section className="darl-model-management" aria-labelledby="darl-model-management-title">
    <header className="darl-settings-card-header"><div><span className="darl-settings-eyebrow">MODEL CONTROL PLANE</span><h2 id="darl-model-management-title">模型与渠道</h2><p>用逻辑模型统一入口，模板复用能力，渠道绑定供应商和真实上游 ID。</p></div><div className="darl-model-management-actions"><Button variant="outline" size="sm" onClick={() => setTab(tab === 'models' ? 'providers' : 'models')}>{tab === 'models' ? 'API 供应商' : '模型管理'}</Button>{tab === 'models' && <Button size="sm" onClick={() => openCreate()}><Plus />新增模型</Button>}</div></header>
    <div className="darl-model-management-tabs" role="tablist" aria-label="模型设置入口"><button role="tab" aria-selected={tab === 'models'} onClick={() => setTab('models')}>模型管理 <small>{configuration.models.length}</small></button><button role="tab" aria-selected={tab === 'providers'} onClick={() => setTab('providers')}>API 供应商 <small>{providers.length}</small></button></div>
    {message && <p className="darl-settings-message" role="status">{message}</p>}{errors.length > 0 && <div className="darl-settings-errors" role="alert">{errors.map((error) => <p key={error}>{error}</p>)}</div>}
    {tab === 'models' ? <div className="darl-model-management-grid"><aside className="darl-logical-model-list"><div className="darl-model-list-toolbar"><label><Search aria-hidden="true" /><span className="darl-visually-hidden">搜索模型</span><input aria-label="搜索模型" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索模型" /></label><span>{visibleModels.length} 个</span></div>{visibleModels.map((model) => <button key={model.id} className={model.id === selected?.id ? 'is-selected' : ''} onClick={() => setSelectedId(model.id)}><span className={`darl-model-type-icon darl-model-type-icon--${model.type}`}>{typeIcons[model.type]}</span><span><strong>{model.displayName}</strong><small>{model.id}</small></span><i>{model.enabled === false ? '停用' : '启用'}</i></button>)}{!visibleModels.length && <p className="darl-settings-empty">没有匹配的模型。</p>}</aside>
      {selected ? <article className="darl-logical-model-detail"><div className="darl-model-detail-head"><div><span className="darl-settings-eyebrow">LOGICAL MODEL</span><h3>{selected.displayName}</h3><p><code>{selected.id}</code> · {typeLabels[selected.type]}</p></div><div className="darl-model-detail-actions"><Button variant="outline" size="sm" onClick={() => openCreate(selected)}><Copy />复制配置</Button><Button variant="ghost" size="sm" onClick={() => { setModelDraft({ id: selected.id, displayName: selected.displayName, type: selected.type, capabilityTemplateId: selected.capabilityTemplateId, enabled: selected.enabled !== false, description: selected.description || '' }); setModelDraftExistingId(selected.id); }}><Pencil />编辑</Button><Button variant="ghost" size="sm" onClick={() => void removeModel()}><Trash2 />删除</Button></div></div>
        <div className="darl-capability-summary"><div className="darl-capability-summary-head"><div><strong>{selectedTemplate?.name || '未关联模板'}</strong><span>能力模板 · {selectedTemplate ? '关联继承' : '需要配置'}</span></div><Link2 aria-hidden="true" /></div><div className="darl-capability-pills">{capabilitySummary(effectiveCapabilities(configuration, selected), selected.type).map((item) => <span key={item}>{item}</span>)}</div></div>
        <div className="darl-model-bindings-head"><div><h4>渠道绑定 <small>{selected.bindings.length} 条</small></h4><p>每个图片或视频模型只绑定一个供应商，并可单独设置最大并发。</p></div><Button size="sm" disabled={(selected.type === 'image' || selected.type === 'video') && selected.bindings.some((b) => b.enabled !== false)} onClick={() => openBinding(selected)}><Plus />添加渠道</Button></div>
        <div className="darl-model-bindings">{selected.bindings.map((binding) => { const provider = providers.find((item) => item.id === binding.providerId); const effective = effectiveCapabilities(configuration, selected, binding); const overrides = Object.keys(binding.capabilityOverrides || {}).length; return <article key={binding.id}><div className="darl-binding-head"><div><strong>{provider?.name || binding.providerId || '未选择供应商'}</strong><small>{binding.enabled === false ? '已停用' : '已启用'} · {binding.protocolKey}</small></div><span className={overrides ? 'is-overridden' : ''}>{overrides ? `${overrides} 项覆盖` : '完全继承'}</span></div><dl><dt>上游模型 ID</dt><dd>{binding.upstreamModelId}</dd><dt>最大并发</dt><dd>{binding.maxConcurrency ?? 64}</dd><dt>有效能力</dt><dd>{capabilitySummary(effective, selected.type).join(' · ') || '未配置'}</dd></dl><footer><small>{overrides ? '模板 + 渠道差异' : '完全使用模板配置'}</small><Button variant="ghost" size="sm" onClick={() => openBinding(selected, binding)}>编辑绑定 →</Button></footer></article>; })}{!selected.bindings.length && <div className="darl-settings-empty">尚未绑定供应商。先保存模型，再添加渠道。</div>}</div>
        <div className="darl-model-note"><span>ⓘ</span><p><strong>协议与能力彼此独立。</strong> 协议适配器负责请求、上传、轮询和结果解析；能力配置只决定当前渠道可接受的输入与选项。</p></div>
      </article> : <div className="darl-settings-empty">还没有逻辑模型，请先新增一个。</div>}</div> : <div className="darl-provider-management"><div className="darl-provider-management-head"><div><h3>API 供应商</h3><p>供应商只管理 Base URL、Key 和连接状态，协议留在渠道绑定中。</p></div><Button size="sm" onClick={() => editProvider()}><Plus />添加供应商</Button></div><div className="darl-provider-cards">{providers.map((provider) => <article key={provider.id}><div><strong>{provider.name}</strong><small>{provider.baseUrl}</small><small>API Key：{provider.hasApiKey ? '已配置' : '未配置'}</small></div><span className={`darl-provider-status darl-provider-status--${provider.status || 'unknown'}`}><i />{provider.status === 'connected' ? '已连接' : provider.status === 'error' ? '连接失败' : '未测试'}</span><footer><Button variant="outline" size="sm" onClick={() => onTestConnection ? void onTestConnection(provider) : setMessage('宿主尚未接入连接测试。')}><RefreshCcw />测试连接</Button><Button variant="ghost" size="sm" onClick={() => editProvider(provider)}><Pencil />编辑</Button>{onProviderDelete && <Button variant="ghost" size="sm" aria-label={`删除供应商 ${provider.name}`} onClick={() => { if (window.confirm(`确定删除「${provider.name}」？`)) void onProviderDelete(provider.id); }}><Trash2 /></Button>}</footer></article>)}{!providers.length && <div className="darl-settings-empty">暂无供应商。添加供应商后再绑定渠道。</div>}</div></div>}

    {modelDraft && <div className="darl-model-config-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) { setModelDraft(null); setModelDraftExistingId(null); } }}><section className="darl-model-config-drawer" role="dialog" aria-modal="true" aria-labelledby="darl-model-drawer-title"><header><div><span className="darl-settings-eyebrow">CREATE LOGICAL MODEL</span><h3 id="darl-model-drawer-title">{modelDraftExistingId ? '编辑逻辑模型' : '新增逻辑模型'}</h3><p>模型名称用于展示，真实 API 名称放在渠道映射中。</p></div><Button variant="ghost" size="icon" aria-label="关闭" onClick={() => { setModelDraft(null); setModelDraftExistingId(null); }}><X /></Button></header><div className="darl-model-config-form"><Field label="显示名称"><input value={modelDraft.displayName} onChange={(event) => setModelDraft({ ...modelDraft, displayName: event.target.value })} placeholder="例如：GPT Image 2" /></Field><Field label="逻辑模型 ID" hint="稳定且唯一，不等于供应商上游模型 ID"><input value={modelDraft.id} onChange={(event) => setModelDraft({ ...modelDraft, id: event.target.value })} placeholder="例如：gpt-image-2" /></Field><Field label="模型类型"><select value={modelDraft.type} onChange={(event) => { const type = event.target.value as AgentModelType; setModelDraft({ ...modelDraft, type, capabilityTemplateId: templates.find((item) => item.type === type)?.id || '' }); }}><option value="text">文本</option><option value="image">图片</option><option value="video">视频</option><option value="audio">音频</option></select></Field><Field label="能力模板"><select value={modelDraft.capabilityTemplateId} onChange={(event) => setModelDraft({ ...modelDraft, capabilityTemplateId: event.target.value })}>{templates.filter((template) => template.type === modelDraft.type).map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}</select></Field><Field label="说明"><textarea rows={3} value={modelDraft.description} onChange={(event) => setModelDraft({ ...modelDraft, description: event.target.value })} placeholder="可选" /></Field><label className="darl-model-config-check"><input type="checkbox" checked={modelDraft.enabled} onChange={(event) => setModelDraft({ ...modelDraft, enabled: event.target.checked })} />启用这个逻辑模型</label></div><footer><Button variant="outline" onClick={() => { setModelDraft(null); setModelDraftExistingId(null); }}>取消</Button><Button disabled={busy} onClick={() => void saveModel()}>{busy ? '保存中…' : '保存模型'}</Button></footer></section></div>}
    {bindingDraft && bindingTemplate && <div className="darl-model-config-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setBindingDraft(null); }}><section className="darl-model-config-drawer" role="dialog" aria-modal="true" aria-labelledby="darl-binding-drawer-title"><header><div><span className="darl-settings-eyebrow">MODEL BINDING</span><h3 id="darl-binding-drawer-title">{bindingDraft.isNew ? '添加渠道绑定' : '编辑渠道绑定'}</h3><p>{selectedBinding?.displayName} · {bindingTemplate.name}</p></div><Button variant="ghost" size="icon" aria-label="关闭" onClick={() => setBindingDraft(null)}><X /></Button></header><div className="darl-model-config-form"><Field label="API 供应商"><select value={bindingDraft.value.providerId} onChange={(event) => setBindingDraft({ ...bindingDraft, value: { ...bindingDraft.value, providerId: event.target.value } })}><option value="">选择供应商</option>{providers.map((provider) => <option key={provider.id} value={provider.id}>{provider.name}</option>)}</select></Field><Field label="上游实际模型 ID" hint="这是供应商真正收到的 model 字段"><input value={bindingDraft.value.upstreamModelId} onChange={(event) => setBindingDraft({ ...bindingDraft, value: { ...bindingDraft.value, upstreamModelId: event.target.value } })} /></Field><Field label="调用协议"><select value={bindingDraft.value.protocolKey} onChange={(event) => setBindingDraft({ ...bindingDraft, value: { ...bindingDraft.value, protocolKey: event.target.value } })}><option value="">选择已实现协议</option>{bindingDraft.value.protocolKey && !protocols.some((protocol) => protocol.key === bindingDraft.value.protocolKey && protocol.implemented !== false && protocol.types.includes(selectedBinding!.type)) && <option value={bindingDraft.value.protocolKey}>当前协议（等待宿主实现）</option>}{protocols.filter((protocol) => protocol.implemented !== false && protocol.types.includes(selectedBinding!.type)).map((protocol) => <option key={protocol.key} value={protocol.key}>{protocol.label}</option>)}</select></Field><Field label="最大在途并发" hint="动态限制同一模型的正在生成任务；高并发渠道可自行调大"><input type="number" min={1} max={100000} value={bindingDraft.value.maxConcurrency ?? 64} onChange={(event) => setBindingDraft({ ...bindingDraft, value: { ...bindingDraft.value, maxConcurrency: Number(event.target.value) } })} /></Field><div className="darl-binding-capability-editor"><div className="darl-binding-capability-header"><div><h4>能力继承与覆盖</h4><p>不勾选则跟随模板；勾选后列表整体替换，0 和 false 也会保留。</p></div><span>最终生效预览</span></div>{selectedBinding?.type === 'text' && bindingEffective && 'reasoningEfforts' in bindingEffective && <><Field label="思考等级（逗号分隔）"><input value={listValue(bindingDraft.value.capabilityOverrides?.reasoningEfforts ?? bindingEffective.reasoningEfforts)} onChange={(event) => updateOverride('reasoningEfforts', event.target.value)} /></Field><Field label="默认思考等级"><select value={String(bindingDraft.value.capabilityOverrides?.defaultReasoningEffort ?? bindingEffective.defaultReasoningEffort)} onChange={(event) => setBindingDraft({ ...bindingDraft, value: { ...bindingDraft.value, capabilityOverrides: { ...(bindingDraft.value.capabilityOverrides || {}), defaultReasoningEffort: event.target.value } } })}>{bindingEffective.reasoningEfforts.map((effort) => <option key={effort}>{effort}</option>)}</select></Field></>}{selectedBinding?.type === 'image' && bindingEffective && 'maxReferenceImages' in bindingEffective && <><OverrideNumber label="参考图上限" field="maxReferenceImages" template={bindingTemplate.capabilities} draft={bindingDraft.value.capabilityOverrides} onToggle={() => toggleOverride('maxReferenceImages', bindingTemplate.capabilities)} onChange={(value) => updateOverride('maxReferenceImages', value, true)} /><OverrideList label="输出尺寸" field="sizes" template={bindingTemplate.capabilities} draft={bindingDraft.value.capabilityOverrides} onToggle={() => toggleOverride('sizes', bindingTemplate.capabilities)} onChange={(value) => updateOverride('sizes', value)} /><OverrideList label="支持画幅" field="aspectRatios" template={bindingTemplate.capabilities} draft={bindingDraft.value.capabilityOverrides} onToggle={() => toggleOverride('aspectRatios', bindingTemplate.capabilities)} onChange={(value) => updateOverride('aspectRatios', value)} /></>}{selectedBinding?.type === 'video' && bindingEffective && 'modes' in bindingEffective && <><OverrideNumber label="参考图片上限" field="maxReferenceImages" template={bindingTemplate.capabilities} draft={bindingDraft.value.capabilityOverrides} onToggle={() => toggleOverride('maxReferenceImages', bindingTemplate.capabilities)} onChange={(value) => updateOverride('maxReferenceImages', value, true)} /><OverrideNumber label="参考视频上限" field="maxReferenceVideos" template={bindingTemplate.capabilities} draft={bindingDraft.value.capabilityOverrides} onToggle={() => toggleOverride('maxReferenceVideos', bindingTemplate.capabilities)} onChange={(value) => updateOverride('maxReferenceVideos', value)} /><OverrideNumber label="参考音频上限" field="maxReferenceAudios" template={bindingTemplate.capabilities} draft={bindingDraft.value.capabilityOverrides} onToggle={() => toggleOverride('maxReferenceAudios', bindingTemplate.capabilities)} onChange={(value) => updateOverride('maxReferenceAudios', value, true)} /><OverrideList label="生成方式" field="modes" template={bindingTemplate.capabilities} draft={bindingDraft.value.capabilityOverrides} onToggle={() => toggleOverride('modes', bindingTemplate.capabilities)} onChange={(value) => updateOverride('modes', value)} /><OverrideList label="分辨率" field="resolutions" template={bindingTemplate.capabilities} draft={bindingDraft.value.capabilityOverrides} onToggle={() => toggleOverride('resolutions', bindingTemplate.capabilities)} onChange={(value) => updateOverride('resolutions', value)} /><OverrideList label="画幅比例" field="aspectRatios" template={bindingTemplate.capabilities} draft={bindingDraft.value.capabilityOverrides} onToggle={() => toggleOverride('aspectRatios', bindingTemplate.capabilities)} onChange={(value) => updateOverride('aspectRatios', value)} /></>}{bindingEffective && <div className="darl-binding-preview">{capabilitySummary(bindingEffective, selectedBinding!.type).map((item) => <span key={item}><Check />{item}</span>)}</div>}</div></div><footer><Button variant="outline" onClick={() => setBindingDraft(null)}>取消</Button><Button disabled={busy} onClick={() => void saveBinding()}>{busy ? '保存中…' : '保存绑定'}</Button></footer></section></div>}
    {providerDraft && <div className="darl-model-config-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setProviderDraft(null); }}><section className="darl-model-config-drawer" role="dialog" aria-modal="true" aria-labelledby="darl-provider-drawer-title"><header><div><span className="darl-settings-eyebrow">API PROVIDER</span><h3 id="darl-provider-drawer-title">{providerDraft.id ? '编辑供应商' : '添加供应商'}</h3><p>API Key 只交给宿主保存，不进入模型配置。</p></div><Button variant="ghost" size="icon" aria-label="关闭" onClick={() => setProviderDraft(null)}><X /></Button></header><div className="darl-model-config-form"><Field label="Provider ID"><input value={providerDraft.id} disabled={providers.some((provider) => provider.id === providerDraft.id)} onChange={(event) => setProviderDraft({ ...providerDraft, id: event.target.value })} placeholder="例如：darl" /></Field><Field label="显示名称"><input value={providerDraft.name} onChange={(event) => setProviderDraft({ ...providerDraft, name: event.target.value })} /></Field><Field label="Base URL"><input value={providerDraft.baseUrl} onChange={(event) => setProviderDraft({ ...providerDraft, baseUrl: event.target.value })} placeholder="https://gateway.example/v1" /></Field><Field label="文本 API 协议"><select value={providerDraft.protocol} onChange={(event) => setProviderDraft({ ...providerDraft, protocol: event.target.value as ModelProvider['protocol'] })}><option value="openai-completions">OpenAI Chat Completions</option><option value="openai-responses">OpenAI Responses</option></select></Field><Field label="API Key" hint={providerDraft.hasApiKey ? '已配置；留空则保持原 Key' : '只会发送给宿主保存回调'}><input type="password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder={providerDraft.hasApiKey ? '已配置' : '输入 Key'} /></Field></div><footer><Button variant="outline" onClick={() => setProviderDraft(null)}>取消</Button><Button disabled={busy} onClick={() => void saveProvider()}>{busy ? '保存中…' : '保存供应商'}</Button></footer></section></div>}
  </section>;
}

function OverrideNumber({ label, field, template, draft, onToggle, onChange }: { label: string; field: string; template: CapabilityValues; draft?: Record<string, unknown>; onToggle: () => void; onChange: (value: string) => void }) {
  const checked = Object.prototype.hasOwnProperty.call(draft || {}, field);
  const value = checked ? draft?.[field] : (template as Record<string, unknown>)[field];
  return <div className="darl-override-row"><div><strong>{label}</strong><small>模板：{String((template as Record<string, unknown>)[field])}</small></div><label><input type="checkbox" checked={checked} onChange={onToggle} />覆盖</label><input type="number" min={0} value={String(value ?? '')} disabled={!checked} onChange={(event) => onChange(event.target.value)} /></div>;
}

function OverrideList({ label, field, template, draft, onToggle, onChange }: { label: string; field: string; template: CapabilityValues; draft?: Record<string, unknown>; onToggle: () => void; onChange: (value: string) => void }) {
  const checked = Object.prototype.hasOwnProperty.call(draft || {}, field);
  const value = checked ? draft?.[field] : (template as Record<string, unknown>)[field];
  return <div className="darl-override-row darl-override-row--list"><div><strong>{label}</strong><small>模板：{listValue((template as Record<string, unknown>)[field]) || '未配置'}</small></div><label><input type="checkbox" checked={checked} onChange={onToggle} />覆盖</label><input value={listValue(value)} disabled={!checked} onChange={(event) => onChange(event.target.value)} placeholder="逗号分隔" /></div>;
}
