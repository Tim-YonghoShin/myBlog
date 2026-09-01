#!/usr/bin/env node
// seed-keywords.csv 로 발행 캘린더를 만든다.
// 초기에는 난이도 '하' → '중' → '상' 순서로 배치해서 색인·상위노출을 빨리 잡는다.
// 사용법: node scripts/plan.mjs [--weeks=8] [--per-week=3] [--start=2026-09-01]

import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const flag = (n, d) => {
  const hit = args.find((a) => a.startsWith(`--${n}=`));
  return hit ? hit.slice(n.length + 3) : d;
};

const weeks = Number(flag('weeks', 8));
const perWeek = Number(flag('per-week', 3));
const start = new Date(flag('start', new Date().toISOString().slice(0, 10)));

const [head, ...lines] = readFileSync(join(ROOT, 'keywords/seed-keywords.csv'), 'utf8').trim().split('\n');
const cols = head.split(',');
const rows = lines.map((l) => Object.fromEntries(l.split(',').map((v, i) => [cols[i], v])));

// 난이도 우선, 같은 난이도 안에서는 카테고리를 번갈아 배치해 주제 편중을 막는다.
const rank = { 하: 0, 중: 1, 상: 2 };
const sorted = rows.sort((a, b) => (rank[a.difficulty] ?? 3) - (rank[b.difficulty] ?? 3));

const byCat = new Map();
for (const r of sorted) {
  if (!byCat.has(r.category)) byCat.set(r.category, []);
  byCat.get(r.category).push(r);
}
const queue = [];
let remaining = sorted.length;
while (remaining > 0) {
  for (const list of byCat.values()) {
    const next = list.shift();
    if (next) { queue.push(next); remaining--; }
  }
}

const typeOf = (r) => (r.intent === '리뷰' ? 'review' : r.intent === '비교' ? 'compare' : 'info');

let md = `# 발행 캘린더 (${weeks}주 × 주 ${perWeek}편 = ${weeks * perWeek}편)\n\n`;
md += `생성일: ${new Date().toISOString().slice(0, 10)} · 시작일: ${start.toISOString().slice(0, 10)}\n\n`;
md += `쉬운 키워드부터 배치했습니다. 초기 글이 상위에 걸려야 블로그 전체 신뢰도가 올라갑니다.\n\n`;

let csv = 'due,week,keyword,category,type,difficulty,season,money\n';
let idx = 0;
for (let w = 0; w < weeks; w++) {
  md += `## ${w + 1}주차\n\n| 발행일 | 키워드 | 유형 | 난이도 | 수익라인 |\n|---|---|---|---|---|\n`;
  for (let d = 0; d < perWeek; d++) {
    const r = queue[idx++];
    if (!r) break;
    const due = new Date(start);
    due.setDate(due.getDate() + w * 7 + Math.round((d * 7) / perWeek));
    const ds = due.toISOString().slice(0, 10);
    const t = typeOf(r);
    md += `| ${ds} | ${r.keyword} | ${t} | ${r.difficulty} | ${r.money} |\n`;
    csv += `${ds},${w + 1},${r.keyword},${r.category},${t},${r.difficulty},${r.season},${r.money}\n`;
  }
  md += '\n';
}

md += `---\n\n## 사용법\n\n\`\`\`bash\nnode scripts/new-post.mjs "키워드" --type=info\n\`\`\`\n\n캘린더를 다시 만들려면:\n\n\`\`\`bash\nnode scripts/plan.mjs --weeks=12 --per-week=3\n\`\`\`\n`;

writeFileSync(join(ROOT, 'content/calendar.md'), md);
writeFileSync(join(ROOT, 'data/calendar.csv'), csv);
console.log(`캘린더 생성: content/calendar.md, data/calendar.csv (${Math.min(idx, sorted.length)}편)`);
