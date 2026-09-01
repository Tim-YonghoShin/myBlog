#!/usr/bin/env node
// 티스토리 카테고리 id 를 DB state 에 캐시한다. 발행 시 카테고리 지정에 쓴다.
import { withSession, getCategories, flatten } from '../src/publish/tistory-api.js';
import { migrate, setState } from '../src/core/db.js';
import { autoCategories } from '../src/core/categories.js';

migrate();
await withSession(async (ctx) => {
  const flat = flatten((await getCategories(ctx)).categories);
  const map = Object.fromEntries(flat.map((c) => [c.name, c.id]));
  setState('category_map', JSON.stringify(map));
  setState('category_synced_at', new Date().toISOString());
  console.log('카테고리 id 캐시 완료');
  for (const name of autoCategories()) {
    console.log(`  ${name.padEnd(14)} → ${map[name] ?? '❌ 없음'}`);
  }
});
