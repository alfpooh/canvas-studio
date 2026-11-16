// AI 연동 (Google Gemini API). GEMINI_API_KEY 가 없으면 규칙 기반 결과로 대체합니다.
import { TEMPLATES } from '../public/js/shared/templates.js';
import { fallbackFeedback, fallbackReport, summarizeComments } from '../public/js/shared/report.js';

const MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
const KEY = process.env.GEMINI_API_KEY || '';

export const aiEnabled = () => !!KEY;
export const aiModel = () => MODEL;

async function callGemini(system, user, maxTokens = 2500) {
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(MODEL)}:generateContent`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': KEY },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: 'user', parts: [{ text: user }] }],
      generationConfig: { responseMimeType: 'application/json', maxOutputTokens: maxTokens, temperature: 0.4 },
    }),
    signal: AbortSignal.timeout(60000),
  });
  if (!res.ok) throw new Error(`AI 응답 오류 (${res.status})`);
  const data = await res.json();
  const text = (data.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('');
  const s = text.indexOf('{'); const e = text.lastIndexOf('}');
  if (s < 0 || e < s) throw new Error('AI 응답을 해석하지 못했습니다.');
  return JSON.parse(text.slice(s, e + 1));
}

function describe(c) {
  const t = TEMPLATES[c.template];
  const lines = [`캔버스: ${c.title} (${t.name})`];
  for (const b of t.blocks) {
    lines.push(`\n[${b.id}] ${b.no}. ${b.name} (${b.en}) — 기준: ${b.criteria}`);
    const items = c.blocks[b.id].items;
    if (!items.length) lines.push('  (비어 있음)');
    items.forEach((it) => lines.push(`  - (id:${it.id}) ${it.text.replace(/\n/g, ' / ')}`));
  }
  return lines.join('\n');
}

const SYS_FEEDBACK = `당신은 스타트업과 신사업을 돕는 날카롭지만 건설적인 비즈니스 모델 코치입니다.
입력된 캔버스를 읽고 각 블록의 구체성·일관성·검증 가능성을 평가하세요.
- 모든 답변은 한국어. 추측은 추측이라고 표시하고, 입력에 없는 사실을 지어내지 마세요.
- 블록 간 모순(예: 세그먼트와 채널 불일치, 수익원과 비용 불균형)을 우선 지적하세요.
- 제안(suggestions)은 사용자가 바로 항목으로 넣을 수 있는 짧은 문장(80자 이내)으로 쓰세요.
  kind="add"는 새 항목, kind="replace"는 기존 항목을 고쳐 쓴 문장이며 targetItemId에 기존 id를 넣습니다.
- 반드시 아래 JSON 하나만 출력하세요(설명·마크다운 금지):
{"overall":"2~4문장 총평","score":0-100,"blocks":[{"blockId":"...","rating":1-5,"issues":["..."],"suggestions":[{"kind":"add|replace","text":"...","targetItemId":"..."}]}]}`;

const SYS_REPORT = `당신은 비즈니스 모델 컨설턴트입니다. 최종 확정된 캔버스와 협업 코멘트 기록을 바탕으로 경영진용 요약 리포트를 작성하세요.
- 모든 답변은 한국어. 입력에 없는 수치나 사실을 만들지 마세요.
- actions 는 "다음에 실제로 해야 할 일" 5~10개: 구체적 동사로 시작하고 우선순위(high|medium|low), 기한 감각(이번 주|2주 내|1개월 내|분기 내), 관련 blockId 를 포함하세요.
- 열림 상태 코멘트는 액션 아이템에 반영하고, commentDigest 에는 논의의 핵심 쟁점과 해결/닫힘 결과를 2~4문장으로 요약하세요.
- 반드시 아래 JSON 하나만 출력하세요:
{"headline":"한 줄 제목","summary":"4~6문장 요약","strengths":["..."],"risks":["..."],"commentDigest":"...","actions":[{"title":"...","detail":"...","priority":"high|medium|low","blockId":"...","timeframe":"..."}]}`;

function cleanFeedback(raw, c, scope, blockId) {
  const t = TEMPLATES[c.template];
  const valid = new Set(t.blocks.map((b) => b.id));
  const blocks = (Array.isArray(raw.blocks) ? raw.blocks : [])
    .filter((b) => valid.has(b.blockId) && (scope !== 'block' || b.blockId === blockId))
    .map((b) => ({
      blockId: b.blockId,
      rating: Math.max(1, Math.min(5, Math.round(Number(b.rating) || 3))),
      issues: (Array.isArray(b.issues) ? b.issues : []).slice(0, 6).map((s) => String(s).slice(0, 300)),
      suggestions: (Array.isArray(b.suggestions) ? b.suggestions : []).slice(0, 5).map((s) => ({
        kind: s.kind === 'replace' ? 'replace' : 'add',
        text: String(s.text || '').slice(0, 300),
        targetItemId: s.kind === 'replace' ? String(s.targetItemId || '') : '',
      })).filter((s) => s.text),
    }));
  return {
    provider: `gemini:${MODEL}`,
    overall: String(raw.overall || '').slice(0, 1200),
    score: Math.max(0, Math.min(100, Math.round(Number(raw.score) || 0))),
    blocks,
  };
}

export async function aiFeedback(c, scope, blockId) {
  if (!KEY) return fallbackFeedback(c, scope, blockId);
  const focus = scope === 'block' ? `\n\n이번 요청은 [${blockId}] 블록만 평가하되 나머지는 맥락으로 참고하세요.` : '';
  const raw = await callGemini(SYS_FEEDBACK, describe(c) + focus);
  return cleanFeedback(raw, c, scope, blockId);
}

export async function aiReport(c) {
  if (!KEY) return fallbackReport(c);
  const cs = summarizeComments(c);
  const comments = cs.threads.map((th) =>
    `- [${th.status}] ${th.blockName} · ${th.author}: ${th.text}` +
    th.replies.map((r) => `\n    ↳ ${r.author}: ${r.text}`).join('') +
    (th.statusBy ? `\n    (${th.status} by ${th.statusBy})` : '')).join('\n') || '(코멘트 없음)';
  const raw = await callGemini(SYS_REPORT, `${describe(c)}\n\n[코멘트 기록]\n${comments}`, 3000);
  return { ...raw, provider: `gemini:${MODEL}`, generatedAt: Date.now() };
}
