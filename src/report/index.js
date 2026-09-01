// Phase 5 — 텔레그램 리포트 (일간·주간·월간).
// 애드센스 승인 전에는 수익 데이터가 없으므로 GSC 노출·클릭 중심으로 구성한다.
import { trackRun, db } from '../core/db.js';
import { createLogger } from '../core/logger.js';
import { sendLong, esc } from '../telegram/client.js';
import { config } from '../core/config.js';
import {
  periodTotals, topPosts, categoryPerformance, opportunityQueries,
  publishingStatus, dateStr, delta,
} from './metrics.js';

const log = createLogger('report');
const won = (n) => Math.round(n).toLocaleString('ko-KR') + '원';
const pct = (n) => n.toFixed(1) + '%';

/** 지표가 전부 0이면 왜 그런지 알려준다. 침묵보다 낫다. */
function emptyHint() {
  const s = publishingStatus();
  if (!s.published) return '아직 발행된 글이 없습니다.';
  const oldest = db.prepare("SELECT MIN(published_at) d FROM posts WHERE status='published'").get().d;
  const days = oldest ? Math.floor((Date.now() - new Date(oldest).getTime()) / 864e5) : 0;
  if (days < 7) return `첫 글 발행 후 ${days}일. 구글 색인과 GSC 데이터 반영에 보통 3~10일 걸립니다.`;
  return '색인은 됐지만 아직 검색 노출이 없습니다. 글이 쌓여야 도메인 신뢰도가 올라갑니다.';
}

export async function dailyReport() {
  const y = dateStr(1), d2 = dateStr(2);
  const cur = periodTotals(y, y);
  const prev = periodTotals(d2, d2);
  const s = publishingStatus();

  let t = `📊 <b>일간 리포트</b> · ${y}\n\n`;
  if (!cur.pageviews && !cur.impressions) {
    t += `유입 데이터가 아직 없습니다.\n<i>${esc(emptyHint())}</i>\n\n`;
  } else {
    t += `<b>유입</b>\n`;
    t += `· 방문자 ${cur.users} (${delta(cur.users, prev.users)})\n`;
    t += `· 조회수 ${cur.pageviews} (${delta(cur.pageviews, prev.pageviews)})\n\n`;
    t += `<b>검색</b>\n`;
    t += `· 노출 ${cur.impressions} (${delta(cur.impressions, prev.impressions)})\n`;
    t += `· 클릭 ${cur.clicks} · CTR ${pct(cur.ctr)}\n`;
    if (cur.position) t += `· 평균순위 ${cur.position.toFixed(1)}위\n`;
    t += '\n';
  }
  if (cur.revenue) t += `<b>수익</b> ${won(cur.revenue)}\n\n`;

  t += `<b>발행</b>\n· 누적 ${s.published}편 · 최근 7일 ${s.last7}편\n`;
  if (s.review) t += `· ⏳ 승인 대기 ${s.review}편 — /pending\n`;
  if (s.draft) t += `· 품질 미달 ${s.draft}편\n`;
  t += `· 남은 글감 ${s.keywordsLeft}개\n`;

  const need = 30 - s.published;
  if (need > 0) t += `\n애드센스 신청까지 ${need}편`;

  await sendLong(t, { silent: true });
  return `users=${cur.users} clicks=${cur.clicks}`;
}

export async function weeklyReport() {
  const end = dateStr(1), start = dateStr(7);
  const pStart = dateStr(14), pEnd = dateStr(8);
  const cur = periodTotals(start, end);
  const prev = periodTotals(pStart, pEnd);
  const s = publishingStatus();

  let t = `📈 <b>주간 리포트</b> · ${start} ~ ${end}\n\n`;
  t += `<b>7일 합계</b>\n`;
  t += `· 방문자 ${cur.users} (${delta(cur.users, prev.users)})\n`;
  t += `· 조회수 ${cur.pageviews} (${delta(cur.pageviews, prev.pageviews)})\n`;
  t += `· 노출 ${cur.impressions} (${delta(cur.impressions, prev.impressions)})\n`;
  t += `· 클릭 ${cur.clicks} (${delta(cur.clicks, prev.clicks)}) · CTR ${pct(cur.ctr)}\n`;
  if (cur.revenue) t += `· 수익 ${won(cur.revenue)}\n`;
  if (!cur.impressions) t += `\n<i>${esc(emptyHint())}</i>\n`;

  const top = topPosts(start, end, 5);
  if (top.length) {
    t += `\n<b>성과 상위</b>\n`;
    for (const p of top) {
      t += `· ${esc(p.title.slice(0, 34))}\n`;
      t += `   클릭 ${p.clicks ?? 0} · 노출 ${p.impressions ?? 0}`;
      if (p.position) t += ` · ${p.position.toFixed(0)}위`;
      t += '\n';
    }
  }

  const cats = categoryPerformance(start, end);
  if (cats.length) {
    t += `\n<b>카테고리별</b>\n`;
    for (const c of cats) t += `· ${esc(c.category)} — ${c.posts}편 · 클릭 ${c.clicks ?? 0} · 노출 ${c.impressions ?? 0}\n`;
  }

  const ops = opportunityQueries(start, end, { limit: 5 });
  if (ops.length) {
    t += `\n<b>기회 키워드</b> (노출 있으나 순위 낮음)\n`;
    for (const o of ops) t += `· "${esc(o.query)}" — 노출 ${o.impressions} · ${o.position.toFixed(0)}위\n`;
    t += `<i>다음 글감으로 자동 등록됩니다.</i>\n`;
  }

  t += `\n<b>다음 주 계획</b>\n· 목표 하루 ${config.postsPerDay}편 (주 ${config.postsPerDay*7}편) · 남은 글감 ${s.keywordsLeft}개\n`;
  const need = 30 - s.published;
  t += need > 0
    ? `· 애드센스 신청까지 ${need}편 (약 ${Math.ceil(need / (config.postsPerDay * 7))}주)\n`
    : `· 애드센스 신청 조건(30편) 충족 — strategy/monetization.md 체크리스트 확인\n`;

  await sendLong(t);
  return `users=${cur.users} clicks=${cur.clicks} posts=${s.published}`;
}

export async function monthlyReport() {
  const end = dateStr(1), start = dateStr(30);
  const cur = periodTotals(start, end);
  const prev = periodTotals(dateStr(60), dateStr(31));
  const s = publishingStatus();

  let t = `🗓 <b>월간 리포트</b> · ${start} ~ ${end}\n\n`;
  t += `<b>30일 합계</b>\n`;
  t += `· 방문자 ${cur.users} (${delta(cur.users, prev.users)})\n`;
  t += `· 조회수 ${cur.pageviews} (${delta(cur.pageviews, prev.pageviews)})\n`;
  t += `· 노출 ${cur.impressions} · 클릭 ${cur.clicks} · CTR ${pct(cur.ctr)}\n`;
  t += `· 수익 ${won(cur.revenue)} (${delta(cur.revenue, prev.revenue)})\n`;
  if (cur.pageviews) t += `· RPM ${won((cur.revenue / cur.pageviews) * 1000)}\n`;

  const cats = categoryPerformance(start, end);
  if (cats.length) {
    t += `\n<b>카테고리 ROI</b>\n`;
    for (const c of cats) {
      const perPost = c.posts ? (c.clicks ?? 0) / c.posts : 0;
      t += `· ${esc(c.category)} — ${c.posts}편 · 글당 클릭 ${perPost.toFixed(1)}`;
      if (c.revenue) t += ` · ${won(c.revenue)}`;
      t += '\n';
    }
    t += `<i>글당 클릭이 높은 카테고리에 발행 비중이 자동으로 이동합니다.</i>\n`;
  }

  t += `\n<b>누적</b>\n· 발행 ${s.published}편 · 남은 글감 ${s.keywordsLeft}개\n`;
  await sendLong(t);
  return `revenue=${cur.revenue} posts=${s.published}`;
}

export const runDaily = () => trackRun('report_daily', dailyReport);
export const runWeekly = () => trackRun('report_weekly', weeklyReport);
export const runMonthly = () => trackRun('report_monthly', monthlyReport);

if (process.argv[1]?.endsWith('index.js')) {
  const kind = process.argv[2] ?? 'daily';
  ({ daily: dailyReport, weekly: weeklyReport, monthly: monthlyReport }[kind])()
    .then((r) => { console.log('전송 완료:', r); process.exit(0); })
    .catch((e) => { console.error(e.message); process.exit(1); });
}
