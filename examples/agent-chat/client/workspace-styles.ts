import type { MediaStyleOption } from '@darl/ui';

export type StyleRecord = {
  id: number; name: string; image_url?: string; thumbnail_url?: string; category?: string; prompt?: string;
};
export type StyleCatalog = { items?: StyleRecord[]; official_items?: StyleRecord[] };

/** Accept only shipping presets and unified file URLs; legacy storage paths are intentionally unsupported. */
export function storageImage(key?: string | null): string | undefined {
  if (!key) return undefined;
  if (/^https?:\/\//i.test(key) || /^\/api\/files\/[a-f0-9-]+(?:\?width=\d+)?$/.test(key)) return key;
  if (/^\/media-workspace\/scene-[1-6]\.svg$/.test(key)) return key;
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
