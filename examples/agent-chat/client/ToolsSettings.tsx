import { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, ChevronDown, CircleAlert, Search, ShieldCheck, Wrench } from 'lucide-react';

type JsonSchema = Record<string, unknown>;
type ToolRisk = 'read' | 'write' | 'dangerous';
type ToolDescriptor = {
  name: string;
  title?: string;
  description?: string;
  risk?: ToolRisk;
  inputSchema?: JsonSchema;
  outputSchema?: JsonSchema;
  annotations?: JsonSchema;
  appId: string;
  appName: string;
  source: 'builtin';
};

/** Presentation only; name, description and schema come from the server. */
const PRESENTATION: Record<string, { title: string; risk: ToolRisk; actions: string }> = {
  builtin_generate_media: { title: '提交媒体生成任务', risk: 'write', actions: '需要有效的媒体模型绑定；图片和视频可在二次确认设置中调整。' },
  builtin_get_media_task: { title: '查询媒体任务状态', risk: 'read', actions: '只读取本机媒体任务，不会创建新的生成任务。' },
};

/** The same MEDIA_TOOLS the model receives, so this page cannot drift from it. */
type ServerTool = { name: string; description?: string; inputSchema?: JsonSchema };

function descriptor(tool: ServerTool): ToolDescriptor {
  const meta = PRESENTATION[tool.name] ?? { title: tool.name, risk: 'write', actions: '' };
  return {
    name: tool.name,
    title: meta.title,
    description: tool.description,
    risk: meta.risk,
    inputSchema: tool.inputSchema,
    appId: 'builtin:media',
    appName: '内置 / 媒体生成',
    source: 'builtin',
  };
}

const riskLabels: Record<ToolRisk, string> = { read: '只读', write: '执行前确认', dangerous: '高风险' };

function formatJson(value: unknown) {
  return JSON.stringify(value ?? {}, null, 2);
}

function schemaSummary(schema: JsonSchema | undefined) {
  const properties = schema?.properties;
  if (!properties || typeof properties !== 'object' || Array.isArray(properties)) return '无参数';
  const names = Object.keys(properties as Record<string, unknown>);
  return names.length ? `${names.length} 个参数 · ${names.join('、')}` : '无参数';
}

function riskIcon(risk: ToolRisk | undefined) {
  if (risk === 'dangerous') return <CircleAlert aria-hidden="true" />;
  if (risk === 'read') return <CheckCircle2 aria-hidden="true" />;
  return <ShieldCheck aria-hidden="true" />;
}

export function ToolsSettings() {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<'all' | 'write' | 'read'>('all');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [builtinTools, setBuiltinTools] = useState<ToolDescriptor[]>([]);
  const [loadError, setLoadError] = useState('');

  useEffect(() => {
    let cancelled = false;
    fetch('/api/tools')
      .then((response) => response.ok ? response.json() : Promise.reject(new Error(`HTTP ${response.status}`)))
      .then((tools: ServerTool[]) => { if (!cancelled) setBuiltinTools(tools.map(descriptor)); })
      .catch((reason) => { if (!cancelled) setLoadError(reason instanceof Error ? reason.message : '读取工具定义失败'); });
    return () => { cancelled = true; };
  }, []);

  const tools = useMemo(() => builtinTools.filter((tool) => {
    if (filter !== 'all' && tool.risk !== filter) return false;
    const text = `${tool.title || ''} ${tool.name} ${tool.description || ''} ${tool.appName}`.toLowerCase();
    return !query.trim() || text.includes(query.trim().toLowerCase());
  }), [builtinTools, filter, query]);

  return <section className="darl-tools-settings" aria-labelledby="darl-tools-settings-title">
    <header className="darl-tools-settings__header">
      <div>
        <span className="example-eyebrow">BUILT-IN TOOLS</span>
        <h2 id="darl-tools-settings-title">Tools</h2>
        <p>查看网站助手内置的工具、参数 schema 和执行配置。MCP 工具请在「应用 / MCP」页面管理和查看。</p>
      </div>
    </header>
    {loadError && <p role="alert">无法读取工具定义：{loadError}</p>}

    <div className="darl-tools-stats" aria-label="工具统计">
      <div><span>可用工具</span><strong>{builtinTools.length}</strong></div>
      <div><span>内置工具</span><strong>{builtinTools.length}</strong></div>
      <div><span>需要确认</span><strong>{builtinTools.filter((tool) => tool.risk === 'write').length}</strong></div>
      <div><span>只读工具</span><strong>{builtinTools.filter((tool) => tool.risk === 'read').length}</strong></div>
    </div>

    <div className="darl-tools-toolbar">
      <label><Search size={15} aria-hidden="true" /><span className="darl-visually-hidden">搜索工具</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索名称或描述" /></label>
      <div className="darl-tools-filters" role="tablist" aria-label="工具来源">
        {([['all', '全部'], ['write', '需确认'], ['read', '只读']] as const).map(([value, label]) => <button key={value} type="button" role="tab" aria-selected={filter === value} onClick={() => setFilter(value)}>{label}<small>{value === 'all' ? builtinTools.length : builtinTools.filter((tool) => tool.risk === value).length}</small></button>)}
      </div>
    </div>

    <div className="darl-tools-list">
      {tools.map((tool) => {
        const key = `${tool.appId}:${tool.name}`;
        const isExpanded = expanded === key;
        return <article key={key} className="darl-tool-card">
          <button type="button" className="darl-tool-card__summary" onClick={() => setExpanded(isExpanded ? null : key)} aria-expanded={isExpanded}>
            <span className="darl-tool-card__icon"><Wrench aria-hidden="true" /></span>
            <span className="darl-tool-card__identity"><strong>{tool.title || tool.name}</strong><code>{tool.name}</code><small>{tool.appName}</small></span>
            <span className={`darl-tool-risk darl-tool-risk--${tool.risk || 'write'}`}>{riskIcon(tool.risk)}{riskLabels[tool.risk || 'write']}</span>
            <ChevronDown aria-hidden="true" className={`darl-tool-chevron ${isExpanded ? 'is-open' : ''}`} />
          </button>
          <div className="darl-tool-card__meta"><span>内置工具</span><span>{schemaSummary(tool.inputSchema)}</span></div>
          {isExpanded && <div className="darl-tool-card__details">
            <p>{tool.description || '此工具没有提供描述。'}</p>
            <div className="darl-tool-schema-grid">
              <div><h3>输入参数</h3><pre>{formatJson(tool.inputSchema)}</pre></div>
            </div>
            <div className="darl-tool-config"><span>配置</span><strong>{PRESENTATION[tool.name]?.actions || '—'}</strong></div>
          </div>}
        </article>;
      })}
      {!tools.length && <div className="darl-tools-empty"><Wrench size={22} /><strong>没有匹配的工具</strong><span>尝试清空搜索条件。</span></div>}
    </div>
  </section>;
}
