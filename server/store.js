// 파일 기반 저장소 (캔버스당 JSON 1개). 영구 디스크(DATA_DIR)가 필요합니다.
import fs from 'node:fs';
import path from 'node:path';
import { randomInt } from 'node:crypto';

const ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'; // 헷갈리는 0/O/1/I 제외
export const CODE_RE = /^[A-Z0-9]{8}$/;

export function normalizeCode(input) {
  return String(input || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export function randomCode() {
  let s = '';
  for (let i = 0; i < 8; i++) s += ALPHABET[randomInt(ALPHABET.length)];
  return s;
}

export class Store {
  constructor(dir) {
    this.dir = dir;
    this.cache = new Map();
    this.timers = new Map();
    fs.mkdirSync(dir, { recursive: true });
  }

  file(code) { return path.join(this.dir, `${code}.json`); }

  get(code) {
    if (!CODE_RE.test(code)) return null;
    if (this.cache.has(code)) return this.cache.get(code);
    try {
      const c = JSON.parse(fs.readFileSync(this.file(code), 'utf8'));
      this.cache.set(code, c);
      return c;
    } catch { return null; }
  }

  exists(code) { return !!this.get(code); }

  create(factory) {
    let code;
    do { code = randomCode(); } while (this.exists(code));
    const c = factory(code);
    this.cache.set(code, c);
    this.saveNow(code);
    return c;
  }

  touch(code) {
    clearTimeout(this.timers.get(code));
    this.timers.set(code, setTimeout(() => this.saveNow(code), 400));
  }

  saveNow(code) {
    clearTimeout(this.timers.get(code));
    this.timers.delete(code);
    const c = this.cache.get(code);
    if (!c) return;
    const tmp = this.file(code) + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(c));
    fs.renameSync(tmp, this.file(code));
  }

  flushAll() { for (const code of [...this.timers.keys()]) this.saveNow(code); }
}
