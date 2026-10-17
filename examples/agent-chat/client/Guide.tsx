import { useEffect, useRef, useState, type ReactNode } from 'react';
import { AlertTriangle, ArrowLeft, BookOpen, Check, ChevronRight, Clipboard, Database, Gauge, GitBranch, ImagePlus, KeyRound, Link2, MessageSquare, Network, Server, Settings2, ShieldCheck, Sparkles } from 'lucide-react';

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
  onToolConfirm={confirmToolCall}
  isGenerating={isGenerating}
  onStop={stopGeneration}
  applications={applications}
  skills={skills}
  onSkillImport={importSkill}
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
  "skills": [],
  "applicationIds": []
}`;

const modelConfigExample = `// 宿主保存配置，组件只负责编辑和展示
<ModelManagementCard
  configuration={modelConfiguration}
  providers={providers}
  onSave={saveModelConfiguration}
  onProviderSave={saveProvider}
/>

// 聊天列表使用同一份配置生成可用模型
const models = toAgentModels(modelConfiguration, providers);`;

const longTextExample = `【原著正文】
${'{原著内容，由宿主持久化或本轮提交}'}

【任务】
请按场次、人物、动作和对白改写为剧本，保留关键情节，先输出结构再输出正文。`;

const h3Example = `// 新版统一视频协议
await upload('/v1/files');
const file = await resolvePublicUrl(fileId);
const task = await fetch('/v1/videos', {
  body: { model: 'minimax-h3-flash', prompt, resolution: '768', aspect_ratio: '9:16' },
});`;

const streamExample = `{"type":"text","text":"好的，我先"}
{"type":"text","text":"查看订单。"}
{"type":"done"}`;

const imageExample = `onSend={async ({ content, attachments }) => {
  await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: content },
          ...(attachments ?? []).map((image) => ({
            type: 'image', name: image.name,
            mimeType: image.type, data: image.data,
          })),
        ],
      }],
    }),
  });
}}`;

const imageStreamExample = `{"type":"image","image":{"name":"结果.png","type":"image/png","url":"data:image/png;base64,..."}}
{"type":"text","text":"这是工具返回的图片。"}
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
  attachments?: Array<{ name: string; type?: string; url?: string }>;
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
    { id: 'principles', label: '设计理念与基本使用' },
    { id: 'model-config', label: '模型配置与长文本' },
    { id: 'component', label: '使用 AgentSidebar' },
    { id: 'backend', label: '接入真实模型' },
    { id: 'images', label: '图片附件与视觉输入' },
    { id: 'data', label: '会话与 Skills' },
    { id: 'mcp', label: '接入 MCP 应用' },
  ];
  const jump = (id: string) => { setActive(id); document.getElementById(`guide-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); };
  return <main className="example-guide">
    <header className="guide-header"><button className="guide-back darl-button darl-button--outline darl-button-size--default" onClick={onBack}><ArrowLeft size={15} />返回聊天</button><div><span className="example-eyebrow">AGENT CHAT GUIDE</span><h1>如何编写一个聊天 Agent 页面</h1><p>组件负责交互，宿主网站负责模型、会话、权限和业务工具。</p></div></header>
    <div className="guide-layout">
      <nav className="guide-nav" aria-label="开发说明导航">{sections.map((section) => <button key={section.id} type="button" aria-current={active === section.id ? 'location' : undefined} className={active === section.id ? 'is-active' : ''} onClick={() => jump(section.id)}>{section.label}<ChevronRight size={14} /></button>)}</nav>
      <div className="guide-content">
        <section id="guide-overview" className="guide-section"><div className="guide-section-kicker">01 / ARCHITECTURE</div><h2>先理解整体结构</h2><p className="guide-lead">一个可用的 Agent 页面由三层组成：页面组件、宿主服务端、模型或 MCP 服务。<code>AgentSidebar</code> 不直接保存 API Key，也不猜测你的业务接口。</p><div className="guide-flow"><FlowStep icon={<MessageSquare />} title="浏览器 / AgentSidebar">收集消息、图片附件、模型、推理强度、Skill 和应用引用，展示流式结果。</FlowStep><FlowStep icon={<Server />} title="宿主服务端">校验请求、读取 API Key、保存会话，并把文本或视觉输入转给模型网关。</FlowStep><FlowStep icon={<Network />} title="模型与 MCP">模型生成文本或处理图片；MCP 应用提供工具，服务端负责调用、确认和回传状态。</FlowStep></div><div className="guide-note"><BookOpen size={16} /><span>当前示例已接通真实文本模型、图片输入和远程 MCP。聊天组件仍由宿主传入应用目录和执行结果。</span></div></section>

        <section id="guide-principles" className="guide-section"><div className="guide-section-kicker">02 / PRINCIPLES</div><h2>设计理念与基本使用</h2><p className="guide-lead">聊天 Agent 页面只负责把任务交给正确的能力，并把过程清楚地展示出来。界面组件负责输入、会话、附件、流式状态和确认交互；宿主服务端负责模型、鉴权、会话存储、MCP 连接和业务权限。</p><div className="guide-grid"><div className="guide-card"><strong>主 Agent 与子 Agent</strong><p>用户在聊天底部选择主 Agent。主 Agent 根据任务决定是否委派给其他已启用的 Agent；子 Agent 只收到委派任务和自己的提示词、Skill、MCP 能力，完成后返回摘要。</p></div><div className="guide-card"><strong>权限与启用分开</strong><p>Agent 配置里的 MCP 应用表示“允许使用”。只有用户本轮通过 <code>@</code> 选择应用，或历史消息仍在使用该应用时，服务端才建立连接；没有选择就不会自动连接。</p></div><div className="guide-card"><strong>先说明范围，再调用工具</strong><p>查询类请求要把范围说清楚，例如“我的素材”与“公开素材”是不同查询。工具卡片显示应用、工具、委派任务和状态，普通 MCP 参数与原始结果不直接展示。</p></div></div><div className="guide-split"><div><h3>最短使用流程</h3><ol><li>在「设置 → 模型」保存并启用文本模型。</li><li>在「设置 → Agents」配置角色和允许使用的 MCP 应用；模型与推理等级在聊天输入框旁选择，Skills 在「设置 → Skills」统一管理。</li><li>回到聊天选择主 Agent；需要工具或 Skill 时输入 <code>@</code> 选择应用或 Skill；同一会话引用一次后会持续使用。</li><li>用自然语言描述目标。主 Agent 会直接回答，或按需调用工具、委派子 Agent。</li><li>检查流式文本和工具卡片；写操作在服务端确认后才执行。</li></ol></div><div><h3>示例请求</h3><CodeBlock value={'@素材中心 搜索公开素材库中的场景素材，然后请美术 Agent 按结果整理一份拍摄参考。'} /><p className="guide-lead">如果只想聊天，不要引用 MCP 应用；Agent 会在没有工具连接的情况下回答。</p></div></div></section>

        <section id="guide-model-config" className="guide-section"><div className="guide-section-kicker">03 / MODEL CONFIGURATION</div><h2>模型配置、长文本与路由</h2><p className="guide-lead">把“模型叫什么”和“怎么调用”分开管理。逻辑模型负责产品语义，能力模板描述上下文、视觉、推理和媒体能力，渠道绑定负责供应商、上游模型 ID、协议与覆盖项。</p><CodeBlock value={modelConfigExample} /><div className="guide-grid"><div className="guide-card"><Settings2 size={17} /><strong>逻辑模型</strong><p>配置层使用稳定的逻辑模型 ID；绑定负责生成页面可用模型，宿主路由再取 providerId、bindingId 和 upstreamModelId。一个逻辑模型可以保存多个绑定，当前聊天列表只展示协议已实现且已启用的绑定。</p></div><div className="guide-card"><Gauge size={17} /><strong>能力模板</strong><p><code>contextWindow</code>、<code>vision</code>、<code>tools</code> 和 <code>reasoningEfforts</code> 都从模板继承；覆盖数组时整体替换，<code>0</code> 与 <code>false</code> 也会保留。</p></div><div className="guide-card"><Link2 size={17} /><strong>渠道绑定</strong><p>绑定保存 Provider、真实上游模型 ID 和已实现协议。没有可用绑定的模型不会进入聊天列表，避免页面显示无法调用的模型。</p></div></div><div className="guide-split"><div><h3>小说转剧本的长文本流程</h3><p>文本模型默认按 1M token 上下文预算处理，也可以在能力模板中设置更小的 <code>contextWindow</code>。累计上下文超过预算 50% 后，服务端主动压缩较早历史，保留当前消息和最近上下文；不会再使用固定的 100000 字符上限截断正文。</p><CodeBlock value={longTextExample} /></div><div><h3>推荐的宿主边界</h3><ol><li>原著正文作为当前任务输入，或由宿主持久化后按章节加载。</li><li>把改写规则、输出格式和角色要求放在任务说明中，不要混入模型配置。</li><li>长任务分阶段输出：先场次表，再逐场生成，最后统一校对。</li><li>如果历史过长，服务端会压缩旧对话；当前正文和最近指令优先保留。</li></ol><div className="guide-note"><BookOpen size={16} /><span>页面不限制小说长度；真正的上限由所选模型的 <code>contextWindow</code>、请求体和上游网关共同决定。</span></div></div></div><div className="guide-note guide-note--warning"><AlertTriangle size={16} /><span>不要把 1M 当成所有模型都支持的承诺。模型能力必须来自已保存配置，服务端仍会按当前绑定校验。</span></div><div className="guide-split"><div><h3>H3 Flash 视频模型</h3><p>视频模型沿用逻辑模型与绑定结构，当前适配新版统一协议：先通过 <code>/v1/files</code> 上传并解析为公网 URL，再提交 <code>/v1/videos</code>。支持 480/768 分辨率、16:9 和 9:16；首尾帧字段在网关合同确认前保持未启用。</p><CodeBlock value={h3Example} /></div><div><h3>不要猜协议字段</h3><p>服务端只发送已确认的字段和当前能力模板允许的值。不要把旧版 megapixels、猜测的首尾帧字段或本地文件路径直接塞进视频请求；失败时把上游错误原样转换为可读的 Agent 错误。</p></div></div></section>

        <section id="guide-component" className="guide-section"><div className="guide-section-kicker">04 / COMPONENT</div><h2>使用 AgentSidebar</h2><p className="guide-lead">宿主只需要维护会话和生成状态，把数据与回调传给组件。组件会处理历史入口、输入框、图片附件预览、Markdown、复制、重新生成、能力引用和响应式布局；Skills 在「设置 → Skills」管理。</p><CodeBlock value={componentExample} /><div className="guide-grid"><div className="guide-card"><Database size={17} /><strong>宿主维护</strong><p><code>sessions</code>、<code>activeSessionId</code>、<code>isGenerating</code> 和模型列表。</p></div><div className="guide-card"><GitBranch size={17} /><strong>组件回调</strong><p><code>onSend</code> 发消息，<code>onStop</code> 停止，<code>onRegenerate</code> 重新生成，<code>onSessionRename</code> 重命名。</p></div><div className="guide-card"><Sparkles size={17} /><strong>能力引用</strong><p>输入 <code>@</code> 选择应用或 Skill；发送时得到稳定的 ID，同一会话只需引用一次。图片附件通过 <code>attachments</code> 传递。</p></div></div></section>

        <section id="guide-backend" className="guide-section"><div className="guide-section-kicker">05 / MODEL API</div><h2>接入真实模型</h2><p className="guide-lead">浏览器不要直接携带模型 Key。推荐由服务端提供一个业务路由，例如 <code>POST /api/chat</code>，然后把 UI 请求转换为 OpenAI Completions 或 Responses 请求。</p><CodeBlock value={requestExample} /><p>示例的 <code>client/App.tsx</code> 从 <code>onSend</code> 得到消息、模型和 Skill ID，解析提供方后发送上述请求。<code>server/api.ts</code> 校验已保存的提供方和文本模型，从本地 SQLite 读取系统提示词（首次由 <code>prompts/system.md</code> 初始化），追加选中的 Skill 指令，再由 <code>server/models.ts</code> 使用 AI SDK Core 调用上游、校验工具参数并执行多步循环。模型与推理等级由聊天输入框旁的当前选择决定，Agent 页面只保存提示词和 MCP 权限；Skills 在「设置 → Skills」统一管理，自动调用默认开启。选中 Agent 后，服务端会把其他已启用的 Agent 作为可委派工具，用 AI SDK 7 <code>ToolLoopAgent</code> 创建隔离上下文，子 Agent 只接收任务说明并返回摘要。只有模型配置了支持的 <code>reasoningEfforts</code> 且用户选中时，才发送 <code>effort</code>。上下文默认按 1M token 预算处理，也可以在模型能力里设置 <code>contextWindow</code>。累计上下文超过预算 50% 后，服务端会主动压缩较早历史，保留当前消息和最近上下文；不会用固定 100000 字符上限截断小说正文。</p><div className="guide-split"><div><h3>流式返回</h3><p>AI SDK 解析上游流，宿主将文本、工具和图片事件转换为每行一个 JSON 的 NDJSON；思考事件不会作为聊天正文显示。浏览器通过 <code>stream.ts</code> 的 <code>lines()</code> 读取：收到 <code>text</code> 就追加到 assistant 消息，收到 <code>tool</code> 就按调用 ID 更新工具卡片，收到 <code>done</code> 就把 <code>streaming</code> 设为 false；<code>error</code> 或连接中断会显示失败并允许重新生成。</p><CodeBlock value={streamExample} /></div><div><h3>停止与失败</h3><p>浏览器为每次生成创建 <code>AbortController</code>。停止按钮中止浏览器请求，服务端把断开的响应转换为 abort signal，同时停止 AI SDK Agent 和 MCP 调用。</p><div className="guide-note guide-note--warning"><ShieldCheck size={16} /><span>API Key 只在服务端环境变量或服务端密钥存储中出现，不要放进 <code>VITE_*</code>、浏览器存储或组件 props。</span></div></div></div></section>

        <section id="guide-images" className="guide-section"><div className="guide-section-kicker">06 / VISION INPUT</div><h2>图片附件与视觉输入</h2><p className="guide-lead">图片由浏览器读取为 data URL，组件先显示缩略图，再通过 <code>AgentSendRequest.attachments</code> 交给宿主。图片消息可以没有文字，宿主需要把它转换为模型支持的视觉内容。</p><CodeBlock value={imageExample} /><div className="guide-split"><div><h3>模型设置</h3><p>在「设置 → 模型」编辑文本模型，开启「支持图片输入（vision）」。服务端会根据模型能力决定是否把图片加入 AI SDK 的模型消息，明确关闭 vision 的模型会返回可读错误。</p><div className="guide-note"><ImagePlus size={16} /><span>支持 PNG、JPEG、WebP 和 GIF。请求体限制为 80MB，单张图片最多 50 MiB，经过服务端校验后才会进入模型上下文。</span></div></div><div><h3>图片结果</h3><p>MCP 返回的 image block 会作为 <code>image</code> 流事件回到 assistant 消息，组件通过 <code>AgentMessage.attachments</code> 渲染内联预览。</p><CodeBlock value={imageStreamExample} /></div></div><div className="guide-note guide-note--warning"><AlertTriangle size={16} /><span>如果出现「无法连接模型服务」，先检查本地 Agent 服务是否运行在 5197 端口，再检查 API 地址、网络代理和模型提供方状态。失败消息支持重新生成，不会清空当前草稿。</span></div></section>

        <section id="guide-data" className="guide-section"><div className="guide-section-kicker">07 / STATE</div><h2>会话与 Skills</h2><p className="guide-lead">会话是 UI 的最小状态单元。示例通过本机服务端 API 保存到 SQLite，刷新页面或重启开发服务后仍可恢复。工具记录仅显示调用名称和状态，不展示原始结果；需要执行确认时才展示参数。</p><CodeBlock value={sessionExample} /><div className="guide-grid"><div className="guide-card"><KeyRound size={17} /><strong>会话持久化</strong><p>用稳定的 session ID 保存标题、消息、更新时间和模型上下文；不要只依赖页面内存。图片 URL 可以保存为业务文件地址，避免把大段 data URL 写入数据库。</p></div><div className="guide-card"><Sparkles size={17} /><strong>Skill 快照</strong><p>发送时把选中 Skill 的名称和指令快照传给服务端，合并到模型的系统指令。导入、保存、删除通过宿主回调持久化，附带脚本不会执行。</p></div></div></section>

        <section id="guide-mcp" className="guide-section"><div className="guide-section-kicker">08 / MCP</div><h2>接入 MCP 应用</h2><p className="guide-lead">MCP 不应该写死在聊天组件里。应用目录和工具目录由宿主提供，组件只负责选择和展示调用状态。</p><div className="guide-mcp-grid"><div><h3>服务端需要做什么</h3><ol><li>合并本轮 <code>applicationIds</code> 与用户历史消息中的应用引用，再从宿主配置中查找 MCP 应用。</li><li>把 MCP 工具转换为 AI SDK 动态工具，保留动态 schema 和宿主执行回调，由 AI SDK 管理模型与工具的多步循环。</li><li>执行前根据工具风险要求用户确认；通过 <code>onToolConfirm</code> 回调提交允许或拒绝，服务端验证后继续。</li><li>把应用名、工具名、参数、结果和状态写回 <code>toolCalls</code>；MCP image block 单独发为图片事件。</li></ol></div><div><h3>组件已经准备好的结构</h3><p><code>AgentApplication</code> 描述应用和工具；<code>AgentToolCall</code> 描述 pending、running、success、error、confirmation 等状态。示例从服务端的 <code>.local/agent-chat/applications.json</code> 读取连接，用官方 MCP SDK 动态发现工具。可在设置的「应用 / MCP」里重新连接。当前支持 Streamable HTTP 与可选 Bearer 凭证，OAuth、stdio 和 MCP 内嵌界面尚未接入。</p></div></div></section>

        <section className="guide-section guide-checklist"><div className="guide-section-kicker">SHIP CHECKLIST</div><h2>上线前检查</h2><div className="guide-checklist-grid"><span><Check size={15} />API Key 只在服务端</span><span><Check size={15} />图片附件可选并可预览</span><span><Check size={15} />视觉模型能力已开启</span><span><Check size={15} />消息流式失败可恢复</span><span><Check size={15} />停止请求会中止上游</span><span><Check size={15} />会话可重命名和持久化</span><span><Check size={15} />Skill 指令经过权限校验</span><span><Check size={15} />MCP 写操作需要确认</span></div></section>
      </div>
    </div>
  </main>;
}
