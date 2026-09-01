// Phase 3 — 티스토리 카테고리를 TARGET_TREE 에 맞춘다.
// 기본은 드라이런. 실제 적용은 --apply 를 붙인다.
import { TARGET_TREE, REMOVE } from '../core/categories.js';
import { withSession, getCategories, putCategories, newCategory, flatten, findByName } from './tistory-api.js';
import { createLogger } from '../core/logger.js';

const log = createLogger('categories');

export function plan(currentFlat) {
  const append = [];
  const remove = [];
  const keep = [];

  for (const [pi, parent] of TARGET_TREE.entries()) {
    let parentNode = findByName(currentFlat, parent.name);
    if (!parentNode) {
      append.push({ ...newCategory({ name: parent.name, parent: 0, depth: 1, priority: pi }), _label: parent.name });
    } else {
      keep.push(parent.name);
    }
    for (const [ci, child] of parent.children.entries()) {
      const childNode = findByName(currentFlat, child.name);
      if (childNode) { keep.push(`${parent.name}/${child.name}`); continue; }
      if (!parentNode) {
        // 부모가 아직 없으면 이번 회차에서는 자식을 만들 수 없다 (부모 id 가 필요)
        log.warn(`부모 '${parent.name}' 생성 후 다음 회차에 '${child.name}' 을 만듭니다`);
        continue;
      }
      append.push({ ...newCategory({ name: child.name, parent: parentNode.id, depth: 2, priority: ci }), _label: `${parent.name}/${child.name}` });
    }
  }

  for (const name of REMOVE) {
    const node = findByName(currentFlat, name);
    if (node) remove.push(node);
  }

  return { append, remove, keep };
}

export async function sync({ apply = false } = {}) {
  return withSession(async (ctx) => {
    const { categories } = await getCategories(ctx);
    const flat = flatten(categories);
    const { append, remove, keep } = plan(flat);

    console.log('현재 카테고리');
    for (const c of flat) console.log(`  ${'  '.repeat(c.depth - 1)}[${c.id}] ${c.name} (${c.entries}편)`);

    console.log('\n계획');
    if (!append.length && !remove.length) console.log('  변경 없음 — 이미 목표 구조입니다.');
    for (const a of append) console.log(`  + 추가  ${a._label}`);
    for (const r of remove) console.log(`  - 삭제  ${r.name} (${r.entries}편)${r.entries ? '  ⚠ 글이 있습니다' : ''}`);
    console.log(`  = 유지  ${keep.length}개`);

    const withPosts = remove.filter((r) => r.entries > 0);
    if (withPosts.length) {
      console.log(`\n⚠ 글이 들어있는 카테고리 ${withPosts.length}개를 삭제하려 합니다: ${withPosts.map((r) => `${r.name}(${r.entries}편)`).join(', ')}`);
    }

    if (!apply) {
      console.log('\n드라이런입니다. 실제로 적용하려면 --apply 를 붙이세요.');
      return { append, remove, applied: false };
    }

    // 추가와 삭제를 분리해서 실행한다. 한쪽이 실패해도 원인을 특정할 수 있다.
    if (append.length) {
      const payload = append.map(({ _label, ...c }) => c);
      await putCategories(ctx, { append: payload, update: payload });
      console.log(`\n✅ ${append.length}개 추가 완료`);
    }
    if (remove.length) {
      // 삭제는 id 배열로 보낸다. 자식이 먼저 지워져야 하므로 깊은 것부터 정렬한다.
      const ids = [...remove].sort((a, b) => b.depth - a.depth).map((r) => r.id);
      await putCategories(ctx, { delete: ids, append: [], update: [] });
      console.log(`✅ ${remove.length}개 삭제 완료`);
    }

    const after = flatten((await getCategories(ctx)).categories);
    console.log('\n적용 후 카테고리');
    for (const c of after) console.log(`  ${'  '.repeat(c.depth - 1)}[${c.id}] ${c.name} (${c.entries}편)`);
    return { append, remove, applied: true, after };
  });
}

if (process.argv[1]?.endsWith('sync-categories.js')) {
  sync({ apply: process.argv.includes('--apply') }).catch((e) => { console.error(e.message); process.exit(1); });
}
