import { useMemo, useState } from 'react';
import { Check, Heart, Palette, Sparkles } from 'lucide-react';
import { StyleSelector, type StyleCreateRequest, type StyleOption } from '../../src';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ComponentHeading, FeatureCards } from './DemoUI';

const sourceStyles: StyleOption[] = [
  ['sun', '暖阳赛璐璐CG', '2D风格', 1, '清透高饱和，阳光感'],
  ['dune', '原子朋克末日风格', '3D风格', 2, '粗粝颗粒与电影光'],
  ['ink', '手绘质感3D动画', '3D风格', 3, '手绘线稿与柔和体积光'],
  ['film', '电影感', '真人风格', 4, '自然肤色，浅景深'],
  ['ue', 'UE5渲染风格', '3D风格', 5, '真实材质与戏剧光'],
  ['tv', '电视剧感', '真人风格', 6, '生活化镜头语言'],
  ['sci', '科幻国漫', '2D风格', 1, '冷色霓虹与国漫线条'],
  ['mecha', '科幻机甲CG', '3D风格', 2, '硬表面机械细节'],
  ['han', '国漫3D电影', '3D风格', 3, '东方幻想与电影构图'],
  ['robot', '爱死机CG短片', '3D风格', 4, '未来感工业质感'],
  ['comic', '漫画感3D动画', '2D风格', 5, '大胆色块与漫画构图'],
  ['period', '短剧风格', '真人风格', 6, '情绪特写与柔光'],
  ['game', '游戏动画电影感', '3D风格', 1, '明亮奇幻世界'],
  ['fashion', '时尚大片', '真人风格', 2, '高级灰与棚拍质感'],
  ['family', '温情家庭动画', '2D风格', 3, '温暖柔和的生活感'],
].map(([id, name, category, scene, description], index) => ({
  id: id as string,
  name: name as string,
  category: category as string,
  description: description as string,
  image: `/media-workspace/scene-${scene}.svg`,
  favorite: index === 2 || index === 7,
  isOwned: index > 10,
  lastUsedAt: index % 4 === 0 ? Date.now() - index * 1000 : undefined,
}));

// Extra local fixtures for scrolling through multiple pages; personal styles stay small.
const demoStyles: StyleOption[] = [...sourceStyles, ...Array.from({ length: 75 }, (_, index) => {
  const base = sourceStyles[index % sourceStyles.length];
  return { ...base, id: `demo-style-${index + 1}`, name: `${base.name} · 示例 ${index + 1}`,
    favorite: false, isOwned: false, lastUsedAt: undefined };
})];

export function StyleSelectorDemo() {
  const [styles, setStyles] = useState<StyleOption[]>(demoStyles);
  const [selectedId, setSelectedId] = useState<string | null>('film');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [created, setCreated] = useState<StyleCreateRequest | null>(null);
  const selected = useMemo(() => styles.find((style) => style.id === selectedId), [selectedId, styles]);
  const favorite = (style: StyleOption, next: boolean) => setStyles((current) => current.map((item) => item.id === style.id ? { ...item, favorite: next } : item));
  const create = (request: StyleCreateRequest) => {
    const id = `custom-${Date.now()}`;
    const next: StyleOption = { id, name: request.name, description: request.description, image: request.referenceImage ? URL.createObjectURL(request.referenceImage) : '/media-workspace/scene-6.svg', isOwned: true };
    setStyles((current) => [next, ...current]); setSelectedId(id); setCreated(request);
  };

  return <>
    <ComponentHeading title="StyleSelector" category="高级组件" description="从风格广场快速挑选、收藏并创建生成风格，适合接入图片或视频创作工作台。" action={<Badge variant="outline"><Sparkles data-icon="inline-start" />本地交互演示</Badge>} />
    <FeatureCards features={[{ title: '快速筛选', description: '集合、分类和关键词即时过滤。', icon: Palette }, { title: '选择与收藏', description: '点击卡片选择风格，收藏状态交给宿主保存。', icon: Heart }, { title: '创建向导', description: '名称、描述和参考图一步完成。', icon: Sparkles }]} />
    <Card className="demo-style-selector-card"><CardHeader><CardTitle>风格选择</CardTitle><CardDescription>90 个本地模拟风格，每页 10 个，滚动到底部自动加载；确认选择后应用。</CardDescription></CardHeader><CardContent><Button onClick={() => setPickerOpen(true)}><Sparkles data-icon="inline-start" />选择风格</Button>{selected && <span className="demo-style-trigger-value">当前：{selected.name}</span>}<StyleSelector open={pickerOpen} onOpenChange={setPickerOpen} pageSize={10} styles={styles} value={selectedId} onChange={(style) => setSelectedId(style?.id ?? null)} onFavoriteChange={favorite} onCreate={create} accentColor="#7c3aed" /></CardContent></Card>
    <Card className="mt-6"><CardHeader><CardTitle>当前选择</CardTitle><CardDescription>选择结果可以直接传给你的生成请求。</CardDescription></CardHeader><CardContent><div className="demo-style-selection"><div className="demo-style-selection-preview">{selected ? <img src={selected.image} alt="" /> : <Palette aria-hidden="true" />}</div><div><strong>{selected?.name ?? '尚未选择风格'}</strong><p>{selected?.description ?? '点击上方风格卡片开始选择。'}</p></div>{selected && <Check aria-label="已选择" />}</div>{created && <p className="demo-style-created">已创建“{created.name}”，参考图由浏览器本地预览，不会上传服务器。</p>}<Button variant="outline" className="mt-4" onClick={() => setSelectedId(null)} disabled={!selectedId}>清除选择</Button></CardContent></Card>
  </>;
}
