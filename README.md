# darl-ui v0.1

**跨 React 项目复用的轻量级高级功能组件库**。第一版包含 `FileUploader`、`DarlUIProvider` 和完整的演示网站。

## 原则

- 以 **shadcn/ui 的 Button 与 CSS 变量设计**为基础（内置的 Button 是为了组件库独立分发而做的轻量移植）。
- 没有引入 Uppy、react-dropzone 或任何额外的 UI 组件库。
- 除了 `react` / `react-dom` 两个 peer dependency，组件库打包产物不要求使用方配置 Tailwind。
- 上传由业务项目提供，组件自身不管理远程存储、鉴权或业务数据。
- 演示站使用模拟上传，不会发送用户选择的文件至服务器。

> 注意：内置 Button 是 **shadcn/ui Button 交互与变体模式的适配实现**，不是通过官方 CLI 原样安装的全套 shadcn/ui 组件。保留轻量样式是为了在不同 React 项目中无需 Tailwind 配置即可使用。

## 安装、预览

需要 Node.js >= 20.19。联网环境中：

```bash
npm install
npm run dev
```

浏览器打开 `http://localhost:5173`。

构建完整项目：

```bash
npm run typecheck
npm run test
npm run build
```

- 组件库输出：`dist/lib`（ESM、CJS、`.d.ts` 和 CSS）
- 演示网站输出：`dist/demo`（静态站点，可部署到 Cloudflare Pages / Vercel）

本地安装到其他 React 网站：

```bash
npm run pack:local
# 复制 .tgz 到目标项目
npm install ./darl-ui-0.1.0.tgz
```

## 使用

```tsx
import { DarlUIProvider, FileUploader } from '@darl/ui';
import '@darl/ui/styles.css';

function MyUpload() {
  return (
    <DarlUIProvider theme={{ mode: 'light', primaryColor: '#7c3aed', radius: 10 }}>
      <FileUploader
        multiple
        pasteEnabled
        dragEnabled
        accept={['image/*', 'video/mp4', '.pdf']}
        maxFileSizeMB={100}
        maxFiles={20}
        concurrency={3}
        autoUpload={false}
        upload={async (file, { signal, onProgress }) => {
          // Example only. Fetch does NOT provide browser upload progress.
          // If progress matters, use XMLHttpRequest with xhr.upload.onprogress.
          const form = new FormData();
          form.append('file', file);
          const res = await fetch('/api/upload', { method: 'POST', body: form, signal });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          onProgress(100);
          return res.json() as Promise<{ id: string; url: string }>;
        }}
        onSuccess={(file, result) => console.log(file.name, result)}
        onError={(file, error) => console.error(file.name, error)}
        onReject={(files) => console.warn(files.map((x) => x.reason))}
      />
    </DarlUIProvider>
  );
}
```

### FileUploader API

| Prop | 类型 | 默认值 |
| --- | --- | --- |
| `upload` | `(file, {signal,onProgress}) => Promise<T>` | 必填 |
| `multiple` | `boolean` | `true` |
| `pasteEnabled` | `boolean` | `true` |
| `dragEnabled` | `boolean` | `true` |
| `accept` | `string[]`（MIME、通配符和扩展名） | `[]` |
| `maxFileSizeMB` | `number` | 不限制 |
| `maxFiles` | `number` | 不限制 |
| `concurrency` | `number` | `3` |
| `autoUpload` | `boolean` | `true` |
| `showPreview` | `boolean` | `true` |
| `showProgress` | `boolean` | `true` |
| `disabled` | `boolean` | `false` |
| `accentColor` | `string` | 跟随主题 |
| `onSuccess` | `(file, result) => void` | 可选 |
| `onError` | `(file, error) => void` | 可选 |
| `onReject` | `(rejectedFiles) => void` | 可选 |
| `onChange` | `(items) => void` | 可选 |

### 交互定义

- 点击选择文件、拖入文件、在聚焦上传区域后按 Ctrl+V / Cmd+V 粘贴。
- 在其他输入框粘贴文本不会被文件组件拦截。
- 类型、大小限制按文件分别校验；部分文件无效不影响其他文件。
- 重复文件以 `name + size + MIME + lastModified` 作为近似判重依据。
- `multiple=false` 时上限为 1，已选的文件先移除才能添加新文件。
- `autoUpload=false` 时，需要点击「开始上传」；失败后的「重试」则立即安排上传。
- 单文件独立进度、失败重试、主动取消、移除及清空。
- 取消通过 `AbortSignal` 传入业务上传适配器，**业务适配器必须支持 abort** 才能真正取消网络传输。
- 进度只有由上传适配器明确报告时才显示百分比，否则显示不确定进度动画。
- 使用 `URL.createObjectURL` 创建图片缩略图；移除、清空和卸载时释放 URL。
- `maxFiles` 按列表内所有状态（含已完成）计数，上传新文件前可以移除旧记录。
- 通过 `onSuccess` 返回后端原始业务对象，组件不会擅自转换成素材 ID 或 URL。

## 主题

```tsx
<DarlUIProvider theme={{ mode: 'dark', primaryColor: '#059669', radius: 8 }}>
  <FileUploader upload={uploadToServer} />
</DarlUIProvider>
```

`mode` 可选 `light | dark | system`。`accentColor` 可覆盖单个文件上传组件的主色。

## 演示网站

`playground` 包含：介绍页、主题色配置、FileUploader 参数调试、模拟成功和失败、实时 JSX 代码、事件日志。演示站和组件库在同一个仓库中，但分别构建。

## 后续再考虑

分片上传、断点续传、文件夹上传、图片编辑、外部存储管理、组件 Registry、完整基础组件集合。v0.1 **不实现**。

## 安全说明

前端 `accept`、大小和数量限制仅用于用户体验。实际项目服务端必须独立验证文件内容、文件大小、权限、存储目标和文件扩展名。不要信任浏览器传入的 MIME 类型。

## 发布说明

`package.json` 使用 `"private": true`，防止误发布。确认包名和私有发布目标后才修改此项。源代码托管于 https://github.com/twodogegg/darl-ui 。
