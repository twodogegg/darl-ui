---
name: darl-studio
description: 通过 Agent Chat 当轮 Tools 操作网站；需要用户点击单选、多选或补充文字时使用交互提问能力。
---

# 网站 Tools

先读取当轮工具目录，以实际名称、参数 schema 和能力元数据为准。仅调用当前已提供的能力。

## 交互提问

当需要用户选择方案或补充偏好时，使用目录中支持交互提问的工具。当前内置名称为 `builtin_request_user_input`。

- 输入 `title`、可选 `description` 和 1–8 个 `questions`。
- 每题提供唯一的 `id`、`label` 与 `type`：`single` 为互斥单选，`multiple` 为可同时选择多项，`text`/`textarea` 为自由输入。
- 选择题提供 `options: [{ value, label, description?, disabled? }]`；值必须唯一且至少一项可选。`required` 控制必填，`defaultValue` 仅提供初始选择，`placeholder` 用于输入提示。
- 等待工具返回后再继续。`status: answered` 的 `answers` 按问题 ID 返回选项 value 或文字，多选为字符串数组；结合题目标签理解结果。
- `status: cancelled` 表示用户取消，不代替用户选择，不自动重复提问。提问不代表执行审批，也不能替代有费用或风险操作的授权。
- 完全访问模式同样等待用户提交。提交失败允许保留选择重试；停止或断连后旧提问失效。
