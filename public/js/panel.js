// 사이드 패널: 코멘트(Resolve/Close/Reply) · AI 피드백(적용) · Markdown 미리보기
import { h, icon, toast, api, fmtTime, initials, colorFor, copyText, downloadText } from './dom.js';
import { TEMPLATES } from './shared/templates.js';
import { uid } from './shared/ops.js';
import { canvasToMarkdown, STATUS_LABEL } from './shared/markdown.js';

export function mountPanel(ctx, { flash }) {
  const { session } = ctx;
  const st = { tab: 'comments', filter: 'open', ai: { loading: false, error: '', result: null, scopeLabel: '', applied: new Set(), dismissed: new Set() } };
  const tpl = () => TEMPLATES[ctx.canvas.template];
  const names = () => Object.fromEntries(tpl().blocks.map((b) => [b.id, b.name]));
  const drafts = {};
  const fin = () => ctx.canvas.status === 'final';

  const tabs = h('div', { class: 'tabs', role: 'tablist' });
  const body = h('div', { class: 'tab-body' });
  const el = h('aside', { class: 'panel', 'aria-label': '사이드 패널' }, tabs, body);

  function renderTabs() {
    const open = ctx.canvas.comments.filter((c) => c.status === 'open').length;
    tabs.replaceChildren(
      ...[['comments', '코멘트', open], ['ai', 'AI 피드백', 0], ['md', 'Markdown', 0]].map(([id, label, n]) =>
        h('button', { role: 'tab', class: st.tab === id ? 'on' : '', 'aria-selected': st.tab === id, onclick: () => showTab(id) }, label, n ? h('span', { class: 'badge' }, n) : null)));
  }

  function showTab(t) { st.tab = t; render(); }

  function render() {
    // 입력 중이던 답글/작성 칸의 포커스·내용을 보존
    const active = document.activeElement;
    const keep = active && body.contains(active) && active.dataset?.draft ? { key: active.dataset.draft, s: active.selectionStart, e: active.selectionEnd } : null;
    renderTabs();
    body.replaceChildren(st.tab === 'comments' ? commentsView() : st.tab === 'ai' ? aiView() : mdView());
    if (keep) { const t = body.querySelector(`[data-draft="${keep.key}"]`); if (t) { t.focus(); t.setSelectionRange(keep.s, keep.e); } }
  }

  // ---------------- 코멘트 ----------------
  function commentsView() {
    const c = ctx.canvas;
    const scope = ctx.ui.scope;
    const nm = names();
    const counts = { all: c.comments.length, open: 0, resolved: 0, closed: 0 };
    c.comments.forEach((x) => { counts[x.status] += 1; });

    const composer = h('textarea', { rows: 3, maxLength: 4000, placeholder: scope ? '이 위치에 코멘트를 남기세요…' : '캔버스 전체에 대한 코멘트를 남기세요…', value: drafts.new || '', dataset: { draft: 'new' }, 'aria-label': '새 코멘트',
      oninput: (e) => { drafts.new = e.target.value; },
      onkeydown: (e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') submit.click(); } });
    const submit = h('button', { class: 'primary', onclick: async () => {
      const text = composer.value.trim(); if (!text) return composer.focus();
      submit.disabled = true;
      try {
        await session.send({ type: 'comment.add', id: uid(), blockId: scope?.blockId || null, itemId: scope?.itemId || null, quote: scope?.quote || '', text });
        drafts.new = ''; ctx.ui.scope = null; st.filter = 'open';
        render();
      } catch (e) { toast(e.message, { kind: 'err' }); submit.disabled = false; }
    } }, '등록');

    const target = scope
      ? h('div', { class: 'target' }, icon('link', 13), h('span', null, `${nm[scope.blockId] || ''}${scope.quote ? ` · “${scope.quote.slice(0, 40)}${scope.quote.length > 40 ? '…' : ''}”` : ''}`),
        h('button', { class: 'icon-btn sm', 'aria-label': '대상 해제', onclick: () => { ctx.ui.scope = null; render(); } }, icon('x', 13)))
      : h('div', { class: 'target muted' }, '대상: 캔버스 전체 (블록/항목의 코멘트 아이콘을 누르면 위치가 지정됩니다)');

    const list = c.comments.filter((x) => st.filter === 'all' || x.status === st.filter)
      .filter((x) => !scope || (scope.itemId ? x.itemId === scope.itemId : x.blockId === scope.blockId))
      .sort((a, b) => b.at - a.at);

    return h('div', { class: 'comments' },
      fin() ? h('p', { class: 'notice' }, '최종 확정 상태에서는 코멘트를 추가·변경할 수 없습니다.') :
        h('div', { class: 'composer' }, target, composer, h('div', { class: 'row' }, h('small', { class: 'muted' }, '⌘/Ctrl + Enter'), submit)),
      h('div', { class: 'filters', role: 'group', 'aria-label': '코멘트 필터' },
        [['open', '열림'], ['resolved', '해결됨'], ['closed', '닫힘'], ['all', '전체']].map(([k, label]) =>
          h('button', { class: st.filter === k ? 'on' : '', onclick: () => { st.filter = k; render(); } }, `${label} ${counts[k]}`))),
      scope ? h('p', { class: 'muted small' }, '선택한 위치의 코멘트만 보는 중 · ', h('button', { class: 'link', onclick: () => { ctx.ui.scope = null; render(); } }, '전체 보기')) : null,
      list.length ? list.map(thread) : h('p', { class: 'empty' }, st.filter === 'open' ? '열린 코멘트가 없습니다.' : '코멘트가 없습니다.'));
  }

  function thread(cm) {
    const nm = names();
    const reply = h('textarea', { rows: 1, maxLength: 4000, placeholder: '답글 달기…', value: drafts[cm.id] || '', dataset: { draft: cm.id }, 'aria-label': '답글',
      oninput: (e) => { drafts[cm.id] = e.target.value; e.target.style.height = 'auto'; e.target.style.height = `${e.target.scrollHeight}px`; },
      onkeydown: (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); sendReply(); } } });
    const sendReply = async () => {
      const text = reply.value.trim(); if (!text) return;
      try { await session.send({ type: 'comment.reply', commentId: cm.id, id: uid(), text }); drafts[cm.id] = ''; render(); }
      catch (e) { toast(e.message, { kind: 'err' }); }
    };
    const setStatus = (status) => session.send({ type: 'comment.status', commentId: cm.id, status }).catch((e) => toast(e.message, { kind: 'err' }));
    const anchorLabel = cm.blockId ? nm[cm.blockId] : '캔버스 전체';

    return h('article', { class: `thread ${cm.status}`, dataset: { id: cm.id } },
      h('header', null,
        h('span', { class: 'avatar sm', style: { background: colorFor(cm.author) } }, initials(cm.author)),
        h('div', { class: 'who' }, h('strong', null, cm.author), h('small', null, fmtTime(cm.at))),
        h('span', { class: `status ${cm.status}` }, STATUS_LABEL[cm.status])),
      h('button', { class: 'anchor', onclick: () => cm.blockId && flash(cm.blockId, cm.itemId), disabled: !cm.blockId }, icon('link', 12), anchorLabel, cm.quote ? ` · “${cm.quote.slice(0, 30)}${cm.quote.length > 30 ? '…' : ''}”` : ''),
      h('p', { class: 'text' }, cm.text),
      cm.replies.length ? h('div', { class: 'replies' }, cm.replies.map((r) => h('div', { class: 'reply' },
        h('span', { class: 'avatar xs', style: { background: colorFor(r.author) } }, initials(r.author)),
        h('div', null, h('strong', null, r.author), h('small', null, ` ${fmtTime(r.at)}`), h('p', null, r.text))))) : null,
      cm.statusBy ? h('p', { class: 'resolved-by muted small' }, `${STATUS_LABEL[cm.status]} · ${cm.statusBy} · ${fmtTime(cm.statusAt)}`) : null,
      fin() ? null : h('footer', null, reply,
        h('div', { class: 'row' },
          cm.status === 'open'
            ? [h('button', { class: 'ghost sm ok', onclick: () => setStatus('resolved') }, icon('check', 13), 'Resolve'),
               h('button', { class: 'ghost sm', onclick: () => setStatus('closed') }, icon('x', 13), 'Close')]
            : h('button', { class: 'ghost sm', onclick: () => setStatus('open') }, icon('reopen', 13), '다시 열기'),
          h('button', { class: 'ghost sm', onclick: sendReply }, 'Reply'))));
  }

  // ---------------- AI 피드백 ----------------
  async function runFeedback(scope, blockId) {
    st.tab = 'ai'; st.ai = { loading: true, error: '', result: null, scopeLabel: scope === 'block' ? names()[blockId] : '캔버스 전체', applied: new Set(), dismissed: new Set() };
    render();
    try {
      const r = await api('/api/ai/feedback', { code: ctx.code, scope, blockId });
      st.ai.result = r;
    } catch (e) { st.ai.error = e.message; }
    st.ai.loading = false; render();
  }

  function aiView() {
    const a = st.ai;
    const nm = names();
    const intro = h('div', { class: 'ai-intro' },
      h('p', null, ctx.config.ai ? `연결된 AI (${ctx.config.model})가 각 블록의 구체성과 일관성을 점검합니다.` : 'AI가 연결되지 않아 기본 규칙으로 점검합니다. 서버에 GEMINI_API_KEY를 설정하면 AI 피드백이 활성화됩니다.'),
      h('div', { class: 'row' },
        h('button', { class: 'primary', disabled: a.loading || fin(), onclick: () => runFeedback('canvas') }, icon('sparkle'), '전체 피드백 받기'),
        h('small', { class: 'muted' }, '블록 제목의 ✦ 버튼으로 블록별 피드백도 가능합니다.')),
      ctx.config.ai ? h('p', { class: 'muted small' }, '피드백 요청 시 캔버스 내용이 AI 서비스로 전송됩니다.') : null);
    if (a.loading) return h('div', null, intro, h('p', { class: 'loading' }, `${a.scopeLabel} 분석 중…`));
    if (a.error) return h('div', null, intro, h('p', { class: 'err' }, a.error));
    if (!a.result) return intro;
    const r = a.result;
    return h('div', { class: 'ai' }, intro,
      h('div', { class: 'ai-overall' },
        h('div', { class: 'score', 'aria-label': `점수 ${r.score}` }, h('strong', null, r.score), h('small', null, '/100')),
        h('div', null, h('h4', null, `${a.scopeLabel} 총평`), h('p', null, r.overall), h('small', { class: 'muted' }, r.provider === 'rule-based' ? '기본 규칙 점검' : `AI · ${r.provider}`))),
      r.blocks.map((bf) => h('article', { class: 'ai-block' },
        h('header', null, h('strong', null, nm[bf.blockId]), h('span', { class: `stars r${bf.rating}`, 'aria-label': `${bf.rating}/5` }, '★'.repeat(bf.rating) + '☆'.repeat(5 - bf.rating)),
          h('button', { class: 'link', onclick: () => flash(bf.blockId) }, '보기')),
        bf.issues.length ? h('ul', null, bf.issues.map((i) => h('li', null, i))) : h('p', { class: 'muted small' }, '지적 사항 없음'),
        bf.suggestions.map((s, i) => suggestion(bf.blockId, s, `${bf.blockId}:${i}`)))));
  }

  function suggestion(blockId, s, key) {
    if (st.ai.dismissed.has(key)) return null;
    const applied = st.ai.applied.has(key);
    const target = s.kind === 'replace' ? ctx.canvas.blocks[blockId].items.find((x) => x.id === s.targetItemId) : null;
    return h('div', { class: `sugg${applied ? ' applied' : ''}` },
      h('span', { class: 'kind' }, s.kind === 'replace' && target ? '고쳐쓰기' : '추가'),
      h('div', { class: 'stext' }, target ? h('del', null, target.text) : null, h('p', null, s.text)),
      applied ? h('small', { class: 'muted' }, '적용됨') : h('div', { class: 'row' },
        h('button', { class: 'ghost sm ok', disabled: fin(), onclick: async () => {
          try {
            if (target) await session.send({ type: 'item.update', itemId: target.id, text: s.text });
            else await session.send({ type: 'item.add', blockId, itemId: uid(), text: s.text });
            st.ai.applied.add(key); render(); flash(blockId, target?.id);
          } catch (e) { toast(e.message, { kind: 'err' }); }
        } }, '적용'),
        h('button', { class: 'ghost sm', onclick: () => { st.ai.dismissed.add(key); render(); } }, '무시')));
  }

  // ---------------- Markdown ----------------
  function mdView() {
    const md = canvasToMarkdown(ctx.canvas);
    const file = `${ctx.canvas.title.replace(/[\\/:*?"<>|]/g, '_')}-${ctx.code}.canvas.md`;
    return h('div', { class: 'md' },
      h('p', { class: 'muted small' }, '편집 내용이 실시간으로 이 Markdown으로 변환됩니다. YAML front matter + 블록별 섹션 구조라 다른 도구나 AI가 그대로 읽을 수 있습니다.'),
      h('div', { class: 'row' },
        h('button', { class: 'ghost sm', onclick: () => copyText(md) }, icon('copy', 13), '복사'),
        h('button', { class: 'ghost sm', onclick: () => downloadText(file, md) }, '.md 다운로드'),
        h('button', { class: 'ghost sm', onclick: () => copyText(`${location.origin}/api/canvas/${ctx.code}.md`) }, icon('link', 13), 'API 주소')),
      h('pre', { class: 'mdpre' }, md));
  }

  return {
    el,
    refresh: render,
    showTab,
    askCanvasFeedback: () => runFeedback('canvas'),
    askBlockFeedback: (id) => runFeedback('block', id),
    onOp({ op }) {
      if (st.tab === 'md' && !op.type.startsWith('report')) { const pre = body.querySelector('.mdpre'); if (pre) pre.textContent = canvasToMarkdown(ctx.canvas); return; }
      if (st.tab === 'ai' && op.type === 'item.update' || op.type.startsWith('item.')) { if (st.tab === 'ai') render(); return; }
      if (op.type.startsWith('comment.') || op.type.startsWith('canvas.')) render(); else renderTabs();
    },
  };
}
