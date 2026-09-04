#!/usr/bin/env node
// 텔레그램 QR 로그인 — 본체 화면 없이 세션을 확보한다.
//
// 카카오는 QR 로그인을 지원한다. 서버가 헤드리스 브라우저로 QR 을 띄우고 그 이미지를
// 텔레그램으로 보내면, 사용자는 폰 카카오톡으로 스캔만 하면 된다.
// 인증은 폰에서 일어나지만 **세션 쿠키는 서버 브라우저에 생긴다** — 이게 핵심이다.
//
// 사용법: node scripts/tistory-login-qr.mjs
import '../src/core/net.js';
import pw from 'playwright-core';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { config } from '../src/core/config.js';
import { createLogger } from '../src/core/logger.js';
import { send, sendPhoto, remove, esc } from '../src/telegram/client.js';

const { chromium } = pw;
const log = createLogger('qr-login');
const STATE = config.tistory.sessionPath;
const SHOT = join(config.root, '.session/qr.png');
const ROUNDS = 3;              // QR 만료 시 재발급 횟수
const POLL_MS = 3000;
const ROUND_MS = 4.5 * 60_000; // QR 유효시간 5분보다 조금 짧게

mkdirSync(dirname(STATE), { recursive: true });

// [시도했다가 버린 방법] QR 은 https://auth.kakao.com/qr_login/confirm?token=... 링크를 담고 있어서
// 그 링크를 텔레그램 버튼으로 보내면 스캔 없이 승인될 것처럼 보인다. 실제로는 동작하지 않는다.
// 카카오가 토큰을 QR 을 생성한 브라우저의 세션·IP 에 묶어두기 때문에, 다른 기기에서 열면
// "Your network has changed or your access has been denied" 로 거부된다.
// 카카오톡 앱 스캐너는 브라우저로 URL 을 여는 게 아니라 앱의 인증 채널로 토큰을 전달한다.
// 링크만으로 승인이 되면 URL 을 가로챈 누구나 로그인할 수 있으므로, 막는 것이 옳은 설계다.
// → 로그인을 쉽게 만드는 대신 '로그인 상태 유지'로 로그인 빈도를 줄이는 쪽으로 간다.

/**
 * QR 화면의 「로그인 상태 유지」 체크박스를 켠다.
 * 기본값이 꺼짐이라 세션이 금방 만료된다. 스캔 전에 켜둬야 반영된다.
 */
async function ensureStaySignedIn(page) {
  try {
    return await page.evaluate(() => {
      const box = document.querySelector('input[name="staySignedIn"], input[id^="staySignedIn"]');
      if (!box) return false;
      if (!box.checked) {
        // 리액트 상태까지 반영되도록 라벨을 클릭한다 (checked 직접 대입은 무시될 수 있다)
        const label = box.closest('label') ?? document.querySelector(`label[for="${box.id}"]`);
        (label ?? box).click();
      }
      return document.querySelector('input[name="staySignedIn"], input[id^="staySignedIn"]')?.checked === true;
    });
  } catch {
    return false;
  }
}

export async function qrLogin({ notify = true } = {}) {
  const browser = await chromium.launch({ headless: true, executablePath: '/usr/bin/google-chrome' });
  // QR 을 또렷하게 찍기 위해 배율을 높인다 (폰 카메라 인식률)
  const ctx = await browser.newContext({
    locale: 'ko-KR', timezoneId: config.tz,
    viewport: { width: 1280, height: 900 }, deviceScaleFactor: 3,
    userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36',
  });
  const page = await ctx.newPage();
  let sentMsgId = null;

  const cleanup = async () => { if (sentMsgId) await remove(sentMsgId); sentMsgId = null; };

  try {
    await page.goto('https://www.tistory.com/auth/login', { waitUntil: 'networkidle', timeout: 45_000 });
    await page.waitForTimeout(1500);
    await page.evaluate(() =>
      [...document.querySelectorAll('a,button')].find((e) => /카카오계정으로 로그인/.test(e.textContent || ''))?.click());
    await page.waitForTimeout(4000);

    await page.evaluate(() =>
      [...document.querySelectorAll('button')].find((e) => /QR코드 로그인/.test(e.textContent || ''))?.click());
    await page.waitForSelector('.box_qrcode canvas, canvas', { timeout: 20_000 });
    await page.waitForTimeout(1200);

    for (let round = 0; round < ROUNDS; round++) {
      if (round > 0) {
        // QR 새로고침
        await page.evaluate(() =>
          [...document.querySelectorAll('a,button')].find((e) => /QR코드 새로고침|새로고침/.test(e.textContent || ''))?.click());
        await page.waitForTimeout(2500);
      }

      const box = await page.$('.box_qrcode') ?? await page.$('canvas');
      if (!box) throw new Error('QR 코드를 찾지 못했습니다. 카카오 로그인 화면 구조가 바뀌었을 수 있습니다.');
      await box.screenshot({ path: SHOT });

      const stayOn = await ensureStaySignedIn(page);

      if (notify) {
        await cleanup();
        const msg = await sendPhoto(SHOT,
          `🔐 <b>티스토리 로그인</b>\n\n` +
          `카카오톡 앱 → <b>더보기</b> → 우측 상단 <b>QR코드 스캔</b> 으로 이 코드를 찍어주세요.\n\n` +
          `· 유효시간 약 5분 (만료되면 새 코드를 다시 보냅니다)\n` +
          `· <b>로그인 상태 유지</b> ${stayOn ? '켜짐 — 다음 로그인까지 오래 갑니다' : '설정 실패 (세션이 짧을 수 있습니다)'}\n` +
          `· 인증은 폰에서, 세션은 서버에 저장됩니다`);
        sentMsgId = msg.message_id;
        log.info(`QR 전송 (${round + 1}/${ROUNDS}) · 로그인상태유지=${stayOn}`);
      } else {
        log.info(`QR 저장: ${SHOT}`);
      }

      // 로그인 완료 감지
      const deadline = Date.now() + ROUND_MS;
      while (Date.now() < deadline) {
        await page.waitForTimeout(POLL_MS);
        if (!/accounts\.kakao\.com|kauth\.kakao\.com/.test(page.url())) {
          // 리다이렉트가 끝났다 — 관리 페이지 접근으로 확정 확인
          const probe = await ctx.newPage();
          try {
            const res = await probe.goto(`${config.tistory.blogUrl}/manage/category`, { waitUntil: 'domcontentloaded', timeout: 20_000 });
            const ok = res?.ok() && !/auth\/login|accounts\.kakao/.test(probe.url());
            if (ok) {
              const state = await ctx.storageState();
              writeFileSync(STATE, JSON.stringify(state, null, 2));
              log.info(`세션 저장 완료 — 쿠키 ${state.cookies.length}개`);
              await cleanup();
              if (notify) await send(`✅ <b>로그인 완료</b>\n쿠키 ${state.cookies.length}개를 저장했습니다. 자동 발행이 다시 동작합니다.`);
              return { ok: true, cookies: state.cookies.length };
            }
          } catch { /* 아직 리다이렉트 중 */ }
          finally { await probe.close().catch(() => {}); }
        }
      }
      log.warn(`QR 만료 (${round + 1}/${ROUNDS})`);
    }

    await cleanup();
    if (notify) await send('⏱ QR 코드가 모두 만료되었습니다. <code>/login</code> 으로 다시 시도하세요.');
    return { ok: false, reason: 'expired' };
  } catch (e) {
    await cleanup();
    log.error('QR 로그인 실패', e);
    if (notify) await send(`⚠️ QR 로그인 실패\n<code>${esc(e.message.slice(0, 300))}</code>`);
    throw e;
  } finally {
    await browser.close();
  }
}

if (process.argv[1]?.endsWith('tistory-login-qr.mjs')) {
  qrLogin({ notify: !process.argv.includes('--no-notify') })
    .then((r) => { console.log(r.ok ? `성공 (쿠키 ${r.cookies}개)` : `실패: ${r.reason}`); process.exit(r.ok ? 0 : 1); })
    .catch(() => process.exit(1));
}
