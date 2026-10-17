import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { createApi } from './examples/agent-chat/server/api';

const root = fileURLToPath(new URL('.', import.meta.url));
export default defineConfig(({ mode }) => ({
  root: resolve(root, 'examples/agent-chat/client'),
  plugins: [react(), {
    name: 'agent-chat-api',
    configureServer(server) {
      const env = { ...process.env, ...loadEnv(mode, root, '') } as Record<string, string>;
      server.middlewares.use(createApi(resolve(root, '.local/agent-chat'), env, resolve(root, 'examples/agent-chat/prompts/system.md')));
    },
  }],
  resolve: { alias: [
    { find: '@darl/ui/styles.css', replacement: resolve(root, 'src/styles.css') },
    { find: '@darl/ui', replacement: resolve(root, 'src/index.ts') },
  ] },
  cacheDir: resolve(root, 'node_modules/.vite/agent-chat'),
  server: { host: '0.0.0.0', port: 5197, strictPort: true, fs: { deny: ['.env', '.env.*', '*.{crt,pem}', '**/.git/**', '**/.local/**'] } },
  build: { outDir: resolve(root, 'dist/agent-chat'), emptyOutDir: true },
}));
