// 리포트/규칙 기반(AI 미연결 시) 피드백 — 서버/클라이언트 공용
import { TEMPLATES } from './templates.js';
import { STATUS_LABEL, commentCounts, formatCode } from './markdown.js';

export { STATUS_LABEL };

/** 코멘트 요약(결정적 계산). 최종 리포트에 포함됩니다. */
export function summarizeComments(c) {
  const t = TEMPLATES[c.template];
  const names = Object.fromEntries(t.blocks.map((b) => [b.id, b.name]));
  const counts = commentCounts(c);
  const byBlock = {};
  for (const cm of c.comments) {
    const key = cm.blockId || '_canvas';
    byBlock[key] = byBlock[key] || { open: 0, resolved: 0, closed: 0 };
    byBlock[key][cm.status] += 1;
  }
  const participants = new Set();
  c.comments.forEach((cm) => { participants.add(cm.author); cm.replies.forEach((r) => participants.add(r.author)); });
  return {
    total: c.comments.length,
    ...counts,
    participants: [...participants],
    byBlock: Object.entries(byBlock).map(([id, v]) => ({ blockId: id, name: id === '_canvas' ? '캔버스 전체' : names[id], ...v })),
    threads: c.comments.map((cm) => ({
      id: cm.id,
      blockId: cm.blockId,
      blockName: cm.blockId ? names[cm.blockId] : '캔버스 전체',
      quote: cm.quote,
      text: cm.text,
      author: cm.author,
      at: cm.at,
      status: cm.status,
      statusBy: cm.statusBy,
      replies: cm.replies,
    })),
  };
}

const VAGUE = /(모든 ?사람|누구나|everyone|all users|모두)/i;

/** AI 키가 없을 때 쓰는 규칙 기반 점검 */
export function fallbackFeedback(c, scope = 'canvas', blockId = null) {
  const t = TEMPLATES[c.template];
  const target = scope === 'block' ? t.blocks.filter((b) => b.id === blockId) : t.blocks;
  const out = [];
  let total = 0;
  for (const b of target) {
    const items = c.blocks[b.id].items;
    const issues = [];
    let rating = 4;
    if (!items.length) { issues.push('아직 비어 있습니다.'); rating = 1; }
    else {
      if (items.length < 2 && !['uvp'].includes(b.id)) { issues.push('항목이 1개뿐입니다. 근거나 대안을 더 구체화해 보세요.'); rating = 2; }
      if (items.every((i) => i.text.trim().length < 8)) { issues.push('내용이 너무 짧아 구체성이 부족합니다.'); rating = Math.min(rating, 2); }
      if (b.id === 'segments' && items.some((i) => VAGUE.test(i.text))) { issues.push('"모든 사람"처럼 범위가 넓습니다. 얼리어답터 중심으로 좁히세요.'); rating = Math.min(rating, 2); }
      if (b.id === 'revenue' && !items.some((i) => /\d/.test(i.text))) { issues.push('가격·단가 등 수치가 없습니다.'); rating = Math.min(rating, 3); }
      if (b.id === 'metrics' && !items.some((i) => /\d/.test(i.text))) { issues.push('목표 수치를 함께 적으면 검증이 쉬워집니다.'); rating = Math.min(rating, 3); }
      if (b.id === 'uvp' && items.some((i) => i.text.length > 100)) { issues.push('한 문장(약 100자 이내)으로 압축해 보세요.'); rating = Math.min(rating, 3); }
    }
    total += rating;
    out.push({ blockId: b.id, rating, issues, suggestions: [] });
  }
  const filled = t.blocks.filter((b) => c.blocks[b.id].items.length).length;
  return {
    provider: 'rule-based',
    overall: scope === 'block'
      ? 'AI가 연결되지 않아 기본 규칙으로 점검했습니다.'
      : `AI가 연결되지 않아 기본 규칙으로 점검했습니다. ${t.blocks.length}개 블록 중 ${filled}개가 채워져 있습니다.`,
    score: Math.round((total / (target.length * 5)) * 100),
    blocks: out,
  };
}

export function fallbackReport(c) {
  const t = TEMPLATES[c.template];
  const filled = t.blocks.filter((b) => c.blocks[b.id].items.length);
  const empty = t.blocks.filter((b) => !c.blocks[b.id].items.length);
  const cs = summarizeComments(c);
  const actions = [];
  for (const b of empty) {
    actions.push({ title: `'${b.name}' 블록 채우기`, detail: b.hint, priority: 'high', blockId: b.id, timeframe: '이번 주' });
  }
  const fb = fallbackFeedback(c);
  for (const bf of fb.blocks.filter((x) => x.rating <= 2 && c.blocks[x.blockId].items.length)) {
    const b = t.blocks.find((x) => x.id === bf.blockId);
    actions.push({ title: `'${b.name}' 구체화`, detail: bf.issues.join(' '), priority: 'medium', blockId: b.id, timeframe: '2주 내' });
  }
  for (const th of cs.threads.filter((x) => x.status === 'open')) {
    actions.push({ title: `미해결 코멘트 처리: ${th.text.slice(0, 40)}`, detail: `${th.blockName} · ${th.author}`, priority: 'medium', blockId: th.blockId || '', timeframe: '이번 주' });
  }
  actions.push({ title: '핵심 가정 검증 인터뷰/실험 설계', detail: '가장 불확실한 가정 1–2개를 골라 고객 인터뷰나 랜딩 테스트로 검증합니다.', priority: 'medium', blockId: '', timeframe: '1개월 내' });
  return {
    provider: 'rule-based',
    generatedAt: Date.now(),
    headline: `${c.title} — ${t.name} 최종 확정본`,
    summary: `${t.name} ${t.blocks.length}개 블록 중 ${filled.length}개가 작성되었습니다. 코멘트는 총 ${cs.total}건(열림 ${cs.open}, 해결 ${cs.resolved}, 닫힘 ${cs.closed})입니다.`,
    strengths: filled.slice(0, 4).map((b) => `${b.name}: ${c.blocks[b.id].items.length}개 항목 작성`),
    risks: empty.map((b) => `${b.name} 미작성`).slice(0, 6),
    commentDigest: cs.total ? `총 ${cs.total}건 중 ${cs.resolved}건 해결, ${cs.closed}건 닫힘, ${cs.open}건 열림.` : '',
    actions: actions.slice(0, 12),
  };
}

export function reportToMarkdown(c, r) {
  const t = TEMPLATES[c.template];
  const cs = summarizeComments(c);
  const names = Object.fromEntries(t.blocks.map((b) => [b.id, b.name]));
  const L = [`# ${r.headline || c.title}`, '', `_${t.name} · 공유 코드 ${formatCode(c.code)}_`, '', '## 요약', r.summary, ''];
  if (r.strengths?.length) L.push('## 강점', ...r.strengths.map((s) => `- ${s}`), '');
  if (r.risks?.length) L.push('## 리스크', ...r.risks.map((s) => `- ${s}`), '');
  L.push('## 액션 아이템');
  r.actions.forEach((a, i) => L.push(`${i + 1}. **[${a.priority}]** ${a.title}${a.timeframe ? ` _(${a.timeframe})_` : ''}${a.blockId && names[a.blockId] ? ` — ${names[a.blockId]}` : ''}${a.detail ? `\n   - ${a.detail}` : ''}`));
  L.push('', '## 코멘트 요약', `열림 ${cs.open} · 해결 ${cs.resolved} · 닫힘 ${cs.closed} (총 ${cs.total})`, '');
  if (r.commentDigest) L.push(r.commentDigest, '');
  for (const th of cs.threads) L.push(`- [${STATUS_LABEL[th.status]}] ${th.blockName} · ${th.author}: ${th.text.replace(/\n/g, ' ')}`);
  return L.join('\n') + '\n';
}
