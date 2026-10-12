# AGENTS.md — darl-ui

本文件适用于整个仓库。开始修改之前，请先读取本文件、README.md、package.json 以及相关组件源码。它是给 Codex 等编码 Agent 的项目规范，不取代用户当次明确要求。

## 项目定位

- 仓库：`twodogegg/darl-ui`；包名：`@darl/ui`。
- 目标：面向多个 React 网站的可复用高级功能组件库，以及与源码同仓库的交互式演示站。
- 技术：React、TypeScript、Vite；组件库通过独立 CSS 发布，不要求使用方安装 Tailwind。
- **设计基础：shadcn/ui（https://ui.shadcn.com）**。优先参考并复用其官方基础组件、设计约定及可访问性交互模式；缺少的高级业务功能由本项目自行封装。
- 当前 `src/components/ui/Button.tsx` 是参考 shadcn/ui Button 约定的本地适配，不是通过官方 CLI 原样安装的源码；不得虚称“所有基础组件均为 shadcn/ui 官方原版”。
- shadcn/ui 为源码分发体系：使用时以官方文档及源代码为准，尊重上游许可，并保留需要的归属/许可信息。

## 必须遵循的原则

1. 如非必要，勿增实体。优先修复或扩展已有组件，避免新增服务、数据库、管理后台、复杂配置层或过度抽象。
2. UI 基础只采用 shadcn/ui 体系；不足之处优先通过 React、TypeScript 与浏览器原生 API 实现。未经用户明确同意，不引入 Uppy、react-dropzone、另一套 UI 组件库或视频播放器框架。
3. 保持“组件本身负责 UI 和通用交互；宿主网站负责业务数据、鉴权、API 和远程存储”的边界。
4. 对外 API 简明、类型完备、有合理默认值；尽量维持向后兼容。不要把内部源码路径当成公共 API。
5. 支持明/暗主题、品牌色和独立组件颜色覆盖。优先语义化 CSS 变量；新增组件样式使用 `darl-` 前缀并避免污染宿主全局样式。
6. 一个高级组件必须同步提供：源码、`src/index.ts` 公共导出、必要样式、Playground 真实交互演示、README/API 说明和测试。
7. 不为了演示上传或操作真实用户数据。Playground 默认使用本地文件/模拟行为，不自动发送文件到服务器。
8. 不擅自发布 npm、部署生产站或修改宿主业务仓库。仓库已有 `"private": true`，只有获得授权才调整发布策略。

## 当前仓库结构

- `src/components/ui/`：shadcn/ui 风格的底层基础 UI 适配。
- `src/components/file-uploader/`：FileUploader 实现。
- `src/theme/`：DarlUIProvider 与主题。
- `src/index.ts` / `src/styles.css`：组件库公开入口和样式入口。
- `playground/`：组件演示网站；演示必须真实调用组件库源码。
- `tests/`：Vitest 测试。
- `docs/`：功能规划和约定；计划中的功能不能写成已实现。

## 开发与验证

项目以现有 package.json 的 scripts 为唯一命令依据，当前常用命令：

```bash
npm install
npm run dev
npm run typecheck
npm run test
npm run build
```

- 只添加与任务有关的最小改动；检查现有实现再动手，避免重复代码。
- 新增交互覆盖正常流程与失败、取消、空列表、边界条件。
- 文件上传：每文件单独校验、失败互不影响；不影响正常输入框的粘贴；主动释放本地 object URL；进度必须来自适配器，不能伪造。
- 媒体组件：统一清理定时器/监听器/媒体资源，正确处理浏览器播放限制、加载失败、不同尺寸与不同视频时长；不未经用户操作自动播放有声视频。
- 本地无法运行检查时明确标注“未验证”，绝不声称通过。遇到 CI 失败应读取具体日志并修复根因，不通过关闭检查掩盖问题。

## VideoCompare 功能（计划中，尚未实现）

规划文档：`docs/video-comparison.md`。定位为 2–4 个视频同屏、统一时间轴同步播放、只允许选定一路原视频声音的对比播放器。

- 优先复用浏览器 `<video>`、`HTMLMediaElement` API 与现有 shadcn/ui 基础控件模式。
- 一个统一控制器负责播放/暂停/进度/倍速/循环；不能仅分别调用 `play()` 就认定同步完成。
- 每次仅一个视频可输出声音，允许全部静音；切换音源不重置公共时间轴。
- 默认按最长视频时长播放，短视频结束后停留在最后一帧；不擅自裁剪或循环单个视频。
- v0.1 只做查看和比较，不做拼接、渲染、下载合成视频、音频混音或素材持久化。

## 提交要求

- 提交只包括当前任务范围，命名清楚，例如 `feat: add video comparison`、`docs: specify video comparison`。
- 在 PR 中描述变更范围、演示方式、测试结果、已知限制和是否影响公开 API。
- 优先通过分支和 PR 评审非紧急改动；不要擅自合并。
