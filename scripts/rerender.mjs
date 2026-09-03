#!/usr/bin/env node
// 스타일·렌더 규칙이 바뀌었을 때 기존 글을 최신 형식으로 다시 만든다.
//   node scripts/rerender.mjs              대기 중인 초안만 (승인 시 최신본이 나감)
//   node scripts/rerender.mjs --all        발행글 포함해 로컬 파일만 갱신 (티스토리 미반영)
//   node scripts/rerender.mjs --published  발행글까지 티스토리에 재반영 (세션 필요)
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { db } from '../src/core/db.js';
import { config } from '../src/core/config.js';
import { finalizeHtml } from '../src/content/render.js';
import { publish } from '../src/publish/publisher.js';
import { withSession } from '../src/publish/tistory-api.js';

const alsoPublished = process.argv.includes('--published');
const includeAll = alsoPublished || process.argv.includes('--all');
const today = new Date().toLocaleDateString('sv-SE', { timeZone: config.tz });
const statuses = includeAll ? ['review', 'draft', 'published'] : ['review', 'draft'];

const rows = db.prepare(
  `SELECT * FROM posts WHERE status IN (${statuses.map(() => '?').join(',')})`
).all(...statuses);

if (!rows.length) { console.log('대상 글이 없습니다.'); process.exit(0); }

const rebuilt = [];
for (const p of rows) {
  if (!p.draft_path || !existsSync(p.draft_path)) { console.log(`건너뜀(원본 없음): ${p.title}`); continue; }
  const meta = JSON.parse(readFileSync(p.draft_path, 'utf8'));
  // meta.html 은 모델 원본. 여기서 다시 렌더해야 스타일이 중첩되지 않는다.
  const html = finalizeHtml(
    { html: meta.html, title: p.title, sources: meta.sources },
    { today, blogName: '리춍의 성장연구소' }
  );
  writeFileSync(p.html_path, html);
  rebuilt.push({ ...p, html, tags: meta.tags ?? [] });
  console.log(`재렌더: [${p.status}] ${p.title} → ${html.length} bytes`);
}

if (alsoPublished) {
  const targets = rebuilt.filter((p) => p.status === 'published' && p.tistory_id);
  if (targets.length) {
    await withSession(async (ctx) => {
      for (const p of targets) {
        await publish({
          postId: p.tistory_id, title: p.title, html: p.html,
          category: p.category, tags: p.tags, visibility: 'public',
        }, { ctx });
      }
    });
    console.log(`\n발행된 글 ${targets.length}편 티스토리에 반영 완료`);
  }
}
console.log(`\n총 ${rebuilt.length}편 처리`);
