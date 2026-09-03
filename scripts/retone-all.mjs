#!/usr/bin/env node
// 발행된 글 전체를 현재 문체·제목 규칙으로 다시 쓴다. 사실·수치는 유지된다.
//   node scripts/retone-all.mjs [--dry] [--only 3,5]
import { db } from '../src/core/db.js';
import { retonePost } from '../src/content/revise.js';

const only = process.argv.find((a) => a.startsWith('--only'))?.split('=')[1]
  ?? (process.argv.includes('--only') ? process.argv[process.argv.indexOf('--only') + 1] : null);
const ids = only ? only.split(',').map(Number) : null;

const rows = db.prepare("SELECT id, title, status FROM posts WHERE status='published' ORDER BY id").all()
  .filter((r) => !ids || ids.includes(r.id));

console.log(`대상 ${rows.length}편\n`);
if (process.argv.includes('--dry')) {
  for (const r of rows) console.log(`  #${r.id} ${r.title}`);
  process.exit(0);
}

let ok = 0;
for (const r of rows) {
  process.stdout.write(`\n[#${r.id}] ${r.title}\n`);
  try {
    const res = await retonePost(r.id);
    console.log(`  → ${res.title}`);
    console.log(`  품질 ${res.quality.score}점 · ${res.quality.chars}자 · ${res.url}`);
    ok++;
  } catch (e) {
    console.error(`  ✖ 실패: ${e.message}`);
  }
}
console.log(`\n${ok}/${rows.length}편 완료`);
