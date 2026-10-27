/** 资产分区：生成历史 / 我保存的 / 我上传的。 */
export type AssetSection = 'generated' | 'saved' | 'uploaded';
/** 资产类型，决定卡片预览方式与默认分类。 */
export type AssetKind = 'image' | 'video' | 'audio' | 'effect' | 'text' | 'other';
/** 资产来源，用于「生成历史」分区过滤。 */
export type AssetSource = 'generated' | 'saved' | 'uploaded';
/** 生成历史分区的项目范围。 */
export type AssetScope = 'project' | 'all';
/** 生成历史分区的类型筛选。 */
export type AssetKindFilter = 'all' | 'image' | 'video' | 'audio';

export interface AssetItem {
  id: string;
  name: string;
  kind: AssetKind;
  /** 归类分区；缺省时按来源推断。 */
  section?: AssetSection;
  /** 标签 ID，对应 AssetTag.id。 */
  tags?: string[];
  /** 预览地址：图片/视频封面/音频封面等。 */
  thumbnail?: string;
  /** 原始文件地址；视频、音频需要它才能播放。 */
  url?: string;
  description?: string;
  /** 时长（秒），用于视频/音频角标。 */
  duration?: number;
  size?: number;
  createdAt?: number;
  favorite?: boolean;
  /** 正在上传的本地资产：进度 0–100，期间禁用操作。 */
  uploading?: number;
  /**
   * 所属项目范围：`project` 只出现在「本项目」，`all` 同时出现在「本项目」与「全部项目」。
   * 仅生成历史分区使用；缺省按「本项目」处理。
   */
  scope?: AssetScope;
}

export interface AssetTag {
  id: string;
  label: string;
  /** 宿主自定义标签可删除；默认分区标签不可删除。 */
  removable?: boolean;
}

export interface AssetFilter {
  section: AssetSection;
  /** 标签 ID；空字符串表示「全部」。仅「我保存的 / 我上传的」分区使用。 */
  tag: string;
  query: string;
  /** 生成历史分区的项目范围，默认「project」。 */
  scope?: AssetScope;
  /** 生成历史分区的类型筛选，默认「all」。 */
  kind?: AssetKindFilter;
}

export interface AssetUploadRequest {
  file: File;
  /** 当前所在分区，宿主可据此决定是否标记为「我上传的」。 */
  section: AssetSection;
  signal: AbortSignal;
}

export interface AssetUploadContext extends AssetUploadRequest {
  /** 汇报真实上传进度（0–100），组件据此更新卡片角标。 */
  onProgress: (percent: number) => void;
}

/** 宿主实现的上传：必须通过 onProgress 汇报真实进度，成功后返回资产。 */
export type AssetUploadFn = (context: AssetUploadContext) => Promise<AssetItem>;

export interface AssetLoadMoreRequest extends AssetFilter {
  signal: AbortSignal;
}

export type AssetAction = 'rename' | 'download' | 'favorite' | 'delete';

export interface AssetRenameRequest {
  asset: AssetItem;
  name: string;
}

export interface AssetSelectRequest {
  asset: AssetItem;
  /** 双击或在选择模式、且在清单中找到可插入位置时返回 1 起算的序号。 */
  index: number;
}

export interface AssetCreateRequest {
  section: AssetSection;
  tag: string;
  query: string;
}

export interface AssetLibraryProps {
  assets: AssetItem[];
  tags?: AssetTag[];
  /** 受控分区，不传时组件内部维护。 */
  section?: AssetSection;
  onSectionChange?: (section: AssetSection) => void;
  /** 非受控时的初始分区，默认「生成历史」。 */
  defaultSection?: AssetSection;
  /** 受控选中标签，不传时组件内部维护。仅「我保存的 / 我上传的」分区显示标签行。 */
  tag?: string;
  onTagChange?: (tag: string) => void;
  /** 生成历史分区的项目范围（本项目 / 全部项目），不传时组件内部维护。 */
  scope?: AssetScope;
  onScopeChange?: (scope: AssetScope) => void;
  /** 生成历史分区右侧的筛选按钮；点击后由宿主打开高级筛选面板。 */
  onAdvancedFilter?: () => void;

  value?: string | null;
  onSelect?: (request: AssetSelectRequest) => void;
  /**
   * 选中状态变化时回调：点击卡片返回资产，切换分区/范围/类型/标签后返回 null（组件会清空选择）。
   * 便于宿主同步自己的选中状态。
   */
  onSelectionChange?: (asset: AssetItem | null) => void;
  /**
   * 底部确认按钮：选中资产后出现在面板底部右侧。
   * 支持 Promise，失败时保留弹窗并显示错误；成功后组件自动关闭弹窗。
   */
  onConfirm?: (asset: AssetItem) => void | Promise<void>;
  /** 确认按钮文案，默认「确认」。 */
  confirmText?: string;
  onFavoriteChange?: (asset: AssetItem, favorite: boolean) => void;
  onRename?: (request: AssetRenameRequest) => void | Promise<void>;
  onDelete?: (asset: AssetItem) => void | Promise<void>;
  /** 返回可下载地址；未提供时使用 asset.url。 */
  getDownloadUrl?: (asset: AssetItem) => string | Promise<string>;
  upload?: AssetUploadFn;
  accept?: string[];
  maxFileSize?: number;
  maxConcurrentUploads?: number;
  onCreate?: (request: AssetCreateRequest) => void;
  onCreateTag?: (label: string) => AssetTag | void;
  onDeleteTag?: (tag: AssetTag) => void;
  onFilterChange?: (filter: AssetFilter) => void;
  onLoadMore?: (request: AssetLoadMoreRequest) => Promise<void>;
  hasMore?: boolean;
  loading?: boolean;
  /** 每页显示数量，默认 24。 */
  pageSize?: number;
  /** 插入到 Prompt 的序号（1 起），用于详情面板复制或排序展示。 */
  insertIndex?: number;
  className?: string;
  /**
   * 弹窗模式：传入后组件渲染为固定遮罩上的模态弹窗。
   * `open` 受控，关闭按钮、Esc 与点击遮罩都会回调 `onOpenChange(false)`。
   */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** 与 `onOpenChange` 一起使用时可不传 `open`，由组件内部维护初始打开状态（默认关闭）。 */
  defaultOpen?: boolean;
  /** 标题：弹窗模式显示在面板顶部并作为无障碍名称，默认「资产库」；嵌入模式只作为无障碍名称。 */
  title?: string;
  /** 空态文本，按分区覆盖。 */
  emptyText?: Partial<Record<AssetSection, string>>;
  disabled?: boolean;
}

export const defaultSections: { id: AssetSection; label: string }[] = [
  { id: 'generated', label: '生成历史' },
  { id: 'saved', label: '我保存的' },
  { id: 'uploaded', label: '我上传的' },
];

export const defaultTags: AssetTag[] = [
  { id: 'all', label: '全部' },
  { id: 'character', label: '角色' },
  { id: 'scene', label: '场景' },
  { id: 'prop', label: '物品' },
  { id: 'style', label: '风格' },
  { id: 'effect', label: '音效' },
  { id: 'audio', label: '音频' },
  { id: 'video', label: '视频' },
];

export const kindLabels: Record<AssetKind, string> = {
  image: '图片',
  video: '视频',
  audio: '音频',
  effect: '音效',
  text: '文本',
  other: '文件',
};

/** 按扩展名推断资产类型，供拖入文件时使用。 */
export function detectKind(file: File): AssetKind {
  const type = file.type.toLowerCase();
  const ext = file.name.split('.').pop()?.toLowerCase() || '';
  if (type.startsWith('image/') || ['png', 'jpg', 'jpeg', 'webp', 'gif', 'avif', 'svg'].includes(ext)) return 'image';
  if (type.startsWith('video/') || ['mp4', 'webm', 'mov', 'mkv'].includes(ext)) return 'video';
  if (type.startsWith('audio/') || ['mp3', 'wav', 'm4a', 'aac', 'ogg', 'flac'].includes(ext)) return 'audio';
  if (['txt', 'md', 'json', 'csv'].includes(ext)) return 'text';
  return 'other';
}

export function assetSection(asset: AssetItem): AssetSection {
  return asset.section || (asset.favorite ? 'saved' : 'uploaded');
}

export function formatDuration(seconds?: number): string {
  if (!seconds || !Number.isFinite(seconds) || seconds <= 0) return '';
  const total = Math.floor(seconds);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function formatSize(bytes?: number): string {
  if (!bytes || bytes <= 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}
