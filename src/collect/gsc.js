// Phase 4-2 — Search Console 수집.
// 이 데이터가 피드백 루프(6-1)의 입력이다. "노출은 되는데 순위가 낮은" 쿼리가 다음 글감이 된다.
import { google } from 'googleapis';
import { db } from '../core/db.js';
import { config } from '../core/config.js';
import { createLogger } from '../core/logger.js';
import { authClient, daysAgo, postIdResolver } from './google.js';

const log = createLogger('gsc');

const query = async (body) => {
  const auth = await authClient();
  const api = google.searchconsole({ version: 'v1', auth });
  const { data } = await api.searchanalytics.query({
    siteUrl: config.google.gscSiteUrl,
    requestBody: body,
  });
  return data.rows ?? [];
};

/** GSC 데이터는 2~3일 지연된다. 넉넉히 가져와 덮어쓴다. */
export async function collectGSC({ days = 14 } = {}) {
  if (!config.google.gscSiteUrl) { log.warn('GSC_SITE_URL 미설정 — 건너뜁니다'); return {}; }
  const startDate = daysAgo(days);
  const endDate = daysAgo(2);

  // 1) 사이트 전체 일자별
  const siteRows = await query({ startDate, endDate, dimensions: ['date'], rowLimit: 1000 });
  const upSite = db.prepare(`
    INSERT INTO site_daily (date, clicks, impressions, position)
    VALUES (?,?,?,?)
    ON CONFLICT(date) DO UPDATE SET
      clicks=excluded.clicks, impressions=excluded.impressions, position=excluded.position,
      collected_at=datetime('now')
  `);
  for (const r of siteRows) upSite.run(r.keys[0], r.clicks, r.impressions, r.position);

  // 2) 쿼리 × 페이지 (피드백 루프의 원본 데이터)
  const qRows = await query({
    startDate, endDate,
    dimensions: ['date', 'query', 'page'],
    rowLimit: 25000,
  });
  const upQuery = db.prepare(`
    INSERT INTO queries_daily (date, query, page, clicks, impressions, position)
    VALUES (?,?,?,?,?,?)
    ON CONFLICT(date, query, page) DO UPDATE SET
      clicks=excluded.clicks, impressions=excluded.impressions, position=excluded.position
  `);
  for (const r of qRows) upQuery.run(r.keys[0], r.keys[1], r.keys[2], r.clicks, r.impressions, r.position);

  // 3) 페이지별 → 글별 지표에 반영
  const pageRows = await query({ startDate, endDate, dimensions: ['date', 'page'], rowLimit: 5000 });
  const resolve = postIdResolver(db);
  const upPage = db.prepare(`
    INSERT INTO metrics_daily (date, post_id, clicks, impressions, position)
    VALUES (?,?,?,?,?)
    ON CONFLICT(date, post_id) DO UPDATE SET
      clicks=excluded.clicks, impressions=excluded.impressions, position=excluded.position
  `);
  let matched = 0;
  for (const r of pageRows) {
    const postId = resolve(r.keys[1]);
    if (!postId) continue;
    upPage.run(r.keys[0], postId, r.clicks, r.impressions, r.position);
    matched++;
  }

  log.info(`GSC 수집: 사이트 ${siteRows.length}일 · 쿼리 ${qRows.length}행 · 글별 ${matched}/${pageRows.length}행 매칭`);
  return { site: siteRows.length, queries: qRows.length, pages: matched };
}
