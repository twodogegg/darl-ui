import { useCallback, useEffect, useId, useMemo, useRef, useState, type DragEvent, type FormEvent, type ReactNode } from 'react';
import { ContextMenu, Dialog, Tabs } from 'radix-ui';
import {
  AudioLines, Check, ChevronDown, Clock3, Download, FileText, FolderOpen, Image as ImageIcon, ImageOff,
  ListFilter, Pencil, Plus, Search, Sparkles, Star, Trash2, Upload, UploadCloud, Video, X,
} from 'lucide-react';
import { Button } from '../ui/Button';
import { cn } from '../../lib/cn';
import {
  assetSection, defaultSections, defaultTags, formatDuration, formatSize, kindLabels,
  type AssetAction, type AssetFilter, type AssetItem, type AssetKind, type AssetKindFilter,
  type AssetLibraryProps, type AssetScope, type AssetSection, type AssetTag,
} from './types';
import './asset-library.css';

const kindIcons: Record<AssetKind, ReactNode> = {
  image: <ImageIcon aria-hidden="true" />,
  video: <Video aria-hidden="true" />,
  audio: <AudioLines aria-hidden="true" />,
  effect: <AudioLines aria-hidden="true" />,
  text: <FileText aria-hidden="true" />,
  other: <FolderOpen aria-hidden="true" />,
};

const sectionIcons: Record<AssetSection, ReactNode> = {
  generated: <Clock3 aria-hidden="true" />,
  saved: <FolderOpen aria-hidden="true" />,
  uploaded: <Upload aria-hidden="true" />,
};

const defaultAccept = ['image/*', 'video/*', 'audio/*', '.txt', '.md', '.json'];

function acceptFile(file: File, accept: string[]) {
  if (!accept.length) return true;
  const type = file.type.toLowerCase();
  const name = file.name.toLowerCase();
  return accept.some((rule) => {
    const pattern = rule.trim().toLowerCase();
    if (!pattern) return true;
    if (pattern.startsWith('.')) return name.endsWith(pattern);
    if (pattern.endsWith('/*')) return type.startsWith(pattern.slice(0, -1));
    return type === pattern;
  });
}

function mediaType(kind: AssetKind) {
  return kind === 'video' ? 'video' : kind === 'audio' || kind === 'effect' ? 'audio' : null;
}

/** 资产卡片缩略图：图片加载失败时回退为类型图标，避免空破图。 */
function Thumb({ asset }: { asset: AssetItem }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [asset.thumbnail, asset.url]);
  const src = asset.thumbnail || (asset.kind === 'image' ? asset.url : undefined);
  return <span className="darl-asset-thumb">
    {src && !failed ? <img src={src} alt="" loading="lazy" onError={() => setFailed(true)} />
      : <span className="darl-asset-thumb-fallback">{kindIcons[asset.kind]}</span>}
    {asset.kind === 'video' && !asset.uploading && <span className="darl-asset-thumb-badge"><Video aria-hidden="true" />{formatDuration(asset.duration) || kindLabels.video}</span>}
    {(asset.kind === 'audio' || asset.kind === 'effect') && !asset.uploading && <span className="darl-asset-thumb-badge">{formatDuration(asset.duration) || kindLabels[asset.kind]}</span>}
  </span>;
}

export function AssetLibrary({
  assets, tags: tagProp, section: sectionProp, onSectionChange, tag: tagPropControlled, onTagChange,
  value = null, onSelect, onSelectionChange, onConfirm, confirmText = '确认', onFavoriteChange, onRename, onDelete, getDownloadUrl, upload, accept = defaultAccept,
  maxFileSize = 100 * 1024 * 1024, maxConcurrentUploads = 3, onCreate, onCreateTag, onDeleteTag, onFilterChange,
  onLoadMore, hasMore = false, loading = false, pageSize = 24, insertIndex, className = '', title = '资产库',
  scope: scopeProp, onScopeChange, onAdvancedFilter, defaultSection,
  emptyText, disabled = false, open, onOpenChange, defaultOpen = false,
}: AssetLibraryProps) {
  const id = useId();
  const titleId = `${id}-title`;
  const [innerOpen, setInnerOpen] = useState(defaultOpen);
  // 选中状态由组件维护并跟随 value 同步；切换分区/范围/类型/标签时清空。
  const [selectedId, setSelectedId] = useState<string | null>(value ?? null);
  const isOpen = open ?? innerOpen;
  useEffect(() => { setSelectedId(value ?? null); }, [value]);
  // 传了 open（或 onOpenChange）即视为弹窗模式；否则原地嵌入渲染。
  const modal = open !== undefined || onOpenChange !== undefined;
  const [innerSection, setInnerSection] = useState<AssetSection>(defaultSection ?? 'generated');
  const [innerTag, setInnerTag] = useState('all');
  const [innerScope, setInnerScope] = useState<AssetScope>('project');
  const section = sectionProp ?? innerSection;
  const tag = tagPropControlled ?? innerTag;
  const scope = scopeProp ?? innerScope;
  const [query, setQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [newTag, setNewTag] = useState('');
  const [tagCreating, setTagCreating] = useState(false);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [uploads, setUploads] = useState<{ key: string; name: string; percent: number }[]>([]);
  const [dragging, setDragging] = useState(false);
  const [visibleCount, setVisibleCount] = useState(pageSize);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadError, setLoadError] = useState('');
  // 焦点在搜索框与输入框之间移动时保持展开，移出后收起（有关键词时由输入框值继续展示）。
  const onSearchBlur = (event: React.FocusEvent<HTMLInputElement>) => {
    const next = event.relatedTarget as Node | null;
    if (next && event.currentTarget.closest('.darl-asset-search')?.contains(next)) return;
    setSearchOpen(false);
  };
  const fileInput = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const controllers = useRef(new Set<AbortController>());
  const pageCount = Number.isFinite(pageSize) ? Math.max(4, Math.floor(pageSize)) : 24;

  useEffect(() => () => { controllers.current.forEach((controller) => controller.abort()); controllers.current.clear(); }, []);

  // 生成历史分区没有标签行，改用类型筛选（复用 tag 值 all/image/video/audio）；保存/上传分区用标签。
  const isGenerated = section === 'generated';
  const kindFilter: AssetKindFilter = isGenerated ? (tag === 'all' || tag === 'image' || tag === 'video' || tag === 'audio' ? tag : 'all') : 'all';
  // 上报的 filter 必须与当前渲染状态一致，宿主把它接回 props 时不会跳变。
  const filter: AssetFilter = { section, tag: isGenerated ? kindFilter : tag === 'all' ? '' : tag, query: query.trim(), scope, kind: kindFilter };
  const filterKey = JSON.stringify([section, tag, filter.query, scope]);
  useEffect(() => { onFilterChange?.(filter); }, [filterKey]);

  // 未传 tags 时：默认标签 + 资产里出现但未登记的标签。
  const tags = useMemo<AssetTag[]>(() => {
    if (tagProp) return tagProp;
    const known = new Set(defaultTags.map((item) => item.id));
    const extra: AssetTag[] = [];
    assets.forEach((asset) => asset.tags?.forEach((key) => {
      if (known.has(key)) return;
      known.add(key);
      extra.push({ id: key, label: key, removable: true });
    }));
    return [...defaultTags, ...extra];
  }, [assets, tagProp]);

  const sections = useMemo(() => defaultSections.map((item) => {
    const count = assets.filter((asset) => assetSection(asset) === item.id).length;
    return { ...item, count };
  }), [assets]);

  // 生成历史的类型计数（受项目范围影响）。
  const kindCounts = useMemo(() => {
    const counts: Record<AssetKindFilter, number> = { all: 0, image: 0, video: 0, audio: 0 };
    assets.forEach((asset) => {
      if (assetSection(asset) !== 'generated') return;
      if (scope === 'project' && asset.scope === 'all') return;
      counts.all += 1;
      if (asset.kind === 'image') counts.image += 1;
      else if (asset.kind === 'video') counts.video += 1;
      else if (asset.kind === 'audio' || asset.kind === 'effect') counts.audio += 1;
    });
    return counts;
  }, [assets, scope]);

  const filtered = useMemo(() => {
    const search = filter.query.toLocaleLowerCase();
    return assets.filter((asset) => {
      if (assetSection(asset) !== section) return false;
      if (section === 'generated') {
        if (scope === 'project' && asset.scope === 'all') return false;
        if (kindFilter === 'image' && asset.kind !== 'image') return false;
        if (kindFilter === 'video' && asset.kind !== 'video') return false;
        if (kindFilter === 'audio' && asset.kind !== 'audio' && asset.kind !== 'effect') return false;
      } else if (tag !== 'all' && !(asset.tags || []).includes(tag)) {
        return false;
      }
      if (search && !`${asset.name} ${asset.description ?? ''}`.toLocaleLowerCase().includes(search)) return false;
      return true;
    });
  }, [assets, section, tag, filter.query, scope, kindFilter]);

  const moreLocal = visibleCount < filtered.length;
  const moreRemote = hasMore && !!onLoadMore;
  const currentSectionLabel = defaultSections.find((item) => item.id === section)?.label || '资产';
  const currentTagLabel = tags.find((item) => item.id === tag)?.label;
  const emptyMessage = (emptyText?.[section]) || (filter.query ? '没有找到匹配的资产' : '当前暂无资产');

  useEffect(() => {
    setVisibleCount(pageCount);
    setLoadError('');
    setLoadingMore(false);
    if (panelRef.current) panelRef.current.scrollTop = 0;
  }, [filterKey, pageCount]);

  const loadNextPage = useCallback(async (automatic = false) => {
    if (loadingMore || (automatic && loadError)) return;
    if (moreLocal) { setVisibleCount((count) => count + pageCount); return; }
    if (!moreRemote || !onLoadMore) return;
    const controller = new AbortController();
    controllers.current.add(controller);
    setLoadingMore(true);
    setLoadError('');
    try {
      await onLoadMore({ ...filter, signal: controller.signal });
    } catch (reason) {
      if (!controller.signal.aborted) setLoadError(reason instanceof Error ? reason.message : '加载失败，请重试');
    } finally {
      controllers.current.delete(controller);
      setLoadingMore(false);
    }
  }, [filterKey, moreLocal, moreRemote, loadingMore, loadError, pageCount]);

  useEffect(() => {
    if (loading || loadingMore || loadError || (!moreLocal && !moreRemote)) return;
    if (!panelRef.current || !sentinelRef.current || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(([entry]) => { if (entry.isIntersecting) void loadNextPage(true); },
      { root: panelRef.current, rootMargin: '0px 0px 120px 0px' });
    observer.observe(sentinelRef.current);
    return () => observer.disconnect();
  }, [loading, loadingMore, loadError, moreLocal, moreRemote, visibleCount, filtered.length, filterKey, loadNextPage]);

  const clearSelection = () => {
    setSelectedId((current) => {
      if (current !== null) onSelectionChange?.(null);
      return null;
    });
  };
  const changeSection = (next: AssetSection) => {
    if (sectionProp === undefined) setInnerSection(next);
    onSectionChange?.(next);
    clearSelection();
    setQuery('');
    setMenuOpen(false);
  };
  const changeTag = (next: string) => {
    if (tagPropControlled === undefined) setInnerTag(next);
    onTagChange?.(next);
    clearSelection();
  };
  const changeScope = (next: AssetScope) => {
    if (scopeProp === undefined) setInnerScope(next);
    onScopeChange?.(next);
    clearSelection();
  };

  const selectedAsset = selectedId ? assets.find((asset) => asset.id === selectedId) ?? null : null;
  const submitConfirm = async () => {
    if (!onConfirm || !selectedAsset || confirming) return;
    setConfirming(true);
    setError('');
    try {
      await onConfirm(selectedAsset);
      requestClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '确认失败，请重试');
    } finally {
      setConfirming(false);
    }
  };

  const requestClose = () => {
    if (open === undefined) setInnerOpen(false);
    onOpenChange?.(false);
  };
  const openAsset = (asset: AssetItem, index: number) => {
    if (disabled || asset.uploading) return;
    setSelectedId(asset.id);
    onSelectionChange?.(asset);
    onSelect?.({ asset, index });
  };

  const toggleFavorite = (asset: AssetItem) => {
    if (!onFavoriteChange || asset.uploading) return;
    onFavoriteChange(asset, !asset.favorite);
  };

  const beginRename = (asset: AssetItem) => {
    setRenamingId(asset.id);
    setRenameDraft(asset.name);
    setError('');
  };
  const submitRename = async (asset: AssetItem) => {
    const name = renameDraft.trim();
    if (!name) { setError('名称不能为空'); return; }
    if (name === asset.name) { setRenamingId(null); return; }
    if (!onRename) { setRenamingId(null); return; }
    setBusyId(asset.id);
    try { await onRename({ asset, name }); setRenamingId(null); }
    catch (reason) { setError(reason instanceof Error ? reason.message : '重命名失败，请重试'); }
    finally { setBusyId(null); }
  };

  const remove = async (asset: AssetItem) => {
    if (!onDelete) return;
    setBusyId(asset.id);
    setError('');
    try { await onDelete(asset); }
    catch (reason) { setError(reason instanceof Error ? reason.message : '删除失败，请重试'); }
    finally { setBusyId(null); }
  };

  const download = async (asset: AssetItem) => {
    const source = getDownloadUrl ? await getDownloadUrl(asset) : asset.url;
    if (!source) { setError('该资产没有可下载的地址'); return; }
    const anchor = document.createElement('a');
    anchor.href = source;
    anchor.download = asset.name;
    anchor.rel = 'noopener';
    anchor.target = '_blank';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  };

  const runAction = (asset: AssetItem, action: AssetAction) => {
    if (busyId === asset.id) return;
    if (action === 'rename') beginRename(asset);
    else if (action === 'delete') void remove(asset);
    else if (action === 'favorite') toggleFavorite(asset);
    else void download(asset).catch((reason) => setError(reason instanceof Error ? reason.message : '下载失败'));
  };

  /** 上传：每个文件独立校验、独立失败，进度来自宿主上报。 */
  const uploadFiles = async (files: File[]) => {
    if (!upload || disabled) return;
    const accepted: File[] = [];
    const rejected: string[] = [];
    files.forEach((file) => {
      if (!acceptFile(file, accept)) { rejected.push(`${file.name}：不支持的格式`); return; }
      if (!file.size) { rejected.push(`${file.name}：文件为空`); return; }
      if (file.size > maxFileSize) { rejected.push(`${file.name}：超过 ${formatSize(maxFileSize)}`); return; }
      accepted.push(file);
    });
    if (rejected.length) setError(rejected.join('；'));
    else setError('');
    if (!accepted.length) return;
    const limit = Number.isFinite(maxConcurrentUploads) ? Math.max(1, Math.floor(maxConcurrentUploads)) : 3;
    const queue = Math.min(limit, accepted.length);
    let cursor = 0;
    const worker = async () => {
      while (cursor < accepted.length) {
        const file = accepted[cursor++];
        const key = `${file.name}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        const controller = new AbortController();
        controllers.current.add(controller);
        setUploads((list) => [...list, { key, name: file.name, percent: 0 }]);
        try {
          await upload({
            file, section, signal: controller.signal,
            onProgress: (percent) => setUploads((list) => list.map((item) => item.key === key
              ? { ...item, percent: Math.max(0, Math.min(100, Math.round(percent))) } : item)),
          });
        } catch (reason) {
          if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : `${file.name} 上传失败`);
        } finally {
          controllers.current.delete(controller);
          setUploads((list) => list.filter((item) => item.key !== key));
        }
      }
    };
    await Promise.all(Array.from({ length: queue }, worker));
  };

  const takeFiles = (event: DragEvent<HTMLElement>) => {
    if (!upload) return;
    event.preventDefault();
    setDragging(false);
    if (disabled) return;
    const files = Array.from(event.dataTransfer.files || []);
    if (files.length) void uploadFiles(files);
  };

  const submitTag = (event: FormEvent) => {
    event.preventDefault();
    const label = newTag.trim();
    if (!label || !onCreateTag) { setTagCreating(false); return; }
    const created = onCreateTag(label);
    setNewTag('');
    setTagCreating(false);
    if (created && 'id' in created) changeTag(created.id);
  };

  const kindOf = (asset: AssetItem) => mediaType(asset.kind);
  const canUpload = !!upload && !disabled;

  const panel = <section className={cn('darl-asset-library', className)} aria-label={modal ? undefined : title} tabIndex={-1}>
    <aside className="darl-asset-sidebar" aria-label={`${title}分区`}>
      <button type="button" className="darl-asset-mobile-toggle" aria-expanded={menuOpen}
        onClick={() => setMenuOpen((next) => !next)}>
        {sectionIcons[section]}<strong>{currentSectionLabel}</strong><ChevronDown aria-hidden="true" />
      </button>
      <div className="darl-asset-brand">{title}</div>
      <div className="darl-asset-sections" data-open={menuOpen} role="group" aria-label="资产分区">
        {sections.map((item) => <button key={item.id} type="button" data-active={item.id === section}
          aria-current={item.id === section ? 'page' : undefined}
          onClick={() => changeSection(item.id)}>
          {sectionIcons[item.id]}<span>{item.label}</span><small>{item.count}</small>
        </button>)}
      </div>
    </aside>

    <div className="darl-asset-main">
      <header className="darl-asset-header">
        {isGenerated ? <>
          <div className="darl-asset-heading">
            <div className="darl-asset-heading-row">
              <h2>生成历史</h2>
              <div className="darl-asset-scopes" role="tablist" aria-label="项目范围">
                <button type="button" role="tab" aria-selected={scope === 'project'} data-active={scope === 'project'}
                  onClick={() => changeScope('project')}>本项目</button>
                <button type="button" role="tab" aria-selected={scope === 'all'} data-active={scope === 'all'}
                  onClick={() => changeScope('all')}>全部项目</button>
              </div>
            </div>
            <div className="darl-asset-tools">
              {modal && <Button variant="ghost" size="icon" className="darl-asset-close" aria-label="关闭资产库" onClick={requestClose}>
                <X aria-hidden="true" />
              </Button>}
            </div>
          </div>
          <Tabs.Root value={tag === 'image' || tag === 'video' || tag === 'audio' ? tag : 'all'} onValueChange={changeTag}>
            <Tabs.List className="darl-asset-tabs darl-asset-kinds" aria-label="生成类型">
              {([['all', '全部'], ['image', '图片'], ['video', '视频'], ['audio', '音频']] as const).map(([value, label]) => <Tabs.Trigger key={value}
                value={value} className="darl-asset-tab darl-asset-kind-tab">{label}<small>{kindCounts[value]}</small></Tabs.Trigger>)}
              {onAdvancedFilter && <Button variant="ghost" size="icon" className="darl-asset-filter" aria-label="高级筛选" onClick={onAdvancedFilter}>
                <ListFilter aria-hidden="true" />
              </Button>}
            </Tabs.List>
          </Tabs.Root>
        </>
        : <>
          <div className="darl-asset-heading">
            <h2>{section === 'saved' ? '个人资产' : '我上传的'}</h2>
            <div className="darl-asset-tools">
              <div className={cn('darl-asset-search', searchOpen && 'is-open')}>
                <Search aria-hidden="true" />
                <span className="darl-visually-hidden">搜索资产名称</span>
                <input id={`${id}-search`} value={query} placeholder="搜索资产" aria-label="搜索资产名称"
                  onChange={(event) => { setQuery(event.target.value); if (!searchOpen) setSearchOpen(true); }}
                  onBlur={onSearchBlur} />
                {query && <Button variant="ghost" size="icon" aria-label="清除搜索" onClick={() => { setQuery(''); setSearchOpen(false); }}><X aria-hidden="true" /></Button>}
              </div>
              <Button variant="ghost" size="icon" className="darl-asset-search-trigger" aria-label="搜索资产" aria-expanded={searchOpen}
                onClick={() => setSearchOpen((next) => !next)}><Search aria-hidden="true" /></Button>
              {onCreate && <Button className="darl-asset-new" disabled={disabled}
                onClick={() => { if (upload) fileInput.current?.click(); else onCreate({ section, tag: filter.tag, query: filter.query }); }}>
                <Plus data-icon="inline-start" />新建
              </Button>}
              {modal && <Button variant="ghost" size="icon" className="darl-asset-close" aria-label="关闭资产库" onClick={requestClose}>
                <X aria-hidden="true" />
              </Button>}
            </div>
          </div>
          <Tabs.Root value={tag} onValueChange={changeTag}>
            <Tabs.List className="darl-asset-tabs" aria-label="资产标签">
              {tags.map((item) => item.removable && onDeleteTag
                ? <span key={item.id} className="darl-asset-tab-wrap">
                  <Tabs.Trigger value={item.id} className="darl-asset-tab">{item.label}</Tabs.Trigger>
                  <button type="button" className="darl-asset-tab-remove" aria-label={`删除标签${item.label}`}
                    onClick={() => onDeleteTag(item)}><X aria-hidden="true" /></button>
                </span>
                : <Tabs.Trigger key={item.id} value={item.id} className="darl-asset-tab">{item.label}</Tabs.Trigger>)}
              {onCreateTag && (tagCreating ? <form className="darl-asset-tag-create" onSubmit={submitTag}>
                <input autoFocus aria-label="新标签名称" value={newTag} maxLength={20} placeholder="标签名称"
                  onChange={(event) => setNewTag(event.target.value)}
                  onKeyDown={(event) => { if (event.key === 'Escape') { setNewTag(''); setTagCreating(false); } }} />
                <Button size="sm" type="submit" disabled={!newTag.trim()}>保存</Button>
              </form> : <button type="button" className="darl-asset-tab darl-asset-tab-add" onClick={() => setTagCreating(true)}>
                <Plus aria-hidden="true" />新建标签
              </button>)}
            </Tabs.List>
          </Tabs.Root>
        </>
        }
      </header>

      {error && <p className="darl-asset-error" role="alert">{error}<button type="button" className="darl-asset-error-dismiss" aria-label="关闭提示" onClick={() => setError('')}><X aria-hidden="true" /></button></p>}

      {uploads.length > 0 && <ul className="darl-asset-uploads" aria-live="polite">
        {uploads.map((item) => <li key={item.key}>
          <UploadCloud aria-hidden="true" /><span>{item.name}</span>
          <progress value={item.percent} max={100} aria-label={`${item.name} 上传进度`} /><small>{item.percent}%</small>
        </li>)}
      </ul>}

      <div ref={panelRef} className={cn('darl-asset-panel', dragging && 'is-dragging')}
        onClick={() => setSearchOpen(false)}
        onDragOver={(event) => { if (!canUpload) return; event.preventDefault(); setDragging(true); }}
        onDragLeave={(event) => { const next = event.relatedTarget as Node | null; if (!next || !event.currentTarget.contains(next)) setDragging(false); }}
        onDrop={takeFiles}>
        {dragging && <div className="darl-asset-dropzone" aria-hidden="true"><UploadCloud /><strong>松开以上传资产</strong><span>当前分区：{currentSectionLabel}</span></div>}
        {loading ? <div className="darl-asset-empty" role="status"><span className="darl-asset-spinner" aria-hidden="true" />正在加载资产…</div>
          : filtered.length === 0 ? <div className="darl-asset-empty">
            <ImageOff aria-hidden="true" />
            <strong>{emptyMessage}</strong>
            <span>{tag !== 'all' && currentTagLabel ? `「${currentTagLabel}」分类下还没有资产` : '上传图片、视频或音频，或从生成结果中保存'}</span>
            {canUpload && <Button variant="outline" onClick={() => fileInput.current?.click()}><Upload data-icon="inline-start" />上传资产</Button>}
          </div>
          : <ul className="darl-asset-grid" aria-label="资产列表">
            {filtered.slice(0, visibleCount).map((asset, index) => {
              const media = kindOf(asset);
              const tagLabels = (asset.tags || []).map((key) => tags.find((item) => item.id === key)?.label).filter(Boolean) as string[];
              return <li key={asset.id} className="darl-asset-card-wrap">
                <ContextMenu.Root>
                  <ContextMenu.Trigger asChild>
                    <article className="darl-asset-card" data-selected={selectedId === asset.id} data-busy={busyId === asset.id || !!asset.uploading}>
                      {renamingId === asset.id ? <form className="darl-asset-rename" onSubmit={(event) => { event.preventDefault(); void submitRename(asset); }}
                        onKeyDown={(event) => { if (event.key === 'Escape') setRenamingId(null); }}>
                        <input autoFocus aria-label="资产名称" value={renameDraft} maxLength={80} onChange={(event) => setRenameDraft(event.target.value)} />
                        <Button size="sm" type="submit" disabled={busyId === asset.id || !renameDraft.trim()}>保存</Button>
                        <Button size="sm" variant="ghost" type="button" onClick={() => setRenamingId(null)}>取消</Button>
                      </form> : <>
                        <button type="button" className="darl-asset-card-select" aria-pressed={selectedId === asset.id}
                          aria-label={`预览${asset.name}`} disabled={disabled} onClick={() => openAsset(asset, index + 1)}>
                          <Thumb asset={asset} />
                          {asset.uploading !== undefined && <span className="darl-asset-progress"><progress value={asset.uploading} max={100} aria-label={`${asset.name} 上传进度`} /><small>{asset.uploading}%</small></span>}
                          <span className="darl-asset-card-meta">
                            <strong>{asset.name}</strong>
                            <span>{kindLabels[asset.kind]}{asset.size ? ` · ${formatSize(asset.size)}` : ''}{media && asset.duration ? ` · ${formatDuration(asset.duration)}` : ''}</span>
                          </span>
                          {selectedId === asset.id && <span className="darl-asset-check"><Check aria-hidden="true" /></span>}
                          {selectedId === asset.id && insertIndex !== undefined && <span className="darl-asset-index">{insertIndex}</span>}
                        </button>
                        <div className="darl-asset-card-actions">
                          {onFavoriteChange && <Button variant="ghost" size="icon" aria-pressed={!!asset.favorite} aria-label={`${asset.favorite ? '取消收藏' : '收藏'}${asset.name}`}
                            disabled={!!asset.uploading} onClick={() => toggleFavorite(asset)}><Star aria-hidden="true" /></Button>}
                          {onRename && <Button variant="ghost" size="icon" aria-label={`重命名${asset.name}`} disabled={!!asset.uploading} onClick={() => beginRename(asset)}><Pencil aria-hidden="true" /></Button>}
                          {onDelete && <Button variant="ghost" size="icon" aria-label={`删除${asset.name}`} disabled={!!asset.uploading}
                            onClick={() => { if (window.confirm(`确定删除「${asset.name}」？`)) void remove(asset); }}><Trash2 aria-hidden="true" /></Button>}
                        </div>
                      </>}
                      {tagLabels.length > 0 && renamingId !== asset.id && <span className="darl-asset-card-tags">{tagLabels.map((label) => <span key={label}>{label}</span>)}</span>}
                    </article>
                  </ContextMenu.Trigger>
                  <ContextMenu.Portal>
                    <ContextMenu.Content className="darl-asset-menu" aria-label={`${asset.name} 操作`}>
                      <ContextMenu.Item className="darl-asset-menu-item" disabled={disabled} onSelect={() => openAsset(asset, index + 1)}>
                        <Sparkles aria-hidden="true" />插入到提示词
                      </ContextMenu.Item>
                      <ContextMenu.Item className="darl-asset-menu-item" disabled={!onFavoriteChange || !!asset.uploading} onSelect={() => runAction(asset, 'favorite')}>
                        <Star aria-hidden="true" />{asset.favorite ? '取消收藏' : '收藏'}
                      </ContextMenu.Item>
                      <ContextMenu.Item className="darl-asset-menu-item" disabled={!onRename || !!asset.uploading} onSelect={() => runAction(asset, 'rename')}>
                        <Pencil aria-hidden="true" />重命名
                      </ContextMenu.Item>
                      <ContextMenu.Item className="darl-asset-menu-item" disabled={!(asset.url || getDownloadUrl)} onSelect={() => runAction(asset, 'download')}>
                        <Download aria-hidden="true" />下载
                      </ContextMenu.Item>
                      <ContextMenu.Separator className="darl-asset-menu-separator" />
                      <ContextMenu.Item className="darl-asset-menu-item is-danger" disabled={!onDelete || !!asset.uploading} onSelect={() => runAction(asset, 'delete')}>
                        <Trash2 aria-hidden="true" />删除
                      </ContextMenu.Item>
                    </ContextMenu.Content>
                  </ContextMenu.Portal>
                </ContextMenu.Root>
              </li>;
            })}
          </ul>}
        {!loading && filtered.length > 0 && (moreLocal || moreRemote || loadingMore || loadError) && <div ref={sentinelRef} className="darl-asset-pagination" aria-live="polite" aria-busy={loadingMore}>
          {loadingMore ? <span role="status">正在加载更多资产…</span>
            : loadError ? <><span role="alert">{loadError}</span><Button variant="outline" size="sm" onClick={() => void loadNextPage()}>重试加载</Button></>
            : <Button variant="ghost" size="sm" onClick={() => void loadNextPage()}>加载更多</Button>}
        </div>}
      </div>

      {onConfirm && selectedAsset && <footer className="darl-asset-footer">
        <span className="darl-asset-footer-hint">已选择：{selectedAsset.name}</span>
        <Button onClick={() => void submitConfirm()} disabled={confirming}>{confirming ? '确认中…' : confirmText}</Button>
      </footer>}
      {canUpload && <>
        <input ref={fileInput} id={`${id}-upload`} className="darl-asset-file-input" type="file" multiple accept={accept.join(',')}
          aria-label="选择要上传的资产文件"
          onChange={(event) => { const files = Array.from(event.target.files || []); event.target.value = ''; void uploadFiles(files); }} />
        <button type="button" className="darl-asset-fab" aria-label="上传资产" onClick={() => fileInput.current?.click()}>
          <Upload aria-hidden="true" />上传
        </button>
      </>}
    </div>
  </section>;

  if (!modal) return panel;
  return <Dialog.Root open={isOpen} onOpenChange={(next) => { if (!next) requestClose(); }}>
    <Dialog.Portal>
      <Dialog.Overlay className="darl-asset-overlay" />
      <Dialog.Content className="darl-asset-dialog" aria-labelledby={titleId} aria-describedby={undefined}
        onOpenAutoFocus={(event) => {
          // 打开时把焦点放在面板上，避免首屏出现按钮焦点环；Tab 仍按正常顺序进入控件。
          const focusTarget = (event.currentTarget as HTMLElement | null)?.querySelector<HTMLElement>('.darl-asset-library');
          if (focusTarget) { event.preventDefault(); focusTarget.focus(); }
        }}>
        <Dialog.Title id={titleId} className="darl-asset-dialog-title">{title}</Dialog.Title>
        {panel}
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>;
}
