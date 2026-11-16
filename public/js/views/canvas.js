// 캔버스 편집 화면: 상단바 + 보드(블록/항목 실시간 편집) + 사이드 패널
import { h, icon, toast, openModal, api, autosize, debounce, createBus, initials, rememberCanvas, fmtTime } from '../dom.js';
import { TEMPLATES } from '../shared/templates.js';
import { uid } from '../shared/ops.js';
import { formatCode, commentCounts } from '../shared/markdown.js';
import { fallbackReport } from '../shared/report.js';
import { Session } from '../session.js';
import { mountPanel } from '../panel.js';
import { openShareModal, openDriveModal } from '../modals.js';
import { DriveSync } from '../google.js';

export async function canvasView(root, code, user, nav) {
  const config = await api('/api/config').catch(() => ({}));
  const session = new Session(code, user);
  const bus = createBus();
  const ctx = { code, user, session, bus, config, nav, ui: { scope: null }, get canvas() { return session.canvas; } };
  const drive = new DriveSync(ctx);
  ctx.drive = drive;

  root.replaceChildren(h('div', { class: 'center-card' }, h('p', { class: 'muted' }, '캔버스에 연결하는 중…')));
  const offs = [];
  let built = false;
  const els = { blocks: {} };
  const pendingText = new Set(); // 내가 입력 중이라 서버 값으로 덮어쓰면 안 되는 항목
  const updaters = new Map();
  let focusAfterAdd = null;
  let panel;

  session.on('notfound', () => {
    root.replaceChildren(h('div', { class: 'center-card' }, h('h1', null, '캔버스를 찾을 수 없습니다'),
      h('p', null, '공유 코드를 다시 확인하세요.'), h('button', { class: 'primary', onclick: () => nav('/') }, '처음으로')));
  });
  session.on('error', (msg) => toast(msg, { kind: 'err' }));
  session.on('init', () => { built ? refreshAll() : build(); });
  session.on('status', updateConn);
  session.on('peers', () => { updatePeers(); updateLocks(); });
  session.on('op', onOp);
  session.connect();

  const tpl = () => TEMPLATES[ctx.canvas.template];
  const isFinal = () => ctx.canvas.status === 'final';

  // ---------- 구성 ----------
  function build() {
    built = true;
    const c = ctx.canvas;
    rememberCanvas(c.code, c.title, c.template);
    document.title = `${c.title} · Canvas Studio`;

    els.title = h('input', { class: 'title-input', value: c.title, maxLength: 120, 'aria-label': '캔버스 제목',
      oninput: debounce((e) => session.send({ type: 'meta.title', title: e.target.value }).catch(() => {}), 500) });
    els.status = h('span', { class: 'chip' });
    els.conn = h('span', { class: 'chip conn' });
    els.drive = h('button', { class: 'chip drive', hidden: true, onclick: () => openDriveModal(ctx) });
    els.peers = h('div', { class: 'peers', 'aria-label': '접속 중인 작업자' });
    els.finalizeBtn = h('button', { class: 'primary', onclick: onFinalizeClick });
    els.reopenBtn = h('button', { class: 'ghost', onclick: reopen }, icon('reopen'), '다시 열기');
    els.banner = h('div', { class: 'banner', hidden: true });

    const top = h('header', { class: 'topbar' },
      h('a', { class: 'brand sm', href: '#/', title: '처음으로' }, h('span', { class: 'logo' })),
      h('div', { class: 'title-wrap' }, els.title, h('div', { class: 'sub' }, `${tpl().name} · `, h('button', { class: 'code-btn', title: '공유 코드', onclick: () => openShareModal(ctx) }, formatCode(c.code)))),
      els.status, els.conn, els.drive,
      h('div', { class: 'spacer' }),
      els.peers,
      h('button', { class: 'ghost', onclick: () => openShareModal(ctx) }, icon('share'), h('span', { class: 'lbl' }, '공유')),
      h('button', { class: 'ghost', onclick: () => openDriveModal(ctx) }, icon('drive'), h('span', { class: 'lbl' }, 'Drive')),
      h('button', { class: 'ghost', onclick: () => panel.askCanvasFeedback() }, icon('sparkle'), h('span', { class: 'lbl' }, 'AI 피드백')),
      els.reopenBtn, els.finalizeBtn);

    els.grid = h('div', { class: 'grid', style: { gridTemplateAreas: tpl().areas.map((r) => `"${r}"`).join(' ') } },
      tpl().blocks.map(makeBlock));
    panel = mountPanel(ctx, { flash });
    els.panel = panel.el;

    root.replaceChildren(h('div', { class: 'app' }, top, els.banner,
      h('div', { class: 'workspace' }, h('main', { class: 'board' }, els.grid), els.panel)));
    refreshAll();

    drive.onChange(updateDrive);
    drive.init();
    offs.push(() => drive.dispose());
    if (sessionStorage.getItem('cs.justCreated') === code) {
      sessionStorage.removeItem('cs.justCreated');
      openShareModal(ctx, { first: true });
    }
  }

  function refreshAll() {
    tpl().blocks.forEach((b) => reconcileBlock(b.id));
    els.title.value !== ctx.canvas.title && document.activeElement !== els.title && (els.title.value = ctx.canvas.title);
    updateTopbar(); updatePeers(); updateLocks(); updateBadges(); updateConn({ connected: session.connected });
    panel.refresh();
    drive.schedule();
  }

  function makeBlock(b) {
    const list = h('div', { class: 'items' });
    const count = h('span', { class: 'badge', hidden: true });
    const addBtn = h('button', { class: 'add', onclick: () => addItem(b.id) }, icon('plus', 14), '항목 추가');
    const el = h('section', { class: 'block', dataset: { block: b.id, tone: b.tone }, style: { gridArea: b.id } },
      h('header', null,
        h('span', { class: 'no' }, b.no),
        h('h3', null, b.name, h('small', null, b.en)),
        h('div', { class: 'bactions' },
          h('button', { class: 'icon-btn', title: 'AI 피드백', 'aria-label': `${b.name} AI 피드백`, onclick: () => panel.askBlockFeedback(b.id) }, icon('sparkle', 15)),
          h('button', { class: 'icon-btn', title: '코멘트', 'aria-label': `${b.name} 코멘트`, onclick: () => openScope({ blockId: b.id }) }, icon('comment', 15), count))),
      h('p', { class: 'hint' }, b.hint), list, addBtn);

    list.addEventListener('dragover', (e) => { if (isFinal()) return; e.preventDefault(); el.classList.add('drop'); });
    list.addEventListener('dragleave', () => el.classList.remove('drop'));
    list.addEventListener('drop', (e) => {
      e.preventDefault(); el.classList.remove('drop');
      const id = e.dataTransfer.getData('text/plain');
      if (!id || isFinal()) return;
      const others = [...list.children].filter((x) => x.dataset.id !== id);
      let index = others.findIndex((x) => { const r = x.getBoundingClientRect(); return e.clientY < r.top + r.height / 2; });
      if (index < 0) index = others.length;
      session.send({ type: 'item.move', itemId: id, toBlock: b.id, index }).catch((err) => toast(err.message, { kind: 'err' }));
    });
    els.blocks[b.id] = { el, list, count, addBtn };
    return el;
  }

  function makeItem(blockId, it) {
    const ta = h('textarea', { rows: 1, maxLength: 1000, placeholder: '내용을 입력하세요', 'aria-label': `${TEMPLATES[ctx.canvas.template].blocks.find((b) => b.id === blockId).name} 항목` });
    const handle = h('span', { class: 'handle', title: '끌어서 이동', 'aria-hidden': 'true' }, '⋮⋮');
    const cBtn = h('button', { class: 'icon-btn sm', title: '이 항목에 코멘트', 'aria-label': '이 항목에 코멘트' }, icon('comment', 13), h('span', { class: 'badge', hidden: true }));
    const dBtn = h('button', { class: 'icon-btn sm danger', title: '삭제', 'aria-label': '항목 삭제', onclick: () => removeItem(it.id) }, icon('trash', 13));
    const by = h('span', { class: 'by' });
    const lock = h('span', { class: 'lock-tag', hidden: true });
    const el = h('article', { class: 'item', dataset: { id: it.id } }, handle, ta,
      h('div', { class: 'imeta' }, by, h('div', { class: 'iactions' }, cBtn, dBtn)), lock);

    cBtn.onclick = () => {
      const cur = ctx.canvas.blocks[el.dataset.block || blockId]?.items.find((x) => x.id === it.id);
      openScope({ blockId: el.dataset.block || blockId, itemId: it.id, quote: (cur?.text || ta.value).slice(0, 120) });
    };

    const send = debounce(() => session.send({ type: 'item.update', itemId: it.id, text: ta.value }).catch((e) => toast(e.message, { kind: 'err' })), 250);
    updaters.set(it.id, send);
    ta.addEventListener('input', () => { autosize(ta); pendingText.add(it.id); send(); });
    ta.addEventListener('focus', () => session.focus({ blockId: el.dataset.block || blockId, itemId: it.id }));
    ta.addEventListener('blur', async () => {
      session.focus(null);
      const curBlock = el.dataset.block || blockId;
      if (ta.value.trim() === '') { pendingText.delete(it.id); send.cancel(); session.send({ type: 'item.delete', itemId: it.id }).catch(() => {}); return; }
      send.flush();
      try { await session.send({ type: 'item.update', itemId: it.id, text: ta.value }); } catch { /* 이미 전송됨 */ }
      pendingText.delete(it.id);
      const cur = ctx.canvas.blocks[curBlock]?.items.find((x) => x.id === it.id);
      if (cur && cur.text !== ta.value) { ta.value = cur.text; autosize(ta); }
    });
    ta.addEventListener('keydown', (e) => {
      if (e.isComposing) return;
      if (e.key === 'Enter' && !e.shiftKey && ta.value.trim()) {
        e.preventDefault();
        const b = el.dataset.block || blockId;
        addItem(b, ctx.canvas.blocks[b].items.findIndex((x) => x.id === it.id) + 1);
      }
    });
    handle.addEventListener('mousedown', () => { if (!isFinal() && !el.classList.contains('locked')) el.draggable = true; });
    el.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/plain', it.id); e.dataTransfer.effectAllowed = 'move'; el.classList.add('dragging'); });
    el.addEventListener('dragend', () => { el.draggable = false; el.classList.remove('dragging'); document.querySelectorAll('.block.drop').forEach((x) => x.classList.remove('drop')); });
    return el;
  }

  function reconcileBlock(blockId) {
    const { list } = els.blocks[blockId];
    const items = ctx.canvas.blocks[blockId].items;
    const keep = new Set(items.map((i) => i.id));
    for (const el of [...list.children]) if (!keep.has(el.dataset.id)) { updaters.delete(el.dataset.id); el.remove(); }
    const existing = new Map([...list.children].map((el) => [el.dataset.id, el]));
    items.forEach((it, i) => {
      let el = existing.get(it.id);
      if (!el) el = makeItem(blockId, it);
      el.dataset.block = blockId;
      if (list.children[i] !== el) list.insertBefore(el, list.children[i] || null);
      const ta = el.querySelector('textarea');
      if (document.activeElement !== ta && !pendingText.has(it.id) && ta.value !== it.text) ta.value = it.text;
      requestAnimationFrame(() => autosize(ta));
      el.querySelector('.by').textContent = it.by ? `${it.by}` : '';
      el.querySelector('.by').title = it.at ? fmtTime(it.at) : '';
    });
  }

  function addItem(blockId, index) {
    if (isFinal()) return;
    const id = uid();
    focusAfterAdd = id;
    session.send({ type: 'item.add', blockId, itemId: id, text: '', index }).catch((e) => { focusAfterAdd = null; toast(e.message, { kind: 'err' }); });
  }
  function removeItem(id) {
    pendingText.delete(id);
    session.send({ type: 'item.delete', itemId: id }).catch((e) => toast(e.message, { kind: 'err' }));
  }

  function openScope(scope) { ctx.ui.scope = scope; bus.emit('scope'); panel.showTab('comments'); }

  function flash(blockId, itemId) {
    const b = els.blocks[blockId]; if (!b) return;
    const target = (itemId && b.list.querySelector(`[data-id="${itemId}"]`)) || b.el;
    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    target.classList.remove('flash'); void target.offsetWidth; target.classList.add('flash');
    setTimeout(() => target.classList.remove('flash'), 1800);
  }

  // ---------- 상태 갱신 ----------
  function onOp({ op, by, mine, changed }) {
    if (!changed) return;
    const t = op.type;
    if (t.startsWith('item.')) {
      const f = (id) => tpl().blocks.find((b) => ctx.canvas.blocks[b.id].items.some((i) => i.id === id))?.id;
      const touched = new Set([op.blockId, op.toBlock, op.itemId && f(op.itemId)].filter(Boolean));
      if (t === 'item.delete' || t === 'item.move') tpl().blocks.forEach((b) => touched.add(b.id)); // 이전 블록 정리
      touched.forEach(reconcileBlock);
      if (t === 'item.add' && mine && focusAfterAdd === op.itemId) {
        focusAfterAdd = null;
        els.blocks[op.blockId].list.querySelector(`[data-id="${op.itemId}"] textarea`)?.focus();
      }
      if (t === 'item.update' && !mine) {
        const ta = els.blocks[f(op.itemId)]?.list.querySelector(`[data-id="${op.itemId}"] textarea`);
        if (ta && document.activeElement === ta) toast(`${by.name}님이 이 항목을 수정했습니다. 포커스를 벗어나면 반영됩니다.`, { ms: 2500 });
      }
      updateBadges(); updateLocks();
    } else if (t === 'meta.title') {
      document.title = `${ctx.canvas.title} · Canvas Studio`;
      if (document.activeElement !== els.title) els.title.value = ctx.canvas.title;
    } else if (t.startsWith('comment.')) {
      updateBadges();
    } else if (t === 'canvas.finalize') {
      updateTopbar(); updateLocks();
      if (!mine) toast(`${by.name}님이 최종 확정했습니다. 리포트를 생성하는 중입니다.`);
    } else if (t === 'canvas.reopen') {
      updateTopbar(); updateLocks();
      if (!mine) toast(`${by.name}님이 캔버스를 다시 열었습니다.`);
    } else if (t === 'report.set') {
      updateTopbar();
      if (!mine) toast('리포트가 생성되었습니다.', { kind: 'ok', action: { label: '보기', run: () => nav(`/c/${code}/report`) } });
    }
    panel.onOp({ op, by, mine });
    drive.schedule();
  }

  function updateTopbar() {
    const fin = isFinal();
    els.status.textContent = fin ? '최종 확정' : '초안';
    els.status.className = `chip ${fin ? 'final' : 'draft'}`;
    els.reopenBtn.hidden = !fin;
    els.finalizeBtn.replaceChildren(...(fin ? [icon('doc'), '리포트 보기'] : [icon('check'), '최종 확정']));
    els.banner.hidden = !fin;
    els.banner.replaceChildren(...(fin ? [icon('lock'), h('span', null, `${ctx.canvas.finalizedBy || '누군가'}님이 최종 확정했습니다. 편집이 잠겨 있습니다.`)] : []));
    els.grid.classList.toggle('final', fin);
  }

  function updateConn({ connected }) {
    if (!els.conn) return;
    els.conn.textContent = connected ? '실시간 연결됨' : '재연결 중…';
    els.conn.className = `chip conn ${connected ? 'on' : 'off'}`;
  }

  function updateDrive(s) {
    els.drive.hidden = s.status === 'off';
    const label = { saving: 'Drive 저장 중…', ok: `Drive 저장됨 ${s.lastSync ? new Date(s.lastSync).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' }) : ''}`, error: 'Drive 오류', idle: 'Drive 대기', needauth: 'Drive 재연결 필요' }[s.status] || '';
    els.drive.textContent = label;
    els.drive.className = `chip drive ${s.status}`;
    els.drive.title = s.error || '';
  }

  function updatePeers() {
    const me = session.me?.id;
    const peers = [...session.peers].sort((a) => (a.id === me ? -1 : 1));
    const nodes = peers.slice(0, 6).map((p) => h('span', { class: 'avatar', style: { background: p.color }, title: p.id === me ? `${p.name} (나)` : p.name }, initials(p.name)));
    if (peers.length > 6) nodes.push(h('span', { class: 'avatar more' }, `+${peers.length - 6}`));
    els.peers.replaceChildren(...nodes);
  }

  function updateLocks() {
    const me = session.me?.id;
    const fin = isFinal();
    for (const b of tpl().blocks) {
      const { list, addBtn } = els.blocks[b.id];
      addBtn.disabled = fin;
      for (const el of list.children) {
        const peer = session.peers.find((p) => p.id !== me && p.focus?.itemId === el.dataset.id);
        const ta = el.querySelector('textarea');
        ta.readOnly = fin || !!peer;
        el.classList.toggle('locked', !!peer);
        el.style.setProperty('--peer', peer ? peer.color : 'transparent');
        const tag = el.querySelector('.lock-tag');
        tag.hidden = !peer;
        tag.textContent = peer ? `${peer.name} 편집 중` : '';
        el.querySelector('.danger').disabled = fin || !!peer;
      }
    }
  }

  function updateBadges() {
    const byBlock = {}; const byItem = {};
    for (const cm of ctx.canvas.comments) {
      if (cm.status !== 'open') continue;
      if (cm.blockId) byBlock[cm.blockId] = (byBlock[cm.blockId] || 0) + 1;
      if (cm.itemId) byItem[cm.itemId] = (byItem[cm.itemId] || 0) + 1;
    }
    for (const b of tpl().blocks) {
      const { count, list } = els.blocks[b.id];
      const n = byBlock[b.id] || 0;
      count.hidden = !n; count.textContent = n;
      for (const el of list.children) {
        const bd = el.querySelector('.iactions .badge'); const k = byItem[el.dataset.id] || 0;
        bd.hidden = !k; bd.textContent = k;
        el.classList.toggle('has-comment', k > 0);
      }
    }
  }

  // ---------- 최종 확정 / 다시 열기 ----------
  function onFinalizeClick() { isFinal() ? nav(`/c/${code}/report`) : confirmFinalize(); }

  function confirmFinalize() {
    const c = ctx.canvas;
    const empty = tpl().blocks.filter((b) => !c.blocks[b.id].items.length);
    const n = commentCounts(c);
    let close;
    const go = h('button', { class: 'primary', onclick: async () => { go.disabled = true; go.textContent = '리포트 생성 중…'; await runFinalize(); close(); } }, icon('check'), '최종 확정하고 리포트 만들기');
    close = openModal('최종 확정', h('div', { class: 'stack-sm' },
      h('p', null, '확정하면 모든 작업자의 편집이 잠기고, 캔버스와 코멘트 기록을 바탕으로 요약·액션 아이템 리포트가 만들어집니다. 필요하면 나중에 "다시 열기"로 수정할 수 있습니다.'),
      empty.length ? h('p', { class: 'warn' }, `아직 비어 있는 블록: ${empty.map((b) => b.name).join(', ')}`) : null,
      n.open ? h('p', { class: 'warn' }, `열린 코멘트 ${n.open}건이 리포트에 "미해결"로 포함됩니다.`) : null,
      h('div', { class: 'actions' }, h('button', { class: 'ghost', onclick: () => close() }, '취소'), go)));
  }

  async function runFinalize() {
    try {
      await session.send({ type: 'canvas.finalize' });
    } catch (e) { return toast(e.message, { kind: 'err' }); }
    let report;
    try { report = await api('/api/ai/report', { code }); }
    catch (e) { toast(`AI 리포트 생성에 실패해 기본 리포트로 대체합니다. (${e.message})`, { kind: 'err' }); report = fallbackReport(ctx.canvas); }
    try { await session.send({ type: 'report.set', report }); } catch (e) { toast(e.message, { kind: 'err' }); }
    nav(`/c/${code}/report`);
  }

  async function reopen() {
    if (!confirm('다시 열면 현재 리포트가 삭제되고 편집할 수 있게 됩니다. 계속할까요?')) return;
    session.send({ type: 'canvas.reopen' }).catch((e) => toast(e.message, { kind: 'err' }));
  }

  return () => { offs.forEach((f) => f()); session.close(); };
}
