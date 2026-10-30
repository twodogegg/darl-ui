# 视频转绘流程 · Video Redraw Workflow

一个独立的 React Flow 流程总览服务，把现有视频转绘链路展示为可缩放、可点击的节点工作流：

`项目设定 → 原片入库 → 候选切镜 → 视频模型分析 → 分镜核对 → 资产提取 → 目标资产成像 → 资产确认 → 片段编排 → 视频生成 → 合成导出 → 验收交付`

## 运行

```bash
cd video-redraw-flow
npm install
npm run dev
```

默认地址：`http://localhost:5337`

端口固定为 `5337`，被占用时直接失败，不自动切换。如需在隔离环境改端口：

```bash
VIDEO_REDRAW_FLOW_PORT=5347 npm run dev
```

生产构建与本地预览：

```bash
npm run build
npm run preview
```

## 说明

- 这是流程展示服务，不执行真实媒体任务，也不伪造任务状态或生成结果。真实制作仍在主站工作台完成。
- 节点内容与真实业务边界对齐：原片上限 300 MB / 300 秒、PySceneDetect 候选切镜、视频模型分析、资产衍生形态、片段 ≤ 15 秒、H.264/AAC 合成导出等。
- 流程数据的唯一来源是 `src/flow/workflow.ts`；节点详情、阶段导航和导出 JSON 都由同一份数据生成。
- **原始流程只读，编辑副本可改**：默认展示原始流程（不可拖动、不可修改）；切换到「编辑副本」后可拖动节点、编辑标题 / 说明 / 输入输出端口、新增和删除节点、从端口拉线连接，修改自动保存在浏览器本地（localStorage），随时可「重置副本」恢复原始流程。原始版本永远不会被修改。
- 节点卡保持轻量，只显示输入 / 输出端口数量；每条连线用 `EdgeLabelRenderer` 在连线上直接标注传递的数据（如 `sourceVideo`、`候选切点`、`可用资产包`），左右圆点为真实 Handle 端口，悬停可看端口名。
- 点击节点查看完整 I/O 清单（`IN 01 / OUT 01` 逐项列出）、执行动作、验收标准和关联工具。
- 「打开工作台」默认跳转到同一主机的 `:5197/studio/`，即现有 AI 影视工作流主站。

## 技术栈

React 19、TypeScript、Vite、[@xyflow/react](https://reactflow.dev/)（React Flow 12.12.0）。

画布直接使用 React Flow 官方组件：`ReactFlow`、`Handle`、`Background`、`Controls`、`MiniMap`、`BaseEdge`、`EdgeLabelRenderer`、`getBezierPath`、`useNodesState`、`useEdgesState`。节点卡、端口标签和流程数据是业务层自定义内容，这是 React Flow 自定义节点的标准用法；没有另写画布引擎。
