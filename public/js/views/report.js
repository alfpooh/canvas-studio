// 최종 리포트 화면: 요약 · 캔버스 · 강점/리스크 · 액션 아이템 · 코멘트 요약. PDF(인쇄)/Google Slides/Markdown 내보내기
import { h, icon, toast, api, openModal, fmtDate, fmtTime, downloadText } from '../dom.js';
import { TEMPLATES } from '../shared/templates.js';
import { formatCode } from '../shared/markdown.js';
import { summarizeComments, fallbackReport, reportToMarkdown, STATUS_LABEL } from '../shared/report.js';
import { Session } from '../session.js';
import { GoogleAuth } from '../google.js';
import { exportToSlides } from '../slides.js';

const PRI = { high: '높음', medium: '보통', low: '낮음' };

export async function reportView(root, code, user, nav) {
  const config = await api('/api/config').catch(() => ({}));
  const session = new Session(code, user);
  const view = h('div', { class: 'report-page' });
  root.append(view);
  session.on('notfound', () => view.replaceChildren(h('div', { class: 'center-card' }, h('h1', null, '캔버스를 찾을 수 없습니다'), h('button', { class: 'primary', onclick: () => nav('/') }, '처음으로'))));
  session.on('init', render);
  session.on('op', ({ op }) => { if (/^(canvas|report)\./.test(op.type)) render(); });
  session.on('error', (m) => toast(m, { kind: 'err' }));
  session.connect();
  let busy = false;

  async function generate() {
    if (busy) return; busy = true; render();
    let r;
    try { r = await api('/api/ai/report', { code }); }
    catch (e) { toast(`AI 리포트 생성 실패 — 기본 리포트로 대체합니다. (${e.message})`, { kind: 'err' }); r = fallbackReport(session.canvas); }
    try { await session.send({ type: 'report.set', report: r }); } catch (e) { toast(e.message, { kind: 'err' }); }
    busy = false; render();
  }

  function render() {
    const c = session.canvas; if (!c) return;
    document.title = `${c.title} — 최종 리포트`;
    if (c.status !== 'final') {
      view.replaceChildren(h('div', { class: 'center-card' }, h('h1', null, '아직 최종 확정되지 않았습니다'),
        h('p', null, '캔버스를 최종 확정하면 리포트가 만들어집니다.'), h('button', { class: 'primary', onclick: () => nav(`/c/${code}`) }, '캔버스로 돌아가기')));
      return;
    }
    if (!c.report || busy) {
      view.replaceChildren(h('div', { class: 'center-card' }, h('h1', null, busy ? '리포트를 만드는 중…' : '리포트가 아직 없습니다'),
        busy ? h('p', { class: 'muted' }, config.ai ? 'AI가 캔버스와 코멘트 기록을 분석하고 있습니다.' : '캔버스를 정리하고 있습니다.') : h('button', { class: 'primary', onclick: generate }, icon('sparkle'), '리포트 생성'),
        h('button', { class: 'link', onclick: () => nav(`/c/${code}`) }, '← 캔버스로')));
      return;
    }
    const r = c.report;
    view.replaceChildren(
      h('div', { class: 'report-bar no-print' },
        h('button', { class: 'ghost', onclick: () => nav(`/c/${code}`) }, icon('back'), '캔버스'),
        h('div', { class: 'spacer' }),
        h('button', { class: 'ghost', onclick: () => downloadText(`${c.title}-report.md`, reportToMarkdown(c, r)) }, icon('doc'), 'Markdown'),
        h('button', { class: 'ghost', onclick: () => slidesModal(c, r) }, icon('slides'), 'Google Slides'),
        h('button', { class: 'ghost', onclick: () => { if (confirm('리포트를 새로 생성할까요? (AI를 다시 호출합니다)')) generate(); } }, icon('sparkle'), '다시 생성'),
        h('button', { class: 'primary', onclick: () => { window.print(); } }, icon('print'), 'PDF로 저장')),
      document_(c, r));
  }

  function slidesModal(c, r) {
    const input = h('input', { placeholder: 'https://docs.google.com/presentation/d/… (비우면 새로 생성)', 'aria-label': 'Google Slides URL' });
    const out = h('div');
    const go = h('button', { class: 'primary', onclick: async () => {
      go.disabled = true; go.textContent = '만드는 중…'; out.replaceChildren();
      try {
        if (!GoogleAuth.hasToken()) await GoogleAuth.connect(config);
        const url = await exportToSlides(c, r, input.value);
        out.replaceChildren(h('p', { class: 'ok-text' }, '완료했습니다. ', h('a', { href: url, target: '_blank', rel: 'noopener' }, 'Google Slides 열기')));
      } catch (e) { out.replaceChildren(h('p', { class: 'err' }, e.message)); }
      go.disabled = false; go.replaceChildren(icon('slides'), '슬라이드 만들기');
    } }, icon('slides'), '슬라이드 만들기');
    openModal('Google Slides로 저장', config.googleClientId
      ? h('div', { class: 'stack-sm' },
        h('p', { class: 'muted small' }, '요약 · 캔버스 · 액션 아이템 · 코멘트 요약 슬라이드가 만들어집니다. 기존 프레젠테이션 URL을 넣으면 그 파일 맨 뒤에 슬라이드를 추가합니다. (본인 계정으로 편집 가능해야 합니다)'),
        h('div', { class: 'label' }, '대상 프레젠테이션 (선택)'), input, go, out)
      : h('p', null, 'Google 연동이 설정되지 않았습니다. 서버에 GOOGLE_CLIENT_ID를 설정하세요. (README 참고)'));
  }

  return () => session.close();
}

function document_(c, r) {
  const t = TEMPLATES[c.template];
  const cs = summarizeComments(c);
  const names = Object.fromEntries(t.blocks.map((b) => [b.id, b.name]));

  const snapshot = h('div', { class: 'grid static', style: { gridTemplateAreas: t.areas.map((a) => `"${a}"`).join(' ') } },
    t.blocks.map((b) => h('section', { class: 'block', dataset: { tone: b.tone }, style: { gridArea: b.id } },
      h('header', null, h('span', { class: 'no' }, b.no), h('h3', null, b.name, h('small', null, b.en))),
      c.blocks[b.id].items.length ? h('ul', null, c.blocks[b.id].items.map((i) => h('li', null, i.text))) : h('p', { class: 'muted small' }, '—'))));

  return h('article', { class: 'doc' },
    h('header', { class: 'doc-head' },
      h('small', null, `${t.name} 최종 리포트 · 공유 코드 ${formatCode(c.code)}`),
      h('h1', null, r.headline || c.title),
      h('p', { class: 'muted' }, `${fmtDate(r.generatedAt || Date.now())} 작성 · ${c.finalizedBy ? `${c.finalizedBy}님이 확정` : '최종 확정본'} · ${r.provider === 'rule-based' ? '기본 규칙 요약' : `AI 요약 (${r.provider})`}`)),
    h('section', null, h('h2', null, '요약'), h('p', { class: 'lead' }, r.summary)),
    h('section', { class: 'two' },
      h('div', null, h('h2', null, '강점'), r.strengths.length ? h('ul', null, r.strengths.map((s) => h('li', null, s))) : h('p', { class: 'muted' }, '—')),
      h('div', null, h('h2', null, '리스크'), r.risks.length ? h('ul', null, r.risks.map((s) => h('li', null, s))) : h('p', { class: 'muted' }, '—'))),
    h('section', { class: 'avoid-break' }, h('h2', null, '캔버스'), snapshot),
    h('section', null, h('h2', null, '다음 액션 아이템'),
      r.actions.length ? h('ol', { class: 'actions-list' }, r.actions.map((a) => h('li', { class: `act ${a.priority}` },
        h('div', { class: 'act-head' }, h('span', { class: `pri ${a.priority}` }, PRI[a.priority]), h('strong', null, a.title),
          a.timeframe ? h('span', { class: 'tf' }, a.timeframe) : null, a.blockId && names[a.blockId] ? h('span', { class: 'tf' }, names[a.blockId]) : null),
        a.detail ? h('p', null, a.detail) : null))) : h('p', { class: 'muted' }, '액션 아이템이 없습니다.')),
    h('section', null, h('h2', null, '코멘트 요약'),
      h('div', { class: 'stats' }, [['전체', cs.total], ['열림', cs.open], ['해결됨', cs.resolved], ['닫힘', cs.closed]].map(([l, n]) => h('div', null, h('strong', null, n), h('small', null, l)))),
      r.commentDigest ? h('p', null, r.commentDigest) : null,
      cs.participants.length ? h('p', { class: 'muted small' }, `참여자: ${cs.participants.join(', ')}`) : null,
      cs.threads.length ? h('ul', { class: 'thread-sum' }, cs.threads.map((th) => h('li', { class: th.status },
        h('span', { class: `status ${th.status}` }, STATUS_LABEL[th.status]),
        h('div', null, h('strong', null, th.blockName), ` · ${th.author} · ${fmtTime(th.at)}`,
          h('p', null, th.text),
          th.replies.map((x) => h('p', { class: 'muted small' }, `↳ ${x.author}: ${x.text}`)),
          th.statusBy ? h('p', { class: 'muted small' }, `${STATUS_LABEL[th.status]} 처리: ${th.statusBy}`) : null)))) : h('p', { class: 'muted' }, '코멘트가 없습니다.')),
    h('footer', { class: 'doc-foot muted small' }, `Canvas Studio · ${fmtDate(Date.now())}`));
}
