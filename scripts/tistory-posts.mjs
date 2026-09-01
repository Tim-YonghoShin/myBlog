#!/usr/bin/env node
// 글 목록 확인 / 삭제 유틸.
//   node scripts/tistory-posts.mjs list
//   node scripts/tistory-posts.mjs delete <id> [<id>...]
import { withSession } from '../src/publish/tistory-api.js';
import { list, remove } from '../src/publish/publisher.js';

const [cmd, ...rest] = process.argv.slice(2);
await withSession(async (ctx) => {
  if (cmd === 'delete') {
    for (const id of rest) { await remove(id, { ctx }); console.log(`삭제됨: ${id}`); }
  }
  const posts = await list({}, { ctx });
  console.log(`\n글 ${posts.length}건`);
  for (const p of posts) console.log(`  [${String(p.id).padStart(3)}] ${p.visibility.padEnd(8)} ${(p.category ?? '-').padEnd(22)} ${p.title}`);
});
