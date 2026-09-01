#!/usr/bin/env node
// Phase 3-1 — 티스토리 로그인 세션 확보.
// 브라우저 창을 띄우면 사용자가 직접 카카오 로그인을 하고, 그 세션을 저장해 이후 자동 발행에 재사용한다.
// 비밀번호는 이 코드가 다루지 않는다.
//
// 사용법: node scripts/tistory-login.mjs

import '../src/core/net.js';
import { chromium } from 'playwright-core';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { config } from '../src/core/config.js';
import { createLogger } from '../src/core/logger.js';

const log = createLogger('login');
const PROFILE = join(config.root, '.session/chrome-profile');
const STATE = config.tistory.sessionPath;
const BLOG = config.tistory.blogUrl;

if (!BLOG || BLOG.includes('example')) {
  console.error('.env 의 TISTORY_BLOG_URL 이 설정되지 않았습니다.');
  process.exit(1);
}

mkdirSync(PROFILE, { recursive: true });
mkdirSync(join(config.root, '.session'), { recursive: true });

console.log(`\n티스토리 로그인 세션을 확보합니다.\n대상: ${BLOG}\n`);
console.log('브라우저 창이 열리면 카카오 계정으로 직접 로그인해 주세요.');
console.log('로그인이 끝나면 자동으로 감지해서 세션을 저장하고 창을 닫습니다.\n');

const ctx = await chromium.launchPersistentContext(PROFILE, {
  headless: false,
  executablePath: '/usr/bin/google-chrome',
  viewport: { width: 1440, height: 900 },
  locale: 'ko-KR',
  timezoneId: 'Asia/Seoul',
  args: ['--disable-blink-features=AutomationControlled'],
});

const page = ctx.pages()[0] ?? (await ctx.newPage());
await page.goto('https://www.tistory.com/auth/login', { waitUntil: 'domcontentloaded' }).catch(() => {});

/** 관리 페이지에 접근되면 로그인된 것으로 본다. */
async function isLoggedIn() {
  const probe = await ctx.newPage();
  try {
    const res = await probe.goto(`${BLOG}/manage/category`, { waitUntil: 'domcontentloaded', timeout: 20_000 });
    const url = probe.url();
    const ok = res?.ok() && !/auth\/login|accounts\.kakao|kauth\.kakao/.test(url);
    return ok;
  } catch {
    return false;
  } finally {
    await probe.close().catch(() => {});
  }
}

const deadline = Date.now() + 10 * 60_000;
let ok = false;
process.stdout.write('로그인 대기 중');
while (Date.now() < deadline) {
  await new Promise((r) => setTimeout(r, 4000));
  if (await isLoggedIn()) { ok = true; break; }
  process.stdout.write('.');
}
console.log('');

if (!ok) {
  console.error('시간 초과(10분). 로그인이 감지되지 않았습니다. 다시 실행해 주세요.');
  await ctx.close();
  process.exit(1);
}

const state = await ctx.storageState();
writeFileSync(STATE, JSON.stringify(state, null, 2));
console.log(`✅ 세션 저장 완료: ${STATE.replace(config.root + '/', '')}`);
console.log(`   쿠키 ${state.cookies.length}개 · 프로필 ${PROFILE.replace(config.root + '/', '')}`);

// 현재 카테고리 구조를 읽어 둔다 (재편 작업의 기준점)
const page2 = await ctx.newPage();
await page2.goto(`${BLOG}/manage/category`, { waitUntil: 'networkidle', timeout: 30_000 }).catch(() => {});
const cats = await page2.evaluate(() => {
  const out = [];
  document.querySelectorAll('[class*="category"] li, .list_category li, li[data-id]').forEach((li) => {
    const name = li.querySelector('span, a, .txt_category')?.textContent?.trim();
    if (name && name.length < 40) out.push({ id: li.getAttribute('data-id') ?? null, name });
  });
  return out;
});
writeFileSync(join(config.root, '.session/categories.json'), JSON.stringify(cats, null, 2));
console.log(`   카테고리 ${cats.length}개 확인 → .session/categories.json`);
if (cats.length) console.log('   ' + cats.map((c) => c.name).join(' / '));

await ctx.close();
console.log('\n다음 단계: 카테고리 재편 후 발행 모듈 테스트.');
