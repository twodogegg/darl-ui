import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowLeft, BookOpen, Check, ChevronRight, Clipboard, Database, GitBranch, KeyRound, MessageSquare, Network, Server, ShieldCheck, Sparkles } from 'lucide-react';

const componentExample = `import { AgentSidebar } from '@darl/ui';
import '@darl/ui/styles.css';

<AgentSidebar
  open={open}
  onOpenChange={setOpen}
  sessions={sessions}
  activeSessionId={activeSessionId}
  onSessionChange={setActiveSessionId}
  onSessionRename={renameSession}
  onNewSession={createSession}
  onSend={sendMessage}
  onRegenerate={regenerateMessage}
  isGenerating={isGenerating}
  onStop={stopGeneration}
  applications={applications}
  skills={skills}
  onSkillImport={saveSkill}
  onSkillSave={saveSkill}
  onSkillDelete={deleteSkill}
  models={models}
  selectedModelId={modelId}
  onSelectedModelIdChange={setModelId}
  selectedReasoningEffort={effort}
  onSelectedReasoningEffortChange={setEffort}
/>`;

const requestExample = `POST /api/chat

{
  "providerId": "darl",
  "modelId": "deepseek-v4.1-flash",
  "messages": [
    { "role": "user", "content": "帮我整理订单" }
  ],
  "skills": []
}`;

const streamExample = `{"type":"text","text":"好的，我先"}
{"type":"text","text":"查看订单。"}
{"type":"done"}`;

const sessionExample = `type AgentSession = {
  id: string;
  title: string;
  updatedAt?: string;
  messages: AgentMessage[];
};

type AgentMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  streaming?: boolean;
};`;

function CodeBlock({ value }: { value: string }) {
  const [notice, setNotice] = useState('');
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      window.clearTimeout(timer.current);
      setNotice('已复制');
      timer.current = window.setTimeout(() => setNotice(''), 1200);
    } catch {
      window.clearTimeout(timer.current);
      setNotice('复制失败，请手动选择文本复制');
    }
  };
  return <div className="guide-code"><div className="guide-code-toolbar"><span role="status">{notice || 'example'}</span><button type="button" onClick={() => void copy()}>{notice === '已复制' ? <Check size={13} /> : <Clipboard size={13} />}{notice === '已复制' ? '已复制' : '复制'}</button></div><pre><code>{value}</code></pre></div>;
}

function FlowStep({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return <article className="guide-flow-step"><span className="guide-flow-icon">{icon}</span><div><strong>{title}</strong><p>{children}</p></div></article>;
}

export function Guide({ onBack }: { onBack: () => void }) {
  const [active, setActive] = useState('overview');
  const sections = [
    { id: 'overview', label: '先理解整体结构' },
    { id: 'component', label: '使用 AgentSidebar' },
    { id: 'backend', label: '接入真实模型' },
    { id: 'data', label: '会话与 Skills' },
    { id: 'mcp', label: '接入 MCP 应用' },
  ];
  const jump = (id: string) => { setActive(id); document.getElementById(`guide-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); };
  return <main className="example-guide">
    <header className="guide-header"><button className="guide-back darl-button darl-button--outline darl-button-size--default" onClick={onBack}><ArrowLeft size={15} />返回聊天</button><div><span className="example-eyebrow">AGENT CHAT GUIDE</span><h1>如何编写一个聊天 Agent 页面</h1><p>组件负责交互，宿主网站负责模型、会话、权限和业务工具。</p></div></header>
    <div className="guide-layout">
      <nav className="guide-nav" aria-label="开发说明导航">{sections.map((section) => <button key={section.id} type="button" aria-current={active === section.id ? 'location' : undefined} className={active === section.id ? 'is-active' : ''} onClick={() => jump(section.id)}>{section.label}<ChevronRight size={14} /></button>)}</nav>
      <div className="guide-content">
        <section id="guide-overview" className="guide-section"><div className="guide-section-kicker">01 / ARCHITECTURE</div><h2>先理解整体结构</h2><p className="guide-lead">一个可用的 Agent 页面由三层组成：页面组件、宿主服务端、模型或 MCP 服务。<code>AgentSidebar</code> 不直接保存 API Key，也不猜测你的业务接口。</p><div className="guide-flow"><FlowStep icon={<MessageSquare />} title="浏览器 / AgentSidebar">收集消息、模型、推理强度、Skill 和应用引用，展示流式结果。</FlowStep><FlowStep icon={<Server />} title="宿主服务端">校验请求、读取 API Key、保存会话，并把请求转给模型网关。</FlowStep><FlowStep icon={<Network />} title="模型与 MCP">模型生成文本；MCP 应用提供工具，服务端负责调用、确认和回传状态。</FlowStep></div><div className="guide-note"><BookOpen size={16} /><span>当前示例已经接通前两步和真实文本模型；MCP 工具执行是下一阶段接入点。</span></div></section>

        <section id="guide-component" className="guide-section"><div className="guide-section-kicker">02 / COMPONENT</div><h2>使用 AgentSidebar</h2><p className="guide-lead">宿主只需要维护会话和生成状态，把数据与回调传给组件。组件会处理历史入口、输入框、Markdown、复制、重新生成、Skill 管理和响应式布局。</p><CodeBlock value={componentExample} /><div className="guide-grid"><div className="guide-card"><Database size={17} /><strong>宿主维护</strong><p><code>sessions</code>、<code>activeSessionId</code>、<code>isGenerating</code> 和模型列表。</p></div><div className="guide-card"><GitBranch size={17} /><strong>组件回调</strong><p><code>onSend</code> 发消息，<code>onStop</code> 停止，<code>onRegenerate</code> 重新生成，<code>onSessionRename</code> 重命名。</p></div><div className="guide-card"><Sparkles size={17} /><strong>能力引用</strong><p>输入 <code>@</code> 选择应用，输入 <code>/</code> 选择 Skill；发送时得到稳定的 ID。</p></div></div></section>

        <section id="guide-backend" className="guide-section"><div className="guide-section-kicker">03 / MODEL API</div><h2>接入真实模型</h2><p className="guide-lead">浏览器不要直接携带模型 Key。推荐由服务端提供一个业务路由，例如 <code>POST /api/chat</code>，然后把 UI 请求转换为 OpenAI Completions 或 Responses 请求。</p><CodeBlock value={requestExample} /><p>示例的 <code>client/App.tsx</code> 从 <code>onSend</code> 得到消息、模型和 Skill ID，解析提供方后发送上述请求。<code>server/api.ts</code> 校验已保存的提供方和文本模型，再由 <code>server/models.ts</code> 调用上游。只有模型配置了支持的 <code>reasoningEfforts</code> 且用户选中时，才发送 <code>effort</code>。</p><div className="guide-split"><div><h3>流式返回</h3><p>上游模型返回 SSE，示例服务端将其转换为每行一个 JSON 的 NDJSON。浏览器通过 <code>stream.ts</code> 的 <code>lines()</code> 读取：收到 <code>text</code> 就追加到 assistant 消息，收到 <code>done</code> 就把 <code>streaming</code> 设为 false；<code>error</code> 或连接中断会显示失败并允许重新生成。</p><CodeBlock value={streamExample} /></div><div><h3>停止与失败</h3><p>浏览器为每次生成创建 <code>AbortController</code>。停止按钮中止浏览器请求，服务端也要把断开的响应转换为上游的 abort signal。</p><div className="guide-note guide-note--warning"><ShieldCheck size={16} /><span>API Key 只在服务端环境变量或服务端密钥存储中出现，不要放进 <code>VITE_*</code>、localStorage 或组件 props。</span></div></div></div></section>

        <section id="guide-data" className="guide-section"><div className="guide-section-kicker">04 / STATE</div><h2>会话与 Skills</h2><p className="guide-lead">会话是 UI 的最小状态单元。示例用 localStorage 方便验证，正式网站应该保存到自己的数据库或业务 API。</p><CodeBlock value={sessionExample} /><div className="guide-grid"><div className="guide-card"><KeyRound size={17} /><strong>会话持久化</strong><p>用稳定的 session ID 保存标题、消息、更新时间和模型上下文；不要只依赖页面内存。</p></div><div className="guide-card"><Sparkles size={17} /><strong>Skill 快照</strong><p>发送时把选中 Skill 的名称和指令快照传给服务端，合并到模型的系统指令。导入、保存、删除通过宿主回调持久化，附带脚本不会执行。</p></div></div></section>

        <section id="guide-mcp" className="guide-section"><div className="guide-section-kicker">05 / MCP</div><h2>接入 MCP 应用</h2><p className="guide-lead">MCP 不应该写死在聊天组件里。应用目录和工具目录由宿主提供，组件只负责选择和展示调用状态。</p><div className="guide-mcp-grid"><div><h3>服务端需要做什么</h3><ol><li>根据 <code>applicationIds</code> 找到宿主允许使用的 MCP 应用。</li><li>把工具 schema 提供给模型，或由服务端编排模型与 MCP 的多步调用。</li><li>执行前根据工具风险要求用户确认。</li><li>把应用名、工具名、参数、结果和状态写回 <code>toolCalls</code>。</li></ol></div><div><h3>组件已经准备好的结构</h3><p><code>AgentApplication</code> 描述应用和工具；<code>AgentToolCall</code> 描述 pending、running、success、error、confirmation 等状态。这样可以接入订单系统、素材平台或任何其他 MCP，而不用修改聊天 UI。</p></div></div></section>

        <section className="guide-section guide-checklist"><div className="guide-section-kicker">SHIP CHECKLIST</div><h2>上线前检查</h2><div className="guide-checklist-grid"><span><Check size={15} />API Key 只在服务端</span><span><Check size={15} />消息流式失败可恢复</span><span><Check size={15} />停止请求会中止上游</span><span><Check size={15} />会话可重命名和持久化</span><span><Check size={15} />Skill 指令经过权限校验</span><span><Check size={15} />MCP 写操作需要确认</span></div></section>
      </div>
    </div>
  </main>;
}
