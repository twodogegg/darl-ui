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
  onSessionDelete={deleteSession}
  onNewSession={createSession}
  onSend={sendMessage}
  voice={voiceAdapter}
  onRegenerate={regenerateMessage}
  onToolConfirm={confirmToolCall}
  approvalMode={approvalMode}
  onApprovalModeChange={saveApprovalMode}
  approvalModePending={approvalModePending}
  isGenerating={isGenerating}
  onStop={stopGeneration}
  agents={agents}
  applications={applications}
  skills={skills}
  onSkillImport={importSkill}
  onSkillCreate={startSkillCreationChat}
  uploadAttachment={uploadAttachment}
  models={models}
  selectedModelId={modelId}
  onSelectedModelIdChange={setModelId}
  selectedReasoningEffort={effort}
  onSelectedReasoningEffortChange={setEffort}
/>`;

const requestExample = `POST /api/chat

{
  "sessionId": "session-id",
  "agentId": "default",
  "approvalMode": "auto",
  "providerId": "configured-provider-id",
  "modelId": "deepseek-v4.1-flash",
  "messages": [
    { "role": "user", "content": "帮我整理订单" }
  ],
  "skillIds": [],
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

const h3Example = `// 新版统一视频协议：素材上传返回不透明 id，创建时原样回传
const asset = await upload('/v1/h3/assets');            // { id, type, expires_in }
const task = await fetch('/v1/videos', {
  body: {
    model: 'minimax-h3-flash',                          // 或 minimax-h3-standard
    prompt, seconds: 5, size: '768P', ratio: '16:9',    // 480P / 768P / 1080P（Standard 无 1080P）
    metadata: { first_frame_image: asset.id },          // 首尾帧；不能与 images / 参考音视频混用
  },
});`;

const streamExample = `{"type":"meta","requestId":"request-id","runId":"run-id"}
{"type":"text","text":"正在创建技能。"}
{"type":"tool","call":{"id":"call-id","appId":"builtin:runtime","appName":"内置 / Skill 与执行环境","toolName":"builtin_create_skill","toolTitle":"创建 / 安装 Skill","status":"success"}}
{"type":"skills-changed"}
{"type":"done"}

// 开启语音模式时，Agent 分别生成文字与语音文案
{"type":"output","output":{"output_type":"text","content":"适合阅读的完整内容"}}
{"type":"output","output":{"output_type":"speech","content":"适合听的交流内容"}}
{"type":"done"}`;

const imageExample = `// 在完整聊天请求中转换附件；沿用 sessionId、模型和历史
const images = (request.attachments ?? []).map((image) => ({
  type: 'image', name: image.name,
  mimeType: image.type, data: image.data, size: image.size,
}));
const message = {
  role: 'user',
  content: [
    { type: 'text', text: request.content },
    ...images,
  ],
};
// 已上传图片优先传 fileId，避免重复发送大段 data URL：
// { type: 'image', name, mimeType, fileId, data: '', size }
// 非图片文件作为文件引用交给 Agent 的 import_file 工具。`;

const imageStreamExample = `{"type":"image","image":{"name":"结果.png","type":"image/png","url":"data:image/png;base64,..."}}
{"type":"text","text":"这是工具返回的图片。"}
{"type":"done"}`;

const sessionExample = `type AgentSession = {
  id: string;
  title: string;
  agentId?: string; // 从广场选择后固定，不在聊天内切换
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

const startExample = `npm install
npm run dev

# 真实聊天网站：http://localhost:5197/
# 组件 Playground：http://localhost:5188/
# 固定端口被占用时会报错，不自动换端口。

# 接入时优先阅读这些现有文件：
examples/agent-chat/client/App.tsx           # UI 状态、发送与流事件
examples/agent-chat/server/api.ts            # 校验、工具与 Agent 编排
examples/agent-chat/server/models.ts         # 模型协议与工具循环
examples/agent-chat/server/skill-runtime.ts  # 文件与命令执行
examples/agent-chat/server/skill-library.ts  # 网站技能库
examples/agent-chat/prompts/                 # 宿主指令与创建入口文案`;

const skillCreationExample = `// 两个入口共用一个宿主回调
<AgentSidebar
  // ...其他必要 props
  onSkillCreate={startSkillCreationChat}
/>
<SkillManager
  // ...其他必要 props
  onCreateViaChat={startSkillCreationChat}
  createViaChatDisabled={isGenerating}
/>

// startSkillCreationChat：
// 1. 新建绑定当前 Agent 的会话，保留原聊天和草稿。
// 2. 发送 prompts/create-skill.md 中的开场请求。
// 3. 显式引用 builtin:skill-creator，由真实模型询问需求。
// 4. Agent 创建或下载包，调用 builtin_create_skill 安装。
// 5. 收到 skills-changed 后 GET /api/skills 更新列表。`;

const skillsApiExample = `GET    /api/state       // 会话 + 当前技能目录
POST   /api/state       // { sessions, activeId }，只写会话
GET    /api/skills      // 当前网站 Skills 库，含默认 skill-creator
POST   /api/skills      // { skill }，手动新建、编辑、导入或收藏
DELETE /api/skills/:id  // 删除自定义 Skill

// Agent 创建 / 安装：工作区内的目录、SKILL.md 或 ZIP
builtin_create_skill({ path: 'drafts/my-skill' })
// 更新已有技能必须指定 ID 和当前版本
builtin_create_skill({ path: 'drafts/my-skill',
  skillId: 'existing-skill-id', expectedVersion: '1.0' })`;

const collaborationExample = `// UI 显示名称，正文保存稳定 ID；中文和特殊字符需编码
[设计 Agent](agent:designer)
[素材应用](app:assets)
[整理技能](skill:summary)

// Agent 引用：本轮授权联系该对象，不切换当前会话身份。
// app / skill 引用：可从该会话的用户历史延续。
// 服务端校验 Agent 是否存在、启用、可调用且不是当前 Agent。`;

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
    { id: 'skill-creation', label: '通过对话创建 Skills' },
    { id: 'runtime', label: '执行环境与审批' },
    { id: 'collaboration', label: '@ Agent 协作' },
    { id: 'mcp', label: '接入 MCP 应用' },
  ];
  const jump = (id: string) => { setActive(id); document.getElementById(`guide-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); };
  return <main className="example-guide">
    <header className="guide-header"><button className="guide-back darl-button darl-button--outline darl-button-size--default" onClick={onBack}><ArrowLeft size={15} />返回聊天</button><div><span className="example-eyebrow">AGENT CHAT GUIDE</span><h1>如何编写一个聊天 Agent 页面</h1><p>组件负责交互，宿主网站负责模型、会话、权限和业务工具。</p></div></header>
    <div className="guide-layout">
      <nav className="guide-nav" aria-label="开发说明导航">{sections.map((section) => <button key={section.id} type="button" aria-current={active === section.id ? 'location' : undefined} className={active === section.id ? 'is-active' : ''} onClick={() => jump(section.id)}>{section.label}<ChevronRight size={14} /></button>)}</nav>
      <div className="guide-content">
        <section id="guide-overview" className="guide-section"><div className="guide-section-kicker">01 / ARCHITECTURE</div><h2>先理解整体结构</h2><p className="guide-lead">一个可用的 Agent 页面由三层组成：页面组件、宿主服务端、模型或 MCP 服务。<code>AgentSidebar</code> 不直接保存 API Key，也不猜测你的业务接口。</p><div className="guide-flow"><FlowStep icon={<MessageSquare />} title="浏览器 / AgentSidebar">收集消息、图片附件、模型、推理强度、Skill 和应用引用，展示流式结果。</FlowStep><FlowStep icon={<Server />} title="宿主服务端">校验请求、读取 API Key、保存会话，并把文本或视觉输入转给模型网关。</FlowStep><FlowStep icon={<Network />} title="模型与 MCP">模型生成文本或处理图片；MCP 应用提供工具，服务端负责调用、确认和回传状态。</FlowStep></div><div className="guide-note"><BookOpen size={16} /><span>当前示例已接通真实模型、附件、MCP、本机执行、Skill 创建和 Agent 协作。复用服务端示例即可获得这些能力；单独引入 UI 组件不会自动获得运行环境。</span></div><h3>先运行，再接入宿主</h3><CodeBlock value={startExample} /><p>先在设置中保存提供方和模型绑定，再从 Agent 广场选择角色发起一轮真实请求。接入自己的 React 网站时复用公开组件 API；会话、工具执行和存储接口由宿主实现，可从上述真实示例逐步迁移。</p></section>

        <section id="guide-principles" className="guide-section"><div className="guide-section-kicker">02 / PRINCIPLES</div><h2>设计理念与基本使用</h2><p className="guide-lead">聊天 Agent 页面只负责把任务交给正确的能力，并把过程清楚地展示出来。界面组件负责输入、会话、附件、流式状态和确认交互；宿主服务端负责模型、鉴权、会话存储、MCP 连接和业务权限。</p><div className="guide-grid"><div className="guide-card"><strong>主 Agent 与子 Agent</strong><p>用户从 Agent 广场选择主 Agent 并开启新对话，当前会话的身份固定；聊天顶部显示对应头像和名称。主 Agent 根据任务决定是否委派给其他已启用的 Agent；子 Agent 只收到委派任务和自己的提示词、Skill、MCP 能力，完成后返回摘要。</p></div><div className="guide-card"><strong>按需连接</strong><p>MCP 应用对所有 Agent 默认可用，无需在 Agent 里逐个授权。只有用户本轮通过 <code>@</code> 选择应用，或历史消息仍在使用该应用时，服务端才建立连接；没有选择就不会自动连接。</p></div><div className="guide-card"><strong>先说明范围，再调用工具</strong><p>查询类请求要把范围说清楚，例如“我的素材”与“公开素材”是不同查询。工具卡片显示应用、工具、委派任务和状态，普通 MCP 参数与原始结果不直接展示。</p></div></div><div className="guide-split"><div><h3>最短使用流程</h3><ol><li>在「设置 → 模型」保存并启用文本模型。</li><li>在「设置 → Agents」配置角色和提示词；模型与推理等级在聊天输入框旁的同一个菜单选择，Skills 在「设置 → Skills」统一管理，MCP 应用在「设置 → 应用 / MCP」接入，默认对所有 Agent 可用。</li><li>从 Agent 广场选择主 Agent 开始新对话；需要工具或 Skill 时输入 <code>@</code> 联系其他 Agent，或选择应用和 Skill；应用与 Skill 引用可随会话延续；联系其他 Agent 以本轮提及为准。</li><li>用自然语言描述目标。主 Agent 会实际联系本轮 @ 的 Agent 并汇总结果，也可以按需调用工具、委派子 Agent。同一对象可继续追问，当前主 Agent 身份保持不变。</li><li>检查流式文本和工具卡片；写操作按服务端当前审批模式执行。</li></ol></div><div><h3>示例请求</h3><CodeBlock value={'@素材中心 搜索公开素材库中的场景素材，然后请美术 Agent 按结果整理一份拍摄参考。'} /><p className="guide-lead">没有引用 MCP 应用时不会新建该应用连接，宿主提供的内置工具及可调用子 Agent 仍可能按任务使用。</p></div></div></section>

        <section id="guide-model-config" className="guide-section"><div className="guide-section-kicker">03 / MODEL CONFIGURATION</div><h2>模型配置、长文本与路由</h2><p className="guide-lead">把“模型叫什么”和“怎么调用”分开管理。逻辑模型负责产品语义，能力模板描述上下文、视觉、推理和媒体能力，渠道绑定负责供应商、上游模型 ID、协议与覆盖项。</p><CodeBlock value={modelConfigExample} /><div className="guide-grid"><div className="guide-card"><Settings2 size={17} /><strong>逻辑模型</strong><p>配置层使用稳定的逻辑模型 ID；绑定负责生成页面可用模型，宿主路由再取 providerId、bindingId 和 upstreamModelId。一个逻辑模型可以保存多个绑定，当前聊天列表只展示协议已实现且已启用的绑定。</p></div><div className="guide-card"><Gauge size={17} /><strong>能力模板</strong><p><code>contextWindow</code>、<code>vision</code>、<code>tools</code> 和 <code>reasoningEfforts</code> 都从模板继承；覆盖数组时整体替换，<code>0</code> 与 <code>false</code> 也会保留。</p></div><div className="guide-card"><Link2 size={17} /><strong>渠道绑定</strong><p>绑定保存 Provider、真实上游模型 ID 和已实现协议。没有可用绑定的模型不会进入聊天列表，避免页面显示无法调用的模型。</p></div></div><div className="guide-split"><div><h3>小说转剧本的长文本流程</h3><p>文本模型默认按 1M token 上下文预算处理，也可以在能力模板中设置更小的 <code>contextWindow</code>。累计上下文超过预算 50% 后，服务端主动压缩较早历史，保留当前消息和最近上下文；不会再使用固定的 100000 字符上限截断正文。</p><CodeBlock value={longTextExample} /></div><div><h3>推荐的宿主边界</h3><ol><li>原著正文作为当前任务输入，或由宿主持久化后按章节加载。</li><li>把改写规则、输出格式和角色要求放在任务说明中，不要混入模型配置。</li><li>长任务分阶段输出：先场次表，再逐场生成，最后统一校对。</li><li>如果历史过长，服务端会压缩旧对话；当前正文和最近指令优先保留。</li></ol><div className="guide-note"><BookOpen size={16} /><span>页面不限制小说长度；真正的上限由所选模型的 <code>contextWindow</code>、请求体和上游网关共同决定。</span></div></div></div><div className="guide-note guide-note--warning"><AlertTriangle size={16} /><span>不要把 1M 当成所有模型都支持的承诺。模型能力必须来自已保存配置，服务端仍会按当前绑定校验。</span></div><div className="guide-split"><div><h3>H3 Flash / Standard 视频模型</h3><p>视频模型沿用逻辑模型与绑定结构，两个模型共用新版统一协议：先通过 <code>/v1/h3/assets</code> 上传素材得到不透明 id，再提交 <code>/v1/videos</code>，按 <code>/v1/videos/:id</code> 轮询并从 <code>/content</code> 下载。支持 480P/768P/1080P（Standard 仅 480P、768P）、adaptive/21:9/16:9/4:3/1:1/3:4/9:16 画幅，以及首尾帧、参考图片、参考视频和参考音频。</p><CodeBlock value={h3Example} /></div><div><h3>不要猜协议字段</h3><p>服务端只发送已确认的字段和当前能力模板允许的值。不要把旧版 megapixels、猜测的首尾帧字段或本地文件路径直接塞进视频请求；失败时把上游错误原样转换为可读的 Agent 错误。</p></div></div></section>

        <section id="guide-component" className="guide-section"><div className="guide-section-kicker">04 / COMPONENT</div><h2>使用 AgentSidebar</h2><p className="guide-lead">宿主只需要维护会话和生成状态，把数据与回调传给组件。组件会处理历史入口、输入框、图片附件预览、Markdown、复制、重新生成、能力引用和响应式布局；Skills 在「设置 → Skills」管理。</p><CodeBlock value={componentExample} /><div className="guide-grid"><div className="guide-card"><Database size={17} /><strong>宿主维护</strong><p><code>sessions</code>、<code>activeSessionId</code>、<code>isGenerating</code> 和模型列表。</p></div><div className="guide-card"><GitBranch size={17} /><strong>组件回调</strong><p><code>onSend</code> 发消息，<code>onStop</code> 停止，<code>onRegenerate</code> 重新生成，<code>onSessionRename</code> 重命名。</p></div><div className="guide-card"><Sparkles size={17} /><strong>能力引用</strong><p>输入 <code>@</code> 联系 Agent 或引用应用、Skill；正文保存稳定 ID。应用和 Skill 可从用户历史延续；其他主 Agent 仅在本轮显式提及时联系。图片支持内联附件或上传后的 fileId。</p></div></div></section>

        <section id="guide-backend" className="guide-section"><div className="guide-section-kicker">05 / MODEL API</div><h2>接入真实模型</h2><p className="guide-lead">浏览器不要直接携带模型 Key。推荐由服务端提供一个业务路由，例如 <code>POST /api/chat</code>，然后把 UI 请求转换为 OpenAI Completions 或 Responses 请求。</p><CodeBlock value={requestExample} /><p>请求中的会话必须已有固定 Agent；providerId 和 modelId 来自启用的模型绑定，approvalMode 必须与服务端已保存值一致。示例 ID 需要替换为实际配置。</p><p>示例的 <code>client/App.tsx</code> 从 <code>onSend</code> 得到消息、模型和 Skill ID，解析提供方后发送上述请求。<code>server/api.ts</code> 校验已保存的提供方和文本模型，从本地 SQLite 读取系统提示词（首次由 <code>prompts/system.md</code> 初始化），提供 Skill 名称与描述目录，由模型按需加载完整指令和资源，再由 <code>server/models.ts</code> 使用 AI SDK Core 调用上游、校验工具参数并执行多步循环。模型与推理等级由聊天输入框旁的当前选择决定，Agent 页面保存角色、提示词和上下文策略；Skills 在「设置 → Skills」统一管理，自动调用默认开启。服务端把可调用子 Agent 和本轮 @ 的其他 Agent 转为委派工具，用 AI SDK 7 <code>ToolLoopAgent</code> 运行各自的任务上下文。任务携带的上下文范围取决于配置，独立历史按主会话和调用双方隔离。只有模型配置了支持的 <code>reasoningEfforts</code> 且用户选中时，才发送 <code>effort</code>。上下文默认按 1M token 预算处理，也可以在模型能力里设置 <code>contextWindow</code>。累计上下文超过预算 50% 后，服务端会主动压缩较早历史，保留当前消息和最近上下文；不会用固定 100000 字符上限截断小说正文。</p><div className="guide-split"><div><h3>流式返回</h3><p>AI SDK 解析上游流，宿主将文本、工具和图片事件转换为每行一个 JSON 的 NDJSON；内部推理事件不会作为聊天正文显示；工具调用前后的普通中间文字保存为执行过程中的“过程说明”，最后一步的回复保留在正文。浏览器通过 <code>stream.ts</code> 的 <code>lines()</code> 读取：收到 <code>text</code> 就追加到 assistant 消息，收到 <code>tool</code> 就按调用 ID 更新工具卡片，收到 <code>execution</code> 更新运行时间线；其中 <code>source: commentary</code> 将当前中间文字移入过程说明并清空临时正文，收到 <code>skills-changed</code> 重新读取技能目录，收到 <code>done</code> 就把 <code>streaming</code> 设为 false；<code>error</code> 或连接中断会显示失败并允许重新生成。</p><CodeBlock value={streamExample} /></div><div><h3>停止与失败</h3><p>浏览器为每次生成创建 <code>AbortController</code>。停止按钮中止浏览器请求，服务端把断开的响应转换为 abort signal，同时停止模型请求、委派和本轮运行中的命令。用户拒绝和主动停止显示 cancelled；实际命令失败或网络错误才显示错误。</p><div className="guide-note guide-note--warning"><ShieldCheck size={16} /><span>API Key 只在服务端环境变量或服务端密钥存储中出现，不要放进 <code>VITE_*</code>、浏览器存储或组件 props。</span></div></div></div></section>

        <section id="guide-images" className="guide-section"><div className="guide-section-kicker">06 / VISION INPUT</div><h2>图片附件与视觉输入</h2><p className="guide-lead">组件支持图片缩略图和纯图片消息。未提供上传适配器时，图片通过 attachments 传给宿主；提供 uploadAttachment 时，宿主先调用文件服务并返回 fileId 和访问地址，通过 uploadedAttachments 发送。当前真实示例使用后者，普通文档也能作为附件交给执行工具。</p><CodeBlock value={imageExample} /><div className="guide-split"><div><h3>模型设置</h3><p>在「设置 → 模型」编辑文本模型，开启「支持图片输入（vision）」。服务端会根据模型能力决定是否把图片加入 AI SDK 的模型消息，明确关闭 vision 的模型会返回可读错误。</p><div className="guide-note"><ImagePlus size={16} /><span>支持 PNG、JPEG、WebP 和 GIF。请求体限制为 80MB，单张图片最多 50 MiB，经过服务端校验后才会进入模型上下文。</span></div></div><div><h3>图片结果</h3><p>MCP 返回的 image block 会作为 <code>image</code> 流事件回到 assistant 消息，组件通过 <code>AgentMessage.attachments</code> 渲染内联预览。</p><CodeBlock value={imageStreamExample} /></div></div><div className="guide-note guide-note--warning"><AlertTriangle size={16} /><span>如果出现「无法连接模型服务」，先检查本地 Agent 服务是否运行在 5197 端口，再检查 API 地址、网络代理和模型提供方状态。失败消息支持重新生成，不会清空当前草稿。</span></div></section>

        <section id="guide-data" className="guide-section"><div className="guide-section-kicker">07 / STATE</div><h2>会话与 Skills</h2><p className="guide-lead">会话是 UI 的最小状态单元。示例通过本机服务端 API 保存到 SQLite，刷新页面或重启开发服务后仍可恢复。工具记录仅显示调用名称和状态，不展示原始结果；需要执行确认时才展示参数。</p><CodeBlock value={sessionExample} /><div className="guide-grid"><div className="guide-card"><KeyRound size={17} /><strong>会话持久化</strong><p>用稳定的 session ID 保存标题、固定 agentId、消息与更新时间。聊天自动保存只提交 sessions 和 activeId，Skills 单独写入，避免旧会话状态覆盖新技能。重新生成会从被点击回复前的用户消息重跑，保留更早历史；不会回滚真实文件、已执行操作或子 Agent 的独立历史。</p></div><div className="guide-card"><Sparkles size={17} /><strong>Skill 按需加载</strong><p>浏览器发送 Skill ID，服务端从 SQLite 读取当前技能目录。模型按需读取完整指令和资源，使用通用文件、Shell 和进程工具执行。输入框提供请求批准、帮我批准、完全访问三档；默认自动批准工作区文件操作，复杂命令和未知操作仍询问。模式保存在服务端，主 Agent 与子 Agent 共用，下一轮生效。命令运行在本机后端，没有操作系统沙箱。文件可通过交付工具生成下载链接。导入本身不执行脚本。默认提供 skill-creator；可以对话描述需求创建技能，或发送链接让 Agent 下载完整技能包，再调用创建 / 安装工具写入网站 Skills 库。网站技能由独立接口持久化，聊天自动保存不会覆盖它们。</p></div></div></section>

        <section id="guide-skill-creation" className="guide-section">
          <div className="guide-section-kicker">08 / SKILL CREATION</div><h2>通过对话创建 Skills</h2>
          <p className="guide-lead">创建指南负责教 Agent 如何设计技能，工具负责把结果真正装进网站。默认的 skill-creator 包含上游完整指令、脚本、参考资料与许可证，按需加载，不会把全部资源塞进每轮上下文。</p>
          <CodeBlock value={skillCreationExample} />
          <div className="guide-grid">
            <div className="guide-card"><strong>自然语言创建</strong><p>用户在「选择 Skill」弹层或管理窗口点击「通过对话创建」，Agent 先询问目标，再根据回答生成 SKILL.md 和必要资源；需求已经充分时可以直接完成。普通聊天中也可直接提出创建要求。</p></div>
            <div className="guide-card"><strong>提供链接安装</strong><p>Agent 使用现有命令工具下载完整技能包，再调用同一个创建 / 安装工具。GitHub 的 SKILL.md 链接需要连同其目录里的脚本、引用和许可一起获取；仅回复正文或创建文件不代表已经安装。</p></div>
            <div className="guide-card"><strong>共用网站技能库</strong><p>手动导入和 Agent 安装复用格式、路径、文件大小校验及保存逻辑，安装成功当轮即可加载，刷新后仍保留。默认不写电脑全局技能目录，安装阶段不执行包内脚本。</p></div>
          </div>
          <h3>保存与同步的接口</h3><CodeBlock value={skillsApiExample} />
          <p>同包重复安装返回已有 ID；同名不同内容不能静默覆盖，Agent 更新需提供当前版本。内置技能内容只读，可修改收藏和自动调用设置。skill-creator 的 Claude CLI 专属评测仍需要对应软件与账号；宿主没有提供的能力不能声称已经可用。</p>
        </section>

        <section id="guide-runtime" className="guide-section">
          <div className="guide-section-kicker">09 / EXECUTION</div><h2>执行环境与审批</h2>
          <p className="guide-lead">运行命令需要服务端提供真实执行环境。当前示例直接使用后端机器，工作区按聊天和 Agent 分目录，同一聊天中的同一个 Agent 会复用文件；它不是虚拟机或操作系统沙箱。</p>
          <div className="guide-split"><div><h3>复用现有工具</h3><ol>
            <li><code>list_skills / load_skill</code> 发现技能并按需展开完整包。</li>
            <li><code>list_files / read_file / write_file</code> 操作工作区，<code>import_file</code> 读取已上传附件。</li>
            <li><code>run_command</code> 执行 CLI、Node.js 或 Python；返回 running 后继续用 <code>process_status</code> 查询真实输出和退出码。</li>
            <li><code>publish_file</code> 返回可下载的业务文件地址；不要把本机路径当成浏览器下载链接。</li>
          </ol></div><div><h3>服务端落实审批</h3><ul>
            <li><strong>请求批准（ask）</strong>：只读工具直接执行，其余操作请求确认。</li>
            <li><strong>帮我批准（auto）</strong>：工作区文件操作、新增 Skill、识别出的简单只读命令，以及明确标记为非破坏且封闭的 MCP 写操作自动执行。复杂命令、未知操作、覆盖技能与付费生成仍询问。</li>
            <li><strong>完全访问（full）</strong>：在宿主工具权限范围内直接执行。</li>
          </ul></div></div>
          <p>模式通过 <code>/api/approval-settings</code> 保存；每轮开始读取同一份设置，主 Agent 与子 Agent 共用。需要确认时服务端暂停调用，浏览器提交 <code>POST /api/tool-confirmations/:id</code>，正文为 <code>{'{ approved: true }'}</code> 或 false。前端显示按钮不能代替服务端权限检查。</p>
          <div className="guide-note guide-note--warning"><ShieldCheck size={16} /><span>文件工具限制工作区路径，但 Shell 仍拥有后端系统用户权限。审批策略只决定是否询问，不提供进程或网络隔离；把示例接入多用户服务时，需要在宿主侧增加身份、资源授权与隔离执行环境。</span></div>
        </section>

        <section id="guide-collaboration" className="guide-section">
          <div className="guide-section-kicker">10 / AGENT COLLABORATION</div><h2>@ Agent 协作</h2>
          <p className="guide-lead">一个聊天保持一个主 Agent 身份。其他 Agent 作为可联系的协作者返回结果，当前主 Agent 继续汇总回复。无需在输入框中切换角色。</p>
          <CodeBlock value={collaborationExample} />
          <div className="guide-grid">
            <div className="guide-card"><strong>前端引用</strong><p>把 Agent 目录传给 AgentSidebar，输入 @ 可搜索和插入稳定 ID。主 Agent 从广场选择后保存到 session.agentId，头像与名称由该身份决定。</p></div>
            <div className="guide-card"><strong>服务端编排</strong><p>本轮显式 @ 的其他 Agent 必须被实际联系；主 Agent 也可以自主调用允许委派的子 Agent。历史中的 @ 不会在之后每轮重复触发。被联系对象使用自己的指令和工作区，结果返回主 Agent。</p></div>
            <div className="guide-card"><strong>独立历史</strong><p>子对话按主会话、调用方和被调用方保存任务与最终回复。连续追问可续接该对象的历史，新主会话相互隔离；不会跨 Agent 复制原始工具结果或隐藏推理。具体上下文继承范围由宿主策略决定。</p></div>
          </div>
          <p>工具和运行事件包含 runId、parentRunId、agentId，可用于显示谁联系了谁、当前进度和审批状态。当前文本模型必须支持工具调用；模型、审批和停止信号均沿用宿主配置。</p>
        </section>

        <section id="guide-mcp" className="guide-section"><div className="guide-section-kicker">11 / MCP</div><h2>接入 MCP 应用</h2><p className="guide-lead">MCP 不应该写死在聊天组件里。应用目录和工具目录由宿主提供，组件只负责选择和展示调用状态。</p><div className="guide-mcp-grid"><div><h3>服务端需要做什么</h3><ol><li>合并本轮 <code>applicationIds</code> 与用户历史消息中的应用引用，再从宿主配置中查找 MCP 应用。</li><li>把 MCP 工具转换为 AI SDK 动态工具，保留动态 schema 和宿主执行回调，由 AI SDK 管理模型与工具的多步循环。</li><li>执行前根据已保存的审批模式和工具风险判断是否需要确认；通过 <code>onToolConfirm</code> 回调提交允许或拒绝，服务端验证后继续。</li><li>把应用名、工具名、参数、结果和状态写回 <code>toolCalls</code>；MCP image block 单独发为图片事件。</li></ol></div><div><h3>组件已经准备好的结构</h3><p><code>AgentApplication</code> 描述应用和工具；<code>AgentToolCall</code> 描述 pending、running、success、error、confirmation 等状态。示例从服务端的 <code>.local/agent-chat/applications.json</code> 读取连接，用官方 MCP SDK 动态发现工具。可在设置的「应用 / MCP」里重新连接。当前支持 Streamable HTTP、Bearer 凭证和 OAuth 授权流程，凭证仅保存在服务端；stdio 和 MCP 内嵌界面尚未接入。</p></div></div></section>

        <section className="guide-section guide-checklist"><div className="guide-section-kicker">SHIP CHECKLIST</div><h2>上线前检查</h2><div className="guide-checklist-grid"><span><Check size={15} />API Key 只在服务端</span><span><Check size={15} />图片附件可选并可预览</span><span><Check size={15} />视觉模型能力已开启</span><span><Check size={15} />消息流式失败可恢复</span><span><Check size={15} />停止请求会中止上游</span><span><Check size={15} />会话可重命名和持久化</span><span><Check size={15} />Skill 指令经过权限校验</span><span><Check size={15} />工具审批由服务端执行</span></div></section>
      </div>
    </div>
  </main>;
}
