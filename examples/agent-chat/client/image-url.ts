export type ImageWidth = 160 | 320 | 640 | 1024;

/** Derive a display URL; callers keep the original URL for storage, downloads and AI input. */
export function imageUrl(value: string | undefined, width: ImageWidth = 320): string | undefined {
  if (!value || /^(?:data|blob):/i.test(value)) return value;
  let url: URL;
  try { url = new URL(value, 'http://localhost'); } catch { return value; }
  if (/^\/api\/files\/[^/]+$/.test(url.pathname)) {
    url.searchParams.set('width', String(width));
    return value.startsWith('/') ? `${url.pathname}${url.search}${url.hash}` : url.href;
  }
  if (!/^https?:$/.test(url.protocol) || !(/\.cos\.[\w-]+\.myqcloud\.com$/.test(url.hostname) || /\/[a-f0-9]{64}\.(?:png|jpe?g|webp|gif)$/i.test(url.pathname))) return value;
  const params = [...url.searchParams].filter(([key]) => !key.startsWith('imageMogr2'));
  const search = new URLSearchParams(params).toString();
  return `${url.origin}${url.pathname}?${search ? `${search}&` : ''}imageMogr2/thumbnail/${width}x/quality/80/format/webp${url.hash}`;
}
