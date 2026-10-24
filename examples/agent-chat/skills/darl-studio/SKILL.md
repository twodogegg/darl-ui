---
name: darl-studio
description: 通过本入剧出网站现有 Tools，分类查询和修改项目、剧本、资产、分镜、片段、提示词，操作媒体任务、工作区文件和 Skills。
---

# 本入剧出网站 Tools

从当轮工具目录确认名称与参数。以下为当前内置 Tools 的调用说明；同能力工具名称变化时使用当轮定义。网站操作直接调用相应 Tool。

## 创作数据

读取使用 `builtin_read_studio`，创建、修改、删除使用 `builtin_edit_studio`。

| 分类 | resource | 内容 |
| --- | --- | --- |
| 项目与大纲 | `projects` | 项目信息、`sourceScript`（用户提交的原始素材，不是剧集正文）、`requirements`、`outline` |
| 剧本与场次 | `episodes` | 剧集、`script`、嵌套 `scenes` |
| 美术资产 | `assets` | 角色、场景、道具、`variants`、单项资产 `prompt` |
| 分镜 | `shots` | 画面、景别、运镜、对白、时长 |
| 视频片段 | `clips` | `shotIds`、片段 `prompt`、图片与视频历史 |
| 成片 | `films` | 成片记录 |
| 操作记录 | `history` | 项目操作记录 |
| 素材库 | `library`、`folders` | 素材和目录 |
| 音频与音色 | `audio`、`voices` | 音频和音色记录 |
| 创作提示词设置 | `prompts` | 各创作环节的全站规则 |
| 视觉风格 | `styles` | 只读风格目录 |

剧本项目的 `projects.adaptation` 保存改编幅度（`忠实` / `抽核` / `借壳`）；项目 `outline` 另外包含 `props:[{id,name,purpose,involvement}]`，只记录确实影响剧情的关键叙事道具。

视频转绘项目与剧本项目共用这些资源。`projects` 增加 `creationMode`（`script` / `video-redraw`）、`targetRegion`（`japan` / `western`）、`targetLanguage`（`ja` / `en`）、`sourceVideo`。`sourceVideo` 保存原视频 `fileId/url/name`、真实 `duration/width/height/fps/hasAudio`、`segments`（每项 `id/start/end/frames`）；每帧是 `fileId/time/url`。先上传 MP4，再保存项目引用，用转绘工具取得真实元数据，不能编造时长或抽帧结果。

`assets.source` 与 `shots.source` 保存原片 `fileId/start/end/frames`，可含原始 `name/description/dialogue/notes/confirmed`；镜头的 `source.segmentId` 指向原片候选镜头 ID，业务镜头 ID 按项目隔离，不与 segment ID 混用。目标设定继续使用现有资产/分镜字段。`shots.assetIds` 为本镜人物、场景、道具的稳定关联。原片与目标版本分别保留；资产必须有原片依据。完整字段和嵌套类型仍以 describe 为准。

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

结果含真实 `id`、`_version`、`total`、`nextCursor`。全站资源不附带项目/剧集筛选。`prompts` 用 `name` 定位，`mode=default` 取 `defaultText`，`mode=replace` 取 `text`。

### 剧本与场次写入

剧本页显示 `episodes.scenes[].content`，不是直接显示整集 `script`。每场为 `{id,location,setting,time,suggestedDuration?,content}`；`content` 必须保留按剧情顺序交错的动作、人物名（表演提示）和完整台词，可保存 Markdown 段落与加粗。不要把台词从正文抽到 `scenes[].dialogue`：该字段不受支持，结构化 `dialogue` 属于分镜 `shots`。

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

项目创建后返回实际编号，后续查询和编辑使用返回值。角色对白的 `assetId` 引用角色资产；分镜与片段引用真实剧集和场次。保存后用 `builtin_read_studio` 按 ID 查询结果；版本冲突时重读当前记录。

## 图片与视频任务

| Tool | 参数与返回 |
| --- | --- |
| `builtin_generate_media` | `modelId`、`prompt`，可选 `requestId`、`options`；返回任务 `id`、`status` |
| `builtin_get_media_task` | `taskId`；返回任务真实状态和结果 |

`modelId` 与生成参数采用当轮 Tool schema。`options` 可含 `resolution`、`aspectRatio`、`duration`、`references`。参考编辑时将指定图片放入 `references`。

自动关联生成结果使用 `options.studioTarget`，字段为 `resource`（`assets` 或 `clips`）、`id`、最新 `version`、`field`，形态另传 `variantId`。图片字段为资产 `image` 或片段 `image`、`storyboardImage`、`blockingImage`；视频字段为片段 `videos`。提交后用任务查询 Tool 获取结果。

## 视频转绘

具体创作规则按需加载 `video-redraw`；此处只说明网站操作。发现当轮转绘查询/操作能力后调用，不按名称猜测旧定义。

| Tool | 用法 |
| --- | --- |
| `builtin_read_video_redraw` | `describe=true` 查询能力、地区与限制；否则以 `projectId` 查询原片、持久化任务、草稿和错误 |
| `builtin_edit_video_redraw` | `projectId`、`action`，其他参数依操作及当前 schema |

| action | 参数与行为 |
| --- | --- |
| `prepare` | `requestId`、最新项目 `version`；检测切镜并抽帧，成功后保存原片真实元数据和 `segments` |
| `analyze` | `requestId`、`version`、逻辑文本 `modelId`、主 `agentId`；使用已配置的视觉模型。`sourceLanguage` 为原语言两位代码或空字符串自动识别；`visualOnly=true` 明确跳过原声分析。可传 `start/end` 只检查相交镜头 |
| `apply` | `jobId`，可选 `shotIds` 为草稿的 segment ID，留空应用全部；同批写入分镜、关联资产和场次。保护人工修改，项目设置或版本冲突时重新读取 |
| `cancel` | `jobId`；取消本项目运行中的转绘任务 |
| `frame` | `start/end`；返回中间真实帧及 `source`，供手工补资产或镜头；返回截图本身不创建业务记录 |
| `edit-shot` | `shotId`、`shotVersion`、`start/end`；更新原片切点与参考帧。另传 `split` 在指定原片时间拆分，已有片段引用时先调整关联 |
| `merge-shots` | `fromId/toId/fromVersion/toVersion`；合并同场、原片时间相邻的两个镜头，保留 fromId，迁移内容。已有片段引用时阻止操作 |
| `merge-assets` | `fromId/toId/fromVersion/toVersion`；确认是同一主体后合并同项目同类型资产，迁移分镜/片段引用，保留来源证据及目标图片历史；先处理源资产的衍生形态 |
| `export` | `requestId`、`version`、`selections:[{clipId,start?,end?}]`；按数组顺序合成已选用的真实视频，裁剪点基于实际媒体时长。保留生成音轨，不加入原片声音；成功后写入 `films` |

提交后读取任务真实状态：`queued/running/completed/failed/cancelled/interrupted`；`draft`、`segments`、`transcript` 为已完成阶段。提交返回任务不代表完成。原样重试沿用 requestId；继续失败/取消/中断任务用新 requestId 和 `resumeJobId`，项目设置、模型和区间须匹配，已完成分析与转写可复用。项目内同时一个转绘任务，全站同时两个。

首版原片仅 MP4、50 MB、120 秒、自动检测最多40镜头。无声视频跳过转写；有声视频默认用现有 Fish 配置获取真实时间戳，缺配置/调用失败如实报告。仅画面分析不会推断对白。视频生成沿用当前图片参考能力，尚不承诺连续动作逐帧还原；最终目标语音和口型需检查实际结果。

`prepare` 已使用脚本一次解码批量抽帧；`analyze` 自动将每批最多4镜头/12帧拼成带帧号和时间的图，并传入真实镜头映射和相交转写，无需另传拼图参数或重复运行脚本。离线使用随 `video-redraw` 打包的抽帧脚本时，先加载该 Skill 并读取 `references/source-analysis.md`；本地 `sample-N` 分组不是网站真实镜头 ID。

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
