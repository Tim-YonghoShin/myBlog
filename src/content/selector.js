// Phase 2-1 — 다음에 쓸 글감을 고른다.
//
// 점수 = 난이도 + 시즌 적합도 + 단계별 카테고리 가중치 + 성과 가중치
// 초기에는 "쉽고 빨리 색인되는" 글을 우선하고, 글이 쌓일수록 단가 높은 글로 옮겨간다.
import { db } from '../core/db.js';
import { KEYWORD_TO_TISTORY, isPublishable } from '../core/categories.js';
import { config } from '../core/config.js';

const DIFFICULTY_SCORE = { 하: 30, 중: 18, 상: 8 };

/** '1~2월', '11~2월', '연중', '5월/9월' 같은 표기를 이번 달과 대조한다. */
export function seasonScore(season, month = new Date().getMonth() + 1) {
  if (!season || season === '연중') return 5;
  const months = new Set();
  for (const part of season.split('/')) {
    const range = part.match(/(\d+)\s*~\s*(\d+)/);
    if (range) {
      let [, a, b] = range.map(Number);
      // 11~2월 처럼 해를 넘기는 구간도 처리
      for (let i = 0, m = a; i < 12; i++, m = (m % 12) + 1) { months.add(m); if (m === b) break; }
    } else {
      for (const m of part.match(/\d+/g) ?? []) months.add(Number(m));
    }
  }
  if (months.has(month)) return 25;                       // 지금이 성수기
  const next = (month % 12) + 1;
  if (months.has(next)) return 20;                        // 다음 달 성수기 → 미리 써둔다
  const after = (next % 12) + 1;
  if (months.has(after)) return 12;
  return 0;                                               // 비수기 — 지금 쓸 이유 없음
}

/**
 * 발행 단계에 따른 카테고리 가중치.
 * 1구간(~16편)은 진입이 쉬운 생활정보·서류에 몰아주고, 이후 단가 높은 쪽으로 이동한다.
 */
export function stageWeights(publishedCount) {
  if (publishedCount < 16) return { '생활정보·서류': 30, '지원금·환급': 12, '절약·생활금융': 6 };
  if (publishedCount < 32) return { '생활정보·서류': 20, '지원금·환급': 20, '절약·생활금융': 10 };
  return { '생활정보·서류': 12, '지원금·환급': 26, '절약·생활금융': 16 };
}

/** Phase 6-2 가 채우는 실제 성과 가중치. 데이터가 없으면 0. */
export function performanceWeights() {
  const rows = db.prepare(`
    SELECT p.category AS cat,
           SUM(m.clicks)   AS clicks,
           SUM(m.revenue)  AS revenue,
           COUNT(DISTINCT p.id) AS posts
    FROM posts p JOIN metrics_daily m ON m.post_id = p.id
    WHERE p.status='published' AND m.date >= date('now','-28 day')
    GROUP BY p.category
  `).all();
  if (!rows.length) return {};
  // 글당 클릭수를 기준으로 상대 가중치를 만든다 (수익 데이터가 붙기 전에도 동작하도록)
  const per = rows.map((r) => ({ cat: r.cat, v: (r.clicks || 0) / Math.max(1, r.posts) }));
  const max = Math.max(...per.map((p) => p.v), 0);
  if (max <= 0) return {};
  return Object.fromEntries(per.map((p) => [p.cat, Math.round((p.v / max) * 20)]));
}

/** 다음 글감 n개를 점수순으로 고른다. */
export function pickNext(n = 1, { month } = {}) {
  const publishedCount = db.prepare("SELECT COUNT(*) c FROM posts WHERE status='published'").get().c;
  const stage = stageWeights(publishedCount);
  const perf = performanceWeights();

  const rows = db.prepare(`
    SELECT * FROM keywords
    WHERE status='new'
      AND keyword NOT IN (SELECT keyword FROM posts WHERE status NOT IN ('rejected','failed'))
  `).all();

  const scored = rows
    .filter((r) => isPublishable(r.category))
    .map((r) => {
      const tistoryCat = KEYWORD_TO_TISTORY[r.category];
      const parts = {
        difficulty: DIFFICULTY_SCORE[r.difficulty] ?? 10,
        season: seasonScore(r.season, month),
        stage: stage[tistoryCat] ?? 0,
        perf: perf[tistoryCat] ?? 0,
        // GSC 마이닝으로 들어온 글감은 실제 수요가 확인된 것이라 우대한다
        source: r.source === 'gsc' ? 15 : 0,
      };
      const score = Object.values(parts).reduce((a, b) => a + b, 0);
      return { ...r, tistoryCat, score, parts };
    })
    .sort((a, b) => b.score - a.score);

  return scored.slice(0, n);
}

/** 선정된 글감을 큐에 넣어 중복 선정을 막는다. */
export const markQueued = (keyword) =>
  db.prepare("UPDATE keywords SET status='queued' WHERE keyword=?").run(keyword);

if (process.argv[1]?.endsWith('selector.js')) {
  const n = Number(process.argv[2] ?? 8);
  const picks = pickNext(n);
  const published = db.prepare("SELECT COUNT(*) c FROM posts WHERE status='published'").get().c;
  console.log(`발행 완료 ${published}편 · 주 ${config.postsPerWeek}편 기준\n`);
  console.log('다음 글감 (점수순)');
  console.log('점수  난이도 시즌 단계 성과 출처 | 카테고리        | 키워드');
  for (const p of picks) {
    const q = p.parts;
    console.log(
      `${String(p.score).padStart(4)}  ${String(q.difficulty).padStart(4)} ${String(q.season).padStart(4)} ${String(q.stage).padStart(4)} ${String(q.perf).padStart(4)} ${String(q.source).padStart(4)} | ${p.tistoryCat.padEnd(14)} | ${p.keyword}`
    );
  }
}
