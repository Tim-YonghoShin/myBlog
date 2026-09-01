#!/usr/bin/env node
// Google 연동 상태 점검. 설정을 바꾼 뒤 이 스크립트로 확인한다.
//   node scripts/check-google.mjs
import '../src/core/net.js';
import { existsSync, readFileSync } from 'node:fs';
import { google } from 'googleapis';
import { config } from '../src/core/config.js';

const ok = (s) => `✅ ${s}`;
const no = (s) => `❌ ${s}`;
const warn = (s) => `⚠️  ${s}`;
let blocking = 0;

console.log('\n── Google 연동 점검 ──\n');

// 1. 서비스계정 키
if (!existsSync(config.google.serviceAccountPath)) {
  console.log(no(`서비스계정 JSON 없음: ${config.google.serviceAccountPath}`));
  process.exit(1);
}
const sa = JSON.parse(readFileSync(config.google.serviceAccountPath, 'utf8'));
console.log(ok(`서비스계정 키 (${sa.project_id})`));
console.log(`   ${sa.client_email}`);

const auth = new google.auth.GoogleAuth({
  keyFile: config.google.serviceAccountPath,
  scopes: [
    'https://www.googleapis.com/auth/webmasters.readonly',
    'https://www.googleapis.com/auth/analytics.readonly',
  ],
});
const client = await auth.getClient();

// 2. Search Console
console.log('\n[Search Console]');
try {
  const sc = google.searchconsole({ version: 'v1', auth: client });
  const sites = (await sc.sites.list()).data.siteEntry ?? [];
  if (!sites.length) {
    console.log(no('접근 가능한 사이트가 없습니다'));
    console.log(`   → GSC 설정 > 사용자 및 권한 > 사용자 추가`);
    console.log(`   → ${sa.client_email} 을 "전체" 권한으로`);
    blocking++;
  } else {
    for (const s of sites) console.log(ok(`${s.siteUrl}  (${s.permissionLevel})`));
    const target = sites.find((s) => s.siteUrl.replace(/\/$/, '') === config.google.gscSiteUrl.replace(/\/$/, ''));
    if (!target) {
      console.log(warn(`.env 의 GSC_SITE_URL(${config.google.gscSiteUrl}) 과 일치하는 속성이 없습니다`));
      blocking++;
    } else {
      // 실제 데이터 조회까지 확인
      const end = new Date(Date.now() - 2 * 864e5).toISOString().slice(0, 10);
      const start = new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10);
      const q = await google.searchconsole({ version: 'v1', auth: client }).searchanalytics.query({
        siteUrl: target.siteUrl,
        requestBody: { startDate: start, endDate: end, dimensions: ['query'], rowLimit: 5 },
      });
      const rows = q.data.rows ?? [];
      console.log(ok(`데이터 조회 성공 — 최근 30일 쿼리 ${rows.length}건`));
      for (const r of rows) console.log(`   "${r.keys[0]}" 노출 ${r.impressions} 클릭 ${r.clicks} 순위 ${r.position.toFixed(1)}`);
      if (!rows.length) console.log('   (아직 검색 노출 데이터가 없습니다. 색인 후 며칠 필요)');
    }
  }
} catch (e) {
  console.log(no(`${e.code ?? ''} ${e.message.slice(0, 180)}`));
  blocking++;
}

// 3. GA4
console.log('\n[GA4]');
let propertyId = config.google.ga4PropertyId;
if (!propertyId) {
  try {
    const admin = google.analyticsadmin({ version: 'v1beta', auth: client });
    const accs = (await admin.accountSummaries.list()).data.accountSummaries ?? [];
    const props = accs.flatMap((a) => a.propertySummaries ?? []);
    if (props.length) {
      console.log(ok(`속성 ${props.length}개 발견`));
      for (const p of props) console.log(`   ${p.property.replace('properties/', '')}  ${p.displayName}`);
      console.log(`   → .env 의 GA4_PROPERTY_ID 에 위 숫자를 넣으세요`);
      propertyId = props[0].property.replace('properties/', '');
    } else {
      console.log(no('접근 가능한 속성 없음 → GA4 관리 > 속성 액세스 관리에서 뷰어로 추가'));
      blocking++;
    }
  } catch (e) {
    console.log(warn(`속성 자동 탐색 실패: ${e.message.slice(0, 120)}`));
    console.log('   → Analytics Admin API 를 켜거나, GA4_PROPERTY_ID 를 직접 .env 에 넣으세요');
    blocking++;
  }
}
if (propertyId) {
  try {
    const data = google.analyticsdata({ version: 'v1beta', auth: client });
    const r = await data.properties.runReport({
      property: `properties/${propertyId}`,
      requestBody: {
        dateRanges: [{ startDate: '7daysAgo', endDate: 'yesterday' }],
        metrics: [{ name: 'activeUsers' }, { name: 'screenPageViews' }],
      },
    });
    const row = r.data.rows?.[0]?.metricValues ?? [];
    console.log(ok(`데이터 조회 성공 (속성 ${propertyId}) — 최근 7일 사용자 ${row[0]?.value ?? 0}, 조회수 ${row[1]?.value ?? 0}`));
  } catch (e) {
    console.log(no(`데이터 조회 실패: ${e.code ?? ''} ${e.message.slice(0, 160)}`));
    blocking++;
  }
}

console.log(`\n── ${blocking === 0 ? '모두 통과. Phase 4 수집을 붙일 수 있습니다.' : `막힌 항목 ${blocking}개`} ──\n`);
process.exit(blocking ? 1 : 0);
