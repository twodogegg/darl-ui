import type { MediaStyleOption } from '@darl/ui';

export type StyleRecord = {
  id: number; name: string; image_url?: string; category?: string; prompt?: string;
};
export type StyleCatalog = { items?: StyleRecord[]; official_items?: StyleRecord[] };

/** Built-in presets ship with the demo; uploaded styles are served by the local workspace API. */
export function storageImage(key?: string | null): string | undefined {
  if (!key) return undefined;
  if (/^\/media-workspace\/scene-[1-6]\.svg$/.test(key)) return key;
  const clean = key.replace(/^\/storage\//, '');
  return clean.split('/').every((part) => /^[a-zA-Z0-9_.-]+$/.test(part) && part !== '..' && part !== '.') ?
    '/api/workspace/storage/' + clean.split('/').map(encodeURIComponent).join('/') : undefined;
}

/**
 * Owned styles must keep `isOwned`; without it the selector's "我的风格" collection
 * can never match and owned styles leak into the official marketplace.
 */
export function styleOptionsFromCatalog(catalog: StyleCatalog): MediaStyleOption[] {
  const owned = new Set((catalog.items || []).map((item) => item.id));
  return [...(catalog.official_items || []), ...(catalog.items || [])].map((style) => ({
    id: String(style.id), name: style.name, category: style.category, description: style.prompt,
    image: storageImage(style.image_url), isOwned: owned.has(style.id),
  }));
}
