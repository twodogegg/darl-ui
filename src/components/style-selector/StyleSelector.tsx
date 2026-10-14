import { useEffect, useId, useMemo, useRef, useState, type CSSProperties } from 'react';
import { Tabs, ToggleGroup } from 'radix-ui';
import { ArrowLeft, Check, ImageIcon, ImagePlus, Search, Sparkles, Star, X } from 'lucide-react';
import { Button } from '../ui/Button';
import './style-selector.css';

export type StyleCollection = 'market' | 'mine' | 'favorites' | 'recent';
export interface StyleOption {
  id: string;
  name: string;
  image?: string;
  category?: string;
  description?: string;
  favorite?: boolean;
  isOwned?: boolean;
  lastUsedAt?: number;
}
export interface StyleCreateRequest {
  name: string;
  description: string;
  category?: string;
  referenceImage?: File;
}
export interface StyleFilter {
  collection: StyleCollection;
  category?: string;
  query: string;
}
export interface StyleLoadMoreRequest extends StyleFilter {
  signal: AbortSignal;
}
export interface StyleSelectorProps {
  styles: StyleOption[];
  /** When provided, the selector is rendered as a modal dialog. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  value?: string | null;
  defaultValue?: string | null;
  onChange?: (style: StyleOption | null) => void;
  onFavoriteChange?: (style: StyleOption, favorite: boolean) => void;
  /** Resolve after saving; reject to keep the draft and display an error. */
  onCreate?: (request: StyleCreateRequest) => void | Promise<void>;
  defaultCollection?: StyleCollection;
  className?: string;
  accentColor?: string;
  /** Number of cards revealed per page, including when all styles are already local. */
  pageSize?: number;
  /** Whether the host has another remote page for the current filters. */
  hasMore?: boolean;
  /** Append the next page to styles; support signal to discard cancelled requests. */
  onLoadMore?: (request: StyleLoadMoreRequest) => Promise<void>;
  /** Reset the host's page cursor and hasMore when the filter changes. */
  onFilterChange?: (filter: StyleFilter) => void;
}
const collections: { id: StyleCollection; label: string }[] = [
  { id: 'market', label: '风格广场' }, { id: 'mine', label: '我的风格' },
  { id: 'favorites', label: '我的收藏' }, { id: 'recent', label: '最近使用' },
];
const imageTypes = ['image/png', 'image/jpeg', 'image/webp'];

function Thumbnail({ src, className = '' }: { src?: string; className?: string }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);
  return src && !failed ? <img className={className} src={src} alt="" loading="lazy" onError={() => setFailed(true)} />
    : <span className={`darl-style-image-fallback ${className}`}><ImageIcon aria-hidden="true" /></span>;
}

/** shadcn-style Button, Radix Tabs/ToggleGroup, and isolated CSS for Tailwind-free hosts. */
export function StyleSelector({ styles, value, defaultValue = null, onChange, onFavoriteChange, onCreate,
  defaultCollection = 'market', className = '', accentColor, open, onOpenChange,
  pageSize = 20, hasMore = false, onLoadMore, onFilterChange }: StyleSelectorProps) {
  const id = useId();
  const [collection, setCollection] = useState<StyleCollection>(defaultCollection);
  const [category, setCategory] = useState('');
  const [query, setQuery] = useState('');
  const [internalValue, setInternalValue] = useState<string | null>(defaultValue);
  const [pendingValue, setPendingValue] = useState<string | null>(value ?? defaultValue);
  const [recent, setRecent] = useState<string[]>([]);
  const [creating, setCreating] = useState(false);
  const [step, setStep] = useState<1 | 2>(1);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [referenceImage, setReferenceImage] = useState<File>();
  const [previewUrl, setPreviewUrl] = useState<string>();
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const pageCount = Number.isFinite(pageSize) ? Math.max(1, Math.floor(pageSize)) : 20;
  const [visibleCount, setVisibleCount] = useState(pageCount);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadError, setLoadError] = useState('');
  const loadController = useRef<AbortController | null>(null);
  const lastAutoLoad = useRef('');
  const activeCategory = collection === 'mine' ? '' : category;
  const filterKey = JSON.stringify([collection, activeCategory, query.trim()]);
  useEffect(() => {
    if (open !== false) onFilterChange?.({ collection, ...(activeCategory ? { category: activeCategory } : {}), query: query.trim() });
  }, [filterKey, open]);
  const selectedId = value !== undefined ? value : internalValue;
  const categories = useMemo(() => [...new Set(styles.map((item) => item.category).filter((item): item is string => !!item))], [styles]);
  const filtered = useMemo(() => {
    const search = query.trim().toLocaleLowerCase();
    const items = styles.filter((item) => {
      const matchesCollection = collection === 'market' || (collection === 'favorites' && item.favorite)
        || (collection === 'mine' && item.isOwned) || (collection === 'recent' && (recent.includes(item.id) || item.lastUsedAt));
      return matchesCollection && (collection === 'mine' || !category || item.category === category)
        && (!search || `${item.name} ${item.description ?? ''}`.toLocaleLowerCase().includes(search));
    });
    return collection === 'recent' ? items.sort((a, b) => {
      const aIndex = recent.indexOf(a.id), bIndex = recent.indexOf(b.id);
      if (aIndex >= 0 || bIndex >= 0) return (aIndex < 0 ? Infinity : aIndex) - (bIndex < 0 ? Infinity : bIndex);
      return (b.lastUsedAt ?? 0) - (a.lastUsedAt ?? 0);
    }) : items;
  }, [category, collection, query, recent, styles]);
  const moreLocal = visibleCount < filtered.length;
  const moreRemote = hasMore && !!onLoadMore;
  const autoLoadKey = JSON.stringify([filterKey, styles.map((item) => item.id)]);
  const loadNextPage = async (automatic = false) => {
    if (loadController.current || loadingMore || (automatic && loadError)) return;
    if (moreLocal) { setVisibleCount((count) => count + pageCount); return; }
    if (!moreRemote || !onLoadMore || (automatic && lastAutoLoad.current === autoLoadKey)) return;
    lastAutoLoad.current = autoLoadKey;
    const controller = new AbortController();
    loadController.current = controller;
    setLoadingMore(true); setLoadError('');
    try {
      await onLoadMore({ collection, ...(activeCategory ? { category: activeCategory } : {}), query: query.trim(), signal: controller.signal });
    } catch (reason) {
      if (!controller.signal.aborted) setLoadError(reason instanceof Error ? reason.message : '加载失败，请重试');
    } finally {
      if (loadController.current === controller) {
        loadController.current = null;
        setLoadingMore(false);
      }
    }
  };
  useEffect(() => {
    setVisibleCount(pageCount); setLoadError(''); setLoadingMore(false); lastAutoLoad.current = '';
    if (panelRef.current) panelRef.current.scrollTop = 0;
    return () => { loadController.current?.abort(); loadController.current = null; };
  }, [filterKey, pageCount, open, creating]);
  useEffect(() => {
    if (open === false || creating || loadingMore || loadError || (!moreLocal && !moreRemote)
      || !panelRef.current || !sentinelRef.current || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) void loadNextPage(true);
    }, { root: panelRef.current, rootMargin: '0px 0px 80px 0px' });
    observer.observe(sentinelRef.current);
    return () => observer.disconnect();
  }, [open, creating, filterKey, visibleCount, filtered.length, autoLoadKey, moreRemote, loadingMore, loadError]);
  useEffect(() => () => { if (previewUrl) URL.revokeObjectURL(previewUrl); }, [previewUrl]);
  useEffect(() => { if (open !== undefined) setPendingValue(value ?? internalValue); }, [open, value]);

  const selectStyle = (item: StyleOption) => {
    setPendingValue(item.id);
    setRecent((previous) => [item.id, ...previous.filter((key) => key !== item.id)]);
  };
  const confirmSelection = () => {
    const next = pendingValue ? styles.find((item) => item.id === pendingValue) ?? null : null;
    if (value === undefined) setInternalValue(next?.id ?? null);
    onChange?.(next);
    onOpenChange?.(false);
  };
  const resetCreate = () => {
    setCreating(false); setStep(1); setName(''); setDescription('');
    setReferenceImage(undefined); setPreviewUrl(undefined); setError('');
  };
  const acceptImage = (file?: File) => {
    if (!file) return;
    if (!imageTypes.includes(file.type)) { setError('请选择 PNG、JPG、JPEG 或 WEBP 图片'); return; }
    if (!file.size || file.size > 10 * 1024 * 1024) { setError('图片不能为空，且不能超过 10MB'); return; }
    setReferenceImage(file); setPreviewUrl(URL.createObjectURL(file)); setError('');
  };
  const submitCreate = async () => {
    if (!onCreate || saving) return;
    setSaving(true); setError('');
    try {
      await onCreate({ name: name.trim(), description: description.trim(),
        ...(referenceImage ? { referenceImage } : {}) });
      resetCreate();
    } catch (reason) { setError(reason instanceof Error ? reason.message : '创建失败，请重试'); }
    finally { setSaving(false); }
  };
  const theme = accentColor ? { '--darl-style-accent': accentColor } as CSSProperties : undefined;
  const valid = !!name.trim() && !!description.trim();
  const close = () => { if (creating) resetCreate(); onOpenChange?.(false); };
  useEffect(() => {
    if (open === undefined || !open) return;
    const handleKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') close(); };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [open, creating]);

  if (open === false) return null;
  const modal = open !== undefined;
  return <section className={`darl-style-selector ${modal ? 'darl-style-modal' : ''} ${className}`} style={theme}
    role={modal ? 'dialog' : undefined} aria-modal={modal ? true : undefined} aria-label="风格选择器"
    onMouseDown={modal ? (event) => { if (event.target === event.currentTarget) close(); } : undefined}>
    <div className={modal ? 'darl-style-modal-panel' : undefined}>
    {creating ? <div className="darl-style-create">
      <header className="darl-style-create-head">
        <Button variant="ghost" disabled={saving} onClick={() => step === 2 ? setStep(1) : resetCreate()}><ArrowLeft aria-hidden="true" />返回</Button>
        <ol className="darl-style-steps" aria-label="创建步骤">
          <li aria-current={step === 1 ? 'step' : undefined}><b>{step === 2 ? <Check /> : 1}</b>制作风格</li>
          <li aria-current={step === 2 ? 'step' : undefined}><b>2</b>创建风格</li>
        </ol>
        <Button variant="ghost" size="icon" disabled={saving} onClick={resetCreate} aria-label="取消创建"><X /></Button>
      </header>
      <form onSubmit={(event) => { event.preventDefault(); if (!valid) return; if (step === 1) setStep(2); else void submitCreate(); }}>
        {step === 1 ? <div className="darl-style-create-body">
          <div className="darl-style-form">
            <label htmlFor={`${id}-name`}>风格名称 <em>*</em></label>
            <input id={`${id}-name`} autoFocus required value={name} maxLength={80} onChange={(event) => setName(event.target.value)} placeholder="给这个风格起一个便于识别的名称" />
            <label htmlFor={`${id}-description`}>风格描述词 <em>*</em></label>
            <div className="darl-style-textarea-wrap"><textarea id={`${id}-description`} required value={description} maxLength={500} onChange={(event) => setDescription(event.target.value)} placeholder="描述画面质感、光影、色彩与构图等风格关键词" /><span>{description.length}/500</span></div>
          </div>
          <div className="darl-style-reference">
            <label htmlFor={`${id}-reference`}>风格参考图</label><p id={`${id}-hint`}>建议使用 16:9 图片，也支持其他比例；可选上传 1 张，单张不超过 10MB</p>
            <button type="button" className={`darl-style-upload ${previewUrl ? 'has-preview' : ''}`} onClick={() => fileInput.current?.click()} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); acceptImage(event.dataTransfer.files[0]); }} aria-label={previewUrl ? '更换参考图片' : '上传参考图片'}>
              {previewUrl ? <Thumbnail src={previewUrl} /> : <><ImagePlus aria-hidden="true" /><strong>上传图片</strong><span>点击或拖入 PNG、JPG、WEBP 图片</span></>}
            </button>
            <input ref={fileInput} id={`${id}-reference`} className="darl-style-file-input" type="file" accept={imageTypes.join(',')} aria-describedby={`${id}-hint`} onChange={(event) => { acceptImage(event.target.files?.[0]); event.target.value = ''; }} />
            {referenceImage && <div className="darl-style-reference-file"><span>{referenceImage.name}</span><Button variant="ghost" size="sm" onClick={() => { setReferenceImage(undefined); setPreviewUrl(undefined); setError(''); }}><X />移除图片</Button></div>}
          </div>
        </div> : <div className="darl-style-review" aria-label="确认风格信息">
          <div className="darl-style-review-image"><Thumbnail src={previewUrl} /></div>
          <div><p>确认风格信息</p><h2>{name}</h2><p className="darl-style-review-description">{description}</p><small>{referenceImage ? `参考图：${referenceImage.name}` : '未添加参考图'}</small></div>
        </div>}
        {error && <p className="darl-style-error" role="alert">{error}</p>}
        <footer className="darl-style-create-footer"><Button type="submit" disabled={!valid || saving}>{saving ? '创建中…' : step === 1 ? '下一步' : '创建风格'}</Button></footer>
      </form>
    </div> : <Tabs.Root className="darl-style-browser" value={collection} onValueChange={(next) => setCollection(next as StyleCollection)}>
      <header className="darl-style-header">
        <Tabs.List className="darl-style-collections" aria-label="风格集合">{collections.map((item) => <Tabs.Trigger key={item.id} value={item.id}>{item.label}</Tabs.Trigger>)}</Tabs.List>
        <div className="darl-style-actions"><label className="darl-style-search"><Search aria-hidden="true" /><input aria-label="搜索风格名称" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索风格名称" />{query && <Button variant="ghost" size="icon" onClick={() => setQuery('')} aria-label="清除搜索"><X /></Button>}</label>{onCreate && <Button variant="outline" onClick={() => setCreating(true)}><Sparkles aria-hidden="true" />创建风格</Button>}{modal && <Button variant="ghost" size="icon" onClick={close} aria-label="关闭风格选择"><X /></Button>}</div>
      </header>
      {collection !== 'mine' && <div className="darl-style-filters"><ToggleGroup.Root className="darl-style-category" type="single" value={category || 'all'} onValueChange={(next) => { if (next) setCategory(next === 'all' ? '' : next); }} aria-label="风格分类"><ToggleGroup.Item value="all">全部</ToggleGroup.Item>{categories.map((item) => <ToggleGroup.Item key={item} value={item}>{item}</ToggleGroup.Item>)}</ToggleGroup.Root></div>}
      {collections.map((item) => <Tabs.Content key={item.id} value={item.id} className="darl-style-panel" ref={collection === item.id ? panelRef : undefined}>
          <div className="darl-style-grid">{collection === 'mine' && onCreate && !query && <article className="darl-style-card darl-style-create-card"><button type="button" className="darl-style-card-select" onClick={() => setCreating(true)}><span className="darl-style-create-card-icon"><Sparkles /></span><strong>创建风格</strong><small>上传参考图或输入描述</small></button></article>}{filtered.slice(0, visibleCount).map((option) => <article key={option.id} className={`darl-style-card ${selectedId === option.id ? 'is-selected' : ''} ${pendingValue === option.id && pendingValue !== selectedId ? 'is-pending' : ''}`}>
          <button type="button" className="darl-style-card-select" onClick={() => selectStyle(option)} aria-pressed={pendingValue === option.id} aria-label={`预览${option.name}`}>
            <span className="darl-style-card-image"><Thumbnail src={option.image} /><span className="darl-style-card-overlay"><strong>{option.name}</strong></span><span className="darl-style-card-check"><Check /></span></span>
            <span className="darl-style-card-meta">{!option.isOwned && option.category && <span>{option.category}</span>}<span>{option.description}</span></span>
          </button>
          {onFavoriteChange && <Button variant="ghost" size="icon" className="darl-style-favorite" aria-pressed={!!option.favorite} onClick={() => onFavoriteChange(option, !option.favorite)} aria-label={`${option.favorite ? '取消收藏' : '收藏'}${option.name}`}><Star aria-hidden="true" /></Button>}
        </article>)}</div>
        {!filtered.length && !moreRemote && !loadingMore && <div className="darl-style-empty"><Search aria-hidden="true" /><strong>{query ? '没有找到匹配的风格' : collection === 'mine' ? '还没有自己的风格' : collection === 'favorites' ? '还没有收藏的风格' : collection === 'recent' ? '还没有使用过的风格' : '暂无风格'}</strong><span>试试其他关键词或切换分类</span><Button variant="outline" onClick={() => { setQuery(''); setCategory(''); setCollection('market'); }}>浏览全部风格</Button></div>}
        {collection === item.id && (moreLocal || moreRemote || loadingMore || loadError) && <div ref={sentinelRef} className="darl-style-pagination" aria-live="polite" aria-busy={loadingMore}>
          {loadingMore ? <span role="status">正在加载更多风格…</span> : loadError ? <><span role="alert">{loadError}</span><Button variant="outline" size="sm" onClick={() => void loadNextPage()}>重试加载</Button></> : <Button variant="ghost" size="sm" onClick={() => void loadNextPage()}>加载更多</Button>}
        </div>}
      </Tabs.Content>)}
      <footer className="darl-style-footer"><div className="darl-style-footer-actions"><Button onClick={confirmSelection} disabled={pendingValue === selectedId}>确认选择</Button></div></footer>
    </Tabs.Root>}
    </div>
  </section>;
}
