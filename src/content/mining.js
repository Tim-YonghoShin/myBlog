// Phase 6 — 피드백 루프.
//
// 6-1 쿼리 마이닝: GSC 에서 "노출은 되는데 순위가 낮은" 쿼리를 글감으로 승격한다.
//     이미 검색 수요가 확인됐고 구글이 이 사이트를 후보로 보고 있다는 뜻이라,
//     전용 글을 쓰면 상위로 올릴 확률이 가장 높은 구간이다.
// 6-3 갱신 큐: 순위가 떨어졌거나 시즌이 돌아온 글을 갱신 대상으로 올린다.
import { db, trackRun } from '../core/db.js';
import { createLogger } from '../core/logger.js';
import { send, esc } from '../telegram/client.js';
import { KEYWORD_TO_TISTORY } from '../core/categories.js';
import { opportunityQueries, dateStr } from '../report/metrics.js';
import { seasonScore } from './selector.js';

const log = createLogger('mining');

/** 이미 다루는 키워드인지 (완전일치 또는 포함 관계) 판단한다. */
function isCovered(query) {
  const existing = db.prepare('SELECT keyword FROM keywords').all().map((r) => r.keyword);
  const norm = (s) => s.replace(/\s+/g, '');
  const q = norm(query);
  return existing.some((k) => {
    const n = norm(k);
    return n === q || n.includes(q) || q.includes(n);
  });
}

/** 쿼리를 어느 카테고리로 볼지 추정한다. 같은 페이지를 노출시킨 글의 카테고리를 따른다. */
function guessCategory(query, start, end) {
  const row = db.prepare(`
    SELECT p.category, SUM(q.impressions) imp
    FROM queries_daily q
    JOIN posts p ON p.url = q.page
    WHERE q.query = ? AND q.date BETWEEN ? AND ?
    GROUP BY p.category ORDER BY imp DESC LIMIT 1
  `).get(query, start, end);
  if (row?.category) {
    // 티스토리 카테고리 → 글감 카테고리 역매핑
    const entry = Object.entries(KEYWORD_TO_TISTORY).find(([, v]) => v === row.category);
    if (entry) return entry[0];
  }
  return '생활정보';
}

/** 6-1 — 기회 쿼리를 글감 풀에 등록한다. */
export function mineQueries({ days = 28, limit = 20 } = {}) {
  const end = dateStr(2), start = dateStr(days);
  const ops = opportunityQueries(start, end, { minImpressions: 15, minPos: 8, maxPos: 45, limit: limit * 3 });

  const ins = db.prepare(`
    INSERT INTO keywords (keyword, category, intent, difficulty, season, money, note, source, status)
    VALUES (?,?,'정보','중','연중','애드센스',?, 'gsc', 'new')
    ON CONFLICT(keyword) DO NOTHING
  `);

  const added = [];
  for (const o of ops) {
    if (added.length >= limit) break;
    const q = o.query.trim();
    if (q.length < 4 || q.length > 40) continue;      // 너무 짧거나 긴 쿼리는 글감이 못 된다
    if (isCovered(q)) continue;
    const category = guessCategory(q, start, end);
    const note = `GSC 발굴 · 노출 ${o.impressions} · 평균 ${o.position.toFixed(0)}위`;
    if (ins.run(q, category, note).changes) added.push({ ...o, category });
  }

  log.info(`쿼리 마이닝: 후보 ${ops.length}개 중 ${added.length}개 신규 등록`);
  return added;
}

/** 6-3 — 갱신이 필요한 글을 찾는다. */
export function refreshQueue({ limit = 10 } = {}) {
  const recent = dateStr(7), older = dateStr(28), olderEnd = dateStr(21);

  // 순위 하락: 최근 7일 평균순위가 3주 전보다 5위 이상 떨어진 글
  const dropped = db.prepare(`
    SELECT p.id, p.title, p.url, p.keyword,
           AVG(CASE WHEN m.date >= ? THEN m.position END) recent_pos,
           AVG(CASE WHEN m.date BETWEEN ? AND ? THEN m.position END) old_pos
    FROM posts p JOIN metrics_daily m ON m.post_id = p.id
    WHERE p.status='published' AND m.position IS NOT NULL
    GROUP BY p.id
    HAVING recent_pos IS NOT NULL AND old_pos IS NOT NULL AND recent_pos - old_pos >= 5
    ORDER BY (recent_pos - old_pos) DESC LIMIT ?
  `).all(recent, older, olderEnd, limit);

  // 시즌 도래: 발행 후 60일 넘었고 이번/다음 달이 성수기인 글
  const seasonal = db.prepare(`
    SELECT p.id, p.title, p.url, p.keyword, k.season
    FROM posts p JOIN keywords k ON k.keyword = p.keyword
    WHERE p.status='published'
      AND p.published_at <= date('now','-60 day')
      AND COALESCE(p.last_updated_at, p.published_at) <= date('now','-60 day')
      AND k.season IS NOT NULL AND k.season != '연중'
  `).all().filter((r) => seasonScore(r.season) >= 20).slice(0, limit);

  return { dropped, seasonal };
}

/** 스케줄러 진입점 — 마이닝 결과와 갱신 대상을 텔레그램으로 알린다. */
export const runMining = () =>
  trackRun('mining', async () => {
    const added = mineQueries();
    const { dropped, seasonal } = refreshQueue();
    if (!added.length && !dropped.length && !seasonal.length) return 'no findings';

    let t = '🔍 <b>피드백 루프</b>\n';
    if (added.length) {
      t += `\n<b>신규 글감 ${added.length}개</b> <i>(검색 수요 확인됨)</i>\n`;
      for (const a of added.slice(0, 8))
        t += `· "${esc(a.query)}" — 노출 ${a.impressions} · ${a.position.toFixed(0)}위\n`;
    }
    if (dropped.length) {
      t += `\n<b>순위 하락 ${dropped.length}편</b> <i>(갱신 권장)</i>\n`;
      for (const d of dropped.slice(0, 5))
        t += `· ${esc(d.title.slice(0, 30))} — ${d.old_pos.toFixed(0)}위 → ${d.recent_pos.toFixed(0)}위\n`;
    }
    if (seasonal.length) {
      t += `\n<b>시즌 도래 ${seasonal.length}편</b> <i>(수치 갱신 필요)</i>\n`;
      for (const s of seasonal.slice(0, 5)) t += `· ${esc(s.title.slice(0, 30))} (${esc(s.season)})\n`;
    }
    await send(t);
    return `added=${added.length} dropped=${dropped.length} seasonal=${seasonal.length}`;
  });

if (process.argv[1]?.endsWith('mining.js')) {
  const added = mineQueries();
  const q = refreshQueue();
  console.log(`신규 글감 ${added.length}개`);
  for (const a of added) console.log(`  "${a.query}" 노출 ${a.impressions} ${a.position.toFixed(0)}위 → ${a.category}`);
  console.log(`순위 하락 ${q.dropped.length}편 · 시즌 도래 ${q.seasonal.length}편`);
}
