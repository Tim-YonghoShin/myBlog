// Phase 6-5 — 카테고리 감지 및 승인 기반 추가.
//
// 카테고리 삭제는 되돌리기 어려워 자동화하지 않는다. 대신 아래를 감지해 알리고,
// 승인 버튼을 누르면 그때 실제로 만든다.
//   1) 목표 구조에 있는데 티스토리에 없는 카테고리 (드리프트)
//   2) 글감은 쌓였는데 담을 카테고리가 없는 경우 (신규 필요)
//   3) 한 카테고리에 글이 과도하게 몰린 경우 (분할 권장 — 알림만)
import { db, getState, setState, trackRun } from '../core/db.js';
import { createLogger } from '../core/logger.js';
import { send, esc } from '../telegram/client.js';
import { effectiveTree, effectiveMapping, TARGET_TREE } from '../core/categories.js';
import { withSession, getCategories, flatten, putCategories, newCategory } from './tistory-api.js';

const log = createLogger('cat-watch');
const SPLIT_THRESHOLD = 25;

/** 글감 카테고리(내부 코드명) → 티스토리에 보여줄 이름 */
const DISPLAY_NAME = {
  리뷰쇼핑: '리뷰·쇼핑',
  정책지원금: '지원금·환급',
  세금환급: '세금·환급',
  생활금융: '절약·생활금융',
  생활정보: '생활정보·서류',
};

/** 제안 목록을 만든다. 실제 변경은 하지 않는다. */
export async function detect() {
  return withSession(async (ctx) => {
    const live = flatten((await getCategories(ctx)).categories);
    const liveNames = new Set(live.map((c) => c.name));
    const tree = effectiveTree(getState);
    const mapping = effectiveMapping(getState);
    const suggestions = [];

    // 1) 드리프트 — 목표에 있는데 실제로 없음
    for (const parent of tree) {
      if (!liveNames.has(parent.name)) {
        suggestions.push({ kind: 'drift', name: parent.name, parent: null, reason: '목표 구조에 있으나 티스토리에 없습니다' });
        continue;
      }
      for (const child of parent.children) {
        if (!liveNames.has(child.name)) {
          suggestions.push({ kind: 'drift', name: child.name, parent: parent.name, auto: child.auto, reason: `'${parent.name}' 하위에 있어야 하는데 없습니다` });
        }
      }
    }

    // 2) 담을 곳 없는 글감
    const unmapped = db.prepare(`
      SELECT category, COUNT(*) c FROM keywords
      WHERE status='new' GROUP BY category ORDER BY c DESC
    `).all().filter((r) => !mapping[r.category]);
    for (const u of unmapped) {
      if (u.c < 5) continue;   // 소수는 기존 카테고리로 흡수 가능
      suggestions.push({
        kind: 'needed', name: DISPLAY_NAME[u.category] ?? u.category, parent: TARGET_TREE[0].name, auto: true,
        keywordCategory: u.category,
        reason: `발행 대기 글감 ${u.c}개가 담을 카테고리가 없습니다`,
      });
    }

    // 3) 과밀 — 알림만 (분할은 사람이 판단)
    const crowded = db.prepare(`
      SELECT category, COUNT(*) c FROM posts WHERE status='published'
      GROUP BY category HAVING c >= ?
    `).all(SPLIT_THRESHOLD);

    return { live, suggestions, crowded };
  });
}

/** 승인된 제안을 실제로 티스토리에 만들고, 목표 구조에 영구 반영한다. */
export async function applySuggestion(s) {
  return withSession(async (ctx) => {
    const live = flatten((await getCategories(ctx)).categories);
    if (live.some((c) => c.name === s.name)) return { created: false, reason: '이미 존재합니다' };

    const parentNode = s.parent ? live.find((c) => c.name === s.parent) : null;
    if (s.parent && !parentNode) throw new Error(`상위 카테고리 '${s.parent}' 가 없습니다`);

    const payload = [newCategory({
      name: s.name,
      parent: parentNode?.id ?? 0,
      depth: parentNode ? 2 : 1,
      priority: parentNode ? (parentNode.raw?.children?.length ?? 0) : live.length,
    })];
    await putCategories(ctx, { append: payload, update: payload });

    // 목표 구조에 영구 반영 (코드 수정 없이 확장)
    const extras = JSON.parse(getState('extra_categories', '[]'));
    if (!extras.some((e) => e.name === s.name)) {
      extras.push({ name: s.name, parent: s.parent, auto: s.auto !== false, keywordCategory: s.keywordCategory ?? null });
      setState('extra_categories', JSON.stringify(extras));
    }

    // 캐시 갱신
    const after = flatten((await getCategories(ctx)).categories);
    setState('category_map', JSON.stringify(Object.fromEntries(after.map((c) => [c.name, c.id]))));
    log.info(`카테고리 생성: ${s.parent ? s.parent + '/' : ''}${s.name}`);
    return { created: true };
  });
}

/** 스케줄러 진입점 — 변화가 있을 때만 알린다. */
export const runCategoryWatch = () =>
  trackRun('category_watch', async () => {
    const { suggestions, crowded } = await detect();
    const key = suggestions.map((s) => s.name).sort().join('|');
    if (key && key === getState('cat_suggest_last', '')) return 'unchanged';
    setState('cat_suggest_last', key);

    if (!suggestions.length && !crowded.length) return 'no findings';

    let t = '🗂 <b>카테고리 점검</b>\n';
    const buttons = [];
    suggestions.forEach((s, i) => {
      setState(`cat_suggest_${i}`, JSON.stringify(s));
      t += `\n<b>${esc(s.parent ? `${s.parent} / ${s.name}` : s.name)}</b>\n   ${esc(s.reason)}\n`;
      buttons.push([
        { text: `✅ '${s.name}' 만들기`, callback_data: `catadd:${i}` },
        { text: '건너뛰기', callback_data: `catskip:${i}` },
      ]);
    });
    for (const c of crowded) {
      t += `\n<b>${esc(c.category)}</b> — 글 ${c.c}편\n   하위 카테고리로 나누는 것을 검토해 보세요 (자동 처리하지 않습니다)\n`;
    }
    await send(t, { buttons: buttons.length ? buttons : undefined });
    return `suggestions=${suggestions.length} crowded=${crowded.length}`;
  });

if (process.argv[1]?.endsWith('category-watch.js')) {
  detect().then(({ live, suggestions, crowded }) => {
    console.log(`현재 카테고리 ${live.length}개`);
    for (const c of live) console.log(`  ${'  '.repeat(c.depth - 1)}${c.name} (${c.entries}편)`);
    console.log(`\n제안 ${suggestions.length}개`);
    for (const s of suggestions) console.log(`  [${s.kind}] ${s.parent ? s.parent + '/' : ''}${s.name} — ${s.reason}`);
    console.log(`과밀 ${crowded.length}개`);
  });
}
