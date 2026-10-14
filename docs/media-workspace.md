# MediaWorkspace

可嵌入 React 网站的图片 / 视频生成工作台。采用参考 HTML 中的任务栏、按批次结果区和底部紧凑输入区；手机端将任务列表改为横向滚动。组件支持 `DarlUIProvider` 深浅主题、品牌色及 `accentColor` 单组件覆盖。

## 接入

```tsx
import { useState } from 'react';
import {
  DarlUIProvider, MediaWorkspace,
  type GenerateRequest, type MediaModel, type MediaTask,
} from '@darl/ui';
import '@darl/ui/styles.css';

const models: MediaModel[] = [
  {
    id: 'image-a', name: '图片模型 A', type: 'image',
    capabilities: {
      images: 10, aspectRatios: ['1:1', '9:16', '16:9'],
      resolutions: ['1K', '2K'], maxOutputs: 4,
    },
    defaults: { aspectRatio: '9:16', resolution: '2K', count: 2 },
  },
  {
    id: 'video-a', name: '视频模型 A', type: 'video',
    capabilities: {
      images: 30, videos: 2, audios: 1, firstLastFrame: true,
      aspectRatios: ['16:9', '9:16'], resolutions: ['720p', '1080p'],
      durations: { min: 4, max: 15 }, generateAudio: true, maxOutputs: 4,
    },
    defaults: { aspectRatio: '9:16', resolution: '1080p', duration: 10, generateAudio: true },
  },
];

export function Studio({ startGeneration }: {
  startGeneration: (request: GenerateRequest) => Promise<void>;
}) {
  const [tasks, setTasks] = useState<MediaTask[]>([]);
  const [activeTaskId, setActiveTaskId] = useState<string>();
  return (
    <DarlUIProvider theme={{ mode: 'dark', primaryColor: '#7c86ff' }}>
      <MediaWorkspace
        models={models} tasks={tasks} activeTaskId={activeTaskId}
        onTaskChange={setActiveTaskId}
        onCreateTask={() => {
          const task = { id: crypto.randomUUID(), title: '未命名任务', batches: [] };
          setTasks((current) => [...current, task]);
          setActiveTaskId(task.id);
        }}
        onRenameTask={(id, title) => setTasks((current) =>
          current.map((task) => task.id === id ? { ...task, title } : task)
        )}
        onGenerate={startGeneration}
      />
    </DarlUIProvider>
  );
}
```

示例能力由宿主定义，不代表真实模型的官方能力。宿主在发起请求时追加批次、创建等待中的结果，并通过更新 `tasks` 回传状态；`startGeneration` 应在提交被接受后返回，不需要等待生成完成。

## Props

| 参数 | 类型 / 行为 |
| --- | --- |
| `models` | `MediaModel[]`，必填；可动态更新 |
| `tasks` | `MediaTask[]`，必填；组件只展示数据 |
| `activeTaskId` | 可选受控任务 ID；不传时组件内部维护选择，默认第一项 |
| `onTaskChange` | `(taskId) => void`，切换任务通知 |
| `onCreateTask` | `() => void`；不传时隐藏新建入口 |
| `onRenameTask` | `(taskId, title) => void`；不传时隐藏重命名入口 |
| `onGenerate` | `(request: GenerateRequest) => void \| Promise<void>`，必填 |
| `onRetry` | `(batchId, resultId) => void`；仅失败结果显示重试 |
| `onCancel` | `(batchId, resultId) => void`；仅等待 / 运行结果显示取消 |
| `onRegenerate` | `(batchId, resultId) => void`；重新生成当前这一张，宿主使用原批次快照发起一个结果的生成 |
| `onFavoriteChange` | `(batchId, resultId, favorited) => void`；收藏 / 取消收藏，宿主回写结果的 `favorited` 字段 |
| `accentColor` | 可选单组件主色覆盖 |
| `className` | 可覆盖高度等布局；默认高度 760px，手机端 820px |

只新增 `MediaWorkspace` 公共组件；模型、任务、请求等 TypeScript 类型从包入口导出。内部模块不是公共 API。

## 能力和默认值

图片模型只提供通用能力和 `images`；视频模型另支持 `videos`、`audios`、`firstLastFrame`、`durations`、`generateAudio`。未配置、`0` 或 `false` 表示不提供相应功能。

- `maxOutputs` 缺省为 1。只有大于 1 时显示数量选择；请求始终带 `count`。
- 比例、分辨率和时长候选为空时隐藏控件，提交不带相应字段。
- 固定时长使用数组；范围使用 `{ min, max }`，整数秒可选。
- 默认值必须在能力范围内；无效值回退到首个候选，数量限制在有效范围内。
- 首次选择、切换模型或切换生成类型应用推荐默认值。相同模型配置被宿主重新创建时不重置用户修改。
- 复用历史批次采用该批参数，已不受模型支持的字段被过滤或回退到有效候选。
- `generateAudio: true` 表示可切换声音；缺省不传声音字段，不能据此推断实际结果是否有声。

## 输入和请求

一个提示词输入框用于所有创作，不提供文生图 / 图生图 / 编辑的独立模式。输入区顶部先选择生成类型：图片或视频，默认图片；模型列表只显示当前类型的模型，不会把图片模型和视频模型混在一起。切换类型时应用该类型首个模型的推荐默认值，宿主只提供单一类型时隐藏该选择。参考素材和首尾帧草稿在切换类型时保留，仍受新模型能力约束。点击「素材」、拖拽或粘贴图片添加参考；普通文本粘贴不被拦截。支持首尾帧的视频模型默认显示首帧、尾帧两个位置，可只填首帧、只填尾帧或两者都填。每个位置最多一张图，可点击选择、拖入对应位置、替换或移除；无效文件不会覆盖已有帧。

同时支持普通参考素材的模型提供紧凑的「素材方式」选择：普通参考素材与首尾帧分别显示和提交。首尾帧方式只显示两个帧位，不出现额外参考图缩略图，也不携带 `images/videos/audios`；普通参考方式不携带 `firstFrame/lastFrame`。切换方式保留各自草稿，历史复用根据快照恢复方式。

`MediaInput` 为 `File | { id: string; url: string }`。本地文件仅作为 `File` 交给宿主，组件不上传。普通参考文件复用 FileUploader 的内部队列、类型校验、判重和 Blob URL 清理能力；移除、历史复用和卸载均释放本地缩略图 URL。

切换模型保留素材草稿；不支持的素材显示为保留状态，不发送给宿主。仍受支持的类别超出新模型上限时提示并禁止生成。只校验当前素材方式的数量；首尾帧方式每个位置最多一张。模型配置和前端校验不能替代服务端校验。

```ts
type GenerateRequest = {
  taskId: string;
  modelId: string;
  prompt: string;
  references?: {
    images?: MediaInput[]; videos?: MediaInput[]; audios?: MediaInput[];
    firstFrame?: MediaInput; lastFrame?: MediaInput;
  };
  options: {
    count: number; aspectRatio?: string; resolution?: string;
    duration?: number; generateAudio?: boolean;
  };
};
```

`onGenerate` 只在提示词非空、任务与模型存在且参考数量合法时触发。等待提交 Promise 期间禁止重复提交；抛错显示在输入区，保留草稿方便重试。长期运行状态由宿主更新，不用提交 Promise 模拟轮询。

## 批次和结果

`MediaTask` 含 `id`、`title`、`batches`。批次含 `id`、`modelId`、`prompt`、`options`、`results`，另可保存：

- `type?: 'image' | 'video'`：建议保存，以便历史模型从配置中删除后仍可播放结果。
- `references?: MediaReferences`：历史复用时恢复素材；缺省恢复为空。跨会话保存前应由宿主将本地文件转成远程素材对象。

结果含 `id`、`status`、可选 `url`、`error` 和 `favorited?: boolean`。状态为 `queued | running | completed | failed | cancelled`。每次生成由宿主追加批次，组件按 `batches` 原顺序展示；结果失败互不影响。

成功结果支持图片 / 视频预览、下载，图片和视频结果都可用作参考，并支持重新生成及收藏 / 取消收藏。点击「用作参考」只加入当前输入区的参考素材，不带回结果批次的提示词或其他生成参数；如果当前模型不支持该素材类型，组件会切换到第一个支持该类型的模型，但保留当前提示词和参数草稿。重新生成、收藏按钮仅在配置相应回调时出现。重新生成按参考 HTML 重跑当前结果，不把当前输入区的模型、提示词或数量作为该结果的原始参数；宿主负责更新该结果的等待、运行、完成、失败状态。收藏不发起生成请求，状态由宿主传入 `result.favorited` 控制，不在组件内持久化。浏览器原生视频控件不会自动有声播放；媒体加载失败、完成但无地址均给出提示。

下载使用宿主提供的 URL。跨域下载是否直接保存由浏览器和服务器的 `Content-Disposition` 决定；宿主应提供可下载地址。组件不会获取、存储或转换远程资源。

## Playground 与验证

打开 `/#media-workspace` 或点击演示站 `MediaWorkspace` 入口。

- 「创作工作室」提供两个图片模型、两个视频模型；可切换 30 张参考图 + 视频 / 音频模型和仅参考图片模型。
- 「品牌宣传」是另一宿主，传入不同模型列表和任务，验证相同组件复用。
- 可新建 / 切换 / 重命名任务，连续添加批次；模拟等待、运行、完成、失败、重试、取消、逐个重新生成、收藏及提交失败。
- 「查看最近提交请求」用于核对能力过滤后的字段；模拟器不读取、上传本地素材。
- 示例图片沿用用户提供 HTML 的本地 SVG 示例，视频为本地合成示意短片；返回示例媒体，非真实 AI 生成，不模拟真实模型画面、时长、分辨率或声音能力。

组件交互测试覆盖默认值、生成类型与模型过滤、参数与素材过滤、超限保留、URL 释放、历史回填、混合批次、宿主回调、重新生成与收藏、首尾帧与普通素材互斥、重复提交和失败、文本 / 图片粘贴与空数据。

## 实现边界与归属

无真实模型 API、持久化、上传服务、蒙版编辑、优化提示词、节点画布或视频剪辑。工作台内视频对比作为后续增强；现有 `VideoCompare` 可单独接入。

基础 Button 沿用仓库的 shadcn/ui 本地适配；弹出面板、对话框采用 shadcn/ui 的 Radix 组合模式，通过 Radix 处理 Escape、焦点和键盘交互，样式适配独立 CSS 分发。相关实现是本地适配，不是官方 CLI 原样安装的组件。

上游资料：[shadcn/ui Popover](https://ui.shadcn.com/docs/components/radix/popover)、[Dialog](https://ui.shadcn.com/docs/components/radix/dialog)、[MIT 许可](https://github.com/shadcn-ui/ui/blob/main/LICENSE.md)。Radix 依赖保留各自 npm 包内许可证。
