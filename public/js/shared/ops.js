// 캔버스 상태와 편집 연산(op). 서버와 클라이언트가 동일한 로직으로 상태를 갱신합니다.
import { TEMPLATES } from './templates.js';

export class OpError extends Error {}

export const LIMITS = { items: 60, itemText: 1000, comment: 4000, comments: 500, replies: 100, title: 120, report: 60000 };

const clip = (s, n) => String(s ?? '').slice(0, n);
const idOk = (s) => typeof s === 'string' && /^[A-Za-z0-9_-]{3,32}$/.test(s);

export function uid() {
  const a = new Uint8Array(6);
  (globalThis.crypto || {}).getRandomValues?.(a);
  const r = Array.from(a, (x) => x.toString(36).padStart(2, '0')).join('');
  return (r + Math.random().toString(36).slice(2, 6)).slice(0, 12);
}

export function newCanvas({ code, title, template, owner }) {
  const t = TEMPLATES[template];
  if (!t) throw new OpError('알 수 없는 템플릿입니다.');
  const now = Date.now();
  return {
    code,
    title: clip(title || '제목 없는 캔버스', LIMITS.title),
    template,
    status: 'draft',
    owner: clip(owner || '', 40),
    blocks: Object.fromEntries(t.blocks.map((b) => [b.id, { items: [] }])),
    comments: [],
    report: null,
    version: 0,
    createdAt: now,
    updatedAt: now,
  };
}

export function findItem(c, itemId) {
  for (const [blockId, b] of Object.entries(c.blocks)) {
    const i = b.items.findIndex((x) => x.id === itemId);
    if (i >= 0) return { blockId, index: i, item: b.items[i] };
  }
  return null;
}

const FINAL_ALLOWED = new Set(['canvas.reopen', 'report.set']);

function getBlock(c, blockId) {
  const b = c.blocks[blockId];
  if (!b) throw new OpError('존재하지 않는 블록입니다.');
  return b;
}

function insertAt(arr, item, index) {
  const i = Number.isInteger(index) ? Math.max(0, Math.min(arr.length, index)) : arr.length;
  arr.splice(i, 0, item);
}

export function sanitizeReport(r) {
  if (!r || typeof r !== 'object') throw new OpError('리포트 형식이 올바르지 않습니다.');
  const arr = (a, n, m) => (Array.isArray(a) ? a.slice(0, n).map((s) => clip(s, m)).filter(Boolean) : []);
  const pri = new Set(['high', 'medium', 'low']);
  const out = {
    headline: clip(r.headline, 200),
    summary: clip(r.summary, 3000),
    strengths: arr(r.strengths, 8, 400),
    risks: arr(r.risks, 8, 400),
    commentDigest: clip(r.commentDigest, 1500),
    actions: (Array.isArray(r.actions) ? r.actions : []).slice(0, 20).map((a) => ({
      title: clip(a?.title, 200),
      detail: clip(a?.detail, 600),
      priority: pri.has(a?.priority) ? a.priority : 'medium',
      blockId: clip(a?.blockId, 32),
      timeframe: clip(a?.timeframe, 40),
    })).filter((a) => a.title),
    provider: clip(r.provider, 40),
    generatedAt: Number.isFinite(r.generatedAt) ? r.generatedAt : Date.now(),
  };
  if (JSON.stringify(out).length > LIMITS.report) throw new OpError('리포트가 너무 깁니다.');
  return out;
}

/**
 * op 를 상태에 적용한다. 변경이 있으면 true, 멱등 처리로 무시되면 false.
 * 규칙 위반 시 OpError 를 던진다.
 */
export function applyOp(c, op, actor = {}) {
  if (!op || typeof op.type !== 'string') throw new OpError('잘못된 요청입니다.');
  if (c.status === 'final' && !FINAL_ALLOWED.has(op.type)) {
    throw new OpError('최종 확정된 캔버스는 수정할 수 없습니다. "다시 열기"를 사용하세요.');
  }
  const now = Date.now();
  const who = clip(actor.name || '익명', 40);
  let changed = true;

  switch (op.type) {
    case 'item.add': {
      const b = getBlock(c, op.blockId);
      if (!idOk(op.itemId)) throw new OpError('항목 ID가 올바르지 않습니다.');
      if (findItem(c, op.itemId)) { changed = false; break; }
      if (b.items.length >= LIMITS.items) throw new OpError('한 블록에 넣을 수 있는 항목 수를 초과했습니다.');
      insertAt(b.items, { id: op.itemId, text: clip(op.text, LIMITS.itemText), by: who, at: now }, op.index);
      break;
    }
    case 'item.update': {
      const f = findItem(c, op.itemId);
      if (!f) { changed = false; break; }
      const text = clip(op.text, LIMITS.itemText);
      if (f.item.text === text) { changed = false; break; }
      f.item.text = text; f.item.by = who; f.item.at = now;
      break;
    }
    case 'item.delete': {
      const f = findItem(c, op.itemId);
      if (!f) { changed = false; break; }
      c.blocks[f.blockId].items.splice(f.index, 1);
      break;
    }
    case 'item.move': {
      const f = findItem(c, op.itemId);
      const to = getBlock(c, op.toBlock);
      if (!f) { changed = false; break; }
      if (f.blockId !== op.toBlock && to.items.length >= LIMITS.items) throw new OpError('대상 블록이 가득 찼습니다.');
      c.blocks[f.blockId].items.splice(f.index, 1);
      insertAt(to.items, f.item, op.index);
      break;
    }
    case 'meta.title': {
      const t = clip(op.title, LIMITS.title).trim() || '제목 없는 캔버스';
      if (t === c.title) { changed = false; break; }
      c.title = t;
      break;
    }
    case 'comment.add': {
      if (!idOk(op.id)) throw new OpError('코멘트 ID가 올바르지 않습니다.');
      if (c.comments.some((x) => x.id === op.id)) { changed = false; break; }
      if (c.comments.length >= LIMITS.comments) throw new OpError('코멘트 수 한도를 초과했습니다.');
      const text = clip(op.text, LIMITS.comment).trim();
      if (!text) throw new OpError('코멘트 내용을 입력하세요.');
      if (op.blockId) getBlock(c, op.blockId);
      c.comments.push({
        id: op.id,
        blockId: op.blockId || null,
        itemId: op.itemId && idOk(op.itemId) ? op.itemId : null,
        quote: clip(op.quote, 200),
        text,
        author: who,
        authorId: clip(actor.cid, 40),
        at: now,
        status: 'open',
        statusBy: null,
        statusAt: null,
        replies: [],
      });
      break;
    }
    case 'comment.reply': {
      const cm = c.comments.find((x) => x.id === op.commentId);
      if (!cm) throw new OpError('코멘트를 찾을 수 없습니다.');
      if (!idOk(op.id)) throw new OpError('답글 ID가 올바르지 않습니다.');
      if (cm.replies.some((r) => r.id === op.id)) { changed = false; break; }
      if (cm.replies.length >= LIMITS.replies) throw new OpError('답글 수 한도를 초과했습니다.');
      const text = clip(op.text, LIMITS.comment).trim();
      if (!text) throw new OpError('답글 내용을 입력하세요.');
      cm.replies.push({ id: op.id, text, author: who, authorId: clip(actor.cid, 40), at: now });
      break;
    }
    case 'comment.status': {
      const cm = c.comments.find((x) => x.id === op.commentId);
      if (!cm) throw new OpError('코멘트를 찾을 수 없습니다.');
      if (!['open', 'resolved', 'closed'].includes(op.status)) throw new OpError('잘못된 상태입니다.');
      if (cm.status === op.status) { changed = false; break; }
      cm.status = op.status;
      cm.statusBy = op.status === 'open' ? null : who;
      cm.statusAt = op.status === 'open' ? null : now;
      break;
    }
    case 'canvas.finalize': {
      c.status = 'final';
      c.finalizedAt = now;
      c.finalizedBy = who;
      c.report = null;
      break;
    }
    case 'canvas.reopen': {
      if (c.status !== 'final') { changed = false; break; }
      c.status = 'draft';
      c.report = null;
      delete c.finalizedAt; delete c.finalizedBy;
      break;
    }
    case 'report.set': {
      if (c.status !== 'final') throw new OpError('최종 확정 후에만 리포트를 저장할 수 있습니다.');
      c.report = sanitizeReport(op.report);
      break;
    }
    default:
      throw new OpError('지원하지 않는 작업입니다.');
  }

  if (changed) { c.version += 1; c.updatedAt = now; }
  return changed;
}
