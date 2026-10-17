import { useEffect, useState } from 'react';
import { CheckCircle2, ExternalLink, KeyRound, Pencil, Plus, RefreshCw, ShieldCheck, Trash2 } from 'lucide-react';
import { Button } from '../../../src/components/ui/Button';

interface McpTool {
  name: string;
  title?: string;
  description?: string;
  risk?: 'read' | 'write' | 'dangerous';
  inputSchema?: unknown;
  outputSchema?: unknown;
  annotations?: unknown;
}
interface McpApp {
  id: string;
  name: string;
  description?: string;
  url?: string;
  status?: string;
  tools?: McpTool[];
}
interface Props {
  applications: McpApp[];
  onChanged: () => void;
}

async function request(path: string, method = 'GET', body?: unknown) {
  const response = await fetch(path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof data.error === 'string' ? data.error : `HTTP ${response.status}`);
  return data;
}

function formatJson(value: unknown) {
  try { return JSON.stringify(value, null, 2) ?? ''; }
  catch { return '[无法显示]'; }
}

function statusLabel(status?: string) {
  if (status === 'connected') return '已连接';
  if (status === 'needs-auth') return '需要授权';
  return '未连接';
}

function ToolDetails({ tool }: { tool: McpTool }) {
  const output = tool.outputSchema !== undefined && tool.outputSchema !== null
    ? <><h5>输出 Schema</h5><pre>{formatJson(tool.outputSchema)}</pre></>
    : null;
  const annotations = tool.annotations !== undefined && tool.annotations !== null
    ? <><h5>工具注解</h5><pre>{formatJson(tool.annotations)}</pre></>
    : null;
  return (
    <details className="darl-mcp-tool">
      <summary>
        <strong>{tool.title || tool.name}</strong>
        <span>{tool.risk === 'read' ? '只读' : tool.risk === 'dangerous' ? '危险操作' : '执行前确认'}</span>
      </summary>
      <p>{tool.description || '无描述'}</p>
      <code>{tool.name}</code>
      <h5>输入 JSON Schema</h5>
      <pre>{formatJson(tool.inputSchema || {})}</pre>
      {output}
      {annotations}
    </details>
  );
}

export function McpSettings({ applications, onChanged }: Props) {
  const [catalog, setCatalog] = useState<McpApp[]>(applications);
  const [loading, setLoading] = useState(false);
  const [oauthBusy, setOauthBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [name, setName] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [id, setId] = useState('');
  const [url, setUrl] = useState('');
  const [apiKey, setApiKey] = useState('');

  useEffect(() => { setCatalog(applications); }, [applications]);

  async function discover(apps: McpApp[], refresh = false) {
    setLoading(true);
    setError('');
    try {
      const results = await Promise.all(apps.map(async (app) =>
        request(`/api/applications/${encodeURIComponent(app.id)}/tools${refresh ? '?refresh=1' : ''}`)));
      setCatalog(results);
    } catch (reason) { setError(reason instanceof Error ? reason.message : '工具目录读取失败'); }
    finally { setLoading(false); }
  }

  useEffect(() => { if (applications.length) void discover(applications); }, [applications]);

  useEffect(() => {
    const onMessage = (event: MessageEvent<{ type?: string; appId?: string; ok?: boolean }>) => {
      if (event.origin !== window.location.origin || event.data?.type !== 'mcp-oauth-complete') return;
      setOauthBusy(null);
      if (event.data.ok) { setMessage(`${event.data.appId || 'MCP'} 已授权，正在读取工具目录。`); onChanged(); }
      else setError('OAuth 授权未完成，请检查授权窗口中的提示。');
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [onChanged]);

  async function startOAuth(app: McpApp) {
    const popup = window.open('about:blank', '_blank');
    setOauthBusy(app.id); setError(''); setMessage('正在准备 OAuth 授权…');
    try {
      const result = await request(`/api/applications/${encodeURIComponent(app.id)}/oauth/start`, 'POST') as { authorized?: boolean; authorizationUrl?: string };
      if (result.authorized) {
        setMessage(`${app.name} 已授权，正在刷新工具目录。`); onChanged(); return;
      }
      if (!result.authorizationUrl) throw new Error('服务端没有返回授权地址');
      if (popup) popup.location.href = result.authorizationUrl;
      else window.location.href = result.authorizationUrl;
      setMessage('请在新窗口完成授权，完成后此页面会自动刷新。');
    } catch (reason) {
      popup?.close();
      setError(reason instanceof Error ? reason.message : 'OAuth 授权启动失败');
    } finally { if (!popup) setOauthBusy(null); }
  }

  async function saveConnection(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true); setError(''); setMessage('');
    try {
      await request(editing ? `/api/applications/${encodeURIComponent(editing)}` : '/api/applications', editing ? 'PUT' : 'POST', { id, name, url, ...(apiKey ? { apiKey } : {}) });
      setId(''); setName(''); setUrl(''); setApiKey(''); setEditing(null);
      setMessage('MCP 连接已保存。'); onChanged();
    } catch (reason) { setError(reason instanceof Error ? reason.message : '保存失败'); }
    finally { setLoading(false); }
  }

  async function remove(idToRemove: string) {
    if (!window.confirm('确定要移除此 MCP 连接吗？')) return;
    setLoading(true); setError('');
    try { await request(`/api/applications/${encodeURIComponent(idToRemove)}`, 'DELETE'); setMessage('MCP 连接已移除。'); onChanged(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : '移除失败'); }
    finally { setLoading(false); }
  }

  return <section className="darl-mcp-settings" aria-labelledby="darl-mcp-settings-title">
    <header className="darl-mcp-settings__header">
      <div><span className="darl-settings-eyebrow">MCP CONNECTIONS</span><h2 id="darl-mcp-settings-title">应用 / MCP</h2><p>连接由本地服务端保存。Bearer Token 只写入服务端配置；支持 OAuth 的服务可从这里完成授权。</p></div>
      <span className="darl-mcp-settings__security"><ShieldCheck aria-hidden="true" />本地密钥存储</span>
    </header>
    <div className="darl-mcp-settings__grid">
      <form className="darl-mcp-card darl-mcp-form" onSubmit={(event) => void saveConnection(event)}>
        <div className="darl-mcp-card__header"><div><h3>{editing ? '编辑连接' : '添加 MCP 连接'}</h3><p>支持 Streamable HTTP MCP 地址。</p></div><KeyRound aria-hidden="true" /></div>
        <label className="darl-mcp-field"><span>应用 ID</span><input required disabled={!!editing} pattern="[A-Za-z0-9_-]{1,80}" value={id} onChange={(event) => setId(event.target.value)} placeholder="notion" /></label>
        <label className="darl-mcp-field"><span>显示名称</span><input required value={name} onChange={(event) => setName(event.target.value)} placeholder="Notion" /></label>
        <label className="darl-mcp-field"><span>MCP URL</span><input required type="url" value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://mcp.notion.com/mcp" /></label>
        <label className="darl-mcp-field"><span>Bearer Token <small>可选</small></span><input type="password" autoComplete="off" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder="OAuth 服务无需填写" /></label>
        <div className="darl-mcp-form__actions"><Button type="submit" disabled={loading}><Plus data-icon="inline-start" />{editing ? '保存修改' : '保存连接'}</Button>{editing && <Button variant="outline" onClick={() => { setEditing(null); setId(''); setName(''); setUrl(''); setApiKey(''); }}>取消</Button>}</div>
      </form>
      <div className="darl-mcp-card darl-mcp-catalog">
        <div className="darl-mcp-card__header"><div><h3>已配置连接</h3><p>{catalog.length ? `${catalog.length} 个连接，工具按需发现。` : '还没有 MCP 连接。'}</p></div><Button variant="outline" size="sm" disabled={loading} onClick={() => void discover(catalog, true)}><RefreshCw data-icon="inline-start" />刷新</Button></div>
        {message && <p className="darl-settings-message" role="status">{message}</p>}
        {error && <p className="darl-settings-errors" role="alert">{error}</p>}
        {!catalog.length && <div className="darl-mcp-empty">添加连接后，会在这里显示状态和动态工具目录。</div>}
        <div className="darl-mcp-list">{catalog.map((app) => <article className="darl-mcp-connection" key={app.id}>
          <div className="darl-mcp-connection__head"><div><h4>{app.name}</h4><code>{app.id}</code></div><span className={`darl-mcp-status darl-mcp-status--${app.status || 'disconnected'}`}>{app.status === 'connected' && <CheckCircle2 aria-hidden="true" />}{statusLabel(app.status)}</span></div>
          <p>{app.url || '未提供地址'} · {app.tools?.length || 0} 个工具</p>
          <div className="darl-mcp-connection__actions"><Button variant="outline" size="sm" onClick={() => void startOAuth(app)} disabled={loading || oauthBusy === app.id}><ExternalLink data-icon="inline-start" />{oauthBusy === app.id ? '等待授权…' : 'OAuth 授权'}</Button><Button variant="ghost" size="sm" onClick={() => { setEditing(app.id); setId(app.id); setName(app.name); setUrl(app.url || ''); setApiKey(''); }}><Pencil data-icon="inline-start" />编辑</Button><Button variant="ghost" size="sm" onClick={() => void remove(app.id)}><Trash2 data-icon="inline-start" />移除</Button></div>
          {app.tools?.map((tool) => <ToolDetails key={tool.name} tool={tool} />)}
        </article>)}</div>
      </div>
    </div>
  </section>;
}
