import type { IncomingMessage, ServerResponse } from 'node:http';

/**
 * 为打包后的静态资源补充可长期缓存的响应头。
 *
 * Vite 产物文件名带内容哈希（`/assets/index-<hash>.js`），但 preview 默认给出 `max-age=14400` 且带
 * `vary: Origin`，导致 Cloudflare 每次回源校验（cf-cache-status 停在 MISS / REVALIDATED），隧道访问时
 * 首屏反复拉取。这里把 `/assets/` 下的哈希资源标记为 immutable，并去掉会破坏共享缓存的 `vary: Origin`。
 *
 * 静态中间件通过 `setHeader` 写头、由 Node 隐式发出 head，因此拦截 `setHeader` 而不是 `writeHead`。
 */
const HASHED_ASSET = /^\/assets\//i;

export function immutableAssets() {
  return (request: IncomingMessage, response: ServerResponse, next: () => void) => {
    if (!HASHED_ASSET.test((request.url || '').split('?')[0])) return next();
    // CORS 中间件在插件钩子之前已写入 `Vary: Origin`，这里先清掉再拦截后续写入。
    response.removeHeader('Vary');
    const setHeader = response.setHeader.bind(response);
    response.setHeader = ((name: string, value: number | string | readonly string[]) => {
      const key = name.toLowerCase();
      if (key === 'vary') return response;
      if (key === 'cache-control') return setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      return setHeader(name, value);
    }) as typeof response.setHeader;
    next();
  };
}
