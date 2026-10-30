import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// 独立流程服务的固定冷门端口；被占用时直接失败，不自动切换。
const port = Number(process.env.VIDEO_REDRAW_FLOW_PORT || 5337)

export default defineConfig({
  plugins: [react()],
  server: { host: '0.0.0.0', port, strictPort: true },
  preview: { host: '0.0.0.0', port, strictPort: true },
  build: { outDir: 'dist' },
})
