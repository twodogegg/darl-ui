import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { defineConfig, loadEnv, type ViteDevServer, type PreviewServer } from 'vite';
import react from '@vitejs/plugin-react';
import { createApi } from './examples/agent-chat/server/api';
import { gzipApiResponses } from './examples/agent-chat/server/http-compress';
import { immutableAssets } from './examples/agent-chat/server/static-cache';

const root = fileURLToPath(new URL('.', import.meta.url));
const parseHosts = (value?: string) =>
  (value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

/** 服务端 API 中间件在 dev 与 preview（生产静态产物）两种模式下共用同一实例创建逻辑。 */
function agentChatApi(mode: string) {
  return (server: ViteDevServer | PreviewServer) => {
    const env = { ...process.env, ...loadEnv(mode, root, '') } as Record<string, string>;
    const api = createApi(resolve(root, '.local/agent-chat'), env, resolve(root, 'examples/agent-chat/prompts/system.md'));
    // 顺序：先给哈希静态资源打长缓存，再压缩 API 响应，最后交给业务中间件。
    server.middlewares.use(immutableAssets());
    server.middlewares.use(gzipApiResponses());
    server.middlewares.use(api);
    server.httpServer?.once('close', () => api.dispose());
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, root, '');
  const allowedHosts = parseHosts(env.AGENT_CHAT_ALLOWED_HOSTS);
  const fsDeny = ['.env', '.env.*', '*.{crt,pem}', '**/.git/**', '**/.local/**'];
  return {
    root: resolve(root, 'examples/agent-chat/client'),
    plugins: [react(), {
      name: 'agent-chat-api',
      configureServer: agentChatApi(mode),
      configurePreviewServer: agentChatApi(mode),
    }],
    resolve: { alias: [
      { find: '@darl/ui/styles.css', replacement: resolve(root, 'src/styles.css') },
      { find: '@darl/ui', replacement: resolve(root, 'src/index.ts') },
    ] },
    cacheDir: resolve(root, 'node_modules/.vite/agent-chat'),
    server: { host: '0.0.0.0', port: Number(env.AGENT_CHAT_PORT || 5197), strictPort: true, allowedHosts, fs: { deny: fsDeny } },
    // preview 直接服务 build 产物：首屏只有打包后的少量资源，适合通过隧道/反代对外访问。
    preview: { host: '0.0.0.0', port: Number(env.AGENT_CHAT_PREVIEW_PORT || 5199), strictPort: true, allowedHosts, fs: { deny: fsDeny } },
    build: { outDir: resolve(root, 'dist/agent-chat'), emptyOutDir: true },
  };
});
