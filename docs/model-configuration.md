# 模型配置、能力模板与渠道绑定

> 状态：设计规范 / 待按关联 Issues 实现。本文描述目标行为，不代表当前代码已实现。
>
> 适用项目：`@darl/ui` 通用组件库及其宿主示例。第一期以实际接入渠道能力为准，禁止按品牌名臆测。**2026-10-17 用户已补充网关最新能力：`minimax-h3-flash` 支持文生视频、首尾帧生成，`resolution` 仅为 `480` / `768`。Apifox 旧文档部分字段未更新，以这些用户确认的规则为准。**

## 1. 目标与边界

让使用者在「模型管理」中新增逻辑模型，选择可复用的能力模板，为同一模型绑定多个 API 供应商，并在绑定层配置上游模型映射、调用协议和少量能力差异。配置保存后由 AgentSidebar、MediaWorkspace、DefaultModelSelector 等组件读取。

- `@darl/ui` 提供配置 UI、类型、校验、受控回调和通用任务展示；宿主提供持久化、凭据、协议适配器、上传、请求、轮询、路由和结果存储。
- 只使用宿主已实现且验证过的协议。**协议包括请求构造、上传要求、异步任务、响应解析和错误映射**；不单独创建「响应处理」配置页。
- 不引入万能 HTTP/JSON Schema 编辑器、任意脚本、seed / CFG / sampler 等通用炼丹参数。
- 文本只暴露模型选择和支持的思考等级；**不提供关闭思考 / none 选项**。协议内部如何保证符合实际请求规范，由宿主负责。
- 第一阶段不支持 Seedance、官方 MiniMax H3、本地 H3、`minimax-h3-standard` 或 `runninghub-minimax-h3`。视频仅针对以下专用网关协议。

## 2. 第一期模型范围

| 类型 | 逻辑模型 ID（建议） | 参考能力模板 | 接口注意 |
| --- | --- | --- | --- |
| 文本 | `deepseek-v4.1-flash` | DeepSeek Thinking | 内部逻辑名；上游 ID 必须逐渠道明确映射 |
| 文本 | `gpt-6.1-sol` | GPT reasoning | 用实际接入的 Responses 协议 |
| 文本 | `gemini-4-argon` | Gemini Thinking | `thinking_level` 由协议适配 |
| 文本 | `gpt-6-astra` | GPT reasoning | 中转站别名应通过绑定映射 |
| 图片 | `gpt-image-2` | GPT Image 2 | 生成/编辑自动区分，协议统一解析 Base64 或 URL |
| 视频 | `minimax-h3-flash` | RunningHub H3 Flash | **仅限本文第 7 节的 Apifox RunningHub Flash 协议** |

首批文本思考等级（以官方资料作为模板初值，实际渠道允许覆写）：

| 模型 | UI 支持档位 | 建议默认 |
| --- | --- | --- |
| DeepSeek V4.1 Flash | `low`, `high`, `max` | `high` |
| GPT-6.1 Sol | `low`, `medium`, `high`, `xhigh`, `max` | `medium` |
| Gemini 4 Argon | `low`, `medium`, `high` | `medium` |
| GPT-6 Astra | `low`, `medium`, `high`, `xhigh`, `max` | `medium`（产品默认） |

DeepSeek 官方将请求 `medium` 映射到实际 `high`，因此不在 UI 中重复展示等效档位。上述名称在不同网关可能是自定义别名，**不得直接认定逻辑 ID 就是供应商接收的上游模型 ID**。

## 3. 数据关系与所有权

```text
逻辑模型 LogicalModel
  ├── id / code / displayName / type / enabled
  ├── capabilityTemplateId ──> 能力模板 CapabilityTemplate（可以多模型共享）
  └── bindings[] ────────────> 渠道绑定 ModelBinding（每模型可多个）
                                  ├── providerId ───────> 供应商 Provider（baseUrl / API Key）
                                  ├── upstreamModelId（模型映射）
                                  ├── protocolKey（已安装适配器）
                                  ├── capabilityOverrides（仅记录差异）
                                  ├── enabled / priority / weight（高级项）
                                  └── 运行时有效能力 = 模板 + 差异覆盖
```

- **逻辑模型**：用户看到的统一入口。若只是同一模型在不同供应商更名（如 `gpt-image-2` 对应 `gpt-image-2-all`），只新增绑定，不新增逻辑模型；显示别名不生成新的推理能力。
- **能力模板**：保存类型相符的公共选项，多模型共用；模板更新可传播到未覆盖字段。
- **渠道绑定**：特定供应商上的上游模型 ID、协议与真实能力约束；相同协议也可有不同限制，不同协议也可共享模板。
- **供应商**：名称、Base URL、凭据、连接状态；**协议不固定在供应商级别**，因为同一网关可运行多个协议。
- **协议适配器**：宿主侧实现请求、素材上传、响应解析、异步生命周期；不能仅靠配置一个 `protocolKey` 就假定适配器存在。
- 路由必须在实际生成前根据输入、选项和能力筛选绑定；失败切换只考虑有效能力匹配的渠道。不同渠道上传的 H3 素材 ID **不能直接跨渠道使用**。

## 4. 能力模板结构

以固定、类型安全的字段描述能力；不要求用户编辑原始 JSON。

### 文本

- `reasoningEfforts: string[]`：只列出当前协议/渠道真实支持的思考等级，不含关闭思考。
- `defaultReasoningEffort`：必须属于候选档位。
- 视觉输入、工具调用等可用于内部运行时校验，但不作为新的通用用户调参面板。

### 图片

- 文生图、参考图编辑是否支持；**不要求用户手动切换生成/编辑**，由当前输入中是否有参考图推断，但必须验证渠道确实支持。
- `maxReferenceImages`；最大输出数量；可选画质、文件格式、背景透明设置。
- 输出规格按 API 支持的 **`size` / 宽高组合**保存，不能把 `1K`、`2K` 标签当成实际 `size` 参数；某些协议可能接受画幅 + 分辨率，应由其适配器转换。
- GPT Image 2 官方编辑接口最多 16 张参考图；常用 `size` 包括 `auto`、`1024x1024`、`1536x1024`、`1024x1536`，还可以采用符合 API 约束的自定义宽高；这是官方能力参考，第三方渠道仍可覆盖。
- 图片返回 Base64 或 URL 的差异**由协议适配器统一规范为宿主结果对象**，不是能力模板字段。

### 视频

- **生成方式**需要逐项声明：纯文生、仅首帧、仅尾帧、首尾帧、多模态参考。拥有普通参考图片字段**不等于**支持专门的首/尾帧角色。
- `maxReferenceImages`、`maxReferenceVideos`、`maxReferenceAudios`；可选素材总数上限和不允许的混合组合。视频/音频的数量及长度限制需按渠道确认。
- 画幅列表、分辨率可选值、生成时长离散值或区间、默认值；是否可控制音频生成（若无参数，不出现开关）。分辨率选项以各渠道实际可用值为准，H3 Flash 当前仅 `480`、`768`。
- 模式级别的输入/输出约束应能覆盖总体模板。缺少模式声明时不得自动推断支持。
- 不把过时的 `megapixels` 或其他分辨率单位当作本期 H3 Flash 的接口选项；其 UI 只允许 `480`、`768`，并校验默认值属于这个集合。

### 模板与覆盖规则

- 有模板且无覆盖的字段继承模板；覆盖值为 `0` 或 `false` 时必须保留，不能当空值。
- 列表覆盖采取 **整体替换**，不做数组拼接；例如只有 `9:16` 就只允许 `9:16`。
- 模板与绑定类型必须一致；默认值必须在最终有效能力之内，输入上限不得为负。
- 「关联模板」与「复制配置」区分：关联可继承未来修改，复制后独立；页面应提供清晰提示。
- 切换绑定时清理不兼容选项，不能默默删除用户已上传的参考素材后继续生成。

## 5. 配置页面（先手机，再桌面）

只保留两个主入口，具体操作在弹窗/抽屉里完成：

1. **模型管理**：模型搜索/列表 + `新增模型`。模型创建时输入名称、逻辑 ID、类型，选择模板；可以复制现有模型创建新的逻辑模型，也可以只添加别名。
2. **API 供应商**：增加/编辑名称、Base URL、API Key（服务端保存）、启停与连接检测。
3. **逻辑模型详情**：展示所属模板、默认设置、各渠道绑定（供应商、上游 ID、协议、启停、差异覆盖数量）。
4. **添加/编辑渠道绑定**：供应商 → 上游模型 ID（模型映射）→ 已实现的调用协议 → 继承模板/自定义能力。能力编辑按文本/图片/视频类型显示对应选项；高级项折叠。
5. **能力编辑**：继承值与覆盖值明显区分，提供「恢复继承」；保存前展示最终生效能力与校验错误。
6. **新增流程**：新增逻辑模型可以先保存、稍后绑定渠道；同一模型只是供应商改名，应直接「添加渠道」，不要重复新增模型。

不要独立展示「响应格式」配置页，也不要把协议锁死在供应商上。

## 6. 组件与宿主交互契约

- `AgentSidebar`：只显示启用的文本模型和其当前渠道有效思考档位，模型切换后清理无效值。不暴露关闭思考，参数键由协议负责。
- `MediaWorkspace`：模型/绑定决定输入槽位、图片编辑自动判定、画幅/尺寸/时长等控件；所有输入都在提交前校验。通用 `onGenerate` 事件携带逻辑模型、选中绑定或路由策略、模式、素材角色及规范化选项，**不能直接拼接供应商原生请求体**。
- `DefaultModelSelector`：只要求宿主实际启用的类型，比例/尺寸从模型能力读取，不能使用固化白名单。
- **协议实现位于宿主**：通过 `protocolKey` 从受支持适配器注册表选择，适配器负责上传、发送、轮询、下载和错误标准化。UI 不保存 API Key 或实现通用网关调度。
- 配置读写可使用受控 Props/Callbacks；示例宿主若负责持久化，必须保证新增字段经服务端校验后完整往返，不能被旧数据清洗器删除。
- 使用已有任务中心 Issue #16 展示异步任务，避免再造第二套状态机。

## 7. `minimax-h3-flash`：第一期**唯一视频接入合同**

**接口基础文档（部分字段尚未更新）：** [Apifox · MiniMax H3 Flash（RunningHub）](https://fwr0187eq6.apifox.cn/9534525m0)（以及其[创建接口](https://fwr0187eq6.apifox.cn/523019890e0)、[上传接口](https://fwr0187eq6.apifox.cn/523019889e0)）。**用户确认的当前网关行为优先：文生视频 + 首尾帧生成；`resolution` 仅支持 `480` / `768`。** 首尾帧的实际请求字段及素材上传/引用形式在最新版文档或真实请求中核对，不能直接复用其他 H3 协议。

**注意重名：** Apifox 还存在[「MiniMax H3 调用说明」](https://fwr0187eq6.apifox.cn/9532072m0)和[「MiniMax H3 视频 API 使用说明」](https://fwr0187eq6.apifox.cn/9352472m0)；它们描述不同的接入方式及不同参数，**不得混用**。本期 `protocolKey` 建议命名 `darl-runninghub-h3-flash`，避免与本地 H3、官方 H3 或其他统一视频协议混淆。

### 7.1 入参能力与默认值

| 字段 | 实际约束 | 默认值 |
| --- | --- | --- |
| `model` | `minimax-h3-flash` | 必传 |
| `prompt` | 必传非空字符串；图片按顺序对应 `<Picture 1>` 等编号 | 无 |
| `seconds` | 整数 4–15 | 10 |
| `resolution` | **仅 `480` 或 `768`**（当前用户确认的有效值；字段类型按实际网关校验） | 建议 `768`，可按渠道覆盖 |
| `aspect_ratio` | `1:1`、`2:3`、`3:2`、`3:4`、`4:3`、`9:16`、`16:9`、`21:9` | `9:16` |
| `reference_images` | 最多 9 个 **网关上传素材 ID** | [] |
| `reference_audio` | 最多 3 个 **网关上传素材 ID** | [] |
| `reference_videos` | 最多 3 个 **网关上传素材 ID** | [] |
| `reference_video` | 单视频兼容字段；**不得与 `reference_videos` 并用** | 省略 |
| `instance_type` | `default` / `plus` / `ultra`，取决于账号、费用及工作流支持 | `default` |
| `use_personal_queue` | Boolean | false |

- **以当前网关能力为准使用 `resolution`（480 / 768），不再使用过期的 `megapixels`。** 其他未验证的 `upscale`、`seed`、`generate_audio`、`webhookUrl`、`retainSeconds`、`webappId`、`nodeInfoList` 等字段不得擅自发送。实例类型与队列设置本期可由宿主固定默认，不强迫用户配置。
- **当前已确认支持文生视频与首尾帧生成**：为本渠道开启 `text-to-video` 与 `first-last-frame`（两帧角色）。首帧、尾帧的实际请求字段以及其是否必须同时提供，按新网关接口验证；**「仅首帧」「仅尾帧」是否单独支持尚未确认，先不启用。** 多模态参考输入继续按当前渠道的素材上限配置。
- 本专用接口并非“直接输入 URL 的通用视频接口”。`reference_*` 使用上传返回的 `task_*` 素材 ID（兼容 `fileName`，但不作为默认安全路径），不可直接传 HTTP URL、Base64 或本地文件路径。
- 图片 9 / 音频 3 / 视频 3 是**各类型上限**，此文档没有证明所有类型极限值可以同时组合提交；不要自行添加未证实的全局混合总数上限或声称所有组合必然成功。

### 7.2 宿主调用流程与任务

1. 在路由阶段先选定**具体绑定/渠道**，确定将使用的网关凭据与素材归属。
2. 有参考素材时，逐文件执行 `POST /runninghub/v1/uploads`，`multipart/form-data`，字段 `model=minimax-h3-flash` + `file`，保存响应 `id` 和媒体类型；素材与所属渠道/供应商密钥绑定，不跨渠道复用。
3. `POST /v1/videos`（JSON），带 `model`、`prompt`、`seconds`、**`resolution`（480/768）**、`aspect_ratio`、相应 `reference_*` 素材 ID。首尾帧模式额外传入独立首/尾帧素材角色，**字段名与该模式是否复用上传接口待对最新网关验证**，不得假造请求键；保存返回的公开 `id`。
4. `GET /v1/videos/{id}` 查询：`queued` / `in_progress` / `completed` / `failed`；统一映射到组件任务状态。完成后读取 `video_url`。
5. `GET /v1/videos/{id}/content` 下载带鉴权的产物并交由宿主持久保存；供应商生成 URL、上传链接约 24 小时有效，**不能把短效 URL 当永久素材地址**。
6. 未公开专用接口的取消、续接、独立二次采样；组件不得提供冒充可用的动作。涉及重试或切渠道时，需要重新选择绑定、检查并按目标渠道重新上传素材，不能复用原渠道的上传 ID。

**验收必须走真实网关 API**：文生视频、首尾帧分别验证上传（如需要）→ 创建 → 查询 → 下载；确认首尾帧入参及角色、`resolution=480` / `768` 成功，其他值被阻止；还包括错误素材 ID / 错误渠道 / 超限 / 有效期和失败状态。组件 Playground 不应擅自上传用户文件；真实验证放宿主示例并由操作者提供凭据。

## 8. 分期与实施依赖

- P0：配置实体与继承/覆盖、模型映射、协议键与持久化兼容。
- P0：模型/渠道/模板编辑 UI 与合法性校验。
- P0：AgentSidebar、MediaWorkspace、DefaultModelSelector 消费统一有效能力，移除硬编码。
- P1：宿主示例适配协议，优先实现 `darl-runninghub-h3-flash`，验证完整媒体任务；图片协议解析 Base64/URL；异步结果复用 TaskCenter（#16）。
- 后续：Seedance、官方/本地 H3、更多供应商协议和多种视频模式，**需要独立真实契约与测试**，不从 H3 Flash 猜测。

## 9. 参考来源

- [Apifox：MiniMax H3 Flash RunningHub 说明](https://fwr0187eq6.apifox.cn/9534525m0)
- [Apifox：创建 Flash 视频](https://fwr0187eq6.apifox.cn/523019890e0)
- [Apifox：上传 Flash 素材](https://fwr0187eq6.apifox.cn/523019889e0)
- [Apifox：查询任务](https://fwr0187eq6.apifox.cn/523019892e0)
- [Apifox：下载任务产物](https://fwr0187eq6.apifox.cn/523019893e0)
- [OpenAI GPT Image 2 官方](https://developers.openai.com/api/docs/models/gpt-image-2)
- [OpenAI 图片编辑 API](https://developers.openai.com/api/reference/resources/images/methods/edit)
- [OpenAI GPT-6.1 Sol](https://developers.openai.com/api/docs/models/gpt-6.1-sol)
- [OpenAI GPT-6 Astra](https://developers.openai.com/api/docs/models/gpt-6-astra)
- [Google Gemini 4 Argon](https://ai.google.dev/gemini-api/docs/models/gemini-4-argon)
- [DeepSeek 思考等级](https://api-docs.deepseek.com/guides/thinking_mode/)

> 本文是目标设计。凡未在来源中明确证实、或宿主渠道额外限制的能力，在通过真实接口验收前保持禁用或未知。
