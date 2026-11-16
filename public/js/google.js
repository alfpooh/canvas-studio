// Google 연동 (브라우저에서 사용자 본인 계정 토큰으로 직접 호출): Drive 저장 + Slides 내보내기
import { LS, debounce } from './dom.js';
import { canvasToMarkdown } from './shared/markdown.js';

export const SCOPES = 'https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/presentations';
const scripts = {};
function loadScript(src) {
  return (scripts[src] ||= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src; s.async = true; s.onload = resolve;
    s.onerror = () => { delete scripts[src]; reject(new Error('Google 스크립트를 불러오지 못했습니다. 네트워크를 확인하세요.')); };
    document.head.append(s);
  }));
}

export const GoogleAuth = {
  token: null,
  expires: 0,
  listeners: new Set(),
  hasToken() { return !!this.token && Date.now() < this.expires - 30000; },
  onChange(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); },
  async connect(config) {
    if (!config.googleClientId) throw new Error('서버에 GOOGLE_CLIENT_ID가 설정되지 않았습니다.');
    await loadScript('https://accounts.google.com/gsi/client');
    return new Promise((resolve, reject) => {
      const client = window.google.accounts.oauth2.initTokenClient({
        client_id: config.googleClientId,
        scope: SCOPES,
        callback: (r) => {
          if (r.error) return reject(new Error(r.error_description || r.error));
          this.token = r.access_token; this.expires = Date.now() + Number(r.expires_in || 3600) * 1000;
          this.listeners.forEach((f) => f());
          resolve(this.token);
        },
        error_callback: (e) => reject(new Error(e?.type === 'popup_closed' ? '로그인 창이 닫혔습니다.' : (e?.message || 'Google 인증에 실패했습니다.'))),
      });
      client.requestAccessToken({ prompt: this.token ? '' : 'consent' });
    });
  },
};

export class NeedAuth extends Error {}

export async function gfetch(url, opts = {}) {
  if (!GoogleAuth.hasToken()) throw new NeedAuth('Google 계정 연결이 필요합니다.');
  const res = await fetch(url, { ...opts, headers: { ...(opts.headers || {}), Authorization: `Bearer ${GoogleAuth.token}` } });
  if (res.status === 401) { GoogleAuth.token = null; GoogleAuth.listeners.forEach((f) => f()); throw new NeedAuth('Google 로그인이 만료되었습니다. 다시 연결하세요.'); }
  if (!res.ok) {
    let msg = `Google API 오류 (${res.status})`;
    try { const j = await res.json(); msg = j.error?.message || msg; } catch { /* 본문 없음 */ }
    const e = new Error(msg); e.status = res.status; throw e;
  }
  return res.status === 204 ? null : res.json();
}

export function parseGoogleId(input, kind = 'folders') {
  const s = String(input || '').trim();
  if (!s) return '';
  const m = s.match(new RegExp(`/${kind}/([\\w-]{10,})`)) || s.match(/[?&]id=([\w-]{10,})/) || s.match(/\/d\/([\w-]{10,})/);
  return m ? m[1] : (/^[\w-]{10,}$/.test(s) ? s : '');
}

export class DriveSync {
  constructor(ctx) {
    this.ctx = ctx;
    this.key = `cs.drive.${ctx.code}`;
    const saved = LS.get(this.key, {});
    Object.assign(this, { folderId: saved.folderId || '', folderName: saved.folderName || '', fileId: saved.fileId || '', fileUrl: saved.fileUrl || '', auto: saved.auto !== false });
    this.status = 'off'; this.lastSync = 0; this.error = '';
    this.cbs = new Set();
    this.push = debounce(() => this.syncNow().catch(() => {}), 3000);
    this.unsub = GoogleAuth.onChange(() => { this.refreshStatus(); });
  }

  get enabled() { return !!this.ctx.config.googleClientId; }
  state() { return { status: this.status, lastSync: this.lastSync, error: this.error, folderId: this.folderId, folderName: this.folderName, fileUrl: this.fileUrl, auto: this.auto }; }
  onChange(cb) { this.cbs.add(cb); cb(this.state()); return () => this.cbs.delete(cb); }
  emit() { this.cbs.forEach((cb) => cb(this.state())); }
  persist() { LS.set(this.key, { folderId: this.folderId, folderName: this.folderName, fileId: this.fileId, fileUrl: this.fileUrl, auto: this.auto }); }

  init() { this.refreshStatus(); }
  refreshStatus() {
    if (!this.folderId) this.status = 'off';
    else if (!GoogleAuth.hasToken()) this.status = 'needauth';
    else if (this.status === 'off' || this.status === 'needauth') this.status = 'idle';
    this.emit();
  }

  schedule() { if (this.auto && this.folderId && GoogleAuth.hasToken()) this.push(); }
  dispose() { this.push.cancel(); this.unsub(); }

  async connectGoogle() { await GoogleAuth.connect(this.ctx.config); this.refreshStatus(); if (this.folderId) this.syncNow().catch(() => {}); }

  setAuto(v) { this.auto = v; this.persist(); this.emit(); if (v) this.schedule(); }

  async setFolder(input) {
    const id = parseGoogleId(input, 'folders');
    if (!id) throw new Error('폴더 URL 또는 ID를 확인하세요.');
    let f;
    try { f = await gfetch(`https://www.googleapis.com/drive/v3/files/${id}?fields=id,name,mimeType`); }
    catch (e) {
      if (e.status === 404) throw new Error('이 앱은 직접 만들었거나 Picker로 선택한 폴더에만 접근할 수 있습니다. "폴더 선택(Picker)" 또는 "새 폴더 만들기"를 사용하세요.');
      throw e;
    }
    if (f.mimeType !== 'application/vnd.google-apps.folder') throw new Error('폴더가 아닙니다.');
    this.useFolder(f.id, f.name);
  }

  useFolder(id, name) {
    this.folderId = id; this.folderName = name || ''; this.fileId = ''; this.fileUrl = '';
    this.persist(); this.refreshStatus();
    this.syncNow().catch(() => {});
  }

  async createFolder(name = 'Canvas Studio') {
    const f = await gfetch('https://www.googleapis.com/drive/v3/files?fields=id,name', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, mimeType: 'application/vnd.google-apps.folder' }),
    });
    this.useFolder(f.id, f.name);
  }

  async pickFolder() {
    const { googleApiKey: key, googleAppId: appId } = this.ctx.config;
    if (!key) throw new Error('서버에 GOOGLE_API_KEY가 설정되지 않아 Picker를 사용할 수 없습니다.');
    if (!GoogleAuth.hasToken()) await GoogleAuth.connect(this.ctx.config);
    await loadScript('https://apis.google.com/js/api.js');
    await new Promise((r) => window.gapi.load('picker', r));
    const g = window.google.picker;
    return new Promise((resolve) => {
      const view = new g.DocsView(g.ViewId.FOLDERS).setSelectFolderEnabled(true).setIncludeFolders(true).setMimeTypes('application/vnd.google-apps.folder');
      const picker = new g.PickerBuilder().addView(view).setOAuthToken(GoogleAuth.token).setDeveloperKey(key).setAppId(appId || undefined)
        .setCallback((d) => {
          if (d.action === g.Action.PICKED) { const doc = d.docs[0]; this.useFolder(doc.id, doc.name); resolve(true); }
          else if (d.action === g.Action.CANCEL) resolve(false);
        }).build();
      picker.setVisible(true);
    });
  }

  fileName() {
    const c = this.ctx.canvas;
    return `${c.title.replace(/[\\/:*?"<>|]/g, '_').slice(0, 60)}-${c.code}.canvas.md`;
  }

  async syncNow() {
    if (!this.folderId) return;
    this.status = 'saving'; this.error = ''; this.emit();
    try {
      const md = canvasToMarkdown(this.ctx.canvas);
      const name = this.fileName();
      if (this.fileId) {
        try {
          await gfetch(`https://www.googleapis.com/drive/v3/files/${this.fileId}?fields=id`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) });
          await gfetch(`https://www.googleapis.com/upload/drive/v3/files/${this.fileId}?uploadType=media`, { method: 'PATCH', headers: { 'Content-Type': 'text/markdown; charset=UTF-8' }, body: md });
        } catch (e) { if (e.status === 404) this.fileId = ''; else throw e; }
      }
      if (!this.fileId) {
        const b = `cs${Math.random().toString(36).slice(2)}`;
        const meta = { name, parents: [this.folderId], mimeType: 'text/markdown' };
        const body = `--${b}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n--${b}\r\nContent-Type: text/markdown; charset=UTF-8\r\n\r\n${md}\r\n--${b}--`;
        const f = await gfetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink', { method: 'POST', headers: { 'Content-Type': `multipart/related; boundary=${b}` }, body });
        this.fileId = f.id; this.fileUrl = f.webViewLink || `https://drive.google.com/file/d/${f.id}/view`;
      }
      this.status = 'ok'; this.lastSync = Date.now(); this.persist();
    } catch (e) {
      this.status = e instanceof NeedAuth ? 'needauth' : 'error';
      this.error = e.message;
      this.emit();
      throw e;
    }
    this.emit();
  }
}
