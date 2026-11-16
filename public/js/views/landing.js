// 시작 화면: 새 캔버스 만들기 / 공유 코드로 참여 / 링크로 입장 시 이름 입력
import { h, icon, getUser, saveUser, toast, api, LS, rememberCanvas, fmtTime } from '../dom.js';
import { TEMPLATES } from '../shared/templates.js';
import { formatCode } from '../shared/markdown.js';

function brand() {
  return h('div', { class: 'brand' }, h('span', { class: 'logo' }), h('span', null, 'Canvas Studio'));
}

export function landingView(root, nav) {
  const user = getUser();
  let template = 'lean';
  const recent = LS.get('cs.recent', []);

  const nameIn = h('input', { id: 'f-name', placeholder: '예: 김하나', value: user.name, maxLength: 40, autocomplete: 'nickname' });
  const titleIn = h('input', { id: 'f-title', placeholder: '예: 반려식물 구독 서비스', maxLength: 120 });
  const codeIn = h('input', { id: 'f-code', placeholder: 'ABCD-EFGH', maxLength: 12, autocapitalize: 'characters', spellcheck: false });

  const cards = Object.values(TEMPLATES).map((t) => {
    const el = h('button', { type: 'button', class: `tpl${t.id === template ? ' on' : ''}`, 'aria-pressed': t.id === template, dataset: { id: t.id },
      onclick: () => { template = t.id; cards.forEach((c) => { const on = c.dataset.id === template; c.classList.toggle('on', on); c.setAttribute('aria-pressed', on); }); } },
      h('strong', null, t.name), h('small', null, t.by), h('p', null, t.description),
      miniGrid(t));
    return el;
  });

  const need = () => {
    const name = nameIn.value.trim();
    if (!name) { nameIn.focus(); toast('이름을 입력하세요. 공동 작업자에게 표시됩니다.', { kind: 'err' }); return null; }
    saveUser({ name });
    return name;
  };

  const create = async (e) => {
    e.preventDefault();
    const name = need(); if (!name) return;
    const btn = e.submitter; btn.disabled = true;
    try {
      const { code } = await api('/api/canvas', { title: titleIn.value.trim() || '제목 없는 캔버스', template, owner: name });
      sessionStorage.setItem('cs.justCreated', code);
      nav(`/c/${code}`);
    } catch (err) { toast(err.message, { kind: 'err' }); btn.disabled = false; }
  };

  const join = async (e) => {
    e.preventDefault();
    const name = need(); if (!name) return;
    const code = codeIn.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (code.length !== 8) { toast('공유 코드는 8자리입니다. (예: ABCD-EFGH)', { kind: 'err' }); codeIn.focus(); return; }
    try { await api(`/api/canvas/${code}`); nav(`/c/${code}`); } catch (err) { toast(err.message, { kind: 'err' }); }
  };

  root.append(h('main', { class: 'landing' },
    brand(),
    h('h1', null, '비즈니스 모델을 함께 그리고,', h('br'), '검증하고, 리포트로 마무리하세요.'),
    h('p', { class: 'lead' }, 'Lean Canvas와 Business Model Canvas를 팀과 실시간으로 편집하고, AI 피드백을 받고, 최종 확정하면 액션 아이템이 담긴 리포트를 PDF나 Google Slides로 만들어 줍니다.'),
    h('div', { class: 'land-grid' },
      h('form', { class: 'panel-card', onsubmit: create },
        h('h2', null, '새 캔버스 시작'),
        h('label', { for: 'f-name' }, '내 이름'), nameIn,
        h('label', { for: 'f-title' }, '프로젝트 이름'), titleIn,
        h('div', { class: 'label' }, '템플릿'),
        h('div', { class: 'tpls' }, cards),
        h('button', { class: 'primary big', type: 'submit' }, icon('plus'), '캔버스 만들기 · 공유 코드 받기')),
      h('div', { class: 'stack' },
        h('form', { class: 'panel-card', onsubmit: join },
          h('h2', null, '공유 코드로 참여'),
          h('p', { class: 'muted' }, '받은 코드를 입력하거나, 공유 링크를 열면 바로 입장합니다. 위의 이름이 함께 사용됩니다.'),
          h('label', { for: 'f-code' }, '공유 코드'), codeIn,
          h('button', { class: 'secondary big', type: 'submit' }, '참여하기')),
        recent.length ? h('div', { class: 'panel-card' },
          h('h2', null, '최근 캔버스'),
          h('ul', { class: 'recent' }, recent.map((r) => h('li', null,
            h('a', { href: `#/c/${r.code}` }, h('strong', null, r.title), h('small', null, `${TEMPLATES[r.template]?.name || ''} · ${formatCode(r.code)} · ${fmtTime(r.at)}`)))))) : null)),
    h('footer', { class: 'muted' }, '캔버스는 Markdown으로 실시간 변환되며, 연결한 Google Drive에 자동 저장할 수 있습니다.')));
  nameIn.value ? titleIn.focus() : nameIn.focus();
  return () => {};
}

function miniGrid(t) {
  const g = h('div', { class: 'mini', style: { gridTemplateAreas: t.areas.map((r) => `"${r}"`).join(' ') } });
  t.blocks.forEach((b) => g.append(h('i', { style: { gridArea: b.id }, dataset: { tone: b.tone } })));
  return g;
}

/** 링크로 처음 들어온 사람: 이름만 받고 입장 */
export function joinView(root, code, nav, reroute) {
  const user = getUser();
  const nameIn = h('input', { id: 'j-name', placeholder: '내 이름', maxLength: 40, value: user.name, autocomplete: 'nickname' });
  root.append(h('main', { class: 'landing narrow' }, brand(),
    h('form', { class: 'panel-card', onsubmit: async (e) => {
      e.preventDefault();
      const name = nameIn.value.trim();
      if (!name) return nameIn.focus();
      try { await api(`/api/canvas/${code}`); } catch (err) { return toast(err.message, { kind: 'err' }); }
      saveUser({ name }); reroute();
    } },
    h('h2', null, `캔버스에 참여 (${formatCode(code)})`),
    h('p', { class: 'muted' }, '공동 작업자에게 표시될 이름을 입력하세요.'),
    h('label', { for: 'j-name' }, '내 이름'), nameIn,
    h('button', { class: 'primary big', type: 'submit' }, '입장하기'),
    h('a', { class: 'link', href: '#/' }, '← 처음으로'))));
  nameIn.focus();
  return () => {};
}
