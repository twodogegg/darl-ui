# 媒体生成第一期（Issue #30）

## 当前已实现

- Agent Chat 宿主使用现有 `.local/agent-chat/data.sqlite` 保存生成任务与每模型并发限制。
- 图片支持 `gpt-image-2`、`gpt-image-2.5`、`gemini-3-pro-image-preview`，视频支持 `minimax-h3-flash`；每个逻辑模型仅允许一个启用的供应商绑定，不使用权重、优先级或自动切换。
- 图片产品选项只有画幅（7 种）、清晰度档位（`1K` / `2K` / `4K`）和参考图数量（GPT 16、Gemini 14）；不提供质量、输出格式、背景和生成数量控件。
- `gpt-image-2.5` 的当前渠道上游 ID 为 `gpt-image-2.5-sunburst`，能力模板与 `gpt-image-2` 相同。
- 全局主 Agent 可通过内置工具创建和查询生成任务。**创建任务必须经用户确认**；任务不依赖聊天连接持续运行。
- 服务端轮询已提交的 H3 远端任务并保存输出文件到 `.local/agent-chat/generated-media/`。
- 导航里的「媒体生成」页用 `MediaWorkspace` 展示 SQLite 的最新状态，并可直接提交、重命名、重试和收藏；设置 → 模型中可分别修改各图片 / 视频模型的在途任务最大并发。
- 查询任务失败（`failed` / `uncertain` / `cancelled`）时，内置查询工具返回 `isError`，界面按失败卡片展示原因，不再伪装成「已完成」。
- 关闭浏览器后 Node 仍运行时任务继续；服务重启后若已存远端 H3 ID 则恢复查询。未知是否成功提交的任务标为 `uncertain`，不会盲目重复付费提交。
- 运行 `npm run dev` 并打开 `http://localhost:5197`；已有供应商设置中填写真实的服务端 API Key。

## 限制、未验收

1. **图片链路已用真实网关跑通。** GPT 系无参考图走 `/v1/images/generations`，有参考图走 `/v1/images/edits`：远程 HTTP(S) 参考图用 JSON（`image: [url]`，网关自己拉取，已实测可用），本地 base64 用 multipart。结果同时支持 `url` 与 `b64_json`，返回 URL 时直接把它作为结果保存，**不下载**。UI 的推荐尺寸表（画幅 × 1K/2K/4K）由适配器映射为 `size`；被渠道拒绝时会按返回的 `allowed` 选最接近的画幅重试一次，`requestedSize` / `usedSize` 都会记录。`gpt-image-2.5-sunburst` 已实测 `16:9` + `1K`（`1280x720`）生成成功。
2. **Gemini 图片已实测。** `POST /v1beta/models/{model}:generateContent` 使用 `imageConfig.aspectRatio` + `imageSize`；Base64 参考图用 `inlineData`。当前网关文生图会把图片作为 Markdown data URL 放在 text part，参考图编辑会返回 `inlineData`，适配器两种都识别。仅限制参考图总数 14 张，不声称执行物体 / 人物 / 风格分类限额。
2b. **H3 Flash 视频已实测。** `POST /v1/videos` 接受 `seconds` / `resolution`（`480` 或 `768`）/ `aspect_ratio`；轮询 `GET /v1/videos/{id}` 的真实状态词是 `processing` / `succeeded`，`video_url` 是相对路径，需按 API 根地址补全。适配器按这套词表工作，因此 H3 的清晰度必须用协议值 `480` / `768`，UI 标签不能再写成 `480P`。
3. 暂不支持 H3 Flash 参考图/音视频及首尾帧：新版接口未定义首/尾帧角色字段，没有真实网关核验前禁止假装已实现。
4. 当前仅支持本机单 Node 服务，**没有跨进程租约和分布式一致性保护**；不适合多个 Node 进程共用 SQLite 提交任务。
5. 已入队的视频如果在 HTTP 已提交但还没收到远端 ID 时中断，会成为 `uncertain`，需要人工对照供应商记录后处理。不要盲目重试。
6. 自动失败重试、取消远端任务、结果资产管理和生产级用户认证仍未完成。任务 API 限制本机访问，勿把开发服务器直接暴露到公网。
7. 网关 5xx 会用扁平的 `{ code, message }` 响应体（例如余额不足返回 HTTP 502），已按此解析并显示真实原因；OpenAI 风格的 `{ error }` 仍然支持。

## 验证

```bash
npm run typecheck
npm run test
npm run build
```

SQLite 持久化与异常重启恢复覆盖单测；**自动化测试并不代表真网关生成成功**。

后续工作归入 [Issue #30](https://github.com/twodogegg/darl-ui/issues/30)。
