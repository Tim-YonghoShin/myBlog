#!/usr/bin/env node
// data/posts.csv 를 읽어 발행 현황과 수익 지표를 요약한다.
// 사용법: node scripts/track.mjs

import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const file = join(ROOT, 'data/posts.csv');

if (!existsSync(file)) {
  console.log('아직 발행 기록이 없습니다. node scripts/new-post.mjs 로 첫 글을 시작하세요.');
  process.exit(0);
}

// 따옴표로 감싼 필드를 고려한 최소 CSV 파서
const parseLine = (line) => {
  const out = [];
  let cur = '', q = false;
  for (const ch of line) {
    if (ch === '"') q = !q;
    else if (ch === ',' && !q) { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out;
};

const [head, ...lines] = readFileSync(file, 'utf8').trim().split('\n');
const cols = parseLine(head);
const rows = lines.filter(Boolean).map((l) => Object.fromEntries(parseLine(l).map((v, i) => [cols[i], v])));

const published = rows.filter((r) => r.status === 'published');
const views = published.reduce((s, r) => s + Number(r.pageviews || 0), 0);
const rev = published.reduce((s, r) => s + Number(r.revenue || 0), 0);
const won = (n) => n.toLocaleString('ko-KR') + '원';

console.log('\n=== 발행 현황 ===');
console.log(`전체 ${rows.length}편 · 발행 ${published.length}편 · 초안 ${rows.filter((r) => r.status === 'draft').length}편`);

const byCat = {};
for (const r of published) byCat[r.category || '미분류'] = (byCat[r.category || '미분류'] || 0) + 1;
for (const [k, v] of Object.entries(byCat).sort((a, b) => b[1] - a[1])) console.log(`  ${k}: ${v}편`);

console.log('\n=== 수익 지표 ===');
console.log(`누적 조회수: ${views.toLocaleString('ko-KR')}`);
console.log(`누적 수익:   ${won(rev)}`);
console.log(`RPM(1,000뷰당): ${views ? won(Math.round((rev / views) * 1000)) : '데이터 없음'}`);
console.log(`글당 평균 수익: ${published.length ? won(Math.round(rev / published.length)) : '데이터 없음'}`);

console.log('\n=== 효자 글 TOP 5 (수익순) ===');
const top = [...published].sort((a, b) => Number(b.revenue || 0) - Number(a.revenue || 0)).slice(0, 5);
if (!top.length) console.log('  아직 데이터 없음');
for (const r of top) console.log(`  ${won(Number(r.revenue || 0)).padStart(12)} · ${Number(r.pageviews || 0).toLocaleString('ko-KR').padStart(7)}뷰 · ${r.title}`);

console.log('\n=== 애드센스 신청 준비도 ===');
const need = 25;
const bar = '█'.repeat(Math.min(20, Math.floor((published.length / need) * 20))).padEnd(20, '░');
console.log(`  ${bar} ${published.length}/${need}편`);
console.log(published.length >= need
  ? '  → 글 수 조건 충족. strategy/monetization.md 의 나머지 체크리스트를 확인하고 신청하세요.'
  : `  → ${need - published.length}편 더 필요합니다.`);
console.log('');
