// 라우터: #/ (시작) · #/c/CODE (캔버스) · #/c/CODE/report (리포트)
import { h, getUser, toast } from './dom.js';
import { landingView, joinView } from './views/landing.js';
import { canvasView } from './views/canvas.js';
import { reportView } from './views/report.js';

const root = document.getElementById('app');
let cleanup = null;

export function nav(path) {
  if (location.hash === `#${path}`) route(); else location.hash = path;
}

async function route() {
  cleanup?.();
  cleanup = null;
  document.title = 'Canvas Studio';
  const hash = location.hash.replace(/^#/, '') || '/';
  const m = hash.match(/^\/c\/([A-Za-z0-9-]+)(\/report)?\/?$/);
  root.replaceChildren();
  try {
    if (!m) { cleanup = landingView(root, nav); return; }
    const code = m[1].toUpperCase().replace(/[^A-Z0-9]/g, '');
    const user = getUser();
    if (!user.name) { cleanup = joinView(root, code, nav, route); return; }
    cleanup = await (m[2] ? reportView(root, code, user, nav) : canvasView(root, code, user, nav));
  } catch (e) {
    console.error(e);
    root.replaceChildren(h('div', { class: 'center-card' }, h('h1', null, '문제가 발생했습니다'), h('p', null, e.message), h('button', { class: 'primary', onclick: () => nav('/') }, '처음으로')));
    toast(e.message, { kind: 'err' });
  }
}

window.addEventListener('hashchange', route);
route();
