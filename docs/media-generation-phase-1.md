# 媒体生成第一期（Issue #30）

## 当前已实现

- Agent Chat 宿主使用现有 `.local/agent-chat-drama/data.sqlite` 保存生成任务与每模型并发限制。
- 只支持 `gpt-image-2` 和 `minimax-h3-flash`，每个逻辑模型仅允许一个启用的供应商绑定；不使用权重、优先级或自动切换。
- 全局主 Agent 可通过内置工具创建和查询生成任务。**创建任务必须经用户确认**；任务不依赖聊天连接持续运行。
- 服务端轮询已提交的 H3 远端任务并保存输出文件到 `.local/agent-chat-drama/generated-media/`。
- 页面右上角「生成任务」展示 SQLite 的最新状态；设置 → 模型中可分别修改两个模型的在途任务最大并发。
- 关闭浏览器后 Node 仍运行时任务继续；服务重启后若已存远端 H3 ID 则恢复查询。未知是否成功提交的任务标为 `uncertain`，不会盲目重复付费提交。
- 运行 `npm run dev` 并打开 `http://localhost:5297`；已有供应商设置中填写真实的服务端 API Key。

## 限制、未验收

1. **尚未拿到真实 Darl 网关凭据执行付费联调。** 图片请求先按 `/v1/images/generations` 和 `b64_json` 适配，H3 先按 `/v1/videos` 适配；两者都必须与实际供应商请求/响应复核。
2. 暂不支持 GPT Image 2 参考图编辑、H3 Flash 参考图/音视频及首尾帧：Apifox 不同页面有素材 ID 与 URL 的协议差异，没有真实网关核验前禁止假装已实现。
3. 当前仅支持本机单 Node 服务，**没有跨进程租约和分布式一致性保护**；不适合多个 Node 进程共用 SQLite 提交任务。
4. 已入队的视频如果在 HTTP 已提交但还没收到远端 ID 时中断，会成为 `uncertain`，需要人工对照供应商记录后处理。不要盲目重试。
5. 自动失败重试、取消远端任务、结果资产管理和生产级用户认证仍未完成。任务 API 限制本机访问，勿把开发服务器直接暴露到公网。
6. UI 的默认媒体选择页面旧的 `1K/2K/4K`、`480P` 标签不等于网关的 `size` / `resolution`，实际调用按当前两个适配器的白名单，需后续核对映射。

## 验证

```bash
npm run typecheck
npm run test
npm run build
```

SQLite 持久化与异常重启恢复覆盖单测；**自动化测试并不代表真网关生成成功**。

后续工作归入 [Issue #30](https://github.com/twodogegg/darl-ui/issues/30)。
