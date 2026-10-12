import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
const __dirname = fileURLToPath(new URL('.', import.meta.url));
export default defineConfig({
  build: {
    outDir: 'dist/lib',
    emptyOutDir: true,
    lib: {
      entry: resolve(__dirname, 'src/index.ts'),
      name: 'DarlUI',
      formats: ['es', 'cjs'],
      fileName: (format) => format === 'es' ? 'index.js' : 'index.cjs',
      cssFileName: 'darl-ui'
    },
    rollupOptions: { external: ['react', 'react-dom', 'react/jsx-runtime'] }
  }
});
