// 캔버스 템플릿 정의 (서버/클라이언트 공용)
// areas: CSS grid-template-areas (10열 x 3행)

const row = (...pairs) => pairs.flatMap(([id, n]) => Array(n).fill(id)).join(' ');

export const TEMPLATES = {
  lean: {
    id: 'lean',
    name: 'Lean Canvas',
    by: 'Ash Maurya',
    description: '스타트업 아이디어를 문제 중심으로 빠르게 검증하는 1페이지 사업 계획.',
    areas: [
      row(['problem', 2], ['solution', 2], ['uvp', 2], ['advantage', 2], ['segments', 2]),
      row(['problem', 2], ['metrics', 2], ['uvp', 2], ['channels', 2], ['segments', 2]),
      row(['cost', 5], ['revenue', 5]),
    ],
    blocks: [
      { id: 'segments', no: 1, name: '고객 세그먼트', en: 'Customer Segments', tone: 0,
        hint: '누가 고객인가? 얼리어답터의 특성을 함께 적습니다.',
        criteria: '구체적이고 측정 가능한 고객 정의인가, 얼리어답터가 구분되어 있는가' },
      { id: 'problem', no: 2, name: '문제', en: 'Problem', tone: 1,
        hint: '고객의 상위 1–3개 문제와 기존 대안.',
        criteria: '고객 관점의 실제 문제인가, 기존 대안이 적혀 있는가, 3개 이내로 압축되었는가' },
      { id: 'uvp', no: 3, name: '고유 가치 제안', en: 'Unique Value Proposition', tone: 2,
        hint: '왜 다르고, 왜 지금 살 가치가 있는가? 한 문장으로.',
        criteria: '한 문장으로 명확한가, 경쟁 대안과 차별되는가, 고객 언어로 쓰였는가' },
      { id: 'solution', no: 4, name: '솔루션', en: 'Solution', tone: 3,
        hint: '각 문제를 풀 최소 기능 3개 이내.',
        criteria: '문제와 1:1로 대응하는가, MVP 수준으로 작게 정의되었는가' },
      { id: 'channels', no: 5, name: '채널', en: 'Channels', tone: 4,
        hint: '고객에게 도달하는 경로 (무료·유료).',
        criteria: '고객 세그먼트에 실제 도달 가능한 경로인가, 획득 비용을 가늠할 수 있는가' },
      { id: 'revenue', no: 6, name: '수익원', en: 'Revenue Streams', tone: 5,
        hint: '가격, 매출총이익, 고객생애가치(LTV).',
        criteria: '가격/단가 등 수치가 있는가, 지불 주체가 명확한가' },
      { id: 'cost', no: 7, name: '비용 구조', en: 'Cost Structure', tone: 6,
        hint: '고객 획득 비용, 인건비, 인프라, 손익분기점.',
        criteria: '주요 고정비·변동비가 식별되었는가, 수익원과 균형이 맞는가' },
      { id: 'metrics', no: 8, name: '핵심 지표', en: 'Key Metrics', tone: 7,
        hint: '성장을 판단할 핵심 수치 (획득·활성·유지·매출·추천).',
        criteria: '행동 기반의 측정 가능한 지표인가, 허영 지표가 아닌가' },
      { id: 'advantage', no: 9, name: '경쟁 우위', en: 'Unfair Advantage', tone: 8,
        hint: '쉽게 복제하거나 살 수 없는 강점.',
        criteria: '모방이 어려운 근거(독점 데이터·네트워크·전문성 등)가 있는가' },
    ],
  },

  bmc: {
    id: 'bmc',
    name: 'Business Model Canvas',
    by: 'Alexander Osterwalder',
    description: '9개 구성 요소로 기존·신규 사업 모델 전체를 시각화하는 프레임워크.',
    areas: [
      row(['partners', 2], ['activities', 2], ['value', 2], ['relationships', 2], ['segments', 2]),
      row(['partners', 2], ['resources', 2], ['value', 2], ['channels', 2], ['segments', 2]),
      row(['cost', 5], ['revenue', 5]),
    ],
    blocks: [
      { id: 'segments', no: 1, name: '고객 세그먼트', en: 'Customer Segments', tone: 0,
        hint: '가치를 전달할 대상 집단은 누구인가?',
        criteria: '세그먼트가 뚜렷하게 나뉘고 각각의 필요가 다른가' },
      { id: 'value', no: 2, name: '가치 제안', en: 'Value Propositions', tone: 2,
        hint: '어떤 문제를 해결하고 어떤 가치를 전달하는가?',
        criteria: '세그먼트별 문제/니즈와 연결되는가, 경쟁 대안 대비 차별점이 있는가' },
      { id: 'channels', no: 3, name: '채널', en: 'Channels', tone: 4,
        hint: '인지·평가·구매·전달·사후지원을 어떤 경로로 하는가?',
        criteria: '고객 여정 단계별 경로가 있는가' },
      { id: 'relationships', no: 4, name: '고객 관계', en: 'Customer Relationships', tone: 1,
        hint: '고객 획득·유지·확대를 위해 어떤 관계를 맺는가?',
        criteria: '관계 유형이 세그먼트와 맞고 비용이 감당 가능한가' },
      { id: 'revenue', no: 5, name: '수익원', en: 'Revenue Streams', tone: 5,
        hint: '고객은 무엇에 대해, 어떻게 지불하는가?',
        criteria: '수익 모델(구독·판매·수수료 등)과 가격 근거가 있는가' },
      { id: 'resources', no: 6, name: '핵심 자원', en: 'Key Resources', tone: 3,
        hint: '가치 제안을 위해 꼭 필요한 자산(인적·물적·지적·재무).',
        criteria: '가치 제안 전달에 필수적인 자원만 적혀 있는가' },
      { id: 'activities', no: 7, name: '핵심 활동', en: 'Key Activities', tone: 7,
        hint: '가치 제안을 위해 반드시 해야 하는 활동.',
        criteria: '가치 제안·채널·수익원과 직접 연결되는 활동인가' },
      { id: 'partners', no: 8, name: '핵심 파트너', en: 'Key Partners', tone: 8,
        hint: '핵심 공급자·제휴사와 그들이 제공하는 것.',
        criteria: '외부 의존 대상과 얻는 가치가 명시되었는가' },
      { id: 'cost', no: 9, name: '비용 구조', en: 'Cost Structure', tone: 6,
        hint: '가장 큰 비용 항목과 그 원인(자원·활동).',
        criteria: '핵심 자원/활동에서 비롯된 주요 비용이 식별되었는가' },
    ],
  },
};

export function getTemplate(id) {
  return TEMPLATES[id] || null;
}

export function blockMap(templateId) {
  const t = TEMPLATES[templateId];
  return Object.fromEntries(t.blocks.map((b) => [b.id, b]));
}

/** areas 문자열에서 각 블록의 (col,row,colSpan,rowSpan)을 계산 (슬라이드 내보내기용) */
export function blockRects(templateId) {
  const t = TEMPLATES[templateId];
  const grid = t.areas.map((r) => r.split(' '));
  const rects = {};
  grid.forEach((cols, r) => cols.forEach((id, c) => {
    const x = rects[id] || (rects[id] = { c0: c, c1: c, r0: r, r1: r });
    x.c0 = Math.min(x.c0, c); x.c1 = Math.max(x.c1, c);
    x.r0 = Math.min(x.r0, r); x.r1 = Math.max(x.r1, r);
  }));
  return { rects, cols: grid[0].length, rows: grid.length };
}
