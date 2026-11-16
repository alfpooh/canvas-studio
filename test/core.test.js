import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { WebSocket } from 'ws';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'cs-'));
const { start, server, store } = await import('../server/index.js');
const { applyOp, newCanvas, OpError } = await import('../public/js/shared/ops.js');
const { canvasToMarkdown, parseCanvasMarkdown } = await import('../public/js/shared/markdown.js');
const { fallbackReport, summarizeComments } = await import('../public/js/shared/report.js');

const actor = { name: '앨리스', cid: 'cid-a' };

test('ops: 항목 추가/수정/이동/삭제와 멱등성', () => {
  const c = newCanvas({ code: 'ABCDEFGH', title: 't', template: 'lean', owner: 'a' });
  assert.equal(applyOp(c, { type: 'item.add', blockId: 'problem', itemId: 'item1', text: '문제 A' }, actor), true);
  assert.equal(applyOp(c, { type: 'item.add', blockId: 'problem', itemId: 'item1', text: '문제 A' }, actor), false);
  applyOp(c, { type: 'item.update', itemId: 'item1', text: '문제 A+' }, actor);
  applyOp(c, { type: 'item.move', itemId: 'item1', toBlock: 'solution', index: 0 }, actor);
  assert.equal(c.blocks.problem.items.length, 0);
  assert.equal(c.blocks.solution.items[0].text, '문제 A+');
  applyOp(c, { type: 'item.delete', itemId: 'item1' }, actor);
  assert.equal(c.blocks.solution.items.length, 0);
  assert.throws(() => applyOp(c, { type: 'item.add', blockId: 'nope', itemId: 'zzz', text: '' }, actor), OpError);
});

test('ops: 코멘트 resolve/close/reply 및 최종 확정 잠금', () => {
  const c = newCanvas({ code: 'ABCDEFGH', title: 't', template: 'bmc', owner: 'a' });
  applyOp(c, { type: 'comment.add', id: 'cmt1', blockId: 'value', text: '구체화 필요' }, actor);
  applyOp(c, { type: 'comment.reply', commentId: 'cmt1', id: 'rep1', text: '동의' }, { name: '밥' });
  applyOp(c, { type: 'comment.status', commentId: 'cmt1', status: 'resolved' }, { name: '밥' });
  assert.equal(c.comments[0].status, 'resolved');
  assert.equal(c.comments[0].statusBy, '밥');
  applyOp(c, { type: 'canvas.finalize' }, actor);
  assert.throws(() => applyOp(c, { type: 'item.add', blockId: 'value', itemId: 'x12', text: 'a' }, actor), /최종 확정/);
  applyOp(c, { type: 'report.set', report: fallbackReport(c) }, actor);
  assert.ok(c.report.actions.length > 0);
  const cs = summarizeComments(c);
  assert.equal(cs.resolved, 1);
  applyOp(c, { type: 'canvas.reopen' }, actor);
  assert.equal(c.status, 'draft');
});

test('markdown: 왕복 변환(기계가 읽을 수 있음)', () => {
  const c = newCanvas({ code: 'ABCDEFGH', title: '테스트 "제목"', template: 'lean', owner: 'a' });
  applyOp(c, { type: 'item.add', blockId: 'segments', itemId: 'seg1', text: '1인 개발자\n두 번째 줄' }, actor);
  applyOp(c, { type: 'item.add', blockId: 'segments', itemId: 'seg2', text: '프리랜서' }, actor);
  applyOp(c, { type: 'comment.add', id: 'cmt1', blockId: 'segments', text: '더 좁히기' }, actor);
  const md = canvasToMarkdown(c);
  const p = parseCanvasMarkdown(md);
  assert.equal(p.meta.schema, 'canvas-studio/v1');
  assert.equal(p.meta.title, '테스트 "제목"');
  assert.deepEqual(p.blocks.segments, [{ id: 'seg1', text: '1인 개발자\n두 번째 줄' }, { id: 'seg2', text: '프리랜서' }]);
  assert.deepEqual(p.blocks.problem, []);
});

test('서버: 생성, 두 클라이언트 실시간 동기화, 마크다운 엔드포인트', async () => {
  const port = await start(0);
  const base = `http://127.0.0.1:${port}`;
  const created = await (await fetch(`${base}/api/canvas`, { method: 'POST', body: JSON.stringify({ title: 'T', template: 'lean', owner: 'A' }) })).json();
  assert.match(created.code, /^[A-Z0-9]{8}$/);

  const open = (name) => new Promise((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?c=${created.code}&name=${name}&cid=${name}`);
    const msgs = [];
    ws.on('message', (d) => msgs.push(JSON.parse(d)));
    ws.on('open', () => setTimeout(() => resolve({ ws, msgs }), 100));
  });
  const a = await open('A'); const b = await open('B');
  assert.equal(a.msgs[0].t, 'init');

  a.ws.send(JSON.stringify({ t: 'op', id: 'o1', op: { type: 'item.add', blockId: 'problem', itemId: 'it1', text: '실시간' } }));
  await new Promise((r) => setTimeout(r, 150));
  const got = b.msgs.find((m) => m.t === 'op');
  assert.equal(got.op.text, '실시간');
  assert.equal(got.by.name, 'A');
  assert.ok(a.msgs.find((m) => m.t === 'op' && m.id === 'o1'), '송신자도 에코를 받는다');

  b.ws.send(JSON.stringify({ t: 'op', id: 'o2', op: { type: 'item.add', blockId: 'zzz', itemId: 'it2', text: '' } }));
  await new Promise((r) => setTimeout(r, 100));
  assert.ok(b.msgs.find((m) => m.t === 'error' && m.id === 'o2'));

  const md = await (await fetch(`${base}/api/canvas/${created.code}.md`)).text();
  assert.match(md, /실시간/);
  assert.equal((await fetch(`${base}/api/canvas/AAAAAAAA`)).status, 404);

  const fb = await (await fetch(`${base}/api/ai/feedback`, { method: 'POST', body: JSON.stringify({ code: created.code, scope: 'canvas' }) })).json();
  assert.ok(fb.blocks.length === 9);

  a.ws.close(); b.ws.close();
  store.flushAll();
  server.close();
  server.closeAllConnections?.();
});
