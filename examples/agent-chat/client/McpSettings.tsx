import { useEffect, useState } from 'react';

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
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  return data;
}

export function McpSettings({ applications, onChanged }: Props) {
  const [catalog, setCatalog] = useState<McpApp[]>(applications);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [name, setName] = useState('');
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
  async function create(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError('');
    try {
      await request('/api/applications', 'POST', { id, name, url, ...(apiKey ? { apiKey } : {}) });
      setId(''); setName(''); setUrl(''); setApiKey('');
      onChanged();
    } catch (reason) { setError(reason instanceof Error ? reason.message : '添加失败'); }
    finally { setLoading(false); }
  }
  async function remove(idToRemove: string) {
    if (!window.confirm('确定要移除此 MCP 连接吗？')) return;
    setLoading(true);
    try { await request(`/api/applications/${encodeURIComponent(idToRemove)}`, 'DELETE'); onChanged(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : '移除失败'); }
    finally { setLoading(false); }
  }
  return <section className="example-applications">
    <h2>应用 / MCP</h2>
    <p>管理 Streamable HTTP MCP 连接。工具定义来自服务器动态发现，密钥仅交给本地服务端保存，不会在页面回显。</p>
    <form onSubmit={(event) => void create(event)} style={{ display: 'grid', gap: 10, maxWidth: 620, marginBottom: 24 }}>
      <h3>添加 MCP 服务</h3>
      <label>应用 ID <input required pattern="[A-Za-z0-9_-]{1,80}" value={id} onChange={(event) => setId(event.target.value)} placeholder="assets" /></label>
      <label>应用名称 <input required value={name} onChange={(event) => setName(event.target.value)} placeholder="素材管理" /></label>
      <label>MCP URL <input required type="url" value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://example.com/mcp" /></label>
      <label>Bearer Token（可选） <input type="password" autoComplete="off" value={apiKey} onChange={(event) => setApiKey(event.target.value)} /></label>
      <button disabled={loading} type="submit">保存连接</button>
    </form>
    <button disabled={loading} onClick={() => void discover(catalog, true)}>{loading ? '正在连接…' : '刷新连接与工具目录'}</button>
    {error && <p role="alert">{error}</p>}
    {!catalog.length && <p>暂无 MCP 应用，请先添加。</p>}
    {catalog.map((app) => <article key={app.id}>
      <h3>{app.name} · {app.status === 'connected' ? '已连接' : '未连接'}</h3>
      <p>{app.description || '尚未读取工具目录'} · {app.tools?.length || 0} 个工具</p>
      <button disabled={loading} onClick={() => void remove(app.id)}>移除</button>
      {app.tools?.map((tool) => <details key={tool.name} style={{ margin: '12px 0' }}>
        <summary><strong>{tool.title || tool.name}</strong> · {tool.risk === 'read' ? '只读' : tool.risk === 'dangerous' ? '危险操作（需确认）' : '执行前确认'}</summary>
        <p>{tool.description || '无描述'}</p>
        <p>工具标识：<code>{tool.name}</code></p>
        <h4>输入参数（JSON Schema）</h4>
        <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{JSON.stringify(tool.inputSchema || {}, null, 2)}</pre>
        {tool.outputSchema && <><h4>输出定义</h4><pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{JSON.stringify(tool.outputSchema, null, 2)}</pre></>}
        {tool.annotations && <><h4>工具注解</h4><pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{JSON.stringify(tool.annotations, null, 2)}</pre></>}
      </details>)}
    </article>)}
  </section>;
}
