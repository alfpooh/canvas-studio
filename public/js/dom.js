// 아주 작은 DOM 헬퍼 / 토스트 / 모달 / 공용 유틸
export function h(tag, props, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k.startsWith('on')) el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k in el && k !== 'list') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  const add = (c) => {
    if (c == null || c === false) return;
    if (Array.isArray(c)) c.forEach(add);
    else el.append(c.nodeType ? c : document.createTextNode(String(c)));
  };
  children.forEach(add);
  return el;
}

const ICONS = {
  comment: '<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12Z"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  sparkle: '<path d="M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8zM19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"/>',
  share: '<path d="M4 12v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7M12 3v12M8 7l4-4 4 4"/>',
  drive: '<path d="M8 3h8l6 10-4 7H6l-4-7zM8 3l6 10h8M2 13h12l4 7"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  lock: '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  doc: '<path d="M7 3h7l5 5v13H7zM14 3v5h5M10 13h6M10 17h6"/>',
  back: '<path d="M15 5l-7 7 7 7"/>',
  print: '<path d="M7 9V3h10v6M7 17H4v-7h16v7h-3M7 14h10v7H7z"/>',
  slides: '<rect x="3" y="5" width="18" height="12" rx="2"/><path d="M8 21h8M12 17v4"/>',
  copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h9"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/>',
  reopen: '<path d="M4 12a8 8 0 1 0 3-6.2M4 4v4h4"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
};

export function icon(name, size = 16) {
  const s = document.createElement('span');
  s.className = 'ico';
  s.innerHTML = `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ''}</svg>`;
  return s;
}

export function toast(message, { kind = 'info', action, ms = 4000 } = {}) {
  const box = document.getElementById('toasts');
  const t = h('div', { class: `toast ${kind}`, role: 'status' }, h('span', null, message));
  if (action) t.append(h('button', { class: 'link', onclick: () => { action.run(); t.remove(); } }, action.label));
  box.append(t);
  setTimeout(() => t.remove(), action ? Math.max(ms, 9000) : ms);
}

/** 모달. content 는 Node, 반환값 close() */
export function openModal(title, content, { wide = false, onClose } = {}) {
  const prev = document.activeElement;
  const close = () => { back.remove(); document.removeEventListener('keydown', onKey); prev?.focus?.(); onClose?.(); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  const back = h('div', { class: 'modal-back', onmousedown: (e) => { if (e.target === back) close(); } },
    h('div', { class: `modal${wide ? ' wide' : ''}`, role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
      h('header', null, h('h2', null, title), h('button', { class: 'icon-btn', 'aria-label': '닫기', onclick: close }, icon('x'))),
      h('div', { class: 'modal-body' }, content)));
  document.body.append(back);
  document.addEventListener('keydown', onKey);
  back.querySelector('input,textarea,button.primary')?.focus();
  return close;
}

export const fmtTime = (t) => new Date(t).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
export const fmtDate = (t) => new Date(t).toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' });
export const initials = (name) => (String(name).trim()[0] || '?').toUpperCase();

const PALETTE = ['#e5484d', '#f76b15', '#ca8a04', '#30a46c', '#0891b2', '#3e63dd', '#8e4ec6', '#d6409f'];
export const colorFor = (name) => {
  let n = 0; for (const ch of String(name)) n = (n * 31 + ch.charCodeAt(0)) >>> 0;
  return PALETTE[n % PALETTE.length];
};
export const randomColor = () => PALETTE[Math.floor(Math.random() * PALETTE.length)];

export function autosize(ta) {
  ta.style.height = 'auto';
  ta.style.height = `${ta.scrollHeight}px`;
}

export function debounce(fn, ms) {
  let t;
  const d = (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
  d.flush = (...a) => { clearTimeout(t); fn(...a); };
  d.cancel = () => clearTimeout(t);
  return d;
}

export function createBus() {
  const m = new Map();
  return {
    on(ev, fn) { (m.get(ev) || m.set(ev, new Set()).get(ev)).add(fn); return () => m.get(ev)?.delete(fn); },
    emit(ev, p) { m.get(ev)?.forEach((fn) => fn(p)); },
  };
}

export async function copyText(text) {
  try { await navigator.clipboard.writeText(text); toast('복사했습니다.', { kind: 'ok', ms: 1800 }); }
  catch { prompt('복사하세요:', text); }
}

export function downloadText(filename, text, type = 'text/markdown;charset=utf-8') {
  const a = h('a', { href: URL.createObjectURL(new Blob([text], { type })), download: filename });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export async function api(path, body) {
  const res = await fetch(path, body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : undefined);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `요청 실패 (${res.status})`);
  return data;
}

// ---- 로컬 사용자 정보 ----
const LS = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* 저장 불가 환경 */ } },
};
export { LS };

export function getUser() {
  let u = LS.get('cs.user', null);
  if (!u) { u = { cid: crypto.randomUUID().slice(0, 12), name: '', color: randomColor() }; LS.set('cs.user', u); }
  return u;
}
export function saveUser(patch) { const u = { ...getUser(), ...patch }; LS.set('cs.user', u); return u; }

export function rememberCanvas(code, title, template) {
  const list = LS.get('cs.recent', []).filter((x) => x.code !== code);
  list.unshift({ code, title, template, at: Date.now() });
  LS.set('cs.recent', list.slice(0, 8));
}
