// 캔버스 <-> Markdown (YAML front matter + 블록별 섹션). 기계가 읽을 수 있는 포맷입니다.
import { TEMPLATES } from './templates.js';

export const SCHEMA = 'canvas-studio/v1';
export const STATUS_LABEL = { open: '열림', resolved: '해결됨', closed: '닫힘' };

export function formatCode(code) {
  return String(code || '').replace(/^(.{4})(.{4})$/, '$1-$2');
}

const iso = (t) => (t ? new Date(t).toISOString() : '');
const oneLine = (s) => String(s ?? '').replace(/\s*\n\s*/g, ' ').trim();

export function commentCounts(c) {
  const n = { open: 0, resolved: 0, closed: 0 };
  for (const cm of c.comments || []) n[cm.status] = (n[cm.status] || 0) + 1;
  return n;
}

export function canvasToMarkdown(c) {
  const t = TEMPLATES[c.template];
  const n = commentCounts(c);
  const L = [];
  L.push('---');
  L.push(`schema: ${SCHEMA}`);
  L.push(`code: ${JSON.stringify(formatCode(c.code))}`);
  L.push(`title: ${JSON.stringify(c.title)}`);
  L.push(`template: ${c.template}`);
  L.push(`status: ${c.status}`);
  L.push(`version: ${c.version}`);
  L.push(`created: ${iso(c.createdAt)}`);
  L.push(`updated: ${iso(c.updatedAt)}`);
  L.push(`comments: { open: ${n.open}, resolved: ${n.resolved}, closed: ${n.closed} }`);
  L.push('---', '');
  L.push(`# ${oneLine(c.title)}`, '');
  L.push(`_${t.name} · ${c.status === 'final' ? '최종 확정' : '초안'} · 공유 코드 ${formatCode(c.code)}_`, '');

  for (const b of t.blocks) {
    L.push(`## ${b.no}. ${b.name} (${b.en}) {#${b.id}}`, '');
    const items = c.blocks[b.id]?.items || [];
    if (!items.length) L.push('_(비어 있음)_');
    for (const it of items) {
      const lines = String(it.text).split('\n');
      L.push(`- ${lines[0]} <!--id:${it.id}-->`);
      for (const extra of lines.slice(1)) L.push(`  ${extra}`);
    }
    L.push('');
  }

  if (c.comments?.length) {
    L.push('## 코멘트 {#comments}', '');
    const names = Object.fromEntries(t.blocks.map((b) => [b.id, b.name]));
    for (const cm of c.comments) {
      const anchor = cm.blockId ? `@${cm.blockId}(${names[cm.blockId] || ''})` : '@canvas';
      L.push(`### [${cm.status}] #${cm.id} · ${anchor} · ${oneLine(cm.author)} · ${iso(cm.at)}`);
      if (cm.quote) L.push(`> 인용: ${oneLine(cm.quote)}`);
      L.push(...cm.text.split('\n').map((s) => `> ${s}`));
      for (const r of cm.replies) L.push(`- ↳ ${oneLine(r.author)} (${iso(r.at)}): ${oneLine(r.text)}`);
      if (cm.statusBy) L.push(`- ${STATUS_LABEL[cm.status]}: ${oneLine(cm.statusBy)} (${iso(cm.statusAt)})`);
      L.push('');
    }
  }
  return L.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
}

/** Markdown → { meta, blocks: { blockId: [{id,text}] } } (동일 포맷을 읽는 파서) */
export function parseCanvasMarkdown(md) {
  const m = md.match(/^---\n([\s\S]*?)\n---\n/);
  const meta = {};
  if (m) {
    for (const line of m[1].split('\n')) {
      const k = line.match(/^(\w+):\s*(.*)$/);
      if (!k) continue;
      let v = k[2];
      try { v = JSON.parse(v); } catch { /* 문자열 그대로 */ }
      meta[k[1]] = v;
    }
  }
  const blocks = {};
  let cur = null;
  const body = m ? md.slice(m[0].length) : md;
  for (const line of body.split('\n')) {
    const h = line.match(/^## .*\{#(\w+)\}\s*$/);
    if (h) { cur = h[1] === 'comments' ? null : h[1]; if (cur) blocks[cur] = []; continue; }
    if (!cur) continue;
    const it = line.match(/^- (.*?)\s*<!--id:([\w-]+)-->\s*$/);
    if (it) { blocks[cur].push({ id: it[2], text: it[1] }); continue; }
    if (/^ {2}/.test(line) && blocks[cur].length) blocks[cur][blocks[cur].length - 1].text += '\n' + line.slice(2);
  }
  return { meta, blocks };
}
