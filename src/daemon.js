#!/usr/bin/env node
// 상시 구동 데몬. 텔레그램 명령 수신 + 스케줄 잡 실행을 한 프로세스에서 돌린다.
import './core/net.js';
import { config } from './core/config.js';
import { createLogger } from './core/logger.js';
import { migrate, getState } from './core/db.js';
import { start, spreadHours } from './core/scheduler.js';
import { poll } from './telegram/bot.js';
import { send } from './telegram/client.js';
import { runDraftJob } from './content/pipeline.js';
import { collectAll } from './collect/index.js';
import { runDaily, runWeekly, runMonthly } from './report/index.js';
import { runMining } from './content/mining.js';
import { runHealth } from './core/health.js';
import { runCategoryWatch } from './publish/category-watch.js';
import { execFile } from 'node:child_process';

const log = createLogger('daemon');
migrate();

// 하루 발행 편수를 09~22시에 분산한다. 한 번에 몰아쓰면 사람이 쓴 리듬으로 보이지 않는다.
// 발행 편수는 DB 의 posts_per_day 가 있으면 그걸 우선한다 (/rate 로 실시간 변경).
const perDay = Number(getState('posts_per_day', config.postsPerDay));
// 초안 시각은 기본적으로 09~22시 균등 분산이지만, 승인 가능한 시간대에 맞추기 위해
// state.draft_hours 로 직접 지정할 수 있다. (예: '9,13,17' — 세션이 살아있는 낮 시간대)
const draftHours = getState('draft_hours', '') || spreadHours(perDay).join(',');

const jobs = [
  // 수집 → 리포트 순서가 되도록 시각을 배치한다
  { name: '지표 수집',   spec: '30 8 *',        run: () => collectAll({ days: 14 }) },
  { name: '일간 리포트', spec: '0 9 *',         run: runDaily },
  { name: '주간 리포트', spec: '10 9 * 1',      run: runWeekly },
  { name: '월간 리포트', spec: '20 9 1 *',      run: runMonthly },
  { name: '피드백 루프', spec: '30 9 * 1',      run: runMining },
  { name: '카테고리 점검', spec: '40 9 *',      run: runCategoryWatch },
  { name: '초안 생성',   spec: `0 ${draftHours} *`, run: runDraftJob },
  // 세션 만료를 발행일 아침에 알게 되면 늦다. 전날 밤에 미리 확인한다.
  { name: '헬스체크',    spec: '0 23 *',        run: runHealth },
  { name: '백업',        spec: '30 4 *',        run: () => new Promise((res, rej) =>
      execFile('node', ['scripts/backup.mjs'], { cwd: config.root }, (e, out) => e ? rej(e) : res(out.trim()))) },
];

const shutdown = (sig) => {
  log.info(`${sig} 수신 — 종료합니다`);
  send('🛑 봇을 종료합니다.').catch(() => {}).finally(() => process.exit(0));
};
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('unhandledRejection', (e) => {
  log.error('처리되지 않은 오류', e);
  send(`⚠️ 데몬 오류\n<code>${String(e?.message ?? e).slice(0, 400)}</code>`).catch(() => {});
});

log.info(`데몬 시작 · 하루 ${perDay}편 · 생성 시각 ${draftHours}시`);
start(jobs);
poll();   // 블로킹 (long polling)
