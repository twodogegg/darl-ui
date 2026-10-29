import type { MediaStyleOption, StyleCreateRequest } from '@darl/ui';

export type StyleRecord = {
  id: number; name: string; image_url?: string; thumbnail_url?: string; category?: string; prompt?: string;
};
export type StyleCatalog = { items?: StyleRecord[]; official_items?: StyleRecord[] };

export async function createWorkspaceStyle(input: StyleCreateRequest): Promise<number> {
  const body = new FormData();
  body.set('name', input.name);
  body.set('prompt', input.description);
  if (input.referenceImage) body.set('reference_image', input.referenceImage);
  const response = await fetch('/api/workspace/styles', { method: 'POST', body });
  const value = await response.json();
  if (!response.ok) throw new Error(value.error || `创建风格失败（HTTP ${response.status}）`);
  return value.data.id;
}

/** Accept only shipping presets and unified file URLs; legacy storage paths are intentionally unsupported. */
export function storageImage(key?: string | null): string | undefined {
  if (!key) return undefined;
  if (/^https?:\/\//i.test(key) || /^\/api\/files\/[a-f0-9-]+(?:\?width=\d+)?$/.test(key)) return key;
  if (/^\/media-workspace\/scene-[1-6]\.svg$/.test(key)) return key;
  // 内置画风预设封面（与 RN 短剧 169 条官方风格同步），随 public/media-workspace/style-presets 一起发布。
  if (/^\/media-workspace\/style-presets\/[a-z0-9-]+\/style-\d{3}\.(jpg|png|webp)$/i.test(key)) return key;
  return undefined;
}

/**
 * Owned styles must keep `isOwned`; without it the selector's "我的风格" collection
 * can never match and owned styles leak into the official marketplace.
 */
export function styleOptionsFromCatalog(catalog: StyleCatalog): MediaStyleOption[] {
  const owned = new Set((catalog.items || []).map((item) => item.id));
  return [...(catalog.official_items || []), ...(catalog.items || [])].map((style) => ({
    id: String(style.id), name: style.name, category: style.category, description: style.prompt,
    image: storageImage(style.thumbnail_url || style.image_url), isOwned: owned.has(style.id),
  }));
}
