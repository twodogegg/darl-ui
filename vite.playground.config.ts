import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
const __dirname = fileURLToPath(new URL('.', import.meta.url));
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': resolve(__dirname, 'playground/src') } },
  root: resolve(__dirname, 'playground'),
  cacheDir: resolve(__dirname, 'node_modules/.vite/playground'),
  build: { outDir: resolve(__dirname, 'dist/demo'), emptyOutDir: true },
  server: { host: '0.0.0.0', port: 5288, strictPort: true, fs: { deny: ['.env', '.env.*', '*.{crt,pem}', '**/.git/**', '**/.local/**'] } }
});
