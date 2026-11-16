// 공유 / Google Drive 모달
import { h, icon, openModal, copyText, toast } from './dom.js';
import { formatCode } from './shared/markdown.js';

export function openShareModal(ctx, { first = false } = {}) {
  const code = formatCode(ctx.code);
  const link = `${location.origin}/#/c/${ctx.code}`;
  const email = h('input', { type: 'text', placeholder: 'a@example.com, b@example.com', inputMode: 'email', 'aria-label': '초대할 이메일' });
  const sendMail = () => {
    const to = email.value.split(/[,\s;]+/).filter(Boolean);
    if (!to.length || to.some((x) => !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(x))) { email.focus(); return toast('올바른 이메일 주소를 입력하세요.', { kind: 'err' }); }
    const subject = `[Canvas Studio] "${ctx.canvas.title}" 캔버스에 초대합니다`;
    const body = `${ctx.user.name}님이 함께 작업할 캔버스에 초대했습니다.\n\n링크: ${link}\n공유 코드: ${code}\n\n링크를 열거나 Canvas Studio 첫 화면에서 공유 코드를 입력하면 바로 함께 편집할 수 있습니다.`;
    location.href = `mailto:${to.join(',')}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  };
  openModal(first ? '캔버스가 만들어졌습니다 🎉' : '공유', h('div', { class: 'stack-sm' },
    first ? h('p', null, '아래 공유 코드나 링크를 팀원에게 전달하면 같은 캔버스를 실시간으로 함께 편집하고 코멘트를 남길 수 있습니다.') : null,
    h('div', { class: 'label' }, '공유 코드'),
    h('div', { class: 'code-box' }, h('strong', null, code), h('button', { class: 'ghost sm', onclick: () => copyText(code) }, icon('copy', 13), '복사')),
    h('div', { class: 'label' }, '공유 링크'),
    h('div', { class: 'link-box' }, h('input', { readOnly: true, value: link, onfocus: (e) => e.target.select(), 'aria-label': '공유 링크' }), h('button', { class: 'ghost sm', onclick: () => copyText(link) }, icon('copy', 13), '복사')),
    h('div', { class: 'label' }, '이메일로 초대'),
    h('div', { class: 'link-box' }, email, h('button', { class: 'primary sm', onclick: sendMail }, icon('mail', 13), '메일 작성')),
    h('p', { class: 'muted small' }, '메일 앱이 열리고 링크와 코드가 본문에 채워집니다. 링크나 코드를 아는 사람은 누구나 편집할 수 있으니 신뢰하는 사람에게만 공유하세요.')));
}

export function openDriveModal(ctx) {
  const d = ctx.drive;
  const box = h('div', { class: 'stack-sm' });
  const folderIn = h('input', { placeholder: '폴더 URL 또는 ID', 'aria-label': 'Google Drive 폴더 URL 또는 ID' });
  const run = (fn) => async (e) => {
    const b = e.currentTarget; b.disabled = true;
    try { await fn(); } catch (err) { toast(err.message, { kind: 'err', ms: 7000 }); } finally { b.disabled = false; }
  };

  const render = (s) => {
    if (!d.enabled) {
      box.replaceChildren(h('p', null, 'Google 연동이 설정되지 않았습니다.'),
        h('p', { class: 'muted small' }, '서버 환경변수 GOOGLE_CLIENT_ID(OAuth 웹 클라이언트 ID)를 설정하면 Drive 자동 저장과 Google Slides 내보내기가 활성화됩니다. 자세한 방법은 README를 참고하세요.'));
      return;
    }
    box.replaceChildren(
      h('p', { class: 'muted small' }, '편집 내용은 Markdown 파일로 실시간 변환되어, 지정한 Drive 폴더의 파일 하나에 자동으로 덮어써 저장됩니다. 연결한 사람의 브라우저에서 저장되며, 로그인 토큰은 서버로 보내지 않습니다.'),
      h('div', { class: 'row' }, h('button', { class: 'primary', onclick: run(() => d.connectGoogle()) }, icon('drive'), 'Google 계정 연결'),
        h('span', { class: `chip drive ${s.status}` }, { off: '폴더 미지정', needauth: s.folderId ? '재연결 필요' : '연결 필요', idle: '대기 중', saving: '저장 중…', ok: '저장됨', error: '오류' }[s.status])),
      h('div', { class: 'label' }, '저장 폴더'),
      s.folderId ? h('p', null, icon('drive', 14), ` ${s.folderName || s.folderId}`, s.fileUrl ? [' · ', h('a', { href: s.fileUrl, target: '_blank', rel: 'noopener' }, '파일 열기')] : null) : h('p', { class: 'muted small' }, '아직 폴더를 지정하지 않았습니다.'),
      h('div', { class: 'row wrap' },
        d.ctx.config.googleApiKey ? h('button', { class: 'ghost', onclick: run(() => d.pickFolder()) }, '폴더 선택 (Picker)') : null,
        h('button', { class: 'ghost', onclick: run(() => d.createFolder()) }, '새 폴더 만들기 (Canvas Studio)')),
      h('div', { class: 'link-box' }, folderIn, h('button', { class: 'ghost sm', onclick: run(() => d.setFolder(folderIn.value)) }, '폴더 ID 적용')),
      h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: s.auto, onchange: (e) => d.setAuto(e.target.checked) }), '변경될 때마다 자동 저장 (3초 지연)'),
      h('div', { class: 'row' }, h('button', { class: 'ghost sm', disabled: !s.folderId, onclick: run(() => d.syncNow()) }, '지금 저장'),
        s.lastSync ? h('small', { class: 'muted' }, `마지막 저장 ${new Date(s.lastSync).toLocaleTimeString('ko-KR')}`) : null),
      s.error ? h('p', { class: 'err' }, s.error) : null);
  };
  const off = d.onChange(render);
  openModal('Google Drive 자동 저장', box, { onClose: off });
}
