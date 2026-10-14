import { spawn } from 'node:child_process';

const configs = ['vite.playground.config.ts', 'vite.agent-chat.config.ts'];
const children = configs.map((config) => spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--config', config], { stdio: 'inherit' }));
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
