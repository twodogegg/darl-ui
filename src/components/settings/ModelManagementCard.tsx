import { useMemo, useState, type ReactNode } from 'react';
import { Check, Copy, Link2, Pencil, Plus, RefreshCcw, Search, Trash2, X } from 'lucide-react';
import { Button } from '../ui/Button';
import { effectiveCapabilities, resolveCapabilities, validateModelConfiguration, type CapabilityTemplate, type CapabilityValues, type LogicalModel, type ModelBinding, type ModelConfiguration } from './model-config';
import type { AgentModelType, AgentModelConfig, ModelManagementCardProps, ModelProvider } from './types';

type Tab = 'models' | 'providers';
type DraftModel = { id: string; displayName: string; type: AgentModelType; capabilityTemplateId: string; enabled: boolean; description: string };
type DraftBinding = ModelBinding & { providerId: string; upstreamModelId: string; protocolKey: string };

const typeLabels: Record<AgentModelType, string> = { text: '文本', image: '图片', video: '视频', audio: '音频' };
const typeIcons: Record<AgentModelType, string> = { text: '✦', image: '▧', video: '▷', audio: '♫' };
const generationModeLabels: Record<string, string> = { 'text-to-video': '文生视频', 'first-last-frame': '首尾帧', reference: '参考素材' };
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
  if (type === 'image' && 'maxReferenceImages' in value) {
    const resolutions = ('resolutions' in value ? value.resolutions : undefined) ?? ('sizes' in value ? value.sizes : undefined) ?? [];
    return [`参考图 ${value.maxReferenceImages}`, `档位 ${resolutions.join(' / ') || '未配置'}`];
  }
  if (type === 'video' && 'resolutions' in value && 'maxReferenceVideos' in value && Array.isArray(value.modes)) return [`${value.modes.length} 种生成方式`, `图片 ${value.maxReferenceImages} · 视频 ${value.maxReferenceVideos} · 音频 ${value.maxReferenceAudios}`, `分辨率 ${(value.resolutions || []).join(' / ')}`];
  return [];
}

function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return <label className="darl-model-config-field"><span>{label}</span>{children}{hint && <small>{hint}</small>}</label>;
}

export function ModelManagementCard({ configuration, providers = [], onSave, onProviderSave, onProviderDelete, onTestConnection, onFetchModels }: ModelManagementCardProps) {
  const [tab, setTab] = useState<Tab>('models');
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState(configuration.models[0]?.id || '');
  const [modelDraft, setModelDraft] = useState<DraftModel | null>(null);
  const [modelDraftExistingId, setModelDraftExistingId] = useState<string | null>(null);
  const [bindingDraft, setBindingDraft] = useState<{ modelId: string; value: DraftBinding; isNew: boolean } | null>(null);
  const [providerDraft, setProviderDraft] = useState<ModelProvider | null>(null);
  const [catalogQuery, setCatalogQuery] = useState('');
  const [catalogs, setCatalogs] = useState<Record<string, AgentModelConfig[]>>({});
  const [catalogModel, setCatalogModel] = useState<AgentModelConfig | null>(null);
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
    if (await commit(next, existing >= 0 ? '模型已保存。' : '模型已创建，可继续添加渠道绑定。')) {
      setSelectedId(record.id); setModelDraft(null); setModelDraftExistingId(null);
    }
  };

  const removeModel = async () => {
    if (!selected) return;
    if (!window.confirm(`确定删除「${selected.displayName}」？`)) return;
    const next = cloneConfiguration(configuration); next.models = next.models.filter((item) => item.id !== selected.id);
    setSelectedId(next.models[0]?.id || ''); await commit(next, '模型已删除。');
  };

  const openBinding = (model: LogicalModel, binding?: ModelBinding) => {
    const firstProtocol = protocols.find((protocol) => protocol.implemented !== false && protocol.types.includes(model.type));
    const value: DraftBinding = binding ? JSON.parse(JSON.stringify(binding)) as DraftBinding : { id: `${model.id}-${Date.now()}`, providerId: providers[0]?.id || '', upstreamModelId: model.id, protocolKey: firstProtocol?.key || '', enabled: true, capabilityOverrides: {} };
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

  const updateOverrideList = (key: string, values: string[]) => {
    setBindingDraft((current) => current ? { ...current, value: { ...current.value, capabilityOverrides: { ...(current.value.capabilityOverrides || {}), [key]: values } } } : current);
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
    if (bindingDraft.isNew) model.bindings.push(binding); else model.bindings = model.bindings.map((item) => item.id === binding.id ? binding : item);
    if ((model.type === 'image' || model.type === 'video') && binding.enabled !== false) {
      model.bindings = model.bindings.map(item => item.id === binding.id ? item : { ...item, enabled: false });
    }
    if (await commit(next, '渠道绑定已保存。')) setBindingDraft(null);
  };

  const editProvider = (provider?: ModelProvider) => {
    setProviderDraft(provider ? { ...provider, models: provider.models.map(model => ({ ...model })) } : { id: '', name: '', baseUrl: '', protocol: 'openai-completions', models: [] });
    setCatalogs({}); setCatalogModel(null); setApiKey(''); setCatalogQuery(''); setErrors([]); setMessage('');
  };
  const saveProvider = async (close = true) => {
    if (!providerDraft?.id.trim() || !providerDraft.name.trim() || !providerDraft.baseUrl.trim()) { setErrors(['请填写 Provider ID、显示名称和 API 地址。']); return; }
    if (!onProviderSave) { setMessage('宿主尚未接入供应商保存。'); return; }
    setBusy(true); setErrors([]);
    try { await onProviderSave({ ...providerDraft, id: providerDraft.id.trim(), name: providerDraft.name.trim(), baseUrl: providerDraft.baseUrl.trim(), models: providerDraft.models.filter(model => configuration.models.some(item => item.bindings.some(binding => binding.providerId === providerDraft.id.trim() && binding.upstreamModelId === model.id))) }, apiKey || undefined); if (close) setProviderDraft(null); setApiKey(''); setMessage('供应商已保存。'); return true; }
    catch (reason) { setMessage(reason instanceof Error ? reason.message : '供应商保存失败。'); return false; }
    finally { setBusy(false); }
  };

  const fetchCatalog = async (provider: ModelProvider) => {
    if (!onFetchModels || busy) return;
    setBusy(true); setErrors([]); setMessage('');
    try {
      const models = await onFetchModels(provider, providerDraft?.id === provider.id ? apiKey || undefined : undefined);
      setCatalogs(current => ({ ...current, [provider.id]: models }));
      setMessage(`查询到 ${models.length} 个模型，仅临时预览。需要使用时再逐个添加。`);
    } catch (reason) { setMessage(reason instanceof Error ? reason.message : '获取模型失败'); }
    finally { setBusy(false); }
  };
  const saveCatalogModel = async (next: ModelConfiguration) => {
    const validation = validateModelConfiguration(next);
    if (validation.length) { setErrors(validation.slice(0, 4).map(item => item.message)); return; }
    if (!await saveProvider(false)) return;
    if (await commit(next, '模型已保存。')) setCatalogModel(null);
  };

  const selectedTemplate = selected ? templates.find((template) => template.id === selected.capabilityTemplateId) : undefined;
  const selectedBinding = bindingDraft ? configuration.models.find((model) => model.id === bindingDraft.modelId) : undefined;
  const bindingTemplate = selectedBinding ? templates.find((template) => template.id === selectedBinding.capabilityTemplateId) : undefined;
  const bindingEffective = selectedBinding && bindingTemplate ? resolveCapabilities(bindingTemplate, bindingDraft?.value.capabilityOverrides) : undefined;

  const providerCatalog = providerDraft ? catalogs[providerDraft.id] ?? Array.from(new Map(configuration.models.flatMap(model =>
    model.bindings.filter(binding => binding.providerId === providerDraft.id).map(binding => [binding.upstreamModelId, { id: binding.upstreamModelId, name: model.displayName, type: model.type, providerId: providerDraft.id }] as const))).values()) : [];

  return <section className="darl-model-management" aria-labelledby="darl-model-management-title">
    <header className="darl-settings-card-header"><div><span className="darl-settings-eyebrow">MODEL CONTROL PLANE</span><h2 id="darl-model-management-title">模型与渠道</h2><p>用逻辑模型统一入口，模板复用能力，渠道绑定供应商和真实上游 ID。</p></div><div className="darl-model-management-actions"><Button variant="outline" size="sm" onClick={() => setTab(tab === 'models' ? 'providers' : 'models')}>{tab === 'models' ? 'API 供应商' : '模型管理'}</Button>{tab === 'models' && <Button size="sm" onClick={() => openCreate()}><Plus />新增模型</Button>}</div></header>
    <div className="darl-model-management-tabs" role="tablist" aria-label="模型设置入口"><button role="tab" aria-selected={tab === 'models'} onClick={() => setTab('models')}>模型管理 <small>{configuration.models.length}</small></button><button role="tab" aria-selected={tab === 'providers'} onClick={() => setTab('providers')}>API 供应商 <small>{providers.length}</small></button></div>
    {message && <p className="darl-settings-message" role="status">{message}</p>}{errors.length > 0 && <div className="darl-settings-errors" role="alert">{errors.map((error) => <p key={error}>{error}</p>)}</div>}
    {tab === 'models' ? <div className="darl-model-management-grid"><aside className="darl-logical-model-list"><div className="darl-model-list-toolbar"><label><Search aria-hidden="true" /><span className="darl-visually-hidden">搜索模型</span><input aria-label="搜索模型" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索模型" /></label><span>{visibleModels.length} 个</span></div>{visibleModels.map((model) => <button key={model.id} className={model.id === selected?.id ? 'is-selected' : ''} onClick={() => setSelectedId(model.id)}><span className={`darl-model-type-icon darl-model-type-icon--${model.type}`}>{typeIcons[model.type]}</span><span><strong>{model.displayName}</strong><small>{model.id}</small></span><i>{model.enabled === false ? '停用' : '启用'}</i></button>)}{!visibleModels.length && <p className="darl-settings-empty">没有匹配的模型。</p>}</aside>
      {selected ? <article className="darl-logical-model-detail"><div className="darl-model-detail-head"><div><span className="darl-settings-eyebrow">LOGICAL MODEL</span><h3>{selected.displayName}</h3><p><code>{selected.id}</code> · {typeLabels[selected.type]}</p></div><div className="darl-model-detail-actions"><Button variant="outline" size="sm" onClick={() => openCreate(selected)}><Copy />复制配置</Button><Button variant="ghost" size="sm" onClick={() => { setModelDraft({ id: selected.id, displayName: selected.displayName, type: selected.type, capabilityTemplateId: selected.capabilityTemplateId, enabled: selected.enabled !== false, description: selected.description || '' }); setModelDraftExistingId(selected.id); }}><Pencil />编辑</Button><Button variant="ghost" size="sm" onClick={() => void removeModel()}><Trash2 />删除</Button></div></div>
        <div className="darl-capability-summary"><div className="darl-capability-summary-head"><div><strong>{selectedTemplate?.name || '未关联模板'}</strong><span>能力模板 · {selectedTemplate ? '关联继承' : '需要配置'}</span></div><Link2 aria-hidden="true" /></div><div className="darl-capability-pills">{capabilitySummary(effectiveCapabilities(configuration, selected), selected.type).map((item) => <span key={item}>{item}</span>)}</div></div>
        <div className="darl-model-bindings-head"><div><h4>渠道绑定 <small>{selected.bindings.length} 条</small></h4><p>同一模型只因供应商上游 ID 不同而增加绑定，不重复创建逻辑模型。</p></div><Button size="sm" onClick={() => openBinding(selected)}><Plus />添加渠道</Button></div>
        <div className="darl-model-bindings">{selected.bindings.map((binding) => { const provider = providers.find((item) => item.id === binding.providerId); const effective = effectiveCapabilities(configuration, selected, binding); const overrides = Object.keys(binding.capabilityOverrides || {}).length; return <article key={binding.id}><div className="darl-binding-head"><div><strong>{provider?.name || binding.providerId || '未选择供应商'}</strong><small>{binding.enabled === false ? '已停用' : '已启用'} · {binding.protocolKey}</small></div><span className={overrides ? 'is-overridden' : ''}>{overrides ? `${overrides} 项覆盖` : '完全继承'}</span></div><dl><dt>上游模型 ID</dt><dd>{binding.upstreamModelId}</dd><dt>有效能力</dt><dd>{capabilitySummary(effective, selected.type).join(' · ') || '未配置'}</dd></dl><footer><small>{overrides ? '模板 + 渠道差异' : '完全使用模板配置'}</small><Button variant="ghost" size="sm" onClick={() => openBinding(selected, binding)}>编辑绑定 →</Button></footer></article>; })}{!selected.bindings.length && <div className="darl-settings-empty">尚未绑定供应商。先保存模型，再添加渠道。</div>}</div>
        <div className="darl-model-note"><span>ⓘ</span><p><strong>协议与能力彼此独立。</strong> 协议适配器负责请求、上传、轮询和结果解析；能力配置只决定当前渠道可接受的输入与选项。</p></div>
      </article> : <div className="darl-settings-empty">还没有逻辑模型，请先新增一个。</div>}</div> : <div className="darl-provider-management"><div className="darl-provider-management-head"><div><h3>API 供应商</h3><p>供应商只管理 Base URL、Key 和连接状态，协议留在渠道绑定中。</p></div><Button size="sm" onClick={() => editProvider()}><Plus />添加供应商</Button></div><div className="darl-provider-cards">{providers.map((provider) => <article key={provider.id}><div><strong>{provider.name}</strong><small>{provider.baseUrl}</small><small>API Key：{provider.hasApiKey ? '已配置' : '未配置'}</small></div><span className={`darl-provider-status darl-provider-status--${provider.status || 'unknown'}`}><i />{provider.status === 'connected' ? '已连接' : provider.status === 'error' ? '连接失败' : '未测试'}</span><footer><Button variant="outline" size="sm" onClick={() => onTestConnection ? void onTestConnection(provider) : setMessage('宿主尚未接入连接测试。')}><RefreshCcw />测试连接</Button><Button variant="ghost" size="sm" onClick={() => editProvider(provider)}><Pencil />编辑</Button>{onProviderDelete && <Button variant="ghost" size="sm" aria-label={`删除供应商 ${provider.name}`} onClick={() => { if (window.confirm(`确定删除「${provider.name}」？`)) void onProviderDelete(provider.id); }}><Trash2 /></Button>}</footer></article>)}{!providers.length && <div className="darl-settings-empty">暂无供应商。添加供应商后再绑定渠道。</div>}</div></div>}

    {modelDraft && <div className="darl-model-config-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) { setModelDraft(null); setModelDraftExistingId(null); } }}><section className="darl-model-config-drawer" role="dialog" aria-modal="true" aria-labelledby="darl-model-drawer-title"><header><div><span className="darl-settings-eyebrow">CREATE LOGICAL MODEL</span><h3 id="darl-model-drawer-title">{modelDraftExistingId ? '编辑逻辑模型' : '新增逻辑模型'}</h3><p>模型名称用于展示，真实 API 名称放在渠道映射中。</p></div><Button variant="ghost" size="icon" aria-label="关闭" onClick={() => { setModelDraft(null); setModelDraftExistingId(null); }}><X /></Button></header><div className="darl-model-config-form"><Field label="显示名称"><input value={modelDraft.displayName} onChange={(event) => setModelDraft({ ...modelDraft, displayName: event.target.value })} placeholder="例如：GPT Image 2" /></Field><Field label="逻辑模型 ID" hint="稳定且唯一，不等于供应商上游模型 ID"><input value={modelDraft.id} onChange={(event) => setModelDraft({ ...modelDraft, id: event.target.value })} placeholder="例如：gpt-image-2" /></Field><Field label="模型类型"><select value={modelDraft.type} onChange={(event) => { const type = event.target.value as AgentModelType; setModelDraft({ ...modelDraft, type, capabilityTemplateId: templates.find((item) => item.type === type)?.id || '' }); }}><option value="text">文本</option><option value="image">图片</option><option value="video">视频</option><option value="audio">音频</option></select></Field><Field label="能力模板"><select value={modelDraft.capabilityTemplateId} onChange={(event) => setModelDraft({ ...modelDraft, capabilityTemplateId: event.target.value })}>{templates.filter((template) => template.type === modelDraft.type).map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}</select></Field><Field label="说明"><textarea rows={3} value={modelDraft.description} onChange={(event) => setModelDraft({ ...modelDraft, description: event.target.value })} placeholder="可选" /></Field><label className="darl-model-config-check"><input type="checkbox" checked={modelDraft.enabled} onChange={(event) => setModelDraft({ ...modelDraft, enabled: event.target.checked })} />启用这个逻辑模型</label></div><footer><Button variant="outline" onClick={() => { setModelDraft(null); setModelDraftExistingId(null); }}>取消</Button><Button disabled={busy} onClick={() => void saveModel()}>{busy ? '保存中…' : '保存模型'}</Button></footer></section></div>}
    {bindingDraft && bindingTemplate && <div className="darl-model-config-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setBindingDraft(null); }}><section className="darl-model-config-drawer" role="dialog" aria-modal="true" aria-labelledby="darl-binding-drawer-title"><header><div><span className="darl-settings-eyebrow">MODEL BINDING</span><h3 id="darl-binding-drawer-title">{bindingDraft.isNew ? '添加渠道绑定' : '编辑渠道绑定'}</h3><p>{selectedBinding?.displayName} · {bindingTemplate.name}</p></div><Button variant="ghost" size="icon" aria-label="关闭" onClick={() => setBindingDraft(null)}><X /></Button></header><div className="darl-model-config-form"><Field label="API 供应商"><select value={bindingDraft.value.providerId} onChange={(event) => setBindingDraft({ ...bindingDraft, value: { ...bindingDraft.value, providerId: event.target.value } })}><option value="">选择供应商</option>{providers.map((provider) => <option key={provider.id} value={provider.id}>{provider.name}</option>)}</select></Field><Field label="上游实际模型 ID" hint="这是供应商真正收到的 model 字段"><input list="darl-upstream-models" value={bindingDraft.value.upstreamModelId} onChange={(event) => setBindingDraft({ ...bindingDraft, value: { ...bindingDraft.value, upstreamModelId: event.target.value } })} /><datalist id="darl-upstream-models">{(catalogs[bindingDraft.value.providerId] || providers.find(provider => provider.id === bindingDraft.value.providerId)?.models || []).map(model => <option key={model.id} value={model.id}>{model.name}</option>)}</datalist>{onFetchModels && <Button variant="outline" size="sm" disabled={busy || !bindingDraft.value.providerId} onClick={() => { const provider = providers.find(item => item.id === bindingDraft.value.providerId); if (provider) void fetchCatalog(provider); }}>获取可用模型</Button>}</Field><Field label="调用协议" hint={selectedBinding?.type === 'image' || selectedBinding?.type === 'video' ? '图片和视频每个模型仅使用一个启用渠道。' : undefined}><select value={bindingDraft.value.protocolKey} onChange={(event) => setBindingDraft({ ...bindingDraft, value: { ...bindingDraft.value, protocolKey: event.target.value } })}>{bindingDraft.value.protocolKey && !protocols.some((protocol) => protocol.key === bindingDraft.value.protocolKey && protocol.implemented !== false && protocol.types.includes(selectedBinding!.type)) && <option value={bindingDraft.value.protocolKey}>当前协议（等待宿主实现）</option>}{protocols.filter((protocol) => protocol.implemented !== false && protocol.types.includes(selectedBinding!.type)).map((protocol) => <option key={protocol.key} value={protocol.key}>{protocol.label}</option>)}</select></Field><label className="darl-model-config-check"><input type="checkbox" checked={bindingDraft.value.enabled !== false} onChange={event => setBindingDraft({ ...bindingDraft, value: { ...bindingDraft.value, enabled: event.target.checked } })} />启用此渠道</label><details className="darl-binding-advanced"><summary>高级能力设置</summary><div className="darl-binding-capability-editor"><div className="darl-binding-capability-header"><div><h4>能力继承与覆盖</h4><p>不勾选则跟随模板；勾选后列表整体替换，0 和 false 也会保留。</p></div><span>最终生效预览</span></div>{selectedBinding?.type === 'text' && bindingEffective && 'reasoningEfforts' in bindingEffective && <><Field label="思考等级（逗号分隔）"><input value={listValue(bindingDraft.value.capabilityOverrides?.reasoningEfforts ?? bindingEffective.reasoningEfforts)} onChange={(event) => updateOverride('reasoningEfforts', event.target.value)} /></Field><Field label="默认思考等级"><select value={String(bindingDraft.value.capabilityOverrides?.defaultReasoningEffort ?? bindingEffective.defaultReasoningEffort)} onChange={(event) => setBindingDraft({ ...bindingDraft, value: { ...bindingDraft.value, capabilityOverrides: { ...(bindingDraft.value.capabilityOverrides || {}), defaultReasoningEffort: event.target.value } } })}>{bindingEffective.reasoningEfforts.map((effort) => <option key={effort}>{effort}</option>)}</select></Field></>}{selectedBinding?.type === 'image' && bindingEffective && 'maxReferenceImages' in bindingEffective && <><OverrideNumber label="参考图上限" field="maxReferenceImages" template={bindingTemplate.capabilities} draft={bindingDraft.value.capabilityOverrides} onToggle={() => toggleOverride('maxReferenceImages', bindingTemplate.capabilities)} onChange={(value) => updateOverride('maxReferenceImages', value, true)} /><OverrideChoices label="分辨率档位" field="resolutions" options={['1K', '2K', '4K']} template={bindingTemplate.capabilities} draft={bindingDraft.value.capabilityOverrides} onToggle={() => toggleOverride('resolutions', bindingTemplate.capabilities)} onChange={(values) => updateOverrideList('resolutions', values)} /><OverrideChoices label="支持画幅" field="aspectRatios" options={['1:1', '2:3', '3:2', '3:4', '4:3', '9:16', '16:9']} template={bindingTemplate.capabilities} draft={bindingDraft.value.capabilityOverrides} onToggle={() => toggleOverride('aspectRatios', bindingTemplate.capabilities)} onChange={(values) => updateOverrideList('aspectRatios', values)} /></>}{selectedBinding?.type === 'video' && bindingEffective && 'modes' in bindingEffective && <><OverrideNumber label="参考图片上限" field="maxReferenceImages" template={bindingTemplate.capabilities} draft={bindingDraft.value.capabilityOverrides} onToggle={() => toggleOverride('maxReferenceImages', bindingTemplate.capabilities)} onChange={(value) => updateOverride('maxReferenceImages', value, true)} /><OverrideNumber label="参考视频上限" field="maxReferenceVideos" template={bindingTemplate.capabilities} draft={bindingDraft.value.capabilityOverrides} onToggle={() => toggleOverride('maxReferenceVideos', bindingTemplate.capabilities)} onChange={(value) => updateOverride('maxReferenceVideos', value)} /><OverrideNumber label="参考音频上限" field="maxReferenceAudios" template={bindingTemplate.capabilities} draft={bindingDraft.value.capabilityOverrides} onToggle={() => toggleOverride('maxReferenceAudios', bindingTemplate.capabilities)} onChange={(value) => updateOverride('maxReferenceAudios', value, true)} /><OverrideChoices label="生成方式" field="modes" options={['text-to-video', 'first-last-frame', 'reference']} format={(value) => generationModeLabels[value] || value} template={bindingTemplate.capabilities} draft={bindingDraft.value.capabilityOverrides} onToggle={() => toggleOverride('modes', bindingTemplate.capabilities)} onChange={(values) => updateOverrideList('modes', values)} /><OverrideChoices label="分辨率" field="resolutions" options={['480P', '768P', '1080P']} template={bindingTemplate.capabilities} draft={bindingDraft.value.capabilityOverrides} onToggle={() => toggleOverride('resolutions', bindingTemplate.capabilities)} onChange={(values) => updateOverrideList('resolutions', values)} /><OverrideChoices label="画幅比例" field="aspectRatios" options={['adaptive', '21:9', '16:9', '4:3', '1:1', '3:4', '9:16']} template={bindingTemplate.capabilities} draft={bindingDraft.value.capabilityOverrides} onToggle={() => toggleOverride('aspectRatios', bindingTemplate.capabilities)} onChange={(values) => updateOverrideList('aspectRatios', values)} /></>}{bindingEffective && <div className="darl-binding-preview">{capabilitySummary(bindingEffective, selectedBinding!.type).map((item) => <span key={item}><Check />{item}</span>)}</div>}</div></details></div><footer><Button variant="outline" onClick={() => setBindingDraft(null)}>取消</Button><Button disabled={busy} onClick={() => void saveBinding()}>{busy ? '保存中…' : '保存绑定'}</Button></footer></section></div>}
    {providerDraft && <div className="darl-model-config-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setProviderDraft(null); }}><section className="darl-model-config-drawer" role="dialog" aria-modal="true" aria-labelledby="darl-provider-drawer-title"><header><div><span className="darl-settings-eyebrow">API PROVIDER</span><h3 id="darl-provider-drawer-title">{providerDraft.id ? '编辑供应商' : '添加供应商'}</h3><p>API Key 只交给宿主保存，不进入模型配置。</p></div><Button variant="ghost" size="icon" aria-label="关闭" onClick={() => setProviderDraft(null)}><X /></Button></header><div className="darl-model-config-form"><Field label="Provider ID"><input value={providerDraft.id} disabled={providers.some((provider) => provider.id === providerDraft.id)} onChange={(event) => setProviderDraft({ ...providerDraft, id: event.target.value })} placeholder="例如：darl" /></Field><Field label="显示名称"><input value={providerDraft.name} onChange={(event) => setProviderDraft({ ...providerDraft, name: event.target.value })} /></Field><Field label="Base URL"><input value={providerDraft.baseUrl} onChange={(event) => setProviderDraft({ ...providerDraft, baseUrl: event.target.value })} placeholder="https://gateway.example/v1" /></Field><Field label="API Key" hint={providerDraft.hasApiKey ? '已配置；留空则保持原 Key' : '只会发送给宿主保存回调'}><input type="password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder={providerDraft.hasApiKey ? '已配置' : '输入 Key'} /></Field><section className="darl-provider-catalog" aria-label="供应商模型目录">
      <header><strong>{catalogs[providerDraft.id] ? '可用模型（临时预览）' : '已添加的模型'}</strong>{onFetchModels && <Button variant="outline" size="sm" disabled={busy} onClick={() => void fetchCatalog(providerDraft)}>{busy ? '处理中…' : '获取可用模型'}</Button>}</header>
      <input aria-label="搜索供应商模型" placeholder="搜索模型 ID" value={catalogQuery} onChange={event => setCatalogQuery(event.target.value)} />
      <div hidden={Boolean(catalogModel)} className="darl-provider-catalog-list">{providerCatalog.filter(model => model.id.toLowerCase().includes(catalogQuery.trim().toLowerCase())).slice(0, 100).map(model => {
        const mapped = configuration.models.find(item => item.bindings.some(binding => binding.providerId === providerDraft.id && binding.upstreamModelId === model.id));
        return <div className="darl-provider-catalog-row" key={model.id}>
          <span title={model.id}>{model.id}{mapped && <small>已添加 · {mapped.displayName}</small>}</span>
          <Button variant="outline" size="sm" disabled={busy} aria-label={`${mapped ? '编辑' : '添加'}模型 ${model.id}`} onClick={() => { setCatalogModel(model); setErrors([]); setMessage(''); }}>{mapped ? '编辑' : '添加'}</Button>
        </div>;
      })}</div>
      {catalogModel && <CatalogModelEditor key={catalogModel.id} upstream={catalogModel} providerId={providerDraft.id.trim()} configuration={configuration} busy={busy} onSave={saveCatalogModel} onCancel={() => setCatalogModel(null)} />}
      {!providerCatalog.length && <p className="darl-settings-empty">尚未添加模型，可先获取可用模型。</p>}
      <small>{providerCatalog.length} 个模型；最多显示 100 条，可搜索。查询结果仅供预览，点击添加并确认后才保存。</small>
    </section>{message && <p role="status">{message}</p>}{errors.length > 0 && <p role="alert">{errors.join(' ')}</p>}</div><footer><Button variant="outline" onClick={() => setProviderDraft(null)}>取消</Button><Button disabled={busy} onClick={() => void saveProvider()}>{busy ? '保存中…' : '保存供应商'}</Button></footer></section></div>}
  </section>;
}

function CatalogModelEditor({ upstream, providerId, configuration, busy, onSave, onCancel }: {
  upstream: AgentModelConfig; providerId: string; configuration: ModelConfiguration; busy: boolean;
  onSave: (next: ModelConfiguration) => Promise<void>; onCancel: () => void;
}) {
  const known = configuration.models.find(model => model.bindings.some(binding => binding.providerId === providerId && binding.upstreamModelId === upstream.id))
    || configuration.models.find(model => model.id === upstream.id)
    || configuration.models.find(model => model.bindings.some(binding => binding.upstreamModelId === upstream.id));
  const existingBinding = known?.bindings.find(binding => binding.providerId === providerId && binding.upstreamModelId === upstream.id);
  const [id, setId] = useState(known?.id || upstream.id.replace(/[^A-Za-z0-9._:-]/g, '-').replace(/^[^A-Za-z0-9]+/, '') || 'model');
  const [name, setName] = useState(known?.displayName || upstream.name || upstream.id);
  const [type, setType] = useState<AgentModelType | ''>(known?.type || '');
  const [templateId, setTemplateId] = useState(known?.capabilityTemplateId || '');
  const [protocolKey, setProtocolKey] = useState(existingBinding?.protocolKey || known?.bindings.find(binding => binding.upstreamModelId === upstream.id)?.protocolKey || '');
  const [error, setError] = useState('');
  const protocols = configuration.protocols.filter(protocol => protocol.implemented !== false && type && protocol.types.includes(type));
  const protocol = protocolKey || protocols[0]?.key || '';
  const save = async () => {
    if (!name.trim() || !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(id.trim()) || !type || !templateId || !protocol) {
      setError('请填写名称、模型类型、参数模板和调用协议。'); return;
    }
    const next = cloneConfiguration(configuration);
    const target = next.models.find(model => model.id === id.trim());
    if (target && target.type !== type) { setError('网站模型 ID 已用于其他类型，请修改映射 ID。'); return; }
    const model: LogicalModel = target || { id: id.trim(), displayName: name.trim(), type, capabilityTemplateId: templateId, enabled: true, bindings: [] };
    const previous = model.bindings.find(binding => binding.providerId === providerId);
    const binding: ModelBinding = { ...previous, id: previous?.id || crypto.randomUUID(), providerId, upstreamModelId: upstream.id, protocolKey: protocol, enabled: true };
    model.displayName = name.trim(); model.capabilityTemplateId = templateId;
    model.bindings = [...model.bindings.filter(item => item.id !== binding.id).map(item => type === 'image' || type === 'video' ? { ...item, enabled: false } : item), binding];
    if (!target) next.models.push(model);
    setError(''); await onSave(next);
  };
  return <div className="darl-provider-model-editor" role="group" aria-label={`设置模型 ${upstream.id}`}>
    <p>实际调用模型：<strong>{upstream.id}</strong></p>
    <Field label="显示名称"><input value={name} onChange={event => setName(event.target.value)} /></Field>
    <Field label="模型类型"><select value={type} disabled={Boolean(known)} onChange={event => { setType(event.target.value as AgentModelType); setTemplateId(''); setProtocolKey(''); }}><option value="">选择模型类型</option>{Object.entries(typeLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></Field>
    {type && <><Field label="参数模板"><select value={templateId} onChange={event => setTemplateId(event.target.value)}><option value="">选择参数模板</option>{configuration.templates.filter(template => template.type === type).map(template => <option key={template.id} value={template.id}>{template.name}</option>)}</select></Field><Field label="调用协议"><select value={protocol} onChange={event => setProtocolKey(event.target.value)}>{protocols.map(item => <option key={item.key} value={item.key}>{item.label}</option>)}</select></Field></>}
    <details><summary>模型 ID 映射</summary><Field label="网站模型 ID" hint={`网站使用此 ID，供应商收到的模型 ID 是 ${upstream.id}`}><input value={id} onChange={event => setId(event.target.value)} /></Field></details>
    {error && <p role="alert">{error}</p>}
    <footer><Button variant="ghost" size="sm" disabled={busy} onClick={onCancel}>取消</Button><Button size="sm" disabled={busy} onClick={() => void save()}>{busy ? '保存中…' : existingBinding ? '保存模型' : '添加模型'}</Button></footer>
  </div>;
}

function toStringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function OverrideNumber({ label, field, template, draft, onToggle, onChange }: { label: string; field: string; template: CapabilityValues; draft?: Record<string, unknown>; onToggle: () => void; onChange: (value: string) => void }) {
  const checked = Object.prototype.hasOwnProperty.call(draft || {}, field);
  const value = checked ? draft?.[field] : (template as Record<string, unknown>)[field];
  return <div className="darl-override-row"><div><strong>{label}</strong><small>模板：{String((template as Record<string, unknown>)[field])}</small></div><label><input type="checkbox" checked={checked} onChange={onToggle} />覆盖</label><input type="number" min={0} value={String(value ?? '')} disabled={!checked} onChange={(event) => onChange(event.target.value)} /></div>;
}

function OverrideChoices({ label, field, options, template, draft, onToggle, onChange, format = (value) => value }: {
  label: string;
  field: string;
  options: string[];
  template: CapabilityValues;
  draft?: Record<string, unknown>;
  onToggle: () => void;
  onChange: (values: string[]) => void;
  format?: (value: string) => string;
}) {
  const checked = Object.prototype.hasOwnProperty.call(draft || {}, field);
  const templateValues = toStringList((template as Record<string, unknown>)[field]);
  const value = checked ? toStringList(draft?.[field]) : templateValues;
  const choices = Array.from(new Set([...options, ...templateValues, ...value]));
  return <div className="darl-override-choices">
    <div className="darl-override-choices-head">
      <div><strong>{label}</strong><small>模板：{templateValues.join(' / ') || '未配置'}</small></div>
      <label><input type="checkbox" checked={checked} onChange={onToggle} />覆盖</label>
    </div>
    <div className="darl-choice-cards" role="group" aria-label={label}>
      {choices.map((option) => {
        const selected = value.includes(option);
        return <button key={option} type="button" className="darl-choice-card" aria-pressed={selected}
          onClick={() => onChange(selected ? value.filter((item) => item !== option) : [...value, option])}>{selected && <span className="darl-choice-card-mark" aria-hidden="true">✓</span>}{format(option)}</button>;
      })}
    </div>
  </div>;
}
