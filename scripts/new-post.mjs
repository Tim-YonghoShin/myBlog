#!/usr/bin/env node
// 템플릿에서 새 포스팅 초안을 만들고 data/posts.csv 에 등록한다.
// 사용법: node scripts/new-post.mjs "근로장려금 신청자격" --type=info --title="2026 근로장려금 신청자격 총정리"

import { readFileSync, writeFileSync, existsSync, appendFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const TYPES = ['info', 'review', 'compare'];

const args = process.argv.slice(2);
const keyword = args.find((a) => !a.startsWith('--'));
const flag = (name, def) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : def;
};

if (!keyword) {
  console.error(`사용법: node scripts/new-post.mjs "<키워드>" [--type=info|review|compare] [--title="제목"] [--category=분류]`);
  process.exit(1);
}

const type = flag('type', 'info');
if (!TYPES.includes(type)) {
  console.error(`--type 은 ${TYPES.join(' | ')} 중 하나여야 합니다. (받은 값: ${type})`);
  process.exit(1);
}

// 키워드가 seed-keywords.csv 에 있으면 카테고리를 자동으로 채운다.
const lookupCategory = () => {
  const csv = join(ROOT, 'keywords/seed-keywords.csv');
  if (!existsSync(csv)) return '';
  const row = readFileSync(csv, 'utf8')
    .split('\n')
    .slice(1)
    .find((l) => l.split(',')[0]?.trim() === keyword);
  return row ? row.split(',')[1] : '';
};

const date = new Date().toISOString().slice(0, 10);
const title = flag('title', keyword);
const category = flag('category', lookupCategory());
const slug = keyword.trim().replace(/[\/\\:*?"<>|]/g, '').replace(/\s+/g, '-');
const out = join(ROOT, 'content/posts', `${date}-${slug}.md`);

if (existsSync(out)) {
  console.error(`이미 있는 파일입니다: ${out}`);
  process.exit(1);
}

const body = readFileSync(join(ROOT, 'content/templates', `${type}.md`), 'utf8')
  .replaceAll('{{TITLE}}', title)
  .replaceAll('{{KEYWORD}}', keyword)
  .replaceAll('{{CATEGORY}}', category)
  .replaceAll('{{DATE}}', date);

writeFileSync(out, body);

// 발행 대장에 등록
const ledger = join(ROOT, 'data/posts.csv');
const header = 'date,title,keyword,category,type,platform,url,status,pageviews,revenue,note\n';
if (!existsSync(ledger)) writeFileSync(ledger, header);
const esc = (v) => (String(v).includes(',') ? `"${v}"` : String(v));
appendFileSync(ledger, [date, title, keyword, category, type, 'tistory', '', 'draft', 0, 0, ''].map(esc).join(',') + '\n');

console.log(`초안 생성: ${out.replace(ROOT + '/', '')}`);
console.log(`대장 등록: data/posts.csv`);
console.log(`\n다음: 초안을 채운 뒤 티스토리에 발행하고, posts.csv 의 status 를 published 로, url 을 채우세요.`);
