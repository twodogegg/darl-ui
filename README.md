# darl-ui v0.1

**跨 React 项目复用的轻量级高级功能组件库**。包含 `FileUploader`、`VideoCompare`、`MediaWorkspace`、`DarlUIProvider` 和完整的演示网站。

## 原则

- 以 **shadcn/ui 的 Button 与 CSS 变量设计**为基础（内置的 Button 是为了组件库独立分发而做的轻量移植）。
- 没有引入 Uppy、react-dropzone 或任何额外的 UI 组件库。
- `react` / `react-dom` 为 peer dependency，组件库打包产物不要求使用方配置 Tailwind；MediaWorkspace 使用 Radix 弹出面板和对话框原语。
- 上传由业务项目提供，组件自身不管理远程存储、鉴权或业务数据。
- 演示站使用模拟上传，不会发送用户选择的文件至服务器。

> 注意：内置 Button 是 **shadcn/ui Button 交互与变体模式的适配实现**，不是通过官方 CLI 原样安装的全套 shadcn/ui 组件。保留轻量样式是为了在不同 React 项目中无需 Tailwind 配置即可使用。

## 安装、预览

需要 Node.js >= 22.19（Pi Agent SDK 的运行要求）。联网环境中：

```bash
npm install
npm run dev
```

`npm run dev` 同时启动组件演示站 `http://localhost:5188` 和真实模型示例 `http://127.0.0.1:5197`，端口被占用时直接报错。

### 真实模型示例

`examples/agent-chat` 是独立的宿主网站示例，包含客户端和本地服务端。通过 Vite alias 直接引用 `@darl/ui` 的 `src/index.ts` 和样式，组件修改会热更新，无需复制 UI 或重新打包组件库。`playground` 仍用于本地模拟交互。

真实示例顶部的「开发说明」页面解释了 AgentSidebar 的组件接入、模型服务端代理、流式事件、会话与 Skill 数据结构，以及 MCP 应用接入与确认流程。

复制 `.env.example` 为 `.env.local`，配置服务端 `AGENT_CHAT_API_KEY`；默认地址 `https://api.darl.cn/v1`，默认模型 `deepseek-v4.1-flash`。也可直接在示例的「设置 → 模型」中管理提供方、API 协议、模型类型和推理强度。推理强度填写模型实际支持的值，如 `low, medium, high`；留空则不发送此参数。

- 支持 OpenAI Chat Completions / Responses 流式文本协议、多轮对话、停止、重新生成、新对话和历史搜索。
- 示例服务端使用官方 [Pi Agent Core](https://github.com/earendil-works/pi/tree/main/packages/agent) 和 [Pi AI](https://github.com/earendil-works/pi/tree/main/packages/ai) 运行模型与工具循环；MCP 通过已有 SDK 桥接为 Pi 工具，执行确认仍由宿主处理。每次请求从传入的聊天历史重建 Pi 上下文，不启用 coding CLI、本机文件工具或额外的会话存储；这些依赖仅用于宿主示例，不进入组件库浏览器产物。
- Markdown 使用开源的 `react-markdown`、`remark-gfm` 和 `rehype-sanitize` 渲染；回复中的 `md` / `markdown` 代码块会显示为编译后的内容，复制按钮仍复制原始 Markdown。
- 系统提示词保存在 `examples/agent-chat/prompts/system.md`，是唯一来源；可在「设置 → Agent」中编辑，保存直接更新该文件，也可直接编辑 Markdown。每次聊天和连接测试重新读取文件，修改后下次请求生效；缺失、空白或过长时报错，代码没有内置默认值。选中的 Skill 指令在发送时追加。
- 对话和 Skills 保存在当前浏览器的 localStorage；Skill 指令通过 `/` 引用后发送给模型，资源脚本不会执行。
- 提供方和 Key 保存到 Git 忽略的 `.local/agent-chat/providers.json`，前端只获取是否已配置 Key。环境变量只用于首次初始化；后续以已保存设置为准。连接测试会实际调用已启用的文本模型。
- 获取模型目录后需确认模型类型、启用状态并保存；新发现的模型默认禁用，接口返回的 ID 无法证明其媒体或推理能力。
- 支持通过 Streamable HTTP 接入 MCP 应用和真实多步工具调用；AgentSidebar 支持图片附件预览、发送到支持视觉输入的文本模型，以及 MCP 图片结果回传；模型目录仍可设置图片 / 视频 / 音频类型，聊天仅列出启用的文本模型。

MCP 连接由宿主示例的服务端管理。将配置保存为 Git 忽略的 `.local/agent-chat/applications.json`（数组，可配置多个服务）：

```json
[
  {
    "id": "assets",
    "name": "素材库",
    "url": "https://your-server.example/mcp",
    "apiKey": "服务端 Bearer 凭证",
    "readOnlyTools": ["search_assets", "get_asset", "list_asset_types", "get_asset_files"]
  }
]
```

`apiKey` 可省略，用于无需鉴权的服务；URL 不接受内嵌凭证或查询参数。`readOnlyTools` 是宿主核实后的只读工具名单，无需这类覆盖时省略。工具 schema、名称和参数从 MCP 动态发现，设置 → 应用 / MCP 可查看连接状态和重新连接。聊天中用 `@` 引用一次应用，其工具在该对话后续消息中持续可用；服务端根据用户消息中的应用引用，每轮重新提供工具定义。刷新恢复后仍有效，新对话不继承，重新生成仅使用该轮之前的历史；已从服务端配置移除的历史应用会被忽略。同名工具通过服务端命名空间区分。询问应用用途或用法时，默认依据工具目录简短回答；只有明确需要真实数据或执行操作时才调用工具，避免额外浏览示例素材和无关文档。

- 模型的 Chat Completions 和 Responses 两种协议均支持工具调用，最多 8 轮、合计最多 128 个工具。工具失败会回传模型，界面以紧凑记录展示应用、工具名和状态，不展开原始参数和结果；执行确认时展示待确认参数。
- 除标记为只读或经宿主核实列入 `readOnlyTools` 的工具外，其他调用均等待用户允许或拒绝；破坏性标记始终要求确认。确认在服务端执行，停止、断连、超时后失效，不因刷新自动重试写操作。
- MCP 凭证不返回浏览器。原始工具结果只回传给模型，聊天界面和会话历史保存调用摘要；仅待确认操作向界面发送参数。
- 当前只支持 Streamable HTTP 和可选 Bearer 凭证；OAuth、stdio、旧版 HTTP+SSE、MCP Apps 内嵌界面及文件授权尚未接入。示例仍仅供本机开发，生产环境的用户身份、会话存储和工具权限由宿主提供。

单独启动：`npm run dev:agent-chat`；仅启动组件站：`npm run dev:playground`。示例服务仅监听本机，用于开发验证。`npm run build:agent-chat` 只构建前端到 `dist/agent-chat`，生产部署需由宿主提供 API、鉴权和存储。

构建完整项目：

```bash
npm run typecheck
npm run test
npm run build
```

### 开发文档

- [项目规则](AGENTS.md)
- [开发流程](docs/development/workflow.md)
- [文档治理](docs/development/documentation.md)

- 组件库输出：`dist/lib`（ESM、CJS、`.d.ts` 和 CSS）
- 演示网站输出：`dist/demo`（静态站点，可部署到 Cloudflare Pages / Vercel）

本地安装到其他 React 网站：

```bash
npm run pack:local
# 复制 .tgz 到目标项目
npm install ./darl-ui-0.1.0.tgz
```

## 使用

```tsx
import { DarlUIProvider, FileUploader } from '@darl/ui';
import '@darl/ui/styles.css';

function MyUpload() {
  return (
    <DarlUIProvider theme={{ mode: 'light', primaryColor: '#7c3aed', radius: 10 }}>
      <FileUploader
        multiple
        pasteEnabled
        dragEnabled
        accept={['image/*', 'video/mp4', '.pdf']}
        maxFileSizeMB={100}
        maxFiles={20}
        concurrency={3}
        autoUpload={false}
        upload={async (file, { signal, onProgress }) => {
          // Example only. Fetch does NOT provide browser upload progress.
          // If progress matters, use XMLHttpRequest with xhr.upload.onprogress.
          const form = new FormData();
          form.append('file', file);
          const res = await fetch('/api/upload', { method: 'POST', body: form, signal });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          onProgress(100);
          return res.json() as Promise<{ id: string; url: string }>;
        }}
        onSuccess={(file, result) => console.log(file.name, result)}
        onError={(file, error) => console.error(file.name, error)}
        onReject={(files) => console.warn(files.map((x) => x.reason))}
      />
    </DarlUIProvider>
  );
}
```

### FileUploader API

| Prop | 类型 | 默认值 |
| --- | --- | --- |
| `upload` | `(file, {signal,onProgress}) => Promise<T>` | 必填 |
| `multiple` | `boolean` | `true` |
| `pasteEnabled` | `boolean` | `true` |
| `dragEnabled` | `boolean` | `true` |
| `accept` | `string[]`（MIME、通配符和扩展名） | `[]` |
| `maxFileSizeMB` | `number` | 不限制 |
| `maxFiles` | `number` | 不限制 |
| `concurrency` | `number` | `3` |
| `autoUpload` | `boolean` | `true` |
| `showPreview` | `boolean` | `true` |
| `showProgress` | `boolean` | `true` |
| `disabled` | `boolean` | `false` |
| `accentColor` | `string` | 跟随主题 |
| `onSuccess` | `(file, result) => void` | 可选 |
| `onError` | `(file, error) => void` | 可选 |
| `onReject` | `(rejectedFiles) => void` | 可选 |
| `onChange` | `(items) => void` | 可选 |

### 交互定义

- 点击选择文件、拖入文件、在聚焦上传区域后按 Ctrl+V / Cmd+V 粘贴。
- 在其他输入框粘贴文本不会被文件组件拦截。
- 类型、大小限制按文件分别校验；部分文件无效不影响其他文件。
- 重复文件以 `name + size + MIME + lastModified` 作为近似判重依据。
- `multiple=false` 时上限为 1，已选的文件先移除才能添加新文件。
- `autoUpload=false` 时，需要点击「开始上传」；失败后的「重试」则立即安排上传。
- 单文件独立进度、失败重试、主动取消、移除及清空。
- 取消通过 `AbortSignal` 传入业务上传适配器，**业务适配器必须支持 abort** 才能真正取消网络传输。
- 进度只有由上传适配器明确报告时才显示百分比，否则显示不确定进度动画。
- 使用 `URL.createObjectURL` 创建图片缩略图；移除、清空和卸载时释放 URL。
- `maxFiles` 按列表内所有状态（含已完成）计数，上传新文件前可以移除旧记录。
- 通过 `onSuccess` 返回后端原始业务对象，组件不会擅自转换成素材 ID 或 URL。

## 主题

```tsx
<DarlUIProvider theme={{ mode: 'dark', primaryColor: '#059669', radius: 8 }}>
  <FileUploader upload={uploadToServer} />
</DarlUIProvider>
```

`mode` 可选 `light | dark | system`。`accentColor` 可覆盖单个文件上传组件的主色。

## 演示网站

`playground` 包含：介绍页、主题色配置、FileUploader 参数调试、模拟成功和失败、实时 JSX 代码、事件日志。演示站使用 [shadcn/ui](https://ui.shadcn.com) 官方 CLI 安装的 Radix Nova 基础组件和默认 Neutral 配色，支持白天 / 黑夜切换；首次打开跟随系统外观，手动选择后保存在浏览器中。手机端通过导航菜单访问所有演示页面。

演示站和组件库分别构建。Tailwind 与官方基础组件仅用于演示站，组件库仍以独立 CSS 分发；演示站内通过 CSS 变量将现有高级组件映射到网站主题。CLI 配置位于 `components.json`，基础组件源码位于 `playground/src/components/ui/`。

## 后续再考虑

分片上传、断点续传、文件夹上传、图片编辑、外部存储管理、组件 Registry、完整基础组件集合。v0.1 **不实现**。

## 安全说明

前端 `accept`、大小和数量限制仅用于用户体验。实际项目服务端必须独立验证文件内容、文件大小、权限、存储目标和文件扩展名。不要信任浏览器传入的 MIME 类型。

## 发布说明

`package.json` 使用 `"private": true`，防止误发布。确认包名和私有发布目标后才修改此项。源代码托管于 https://github.com/twodogegg/darl-ui 。

## VideoCompare｜视频对比

第二个高级组件：最多 3 个本地或远程视频同屏对比。横屏（16:9）自动上下排列，竖屏（9:16）自动左右排列；混合画幅以第一个视频判断方向，也可用 `layout` 覆盖。支持统一播放/暂停/进度/倍速/循环、单一路视频声音（或全部静音）、最佳版本单选与取消。

```tsx
import { VideoCompare } from '@darl/ui';
import '@darl/ui/styles.css';

const [bestId, setBestId] = useState<string | null>(null);
const videos = [
  { id: 'v1', name: '生成版本 A', src: '/output-a.mp4' },
  { id: 'v2', name: '生成版本 B', src: '/output-b.mp4' },
];
<VideoCompare videos={videos} bestVideoId={bestId} onBestChange={setBestId} />
```

`VideoCompare` 支持 `videos`（2–3 项、至少 2 项可比较）、`layout: 'auto' | 'vertical' | 'horizontal'`、`audioSourceId/defaultAudioSourceId/onAudioSourceChange`、`bestVideoId/defaultBestVideoId/onBestChange`、`onRemove`、`onError`、`loop`、`accentColor` 与 `className`。

**边界**：所有视频从各自 0 秒同步；全局时长取最长视频，短视频停留末帧，切换声音不重置时间轴，选为最佳不修改音源。播放依赖浏览器解码能力，并做适度时间轴纠偏，不承诺专业软件级逐帧锁定。不会合成视频、管理资产或保存最佳记录；业务网站可通过 `onBestChange(id)` 持久化选择。组件不会上传视频，演示页面中的本地文件仅通过浏览器 Blob URL 使用。

## MediaWorkspace｜图片 / 视频生成工作台

一个可复用的统一工作台：左侧任务列表、按批次展示结果、底部提示词与紧凑参数面板。输入区顶部先选择生成类型（图片 / 视频，默认图片），模型列表只显示当前类型的模型；支持模型能力驱动的参考图片 / 视频 / 音频、首尾帧、参数默认值、历史复用、重新生成、收藏、重试和取消。

```tsx
import { MediaWorkspace, type MediaModel, type MediaTask } from '@darl/ui';
import '@darl/ui/styles.css';

<MediaWorkspace
  models={models}
  tasks={tasks}
  activeTaskId={activeTaskId}
  onTaskChange={setActiveTaskId}
  onCreateTask={handleCreateTask}
  onRenameTask={handleRenameTask}
  onGenerate={handleGenerate}
  onRetry={handleRetry}
  onCancel={handleCancel}
  onRegenerate={handleRegenerate}
  onFavoriteChange={handleFavoriteChange}
/>
```

模型、任务、批次和异步状态由宿主传入；组件不调用真实生成 API，不上传文件，不自行保存任务。切换模型保留素材，超限阻止生成；不支持的参数与素材不进入请求。

演示入口：`http://localhost:5188/#media-workspace`。包含「创作工作室」与「品牌宣传」两种宿主配置、深浅主题及本地异步模拟。示例媒体为本地示意素材。完整模型类型、API、接入示例和边界见 [MediaWorkspace 文档](docs/media-workspace.md)。


## AgentSidebar｜网站辅助 Agent 侧栏

演示入口：`http://localhost:5188/#agent-sidebar`。右侧会话面板包含新对话、历史搜索与切换、会话重命名、消息发送、应用 / Skill 选择、模型及其推理强度选择；消息较长时可直接跳到顶部或底部，也可以展开为居中的大对话窗口。回复操作只有复制和重新生成；整条复制保留原始 Markdown，代码块单独复制代码。Markdown 使用 GFM 渲染，并支持将 `md` / `markdown` 围栏内容渲染为可读内容。

```tsx
import { AgentSidebar } from '@darl/ui';
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
  applications={applications}
  skills={skills}
  onSkillImport={saveImportedSkill}
  onSkillSave={saveSkill}
  onSkillDelete={deleteSkill}
  models={models}
/>
```

`sessions` 包含会话 ID、标题和消息；`applications`、`skills`、`models` 全部由宿主提供。工具记录通过消息的 `toolCalls` 传入，参数和结果支持任意 JSON，不绑定具体 MCP；普通记录仅显示应用、工具名、状态及失败原因，不提供原始 JSON 展开入口。`onToolConfirm(toolCallId, approved)` 接收用户对 `confirmation` 状态调用的允许或拒绝，宿主必须在服务端落实该决定；确认前会自动展示参数，失败可重试。`onSend` 收到会话 ID、正文、应用 / Skill ID、有效模型及推理强度、可选本地附件 `files` 和已编码的图片 `attachments`；组件会在输入区显示缩略图，图片消息可以不带正文。宿主应把 `attachments` 转换为模型供应商的视觉输入，并在 `AgentMessage.attachments` 中回传图片 URL 以显示结果。失败保留草稿并显示错误。模型不提供 `reasoningEfforts` 时隐藏推理选择。`isGenerating/onStop` 可连接宿主生成状态。完整类型从 `@darl/ui` 导出。

`onSkillImport`、`onSkillSave`、`onSkillDelete` 和 `onSkillFavoriteChange` 用于接管 Skill 库变更；不传这些回调时，侧栏仍会在当前组件实例内完成本地编辑和选择。

组件保留各会话的本地草稿和待发送附件，支持 DarlUIProvider 主题。桌面固定在右侧，手机端全屏。Skill 管理器支持新建、编辑、停用、删除，以及导入 `SKILL.md` 或包含 `references/`、`scripts/`、`assets/`、`agents/` 的 ZIP / 文件集合；导入会校验 frontmatter、资源路径和大小，不执行 Skill 内的脚本。Skill 版本在保存时递增，真实存储由宿主通过 `onSkillImport/onSkillSave/onSkillDelete` 接管。演示中的历史和 Skill 保存在当前页面内存中，示例回复和工具记录均为本地演示，附件不上传。真实模型、MCP 执行、账号鉴权和服务端历史留给宿主接入。

应用和 Skill 从选择面板插入输入光标处，作为正文内引用，不显示输入框上方标签，也不自动传入当前页面。输入 `@` 引用应用，输入 `/` 引用 Skill；继续输入名称或简介关键词可以筛选，上下方向键选择，Enter / Tab 插入，Esc 关闭建议。应用引用为蓝色，Skill 引用为紫色，可用 `--darl-agent-app` / `--darl-agent-skill` 覆盖。引用编码为 `[显示名称](app:ID)` / `[显示名称](skill:ID)`，发送时从正文派生应用和 Skill ID；删除引用即取消本次使用。

## StyleSelector｜风格选择弹窗

`StyleSelector` 提供风格广场弹窗，支持集合切换、分类筛选、搜索、选择、收藏和两步创建风格向导。宿主通过 `styles` 提供风格数据，通过 `onChange`、`onFavoriteChange` 和 `onCreate` 接收结果；`onCreate` 可以返回 Promise，失败时会保留表单并显示错误。

```tsx
<StyleSelector
  open={open}
  onOpenChange={setOpen}
  styles={styles}
  value={selectedStyleId}
  onChange={(style) => setSelectedStyleId(style?.id ?? null)}
  onFavoriteChange={saveFavorite}
  onCreate={createStyle}
/>
```

风格列表默认每页展示 20 个（`pageSize` 可调整），滚动接近底部自动加载下一页，内容不足一屏时继续补齐。已在本地的风格按页展示；需要远程分页时，传入 `hasMore` 和异步 `onLoadMore({ collection, category, query, signal })`，宿主负责请求下一页、按 ID 去重后追加到 `styles`，并在末页将 `hasMore` 设为 `false`。通过 `onFilterChange({ collection, category, query })` 重置宿主游标及 `hasMore`，即使前一个筛选已到末页，新的筛选仍可加载；“我的风格”不传分类。回调应遵守 `signal`，丢弃切换筛选或关闭弹窗后取消的请求结果。组件显示加载状态，失败保留已加载列表并提供重试；同一时刻只发起一个请求。`onChange` 仅在确认后应用待选风格。

## SettingsPage｜整体设置中心

`SettingsPage` 提供设置中心的导航外壳，`ModelSettingsCard` 负责模型提供方和模型目录，`AgentSettingsCard` 负责系统提示词编辑。模型类型统一为 `text`、`image`、`video`、`audio`；模型的推理强度和能力标签由宿主提供，API Key 只通过宿主回调保存，组件不会自行持久化密钥。

```tsx
<SettingsPage activeSection="models" sections={sections}>
  <ModelSettingsCard
    providers={providers}
    onProviderSave={saveProvider}
    onProviderDelete={deleteProvider}
    onTestConnection={testProvider}
    onFetchModels={fetchProviderModels}
  />
</SettingsPage>
```

`AgentSettingsCard` 通过 `systemPrompt: string` 接收已保存内容，通过 `onSave: (systemPrompt: string) => void | Promise<void>` 交给宿主持久化。支持多行编辑、保存进度、成功反馈及失败后保留草稿重试；不自行读文件或调用 API。

```tsx
<SettingsPage activeSection="agent" sections={sections}>
  <AgentSettingsCard systemPrompt={systemPrompt} onSave={saveSystemPrompt} />
</SettingsPage>
```

设置中心当前提供通用设置、模型、应用 / MCP、Skills、Agent 预设和桌面设置入口；页面内容由宿主通过 `children` 接入。文本模型编辑器提供 `vision` 图片输入开关；模型配置完成后，将 `providers` 中启用的模型转换为 `AgentSidebar` 的 `models` 即可复用同一个聊天侧栏。
