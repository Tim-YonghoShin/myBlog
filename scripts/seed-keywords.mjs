#!/usr/bin/env node
// keywords/seed-keywords.csv 를 DB 의 keywords 테이블로 적재한다. 중복은 건너뛴다.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { db, migrate } from '../src/core/db.js';
import { config } from '../src/core/config.js';

migrate();

const [head, ...lines] = readFileSync(join(config.root, 'keywords/seed-keywords.csv'), 'utf8').trim().split('\n');
const cols = head.split(',');
const stmt = db.prepare(`
  INSERT INTO keywords (keyword, category, intent, difficulty, season, money, note, source)
  VALUES (?, ?, ?, ?, ?, ?, ?, 'seed')
  ON CONFLICT(keyword) DO NOTHING
`);

let added = 0;
for (const line of lines) {
  if (!line.trim()) continue;
  const r = Object.fromEntries(line.split(',').map((v, i) => [cols[i], v?.trim() ?? '']));
  const res = stmt.run(r.keyword, r.category, r.intent, r.difficulty, r.season, r.money, r.note);
  added += res.changes;
}

const total = db.prepare('SELECT COUNT(*) c FROM keywords').get().c;
const byCat = db.prepare('SELECT category, COUNT(*) c FROM keywords GROUP BY category ORDER BY c DESC').all();
console.log(`신규 ${added}개 적재 · 전체 ${total}개`);
for (const r of byCat) console.log(`  ${r.category}: ${r.c}`);
