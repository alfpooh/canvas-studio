// 최종 리포트 → Google Slides (새 프레젠테이션 생성 또는 입력한 프레젠테이션 뒤에 슬라이드 추가)
import { gfetch, parseGoogleId } from './google.js';
import { TEMPLATES, blockRects } from './shared/templates.js';
import { summarizeComments, STATUS_LABEL } from './shared/report.js';
import { formatCode } from './shared/markdown.js';

const W = 720;
const H = 405;
const FONT = 'Noto Sans KR';
const PRI = { high: '높음', medium: '보통', low: '낮음' };
const TONES = ['#e0e7ff', '#fee2e2', '#fef3c7', '#dcfce7', '#cffafe', '#f3e8ff', '#ffedd5', '#e0f2fe', '#fce7f3'];

const rgb = (hex) => { const n = parseInt(hex.slice(1), 16); return { red: ((n >> 16) & 255) / 255, green: ((n >> 8) & 255) / 255, blue: (n & 255) / 255 }; };
const cut = (s, n) => { const t = String(s).replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };

export function buildSlideRequests(canvas, report) {
  const t = TEMPLATES[canvas.template];
  const cs = summarizeComments(canvas);
  const reqs = [];
  let seq = 0;
  const oid = (p) => `${p}_${Date.now().toString(36)}_${(seq++).toString(36)}`;

  const slide = (bg) => {
    const id = oid('slide');
    reqs.push({ createSlide: { objectId: id, slideLayoutReference: { predefinedLayout: 'BLANK' } } });
    if (bg) reqs.push({ updatePageProperties: { objectId: id, pageProperties: { pageBackgroundFill: { solidFill: { color: { rgbColor: rgb(bg) } } } }, fields: 'pageBackgroundFill.solidFill.color' } });
    return id;
  };

  /** title(굵게) + lines 로 구성된 텍스트 상자 */
  const box = (page, x, y, w, h, title, lines = [], o = {}) => {
    const id = oid('box');
    const size = o.size || 12;
    const text = [title, ...lines].filter((s) => s !== '' && s != null).join('\n');
    reqs.push({ createShape: { objectId: id, shapeType: 'TEXT_BOX', elementProperties: { pageObjectId: page,
      size: { width: { magnitude: w, unit: 'PT' }, height: { magnitude: h, unit: 'PT' } },
      transform: { scaleX: 1, scaleY: 1, translateX: x, translateY: y, unit: 'PT' } } } });
    if (!text) return id;
    reqs.push({ insertText: { objectId: id, text } });
    reqs.push({ updateTextStyle: { objectId: id, style: { fontFamily: FONT, fontSize: { magnitude: size, unit: 'PT' }, foregroundColor: { opaqueColor: { rgbColor: rgb(o.color || '#1f2937') } } }, fields: 'fontFamily,fontSize,foregroundColor' } });
    if (title) {
      reqs.push({ updateTextStyle: { objectId: id, textRange: { type: 'FIXED_RANGE', startIndex: 0, endIndex: title.length },
        style: { bold: true, fontSize: { magnitude: o.titleSize || size + 1, unit: 'PT' } }, fields: 'bold,fontSize' } });
    }
    if (o.fill) reqs.push({ updateShapeProperties: { objectId: id, shapeProperties: { shapeBackgroundFill: { solidFill: { color: { rgbColor: rgb(o.fill) } } } }, fields: 'shapeBackgroundFill.solidFill.color' } });
    return id;
  };

  // 1) 표지
  let p = slide('#312e81');
  box(p, 48, 120, 624, 80, cut(report.headline || canvas.title, 60), [], { size: 34, titleSize: 34, color: '#ffffff' });
  box(p, 48, 230, 624, 70, `${t.name} 최종 리포트`, [`${new Date(report.generatedAt || Date.now()).toLocaleDateString('ko-KR')} · 공유 코드 ${formatCode(canvas.code)}`, `작성자 ${cs.participants.length ? cs.participants.join(', ') : canvas.owner || ''}`.trim()], { size: 14, titleSize: 18, color: '#c7d2fe' });

  // 2) 요약
  p = slide('#ffffff');
  box(p, 36, 24, 648, 36, '요약', [], { size: 24, titleSize: 24, color: '#312e81' });
  box(p, 36, 66, 648, 120, '', [cut(report.summary, 520)], { size: 13 });
  box(p, 36, 200, 312, 190, '강점', (report.strengths || []).slice(0, 5).map((s) => `• ${cut(s, 70)}`), { size: 11, titleSize: 14, fill: '#ecfdf5' });
  box(p, 372, 200, 312, 190, '리스크', (report.risks || []).slice(0, 5).map((s) => `• ${cut(s, 70)}`), { size: 11, titleSize: 14, fill: '#fef2f2' });

  // 3) 캔버스 전체
  p = slide('#ffffff');
  box(p, 36, 14, 648, 30, `${cut(canvas.title, 40)} — ${t.name}`, [], { size: 18, titleSize: 18, color: '#312e81' });
  const { rects, cols, rows } = blockRects(canvas.template);
  const gx = 20; const gy = 50; const gw = W - 40; const gh = H - gy - 14;
  const rowH = rows === 3 ? [0.36, 0.36, 0.28].map((f) => f * gh) : Array(rows).fill(gh / rows);
  const ys = [gy]; rowH.forEach((v, i) => ys.push(ys[i] + v));
  for (const b of t.blocks) {
    const r = rects[b.id];
    const x = gx + (r.c0 * gw) / cols; const w = ((r.c1 - r.c0 + 1) * gw) / cols - 3;
    const y = ys[r.r0]; const h = ys[r.r1 + 1] - ys[r.r0] - 3;
    const items = canvas.blocks[b.id].items;
    const per = Math.max(2, Math.floor((h - 14) / 10));
    const shown = items.slice(0, per).map((i) => `• ${cut(i.text, Math.floor(w / 3.4))}`);
    if (items.length > per) shown[per - 1] = `… 외 ${items.length - per + 1}개`;
    box(p, x, y, w, h, `${b.no}. ${b.name}`, shown, { size: 7, titleSize: 8.5, fill: TONES[b.tone % TONES.length] });
  }

  // 4) 액션 아이템
  const acts = report.actions || [];
  const names = Object.fromEntries(t.blocks.map((b) => [b.id, b.name]));
  const PER = 5;
  for (let i = 0; i < Math.max(1, Math.ceil(acts.length / PER)); i++) {
    p = slide('#ffffff');
    box(p, 36, 24, 648, 36, `다음 액션 아이템${acts.length > PER ? ` (${i + 1}/${Math.ceil(acts.length / PER)})` : ''}`, [], { size: 24, titleSize: 24, color: '#312e81' });
    acts.slice(i * PER, i * PER + PER).forEach((a, k) => {
      const fill = a.priority === 'high' ? '#fee2e2' : a.priority === 'low' ? '#f1f5f9' : '#fef9c3';
      box(p, 36, 72 + k * 64, 648, 58, `${i * PER + k + 1}. ${cut(a.title, 60)}`,
        [`[${PRI[a.priority]}]${a.timeframe ? ` ${a.timeframe}` : ''}${a.blockId && names[a.blockId] ? ` · ${names[a.blockId]}` : ''}${a.detail ? ` — ${cut(a.detail, 110)}` : ''}`], { size: 10.5, titleSize: 13, fill });
    });
    if (!acts.length) box(p, 36, 80, 648, 40, '등록된 액션 아이템이 없습니다.', [], { size: 14 });
  }

  // 5) 코멘트 요약
  p = slide('#ffffff');
  box(p, 36, 24, 648, 36, '코멘트 요약', [], { size: 24, titleSize: 24, color: '#312e81' });
  box(p, 36, 66, 648, 24, `총 ${cs.total}건 · 열림 ${cs.open} · 해결 ${cs.resolved} · 닫힘 ${cs.closed}`, [], { size: 13, titleSize: 13 });
  if (report.commentDigest) box(p, 36, 94, 648, 70, '', [cut(report.commentDigest, 300)], { size: 11 });
  const lines = cs.threads.slice(0, 8).map((th) => `[${STATUS_LABEL[th.status]}] ${th.blockName} · ${th.author}: ${cut(th.text, 70)}${th.replies.length ? ` (답글 ${th.replies.length})` : ''}`);
  if (cs.threads.length > 8) lines.push(`… 외 ${cs.threads.length - 8}건`);
  box(p, 36, 170, 648, 220, '', lines.length ? lines : ['코멘트가 없습니다.'], { size: 10.5 });
  return reqs;
}

export async function exportToSlides(canvas, report, presentationInput) {
  const existing = parseGoogleId(presentationInput, 'presentation').trim();
  if (presentationInput?.trim() && !existing) throw new Error('Google Slides URL 또는 ID를 확인하세요.');
  let id = existing; let initial = null;
  if (!id) {
    const created = await gfetch('https://slides.googleapis.com/v1/presentations', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: `${canvas.title} — 최종 리포트` }) });
    id = created.presentationId; initial = created.slides?.[0]?.objectId;
  } else {
    try { await gfetch(`https://slides.googleapis.com/v1/presentations/${id}?fields=presentationId`); }
    catch (e) { if (e.status === 404 || e.status === 403) throw new Error('프레젠테이션에 접근할 수 없습니다. 본인 계정으로 편집 가능한지 확인하세요.'); throw e; }
  }
  const requests = buildSlideRequests(canvas, report);
  if (initial) requests.push({ deleteObject: { objectId: initial } });
  await gfetch(`https://slides.googleapis.com/v1/presentations/${id}:batchUpdate`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ requests }) });
  return `https://docs.google.com/presentation/d/${id}/edit`;
}
