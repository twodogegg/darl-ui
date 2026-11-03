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

短片页可预览已选片段、查看历史、裁剪拼接并保存成片；合成使用服务端 FFmpeg，处理的视频须已保存在文件服务中。`npm run dev` 同时启动仓库内的 OpenCut Classic（内部固定端口 5310），如需使用该服务仍需安装 Bun 并在 `external/opencut-classic/` 执行 `bun install --frozen-lockfile`。

`npm run dev` 同时启动组件演示站（5188）和真实模型示例（5197），端口被占用时直接报错。两个服务都监听 `0.0.0.0`，同一局域网内的其他设备可通过 `http://<本机局域网 IP>:5188` / `:5197` 访问。

图片供应商返回的图片地址如需代理访问，可在 `.env.local` 设置 `IMAGE_DOWNLOAD_PROXY=http://127.0.0.1:代理端口`，并重启开发服务。图片下载先直连，失败后使用该 HTTP(S) 代理重试；代理需能够访问供应商返回的图片地址。

### 业务文件存储（COS / 本地）

Agent Chat 的素材上传、命名字体、项目封面和媒体结果统一通过宿主文件服务保存。默认是本地模式，文件写入 `.local/agent-chat/files/`；配置 COS 后新文件写入 `COS_OBJECT_PREFIX` 指定的目录（默认 `darl-ui`），历史文件仍按各自记录的后端读取。

- 「设置 → 存储」可配置本地 / COS 并测试真实写入和删除；配置保存在服务端 SQLite，SecretKey 不返回浏览器，且配置接口只接受本机回环地址。首次运行也支持用环境变量提供默认值：`STORAGE_MODE`、`LOCAL_STORAGE_ROOT`、`COS_SECRET_ID`、`COS_SECRET_KEY`、`COS_REGION`、`COS_BUCKET`、`COS_SCHEME`、`COS_PUBLIC_BASE_URL`、`COS_OBJECT_PREFIX`。
- 文件按 SHA-256 内容去重，数据库只保存文件元数据和业务引用，不把大 Base64 写入任务行或项目封面 BLOB。
- 数据库存原图 URL，原图只保存一份；展示尺寸为列表/引用标签 160px、素材卡片 320px、画布节点 640px、详情预览 1024px。COS 使用 `?imageMogr2/thumbnail/宽度x/quality/80/format/webp` 实时处理，缓存键须保留处理参数；本地 `/api/files/:fileId?width=160|320|640|1024` 使用 `sharp` 返回等价 WebP。COS 文件的旧 `/api/files/:fileId` 链接重定向到存储域名，媒体传输不经过应用服务器。
- 图片列表懒加载，放大原图、下载和 AI 参考素材使用原图；视频卡片首次渲染不挂视频源，点击播放后才请求并支持 Range。
- 首屏 Skills 只返回目录，管理界面按需读取完整资源；工作台、生成任务和视频转绘轮询等待请求完成后再继续，隐藏页面暂停，未变化快照通过 ETag/304 避免重复传输。任务列表返回摘要，供应商诊断响应保留在详情；不需要多轮改图的 Gemini 图片任务不保存 `thoughtSignature`，启动时清理历史签名。
- 删除生成批次或任务会真实删除其专属结果文件；仍被其他任务引用的文件会阻止删除。旧 `generated-media/`、旧参考图路径和旧 BLOB 数据不做兼容读取或迁移，已失效的历史供应商 URL 无法恢复。

### 短剧工作台

Agent Chat 默认打开 `/studio/`，提供项目、大纲、剧本与场次、美术资产、分镜、短片剪辑、资产库和提示词设置。分镜页维护视频片段描述、时长和生成历史，短片页提供剪辑入口。视频转绘根据原视频分析生成镜头（含景别与运镜）及原片依据，先在镜头校对页核对，再供剧本、资产和视频制作使用。镜头校对和剧本页可向原工作流 Agent 连续反馈；结果经校验后直接写入，可通过变更日志还原。页面迁自 RN 短剧 web，代码位于 `examples/agent-chat/client/studio/`；沿用其业务字段，接入当前宿主的 Agent、模型配置、文件服务和 SQLite，不依赖旧 RN 服务或数据库。首次启动不创建演示项目或生成结果。

人工编辑与 Agent 共用 `server/studio.ts` 业务服务。项目创建时上传的文本保存在项目 `sourceScript`，在独立的“原始素材”页面展示，供大纲创作参考，不自动生成剧集；小说、剧本或其他文字资料都放在这里，剧本页保持独立。两个内置工具分别查询和批量编辑；查询支持项目、剧集、场次、ID、字段筛选与分页，`describe` 返回字段说明、类型与创建必填项，编辑工具使用同一份字段 schema。角色对白必须引用当前项目的真实角色资产，资产与分镜可同批创建。字段和引用错误返回具体记录、字段路径与修正提示。每批最多 500 条修改，在一个短事务内校验引用与版本，失败整批回滚；同一请求编号可以安全重试。分镜时长、片段关联与排序由代码校验，剧本改编、资产归并与创意判断由 Agent 处理。页面定期同步工具修改，未保存草稿遇到外部修改会保留并提示冲突。

剧本模式在大纲页点击“编写分集剧本”时，如无剧集会创建第一集；首集没有正文且未提交过生成任务时，自动启动小说转剧本工作流。执行模型、整理模型、提示词、Skills 和只读工具在「设置 → 工作流 Agents → 小说转剧本」配置。任务读取项目原文、大纲、分集与时长设置，先生成报告再整理并校验写入场次；可在任务详情查看状态和报告，已有正文不会覆盖，失败可在剧本页重试。

剧本模式确认全部剧本进入美术资产时，若项目没有资产且未提交过该任务，会自动启动“剧本资产提取”，根据全项目大纲和剧本生成角色、场景、道具及提示词；资产页可提交重新提取及修改要求，结合当前资产更新文字和提示词，按要求移除资产，保留继续使用的资产图片和关联。任务可查看、取消和失败重试，执行模型、整理模型与 Skills 可在工作流 Agents 中配置。

剧本项目的新剧集默认不设置本集目标时长；生成剧本时参考创建项目时设置的单集时长区间。用户或 Agent 可填写本集目标秒数，已有时长不会自动改写。

图片和视频按钮复用现有持久化生成队列，独立于聊天会话。真实结果写入资产或片段的历史版本；生成期间目标被修改时保留结果，不覆盖当前选用版本。当前支持图片生成/参考编辑，以及 H3 的文本、图片、视频和音频/音色试听参考视频；音频参考须搭配图片或视频，实际声音保持效果需试听生成结果。首尾帧、工作台的 AI 音乐与音色设计尚未接通。模型和服务端凭证需要在现有设置中配置，失败会显示真实错误。 美术资产页可查看和修改项目视觉风格，官方预设与自建风格统一用于生成；批量补图固定本次选定的风格，保留已有主图和衍生图；缺主图时先生成主图，再参考选用主图逐个补齐缺失的衍生形态，主图失败则跳过对应衍生任务。融合资产可在依赖资产区关联同项目资产的主形象或具体形态，依赖未出图时禁止生成；后台自动传入图片和用途说明，禁止循环依赖，批量生成仅补齐缺图，不重做已有主形象或衍生形态；先处理缺失的依赖。生成结果按图片记录实际引用，参考图更新后提示重新生成，生成期间依赖变化则仅保留历史。美术资产抽屉支持主图与衍生形态生成、参考改图、清晰度/画幅选择和历史选图；页面显示持久化任务状态，刷新后可继续查看已提交任务的结果。剧集列表可确认删除本集及关联分镜、片段和成片记录，项目共享资产保留。

网站已下线侧边栏聊天助手、Agent 广场与普通 Agents 管理；独立的「设置 → 工作流 Agents」继续用于配置创作任务。Skills、模型、媒体任务及历史数据保留。原本依赖聊天助手的剧本重写、音色设计与音频生成入口已移除；也可在剧本页手动添加剧集并使用小说转剧本工作流。

分镜图模式为每个视频片段独立维护 `clips.storyboardPrompt`，默认一张 2×2 四宫格；视频提示词保存在 `clips.prompt`。视频提示词工作流先创建片段与提示词；四宫格模式的分镜提示词可在页面填写或调整。 视频制作页顶部可对当前片段或本集全部片段切换生成方式；分镜与视频提示词均支持针对当前片段或批量输入要求交给 AI 调整。转绘项目的视频提示词调整复用首次生成的视频提示词工作流 Agent、Skills、整理模型及上游报告，并携带当前页面数据、视频模型、选中片段和修改要求；分镜提示词调整仍调用提示词优化模型。结果逐项保存，进度和失败原因显示在调整窗口。 批量调整将选中片段一次交给模型统一生成，逐项校验保存；单项失败可单独重试。片段“其他参考素材”可从生成记录选择图片并重命名，分镜提示词中用 @ 引用；片段分镜图的“选图”可直接选用生成记录中的图片。生成时按实际附件顺序标注资产和参考图。

视频制作以片段自身为单位：底部按场次选择片段，左侧管理素材和片段图片，中间编辑视频描述与生成参数，右侧预览。初始站位、镜头画面、动作、切镜和对白统一保存在 `clips.prompt`；`clips.duration` 独立维护，单条片段最多 15 秒，提交时按模型支持的时长向上取整。视频描述与时长由片段独立维护。转绘图片依据当前视频描述生成；资产与音色来自片段关联、描述中的资产引用和显式参考。项目内图片和视频在各自生成历史中显示排队、运行、失败和结果；请求入队后可继续提交多个版本，无需等待运行结束。独立「生成媒体」只列出未关联项目生成目标的任务。视频描述复用现有普通/H3 提示词优化，原文与结果并列对比，确认后应用；当前浏览器标签页保留各片段最近一次优化，应用或刷新后仍可对比、还原原文，后续修改过的描述不会被直接还原覆盖。关联素材按实际图片地址去重，未生成图片的资产只显示名称和状态。模型与参数下拉框直接显示生效值。视频片段可上传本地视频，保存到历史并选用；失败或结果待确认的生成记录可在确认后删除，运行中的任务需等待结束。

`npm run dev` 同时启动前后端和组件站。默认端口为 5197 / 5188，可通过 `.env.local` 的 `AGENT_CHAT_PORT` / `PLAYGROUND_PORT` 设置固定端口。工作台默认使用 `.local/agent-chat/data.sqlite`；设置 `AGENT_CHAT_DB_PATH` 可指定相对于该目录的数据库文件名或绝对路径，变更后重启所有服务。文件使用现有存储配置，无需 `PROJECT_API_BASE_URL`、`PROJECT_API_TOKEN` 或第二个后端。数据 API 允许本机和同一局域网访问，当前宿主面向本地单用户。

角色可标记为“仅声音”，无需生图提示词和图片，也不计入批量补图及转绘缺图检查。视频片段中可单独关闭角色图片引用，保留角色和音色；画外音及不入画要求仍需写进视频描述。H3 已优化提示词的图片引用发生变化时需重新优化。

### 视频转绘

「设置 → 工作流 Agents」分别配置视频分析、剧本编写、资产提取、正式分镜和视频提示词拆分的执行模型、系统提示词、Skills 和只读内置工具，以及各自的整理模型。每个节点先保存执行 Agent 的完整报告，再由整理 Agent 转为页面字段并校验写入；校验未通过时，具体错误会交回整理 Agent 最多自动修正两次。页面只显示整理后的字段，完整报告交给下游节点：剧本、资产、正式分镜和视频提示词节点读取同集、同一原片上游节点最近完成的报告（正式分镜须已应用），与页面记录冲突时以页面记录为准。各页面的「任务详情」分步显示执行、整理和保存状态，可查看交付报告、页面字段和执行过程。整理或写回失败后可从已保存的完整报告重新整理，业务数据发生变化时会阻止覆盖。

顶栏「变更日志」记录页面编辑、对话 Agent、工作流节点和媒体写回的每次写入，默认显示 Agent 与工作流的修改；可切换项目或全局资源，按字段查看修改前后内容，整批或逐条还原。之后又被修改的内容会跳过并说明原因，还原本身也记入日志并可撤销。每个项目保留最近 1000 批记录。

首页「视频转绘」支持日本/日语和欧美/英语。上传 MP4 并创建项目后，Agent 使用视频转绘工具提交分析任务：服务端使用 PySceneDetect 检测候选镜头，直接复用文件服务中原片的 COS 原图地址（历史本地原片通过现有 COS 配置上传并校验后保留同一 fileId），无需网关文件上传，再使用 `VIDEO_ANALYSIS_BASE_URL` 和服务端 `VIDEO_ANALYSIS_API_KEY` 调用视频模型校正切点并生成结构化分镜和资产状态。原片限 300 MB、300 秒；运行环境需安装 `ffmpeg`、`ffprobe` 和 `scenedetect`。任务和分析结果持久保存，失败、取消或服务中断后可查询并重新提交；更换原片后不会复用旧分析。

`VIDEO_ANALYSIS_VIDEO_URL_FORMAT` 控制视频地址在请求中的格式：`object`（默认）发送 `{ "url": "..." }`，`string` 直接发送地址字符串；按视频分析接口的实际要求设置。修改 `.env.local` 后需重启开发服务。

排查转绘工作流时，在 `.env.local` 设置 `VIDEO_REDRAW_DEBUG=1` 开启，设为 `0` 或删除该项关闭，修改后重启服务。每次任务的日志分别位于 `.local/agent-chat/logs/workflow-debug/`，文件名包含项目、任务类型和任务 ID；同一任务的所有模型调用和工具步骤保存在同一文件。日志记录完整文本输入、合并后的模型输出与推理文本（如有）、工具调用及错误；视频分析调用记录请求正文与响应。密钥、签名参数及内联二进制媒体会脱敏或省略，普通图片/视频文件引用保留。后续模型请求的重复上下文通过 `inputRef` 引用前一轮，新增消息保留在 `input.prompt` 或 `input.messages`；用 `node scripts/read-workflow-log.mjs <日志文件>` 还原整份日志，追加 `--call <模型调用ID>` 查看某次完整请求。日志包含项目内容，保存在本机且不自动清理，可按需手动删除。旧版日志保留原样，读取工具同样支持。

默认模型初始化自 `examples/agent-chat/prompts/video-redraw.json`，工作流 Agent 提示词在「设置 → 工作流 Agents」中配置；整理阶段使用独立的页面字段合同，不再注入默认创作提示词。剧本编写使用独立的执行模型和整理模型，以目标地区、语言及已确认目标对白为准，在已有场次内生成正文并列出待确认事项，已有剧本不会覆盖。资产提取读取上游报告、分镜、场次和资产，不再次调用视频模型；整理并校验后直接更新已有资产文字与提示词、保留图片，修改可在「变更日志」查看和还原。已有角色新增的镜头关联须在镜头文字中出现角色名称、别名或编号，否则不写入并在任务详情列出，其余结果照常保存。转绘流程依次为原片、镜头校对、剧本、转绘资产、视频制作、短片；原片分析生成的镜头含景别与运镜，先在镜头校对页核对台词、说话人和切点，再编写剧本。正式分镜 Agent（`plan-storyboard`）不再提供页面入口，仍可由 Agent 调用；它读取剧本、原片分析、资产文字与现有镜头，通过独立模型整理待审核建议，确认后才写入；当前不读取图片像素。镜头运镜及目标时长可编辑，页面显示一位小数，原片来源时间保留原始精度。从转绘资产页进入视频制作前检查资产图片和生成任务，并选择视频模型及生成方式；本集尚无片段时，参考生成会启动视频提示词工作流，四宫格分镜同样启动视频提示词工作流创建片段和视频提示词，分镜提示词需在页面填写或使用调整功能，再生成分镜图。已有片段由用户或 Agent 调整，视频制作页也可填写补充要求手动启动。原片重新分析不会自动覆盖已有分镜；资产提取会按上述规则更新资产文字。

视频转绘新剧集的目标时长默认不设置，可在剧本页填写；原片时长单独保存在原片元数据中。剧本与资产提取节点读取当前目标时长，流程视图显示当前值，历史任务面板保留当次实际输入；当前未设置时不得沿用旧报告中的目标值。转绘项目可在侧栏（手机端在顶部横幅）切换「步骤 / 流程」视图。流程视图（`/studio/flow`）为只读：资产分析与提示词节点涵盖提取、整理和校验，工作流先生成片段与视频提示词；分镜图模式再填写或调整分镜提示词并生成分镜图，最后生成视频；参考生成模式可跳过分镜提示词和分镜成图。节点状态从页面记录、转绘任务和媒体任务推导，不另存流程数据；资产图片齐全时保留最近一次提取失败提示。点开节点可查看已有运行记录的输入、输出和页面内容；实线表示页面数据依赖，虚线表示任务实际收到的上游报告，上游之后又完成新运行时标为旧版。手机端按流程顺序显示节点列表。

剧本项目同样可切换流程视图，查看大纲、剧本编写、美术资产提取与成图、分镜与视频提示词、分镜图、视频及成片；节点数据来自当前页面与已有任务记录。剧本项目调整已有视频提示词时使用「工作流 Agents → 剧本分镜」的执行模型、指令和 Skills，保留原片段的时长和关联；转绘项目使用「视频提示词」工作流。

工作流 Agent 会将所选 Skill 正文中链接的本地 Markdown 参考文件一并提供给执行模型；缺失的 `references/` 文件会报错，脚本和未引用文件不会自动执行或发送。流程视图区分当前 Agent 的 Skill 设置与历史任务当时的设置；视频提示词调整属于独立操作，不会改写首次生成任务的历史记录。

剧本项目在「工作流 Agents → 小说转大纲」配置独立的执行模型、整理模型、指令和 Skills。创建项目后自动分析原始素材并生成大纲；已有大纲可在大纲页填写意见，调用同一工作流修改。项目在运行期间未发生变化时自动保存结果，否则保留草稿供查看，避免覆盖修改；手动表单有未保存内容时须先保存。此流程无需预先创建剧集；大纲页的任务详情展示执行报告、页面字段和执行过程，流程视图可查看实际输入。

首页不再选择生成模式；改编幅度继续保留忠实、抽核、借壳。视觉风格默认“不指定”，也可手动选择；未指定时，美术资产 Agent 根据剧本与创作要求从风格目录选定统一风格，与资产一同保存，后续生图自动复用。已指定的风格保持不变，可在美术资产页调整；流程视图展示风格输入与确定状态。

目标图片和视频复用现有媒体队列与真实模型配置；片段创建时关联镜头资产，生成前要求目标资产图已准备。当前使用图片参考重新生成，不提供原片连续动作逐帧转绘或精确口型保证。翻译不等于目标配音完成，需试听实际生成结果。「合成导出」按勾选顺序裁剪、拼接选用视频，保留各片段生成音轨，不混入原片声音；导出为统一 480 级 H.264/AAC MP4，记录到现有成片资源。字幕制作、独立配音和更高精度动作编辑仍需对应实际能力。

配套 `examples/agent-chat/skills/video-redraw/` 提供创作规则，`darl-studio` 描述查询、解析、补漏、应用与导出 Tools；工作流阶段提示词在「设置 → 工作流 Agents」维护。技能可加载不代表模型账户可用；上游余额、模型权限或调用失败会显示真实错误。

剧本项目从美术资产进入分镜时，当前集没有视频片段则自动启动独立的「剧本分镜」工作流。它读取项目大纲、本集剧本与场次、美术资产和默认视频模型时长，生成视频提示词并创建片段，仅分镜图模式额外生成分镜图提示词；已有片段不会覆盖。执行模型、整理模型、提示词及 Skills 在「设置 → 工作流 Agents → 剧本分镜」中配置，任务详情展示真实进度与错误。

`PromptSettingsCard` 可通过可选的 `visibleKeys` 限定显示的提示词项；未传时保持原有行为。

### 服务配置

复制 `.env.example` 为 `.env.local` 并配置服务端模型凭证；也可通过「设置 → 模型」管理提供方、协议和模型绑定。工作流的模型、提示词、Skills 与工具在「设置 → 工作流 Agents」配置。Skills 库支持导入、编辑与收藏。

服务默认只接受对应端口的同源请求。反向代理或隧道使用自定义域名时，通过 `AGENT_CHAT_ALLOWED_HOSTS` 配置允许的主机；公开服务前须自行设置访问保护，因为服务持有模型凭证。预览使用 `npm run preview:agent-chat` 和 `AGENT_CHAT_PREVIEW_PORT`。

`PromptSettingsCard` 可通过可选的 `visibleKeys` 限定显示的提示词项；未传时保持原有行为。

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
  onOptimizePrompt={handleOptimizePrompt}
  onUpdateStyle={handleUpdateStyle}
  onRetry={handleRetry}
  onCancel={handleCancel}
  onRegenerate={handleRegenerate}
  onFavoriteChange={handleFavoriteChange}
/>
```

模型、任务、批次和异步状态由宿主传入；组件不调用真实生成 API，不上传文件，不自行保存任务。切换模型保留素材，超限阻止生成；不支持的参数与素材不进入请求。可选 `onOptimizePrompt(request, { signal })` 返回优化文本；请求包含当前 `model`、`options`、`mode`、风格、参考素材、生成次数及 `optimization: 'general' | 'h3'`，真实模型调用与配置由宿主负责。

批次长提示词支持展开 / 收起，视频参考图随生成参数保存；生成卡片显示上游真实进度，未提供进度时保持等待状态。

真实提示词优化、优化对比 / 还原及风格编辑演示位于 `http://localhost:5197` 的「媒体生成」，同样直接调用组件库源码。

通过 `renderReferencePicker` 可让「素材」按钮打开宿主资产库；接收当前素材、模型支持的类型及应用/取消回调。粘贴和拖拽仍沿用 `onUploadReference`。

演示入口：`http://localhost:5188/#media-workspace`。包含「创作工作室」与「品牌宣传」两种宿主配置、深浅主题及本地异步模拟。示例媒体为本地示意素材。完整模型类型、API、接入示例和边界见 [MediaWorkspace 文档](docs/media-workspace.md)。


## StyleSelector｜风格选择弹窗

`StyleSelector` 提供风格广场弹窗，支持集合切换、分类筛选、搜索、选择、收藏和两步创建风格向导。宿主通过 `styles` 提供风格数据，通过 `onChange`、`onFavoriteChange` 和 `onCreate` 接收结果；`onCreate` 可以返回 Promise，失败时会保留表单并显示错误。创建入口位于「我的风格」卡片；传入 `onUpdate(style, request)` 后自有风格显示编辑按钮，保存后由宿主刷新列表。

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

`SettingsPage` 提供设置中心的导航外壳，`ModelManagementCard` 负责逻辑模型、能力模板、供应商渠道和覆盖能力，`ModelSettingsCard` 保留为旧版 Provider + 模型目录适配。模型类型统一为 `text`、`image`、`video`、`audio`；模型的推理强度和能力标签由宿主提供，API Key 只通过宿主回调保存，组件不会自行持久化密钥。

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

设置中心按宿主传入的导航项和内容展示设置。

## RequestRecords｜请求记录

真实示例的「设置 → 请求记录」提供文本、图片、音频、视频类型筛选，并支持状态、供应商、模型、日期范围和请求 ID/错误搜索，服务端分页。详情展示参考图、生成图片、可播放的音频/视频、文本结果、请求参数、响应摘要和真实 Token 用量，支持打开关联媒体任务。素材已删除或加载失败时显示「素材不可用」。

请求记录保存在同一服务端 SQLite 中。文本在 AI SDK 模型调用边界逐次记录步骤与重试，媒体跟踪任务最终状态，Fish 语音识别保存输入音频及转写结果，语音合成保存可回放的 WAV。已有媒体任务在首次启用时导入；历史聊天无法恢复为准确的模型请求，不倒推生成记录。凭证在写入前脱敏，二进制/Base64 不进入记录，参数与结果正文为有大小上限的快照，不保存隐藏推理。

自动清理默认开启、保留 30 天，可关闭或设置 1–3650 天。服务启动、每小时及保存设置时清理已结束且过期的记录；排队中/进行中的记录、项目、任务和素材文件不会被清理。API 沿用宿主同源检查，且仅允许本机和局域网访问。

```tsx
import { RequestRecords } from '@darl/ui';

<RequestRecords
  loadRecords={(filters, signal) => host.listRequests(filters, signal)}
  loadRecord={(id, signal) => host.getRequest(id, signal)}
  loadRetention={(signal) => host.getRetention(signal)}
  saveRetention={(settings) => host.saveRetention(settings)}
  onOpenSession={(id) => openSession(id)}
  onOpenTask={(id) => openMediaTask(id)}
/>
```

组件通过宿主回调获取数据和持久化设置，不自行调用 API。`loadRecords` 返回 `{ items, total, models, providers }`；`loadRecord` 返回含 `references` / `results` 文件引用和可访问 URL 的详情。回调应遵守 `AbortSignal`，组件切换筛选或卸载时会取消请求。Playground 的 `/#settings` →「请求记录」使用明确标注的本地示例，支持真实筛选、预览和设置交互。

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

Playground：`/#settings`，点击「默认模型」打开图片和视频配置。


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
- 默认只显示确认按钮；需要额外的取消按钮时传入 `showCancel`，并可用 `confirmText/cancelText` 配置文案。`cancelVariant` 可为取消按钮选择 Button 变体（例如 `destructive` 显示危险红色），`onCancel` 响应所有关闭方式，包括 Esc、遮罩、关闭按钮和取消按钮；`accentColor/className` 可覆盖样式，`style` 可将宿主主题 CSS 变量传入弹窗 Portal。
- `onConfirm(answers)` 返回 `Record<questionId, string | string[]>`；多选始终是数组，输入题始终是字符串。支持 Promise：处理中禁用按钮，失败保留答案并显示错误；成功后由宿主关闭弹窗并恢复 Agent。

Playground：`/#confirm-dialog`（含原著改编确认示例及模拟提交失败）。

## AssetLibrary｜资产库弹窗

`AssetLibrary` 是资产库弹窗：左侧分区（生成历史、我保存的、我上传的），顶部标签行（全部、角色、场景……及自定义标签）、搜索和新建，主体是资产卡片网格，带空态、加载、分页和右键菜单。组件只负责 UI 与通用交互，资产数据、存储、鉴权和保存都由宿主接管。

```tsx
import { AssetLibrary } from '@darl/ui';

<AssetLibrary
  open={open}
  onOpenChange={setOpen}
  assets={assets}
  tags={tags}
  value={selectedId}
  onSelect={({ asset, index }) => insertPromptReference(asset, index)}
  onFavoriteChange={(asset, favorite) => saveFavorite(asset.id, favorite)}
  onRename={async ({ asset, name }) => renameAsset(asset.id, name)}
  onDelete={(asset) => deleteAsset(asset.id)}
  upload={uploadAsset}
  onCreate={(filter) => openCreateDialog(filter)}
  onCreateTag={(label) => createTag(label)}
  onDeleteTag={(tag) => deleteTag(tag.id)}
  hasMore={hasMore}
  onLoadMore={loadMoreAssets}
/>
```

- 弹窗模式：传入 `open`（或 `onOpenChange`）后渲染为固定遮罩上的模态弹窗，宽 `min(1240px, 100vw - 96px)`、高 `min(820px, 100dvh - 96px)`，680px 以下变为贴底的抽屉（94dvh）。关闭按钮、Esc、点击遮罩都会调用 `onOpenChange(false)`；不传 `open` 只传 `onOpenChange` 时由组件内部维护开关（`defaultOpen` 设置初始值）。完全省略这两个属性时组件原地嵌入渲染，便于宿主自建容器或弹层。
- `title`：弹窗标题与无障碍名称，默认「资产库」。
- `assets`：`AssetItem[]`。`id/name/kind` 必填；`kind` 为 `image | video | audio | effect | text | other`，决定缩略图回退图标与视频/音频时长角标。`section` 缺省时按 `favorite` 推断（收藏进「我保存的」，否则「我上传的」）；`tags` 对应 `AssetTag.id`；`thumbnail`/`url` 分别用于预览与下载；`uploading`（0–100）显示上传进度并禁用操作。`detectKind(file)` 可用于上传时推断类型。
- `tags`：标签定义 `{ id, label, removable? }`。不传时使用默认标签（全部/角色/场景/物品/风格/音效/音频/视频），并自动补充资产里出现但未登记的标签（`label` 为 id）。`removable` 的标签在传 `onDeleteTag` 时显示删除按钮。
- 生成历史分区与另外两个分区工具栏不同：顶部为「本项目 / 全部项目」范围切换（`scope` / `onScopeChange`，受控或内部维护），第二行为类型筛选（全部/图片/视频/音频，带计数，复用 `tag`/`onTagChange`，值 `all|image|video|audio`）和右端的高级筛选按钮（`onAdvancedFilter`）。资产通过 `scope: 'project' | 'all'` 声明所属范围：`project` 只出现在「本项目」，`all` 两个范围都显示。该分区没有标签行与「新建」按钮。
- 受控/非受控：`section`、`tag`、`scope` 不传时组件内部维护；传入后通过 `onSectionChange`、`onTagChange`、`onScopeChange` 回写。搜索词由组件内部维护，通过 `onFilterChange({ section, tag, query, scope, kind })` 通知宿主（`tag` 为空字符串表示全部）。
- `onSelect({ asset, index })`：点击卡片时触发，`index` 为当前清单内 1 起算的序号；传入 `value` 与 `insertIndex` 可显示选中态与序号角标。
- `onSelectionChange(asset | null)`：选中变化时回调；点击卡片返回资产，切换分区 / 项目范围 / 类型 / 标签后组件会**清空选择**并返回 `null`（确认栏随之隐藏）。宿主用自己的状态保存选中时，应监听该回调同步清空。
- `onConfirm(asset)` 与 `confirmText`：传入 `onConfirm` 后，只要 `value` 命中某个资产，弹窗底部出现右对齐的确认按钮（左侧显示「已选择：名称」）。支持 Promise，处理中按钮显示「确认中…」并禁用；失败保留弹窗并在上方显示错误，成功后组件自动调用 `onOpenChange(false)` 关闭弹窗。
- `onFavoriteChange`、`onRename`、`onDelete`：不传则不显示对应入口。`onRename` 支持 Promise，失败时保留输入并提示；删除前会 `window.confirm` 二次确认。
- 「新建」按钮：传入 `upload` 适配器时，点击「新建」直接打开系统文件选择器，挑选的文件走与拖放完全相同的校验、进度与失败处理；未传 `upload` 只传 `onCreate` 时，点击触发 `onCreate({ section, tag, query })`，由宿主打开自己的创建流程。上传成功后由宿主在适配器返回的 `AssetItem` 基础上把结果并入 `assets`（Playground 演示即如此）。
- `upload(assetUploadContext)`：宿主上传适配器，参数为 `{ file, section, signal, onProgress }`。组件对每个文件单独校验（`accept`、`maxFileSize`），失败互不影响；进度完全来自 `onProgress`，组件不伪造。支持拖入整个面板。`maxConcurrentUploads` 默认为 3。适配器应返回 `AssetItem`，并把结果合并进 `assets`。
- 分页：默认每页 24（`pageSize`，最小 4），滚动接近底部自动加载；本地剩余条目按页展开，传入 `hasMore` + 异步 `onLoadMore({ section, tag, query, signal })` 可接远程分页。宿主应遵守 `signal`、按 id 去重追加，并在末页把 `hasMore` 设为 `false`。
- `getDownloadUrl(asset)`：可选，返回临时下载地址；右键菜单「下载」在资产没有 `url` 时依赖它。
- `loading` 显示加载态；`emptyText` 可按分区覆盖空态文案；`disabled` 只读；`title` 修改侧栏标题无障碍名称；`className` 透传，样式变量为 `--darl-background/surface/text/muted/border/primary/danger`，可覆盖为任意主题。

Playground：`/#asset-library`，页面加载即打开弹窗（可通过「打开资产库」再次唤起），包含真实拖放上传、失败模拟、分页、收藏/重命名/删除与右键菜单的本地交互演示（文件不会发送到服务器）。
