import { useMemo, useState } from 'react';
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

const builtinTools: ToolDescriptor[] = [
  {
    name: 'builtin_generate_media',
    title: '提交媒体生成任务',
    description: '向后台提交一条图片或视频生成任务。仅支持 gpt-image-2 图片和 minimax-h3-flash 视频。调用前必须明确用户的生成意图，提交遵循项目二次确认设置。返回任务 ID，不等待媒体完成。',
    risk: 'write',
    appId: 'builtin:media',
    appName: '内置 / 媒体生成',
    source: 'builtin',
    inputSchema: {
      type: 'object',
      properties: {
        modelId: { type: 'string', enum: ['gpt-image-2', 'minimax-h3-flash'] },
        prompt: { type: 'string', minLength: 1, maxLength: 16000 },
        options: {
          type: 'object',
          properties: { size: { type: 'string' }, resolution: { type: 'string' }, aspectRatio: { type: 'string' }, duration: { type: 'integer' } },
          additionalProperties: false,
        },
      },
      required: ['modelId', 'prompt'],
      additionalProperties: false,
    },
    outputSchema: { type: 'object', properties: { id: { type: 'string' }, status: { type: 'string' }, message: { type: 'string' } } },
  },
  {
    name: 'builtin_get_media_task',
    title: '查询媒体任务状态',
    description: '按后台生成任务 ID 查询图片或视频的真实状态与结果路径，不会触发新的付费生成。',
    risk: 'read',
    appId: 'builtin:media',
    appName: '内置 / 媒体生成',
    source: 'builtin',
    inputSchema: { type: 'object', properties: { taskId: { type: 'string', minLength: 36, maxLength: 36 } }, required: ['taskId'], additionalProperties: false },
    outputSchema: { type: 'object', properties: { id: { type: 'string' }, status: { type: 'string' }, modelId: { type: 'string' }, error: { type: 'string' }, resultUrl: { type: 'string' } } },
  },
];

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

  const tools = useMemo(() => builtinTools.filter((tool) => {
    if (filter !== 'all' && tool.risk !== filter) return false;
    const text = `${tool.title || ''} ${tool.name} ${tool.description || ''} ${tool.appName}`.toLowerCase();
    return !query.trim() || text.includes(query.trim().toLowerCase());
  }), [filter, query]);

  return <section className="darl-tools-settings" aria-labelledby="darl-tools-settings-title">
    <header className="darl-tools-settings__header">
      <div>
        <span className="example-eyebrow">BUILT-IN TOOLS</span>
        <h2 id="darl-tools-settings-title">Tools</h2>
        <p>查看网站助手内置的工具、参数 schema 和执行配置。MCP 工具请在「应用 / MCP」页面管理和查看。</p>
      </div>
    </header>

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
              <div><h3>输出与注解</h3><pre>{formatJson(tool.outputSchema || tool.annotations || {})}</pre></div>
            </div>
            <div className="darl-tool-config"><span>配置</span><strong>{tool.name === 'builtin_generate_media' ? '需要有效的媒体模型绑定；图片和视频可在二次确认设置中调整。' : '只读取本机媒体任务，不会创建新的生成任务。'}</strong></div>
          </div>}
        </article>;
      })}
      {!tools.length && <div className="darl-tools-empty"><Wrench size={22} /><strong>没有匹配的工具</strong><span>尝试清空搜索条件。</span></div>}
    </div>
  </section>;
}
