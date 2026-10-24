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
    id: 'video-a', logicalModelId: 'video-generation', bindingId: 'video-darl', providerId: 'darl', protocolKey: 'darl-runninghub-h3-flash', name: '视频模型 A', type: 'video',
    capabilities: {
      images: 30, videos: 2, audios: 1, generationModes: ['text-to-video', 'first-last-frame', 'reference'], firstLastFrame: true,
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

单用户本地宿主可以直接使用 Agent Chat 的 SQLite API 持久化任务：读取 `GET /api/media-tasks`，生成、重试、取消或收藏后把完整任务数组提交到 `POST /api/media-tasks` 的 `{ tasks }` 字段。组件本身仍保持受控，不直接打开数据库。

## Props

| 参数 | 类型 / 行为 |
| --- | --- |
| `models` | `MediaModel[]`，必填；可动态更新 |
| `tasks` | `MediaTask[]`，必填；组件只展示数据 |
| `styles` | `MediaStyleOption[]`，可选；提供后输入区出现「风格」选择器，选择结果通过 `GenerateRequest.style` 交给宿主 |
| `onCreateStyle` | `(request: StyleCreateRequest) => void \| Promise<void>`；提供后可在风格弹窗内创建风格，失败保留表单 |
| `onUpdateStyle` | `(style, request: StyleCreateRequest) => void \| Promise<void>`；编辑自己的风格，保存成功后宿主刷新 `styles` |
| `onOptimizePrompt` | `(request: PromptOptimizationRequest, { signal }) => Promise<string>`；按当前模型及参数优化并回填文本，失败保留原文 |
| `routingStrategy` | `'selected-binding' | 'auto'`；默认选择当前模型绑定，`auto` 交给宿主按逻辑模型路由 |
| `activeTaskId` | 可选受控任务 ID；不传时组件内部维护选择，默认第一项 |
| `onTaskChange` | `(taskId) => void`，切换任务通知 |
| `onCreateTask` | `() => void`；不传时隐藏新建入口 |
| `onRenameTask` | `(taskId, title) => void`；不传时隐藏重命名入口 |
| `onDeleteTask` | `(taskId) => void \| Promise<void>`；提供后任务项显示删除入口，删除确认由组件处理 |
| `onGenerate` | `(request: GenerateRequest) => void \| Promise<void>`，必填 |
| `onRetry` | `(batchId, resultId) => void`；仅失败结果显示重试 |
| `onCancel` | `(batchId, resultId) => void`；仅等待 / 运行结果显示取消 |
| `onRegenerate` | `(batchId, resultId) => void`；重新生成当前这一张，宿主使用原批次快照发起一个结果的生成 |
| `onFavoriteChange` | `(batchId, resultId, favorited) => void`；收藏 / 取消收藏，宿主回写结果的 `favorited` 字段 |
| `accentColor` | 可选单组件主色覆盖 |
| `className` | 可覆盖高度等布局；桌面端随视口在 760–1200px 间扩展，手机端限高 820px |

只新增 `MediaWorkspace` 公共组件；模型、任务、请求等 TypeScript 类型从包入口导出。内部模块不是公共 API。

## 能力和默认值

图片模型只提供通用能力和 `images`；需要编辑能力时声明 `generationModes: ['text-to-image', 'reference-edit']`。视频模型另支持 `videos`、`audios`、`generationModes`、`firstLastFrame`、`durations`、`generateAudio`。模型可附带 `logicalModelId`、`bindingId`、`providerId`、`upstreamModelId` 和 `protocolKey`，组件会在提交事件中原样交给宿主路由。未配置、`0` 或 `false` 表示不提供相应功能。

- `maxOutputs` 缺省为 1，控制供应商单次请求可返回的结果数；只有大于 1 时显示「单次输出」。请求始终带 `count`。
- 「生成数量」是独立的宿主调用次数（1–4，默认 1），通过 `generationCount` 传给 `onGenerate`。它不改变 `options.count`，也不能被映射成供应商的 `n` 参数；宿主必须创建多个独立任务，并可在结果区按独立批次展示。
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
  generationCount?: number;
  logicalModelId?: string;
  bindingId?: string;
  providerId?: string;
  upstreamModelId?: string;
  protocolKey?: string;
  route?: {
    strategy: 'selected-binding' | 'auto';
    bindingId?: string;
    providerId?: string;
  };
  mode?: 'text-to-image' | 'reference-edit' | 'text-to-video' | 'first-last-frame' | 'reference';
  style?: { id: string; name: string; description?: string; category?: string };
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

`mode` 由当前模型能力、输入方式和素材角色自动规范化：无参考图时使用文生图 / 文生视频，有图片编辑素材时使用 `reference-edit` / `reference`，选择首尾帧时使用 `first-last-frame`。有绑定元数据时，默认 `route.strategy` 为 `selected-binding`；传入 `routingStrategy="auto"` 后交给宿主按逻辑模型选择渠道。宿主仍负责凭据、上传、协议适配、轮询和错误映射，组件不会拼接供应商原生请求体。

宿主通过 `styles` 提供风格时，输入区出现「风格」按钮；确认选择后 `GenerateRequest.style` 携带 `{ id, name, description?, category? }`，宿主自行决定如何把风格注入提示词或模型参数。风格列表必须带 `isOwned`，否则自己创建的风格既进不了「我的风格」，还会漏进「风格广场」。传入 `onCreateStyle` 后可直接在弹窗内创建风格，保存成功后由宿主更新 `styles`。创建入口在「我的风格」卡片；`onUpdateStyle` 提供自有风格的编辑与异步保存。

`onGenerate` 只在提示词非空、任务与模型存在且参考数量合法时触发。等待提交 Promise 期间禁止重复提交；抛错显示在输入区，保留草稿方便重试。长期运行状态由宿主更新，不用提交 Promise 模拟轮询。

传入 `onOptimizePrompt` 后显示「提示词优化」。`PromptOptimizationRequest` 包含生成请求（不含 `taskId`）、完整当前 `model` 和 `optimization: 'general' | 'h3'`。H3 视频通过模型 ID、上游 ID、协议键或名称中的 H3 标识提供普通 / H3 优化选择，其余模型直接普通优化。回调返回的文本填回输入框，成功后可通过「优化对比」查看最近一次优化前后文本，「还原优化」恢复本次优化前的完整原文（含空白）。连续优化仅保留最近一次对比，切换任务或模型后清除对比；失败、取消或上下文变化不覆盖原文；宿主需将 `signal` 传给真实请求。组件不自带模型凭据或优化模板。

Agent Chat 的媒体请求将参考图片统一写入 `options.references`，生成、重试和历史复用共享同一提交入口；H3 适配器使用渠道绑定中的真实上游模型 ID。H3 接口约定见[创建任务](https://fwr0187eq6.apifox.cn/523019890e0)和[查询任务](https://fwr0187eq6.apifox.cn/523019892e0)。

Agent Chat 的真实演示位于 `http://localhost:5197` 的「媒体生成」。宿主通过 `/api/prompt-optimization` 调用设置中选择的文本模型，将当前生成模型、模式、参数、风格和参考素材元数据作为 JSON 传给模型；H3 优化还会读取站内参考图片并作为图片输入一并发送，没有可读取的参考图时明确报错。普通与 H3 模板位于 `examples/agent-chat/prompts/optimize-prompt.md` 和 `optimize-h3-prompt.md`，可在「设置 → 提示词」覆盖并存入 SQLite；执行模型在「设置 → 模型」中分别配置；H3 优化会直接使用已提供的参考图片，不按文本模型的视觉能力开关过滤。

## 批次和结果

`MediaTask` 含 `id`、`title`、`batches`。批次含 `id`、`modelId`、`prompt`、`options`、`results`，另可保存：

- `createdAt?: string`：批次 ISO 时间。所有批次都带有效时间时，结果区按时间从早到晚展示；未提供时沿用 `batches` 原顺序。
- `type?: 'image' | 'video'`：建议保存，以便历史模型从配置中删除后仍可播放结果。
- `logicalModelId?`、`bindingId?`、`providerId?`、`upstreamModelId?`、`protocolKey?`、`route?`、`mode?`：建议保存，使历史批次能够复用原始逻辑模型和渠道路由。
- `style?: MediaStyleOption`：建议保存，复用时恢复当时的风格选择。
- `references?: MediaReferences`：历史复用时恢复素材；结果区会展示参考图片、视频、音频及首尾帧缩略图。缺省恢复为空。跨会话保存前应由宿主将本地文件转成远程素材对象。

批次长提示词可展开查看完整内容（含换行），并可收起。结果含 `id`、`status`、可选 `url`、`error`、`progress?: number` 和 `favorited?: boolean`。`progress` 为宿主提供的真实百分比（0–100），省略时不展示推算的百分比。Agent Chat 将 H3 查询接口的进度保存并传到生成卡片，兼容 `completed` / `succeeded` 和 `in_progress` / `processing` 状态。状态为 `queued | running | completed | failed | cancelled`。每次生成由宿主追加批次；结果较多、记录区产生滚动时，显示粘附的顶部 / 底部跳转按钮。结果失败互不影响。

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

组件自身不提供真实模型 API、持久化、上传服务、蒙版编辑、节点画布或视频剪辑；提示词优化通过宿主回调执行。工作台结果支持通过公共 `VideoCompare` 选择最多 3 个图片 / 视频进行对比；全部为视频时使用同步播放能力。

基础 Button 沿用仓库的 shadcn/ui 本地适配；弹出面板、对话框采用 shadcn/ui 的 Radix 组合模式，通过 Radix 处理 Escape、焦点和键盘交互，样式适配独立 CSS 分发。相关实现是本地适配，不是官方 CLI 原样安装的组件。

上游资料：[shadcn/ui Popover](https://ui.shadcn.com/docs/components/radix/popover)、[Dialog](https://ui.shadcn.com/docs/components/radix/dialog)、[MIT 许可](https://github.com/shadcn-ui/ui/blob/main/LICENSE.md)。Radix 依赖保留各自 npm 包内许可证。
