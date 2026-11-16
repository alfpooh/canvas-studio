// Canvas Studio 서버: 정적 파일 + REST + WebSocket(실시간 공동 편집) + AI 프록시
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { WebSocketServer } from 'ws';
import { TEMPLATES } from '../public/js/shared/templates.js';
import { applyOp, OpError, newCanvas } from '../public/js/shared/ops.js';
import { canvasToMarkdown } from '../public/js/shared/markdown.js';
import { Store, normalizeCode, CODE_RE } from './store.js';
import { aiFeedback, aiReport, aiEnabled, aiModel } from './ai.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(__dirname, '..', 'public');
const PORT = Number(process.env.PORT || 3000);
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');

export const store = new Store(DATA_DIR);

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.ico': 'image/x-icon',
};

const send = (res, status, body, type = 'application/json; charset=utf-8') => {
  res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
};

function readJson(req, limit = 64 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (d) => { size += d.length; if (size > limit) { reject(new OpError('요청이 너무 큽니다.')); req.destroy(); } else chunks.push(d); });
    req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString() || '{}')); } catch { reject(new OpError('JSON 형식이 올바르지 않습니다.')); } });
    req.on('error', reject);
  });
}

// AI 호출 남용 방지: IP당 분당 20회
const hits = new Map();
function rateLimited(ip) {
  const now = Date.now();
  const h = hits.get(ip);
  if (!h || now > h.reset) { hits.set(ip, { n: 1, reset: now + 60000 }); return false; }
  return ++h.n > 20;
}

function clientIp(req) {
  return (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || '';
}

async function handleApi(req, res, url) {
  const { pathname } = url;
  try {
    if (req.method === 'GET' && pathname === '/api/config') {
      return send(res, 200, {
        ai: aiEnabled(), model: aiModel(),
        googleClientId: process.env.GOOGLE_CLIENT_ID || '',
        googleApiKey: process.env.GOOGLE_API_KEY || '',
        googleAppId: process.env.GOOGLE_APP_ID || '',
      });
    }

    if (req.method === 'POST' && pathname === '/api/canvas') {
      const b = await readJson(req);
      if (!TEMPLATES[b.template]) throw new OpError('템플릿을 선택하세요.');
      const c = store.create((code) => newCanvas({ code, title: b.title, template: b.template, owner: String(b.owner || '').slice(0, 40) }));
      return send(res, 201, { code: c.code });
    }

    const m = pathname.match(/^\/api\/canvas\/([A-Za-z0-9-]+?)(\.md|\/markdown)?$/);
    if (req.method === 'GET' && m) {
      const code = normalizeCode(m[1]);
      const c = store.get(code);
      if (!c) return send(res, 404, { error: '존재하지 않는 공유 코드입니다.' });
      if (m[2]) return send(res, 200, canvasToMarkdown(c), 'text/markdown; charset=utf-8');
      return send(res, 200, c);
    }

    if (req.method === 'POST' && (pathname === '/api/ai/feedback' || pathname === '/api/ai/report')) {
      if (rateLimited(clientIp(req))) return send(res, 429, { error: '요청이 너무 많습니다. 잠시 후 다시 시도하세요.' });
      const b = await readJson(req);
      const c = store.get(normalizeCode(b.code));
      if (!c) return send(res, 404, { error: '존재하지 않는 공유 코드입니다.' });
      if (pathname === '/api/ai/report') return send(res, 200, await aiReport(c));
      const scope = b.scope === 'block' ? 'block' : 'canvas';
      if (scope === 'block' && !TEMPLATES[c.template].blocks.some((x) => x.id === b.blockId)) throw new OpError('블록을 찾을 수 없습니다.');
      return send(res, 200, await aiFeedback(c, scope, b.blockId));
    }

    return send(res, 404, { error: 'Not found' });
  } catch (e) {
    if (e instanceof OpError) return send(res, 400, { error: e.message });
    console.error(e);
    return send(res, 502, { error: e.message || '서버 오류' });
  }
}

function serveStatic(req, res, url) {
  let rel = decodeURIComponent(url.pathname);
  if (rel === '/') rel = '/index.html';
  const file = path.normalize(path.join(PUBLIC, rel));
  if (!file.startsWith(PUBLIC + path.sep)) return send(res, 403, 'Forbidden', 'text/plain');
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) {
      // 확장자가 없는 경로만 SPA 로 폴백
      if (path.extname(rel)) return send(res, 404, 'Not found', 'text/plain');
      return fs.readFile(path.join(PUBLIC, 'index.html'), (e, buf) => send(res, e ? 500 : 200, e ? 'error' : buf, MIME['.html']));
    }
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache' });
    fs.createReadStream(file).pipe(res);
  });
}

export const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname.startsWith('/api/')) return handleApi(req, res, url);
  return serveStatic(req, res, url);
});

// ---------- 실시간 협업 (WebSocket) ----------
const rooms = new Map(); // code -> Set<client>
const wss = new WebSocketServer({ noServer: true, maxPayload: 128 * 1024 });

const COLORS = ['#e5484d', '#f76b15', '#ca8a04', '#30a46c', '#0891b2', '#3e63dd', '#8e4ec6', '#d6409f'];
const safeColor = (c) => (/^#[0-9a-fA-F]{6}$/.test(c) ? c : COLORS[Math.floor(Math.random() * COLORS.length)]);

const peersOf = (code) => [...(rooms.get(code) || [])].map((p) => ({ id: p.id, name: p.name, color: p.color, focus: p.focus, cid: p.cid }));
const broadcast = (code, msg, except = null) => {
  const data = JSON.stringify(msg);
  for (const p of rooms.get(code) || []) if (p !== except && p.ws.readyState === 1) p.ws.send(data);
};

server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname !== '/ws') return socket.destroy();
  const origin = req.headers.origin;
  if (origin) {
    try { if (new URL(origin).host !== req.headers.host) { socket.write('HTTP/1.1 403 Forbidden\r\n\r\n'); return socket.destroy(); } }
    catch { return socket.destroy(); }
  }
  wss.handleUpgrade(req, socket, head, (ws) => onConnect(ws, url));
});

function onConnect(ws, url) {
  const code = normalizeCode(url.searchParams.get('c'));
  const canvas = CODE_RE.test(code) ? store.get(code) : null;
  if (!canvas) { ws.close(4404, 'not found'); return; }

  const client = {
    ws, id: randomUUID().slice(0, 8),
    name: (url.searchParams.get('name') || '익명').trim().slice(0, 40) || '익명',
    color: safeColor(url.searchParams.get('color')),
    cid: (url.searchParams.get('cid') || '').slice(0, 40),
    focus: null, alive: true,
  };
  if (!rooms.has(code)) rooms.set(code, new Set());
  rooms.get(code).add(client);
  if (!canvas.owner) { canvas.owner = client.name; store.touch(code); }

  ws.send(JSON.stringify({ t: 'init', canvas, me: { id: client.id }, peers: peersOf(code) }));
  broadcast(code, { t: 'peers', peers: peersOf(code) });

  ws.on('pong', () => { client.alive = true; });
  ws.on('message', (raw) => {
    let m;
    try { m = JSON.parse(raw.toString()); } catch { return; }
    if (m.t === 'focus') {
      const f = m.target;
      client.focus = f && typeof f === 'object' ? { blockId: String(f.blockId || '').slice(0, 32), itemId: String(f.itemId || '').slice(0, 32) } : null;
      broadcast(code, { t: 'peers', peers: peersOf(code) });
    } else if (m.t === 'op') {
      const cur = store.get(code);
      try {
        const changed = applyOp(cur, m.op, client);
        if (changed) store.touch(code);
        // 변경이 없어도(멱등) 요청자에게 응답을 보내 대기 중인 Promise 를 풀어 준다
        const msg = { t: 'op', id: m.id, op: m.op, by: { id: client.id, name: client.name, cid: client.cid }, v: cur.version, changed };
        if (changed) broadcast(code, msg); else ws.send(JSON.stringify(msg));
      } catch (e) {
        ws.send(JSON.stringify({ t: 'error', id: m.id, message: e instanceof OpError ? e.message : '처리 중 오류가 발생했습니다.' }));
        if (!(e instanceof OpError)) console.error(e);
      }
    }
  });
  ws.on('close', () => {
    const room = rooms.get(code);
    room?.delete(client);
    if (room && !room.size) rooms.delete(code);
    else broadcast(code, { t: 'peers', peers: peersOf(code) });
  });
}

const heartbeat = setInterval(() => {
  for (const room of rooms.values()) for (const p of room) {
    if (!p.alive) { p.ws.terminate(); continue; }
    p.alive = false; p.ws.ping();
  }
}, 30000);
heartbeat.unref();

export function start(port = PORT) {
  return new Promise((resolve) => server.listen(port, () => resolve(server.address().port)));
}

const shutdown = () => { store.flushAll(); process.exit(0); };
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  start().then((p) => {
    console.log(`Canvas Studio → http://localhost:${p}`);
    console.log(`AI: ${aiEnabled() ? `Gemini (${aiModel()})` : '미연결 (GEMINI_API_KEY 없음 → 규칙 기반 점검)'}`);
    console.log(`Google: ${process.env.GOOGLE_CLIENT_ID ? '설정됨' : '미설정 (GOOGLE_CLIENT_ID 없음 → Drive/Slides 비활성)'}`);
  });
}
