---
name: darl-studio
description: 通过本入剧出网站现有 Tools，分类查询和修改项目、剧本、资产、视频片段、提示词，操作媒体任务、工作区文件和 Skills；按“大纲→剧本→资产→分镜→短片”创作工作流程衔接各站内创作 Skill。
---

# 本入剧出网站 Tools

从当轮工具目录确认名称与参数。以下为当前内置 Tools 的调用说明；同能力工具名称变化时使用当轮定义。网站操作直接调用相应 Tool。

## 网站创作工作流程

剧本类项目按固定流程推进：**小说/原文 → 改编大纲 → 影视剧本 → 美术资产提取 → 分镜 → 短片**。每个阶段由站内已安装的创作 Skill 决定“写什么、怎么写”，由本 Skill 的 Tools 把内容写入网站；进入某阶段时先加载对应创作 Skill，再按本 Skill 操作数据。

| 阶段 | 站内创作 Skill | 主要读写数据 |
| --- | --- | --- |
| 1. 小说/原文 → 改编大纲 | `short-drama-outline`（AI 短剧改编大纲） | `projects.outline`（含 `adaptation` 改编幅度、`props` 关键叙事道具）、`projects.requirements` |
| 2. 大纲 → 影视剧本 | `short-drama-screenplay`（AI 短剧影视剧本） | `episodes.script` 与 `episodes.scenes[].content`（见“剧本与场次写入”） |
| 3. 大纲+剧本 → 美术资产 | `short-drama-asset-extraction`（AI 短剧影视资产提取） | `assets`：角色、场景、道具的 description、appearance、costume、prompt 与 `variants` |

| 4. 分镜与视频制作 | 按剧本编写视频描述 | `clips.prompt`、`clips.duration`、`assetIds`、`references`，按需生成片段图片与视频 |

流程约束：

- **上游确认后进下一阶段**：改编骨架与分集梗概经用户确认后才写剧本；已确认的大纲和剧本共同作为资产提取依据；资产就绪后在分镜页编写片段视频描述。
- **阶段产物落库才算完成**：每阶段用编辑工具把正文写入对应资源，只在聊天输出不算写入；保存后按 ID 回读核对再报告完成。
- **创作与操作分工**：站内创作 Skill 决定各阶段正文写法；本 Skill 只负责把内容完整写入网站并维持字段分工（见下文各章节）。
- 视频转绘项目（`creationMode=video-redraw`）不走此流程，按“视频转绘”章节操作。

## 创作数据

读取使用 `builtin_read_studio`，创建、修改、删除使用 `builtin_edit_studio`；查询和还原修改记录使用 `builtin_read_studio_changes`、`builtin_restore_studio_changes`（见“变更日志与还原”）。

角色资产 `visualMode` 默认 `visual`；仅当有明确依据表明角色只需声音时设置为 `voice-only`，该角色无需图片及生图提示词。已有视觉形象的角色不要仅因某一片段是画外音而改为 `voice-only`。片段 `excludedAssetImageIds` 列出本片段不引用图片的角色 ID，不影响关联角色或音色；默认引用现有角色图。设置画外音时仍应在片段描述中写明说话人与不入画。

| 分类 | resource | 内容 |
| --- | --- | --- |
| 项目与大纲 | `projects` | 项目信息、`sourceScript`（用户提交的原始素材，不是剧集正文）、`requirements`、`outline` |
| 剧本与场次 | `episodes` | 剧集、`script`、嵌套 `scenes` |
| 美术资产 | `assets` | 角色、场景、道具、`variants`、单项资产 `prompt` |
| 镜头 | `shots` | 原片来源区间、独立目标时长、景别、运镜、画面、对白、音效与资产关联 |
| 视频片段 | `clips` | 视频提示词 `prompt`、分镜提示词 `storyboardPrompt`、独立时长 `duration`、资产和参考、片段图片及视频历史 |
| 成片 | `films` | 成片记录 |
| 操作记录 | `history` | 项目操作记录 |
| 素材库 | `library`、`folders` | 素材和目录 |
| 音频与音色 | `audio`、`voices` | 音频和音色记录 |
| 创作提示词设置 | `prompts` | 各创作环节的全站规则 |
| 视觉风格 | `styles` | 只读风格目录 |

项目 `style_catalog_id` 可省略或设为 null，表示“不指定”。剧本项目的 `script-assets` 工作流会根据大纲、全部剧本和创作要求，从真实风格目录选择统一风格，与资产同批保存；已有风格保持不变。执行报告给出所选风格与理由，完成后回读项目 `style_catalog_id` 和资产确认结果。生图仍由项目风格统一注入，不把画风写入各资产提示词。首页不选择生成模式，改编幅度仍保留忠实、抽核、借壳。

剧本项目的 `projects.adaptation` 保存改编幅度（`忠实` / `抽核` / `借壳`）；项目 `outline` 另外包含 `props:[{id,name,purpose,involvement}]`，只记录确实影响剧情的关键叙事道具。

视频制作以视频片段为单位。每段的镜头顺序、初始站位、动作、对白、音效和时间安排统一写在页面可见的 `clips.prompt`（视频提示词）中；片段分镜生图提示词独立写入 `clips.storyboardPrompt`，不写入 `clips.prompt`。

- 分镜图模式使用两阶段流程：先为每个视频片段写入一条 `clips.storyboardPrompt`，默认一张 2×2 四宫格；用户确认分镜风格后再生成 `clips.prompt`。参考生成模式跳过分镜提示词，直接生成 `clips.prompt`。

- `clips.prompt` 是视频生成的内容依据；`clips.duration` 是独立维护的计划秒数，必须大于 0，单条片段最多 15 秒。生成请求按模型支持的时长向上取整；不改写片段和来源镜头凑整秒，超过上限先缩短或拆分。
- `clips.assetIds`、描述中的 `<资产名称>` / `<资产名称|形态名称>` 与 `clips.references` 决定参考素材。音色来自片段关联角色、描述中引用的角色和显式音色引用，`disabledVoiceIds` 保存取消勾选项；不从历史 shot 对白补入角色音色。
- `clips.storyboardPrompt` 可引用 `clips.references` 中的图片：使用 `<参考图|文件身份>`，文件身份取参考项 `fileId`，没有时取原图 URL（去除查询参数），并进行 URL 编码。只引用真实已关联图片；显示名称可重命名，标记不变。生成时按实际附件顺序转换为图片编号；删除被引用图片后须先修正提示词。
- 片段图片分为分镜图 `image/imageHistory`、故事板 `storyboardImage/storyboardHistory`、站位图 `blockingImage/blockingHistory`。分镜图模式的片段分镜图使用 `clips.storyboardPrompt` 生成；其他片段图片依据当前视频描述生成；原图和各自历史继续保留。视频的“分镜图”方式使用片段当前分镜图，“参考生成”方式使用页面所选的参考素材。`excludedFrameUrls` 保存被“移除引用”的片段图片 URL：这些图片仍保留在片段图片区，但不再作为“参考生成”的参考素材；把某张图片重新设为当前图或删除该图片时会同步清除对应 URL。
- 保留原片依据和已有用户内容。

视频转绘项目与剧本项目共用这些资源。资产属于项目并跨集共用；分析新集前读取已有资产，优先引用真实 ID，不覆盖已有资产设定。`projects.creationMode` 为 `script`（默认）或 `video-redraw`。`targetRegion`（`japan` / `western`）、`targetLanguage`（`ja` / `en`）属于视频转绘项目，原片优先保存在 `episodes.sourceVideo`，旧项目的第一集兼容读取 `projects.sourceVideo`；剧本项目查询不返回这些字段，也不接受写入，不得据此推断改编地区或语言。转绘项目才使用默认 `japan / ja`，或显式选择 `western / en`。`sourceVideo` 保存原视频 `fileId/url/name`、真实 `duration/width/height/fps/hasAudio`、`segments`（每项 `id/start/end/frames`）；每帧是 `fileId/time/url`。先上传 MP4，再保存对应剧集引用，用转绘工具取得真实元数据，不能编造时长或抽帧结果。


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

剧本项目可用 `builtin_edit_video_redraw` 的 `script-assets` 提交资产提取：传 `projectId`、第一集 `episodeId`、最新项目 `version` 和唯一 `requestId`，可选 `requirements`；通过 `builtin_wait_video_redraw` 等待或 `builtin_read_video_redraw` 查询。该独立工作流读取全项目大纲、剧本和当前资产，提取角色、场景和关键道具与生图提示词；不需要视频或镜头，不自动生成图片。重新提取可通过 requirements 提交修改要求，更新已有资产文字和提示词，保留继续使用的资产图片及关联，按用户明确要求移除资产并清除镜头和片段的资产关联；对白、场次或其他资产仍引用时须先解除关联；未提及的资产保留，移除可在变更日志还原；提取期间项目、剧集或资产变化时不会写入；失败可查看任务详情、重试整理或重新提取。

剧本项目使用 `builtin_edit_video_redraw` 的 `script-storyboard`，传 `projectId`、`episodeId`、最新项目 `version`、唯一 `requestId`，可选 `requirements` 和 `mode`（参考生成或分镜图）；再通过 `builtin_wait_video_redraw` 等待或查询状态。该独立阶段读取大纲、本集剧本和美术资产，按剧情顺序创建本集视频片段及视频提示词，允许回到已有场次；仅分镜图模式生成分镜图提示词，参考生成模式不生成；不读取转绘原片，已有片段不会覆盖。支持任务详情、取消及失败后重试。

剧本项目可使用工作流工具 `builtin_edit_video_redraw` 的 `novel-script` 操作：传 `projectId`、`episodeId`、最新项目 `version`、唯一 `requestId` 和可选 `requirements`；再使用 `builtin_wait_video_redraw` 等待，或用 `builtin_read_video_redraw` 查询任务。该阶段使用独立的小说转剧本执行模型、整理模型、提示词和 Skills，读取小说原文、大纲、时长区间和分集，不依赖原视频或转绘分析；已有正文不会覆盖。任务失败可使用 `retry-format` 或 `retry-save`，具体状态和错误以任务返回为准。

剧本项目的 `projects.durationMin` 和 `durationMax` 是单集时长区间（分钟），`projects.duration` 是可留空的项目级精确时长（秒），`episodes.duration` 是可留空的本集目标时长（秒）。新项目和新剧集的精确时长默认 null；null 表示未设置，不是 0，也不能把区间下限当作确定的目标秒数。用户或 Agent 可明确填写或清空目标；按项目区间创作，不推定固定时长。已有数据不自动改写。视频转绘目标时长与原片时长分开。

视频转绘的 `episodes.duration` 为用户设置的目标秒数，未设置时为 `null`，不得推断为 120 秒或原片时长；原片真实时长在 `sourceVideo.duration`。

剧本页显示 `episodes.scenes[].content`，不是直接显示整集 `script`。每场为 `{id,location,setting,time,suggestedDuration?,content}`；`content` 必须保留按剧情顺序交错的动作、人物名（表演提示）和完整台词，可保存 Markdown 段落与加粗。不要把台词从正文抽到 `scenes[].dialogue`：该字段不受支持，正文直接保留对白。

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

项目创建后返回实际编号，后续查询和编辑使用返回值。片段引用真实剧集和场次。成功写入的批次自动记入全局变更日志，不需要为批量修改另做备份。

### 变更日志与还原

页面编辑、对话 Agent、工作流节点和媒体结果写回的每次写入都按批次记入全局变更日志，保存逐条记录和逐字段的修改前后值；动态消息 `history` 不记录。

- 列表：`builtin_read_studio_changes` 传 `projectId` 按时间倒序读取该项目的批次；省略 `projectId` 读取提示词、素材库、音色等全局资源。`sources` 按来源筛选：`agent` 对话 Agent、`workflow` 工作流节点、`page` 页面编辑、`media` 媒体写回、`restore` 还原、`system` 系统。`limit` 最多 100，用返回的 `nextCursor` 翻页。列表项含 `id`、`source`、`kind`（工作流节点或操作类型）、`jobId`、`agentName`、`count`、`resources`、`labels`、`restoredCount`。
- 详情：传同一 `projectId` 和批次 `id`。`entries` 每项含 `index`、`resource`、记录 `id`、`op`、`label`、`before`、`after` 和当前 `status`：`restorable` 可还原，`partial` 部分字段之后又被修改，`conflict` 之后又被修改，`unchanged` 已是修改前内容，`restored` 已还原，`unsupported` 不支持（项目的新建和删除）；`fields` 给出逐字段状态。
- 还原：`builtin_restore_studio_changes` 传唯一 `requestId`、`projectId` 和批次 `id`；可选 `entries`（条目 `index` 数组）只还原部分条目，省略则整批还原。只恢复仍保持该批修改结果的字段，之后又被修改的内容跳过；本批新建的资产或剧集仍被其他内容引用时不删除。返回 `restored` 数量和 `skipped`（`index`、`reason`、`fields`），`reason` 为 `already-restored`、`changed-later`、`partial`、`missing`、`exists`、`in-use` 或 `project-lifecycle`。还原本身记为 `source=restore` 的新批次（`restoreOf` 为被还原批次的 `id`）；还原这条 restore 批次即撤销那次还原，原批次中对应条目恢复为未还原，之后仍可再从原批次还原。
- 用户要求撤销 Agent 或工作流的修改时，先读取日志定位批次，向用户说明将还原的内容；还原后按返回的 `skipped` 如实报告未还原的部分。

### 视频片段

根据已确认剧本创建 `clips`，填写真实 `episodeId`、`sceneId`、`title`、`prompt`、`duration` 和所需资产引用。片段最长 15 秒；画面、动作与对白写入 `prompt`。保存后回读，再使用最新版本生成图片或视频。短片页用于剪辑成片。


- 视频转绘进入视频制作时，先让用户在页面选择生成方式并填写可选要求，再使用 `builtin_edit_video_redraw` 的 `video-prompts` 提交文本模型任务（mode 为“参考生成”或“分镜图”，requirements 为补充要求）；用 `builtin_wait_video_redraw` 等待并读取真实结果。校对后的镜头是制作依据，优先保留已确认的镜头画面、景别、运镜、目标时长和对白；视频模型时长档位不匹配时可安排自然停顿，无法协调时明确报告冲突。结果 `plan` 保存每个片段的原视频来源时间、独立的目标内容时长、片段 ID 和镜头 ID；目标内容时长与生成时长一致，须选用任务提交时默认视频模型支持的整数秒（不超过 15 秒，优先 10–15 秒），可与来源时间差不同；应按目标语言对白的自然语速及停顿安排节奏，每个片段可包含多个镜头。切换视频模型后须核对新模型支持该时长。文本模型基于分镜和资产文字写提示词，不能声称看过图片。已有视频片段时保留用户内容，通过 `builtin_edit_studio` 按用户要求调整，不重复创建。

### 分镜和视频描述中的资产标签

编写或修改视频描述 `clips.prompt` 前，先查询当前项目的 `assets` 及其 `variants`。文字中出现的已登记角色、场景、道具，使用网站资产引用标签，而不是只写普通名称：主形象写 `<资产名称>`，具体形态写 `<资产名称|形态名称>`，名称必须与查询结果完全一致。页面会将标记显示为可识别的 @ 资产标签；不要把页面显示的 `@名称` 当成保存协议。

只引用当前项目资产表中真实存在且名称可唯一解析的资产及其真实形态，不能编造资产、形态或引用其他项目的资产。身份、形态不确定或资产尚未入表时，不要猜测标签；保留准确的普通画面描述并说明待确认或待补资产。用户要求补充资产时，先依据已有证据创建并回读，再引用。写入后回读片段，核对标签名称、形态和上下文，不得因引用而改变原片事实。


保存前逐条核对每个尖括号：直接复制查询返回的完整 `name`，不要只保留中文名、英文名或别名。例如资产名是 `Rooftop Garden 屋顶露台花园` 时，写 `<Rooftop Garden 屋顶露台花园>`，不能写 `<屋顶露台花园>`。`assetIds` 正确不能替代文字标签中的完整名称。

`builtin_edit_studio` 对新建或修改的 `clips.prompt` 校验标签；无效、跨项目、形态不存在或名称有歧义时拒绝整批并返回字段和可用资产名称。重新读取资产，用实际完整名称修正后使用新的 requestId 重试；不要把失败报告为已保存。历史标签不会因无关字段更新被强制校验；需要修复历史文本时，先回读记录及其版本，确认映射后只修改目标字段。

### 美术资产与衍生形态

角色、场景、道具共用 `assets`。`description` 是身份/用途/剧情说明，不参与生图。

角色、场景、道具的主形象完整生图提示词保存在 `prompt`，各衍生形态保存在 `variants[].prompt`，切换后页面显示并编辑该形态的提示词。场景、道具生图必须填写当前形态的 prompt；留空会报错，不回退到 description、appearance、costume 或主形象 prompt。角色填写 `prompt` 后优先用于生成；未填则回退可见的 appearance 与当前服饰（主形象 costume、衍生形态 description）。角色的 description 和 voiceDescription 始终不参与生图。提示词不叠加其他形态设定，须写全材质、空间等一致性要求。

最终生图提示词由“项目全局风格 + 生图模板提示词（当前视图方案）+ 生图提示词”在生成时自动拼装，无需把风格或视图模板写进 `prompt`。修改角色默认形象时优先更新外貌与服饰字段，prompt 用于补充镜头/打光/构图等额外生图指令。


更新 variants 时保留其他形态及原有 id、image、history，仅修改目标形态所需字段；保存后按 ID 回读并核对目标形态的 prompt。主形象与衍生图仍通过各自的 image、history 和生成目标 variantId 关联。

### 融合资产与依赖图片

当资产包含另一个已定义的人物或物体（旧照片、证件、合影、肖像画、带角色图像的物品等）时，在 `assets.dependencies` 建立关联，不能只在提示词中写姓名。每项为 `{assetId, variantId?, purpose?}`：同项目真实资产 ID，选用主形象时省略 variantId，特定年龄/服装等形态使用真实 variantId；purpose 可留空或省略，需要时用于说明参考图在目标资产中的用途。例如旧学生证照片引用 Chloe 的 19 岁形态，并说明“仅作为照片内人物的身份参考”。

主形象和该资产所有衍生形态共用这些依赖。禁止自引用、循环、跨项目引用；被引用资产/形态删除前先解除关联。更新 dependencies 时保留未修改条目。图片不存在时可以保存关系，但不能生成；必须先生成依赖的具体形态并查询其真实 image，不能以成人主图替代缺失的年轻形态。

生成融合资产必须在媒体工具的 `options.studioTarget` 传真实目标和最新版本；后台会校验依赖、自动加入当前图片和用途说明，并检查参考数量上限。不要将资产姓名当成参考图，也不要省略 studioTarget 绕过依赖检查。批量生成仅补齐缺失图片：已有主形象或衍生形态图片保持不变；进行中的任务不重复提交。先处理缺失的依赖图片，失败则跳过后续资产。需要重做已有图片时使用单项资产生成。图片默认画幅统一为 16:9，可明确指定其他画幅。

生成结果的真实引用快照保存在主形象或衍生形态的 `imageDependencies[图片URL]`，由后台维护，不要手工改写。引用的选用图片变化后，页面提示重新生成；生成期间依赖变更时，结果保留历史但不自动替换当前图片。准备关联和生成后分别查询结果验证，提交任务不代表已出图。

## 图片与视频任务

文件服务返回的原图、视频 URL 可能是 COS 公网地址，也可能是站内 `/api/files/` 链接；保留返回的 `fileId`，不要从公网 URL 猜测文件 ID。业务字段、下载和 AI 参考素材使用原始 URL，不把 `imageMogr2` 或 `width` 缩略图地址写回原图字段。页面列表按需派生 160/320/640/1024px WebP，放大查看原图。媒体转入 COS 后，原片校验、合成和导出仍依据文件服务中的真实文件记录。

| Tool | 参数与返回 |
| --- | --- |
| `builtin_generate_media` | 暂时禁用，不可通过 Agent 提交媒体生成任务 |
| `builtin_get_media_task` | `taskId`；返回任务真实状态和结果 |

`modelId` 与生成参数采用当轮 Tool schema。`options` 可含 `resolution`、`aspectRatio`、`duration`、`references`。参考编辑时将指定图片放入 `references`。H3 视频另支持 `referenceVideos`（视频 URL 数组）、`referenceAudios`（音频或音色试听 URL 数组），各最多 3 个且以模型能力为准；音频须搭配图片或视频。支持站内 `/api/files/` 与公网 HTTP(S) URL；已有可访问的 HTTPS/HTTP 素材直接传引用，本地素材由文件服务提供可访问 URL，无法直接访问时才上传到模型供应商。音色引用传真实音频地址，不传音色 ID；是否保持目标声音须试听真实生成结果。

H3 视频模型支持 `minimax-h3-flash` 与 `minimax-h3-standard`；视频清晰度使用 `480P`、`768P`，Flash 另支持 `1080P`，不能继续提交旧值 `480` / `768`。本地参考素材通过新版 `/v1/h3/assets` 上传，宿主将返回的素材 ID 写入新协议，无需 Agent 手工上传或拼接上游字段。

资产提取后按 describe 分别填写 description（身份/用途）、appearance（外貌/空间/材质）、costume（主服饰）、voiceDescription（有原声依据的声音）、prompt（可执行的资产图指令）；原片证据放 source。不要把一句描述塞进所有字段，或把剧情截图换脸当成角色一致性资产。原片证据不足的内容标记待确认。

自动关联生成结果使用 `options.studioTarget`，字段为 `resource`（`assets` 或 `clips`）、`id`、最新 `version`、`field`，形态另传 `variantId`。图片字段为资产 `image`或片段 `image`、`storyboardImage`、`blockingImage`；视频字段为片段 `videos`。不同形态的图片任务可并行提交；每个任务按目标形态与共享输入判断是否自动选用结果，目标或依赖变化时保留结果历史。提交后用任务查询 Tool 获取结果。

## 视频转绘：原视频生成分镜

流程：原片分析 → 镜头校对 → 剧本 → 转绘资产 → 视频制作 → 短片。原片分析保存的镜头含景别 `scale` 与运镜 `camera`，先在镜头校对页核对台词、说话人和切点，再编写剧本；转绘资产页直接进入视频制作。

`analyze`、`write-script`、`extract-assets`、`plan-storyboard`、`video-prompts` 每个节点使用各自的工作流 Agent：执行 Agent 输出完整报告，独立的整理 Agent 把报告转为页面字段，系统校验后写入；整理结果校验未通过时，系统把具体错误交回整理 Agent 最多自动修正两次，错误记录在详情 `formatErrors`。页面字段只保存页面需要的内容，完整报告交给下游：`write-script`、`extract-assets`、`plan-storyboard`、`video-prompts` 的执行 Agent 会收到同集上游节点最近完成的完整报告（正式分镜须已应用），详情 `handoff` 列出收到的上游任务；报告与页面记录冲突时以页面记录为准。提交后通过 `builtin_wait_video_redraw` 等待，或用 `builtin_read_video_redraw` 传 `projectId`、`episodeId`、`jobId` 查询真实状态；任务详情的 `mode` 是运行时选择的生成方式；详情的 `outputs` 中 `output_type=raw` 是执行 Agent 的完整报告，`output_type=structured` 是整理 Agent 输出的页面字段，`steps` 是工具调用状态；失败时 `failureStage` 标明原始分析、页面字段整理或校验与保存。历史资产任务的 `formatMode=asset-tools` 表示旧版由执行 Agent 多轮提交，仅供查看。各节点写入的修改记入全局变更日志，可按批次或单条还原。失败、中断或取消的任务也可读取已保存输出；`incomplete=true` 表示原始输出被截断或中断，不能用于重新整理。若整理结果已保存但写回校验失败，可用 `builtin_edit_video_redraw` 的 `retry-save`，传原 `jobId`、新 `requestId` 和最新项目 `version`，复用整理结果重新保存，不调用模型。若需要重新整理，使用 `retry-format`；两种操作都需通过版本校验，不能覆盖用户修改。

剧本及转绘资产整理要求主体描述、外貌或结构与提示词，角色另需服饰和声音描述；无依据可如实标明待确认，已有衍生状态需有描述和提示词。转绘更新已有资产时可沿用已保存的字段。视频分析要求每镜画面描述和已列出的对白内容，剧本及片段要求各自的正文和提示词。其他字段与关联须符合对应任务校验；报告本身缺少必要内容时应查看原始报告并重新提取，不得为通过校验编造事实。校验通过立即结束整理，草稿或修改建议仍须按页面流程确认。

镜头校对和剧本页可向原阶段工作流 Agent 连续反馈：使用 `builtin_edit_video_redraw` 的 `revise-cuts` 或 `revise-script`，传本集 `projectId`、`episodeId`、最新项目 `version`、唯一 `requestId` 和必填 `requirements`；继续上一轮时传该轮已完成的 `jobId`。任务沿用原工作流 Agent 的配置和历史报告，整理、校验后直接写入；通过 `builtin_wait_video_redraw` 获取结果。写入时核对原片、项目、剧集、资产、镜头和片段版本；按时间同步片段镜头引用并保留视频，跨多个片段的新镜头及关联图片镜头的删改会被拒绝。失败时保留已有内容；可用变更日志查询并还原已应用的修改。已撤销或部分还原的反馈任务在详情中标记 `restored=true`，不能作为下一轮或下游的最新报告。

对已有原片分镜进行重新分析时，`builtin_edit_video_redraw` 使用 `revise-storyboard`，传 `projectId`、`episodeId`、最新项目 `version`、新 `requestId` 和可选 `requirements`。任务将原片、现有场次、镜头和资产交给视频分析 Agent，可用 `builtin_wait_video_redraw` 等待完成，返回可查看的原始分析和逐镜调整建议，不自动覆盖现有记录。读取结果并让用户确认后，使用 `apply-revision` 传 `projectId`、`episodeId`、`jobId` 应用；应用时核对原片和项目、场次、分镜及资产版本。支持调整画面、景别、运镜、音效、原片描述及对白；镜头拆合、时长和场次变化留在建议中供人工处理。

1. 读取项目、剧集、来源视频与已有 `shots`、`assets`。项目已选地区和语言即为有效设定：欧美未指定具体国家时采用通用语境，不为此提问。
2. 查询 `builtin_read_video_redraw`；没有可复用结果时通过 `builtin_edit_video_redraw` 提交 `analyze`，再调用 `builtin_wait_video_redraw`。服务端自动检测候选切点，直接使用文件服务中原片的 COS 地址，交模型校正并保存镜头及资产条目。已有 COS 原片不重复上传，本地原片需先配置 COS，上传并校验后保留同一 fileId；不依赖网关文件接口；失败时报告真实错误，不重复运行独立切镜或转写。
3. 回读 `shots` 和 `assets`。根据用户要求使用 `builtin_edit_studio` 调整相应镜头，保留其他镜头和用户修改；画面中的资产以 `<完整资产名称>` 或 `<完整资产名称|状态名称>` 存储，页面显示 @ 标签。 场次的 `assetId` 与可选 `variantId` 关联场景及其状态，连续的同地点同时间镜头属于同一场次；场景无法确认时保留待确认。生成视频片段时必须将所属场次的场景资产和状态带入片段引用与提示词。对白角色必须引用真实角色 ID，原片内容保存在 `source`，目标对白保存在 `dialogue`。
4. 原片来源区间保存在 `shots.source.start/end`，镜头的目标时长是独立的 `shots.duration`；修改目标时长不要改写来源区间。镜头支持 `camera` 运镜，原片分析写入画面可见的运镜，看不出时留空；时长按 0.1 秒编辑。拆分、合并时检查对白分配和已关联片段，证据不足标记待确认；不要覆盖已完成的媒体。保存后按 ID 回读。
5. 原片分析完成后可使用 `builtin_edit_video_redraw` 的 `write-script` 提交本集剧本任务，传 `projectId`、`episodeId`、最新项目 `version` 和唯一 `requestId`，可提供 `requirements`；使用 `builtin_wait_video_redraw` 等待。任务基于原始分析、当前分镜和项目目标地区及语言编写，并由独立整理模型写入已有场次及整集剧本，要求按顺序保留目标对白；`openItems` 列出待确认内容。已有正文不会被覆盖。
6. 使用 `builtin_edit_video_redraw` 的 `extract-assets` 提交资产提取，可在 `requirements` 中提供本次补充要求（最多 2000 字），再通过 `builtin_wait_video_redraw` 等待结果。资产执行 Agent 使用配置的文本模型处理分镜、场次、上游报告和已有资产，不重新调用视频理解模型，输出完整资产报告；整理 Agent 将报告转为资产字段，系统核对生图提示词与报告一致后写入。结果含实际 model 与 providerId，直接更新已有资产的非空文字设定、声音描述和生图提示词，保留已有图片；新增缺失资产、必要状态和镜头关联。已有角色的新增镜头关联须在该镜头文字中找到角色名称、别名或 ID，找不到的关联不写入，在结果 `skippedLinks` 中列出角色与镜头，其余结果照常保存；用户确认后可用 studio 工具手动关联。修改记录在全局变更日志中查看和还原。模型漏掉需要补全的状态时任务失败，报告错误并用新的 requestId 重试。原片分析阶段可先留下空提示词，由资产提取阶段补齐。用户要求调整时使用 studio 工具修改已有资产。

资产提取保存时会检查本集相关资产的主形象和衍生状态是否有生图提示词；缺少时整批不保存。先查看任务原始报告：若报告已有完整提示词，可重新整理；若报告本身遗漏，需用新的 requestId 重新提取，不能从上下文编造原文。
7. 需要时可用 `plan-storyboard`（页面不再提供入口） 传项目、剧集、版本、唯一 requestId 和可选 requirements。独立执行模型读取本集剧本、原片分析、资产文字和现有镜头，整理模型输出逐镜建议，不接收图片像素；如历史项目没有完整的分析任务记录，应明确告知仅能读取镜头中保存的原片依据；读取输出并经用户确认后用 `apply-revision` 应用。可调整画面、景别、运镜、音效与 0.1 秒目标时长，不能改写对白或原片信息；版本变化会阻止覆盖。资产图片和任务、视频模型与生成方式在进入视频制作前检查。

## 工作区文件与命令

| Tool | 参数 |
| --- | --- |
| `builtin_list_files` | 可选 `path`，列出工作区目录 |
| `builtin_read_file` | `path`，可选 `offset`、`limit`、`encoding` |
| `builtin_write_file` | `path`、`content`，可选 `encoding` |
| `builtin_import_file` | `fileId`、`path`，把聊天附件复制进工作区；MP4 视频支持到 300 MiB，普通附件不超过 50 MiB |
| `builtin_publish_file` | `path`，返回实际下载链接 |
| `builtin_run_command` | `command`，可选 `cwd`、`timeoutMs`、`waitMs`；用于工作区文件处理或 Skill 配套命令 |
| `builtin_process_status` | `processId`，可选 `offset`、`waitMs`；读取命令输出和退出状态 |
| `builtin_stop_process` | `processId` |

## Skills

| Tool | 参数与返回 |
| --- | --- |
| `builtin_list_skills` | 无参数；返回技能名称、描述、ID、版本 |
| `builtin_load_skill` | `skillId`；返回完整指令、目录及文件清单 |
| `builtin_create_skill` | `path`；安装并准备运行环境时传 `setup: true`，会检查系统命令、准备 `requirements.txt` / `pyproject.toml` / `package.json` 并运行 `--selftest`；更新已有技能另传 `skillId`、`expectedVersion`；返回保存的 Skill ID、版本和真实准备报告 |
| `builtin_prepare_skill` | `skillId`；为已安装 Skill 重试依赖准备和脚本自检，返回每项命令的真实状态、输出和退出码 |

## 其他网站设置

Agent 配置、模型供应商、审批模式等按当轮工具目录中的对应能力调用。当前内置 Tools 未提供这些设置的专用读写入口；上述 `prompts` 资源对应创作流程提示词。

## 交互提问

当需要用户选择方案或补充偏好时，使用当前宿主提供的交互提问能力。

- 输入 `title`、可选 `description` 和 1–8 个 `questions`。
- 每题提供唯一的 `id`、`label` 与 `type`：`single` 为互斥单选，`multiple` 为可同时选择多项，`text`/`textarea` 为自由输入。
- 选择题提供 `options: [{ value, label, description?, disabled? }]`；值必须唯一且至少一项可选。`required` 控制必填，`defaultValue` 仅提供初始选择，`placeholder` 用于输入提示。
- 等待工具返回后再继续。`status: answered` 的 `answers` 按问题 ID 返回选项 value 或文字，多选为字符串数组；结合题目标签理解结果。
- `status: cancelled` 表示用户取消，不代替用户选择，不自动重复提问。提问不代表执行审批，也不能替代有费用或风险操作的授权。
- 完全访问模式同样等待用户提交。提交失败允许保留选择重试；停止或断连后旧提问失效。
