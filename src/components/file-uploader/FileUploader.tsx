import { useRef, useState, type ChangeEvent, type CSSProperties, type DragEvent, type KeyboardEvent, type ClipboardEvent, type MouseEvent } from 'react';
import { Button } from '../ui/Button';
import { readableForeground, useDarlTheme } from '../../theme/DarlUIProvider';
import { useUploader } from './useUploader';
import type { FileUploaderProps, UploadStatus } from './types';

function Icon({ name, size = 20 }: { name: 'upload' | 'file' | 'image' | 'video' | 'music' | 'x' | 'check' | 'retry' | 'cancel' | 'alert' | 'trash'; size?: number }) {
  const common = { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true as const };
  const path = {
    upload: <><path d="M12 16V4m-5 5 5-5 5 5"/><path d="M4 16v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3"/></>,
    file: <><path d="M6 2h8l5 5v13a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z"/><path d="M14 2v5h5"/></>,
    image: <><rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/></>,
    video: <><rect x="3" y="4" width="18" height="16" rx="3"/><path d="m10 8 6 4-6 4z"/></>,
    music: <><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></>,
    x: <path d="M5 5 19 19M19 5 5 19"/>,
    check: <path d="m5 12 5 5L20 7"/>,
    retry: <><path d="M20 7v5h-5"/><path d="M4.5 17A8 8 0 0 0 19 12l1-1M4 12l.5-1A8 8 0 0 1 19 7"/></>,
    cancel: <><circle cx="12" cy="12" r="9"/><path d="M8 8 16 16M16 8 8 16"/></>,
    alert: <><circle cx="12" cy="12" r="9"/><path d="M12 7v6M12 17h.01"/></>,
    trash: <><path d="M3 6h18M8 6V4h8v2M6 6l1 15h10l1-15M10 10v7M14 10v7"/></>
  };
  return <svg {...common}>{path[name]}</svg>;
}
function readableBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
}
const stateLabel: Record<UploadStatus, string> = { queued: '等待上传', uploading: '正在上传', success: '上传完成', error: '上传失败', canceled: '已取消' };

export function FileUploader<T = unknown>(props: FileUploaderProps<T>) {
  const {
    multiple = true, pasteEnabled = true, dragEnabled = true, accept = [], maxFileSizeMB,
    maxFiles, concurrency = 3, autoUpload = true, showPreview = true,
    showProgress = true, disabled = false, accentColor, className = ''
  } = props;
  const hasProvider = Boolean(useDarlTheme());
  const fileInput = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [rejections, setRejections] = useState<string[]>([]);
  const uploader = useUploader({ ...props, multiple, accept, maxFileSizeMB, maxFiles, concurrency, autoUpload, showPreview, onReject: (items) => {
    setRejections(items.map((i) => i.reason));
    props.onReject?.(items);
  }});
  const add = (files: File[] | FileList | null) => {
    setRejections([]);
    uploader.addFiles(files);
  };
  const onInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    add(event.currentTarget.files);
    event.currentTarget.value = ''; // Selecting the same file again must trigger onChange.
  };
  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault(); // Do not let the browser navigate to a dropped local file.
    if (!dragEnabled || disabled) return;
    setIsDragging(false);
    add(event.dataTransfer.files);
  };
  const onPaste = (event: ClipboardEvent<HTMLDivElement>) => {
    if (!pasteEnabled || disabled) return;
    const files = Array.from(event.clipboardData.items).filter((item) => item.kind === 'file')
      .map((item) => item.getAsFile()).filter((file): file is File => file !== null);
    if (files.length === 0) return; // Never swallow normal text paste.
    event.preventDefault();
    add(files);
  };
  const onAreaClick = (event: MouseEvent<HTMLDivElement>) => {
    if (disabled || (event.target as HTMLElement).closest('button')) return;
    fileInput.current?.click();
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (disabled || event.target !== event.currentTarget) return;
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault(); fileInput.current?.click();
    }
  };
  const hasQueued = uploader.items.some((i) => i.status === 'queued');
  const hasActive = uploader.items.some((i) => i.status === 'uploading');
  const successCount = uploader.items.filter((i) => i.status === 'success').length;
  const displayHint = [maxFileSizeMB ? `单文件 ≤ ${maxFileSizeMB} MB` : null, maxFiles ? `最多 ${maxFiles} 个` : null].filter(Boolean).join(' · ');
  const style = accentColor ? { '--darl-primary': accentColor, '--darl-primary-foreground': readableForeground(accentColor) } as CSSProperties : undefined;
  return <section className={`darl-uploader ${hasProvider ? '' : 'darl-uploader--standalone'} ${className}`} style={style} aria-label="文件上传">
    <input ref={fileInput} className="darl-visually-hidden" aria-label="选择上传文件" tabIndex={-1}
      type="file" accept={accept.length ? accept.join(',') : undefined} multiple={multiple} disabled={disabled} onChange={onInputChange} />
    <div
      className={`darl-dropzone ${isDragging ? 'darl-dropzone--dragging' : ''} ${disabled ? 'darl-dropzone--disabled' : ''}`}
      role="button" tabIndex={disabled ? -1 : 0} aria-disabled={disabled}
      aria-label="文件上传区域，按回车选择文件，可拖拽或粘贴"
      onKeyDown={onKeyDown} onPaste={onPaste} onClick={onAreaClick}
      onDragEnter={(event) => { if (!dragEnabled || disabled) return; event.preventDefault(); setIsDragging(true); }}
      onDragOver={(event) => { event.preventDefault(); if (dragEnabled && !disabled) event.dataTransfer.dropEffect = 'copy'; }}
      onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setIsDragging(false); }}
      onDrop={onDrop}
    >
      <div className="darl-upload-emblem"><Icon name="upload" size={27} /></div>
      <h3>{isDragging ? '松开鼠标添加文件' : '拖拽文件到这里，或点击选择'}</h3>
      <p>{pasteEnabled ? '支持 Ctrl+V / Cmd+V 粘贴图片或文件' : '支持批量选择和拖拽上传'}</p>
      <Button disabled={disabled} onClick={() => fileInput.current?.click()}>选择文件</Button>
      {displayHint && <div className="darl-upload-hint">{displayHint}</div>}
    </div>
    {!!rejections.length && <div className="darl-rejections" role="alert"><Icon name="alert" size={17}/><div>{rejections.slice(0, 3).map((message, index) => <div key={index}>{message}</div>)}{rejections.length > 3 && <div>另外 {rejections.length - 3} 个文件被拒绝</div>}</div><button className="darl-icon-button" aria-label="关闭错误提示" onClick={() => setRejections([])}><Icon name="x" size={15}/></button></div>}
    {!!uploader.items.length && <div className="darl-file-list">
      <div className="darl-file-list-header"><div><strong>文件列表</strong><span className="darl-file-summary">{uploader.items.length} 个文件 · {successCount} 个完成</span></div><div className="darl-file-actions">{!autoUpload && <Button variant="outline" size="sm" onClick={uploader.startAll} disabled={disabled || !hasQueued}>开始上传</Button>}<Button variant="ghost" size="sm" onClick={uploader.clear} disabled={disabled || (!uploader.items.length && !hasActive)}><Icon name="trash" size={15}/>清空</Button></div></div>
      <ul className="darl-upload-items" aria-live="polite">{uploader.items.map((item) => <li className="darl-upload-item" key={item.id}>
        <div className="darl-file-thumbnail">{item.previewUrl && showPreview ? <img src={item.previewUrl} alt="文件预览" /> : <Icon name={item.file.type.startsWith('video/') ? 'video' : item.file.type.startsWith('audio/') ? 'music' : item.file.type.startsWith('image/') ? 'image' : 'file'} size={22}/>}</div>
        <div className="darl-file-content"><div className="darl-file-title" title={item.file.name}>{item.file.name}</div><div className="darl-file-meta"><span>{readableBytes(item.file.size)}</span><span aria-label={`状态：${stateLabel[item.status]}`} className={`darl-status darl-status--${item.status}`}>{stateLabel[item.status]}{item.status === 'uploading' && item.progress !== null ? ` ${Math.round(item.progress)}%` : ''}</span></div>
          {item.error && <div className="darl-file-error" title={item.error}>{item.error}</div>}
          {showProgress && item.status === 'uploading' && <div className={`darl-progress ${item.progress === null ? 'darl-progress--unknown' : ''}`} role="progressbar" aria-label={`${item.file.name} 上传进度`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={item.progress ?? undefined}><div style={{ width: item.progress === null ? '35%' : `${item.progress}%` }} /></div>}
        </div>
        <div className="darl-upload-item-actions">{(item.status === 'error' || item.status === 'canceled') && <button className="darl-icon-button" onClick={() => uploader.retry(item.id)} disabled={disabled} title="重试" aria-label={`重试 ${item.file.name}`}><Icon name="retry" size={18}/></button>}{(item.status === 'queued' || item.status === 'uploading') && <button className="darl-icon-button" onClick={() => uploader.cancel(item.id)} disabled={disabled} title="取消" aria-label={`取消 ${item.file.name}`}><Icon name="cancel" size={18}/></button>}{item.status === 'success' && <span className="darl-upload-check"><Icon name="check" size={18}/></span>}<button className="darl-icon-button" onClick={() => uploader.remove(item.id)} disabled={disabled} title="移除" aria-label={`移除 ${item.file.name}`}><Icon name="x" size={18}/></button></div>
      </li>)}</ul>
    </div>}
  </section>;
}
