import { useRef, useState } from 'react';
import { Check, FolderOpen, Layers3, UploadCloud } from 'lucide-react';
import {
  AssetLibrary, type AssetCreateRequest, type AssetFilter, type AssetItem, type AssetKind, type AssetScope,
  type AssetSection, type AssetSelectRequest, type AssetTag, type AssetUploadContext,
} from '../../src';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ComponentHeading, FeatureCards } from './DemoUI';

const now = Date.now();
const scened = (index: number) => `/media-workspace/scene-${(index % 6) + 1}.svg`;

function make(kind: AssetKind, name: string, section: AssetSection, tags: string[], extra: Partial<AssetItem> = {}): AssetItem {
  return { id: `${section}-${name}`, name, kind, section, tags, scope: 'project' as AssetScope, ...extra };
}

const initialAssets: AssetItem[] = [
  make('image', '沈青梧 · 角色三视图', 'generated', ['character'], { thumbnail: scened(0), url: scened(0), createdAt: now - 60_000 }),
  make('image', '雨夜长街 · 空镜', 'generated', ['scene'], { thumbnail: scened(1), url: scened(1) }),
  make('video', '镜头 04 · 推近', 'generated', ['video', 'scene'], { thumbnail: scened(2), url: '/media-workspace/city.mp4', duration: 6 }),
  make('audio', '片头音效 · 混响', 'generated', ['effect'], { duration: 12, size: 320_000, scope: 'all' }),
  make('image', '其他项目 · 概念图', 'generated', ['scene'], { thumbnail: scened(3), url: scened(3), scope: 'all' }),
  make('image', '青铜灯台 · 白底', 'saved', ['prop'], { thumbnail: scened(3), url: scened(3), favorite: true }),
  make('image', '水墨薄雾风格', 'saved', ['style'], { thumbnail: scened(4), url: scened(4) }),
  make('audio', '夜雨环境音', 'uploaded', ['audio', 'effect'], { duration: 42, size: 1_240_000 }),
  make('image', '参考图 · 庭院', 'uploaded', ['scene'], { thumbnail: scened(5), url: scened(5), size: 842_000 }),
  make('text', '人物小传.md', 'uploaded', ['character'], { size: 12_400 }),
];

const initialTags: AssetTag[] = [
  { id: 'all', label: '全部' }, { id: 'character', label: '角色' }, { id: 'scene', label: '场景' },
  { id: 'prop', label: '物品' }, { id: 'style', label: '风格' }, { id: 'effect', label: '音效' },
  { id: 'audio', label: '音频' }, { id: 'video', label: '视频' },
];

export function AssetLibraryDemo() {
  const [assets, setAssets] = useState<AssetItem[]>(initialAssets);
  const [tags, setTags] = useState<AssetTag[]>(initialTags);
  const [filter, setFilter] = useState<AssetFilter>({ section: 'generated', tag: '', query: '', scope: 'project', kind: 'all' });
  const [selected, setSelected] = useState<AssetSelectRequest | null>(null);
  const [open, setOpen] = useState(true);
  const [log, setLog] = useState('等待操作');
  const [hasMore, setHasMore] = useState(true);
  const [failUpload, setFailUpload] = useState(false);
  const remote = useRef<AssetItem[]>([]);

  // 远端分页：每次追加 12 条模拟远端资产，加载两页后停止。
  const loadMore = async ({ signal, section, tag, query, scope }: AssetFilter & { signal: AbortSignal }) => {
    await new Promise((resolve) => setTimeout(resolve, 350));
    if (signal.aborted) return;
    const start = remote.current.length;
    const batch = Array.from({ length: 12 }, (_, index) => make('image', `远端资产 ${start + index + 1}`, section, [tag || 'scene'], {
      thumbnail: scened(start + index), url: scened(start + index), description: query || undefined,
      scope: scope === 'all' ? ('all' as AssetScope) : ('project' as AssetScope),
    }));
    remote.current = [...remote.current, ...batch];
    setAssets((current) => [...current, ...batch]);
    if (remote.current.length >= 24) setHasMore(false);
  };

  const upload = async ({ file, onProgress, signal, section }: AssetUploadContext) => {
    for (let percent = 0; percent <= 100; percent += 20) {
      await new Promise((resolve) => setTimeout(resolve, 120));
      if (signal.aborted) throw new DOMException('已取消', 'AbortError');
      onProgress(percent);
    }
    if (failUpload) throw new Error(`${file.name}：模拟上传失败`);
    const kind: AssetKind = file.type.startsWith('image/') ? 'image' : file.type.startsWith('video/') ? 'video' : file.type.startsWith('audio/') ? 'audio' : 'other';
    const url = URL.createObjectURL(file);
    const asset: AssetItem = { id: `upload-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, name: file.name, kind, section, url,
      thumbnail: kind === 'image' ? url : undefined, size: file.size, tags: [] };
    setAssets((current) => [asset, ...current]);
    return asset;
  };

  const createTag = (label: string) => {
    const tag: AssetTag = { id: `${label}-${Date.now()}`, label, removable: true };
    setTags((current) => [...current, tag]);
    return tag;
  };

  return <>
    <ComponentHeading title="AssetLibrary" category="高级组件" description="资产库弹窗：分区导航、标签筛选、搜索、上传、收藏、重命名、删除与右键菜单。业务数据由宿主接管。"
      action={<Badge variant="outline"><Layers3 data-icon="inline-start" />本地交互演示</Badge>} />
    <FeatureCards features={[
      { title: '分区与标签', description: '生成历史 / 我保存的 / 我上传的，加角色、场景等标签筛选。', icon: FolderOpen },
      { title: '真实上传', description: '拖入或选择文件，进度由宿主上报，失败互不影响。', icon: UploadCloud },
      { title: '只做 UI', description: '收藏、重命名、删除通过回调交给宿主持久化。', icon: Check },
    ]} />
    <Card>
      <CardHeader>
        <CardTitle>资产库</CardTitle>
        <CardDescription>滚动到底部会追加模拟的远端资产；上传是浏览器内模拟，文件不会发送到服务器。</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <Button variant={failUpload ? 'default' : 'outline'} size="sm" onClick={() => setFailUpload((value) => !value)}>
            {failUpload ? '上传失败已开启' : '模拟上传失败'}
          </Button>
          <Button variant="outline" size="sm" onClick={() => { setAssets(initialAssets); remote.current = []; setHasMore(true); setSelected(null); setFilter({ section: 'generated', tag: '', query: '' }); setLog('已重置'); }}>重置数据</Button>
          <span className="text-muted-foreground text-sm">已选：{selected ? `${selected.asset.name}（序号 ${selected.index}）` : '无'}</span>
          <span className="text-muted-foreground text-sm">状态：{log}</span>
        </div>
          <Button className="mb-4" onClick={() => setOpen(true)}>打开资产库</Button>
          <AssetLibrary
            open={open}
            onOpenChange={(next) => { setOpen(next); if (!next) setLog('弹窗已关闭'); }}
            assets={assets}
            tags={tags}
            section={filter.section}
            onSectionChange={(section) => setFilter((current) => ({ ...current, section, tag: '' }))}
            tag={filter.tag || 'all'}
            onTagChange={(tag) => setFilter((current) => ({ ...current, tag: tag === 'all' ? '' : tag }))}
            onFilterChange={setFilter}
            value={selected?.asset.id ?? null}
            insertIndex={selected?.index}
            onSelect={(request) => { setSelected(request); setLog(`已选中：${request.asset.name}（序号 ${request.index}），点击右下角确认插入`); }}
            onConfirm={async (asset) => {
              await new Promise((resolve) => setTimeout(resolve, 250));
              setLog(`已确认插入：${asset.name}`);
            }}
            onFavoriteChange={(asset, favorite) => {
              setAssets((current) => current.map((item) => item.id === asset.id ? { ...item, favorite } : item));
              setLog(favorite ? `已收藏 ${asset.name}` : `已取消收藏 ${asset.name}`);
            }}
            onRename={async ({ asset, name }) => {
              await new Promise((resolve) => setTimeout(resolve, 150));
              setAssets((current) => current.map((item) => item.id === asset.id ? { ...item, name } : item));
              setLog(`已重命名：${name}`);
            }}
            onDelete={async (asset) => {
              await new Promise((resolve) => setTimeout(resolve, 150));
              setAssets((current) => current.filter((item) => item.id !== asset.id));
              setLog(`已删除：${asset.name}`);
            }}
            upload={upload}
            maxFileSize={20 * 1024 * 1024}
            onCreate={(request: AssetCreateRequest) => setLog(`新建资产（${request.section}${request.tag ? ` · ${request.tag}` : ''}），由宿主打开创建流程`)}
            onCreateTag={createTag}
            onDeleteTag={(tag) => { setTags((current) => current.filter((item) => item.id !== tag.id)); setFilter((current) => current.tag === tag.id ? { ...current, tag: '' } : current); }}
            onLoadMore={loadMore}
            hasMore={hasMore}
            pageSize={48}
            emptyText={{ generated: '还没有生成记录', saved: '还没有收藏的资产', uploaded: '还没有上传的资产' }}

          />
      </CardContent>
    </Card>
  </>;
}
