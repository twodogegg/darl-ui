import { spawn } from 'node:child_process';

const configs = ['vite.playground.config.ts', 'vite.agent-chat.config.ts'];
const children = configs.map((config) => spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--config', config], { stdio: 'inherit' }));
children.push(spawn('bun', ['run', 'dev', '--hostname', '127.0.0.1', '--port', '5310'], { cwd: 'external/opencut-classic/apps/web', stdio: 'inherit', env: { ...process.env, OPENCUT_BASE_PATH: '/opencut', NEXT_PUBLIC_MARBLE_API_URL: process.env.NEXT_PUBLIC_MARBLE_API_URL || 'https://api.marblecms.com', DATABASE_URL: process.env.OPENCUT_DATABASE_URL || 'postgresql://opencut:opencut@localhost:5432/opencut', BETTER_AUTH_SECRET: process.env.OPENCUT_BETTER_AUTH_SECRET || 'development-only', UPSTASH_REDIS_REST_URL: process.env.OPENCUT_REDIS_URL || 'http://localhost:8079', UPSTASH_REDIS_REST_TOKEN: process.env.OPENCUT_REDIS_TOKEN || 'development-only', MARBLE_WORKSPACE_KEY: process.env.OPENCUT_MARBLE_WORKSPACE_KEY || 'development-only', FREESOUND_CLIENT_ID: process.env.OPENCUT_FREESOUND_CLIENT_ID || 'development-only', FREESOUND_API_KEY: process.env.OPENCUT_FREESOUND_API_KEY || 'development-only' } }));
let stopping = false;
function stop(code) {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill('SIGTERM');
  process.exitCode = code;
}
for (const child of children) {
  child.on('error', () => stop(1));
  child.on('exit', (code) => stop(code ?? 1));
}
process.on('SIGINT', () => stop(0));
process.on('SIGTERM', () => stop(0));
