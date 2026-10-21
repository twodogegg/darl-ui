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

需要 Node.js >= 22.19。联网环境中：

```bash
npm install
npm run dev
```

`npm run dev` 同时启动组件演示站（5188）和真实模型示例（5197），端口被占用时直接报错。两个服务都监听 `0.0.0.0`，同一局域网内的其他设备可通过 `http://<本机局域网 IP>:5188` / `:5197` 访问。

### 业务文件存储（COS / 本地）

Agent Chat 的素材上传、命名字体、项目封面和媒体结果统一通过宿主文件服务保存。默认是本地模式，文件写入 `.local/agent-chat/files/`；配置 COS 后新文件写入 `COS_OBJECT_PREFIX` 指定的目录（默认 `darl-ui`），历史文件仍按各自记录的后端读取。

- 「设置 → 存储」可配置本地 / COS 并测试真实写入和删除；配置保存在服务端 SQLite，SecretKey 不返回浏览器，且配置接口只接受本机回环地址。首次运行也支持用环境变量提供默认值：`STORAGE_MODE`、`LOCAL_STORAGE_ROOT`、`COS_SECRET_ID`、`COS_SECRET_KEY`、`COS_REGION`、`COS_BUCKET`、`COS_SCHEME`、`COS_PUBLIC_BASE_URL`、`COS_OBJECT_PREFIX`。
- 文件按 SHA-256 内容去重，数据库只保存文件元数据和业务引用，不把大 Base64 写入任务行或项目封面 BLOB。
- 原图接口为 `/api/files/:fileId`；缩略图通过 `?width=160|320|1024` 实时生成。COS 使用 `imageMogr2`，本地使用 `sharp` 生成等价 WebP。
- 媒体图片卡片使用 320px 缩略图，点击详情才加载原图；视频卡片首次渲染不挂视频源，点击播放后才请求并支持 Range。
- 删除生成批次或任务会真实删除其专属结果文件；仍被其他任务引用的文件会阻止删除。旧 `generated-media/`、旧参考图路径和旧 BLOB 数据不做兼容读取或迁移，已失效的历史供应商 URL 无法恢复。

### 项目工作台（开发分支）

在 Agent Chat 示例（默认 http://localhost:5197）顶部点击「项目」，可进行项目列表、创建、详情、编辑和归档。创建时仅需填写项目标题、视觉风格和画面比例；简介和封面可以留空。封面只允许手动上传。风格选择直接复用 #styles 演示页的 StyleSelector 组件，基础预设和自定义风格均保存在本地 SQLite。

**项目模块无需配置 PROJECT_API_BASE_URL、PROJECT_API_TOKEN，也不依赖旧网站的 FastAPI/MySQL。** Agent Chat 现有的 Node 服务处理项目接口；项目记录、风格以及上传的封面图片，统一存入 .local/agent-chat/data.sqlite。执行 npm run dev 即可启动，不需要第二个后端。

项目创建后默认没有剧集。本期不包括剧集管理、剧本改编、图片 AI 生成或资产提取。项目 API 当前允许本机与同一局域网私有网段访问，适用于单用户本地开发，不适合未经认证直接暴露公网。AGENT_CHAT_API_KEY 只用于真实模型聊天，不是项目模块的前置条件。

### Sub Agent 持续会话（Agent Chat）

主 Agent 委派给同一个专业 Sub Agent 的历史由服务端 SQLite 的 `subagent_threads` 表保存。在同一个主聊天会话中再次委派同一个 Sub Agent，会自动带上**该子会话自己的历史任务和最终回复**；页面刷新或本机服务重启后也可以接续。新建主聊天、切换主 Agent 或切换 Sub Agent 不共享子会话历史。

- 子会话身份由本地单用户作用域、主聊天 `sessionId`、主 Agent ID 和 Sub Agent ID 组合确定，与每次执行的新 `runId` / `parentRunId` 不同。
- 只保存子任务及最终回复，**不会**跨子 Agent 复制上下文，也不持久化原始 MCP 工具结果、隐藏推理或密钥。子 Agent 的提示词、Skills 和 MCP 工具每次从当前配置重新确认；模型使用当前聊天选择的文本模型。
- 子历史按子模型的上下文预算与 Agent 上下文策略压缩；失败、取消或超时不写入虚假成功回复。同一子会话的并行调用在本地进程内排队，SQLite 版本校验防止其他写入者静默覆盖。
- 当前示例仅面向**本地单用户**。子会话使用固定 `local` 作用域；部署为多用户服务之前必须接入真实的宿主用户鉴权与隔离，不能把请求头视为身份凭据。
- 此功能支持主 Agent **间接续聊**协作 Agent；子会话的独立列表、可选多线程切换和 UI 历史查看仍是后续扩展。

### 真实模型示例

`examples/agent-chat` 是独立的宿主网站示例，包含客户端和本地服务端。通过 Vite alias 直接引用 `@darl/ui` 的 `src/index.ts` 和样式，组件修改会热更新，无需复制 UI 或重新打包组件库。`playground` 仍用于本地模拟交互。

真实示例顶部的「开发说明」页面解释了 AgentSidebar 的组件接入、模型服务端代理、流式事件、会话与 Skill 数据结构，以及 MCP 应用接入与确认流程。

复制 `.env.example` 为 `.env.local`，配置服务端 `AGENT_CHAT_API_KEY`；默认地址 `https://api.darl.cn/v1`，默认模型 `deepseek-v4.1-flash`。也可直接在示例的「设置 → 模型」中管理提供方、API 协议、模型类型和推理强度。推理强度填写模型实际支持的值，如 `low, medium, high`；留空则不发送此参数。

示例服务端默认只接受 `AGENT_CHAT_PORT` 端口的同源请求。要通过反向代理或 Cloudflare Tunnel 用自定义域名访问，在 `.env.local` 设置 `AGENT_CHAT_ALLOWED_HOSTS=agents.example.com`（逗号分隔可填多个），Vite 的 `server.allowedHosts` 与 API 同源校验会同时读取它。注意：这会把持有真实模型密钥、可执行本机命令的服务端暴露到公网，任何能访问该域名的人都能消耗凭据，仅限自用并保持审批模式。

隧道/反代对外访问请用打包产物而不是 dev server：`npm run preview:agent-chat` 会先 `build:agent-chat`，再在 `AGENT_CHAT_PREVIEW_PORT`（默认 5199）用 preview 模式同时提供静态资源和同一套 `/api` 中间件。dev server 的模块请求数量是打包后的几十倍，慢速上行链路下首屏会拖到几十秒。

- 支持 OpenAI Chat Completions / Responses 流式文本协议、多轮对话、停止、重新生成、新对话和历史搜索。
- 示例服务端使用 AI SDK Core 和 OpenAI-compatible Provider 运行模型与工具循环；MCP 通过已有 SDK 动态转换为 AI SDK 工具，执行确认仍由宿主处理。每次请求从本地 SQLite 恢复并重建模型上下文，由宿主提供本机文件和 Shell 工具；这些执行能力仅属于宿主示例，不进入组件库浏览器产物。
- Markdown 使用开源的 `react-markdown`、`remark-gfm` 和 `rehype-sanitize` 渲染；回复中的 `md` / `markdown` 代码块会显示为编译后的内容，复制按钮仍复制原始 Markdown。
- 系统提示词首次从 `examples/agent-chat/prompts/system.md` 写入本地 SQLite，之后由数据库管理；缺失、空白或过长时报错，代码没有内置默认值。专业 Agent 的提示词在 Agents 编辑器中单独配置。Skill 名称和描述在每轮请求中组成目录，完整指令与资源由模型通过工具按需读取。运行规则从 `examples/agent-chat/prompts/skill-runtime.md` 加载。
- 对话、Skills、提供方、模型配置和 Agent 配置保存在 Git 忽略的 `.local/agent-chat/data.sqlite`；浏览器只负责调用本机 API，不保存聊天历史。
- 本机执行环境提供技能目录/按需加载、文件列举/分页读取/写入、附件导入、Shell 命令、进程查询/停止和文件交付。技能正文及二进制资源由服务端读取已保存版本，浏览器只传 Skill ID。允许自动调用的技能仅发送目录；关闭自动调用的技能需用户显式引用。
- 网站默认提供 Anthropic 的 `skill-creator`，所有主 / 子 Agent 都能按需加载。上游完整技能包（含许可）位于 `examples/agent-chat/skills/skill-creator/`，来自 [claude-plugins-official](https://github.com/anthropics/claude-plugins-official/tree/d1adba47161a271799de7b548225d929310046bd/plugins/skill-creator/skills/skill-creator)，固定版本 `d1adba47161a271799de7b548225d929310046bd`，原文件未修改。Claude CLI 专属评测仍依赖对应软件与账号，不属于网站自带能力。
- 在聊天的「选择 Skill」弹层或「管理 Skill」窗口点击「通过对话创建」，会新开一条对话并自动引用 skill-creator，原聊天及草稿保持不变。也可以直接对话「创建一个整理会议行动项的 Skill」或发送技能链接要求安装。Agent 用现有文件 / 命令工具生成或下载完整包，再调用 `builtin_create_skill` 安装进网站 Skills 库；安装复用手动导入校验，不执行包内脚本，不写电脑全局技能目录。默认模式自动批准新增技能，覆盖已有技能需明确 ID、当前版本并确认；内置技能内容只读。同包重复安装复用已有 ID。
- Skills 由 `/api/skills` 单独保存到 SQLite，`/api/state` 只写会话，读状态时合并技能目录；旧版会话中的 Skills 首次自动迁移。手动导入与 Agent 创建共用保存逻辑，创建后发送 `skills-changed` 事件刷新界面，当轮即可加载，新对话及刷新后仍可用。
- 工作区保存在 `.local/agent-chat/workspaces/`，按聊天及 Agent 分目录，文件跨请求和服务重启保留；导入的技能按内容版本落盘，带 shebang 的脚本及 Shell 脚本可直接执行。命令默认超时 120 秒、最大 10 分钟；调用最多等待 10 秒后返回进程 ID，继续用查询工具获取输出与真实退出码。成功回复后后台命令可继续运行至超时；停止、断连或请求失败会终止本轮启动的命令。重启服务后进程不恢复。
- 命令运行在后端操作系统用户下，**不是沙箱**；文件工具校验工作区路径和符号链接，Shell 本身仍具有系统用户权限。子进程只继承 PATH、HOME、语言、临时目录等基础环境，不转发后端提供方密钥；需要特定凭证、CLI、系统软件或 MCP 的技能仍需配置真实依赖。执行工具仅向本机/局域网同源请求提供，不适合直接暴露到公网。
- 「设置 → Tools」可查看实际工具目录；输入框或「设置 → 审批模式」统一控制工具执行。默认“帮我批准”，工作区文件操作自动执行；导入 Skill 不会自动执行。用户拒绝或主动停止使用 `cancelled` 状态，页面显示普通状态提示；命令失败、网络错误和超时仍保留错误提示。通过 `publish_file` 保存产物后取得 `/api/files/:id?download=1` 下载链接，HTML 等主动内容作为附件交付。
- 宿主提供 `uploadAttachment` 后，聊天文件选择器支持任意文件；未提供时仍只接受图片。示例将附件保存为 fileId 并告知模型，模型可导入工作区处理；仅图片发送给视觉模型，其他文件不冒充图片预览。
- MediaWorkspace 宿主可通过 `/api/media-tasks` 保存单用户任务、批次和结果；协议凭据与生成结果仍由宿主 API 管理。
- 获取模型目录后需确认模型类型、启用状态并保存；新发现的模型默认禁用，接口返回的 ID 无法证明其媒体或推理能力。
- 支持通过 Streamable HTTP 接入 MCP 应用和真实多步工具调用；AgentSidebar 支持图片附件预览、发送到支持视觉输入的文本模型，以及 MCP 图片结果回传；模型目录仍可设置图片 / 视频 / 音频类型，聊天仅列出启用的文本模型。
- 聊天请求不设置固定的 100000 字符文本上限；上下文预算按模型 `contextWindow` 能力计算，未声明时按 1M token 的默认预算处理。累计上下文超过预算 50% 后主动压缩较早历史，当前消息和最近上下文优先保留；工具结果仍按 Agent 上下文策略控制。

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

在「设置 → 应用 / MCP」中也可以新增、编辑或移除 Streamable HTTP 连接，填写应用 ID、名称、URL 与可选的 Bearer Token；更新保存在服务端的 `applications.json`，不会向浏览器回显 Token。点击「刷新连接与工具目录」重新发现工具；展开工具条目可以查看完整输入 JSON Schema、可选输出 Schema 和 annotations。OAuth 仍未实现，使用 OAuth 的服务不能通过此表单完成授权。当前本地开发宿主没有用户登录隔离，勿把含凭证的 5197 端口暴露到不可信网络。

`apiKey` 可省略，用于无需鉴权的服务；URL 不接受内嵌凭证或查询参数。`readOnlyTools` 是宿主核实后的只读工具名单，无需这类覆盖时省略。工具 schema、名称和参数从 MCP 动态发现，设置 → 应用 / MCP 可查看连接状态和重新连接。聊天中用 `@` 引用一次应用，其工具在该对话后续消息中持续可用；服务端根据用户消息中的应用引用，每轮重新提供工具定义。刷新恢复后仍有效，新对话不继承，重新生成仅使用该轮之前的历史；已从服务端配置移除的历史应用会被忽略。同名工具通过服务端命名空间区分。询问应用用途或用法时，默认依据工具目录简短回答；只有明确需要真实数据或执行操作时才调用工具，避免额外浏览示例素材和无关文档。

- 模型的 Chat Completions 和 Responses 两种协议均支持工具调用，启用本机执行工具时最多 32 轮，否则默认最多 8 轮（显式联系较多 Agent 时预留一轮汇总）；MCP 应用合计最多 128 个工具，另加宿主内置工具。工具失败会回传模型，界面以紧凑记录展示应用、工具名和状态，不展开原始参数和结果；执行确认时展示待确认参数。
- 工具失败在服务端同时写入 stderr 和 `.local/agent-chat/logs/failure.log`（每行一条 JSON，含 requestId、runId、toolCallId、错误码、耗时，凭证会被脱敏），便于在浏览器之外回溯失败原因。
- 输入框与「设置 → 审批模式」共用三档设置，通过 `/api/approval-settings` 保存到 SQLite，替代原有逐项免确认开关。请求批准（`ask`）：只读操作直接执行，其余操作询问。帮我批准（`auto`，默认）：自动执行工作区文件操作、`pwd`、`ls`（含常见选项、指定目录与带引号路径）、常见运行时版本查询及这些只读命令的 `&&` 组合，以及同时声明 `destructiveHint: false` 与 `openWorldHint: false` 的非破坏 MCP 写操作；任意脚本、复杂命令、未知/危险 MCP 操作和付费媒体生成仍询问。完全访问（`full`）：当前工具能力内不再逐次确认，包括危险 MCP 操作和图片/视频费用。完全访问不扩大文件工具的工作区范围，也不提供操作系统沙箱。主 Agent 与子 Agent 共用每轮开始时的模式，切换从下一轮请求生效。图片、视频与 MCP 共用 `InteractiveConfirmDialog` 弹窗，拒绝/停止/超时不会触发待批准的调用。
- MCP 风险基于动态发现的 annotations 与宿主 `readOnlyTools` 配置判定，未声明安全性的写操作在“帮我批准”模式下仍询问。确认在服务端执行，停止、断连、超时后失效，不因刷新自动重试写操作。
- MCP 凭证不返回浏览器。原始工具结果只回传给模型，聊天界面和会话历史保存调用摘要；仅待确认操作向界面发送参数。
- 当前只支持 Streamable HTTP 和可选 Bearer 凭证；OAuth、stdio、旧版 HTTP+SSE、MCP Apps 内嵌界面及文件授权尚未接入。示例仍仅供本机开发，生产环境的用户身份、会话存储和工具权限由宿主提供。

单独启动：`npm run dev:agent-chat`；仅启动组件站：`npm run dev:playground`。示例服务监听 `0.0.0.0`，「项目」「媒体生成」等本地数据 API 只接受本机与同一局域网私有网段（10/8、172.16/12、192.168/16、169.254/16）的调用，公网地址一律返回 403。`npm run build:agent-chat` 只构建前端到 `dist/agent-chat`，生产部署需由宿主提供 API、鉴权和存储。

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

`VideoCompare` 支持 `videos`（2–3 项、至少 2 项可比较），也支持通过 `media` 传入图片 / 视频素材；另有 `layout: 'auto' | 'vertical' | 'horizontal'`、`audioSourceId/defaultAudioSourceId/onAudioSourceChange`、`bestVideoId/defaultBestVideoId/onBestChange`、`onRemove`、`onError`、`loop`、`accentColor` 与 `className`。

**边界**：所有视频从各自 0 秒同步；全局时长取最长视频，短视频停留末帧，切换声音不重置时间轴，选为最佳不修改音源。播放依赖浏览器解码能力，并做适度时间轴纠偏，不承诺专业软件级逐帧锁定。不会合成视频、管理资产或保存最佳记录；业务网站可通过 `onBestChange(id)` 持久化选择。组件不会上传视频，演示页面中的本地文件仅通过浏览器 Blob URL 使用。

`MediaWorkspace` 已在每个成功结果上提供「加入对比」，选中 2–3 个图片或视频后点击「打开对比」即可直接复用 `VideoCompare`；组件只消费宿主传入的 URL，不上传或持久化媒体。

## MediaWorkspace｜图片 / 视频生成工作台

一个可复用的统一工作台：左侧任务列表、按批次展示结果、底部提示词与紧凑参数面板。输入区顶部先选择生成类型（图片 / 视频，默认图片），模型列表只显示当前类型的模型；支持模型能力驱动的参考图片 / 视频 / 音频、首尾帧、生成模式、逻辑模型与渠道绑定路由、参数默认值、独立生成数量、历史复用、重新生成、收藏、重试和取消。生成数量会作为 `generationCount` 交给宿主拆分调用，不复用供应商的 `n` 参数。

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

演示入口：`http://localhost:5188/#agent-sidebar`。右侧会话面板包含新对话、历史搜索与切换、会话重命名与删除（需二次确认）、消息发送、应用 / Skill 选择、模型与思考等级的合并选择入口；消息较长时可直接跳到顶部或底部，也可以展开为居中的大对话窗口。回复操作提供复制和重新生成；配置语音适配器后还可播放独立语音内容；整条复制保留原始 Markdown，代码块单独复制代码。Markdown 使用 GFM 渲染，并支持将 `md` / `markdown` 围栏内容渲染为可读内容。

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
  onSessionDelete={deleteSession}
  onNewSession={createSession}
  onSend={sendMessage}
  onRegenerate={regenerateMessage}
  onToolConfirm={confirmToolCall}
  approvalMode={approvalMode}
  onApprovalModeChange={saveApprovalMode}
  approvalModePending={approvalSaving}
  applications={applications}
  skills={skills}
  onSkillImport={saveImportedSkill}
  onSkillSave={saveSkill}
  onSkillDelete={deleteSkill}
  models={models}
/>
```

`sessions` 包含会话 ID、标题、消息和可选的固定 `agentId`；`applications`、`skills`、`models` 全部由宿主提供。工具记录通过消息的 `toolCalls` 传入，参数和结果支持任意 JSON，不绑定具体 MCP；普通记录仅显示应用、工具名、状态及失败原因，不提供原始 JSON 展开入口。`onToolConfirm(toolCallId, approved)` 接收用户对 `confirmation` 状态调用的允许或拒绝，宿主必须在服务端落实该决定；确认前会自动展示参数，失败可重试。`onSend` 的正文保留 Agent 稳定 ID 引用，宿主应解析本轮用户消息并校验可调用目录；此外收到会话 ID、应用 / Skill ID、有效模型及推理强度、可选本地附件 `files` 和已编码的图片 `attachments`；组件会在输入区显示缩略图，图片消息可以不带正文。宿主应把 `attachments` 转换为模型供应商的视觉输入，并在 `AgentMessage.attachments` 中回传图片 URL 以显示结果。失败保留草稿并显示错误。模型与思考等级共用一个入口，弹层中先选模型，再选择该模型支持的等级；模型不提供 `reasoningEfforts` 时隐藏等级选项且不发送旧值。当前等级只来自用户选择、宿主受控值或模型记录里的 `defaultReasoningEffort`（该值会由 `toAgentModels` 从能力模板/绑定覆盖带出）；两者都没有时不显示也不提交等级，不会按 `reasoningEfforts` 的列表顺序自行挑选，因此刷新页面不会把默认等级改写成列表第一项。`isGenerating/onStop` 可连接宿主生成状态。完整类型从 `@darl/ui` 导出。

`approvalMode` 为宿主控制的 `ask | auto | full`；同时提供 `onApprovalModeChange` 后显示输入框审批菜单。回调可返回 Promise，保存失败会保留原选择并显示错误。`approvalModePending` 在宿主读取/保存策略时阻止切换及发送；生成中无法切换。组件仅展示策略，宿主必须服务端持久化并统一执行；示例会拒绝客户端模式与服务端设置不一致的聊天请求。独立的 `ApprovalModeSelector` 可在宿主设置页复用，组件库不会自行批准任何调用。Playground 的选择只作用于本地 UI 演示。

可选 `voice: AgentVoice` 适配器为侧栏增加语音回复开关、居中大弹窗的音色搜索/分页/试听和语音输入。`enabled/onEnabledChange`、`voiceId/voiceName/onVoiceChange` 由宿主持久化；`loadVoices(query, page, signal, filters?)` 返回 `{ voices: [{ id, name, description?, tags?, languages?, previewUrl? }], hasMore }`。可选 `catalogFilters` 由宿主提供语言、默认语言、排序与分组标签选项，组件将选择值作为 `{ language, sort, tags }` 传给 `loadVoices`；筛选改变时取消旧请求并从第一页重新查询。音色目录桌面端最多三列，手机端单列，搜索和筛选栏保持可见。试听直接播放 `previewUrl` 指向的已有音频，Fish 示例读取 `samples[].audio`，不调用 TTS；无样本时禁用试听，加载失败显示错误，切换试听或关闭弹窗会停止并释放音频。`synthesize(text, voiceId, signal)` 返回 `{ body: ReadableStream<Uint8Array>, sampleRate }`，音频必须是有符号 16 位小端、单声道 PCM；播放器先缓冲约 0.5 秒音频，再边收边播，不等待完整文件。`transcribe(file, signal)` 可选，返回识别文字并追加到当前会话草稿，用户编辑后发送。录音最长 2 分钟，音频不超过 25MB；麦克风需要 HTTPS 或 localhost。

`onSend` 在配置语音时附带当前轮 `voiceMode`。宿主应按轮给 Agent 注入语音规则；`AgentMessage.outputs` 按顺序接收 `{ output_type: 'text' | 'speech', content: string }`，`content` 拼接文字输出，语音内容单独显示可展开的文稿。新回复在 `streaming: true` 时追加的 speech 输出会自动进入播放队列；历史恢复或事后开启开关不会自动朗读。语音可单独输出，不要求复制文字全文。关闭开关、关闭侧栏、切换会话/音色、停止生成或录音都会清理当前播放和请求；手动停止后不会自动续播本条消息剩余语音。

真实 Fish Audio 示例位于 `examples/agent-chat`：设置 `FISH_API_KEY` 或在「设置 → 语音」保存密钥，再在聊天框选择音色、试听并开启语音回复。默认 TTS 为 `s2.1-pro-free`，可切换 `s2.1-pro` / `s2-pro`；ASR 为 `transcribe-1-pro`。免费模型受供应商当前政策限制。配置保存在宿主 SQLite，密钥不返回浏览器。`/api/voice/settings` 管理配置，`/api/voice/voices` 读取真实音色目录，`/api/voice/transcribe` 接收原始音频，`/api/voice/speech` 代理 PCM 流。

语音模式的模型输出采用单个 JSON 对象 `{ "outputs": [{ "output_type": "text" | "speech", "content": "…" }] }`；Chat Completions 请求通过 `response_format: { "type": "json_object" }` 启用 JSON 模式，Responses 请求使用 JSON Schema 约束。服务端逐项校验渠道、非空内容、语音段落长度与数量，每个完整数组项到达后立即发送 NDJSON `{ type: 'output', output }` 事件，文字与语音并行交付，不向页面泄露半截 JSON。较长回复按语义分段，以便早开始播放。提示词读取 `examples/agent-chat/prompts/voice.md`；Fish S2 标签完整用法保存在 `prompts/voice-tags.json`，同一会话、同一模型首次使用语音时提供完整指南，成功完成后在宿主 SQLite 记住指南版本，后续只发送简短摘要。切换模型或指南更新后重新加载；失败或取消不记为加载成功。刷新页面及重启服务不会重复发送已经加载的完整指南。语音原文保留方括号情绪/语气/停顿提示并传给 TTS，显示和复制的语音文稿隐藏控制标签。语音模式规则只影响当前主 Agent 的用户回复，不修改子 Agent 的执行要求。普通文字模式沿用原有流式协议。语音输出文案随消息保存并带入后续对话，原始录音和合成音频不长期保存，重播会重新调用 TTS。实际首声时间仍包含模型、网络和 TTS 延迟；0.5 秒是音频预缓冲量，不是总延迟保证。流格式错误时会显示错误并保留已收到内容；只读文字或只输出语音均可。

接口依据：[Fish TTS](https://docs.fish.audio/api-reference/endpoint/openapi-v1/text-to-speech)、[Fish ASR](https://docs.fish.audio/features/speech-to-text)。本地并行开发可在 `.env.local` 设置 `AGENT_CHAT_PORT`、`PLAYGROUND_PORT`，保持固定端口和 `npm run dev` 同时启动。

`AgentMessage.timeline` 可接收按流式顺序排列的 `AgentExecutionEvent`。事件只包含通用的 `source`、`status`、`name`、`runId`、`parentRunId`、`agentId`、时间戳、耗时和安全错误摘要；`source: 'agent'` 会区分主 Agent 与子 Agent，`source: 'tool'` 显示 MCP 工具。侧栏默认折叠时间线，展开后按父子运行关系缩进，并显示真实耗时、重试、确认、失败、取消和超时；原始参数和结果仍只在确认卡片中按既有规则展示，不进入时间线事件。

服务端示例为每次聊天返回 `requestId` 和顶层 `runId`，工具及子 Agent 事件携带 `runId` / `parentRunId` 以便关联。失败事件使用 `AgentErrorInfo`，区分模型、MCP 连接、MCP 工具、工具参数、子 Agent 委派、校验、取消和超时；错误卡片显示错误码、requestId、阶段、是否可重试及下一步建议，不展示完整上游响应或敏感工具参数。

`onSessionDelete` 用于删除会话：组件在历史记录每一行提供删除按钮，点击后弹出二次确认，宿主确认后负责移除会话并切换 `activeSessionId`；删除失败时弹窗保留并显示错误。

`onSkillCreate` 用于接管聊天侧栏的「通过对话创建」，`SkillManager.onCreateViaChat` 提供同一入口（设置后替代工具栏的文件夹按钮），由宿主启动真实对话；未提供回调时保持原有界面。`onSkillImport` 用于接管聊天侧栏的 Skill 上传；Skill 的编辑、导入、收藏和删除统一由「设置 → Skills」页面接管。

组件保留各会话的本地草稿和待发送附件，支持 DarlUIProvider 主题。桌面固定在右侧，手机端全屏。Skill 管理器在「设置 → Skills」中支持新建、编辑、收藏、删除，以及导入 `SKILL.md` 或单个 Skill 目录的 ZIP / 文件集合；支持配套的 `references/`、`scripts/`、`assets/`、`agents/`、根目录依赖清单和其他资源文件。导入会校验 frontmatter、资源路径和大小，忽略 `.git`、`node_modules` 等缓存，不在导入时执行脚本。Skill 版本在保存时递增，真实存储由宿主通过 `onSkillImport/onSkillSave/onSkillDelete` 接管。演示中的历史和 Skill 保存在当前页面内存中，示例回复和工具记录均为本地演示，附件不上传。真实模型、MCP 执行、账号鉴权和服务端历史留给宿主接入。

应用和 Skill 从选择面板插入输入光标处，作为正文内引用，不显示输入框上方标签，也不自动传入当前页面。输入 `@` 引用应用或 Skill；继续输入名称或简介关键词可以筛选，上下方向键选择，Enter / Tab 插入，Esc 关闭建议。应用引用为蓝色，Skill 引用为紫色，可用 `--darl-agent-app` / `--darl-agent-skill` 覆盖。引用编码为 `[显示名称](app:ID)` / `[显示名称](skill:ID)`，发送时从正文派生应用和 Skill ID；删除引用即取消本次使用。

## AgentPlaza｜主 Agent 广场

`AgentPlaza` 只展示服务端标记为 `main_agent` 且允许用户选择的 Agent；`sub_agent` 不会出现在广场。卡片使用 1:1 图片，展示头像、名称和用途描述；点击后由宿主新建绑定该 Agent 的会话。`AgentSidebar` 顶部显示当前会话的头像和名称，不提供 Agent 切换；`AgentSession.agentId` 优先于兼容的 `selectedAgentId`，原 `onSelectedAgentIdChange` 已弃用。示例的新对话入口会返回广场，历史会话和刷新保持原 Agent，服务端拒绝同一已绑定会话的跨 Agent 聊天请求。

演示入口：`http://localhost:5188/#agent-plaza`；真实 Agent Chat 示例也提供「Agent 广场」入口。

```tsx
import { AgentPlaza } from '@darl/ui';

<AgentPlaza agents={agents} onSelect={(agent) => {
  setSelectedAgentId(agent.id);
  setChatOpen(true);
}} />
```

`AgentConfig` 支持 `type`（`main_agent` / `sub_agent`）、`selectable`、`callable`、`source` 和 `contextStrategy`。真实宿主必须在服务端再次校验这些字段；示例 Agent Chat 会强制系统默认 Agent 保持内置主 Agent，Sub Agent 只能由授权 Agent 委派，并将调用来源、任务、上下文范围和结果写入本地 SQLite。

## Agent 配置与 Sub Agent 委派

输入 `@` 后可按名称选择其他 Agent，再写需要沟通的问题，例如“@文案 Agent 请检查这段文案，再帮我汇总建议”。用户消息保存为 `[名称](agent:稳定ID)`，显示为内联标签；当前主 Agent 继续负责会话，实际联系被提及的对象并汇总回复。可以联系允许调用的其他主 Agent，也可以联系 Sub Agent；当前 Agent、停用或 `callable: false` 的对象不进入建议，服务端再次校验。每轮最多显式联系 8 个 Agent。

Agent 的 `@` 只对当前用户消息生效，历史提及不会每轮重复触发；再次 `@` 同一对象会续接该协作对话自己的历史，新主聊天保持隔离。已有 Sub Agent 的自主委派保留；其他主 Agent 仅在本轮被显式提及时提供调用工具。时间线展示真实联系、执行、完成或失败，协作工具沿用本轮审批模式，停止会中止正在进行的联系。被联系的 Agent 本轮不再递归委派，防止相互调用循环。仅收到真实调用结果后才能汇总，失败和取消如实显示。

实现复用现有 AI SDK `ToolLoopAgent` 与 SQLite 子会话。显式联系通过工具选择约束确保实际尝试；主 Agent 可以继续追问同一对象。该方式对应 [OpenAI 的 agents-as-tools 模式](https://openai.github.io/openai-agents-js/guides/multi-agent/)和 [LangChain 的主管/子 Agent 模式](https://docs.langchain.com/oss/javascript/langchain/multi-agent/subagents)，保留当前会话负责人。

`examples/agent-chat` 的设置中心提供独立的 Agents 页面。每个 Agent 在服务端保存名称和系统提示词；模型与推理强度在聊天输入框旁按当前会话选择。Skills 与 MCP 应用对所有 Agent 默认可用，无需逐个授权；API Key 仍只保存在服务端。从 Agent 广场选择专业 Agent 后开启固定身份的会话，也可以由主 Agent 通过 AI SDK 7 `ToolLoopAgent` 按需委派给其他已启用的 Agent。

设置中心的模型页面顶部同时提供默认媒体模型设置，目前只配置图片和视频：默认图片为 `gpt-image-2`（2K、16:9），也可以选择 `gpt-image-2.5` 或 `gemini-3-pro-image-preview`；默认视频为 `minimax-h3-flash`（480、16:9）。图片产品选项只有画幅、1K/2K/4K 档位和参考图数量；视频清晰度用 H3 协议值 480/768。配置保存在示例服务的本地 SQLite 中；文本模型在聊天输入框旁选择。

每次委派只把任务说明传给子 Agent，子 Agent 使用当前聊天选择的文本模型、自己的提示词和当前会话启用的 Skill / MCP 应用，完成后只返回最终摘要。MCP 写操作继续复用宿主的 `ToolConfirmations`，因此允许、拒绝、停止和超时都在服务端生效；NDJSON 工具事件包含 `runId`、`parentRunId` 和 `agentId`，现有侧栏会显示委派、执行和审批状态。Agent 配置保存在 `.local/agent-chat/data.sqlite`，不会写入浏览器存储。

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

`SettingsPage` 提供设置中心的导航外壳，`ModelManagementCard` 负责逻辑模型、能力模板、供应商渠道和覆盖能力，`ModelSettingsCard` 保留为旧版 Provider + 模型目录适配，`AgentSettingsCard` 负责系统提示词编辑。模型类型统一为 `text`、`image`、`video`、`audio`；模型的推理强度和能力标签由宿主提供，API Key 只通过宿主回调保存，组件不会自行持久化密钥。

模型配置的数据层导出 `LogicalModel`、`CapabilityTemplate`、`ModelBinding`、`ModelConfiguration` 以及 `resolveCapabilities`、`validateModelConfiguration`、`toAgentModels`、`toMediaModels`。模板字段由绑定覆盖时采用整体替换，`0` 和 `false` 会保留；协议键只在宿主注册后参与运行时路由。

```tsx
<ModelManagementCard
  configuration={configuration}
  providers={providers}
  onSave={saveConfiguration}
  onProviderSave={saveProvider}
/>
```

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

设置中心当前提供模型、Agents 和应用 / MCP 入口；页面内容由宿主通过 `children` 接入。文本模型编辑器提供 `vision` 图片输入开关；模型配置完成后，将 `providers` 中启用的模型转换为 `AgentSidebar` 的 `models` 即可复用同一个聊天侧栏。


## DefaultModelSelector｜默认模型向导

默认顺序为文本 → 图片 → 音频 → 视频，也可以通过 `kinds` 只配置宿主需要的类型。传入模型（必填）及可选能力、默认值；组件以弹窗提供选择流程，只管理选择和交互，`onComplete` 交给宿主保存。缺少已配置类型的模型时不允许完成；最后一步确认配置并保存。模型使用下拉框，支持手机端布局与 DarlUIProvider 主题。

```tsx
import { DefaultModelSelector, type DefaultModelOption } from '@darl/ui';

const models: DefaultModelOption[] = [
  { id: 'text-model', name: 'Text', type: 'text' },
  { id: 'image-model', name: 'Image', type: 'image',
    capabilities: { resolutions: ['1K','2K','4K'], aspectRatios: ['3:4','4:3','16:9','9:16'] } },
  { id: 'audio-model', name: 'Audio', type: 'audio' },
  { id: 'video-model', name: 'Video', type: 'video',
    capabilities: { resolutions: ['480P','768P'], aspectRatios: ['9:16','16:9'] },
    defaults: { resolution: '768P', aspectRatio: '9:16' } },
];

const [open, setOpen] = useState(false);

<Button onClick={() => setOpen(true)}>配置默认模型</Button>
<DefaultModelSelector
  open={open}
  onOpenChange={setOpen}
  models={models}
  kinds={['text', 'image', 'audio', 'video']}
  onComplete={async (result) => saveDefaults(result)}
/>
```

- `models`: 所有模型的数组，支持运行时更新；每条记录需要 `id`、`name`、`type`，也可提供 `description`。
- `kinds`: 可选的向导类型顺序；例如 `['image', 'video']` 只配置图片和视频，适合 Agents 等只提供媒体模型的页面。
- `capabilities.resolutions`: 分辨率列表；省略时图片使用 1K/2K/4K、视频使用 480P/720P/1080P。显式空数组隐藏相应参数。
- `capabilities.aspectRatios`: 支持的比例，限定 3:4、4:3、16:9、9:16；省略时提供全部四种。
- `defaults.resolution` 与 `defaults.aspectRatio`: 模型建议默认值；未提供时图片优先 2K、视频优先 720P、画幅优先 9:16，不支持时使用首个有效选项。
- `value`/`onChange`: 可选受控模式；`defaultValue` 为非受控初值；`onComplete` 必填，返回已配置类型的 `{ modelId, resolution?, aspectRatio? }`，可以异步保存，出错时保持当前选择并展示错误。
- `open`/`onOpenChange`: 传入后以弹窗模式渲染；按 Esc、点击遮罩或关闭按钮可关闭。未传 `open` 时保留内嵌渲染，便于兼容已有用法。
- `accentColor`/`className`: 可选外观覆盖。组件不调用模型 API、不保存配置、不加载远程模型数据。
- 切换模型时应用该模型默认参数；返回已有步骤保留用户有效的手动选择。宿主替换模型列表后，失效模型/参数自动回退到有效选项。

Playground：`/#agent-sidebar`，点击「默认模型」打开图片和视频配置。


## InteractiveConfirmDialog｜通用 Agent 交互确认弹窗

可以在任意 React Agent 宿主中显示一组可配置问题，用户确认后返回结构化答案。组件仅处理本地交互，继续执行 Agent、记录会话或发送 API 由宿主负责。

```tsx
import { InteractiveConfirmDialog } from '@darl/ui';

<InteractiveConfirmDialog
  open={open}
  onOpenChange={setOpen}
  title="确认本次改编方案"
  confirmText="确认方案，开始正式剧本写作"
  questions={[
    { id: 'duration', label: '目标成片时长', type: 'single', required: true,
      defaultValue: '6m', options: [{ value: '6m', label: '6 分钟' }, { value: '10m', label: '10 分钟' }] },
    { id: 'notes', label: '其他修改要求（可选）', type: 'textarea' },
  ]}
  onConfirm={async (answers) => {
    // answers: { duration: '6m', notes: '...' }
    await resumeAgentWithAnswers(answers);
    setOpen(false);
  }}
/>
```

- `open/onOpenChange`：受控弹窗开关；`title/description`：标题与描述；`questions`：按顺序展示的问题数组（`id` 必须唯一）。
- `type`：`single` 单选、`multiple` 多选、`text` 单行文本、`textarea` 多行文本；选择题使用 `options: { value, label, description?, disabled? }[]`。
- `required` 默认为否，`defaultValue` 提供初始答案；`placeholder` 设置输入提示。
- 默认只显示确认按钮；需要额外的取消按钮时传入 `showCancel`，并可用 `confirmText/cancelText` 配置文案。`cancelVariant` 可为取消按钮选择 Button 变体（例如 `destructive` 显示危险红色），`onCancel` 响应所有关闭方式，包括 Esc、遮罩、关闭按钮和取消按钮；`accentColor/className` 可覆盖样式。
- `onConfirm(answers)` 返回 `Record<questionId, string | string[]>`；多选始终是数组，输入题始终是字符串。支持 Promise：处理中禁用按钮，失败保留答案并显示错误；成功后由宿主关闭弹窗并恢复 Agent。

Playground：`/#confirm-dialog`（含原著改编确认示例及模拟提交失败）。

AgentSidebar 支持 `embedded` 嵌入宿主容器，使用 `draft` / `onDraftChange` 将草稿交给宿主持久化。`references` / `onReference` 提供稳定 ID 的宿主资料引用（`node:`），`composerHeader`、`composerFooter`、`messageHeader` 和 `renderMessageActions` 用于挂载引用摘要、上下文用量及成果定位等宿主交互。未传这些属性时沿用组件自管草稿与侧栏布局。Agent 管理卡片可通过 `skills` 和 `applications` 编辑默认技能与 MCP 范围，实际权限由宿主后端执行。
