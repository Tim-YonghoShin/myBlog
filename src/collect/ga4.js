// Phase 4-1 — GA4 수집. 사이트 전체 + 글별 일자 지표.
import { google } from 'googleapis';
import { db } from '../core/db.js';
import { config } from '../core/config.js';
import { createLogger } from '../core/logger.js';
import { authClient, daysAgo, postIdResolver } from './google.js';

const log = createLogger('ga4');

const runReport = async (body) => {
  const auth = await authClient();
  const api = google.analyticsdata({ version: 'v1beta', auth });
  const { data } = await api.properties.runReport({
    property: `properties/${config.google.ga4PropertyId}`,
    requestBody: body,
  });
  return data.rows ?? [];
};

/** GA4 는 당일 데이터가 불완전하다. 어제까지만 가져오고 최근 며칠은 다시 덮어쓴다. */
export async function collectGA4({ days = 7 } = {}) {
  if (!config.google.ga4PropertyId) { log.warn('GA4_PROPERTY_ID 미설정 — 건너뜁니다'); return { site: 0, pages: 0 }; }
  const dateRanges = [{ startDate: daysAgo(days), endDate: daysAgo(1) }];

  // 사이트 전체
  const siteRows = await runReport({
    dateRanges,
    dimensions: [{ name: 'date' }],
    metrics: [{ name: 'activeUsers' }, { name: 'sessions' }, { name: 'screenPageViews' }],
  });
  const upSite = db.prepare(`
    INSERT INTO site_daily (date, users, sessions, pageviews)
    VALUES (?,?,?,?)
    ON CONFLICT(date) DO UPDATE SET
      users=excluded.users, sessions=excluded.sessions, pageviews=excluded.pageviews,
      collected_at=datetime('now')
  `);
  for (const r of siteRows) {
    const d = r.dimensionValues[0].value.replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3');
    const [u, s, p] = r.metricValues.map((m) => Number(m.value));
    upSite.run(d, u, s, p);
  }

  // 글별
  const pageRows = await runReport({
    dateRanges,
    dimensions: [{ name: 'date' }, { name: 'pagePath' }],
    metrics: [{ name: 'activeUsers' }, { name: 'screenPageViews' }],
    limit: 5000,
  });
  const resolve = postIdResolver(db);
  const upPage = db.prepare(`
    INSERT INTO metrics_daily (date, post_id, users, pageviews)
    VALUES (?,?,?,?)
    ON CONFLICT(date, post_id) DO UPDATE SET
      users=excluded.users, pageviews=excluded.pageviews
  `);
  let matched = 0;
  for (const r of pageRows) {
    const d = r.dimensionValues[0].value.replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3');
    const postId = resolve(r.dimensionValues[1].value);
    if (!postId) continue;
    const [u, p] = r.metricValues.map((m) => Number(m.value));
    upPage.run(d, postId, u, p);
    matched++;
  }

  log.info(`GA4 수집: 사이트 ${siteRows.length}일 · 글별 ${matched}/${pageRows.length}행 매칭`);
  return { site: siteRows.length, pages: matched };
}
