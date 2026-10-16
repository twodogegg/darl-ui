import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import '../../src/styles.css';
import './playground.css';

// http 局域网访问不是安全上下文，crypto.randomUUID 不存在，兜底为 getRandomValues 实现
if (typeof crypto.randomUUID !== 'function') {
  crypto.randomUUID = () => '10000000-1000-4000-8000-100000000000'.replace(/[018]/g, (c) => (Number(c) ^ (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (Number(c) / 4)))).toString(16)) as ReturnType<Crypto['randomUUID']>;
}

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
