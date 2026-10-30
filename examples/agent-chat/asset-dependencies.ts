export type AssetDependency = { assetId: string; variantId?: string; purpose?: string };
export type DependencyImage = AssetDependency & { purpose: string; image: string; name: string };
type Asset = { id: string; projectId?: unknown; name?: unknown; image?: unknown; dependencies?: unknown; variants?: unknown; imageDependencies?: unknown };

/** Resolve the selected main/variant image, shared by the UI and generation service. */
export function resolveAssetDependencies(asset: Asset, assets: Asset[], requireImages = true): DependencyImage[] {
  return ((asset.dependencies || []) as AssetDependency[]).map(dependency => {
    const source = assets.find(item => item.id === dependency.assetId && item.projectId === asset.projectId);
    if (!source) throw new Error('依赖资产不存在或不属于当前项目');
    const variant = dependency.variantId ? (source.variants as Array<{ id: string; name: string; image?: string }> || []).find(item => item.id === dependency.variantId) : undefined;
    if (dependency.variantId && !variant) throw new Error(`${source.name} 的依赖形态已不存在`);
    const name = `${source.name}${variant ? ` / ${variant.name}` : ' / 主形象'}`;
    const image = String((variant || source).image || '');
    if (requireImages && !image) throw new Error(`请先生成依赖图片：${name}`);
    return { ...dependency, purpose: dependency.purpose || '', name, image };
  });
}
export function sameDependencyImages(left: DependencyImage[], right: DependencyImage[]): boolean {
  const signature = (items: DependencyImage[]) => JSON.stringify(items.map(item => [item.assetId, item.variantId || '', item.image, item.purpose]));
  return signature(left) === signature(right);
}
export function assetDependenciesChanged(asset: Asset, current: { imageDependencies?: unknown; [key: string]: unknown }, assets: Asset[], image: string): boolean {
  if (!image) return false;
  try {
    const saved = (current.imageDependencies as Record<string, DependencyImage[]> | undefined)?.[image] || [];
    return !sameDependencyImages(saved, resolveAssetDependencies(asset, assets));
  } catch { return true; }
}
export function validateAssetDependencies(assets: Asset[]) {
  const done = new Set<string>(), visiting = new Set<string>();
  const visit = (asset: Asset) => {
    if (visiting.has(asset.id)) throw new Error(`资产依赖不能循环引用：${asset.name}`);
    if (done.has(asset.id)) return;
    visiting.add(asset.id);
    resolveAssetDependencies(asset, assets, false);
    const seen = new Set<string>();
    for (const dependency of (asset.dependencies || []) as AssetDependency[]) {
      const key = `${dependency.assetId}:${dependency.variantId || ''}`;
      if (seen.has(key)) throw new Error('同一资产形态不能重复依赖');
      seen.add(key);
      visit(assets.find(item => item.id === dependency.assetId)!);
    }
    visiting.delete(asset.id); done.add(asset.id);
  };
  assets.forEach(visit);
}
