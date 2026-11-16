import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSlideRequests } from '../public/js/slides.js';
import { applyOp, newCanvas } from '../public/js/shared/ops.js';
import { fallbackReport } from '../public/js/shared/report.js';

test('슬라이드 요청: 모든 템플릿에서 유효한 구조/고유 ID', () => {
  for (const template of ['lean', 'bmc']) {
    const c = newCanvas({ code: 'ABCDEFGH', title: '긴 제목 '.repeat(20), template, owner: 'a' });
    applyOp(c, { type: 'item.add', blockId: 'segments', itemId: 'seg1', text: '고객 '.repeat(80) }, { name: 'a' });
    applyOp(c, { type: 'comment.add', id: 'cmt1', blockId: 'segments', text: '코멘트' }, { name: 'a' });
    const reqs = buildSlideRequests(c, fallbackReport(c));
    const ids = reqs.flatMap((r) => [r.createSlide?.objectId, r.createShape?.objectId]).filter(Boolean);
    assert.equal(new Set(ids).size, ids.length, '객체 ID 중복 없음');
    assert.ok(ids.every((id) => /^[\w-]{5,50}$/.test(id)));
    const shapes = new Set(reqs.filter((r) => r.createShape).map((r) => r.createShape.objectId));
    for (const r of reqs) {
      const target = r.insertText?.objectId || r.updateTextStyle?.objectId || r.updateShapeProperties?.objectId;
      if (target) assert.ok(shapes.has(target), '존재하는 도형만 수정');
    }
    assert.ok(reqs.filter((r) => r.createSlide).length >= 5);
  }
});
