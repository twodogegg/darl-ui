# 模型配置、能力模板与渠道绑定

> 状态：设计规范 / 待按关联 Issues 实现。本文描述目标行为，不代表当前代码已实现。
>
> 适用项目：`@darl/ui` 通用组件库及其宿主示例。第一期以实际接入渠道能力为准，禁止按品牌名臆测。**2026-10-17 更正：旧 RunningHub `task_*` 素材 ID 协议已不作为本期接口依据。当前 H3 Flash 依据新版《MiniMax H3 调用说明》与平台素材文件接口：`POST /v1/files` → `GET /v1/files/{id}` 获取 URL → `POST /v1/videos`；`resolution` 为字符串 `"480"` / `"768"`。用户补充支持文生及首尾帧；首尾帧请求的具体字段尚需接口验证。**

## 1. 目标与边界

让使用者在「模型管理」中新增逻辑模型，选择可复用的能力模板，为同一模型绑定多个 API 供应商，并在绑定层配置上游模型映射、调用协议和少量能力差异。配置保存后由 AgentSidebar、MediaWorkspace、DefaultModelSelector 等组件读取。

- `@darl/ui` 提供配置 UI、类型、校验、受控回调和通用任务展示；宿主提供持久化、凭据、协议适配器、上传、请求、轮询、路由和结果存储。
- 只使用宿主已实现且验证过的协议。**协议包括请求构造、上传要求、异步任务、响应解析和错误映射**；不单独创建「响应处理」配置页。
- 不引入万能 HTTP/JSON Schema 编辑器、任意脚本、seed / CFG / sampler 等通用炼丹参数。
- 文本只暴露模型选择和支持的思考等级；**不提供关闭思考 / none 选项**。协议内部如何保证符合实际请求规范，由宿主负责。
- 第一阶段不支持 Seedance、官方 MiniMax H3、本地 H3、`minimax-h3-standard` 或 `runninghub-minimax-h3`。视频仅针对新版统一接口的 `minimax-h3-flash` 网关协议。

## 2. 第一期模型范围

| 类型 | 逻辑模型 ID（建议） | 参考能力模板 | 接口注意 |
| --- | --- | --- | --- |
| 文本 | `deepseek-v4.1-flash` | DeepSeek Thinking | 内部逻辑名；上游 ID 必须逐渠道明确映射 |
| 文本 | `gpt-6.1-sol` | GPT reasoning | 用实际接入的 Responses 协议 |
| 文本 | `gemini-4-argon` | Gemini Thinking | `thinking_level` 由协议适配 |
| 文本 | `gpt-6-astra` | GPT reasoning | 中转站别名应通过绑定映射 |
| 图片 | `gpt-image-2` | GPT Image 2 | 生成/编辑自动区分，协议统一解析 Base64 或 URL |
| 视频 | `minimax-h3-flash` | Darl API H3 Flash | **仅限第 7 节的新版统一 H3 API；不使用旧 RunningHub `task_*` 上传协议** |

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
- 路由必须在实际生成前根据输入、选项和能力筛选绑定；失败切换只考虑有效能力匹配的渠道。新版平台 `file_*` 是素材库 ID，生成接口实际消费 `GET /v1/files/{id}` 返回的公网 HTTP(S) URL；按新版说明，同一可访问 URL 可以跨渠道复用，**不能再套用旧网关 `task_*` 素材与渠道绑定的规则**。

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
- 画幅列表、分辨率可选值、生成时长离散值或区间、默认值；是否可控制音频生成（若无参数，不出现开关）。分辨率选项以各渠道实际可用值为准，H3 Flash 当前仅字符串 `"480"`、`"768"`；画幅仅 `16:9`、`9:16`。
- 模式级别的输入/输出约束应能覆盖总体模板。缺少模式声明时不得自动推断支持。
- 不把过时的 `megapixels` 或其他分辨率单位当作本期 H3 Flash 的接口选项；UI 只允许 `480`、`768`，提交时协议适配器传字符串 `"480"`、`"768"`。

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

## 7. `minimax-h3-flash`：第一期唯一视频接口（新版统一 H3 API）

**2026-10-17 纠正旧接口误读**：之前把旧版 RunningHub 工作流文档当成了现行网关合同。第一期应使用[新版《MiniMax H3 调用说明》](https://fwr0187eq6.apifox.cn/9532072m0)和用户指定的[上传平台素材文件](https://fwr0187eq6.apifox.cn/505284615e0)，**不是**旧 [Flash RunningHub 指南](https://fwr0187eq6.apifox.cn/9534525m0)的 `/runninghub/v1/uploads` 及 `task_*` 素材上传 ID。

新版 H3 API 同时列出 Standard 和 Flash；**第一期只做 `minimax-h3-flash`，不开发 Standard**。协议适配器建议注册为 `darl-h3-flash-unified`，其请求构造、素材 URL 转换、任务状态和结果解析均属于宿主协议责任，不单设响应配置页。

### 7.1 上传与素材规则（已核对新版文档）

| 步骤 | API | 说明 |
| --- | --- | --- |
| 上传文件 | `POST /v1/files` | `multipart/form-data`；必填 `file`，可选 `purpose=vision`；Bearer 网关凭据 |
| 查询文件 | `GET /v1/files/{file_id}` | 上传得到 `file_*` ID；查询响应中的 `url` 是公网可访问素材地址 |
| 生成引用 | `POST /v1/videos` | `reference_images` / `reference_audio` / `reference_videos` / `reference_video` 传**HTTP(S) URL**，不是 `file_*`、不是旧 `task_*` |

- 平台素材上传也支持视频和音频；服务端识别类型，单文件最大 **100 MiB**（依新版素材 API 说明）。
- 可跨渠道使用同一个**可公网下载 URL**；不再强制按旧版 RunningHub 上传任务与供应商密钥绑定。跨渠道使用前仍需确认新渠道具备相应输入能力。
- 返回可能是公共 URL，也可能是有有效期的预签名 URL（默认约 24 小时）；使用前确保有效期覆盖排队与生成时间；长期资产应持久化、重新获取 URL。
- 不允许直接将 `file_*` 写进请求里的参考素材 URL 字段，更不能沿用旧 `/runninghub/v1/uploads` 得到的 `task_*` ID。

### 7.2 当前 Flash 参数与能力

| 请求字段 | 当前要求 | Flash 建议默认 |
| --- | --- | --- |
| `model` | `minimax-h3-flash` | 必传 |
| `prompt` | 非空文本；图片按 `<Picture 1>` 起的顺序对应 | 必传 |
| `seconds` | 整数 4–15 秒 | 10 |
| `resolution` | **字符串 `"480"` 或 `"768"`**，表示最终视频短边像素 | `"768"` |
| `aspect_ratio` | **只支持 `16:9` / `9:16`** | `9:16` |
| `reference_images` | 至多 9 个公网图片 URL | [] |
| `reference_audio` | 至多 3 个公网音频 URL | [] |
| `reference_videos` | 至多 3 个公网视频 URL | [] |
| `reference_video` | 单个视频 URL，与 `reference_videos` 互斥 | 省略 |

不发送旧的 `megapixels`、`upscale`、`instance_type`、`use_personal_queue` 等未列入新版接口的字段。旧文档中八种画幅现在不是本期可选项。

**生成模式的证据级别：**
- **文生视频**：新版网关支持，按文本提示词提交。
- **多模态参考生成**：使用图片、视频和音频 URL；独立校验数量、素材类型及跨渠道能力。
- **首尾帧生成**：用户明确确认网关支持，产品能力应保留；**目前上述新版 RunningHub/H3 Flash 请求表尚未定义首/尾帧角色字段**。实现时应从用户更新后的具体请求样例或真实网关响应确认字段和组合规则，**不得自创键名、把普通参考图片假冒首尾帧，或复制本地 H3 `content` 结构**。在适配器未完成验证之前，UI 可展示规划中的模式但不能声称该模式已接通。
- **仅首帧 / 仅尾帧**：当前用户未单独确认，保持未知，不自动开启。

### 7.3 生成、查询、下载

1. 按生效能力先确定可用渠道；如果用户提供本地素材，则上传至平台文件接口，获得 `file_*`，查询可直接访问的 `url`，再组成目标协议请求。已是公网 URL 的素材可复用（需校验类型和有效期）。
2. `POST /v1/videos`，JSON，以上述字段提交。首尾帧分支必须在确认该网关实际字段后实现；保存创建返回的**网关公开任务 ID**。
3. `GET /v1/videos/{id}` 查询 `queued` / `in_progress` / `completed` / `failed`；规范化展示任务状态。新版文档的 `video_url` 可为网关相对地址 `/v1/videos/{id}/content`，不能假定始终是外部 CDN URL。
4. `GET /v1/videos/{id}/content`，使用网关 Bearer 凭据获取产物，并由宿主持久化；不得把带短时效的下载 URL 当永久地址。
5. 新版说明未公开本协议的续接、取消和独立二采接口；第一期不据其他协议自动开放。

### 7.4 验收要点

- **必须使用新版平台文件接口**：上传返回 `file_*`、查询取得 URL、创建提交 URL。旧上传路径/旧素材任务 ID 不得出现。
- 验证文生视频，以及用户已确认支持的首尾帧模式；首尾帧字段、行为、必要性以真实网关测试为准，无法验证时如实标为未完成。
- 测试 `resolution` 为 `"480"` / `"768"` 的请求，拒绝无效值；画幅只允许 `16:9` / `9:16`；参考图片 9 / 视频 3 / 音频 3 上限，单视频字段互斥。
- 验证跨渠道可用素材 URL / 过期预签名 URL / 错误 MIME / 上传和查询失败 / 视频任务失败；绝不使用模拟成功代替真实接口闭环。

## 8. 分期与实施依赖

- P0：配置实体与继承/覆盖、模型映射、协议键与持久化兼容。
- P0：模型/渠道/模板编辑 UI 与合法性校验。
- P0：AgentSidebar、MediaWorkspace、DefaultModelSelector 消费统一有效能力，移除硬编码。
- P1：宿主示例适配协议，优先实现 `darl-h3-flash-unified`，验证完整媒体任务；图片协议解析 Base64/URL；异步结果复用 TaskCenter（#16）。
- 后续：Seedance、官方/本地 H3、更多供应商协议和多种视频模式，**需要独立真实契约与测试**，不从旧版 H3 RunningHub 文档猜测。

## 9. 参考来源

- [新版：MiniMax H3 调用说明（Standard / Flash）](https://fwr0187eq6.apifox.cn/9532072m0)
- [新版：上传平台素材文件 POST /v1/files](https://fwr0187eq6.apifox.cn/505284615e0)
- [统一视频素材文件 API：查询 URL 的完整流程](https://fwr0187eq6.apifox.cn/9349975m0)
- [统一视频任务创建 POST /v1/videos](https://fwr0187eq6.apifox.cn/505235608e0)
- [OpenAI GPT Image 2 官方](https://developers.openai.com/api/docs/models/gpt-image-2)
- [OpenAI 图片编辑 API](https://developers.openai.com/api/reference/resources/images/methods/edit)
- [OpenAI GPT-6.1 Sol](https://developers.openai.com/api/docs/models/gpt-6.1-sol)
- [OpenAI GPT-6 Astra](https://developers.openai.com/api/docs/models/gpt-6-astra)
- [Google Gemini 4 Argon](https://ai.google.dev/gemini-api/docs/models/gemini-4-argon)
- [DeepSeek 思考等级](https://api-docs.deepseek.com/guides/thinking_mode/)

> 本文是目标设计。已公开文档证实的规则与用户确认但尚缺字段说明的能力，分别标记；没有实际接口验证时不得报告“已接通”。
