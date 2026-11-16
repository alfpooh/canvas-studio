// WebSocket 세션: 서버가 확정한 순서대로만 상태를 적용해 모든 참여자가 같은 결과로 수렴합니다.
import { applyOp, uid } from './shared/ops.js';
import { createBus } from './dom.js';

export class Session {
  constructor(code, user) {
    this.code = code;
    this.user = user;
    this.canvas = null;
    this.me = null;
    this.peers = [];
    this.bus = createBus();
    this.pending = new Map(); // opId -> {resolve, reject}
    this.queue = []; // 오프라인 중 쌓인 메시지
    this.ws = null;
    this.retry = 0;
    this.closed = false;
    this.connected = false;
  }

  on(ev, fn) { return this.bus.on(ev, fn); }

  connect() {
    const q = new URLSearchParams({ c: this.code, name: this.user.name, color: this.user.color, cid: this.user.cid });
    const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws?${q}`);
    this.ws = ws;
    ws.onopen = () => { this.retry = 0; };
    ws.onmessage = (e) => this.onMessage(JSON.parse(e.data));
    ws.onclose = (e) => {
      this.connected = false;
      this.bus.emit('status', { connected: false });
      if (this.closed) return;
      if (e.code === 4404) { this.bus.emit('notfound'); return; }
      this.retry += 1;
      setTimeout(() => !this.closed && this.connect(), Math.min(8000, 400 * 2 ** this.retry));
    };
  }

  onMessage(m) {
    if (m.t === 'init') {
      this.canvas = m.canvas;
      this.me = m.me;
      this.peers = m.peers;
      this.connected = true;
      this.bus.emit('init');
      this.bus.emit('status', { connected: true });
      const q = this.queue.splice(0);
      q.forEach((x) => this.ws.send(x));
    } else if (m.t === 'op') {
      if (m.changed !== false) applyOp(this.canvas, m.op, m.by);
      const mine = m.by.id === this.me.id;
      this.bus.emit('op', { op: m.op, by: m.by, mine, changed: m.changed !== false, id: m.id });
      const p = this.pending.get(m.id);
      if (p) { this.pending.delete(m.id); p.resolve(m); }
    } else if (m.t === 'peers') {
      this.peers = m.peers;
      this.bus.emit('peers');
    } else if (m.t === 'error') {
      const p = this.pending.get(m.id);
      if (p) { this.pending.delete(m.id); p.reject(new Error(m.message)); } else this.bus.emit('error', m.message);
    }
  }

  /** op 전송. 서버 에코가 도착하면 resolve. */
  send(op) {
    const id = uid();
    const data = JSON.stringify({ t: 'op', id, op });
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      if (this.ws?.readyState === 1 && this.connected) this.ws.send(data);
      else this.queue.push(data);
    });
  }

  focus(target) {
    if (this.ws?.readyState === 1) this.ws.send(JSON.stringify({ t: 'focus', target }));
  }

  close() { this.closed = true; this.ws?.close(); }
}
