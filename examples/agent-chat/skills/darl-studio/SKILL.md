---
name: darl-studio
description: 通过本入剧出网站现有 Tools，分类查询和修改项目、剧本、资产、镜头（分镜记录）、视频片段、提示词，操作媒体任务、工作区文件和 Skills；按“大纲→剧本→资产→分镜表→视频制作”创作工作流程衔接各站内创作 Skill。
---

# 本入剧出网站 Tools

从当轮工具目录确认名称与参数。以下为当前内置 Tools 的调用说明；同能力工具名称变化时使用当轮定义。网站操作直接调用相应 Tool。

## 网站创作工作流程

剧本类项目按固定流程推进：**小说/原文 → 改编大纲 → 影视剧本 → 美术资产提取 → 分镜表 → 视频制作**。每个阶段由站内已安装的创作 Skill 决定“写什么、怎么写”，由本 Skill 的 Tools 把内容写入网站；进入某阶段时先加载对应创作 Skill，再按本 Skill 操作数据。

| 阶段 | 站内创作 Skill | 主要读写数据 |
| --- | --- | --- |
| 1. 小说/原文 → 改编大纲 | `short-drama-outline`（AI 短剧改编大纲） | `projects.outline`（含 `adaptation` 改编幅度、`props` 关键叙事道具）、`projects.requirements` |
| 2. 大纲 → 影视剧本 | `short-drama-screenplay`（AI 短剧影视剧本） | `episodes.script` 与 `episodes.scenes[].content`（见“剧本与场次写入”） |
| 3. 大纲+剧本 → 美术资产 | `short-drama-asset-extraction`（AI 短剧影视资产提取） | `assets`：角色、场景、道具的 description、appearance、costume、prompt 与 `variants` |
| 4. 分镜表 | 按剧本与现有创作要求设计镜头 | `shots`：景别、运镜、切镜、画面、对白、音效和时长 |
| 5. 视频制作 | `video-prompt-writer`（通用视频提示词编写） | 参考已确认分镜整理 `clips.prompt`、`clips.duration`、`assetIds`、`references`，按需生成片段图片与视频 |

流程约束：

- **上游确认后进下一阶段**：改编骨架与分集梗概经用户确认后才写剧本；已确认的大纲和剧本共同作为资产提取依据；资产就绪后编写分镜表，再根据已确认的分镜在“视频制作”页编写片段视频描述。
- **阶段产物落库才算完成**：每阶段用编辑工具把正文写入对应资源，只在聊天输出不算写入；保存后按 ID 回读核对再报告完成。
- **创作与操作分工**：站内创作 Skill 决定各阶段正文写法；本 Skill 只负责把内容完整写入网站并维持字段分工（见下文各章节）。
- 视频转绘项目（`creationMode=video-redraw`）不走此流程，按“视频转绘”章节和 `video-redraw` Skill 操作。

## 创作数据

读取使用 `builtin_read_studio`，创建、修改、删除使用 `builtin_edit_studio`。

| 分类 | resource | 内容 |
| --- | --- | --- |
| 项目与大纲 | `projects` | 项目信息、`sourceScript`（用户提交的原始素材，不是剧集正文）、`requirements`、`outline` |
| 剧本与场次 | `episodes` | 剧集、`script`、嵌套 `scenes` |
| 美术资产 | `assets` | 角色、场景、道具、`variants`、单项资产 `prompt` |
| 镜头（分镜） | `shots` | 景别、运镜、切镜方式、画面、对白、音效、时长、镜头分镜图、`clipId` |
| 视频片段 | `clips` | 视频描述 `prompt`、独立时长 `duration`、资产和参考、片段图片及视频历史 |
| 成片 | `films` | 成片记录 |
| 操作记录 | `history` | 项目操作记录 |
| 素材库 | `library`、`folders` | 素材和目录 |
| 音频与音色 | `audio`、`voices` | 音频和音色记录 |
| 创作提示词设置 | `prompts` | 各创作环节的全站规则 |
| 视觉风格 | `styles` | 只读风格目录 |

剧本项目的 `projects.adaptation` 保存改编幅度（`忠实` / `抽核` / `借壳`）；项目 `outline` 另外包含 `props:[{id,name,purpose,involvement}]`，只记录确实影响剧情的关键叙事道具。

视频制作以视频片段为单位。每段的镜头顺序、初始站位、动作、运镜、切镜、对白、音效和时间安排统一写在页面可见的 `clips.prompt`（视频描述）中。

- `clips.prompt` 是视频生成的内容依据；`clips.duration` 是独立维护的计划秒数，必须大于 0，单条片段最多 15 秒。生成请求按模型支持的时长向上取整；不改写片段和来源镜头凑整秒，超过上限先缩短或拆分。
- `clips.assetIds`、描述中的 `<资产名称>` / `<资产名称|形态名称>` 与 `clips.references` 决定参考素材。音色来自片段关联角色、描述中引用的角色和显式音色引用，`disabledVoiceIds` 保存取消勾选项；不从历史 shot 对白补入角色音色。
- 分镜表按剧集与场次展示和编辑 `shots`。可通过查询和编辑工具读取、创建、排序或修改镜头。`clips.shotIds`、`blocking`、`sourceSignature` 保留已有数据；镜头不会自动推导或覆盖片段时长、描述、图片或音色。
- 片段图片分为分镜图 `image/imageHistory`、故事板 `storyboardImage/storyboardHistory`、站位图 `blockingImage/blockingHistory`。转绘图片统一依据当前视频描述生成，旧 `storyboardPrompt`、隐藏站位文本不覆盖它；原图和各自历史继续保留。视频的“分镜图”方式使用片段当前分镜图，“参考生成”方式使用页面所选的参考素材。
- 转绘镜头的来源时间和原片证据用于追溯；保留原片依据及已有目标分镜。

视频转绘项目与剧本项目共用这些资源。资产属于项目并跨集共用；分析新集前读取已有资产，优先引用真实 ID，不覆盖已有资产设定。`projects.creationMode` 为 `script`（默认）或 `video-redraw`。`targetRegion`（`japan` / `western`）、`targetLanguage`（`ja` / `en`）属于视频转绘项目，原片优先保存在 `episodes.sourceVideo`，旧项目的第一集兼容读取 `projects.sourceVideo`；剧本项目查询不返回这些字段，也不接受写入，不得据此推断改编地区或语言。转绘项目才使用默认 `japan / ja`，或显式选择 `western / en`。`sourceVideo` 保存原视频 `fileId/url/name`、真实 `duration/width/height/fps/hasAudio`、`segments`（每项 `id/start/end/frames`）；每帧是 `fileId/time/url`。先上传 MP4，再保存对应剧集引用，用转绘工具取得真实元数据，不能编造时长或抽帧结果。

`assets.source` 与 `shots.source` 保存原片 `fileId/start/end/frames`，可含原始 `name/description/dialogue/notes/confirmed`；镜头的 `source.segmentId` 指向原片候选镜头 ID，业务镜头 ID 按项目隔离，不与 segment ID 混用。目标设定继续使用现有资产与镜头字段。`shots.assetIds` 为本镜人物、场景、道具的稳定关联。原片与目标版本分别保留；资产必须有原片依据。完整字段和嵌套类型仍以 describe 为准。

`source.evidence` 可保存补充取证文件：每项包含 `fileId`、`url`、`round`、`kind`（`single`、`crop`、`grid4`、`clip`）、原片 `start/end` 和 `label`。图片使用已保存的 JPEG，视频使用已保存的 MP4；区间与该来源镜头相交。拼图和片段不能填成单一时刻的 `frames`。更新来源时保留已有证据，使用实际文件和时间，当前字段以 describe 为准。

### 查询

调用 `builtin_read_studio`，先用 `describe=true` 获取该资源的字段、类型、必填项、默认值和嵌套结构，再按需要查询：

```json
{"resource":"assets","describe":true}
```

```json
{"resource":"assets","projectId":"PROJECT_ID","fields":["name","type","prompt"],"limit":100}
```

| 参数 | 用法 |
| --- | --- |
| `projectId`、`episodeId`、`sceneId` | 按项目、剧集、场次筛选 |
| `ids` | 按记录 ID 数组读取 |
| `fields` | 选择 describe 中存在的字段 |
| `limit`、`cursor` | 每页 1–500 条，使用结果的 `nextCursor` 读取下一页 |

查询 `clips` 未指定 `fields` 时默认不返回 `description`；页面视频描述与视频生成使用 `prompt`。仅需读取 `description` 时使用同一工具显式传入 `fields: ["description"]`；可按需求同时选择其他字段。

结果含真实 `id`、`_version`、`total`、`nextCursor`。全站资源不附带项目/剧集筛选。`prompts` 用 `name` 定位，`mode=default` 取 `defaultText`，`mode=replace` 取 `text`。

### 剧本与场次写入

剧本页显示 `episodes.scenes[].content`，不是直接显示整集 `script`。每场为 `{id,location,setting,time,suggestedDuration?,content}`；`content` 必须保留按剧情顺序交错的动作、人物名（表演提示）和完整台词，可保存 Markdown 段落与加粗。不要把台词从正文抽到 `scenes[].dialogue`：该字段不受支持，结构化 `dialogue` 属于镜头 `shots`。

修改文学剧本时同步保存整集 `script` 与对应场次 `content`，保留已有场次 ID、动作对白顺序和用户未要求改动的内容。只更新 `script`、只导出文件或只在聊天输出不算写入页面。保存后回读目标场次 `content`，核对人物台词与关键动作确实存在，再报告完成。

日常创作和修订通过业务工具完成，不需要读取网站源码、猜测源码路径或直接修改数据库。Skill 格式要求与站内字段分工不同：创作 Skill 决定正文写法，本 Skill 负责将正文完整写入网站。

### 创建、修改、删除与排序

调用 `builtin_edit_studio`：

```json
{
  "requestId":"unique-request-id",
  "changes":[{
    "resource":"assets",
    "op":"update",
    "id":"RECORD_ID",
    "version":1,
    "values":{"description":"修改后的描述"}
  }]
}
```

| 字段 | 用法 |
| --- | --- |
| `requestId` | 本次唯一请求标识；原样重试沿用，修改内容后换新标识 |
| `changes` | 每批 1–500 项，关联记录可同批创建，失败整批回滚 |
| `resource`、`id` | 资源及目标记录；新建记录使用新标识 |
| `op` | `create`、`update`、`delete` |
| `version` | 更新、删除填查询返回的 `_version`；示例的 `1` 换成实际值 |
| `values` | 创建所需字段或本次要修改的字段；删除省略；结构从 describe 获取 |
| `position` | 可选，调整记录排序 |

项目创建后返回实际编号，后续查询和编辑使用返回值。角色对白的 `assetId` 引用角色资产；镜头与片段引用真实剧集和场次。

### 分镜表与视频片段

分镜表使用 `shots`：按场次填写景别、运镜、切镜、画面、对白、音效和时长。先通过 describe 获取字段，角色对白引用真实角色资产；转绘镜头保留原片来源。编辑后回读核对。


创建 `clips` 时传真实的 `episodeId`、`sceneId`、`title`、`prompt`、`duration`，并填写所需 `assetIds` 和 `references`；`shotIds` 可省略或留空。更新仅提交改变字段并传最新版本。根据分镜整理视频描述并明确保存到片段；后续修改镜头不会自动同步视频描述。修改 `duration` 会真实保存，来源镜头改变或删除不会重算片段时长。

先编写视频描述和计划时长、准备目标资产与参考，再按需生成片段图片与视频。保存后按 ID 回读 prompt、duration、素材引用，确认没有覆盖用户最新内容；生成任务使用最新片段版本作为 studioTarget。不要把任务提交当成生成完成。

### 分镜和视频描述中的资产标签

编写或修改分镜画面 `shots.description` 与视频描述 `clips.prompt` 前，先查询当前项目的 `assets` 及其 `variants`。文字中出现的已登记角色、场景、道具，使用网站资产引用标签，而不是只写普通名称：主形象写 `<资产名称>`，具体形态写 `<资产名称|形态名称>`，名称必须与查询结果完全一致。页面会将标记显示为可识别的 @ 资产标签；不要把页面显示的 `@名称` 当成保存协议。

只引用当前项目资产表中真实存在且名称可唯一解析的资产及其真实形态，不能编造资产、形态或引用其他项目的资产。身份、形态不确定或资产尚未入表时，不要猜测标签；保留准确的普通画面描述并说明待确认或待补资产。用户要求补充资产时，先依据已有证据创建并回读，再引用。写入后回读镜头或片段，核对标签名称、形态和上下文，不得因引用而改变原片事实。


保存前逐条核对每个尖括号：直接复制查询返回的完整 `name`，不要只保留中文名、英文名或别名。例如资产名是 `Rooftop Garden 屋顶露台花园` 时，写 `<Rooftop Garden 屋顶露台花园>`，不能写 `<屋顶露台花园>`。`assetIds` 正确不能替代文字标签中的完整名称。

`builtin_edit_studio` 对新建或修改的 `shots.description`、`clips.prompt` 校验标签；无效、跨项目、形态不存在或名称有歧义时拒绝整批并返回字段和可用资产名称。重新读取资产，用实际完整名称修正后使用新的 requestId 重试；不要把失败报告为已保存。历史标签不会因无关字段更新被强制校验；需要修复历史文本时，先回读记录及其版本，确认映射后只修改目标字段。

### 美术资产与衍生形态

角色、场景、道具共用 `assets`。`description` 是身份/用途/剧情说明，不参与生图。

角色、场景、道具的主形象完整生图提示词保存在 `prompt`，各衍生形态保存在 `variants[].prompt`，切换后页面显示并编辑该形态的提示词。场景、道具生图必须填写当前形态的 prompt；留空会报错，不回退到 description、appearance、costume 或主形象 prompt。角色填写 `prompt` 后优先用于生成；未填则回退可见的 appearance 与当前服饰（主形象 costume、衍生形态 description）。角色的 description 和 voiceDescription 始终不参与生图。提示词不叠加其他形态设定，须写全材质、空间等一致性要求。

最终生图提示词由“项目全局风格 + 生图模板提示词（当前视图方案）+ 生图提示词”在生成时自动拼装，无需把风格或视图模板写进 `prompt`。修改角色默认形象时优先更新外貌与服饰字段，prompt 用于补充镜头/打光/构图等额外生图指令。


更新 variants 时保留其他形态及原有 id、image、history，仅修改目标形态所需字段；保存后按 ID 回读并核对目标形态的 prompt。主形象与衍生图仍通过各自的 image、history 和生成目标 variantId 关联。

### 融合资产与依赖图片

当资产包含另一个已定义的人物或物体（旧照片、证件、合影、肖像画、带角色图像的物品等）时，在 `assets.dependencies` 建立关联，不能只在提示词中写姓名。每项为 `{assetId, variantId?, purpose}`：同项目真实资产 ID，选用主形象时省略 variantId，特定年龄/服装等形态使用真实 variantId，purpose 必填，说明参考图在目标资产中的用途。例如旧学生证照片引用 Chloe 的 19 岁形态，并说明“仅作为照片内人物的身份参考”。

主形象和该资产所有衍生形态共用这些依赖。禁止自引用、循环、跨项目引用；被引用资产/形态删除前先解除关联。更新 dependencies 时保留未修改条目。图片不存在时可以保存关系，但不能生成；必须先生成依赖的具体形态并查询其真实 image，不能以成人主图替代缺失的年轻形态。

生成融合资产必须在媒体工具的 `options.studioTarget` 传真实目标和最新版本；后台会校验依赖、自动加入当前图片和用途说明，并检查参考数量上限。不要将资产姓名当成参考图，也不要省略 studioTarget 绕过依赖检查。批量生成仅补齐缺失图片：已有主形象或衍生形态图片保持不变；进行中的任务不重复提交。先处理缺失的依赖图片，失败则跳过后续资产。需要重做已有图片时使用单项资产生成。图片默认画幅统一为 16:9，可明确指定其他画幅。

生成结果的真实引用快照保存在主形象或衍生形态的 `imageDependencies[图片URL]`，由后台维护，不要手工改写。引用的选用图片变化后，页面提示重新生成；生成期间依赖变更时，结果保留历史但不自动替换当前图片。准备关联和生成后分别查询结果验证，提交任务不代表已出图。

## 图片与视频任务

文件服务返回的原图、视频 URL 可能是 COS 公网地址，也可能是站内 `/api/files/` 链接；保留返回的 `fileId`，不要从公网 URL 猜测文件 ID。业务字段、下载和 AI 参考素材使用原始 URL，不把 `imageMogr2` 或 `width` 缩略图地址写回原图字段。页面列表按需派生 160/320/640/1024px WebP，放大查看原图。媒体转入 COS 后，原片校验、合成和导出仍依据文件服务中的真实文件记录。

| Tool | 参数与返回 |
| --- | --- |
| `builtin_generate_media` | `modelId`、`prompt`，可选 `requestId`、`options`；返回任务 `id`、`status` |
| `builtin_get_media_task` | `taskId`；返回任务真实状态和结果 |

`modelId` 与生成参数采用当轮 Tool schema。`options` 可含 `resolution`、`aspectRatio`、`duration`、`references`。参考编辑时将指定图片放入 `references`。H3 视频另支持 `referenceVideos`（视频 URL 数组）、`referenceAudios`（音频或音色试听 URL 数组），各最多 3 个且以模型能力为准；音频须搭配图片或视频。支持站内 `/api/files/` 与公网 HTTP(S) URL；已有可访问的 HTTPS/HTTP 素材直接传引用，本地素材由文件服务提供可访问 URL，无法直接访问时才上传到模型供应商。音色引用传真实音频地址，不传音色 ID；是否保持目标声音须试听真实生成结果。

H3 视频模型支持 `minimax-h3-flash` 与 `minimax-h3-standard`；视频清晰度使用 `480P`、`768P`，Flash 另支持 `1080P`，不能继续提交旧值 `480` / `768`。本地参考素材通过新版 `/v1/h3/assets` 上传，宿主将返回的素材 ID 写入新协议，无需 Agent 手工上传或拼接上游字段。

资产提取后按 describe 分别填写 description（身份/用途）、appearance（外貌/空间/材质）、costume（主服饰）、voiceDescription（有原声依据的声音）、prompt（可执行的资产图指令）；原片证据放 source。不要把一句描述塞进所有字段，或把剧情截图换脸当成角色一致性资产。详细步骤见 video-redraw 的 references/asset-production.md。

自动关联生成结果使用 `options.studioTarget`，字段为 `resource`（`assets`、`shots` 或 `clips`）、`id`、最新 `version`、`field`，形态另传 `variantId`。图片字段为资产 `image`、镜头 `image`（单镜分镜图）或片段 `image`、`storyboardImage`、`blockingImage`；视频字段为片段 `videos`。单镜分镜图只作用于该镜头，片段分镜图不覆盖镜头图片。提交后用任务查询 Tool 获取结果。

## 视频转绘

资产 source.start/end 是可追溯的原片区间，source.fileId 必须是原视频 ID，frames[].fileId/url/time 使用实际原片帧记录。资产可同时引用本集 sourceVideo.segments 中其他时间点的真实帧；镜头的参考帧须位于该镜头区间。原片 duration 等元数据缺失时，先读取真实切镜结果并按最新版本保存；禁止猜测时间或将拼图 ID 冒充单帧。

具体创作规则按需加载 `video-redraw`；开始/继续制作读其 references/production-control.md，资产提取与生图读 references/asset-production.md；此处只说明网站操作。发现当轮转绘查询/操作能力后调用，不按名称猜测旧定义。

拉片任务返回的 `sheets[].fileId`、原片帧及资产图可用通用 `builtin_read_image` 查看：传 `fileId`，或在 `path` 传工作区路径、网站已保存的图片 URL（二选一），将真实图片传给模型，内部参考图不自动显示在聊天中。未知外部 URL 不能直接读取。`builtin_read_file` 默认读取图片也返回视觉内容，显式 `encoding=base64` 才按二进制文本分页读取。不能将 JPG 当 UTF-8 文本，不能仅凭图片 URL 声称看过画面。结合 `sheets[].frames` 的帧号、时间与行列映射分析；读取失败先处理实际错误，不因此改走旧分析流程。

| Tool | 用法 |
| --- | --- |
| `builtin_read_video_redraw` | `describe=true` 查询能力、地区与限制；否则以 `projectId` 和 `episodeId` 查询本集原片、持久化任务、草稿和错误；传 `jobId` 分页获取 prepare/breakdown 切镜或 transcribe 结果，`detail` 仅用于已有转写 |
| `builtin_edit_video_redraw` | `projectId`、`episodeId`、`action`，其他参数依操作及当前 schema；省略 episodeId 兼容第一集 |

| action | 参数与行为 |
| --- | --- |
| `prepare` | `requestId`、最新项目 `version`；检测切镜并抽帧，成功后保存原片真实元数据和 `segments` |
| `breakdown` | `requestId`、`version`；检测切镜，保存每镜中间帧及拼图，缺少原片元数据或来源镜头时自动保存；查询任务分页取得真实帧、时间和拼图映射 |
| `transcribe` | `requestId`、`version`，可选 `sourceLanguage`；只转写原声，结果通过任务查询读取 |
| `apply` | `jobId`，可选 `shotIds` 为历史草稿的 segment ID，留空应用全部；应用历史分析草稿，同批写入镜头、关联资产和场次，镜头再按需加入片段。新资产写入草稿 targetAppearance/targetCostume/targetVoiceDescription/targetPrompt 对应的现有字段；已有资产跳过保护，不自动补字段，可用编辑工具按最新版本补齐。保护人工修改，项目设置或版本冲突时重新读取 |
| `cancel` | `jobId`；取消本项目运行中的转绘任务 |
| `frame` | `start/end`；返回中间真实帧及 `source`，供手工补资产或镜头；返回截图本身不创建业务记录 |
| `edit-shot` | `shotId`、`shotVersion`、`start/end`；更新原片切点与参考帧。另传 `split` 在指定原片时间拆分，已有片段引用时先调整关联 |
| `merge-shots` | `fromId/toId/fromVersion/toVersion`；合并同场、原片时间相邻的两个镜头，保留 fromId，迁移内容。已有片段引用时阻止操作 |
| `merge-assets` | `fromId/toId/fromVersion/toVersion`；确认是同一主体后合并同项目同类型资产，迁移镜头/片段引用，保留来源证据及目标图片历史；先处理源资产的衍生形态 |
| `export` | `requestId`、`version`、`selections:[{clipId,start?,end?}]`；按数组顺序合成已选用的真实视频，裁剪点基于实际媒体时长。保留生成音轨，不加入原片声音；成功后写入 `films` |

提交后读取任务真实状态：`queued/running/completed/failed/cancelled/interrupted`；提交返回任务不代表完成。原样重试沿用 requestId；继续失败/取消/中断的切镜或转写任务用新 requestId 和 `resumeJobId`，并复用已有结果。历史分析草稿仍可查询和应用。项目内同时一个转绘任务，全站同时两个。

视频转绘创建页选择地区/语言后直接启动拉片与对白整理，并进入对白对照页；先查询当前任务和 segments 复用已有结果，失败在对白页重试。首版原片仅 MP4、300 MB、300 秒、自动检测最多160镜头。无声视频跳过转写；有声视频默认用现有 Fish 配置获取真实时间戳，缺配置/调用失败如实报告。仅画面分析不会推断对白。H3视频生成已接入图片、视频和音频参考；原片片段只有实际放入 referenceVideos 才参与生成，音色试听使用 referenceAudios。输入支持不等于连续动作逐帧还原或精确口型，需检查实际结果。

助手直接用 `builtin_read_image` 读取切镜结果中的拼图或来源帧，结合真实转写分析，再用工作台工具按授权保存。复用已有切镜及转写，使用资源 describe 核对字段；不单独提交视觉分析任务。

## 工作区文件与命令

| Tool | 参数 |
| --- | --- |
| `builtin_list_files` | 可选 `path`，列出工作区目录 |
| `builtin_read_file` | `path`，可选 `offset`、`limit`、`encoding` |
| `builtin_write_file` | `path`、`content`，可选 `encoding` |
| `builtin_import_file` | `fileId`、`path`，把聊天附件复制进工作区 |
| `builtin_publish_file` | `path`，返回实际下载链接 |
| `builtin_run_command` | `command`，可选 `cwd`、`timeoutMs`、`waitMs`；用于工作区文件处理或 Skill 配套命令 |
| `builtin_process_status` | `processId`，可选 `offset`、`waitMs`；读取命令输出和退出状态 |
| `builtin_stop_process` | `processId` |

## Skills

| Tool | 参数与返回 |
| --- | --- |
| `builtin_list_skills` | 无参数；返回技能名称、描述、ID、版本 |
| `builtin_load_skill` | `skillId`；返回完整指令、目录及文件清单 |
| `builtin_create_skill` | `path`；更新已有技能另传 `skillId`、`expectedVersion`；返回保存的 Skill ID 和版本 |

## 其他网站设置

Agent 配置、模型供应商、审批模式等按当轮工具目录中的对应能力调用。当前内置 Tools 未提供这些设置的专用读写入口；上述 `prompts` 资源对应创作流程提示词。

## 交互提问

当需要用户选择方案或补充偏好时，使用目录中支持交互提问的工具。当前内置名称为 `builtin_request_user_input`。

- 输入 `title`、可选 `description` 和 1–8 个 `questions`。
- 每题提供唯一的 `id`、`label` 与 `type`：`single` 为互斥单选，`multiple` 为可同时选择多项，`text`/`textarea` 为自由输入。
- 选择题提供 `options: [{ value, label, description?, disabled? }]`；值必须唯一且至少一项可选。`required` 控制必填，`defaultValue` 仅提供初始选择，`placeholder` 用于输入提示。
- 等待工具返回后再继续。`status: answered` 的 `answers` 按问题 ID 返回选项 value 或文字，多选为字符串数组；结合题目标签理解结果。
- `status: cancelled` 表示用户取消，不代替用户选择，不自动重复提问。提问不代表执行审批，也不能替代有费用或风险操作的授权。
- 完全访问模式同样等待用户提交。提交失败允许保留选择重试；停止或断连后旧提问失效。
