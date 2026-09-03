// GA4 가 실제로 히트를 보내는지 확인한다.
//
// 티스토리 「구글 애널리틱스」 플러그인이 cookie_flags:'max-age=0' 을 넣으면
// gtag.js 는 정상 로드되지만 /g/collect 요청이 아예 나가지 않는다.
// 대시보드는 그냥 0 으로 보여서 "유입이 없다"와 구분이 안 된다. 그래서 직접 확인한다.
import './net.js';
import pw from 'playwright-core';
import { config } from './config.js';
import { createLogger } from './logger.js';

const log = createLogger('ga-check');

export async function verifyGA4({ path = '/' } = {}) {
  const browser = await pw.chromium.launch({ headless: true, executablePath: '/usr/bin/google-chrome' });
  try {
    const ctx = await browser.newContext({ locale: 'ko-KR', viewport: { width: 390, height: 800 }, isMobile: true });
    const page = await ctx.newPage();
    let collect = 0;
    page.on('request', (r) => { if (/\/g\/collect/.test(r.url())) collect++; });

    await page.goto(config.tistory.blogUrl + path, { waitUntil: 'networkidle', timeout: 45_000 });
    await page.waitForTimeout(6000);

    const tag = await page.evaluate(() => {
      const s = [...document.querySelectorAll('script')].map((x) => x.textContent || '').join('\n');
      return {
        measurementId: (s.match(/G-[A-Z0-9]{8,}/) || [null])[0],
        cookieFlags: (s.match(/cookie_flags\s*:\s*'([^']*)'/) || [null, null])[1],
        hasGtag: typeof window.gtag === 'function',
      };
    });
    const cookies = (await ctx.cookies()).filter((c) => c.name.startsWith('_ga'));

    const ok = collect > 0;
    const reason = ok ? null
      : /max-age=0/.test(tag.cookieFlags ?? '')
        ? `티스토리 GA 플러그인의 cookie_flags='${tag.cookieFlags}' 가 수집을 막고 있습니다`
        : !tag.measurementId ? '페이지에 측정 ID 가 없습니다'
        : '원인 미상 — gtag 는 있으나 히트가 나가지 않습니다';

    log.info(`GA4 확인: collect ${collect}건 · _ga 쿠키 ${cookies.length}개 · id=${tag.measurementId ?? '없음'}`);
    return { ok, collect, cookies: cookies.length, ...tag, reason };
  } finally {
    await browser.close();
  }
}

if (process.argv[1]?.endsWith('ga-check.js')) {
  verifyGA4().then((r) => {
    console.log(r.ok ? '✅ GA4 정상 수집' : `❌ GA4 수집 안 됨 — ${r.reason}`);
    console.log(JSON.stringify(r, null, 2));
    process.exit(r.ok ? 0 : 1);
  });
}
