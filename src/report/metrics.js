// 리포트가 쓰는 집계 쿼리 모음.
import { db } from '../core/db.js';

const num = (v) => Number(v ?? 0);

/** 기간 합계. [start, end] 포함. */
export function periodTotals(start, end) {
  const r = db.prepare(`
    SELECT COALESCE(SUM(users),0) users, COALESCE(SUM(pageviews),0) pageviews,
           COALESCE(SUM(clicks),0) clicks, COALESCE(SUM(impressions),0) impressions,
           COALESCE(SUM(revenue),0) revenue,
           AVG(NULLIF(position,0)) position
    FROM site_daily WHERE date BETWEEN ? AND ?
  `).get(start, end);
  return {
    users: num(r.users), pageviews: num(r.pageviews),
    clicks: num(r.clicks), impressions: num(r.impressions),
    revenue: num(r.revenue), position: r.position ? Number(r.position) : null,
    ctr: r.impressions ? (r.clicks / r.impressions) * 100 : 0,
  };
}

/** 성과 상위 글. */
export const topPosts = (start, end, limit = 5) =>
  db.prepare(`
    SELECT p.id, p.title, p.category,
           SUM(m.clicks) clicks, SUM(m.impressions) impressions,
           SUM(m.pageviews) pageviews, SUM(m.revenue) revenue,
           AVG(NULLIF(m.position,0)) position
    FROM metrics_daily m JOIN posts p ON p.id = m.post_id
    WHERE m.date BETWEEN ? AND ?
    GROUP BY p.id
    HAVING impressions > 0 OR pageviews > 0
    ORDER BY clicks DESC, impressions DESC
    LIMIT ?
  `).all(start, end, limit);

/** 카테고리별 성과 — 발행 비중 조정(6-2)의 근거. */
export const categoryPerformance = (start, end) =>
  db.prepare(`
    SELECT p.category,
           COUNT(DISTINCT p.id) posts,
           SUM(m.clicks) clicks, SUM(m.impressions) impressions, SUM(m.revenue) revenue
    FROM metrics_daily m JOIN posts p ON p.id = m.post_id
    WHERE m.date BETWEEN ? AND ? AND p.status='published'
    GROUP BY p.category
    ORDER BY clicks DESC
  `).all(start, end);

/**
 * Phase 6-1 의 핵심 — "노출은 되는데 순위가 낮은" 쿼리.
 * 이미 수요가 확인됐고 구글이 이 사이트를 후보로 보고 있다는 뜻이므로,
 * 전용 글을 쓰면 상위로 올릴 가능성이 가장 높은 구간이다.
 */
export const opportunityQueries = (start, end, { minImpressions = 20, minPos = 8, maxPos = 40, limit = 15 } = {}) =>
  db.prepare(`
    SELECT query,
           SUM(impressions) impressions, SUM(clicks) clicks,
           AVG(position) position, COUNT(DISTINCT page) pages
    FROM queries_daily
    WHERE date BETWEEN ? AND ?
    GROUP BY query
    HAVING impressions >= ? AND position BETWEEN ? AND ?
    ORDER BY impressions DESC
    LIMIT ?
  `).all(start, end, minImpressions, minPos, maxPos, limit);

/** 발행 현황 요약. */
export function publishingStatus() {
  const byStatus = Object.fromEntries(
    db.prepare('SELECT status, COUNT(*) c FROM posts GROUP BY status').all().map((r) => [r.status, r.c])
  );
  const published = byStatus.published ?? 0;
  const last7 = db.prepare(`SELECT COUNT(*) c FROM posts WHERE status='published' AND published_at >= date('now','-7 day')`).get().c;
  const keywords = db.prepare("SELECT COUNT(*) c FROM keywords WHERE status='new'").get().c;
  return { ...byStatus, published, last7, keywordsLeft: keywords };
}

export const dateStr = (offsetDays = 0) =>
  new Date(Date.now() - offsetDays * 864e5).toISOString().slice(0, 10);

/** 증감 표시. */
export function delta(cur, prev) {
  if (!prev) return cur ? '신규' : '—';
  const pct = ((cur - prev) / prev) * 100;
  const arrow = pct > 0 ? '▲' : pct < 0 ? '▼' : '—';
  return `${arrow}${Math.abs(pct).toFixed(0)}%`;
}
