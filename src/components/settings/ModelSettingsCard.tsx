import { useEffect, useMemo, useState } from 'react';
import { Check, Download, Pencil, Plus, Trash2, Wifi } from 'lucide-react';
import { Button } from '../ui/Button';
import type { AgentModelConfig, AgentModelType, ModelProvider, ModelSettingsCardProps } from './types';

const modelTypes: Array<{ id: AgentModelType; label: string }> = [
  { id: 'text', label: '文本' },
  { id: 'image', label: '图片' },
  { id: 'video', label: '视频' },
  { id: 'audio', label: '音频' },
];
const emptyProvider = (): ModelProvider => ({ id: '', name: '', baseUrl: '', protocol: 'openai-completions', models: [] });
const emptyModel = (providerId: string): AgentModelConfig => ({ id: '', name: '', type: 'text', providerId, enabled: true, reasoningEfforts: [] });

function statusLabel(status?: ModelProvider['status']) {
  if (status === 'connected') return '已连接';
  if (status === 'error') return '连接失败';
  return '未测试';
}

export function ModelSettingsCard({ providers, onProviderSave, onProviderDelete, onTestConnection, onFetchModels }: ModelSettingsCardProps) {
  const [selectedProviderId, setSelectedProviderId] = useState(providers[0]?.id || '');
  const [providerDraft, setProviderDraft] = useState<ModelProvider>(providers[0] || emptyProvider());
  const [selectedModelId, setSelectedModelId] = useState<string | null>(providers[0]?.models[0]?.id || null);
  const [modelDraft, setModelDraft] = useState<AgentModelConfig | null>(providers[0]?.models[0] || null);
  const [typeFilter, setTypeFilter] = useState<AgentModelType | 'all'>('all');
  const [message, setMessage] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [busy, setBusy] = useState<'save' | 'test' | 'fetch' | ''>('');
  const provider = providers.find((item) => item.id === selectedProviderId);
  const models = providerDraft.models || [];
  const filteredModels = useMemo(() => typeFilter === 'all' ? models : models.filter((model) => model.type === typeFilter), [models, typeFilter]);

  useEffect(() => {
    const current = providers.find((item) => item.id === selectedProviderId) || providers[0];
    if (!current) return;
    setSelectedProviderId(current.id);
    setProviderDraft({ ...current, models: current.models.map((model) => ({ ...model })) });
    const model = current.models.find((item) => item.id === selectedModelId) || current.models[0];
    setSelectedModelId(model?.id || null);
    setModelDraft(model ? { ...model } : null);
    setApiKey('');
    // Provider changes from the host are the source of truth.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [providers]);

  const selectProvider = (next: ModelProvider) => {
    setSelectedProviderId(next.id);
    setProviderDraft({ ...next, models: next.models.map((model) => ({ ...model })) });
    setApiKey('');
    const model = next.models[0];
    setSelectedModelId(model?.id || null);
    setModelDraft(model ? { ...model } : null);
    setMessage('');
  };
  const createProvider = () => {
    setSelectedProviderId('');
    setProviderDraft(emptyProvider());
    setApiKey('');
    setSelectedModelId(null);
    setModelDraft(null);
    setMessage('填写提供方信息后保存。');
  };
  const saveProvider = async () => {
    if (!providerDraft.id.trim() || !providerDraft.name.trim() || !providerDraft.baseUrl.trim()) return setMessage('请填写 Provider ID、显示名称和 API 地址。');
    setBusy('save');
    try {
      const next = { ...providerDraft, id: providerDraft.id.trim(), name: providerDraft.name.trim(), baseUrl: providerDraft.baseUrl.trim(), models: models.map((model) => ({ ...model, providerId: providerDraft.id.trim() })) };
      if (apiKey) await onProviderSave?.(next, apiKey); else await onProviderSave?.(next);
      setSelectedProviderId(next.id);
      setProviderDraft(next);
      setMessage('提供方已保存。');
    } catch (reason) { setMessage(reason instanceof Error ? reason.message : '保存提供方失败。'); }
    finally { setBusy(''); }
  };
  const testConnection = async () => {
    if (!provider) return setMessage('请先保存提供方。');
    setBusy('test');
    try { await onTestConnection?.(providerDraft); setMessage('连接测试已完成。'); }
    catch (reason) { setMessage(reason instanceof Error ? reason.message : '连接测试失败。'); }
    finally { setBusy(''); }
  };
  const fetchModels = async () => {
    if (!provider) return setMessage('请先保存提供方。');
    setBusy('fetch');
    try {
      const fetched = await onFetchModels?.(providerDraft);
      if (fetched) { setProviderDraft((current) => ({ ...current, models: fetched.map((model) => ({ ...model, providerId: current.id })) })); setMessage(`已获取 ${fetched.length} 个模型。`); }
    } catch (reason) { setMessage(reason instanceof Error ? reason.message : '获取模型失败。'); }
    finally { setBusy(''); }
  };
  const selectModel = (model: AgentModelConfig) => { setSelectedModelId(model.id); setModelDraft({ ...model }); };
  const selectType = (nextType: AgentModelType | 'all') => {
    setTypeFilter(nextType);
    const nextModel = nextType === 'all' ? models[0] : models.find((model) => model.type === nextType);
    setSelectedModelId(nextModel?.id || null);
    setModelDraft(nextModel ? { ...nextModel } : null);
  };
  const updateModelDraft = (patch: Partial<AgentModelConfig>) => setModelDraft((current) => current ? { ...current, ...patch } : current);
  const saveModel = async () => {
    if (!modelDraft?.id.trim() || !modelDraft.name.trim()) return setMessage('请填写模型 ID 和显示名称。');
    const nextModels = models.some((model) => model.id === modelDraft.id) ? models.map((model) => model.id === modelDraft.id ? modelDraft : model) : [...models, modelDraft];
    const next = { ...providerDraft, models: nextModels };
    setProviderDraft(next);
    if (apiKey) await onProviderSave?.(next, apiKey); else await onProviderSave?.(next);
    setSelectedModelId(modelDraft.id);
    setMessage('模型已保存。');
  };
  const removeModel = async () => {
    if (!modelDraft) return;
    const next = { ...providerDraft, models: models.filter((model) => model.id !== modelDraft.id) };
    setProviderDraft(next);
    setModelDraft(next.models[0] ? { ...next.models[0] } : null);
    setSelectedModelId(next.models[0]?.id || null);
    await onProviderSave?.(next);
    setMessage('模型已删除。');
  };

  return <section className="darl-model-settings-card" aria-labelledby="darl-model-settings-title">
    <header className="darl-settings-card-header"><div><span className="darl-settings-eyebrow">MODEL PROVIDERS</span><h2 id="darl-model-settings-title">模型</h2><p>配置模型提供方、模型类型和 Agent 可用能力。</p></div><Button variant="outline" size="sm" onClick={createProvider}><Plus />添加提供方</Button></header>
    <div className="darl-model-provider-list">{providers.map((item) => <button key={item.id} type="button" className={item.id === selectedProviderId ? 'is-selected' : ''} onClick={() => selectProvider(item)}><span><strong>{item.name}</strong><small>{item.id} · {item.models.length} 个模型</small></span><span className={`darl-provider-status darl-provider-status--${item.status || 'unknown'}`}><i />{statusLabel(item.status)}</span></button>)}{!providers.length && <div className="darl-settings-empty">还没有配置模型提供方。</div>}</div>
      <div className="darl-provider-editor"><div className="darl-provider-editor-heading"><div><h3>{providerDraft.name || '新建提供方'}</h3><span>{providerDraft.id || '填写 Provider ID 后保存'}</span></div>{provider && <Button variant="ghost" size="sm" onClick={() => void onProviderDelete?.(provider.id)}><Trash2 />删除</Button>}</div>
      <div className="darl-provider-form"><label><span>Provider ID</span><input value={providerDraft.id} onChange={(event) => setProviderDraft({ ...providerDraft, id: event.target.value })} placeholder="例如：darl" /></label><label><span>显示名称</span><input value={providerDraft.name} onChange={(event) => setProviderDraft({ ...providerDraft, name: event.target.value })} placeholder="例如：Darl Gateway" /></label><label className="darl-provider-form-wide"><span>API 地址</span><input value={providerDraft.baseUrl} onChange={(event) => setProviderDraft({ ...providerDraft, baseUrl: event.target.value })} placeholder="https://gateway.example/v1" /></label><label><span>API 协议</span><select value={providerDraft.protocol} onChange={(event) => setProviderDraft({ ...providerDraft, protocol: event.target.value as ModelProvider['protocol'] })}><option value="openai-completions">OpenAI Completions</option><option value="openai-responses">OpenAI Responses</option></select></label><label><span>API Key</span><input type="password" value={apiKey} placeholder={providerDraft.hasApiKey ? '已配置，输入新 Key 可替换' : '输入 API Key'} onChange={(event) => { setApiKey(event.target.value); setProviderDraft({ ...providerDraft, hasApiKey: Boolean(event.target.value) || providerDraft.hasApiKey }); }} /></label></div>
      <div className="darl-provider-actions"><Button variant="outline" size="sm" disabled={!provider || busy !== ''} onClick={() => void testConnection()}><Wifi />{busy === 'test' ? '测试中…' : '测试连接'}</Button><Button variant="outline" size="sm" disabled={!provider || busy !== ''} onClick={() => void fetchModels()}><Download />{busy === 'fetch' ? '获取中…' : '获取可用模型'}</Button><span>{message}</span><Button size="sm" disabled={busy !== ''} onClick={() => void saveProvider()}>{busy === 'save' ? '保存中…' : '保存提供方'}</Button></div>
      <div className="darl-model-catalog"><div className="darl-model-catalog-heading"><div><h3>模型目录</h3><p>每个模型都要标记类型，聊天和媒体组件会据此过滤。</p></div><Button variant="outline" size="sm" disabled={!providerDraft.id} onClick={() => { const model = emptyModel(providerDraft.id); setModelDraft(model); setSelectedModelId(null); }}><Plus />添加模型</Button></div><div className="darl-model-type-tabs" role="tablist" aria-label="模型类型">{[{ id: 'all', label: '全部' }, ...modelTypes].map((type) => <button key={type.id} type="button" role="tab" aria-selected={typeFilter === type.id} onClick={() => selectType(type.id as AgentModelType | 'all')}>{type.label}</button>)}</div><div className="darl-model-list">{filteredModels.map((model) => <button type="button" key={model.id} className={selectedModelId === model.id ? 'is-selected' : ''} onClick={() => selectModel(model)}><span><strong>{model.name}</strong><small>{model.id} · {modelTypes.find((type) => type.id === model.type)?.label}</small></span>{model.enabled !== false && <Check />}</button>)}{!filteredModels.length && <p>当前类型还没有模型。</p>}</div>
        {modelDraft && <div className="darl-model-editor"><div className="darl-model-editor-heading"><h4>{modelDraft.id ? '编辑模型' : '添加模型'}</h4>{modelDraft.id && <Button variant="ghost" size="sm" onClick={() => void removeModel()}><Trash2 />删除</Button>}</div><div className="darl-model-form"><label><span>模型 ID</span><input value={modelDraft.id} onChange={(event) => updateModelDraft({ id: event.target.value })} placeholder="例如：deepseek-v4.1-flash" /></label><label><span>显示名称</span><input value={modelDraft.name} onChange={(event) => updateModelDraft({ name: event.target.value })} placeholder="例如：DeepSeek V4 Flash" /></label><label><span>模型类型</span><select value={modelDraft.type} onChange={(event) => updateModelDraft({ type: event.target.value as AgentModelType })}>{modelTypes.map((type) => <option key={type.id} value={type.id}>{type.label}</option>)}</select></label><label><span>推理强度</span><input value={(modelDraft.reasoningEfforts || []).join(', ')} onChange={(event) => updateModelDraft({ reasoningEfforts: event.target.value.split(',').map((item) => item.trim()).filter(Boolean) })} placeholder="低, 中, 高" /></label></div><label className="darl-model-enabled"><input type="checkbox" checked={modelDraft.enabled !== false} onChange={(event) => updateModelDraft({ enabled: event.target.checked })} />启用这个模型</label><div className="darl-model-editor-footer"><Button onClick={() => void saveModel()}><Pencil />保存模型</Button></div></div>}
      </div>
    </div>
  </section>;
}
