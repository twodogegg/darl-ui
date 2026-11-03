import { createServer } from 'node:http';
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const directory = process.env.DARL_GATEWAY_DIR;
if (!directory) throw new Error('DARL_GATEWAY_DIR is required');
const password = readFileSync(join(directory, 'password'), 'utf8').trim();
const keyPath = join(directory, 'session-key');
try { writeFileSync(keyPath, randomBytes(32), { flag: 'wx', mode: 0o600 }); } catch (error) { if (error.code !== 'EEXIST') throw error; }
const key = readFileSync(keyPath);
const digest = value => createHash('sha256').update(value).digest();
const sign = value => createHmac('sha256', key).update(value).digest('base64url');
const attempts = new Map();

function authenticated(request) {
  const cookie = (request.headers.cookie || '').split(';').map(value => value.trim()).find(value => value.startsWith('darl_session='));
  const [expires, signature] = (cookie?.slice('darl_session='.length) || '').split('.');
  if (!expires || !signature || !/^\d+$/.test(expires) || Number(expires) < Date.now()) return false;
  return timingSafeEqual(digest(signature), digest(sign(expires)));
}

function page(error = '') {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>登录 · 本入剧出</title><style>
    *{box-sizing:border-box}body{margin:0;min-height:100vh;background:#f4f2ed;color:#272723;font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif;display:grid;place-items:center;padding:24px}
    main{width:min(100%,440px)}.brand{display:flex;align-items:center;gap:11px;margin-bottom:42px}.mark{width:35px;height:35px;background:#2d493f;color:#fff;border-radius:11px;display:grid;place-items:center;font-family:serif;font-size:19px}.brand strong{display:block;font-size:16px;letter-spacing:.08em}.brand small{display:block;margin-top:3px;color:#8a8c84;font-size:9px;letter-spacing:.18em}
    .card{background:#fff;border:1px solid #e8e7df;border-radius:20px;padding:38px;box-shadow:0 18px 60px #3b453b0c}.eyebrow{font-size:10px;letter-spacing:.2em;color:#819489;font-weight:700}h1{font-size:26px;letter-spacing:.02em;margin:15px 0 10px;font-weight:650}p{font-size:14px;color:#858780;line-height:1.7;margin:0 0 30px}label{display:block;font-size:13px;font-weight:600;margin-bottom:9px}input{width:100%;height:48px;border:1px solid #dcded7;border-radius:10px;padding:0 14px;font:inherit;font-size:14px;outline:none;background:#fbfcfa;color:#242923}input:focus{border-color:#748e7f;box-shadow:0 0 0 3px #dce9e2}button{width:100%;height:48px;border:0;border-radius:10px;background:#304d40;color:white;font-size:14px;font-weight:600;cursor:pointer;margin-top:20px}button:hover{background:#263f34}button:focus-visible{outline:3px solid #a4b8a9;outline-offset:2px}.error{color:#b24c42;font-size:13px;line-height:1.5;margin:10px 0 0}.foot{color:#9da198;font-size:12px;text-align:center;margin:25px 0 0}@media(max-width:480px){.card{padding:29px 24px}.brand{margin-bottom:28px}h1{font-size:23px}}
  </style></head><body><main><div class="brand"><span class="mark">入</span><span><strong>本入剧出</strong><small>AI FILM STUDIO</small></span></div><section class="card"><span class="eyebrow">WELCOME BACK</span><h1>欢迎回来</h1><p>输入访问密码，继续你的创作。</p><form method="post" action="/login"><label for="password">访问密码</label><input id="password" name="password" type="password" autocomplete="current-password" placeholder="请输入访问密码" required autofocus>${error ? `<div class="error" role="alert">${error}</div>` : ''}<button type="submit">进入工作台</button></form></section><div class="foot">让好故事被看见</div></main></body></html>`;
}

function sendPage(response, status, error) {
  response.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'", 'X-Content-Type-Options': 'nosniff' });
  response.end(page(error));
}

createServer(async (request, response) => {
  const path = new URL(request.url || '/', 'http://localhost').pathname;
  if (path === '/verify') {
    if (authenticated(request)) { response.writeHead(204); response.end(); }
    else { response.writeHead(302, { Location: '/login', 'Cache-Control': 'no-store' }); response.end(); }
    return;
  }
  if (path !== '/login') { response.writeHead(404); response.end(); return; }
  if (request.method === 'GET') { if (authenticated(request)) { response.writeHead(303, { Location: '/studio/' }); response.end(); } else sendPage(response, 200); return; }
  if (request.method !== 'POST') { response.writeHead(405, { Allow: 'GET, POST' }); response.end(); return; }
  const ip = String(request.headers['x-real-ip'] || request.socket.remoteAddress);
  const now = Date.now();
  for (const [address, item] of attempts) if (item.until <= now) attempts.delete(address);
  const attempt = attempts.get(ip);
  if (attempt && attempt.count >= 8) { sendPage(response, 429, '尝试次数过多，请稍后再试。'); return; }
  let body = '';
  for await (const chunk of request) { body += chunk; if (body.length > 4096) { response.writeHead(413); response.end(); return; } }
  const submitted = new URLSearchParams(body).get('password') || '';
  if (!timingSafeEqual(digest(submitted), digest(password))) {
    attempts.set(ip, { count: (attempt?.count || 0) + 1, until: attempt?.until || now + 5 * 60_000 });
    sendPage(response, 401, '密码不正确，请重试。'); return;
  }
  attempts.delete(ip);
  const expires = String(now + 7 * 86400_000);
  response.writeHead(303, { Location: '/studio/', 'Set-Cookie': `darl_session=${expires}.${sign(expires)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=604800`, 'Cache-Control': 'no-store' });
  response.end();
}).listen(21642, '127.0.0.1');
