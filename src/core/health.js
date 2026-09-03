// Phase 3-4 / 7-1 — 헬스체크와 장애 알림.
//
// 무인 운영에서 가장 흔한 실패는 "조용히 만료된 세션"이다.
// 발행일 아침에야 알게 되면 늦으므로 매일 미리 확인하고 알린다.
import { existsSync } from 'node:fs';
import { db, trackRun, getState, setState } from './db.js';
import { config } from './config.js';
import { createLogger } from './logger.js';
import { send, esc } from '../telegram/client.js';

const log = createLogger('health');

const check = async (name, fn, fixHint) => {
  try {
    const detail = await fn();
    return { name, ok: true, detail };
  } catch (e) {
    return { name, ok: false, detail: e.message.slice(0, 160), fixHint };
  }
};

export async function runChecks() {
  return Promise.all([
    // 티스토리 세션 — 만료되면 발행이 통째로 멈춘다
    check('티스토리 세션', async () => {
      if (!existsSync(config.tistory.sessionPath)) throw new Error('세션 파일 없음');
      const { withSession, getCategories, flatten } = await import('../publish/tistory-api.js');
      return withSession(async (ctx) => {
        const flat = flatten((await getCategories(ctx)).categories);
        return `카테고리 ${flat.length}개`;
      });
    }, '/login (텔레그램에서 QR 로그인)'),

    // Anthropic OAuth — 만료되면 초안 생성이 멈춘다
    check('Anthropic OAuth', async () => {
      const { default: Anthropic } = await import('@anthropic-ai/sdk');
      const r = await new Anthropic().messages.create({
        model: 'claude-opus-5', max_tokens: 8,
        messages: [{ role: 'user', content: 'ok' }],
      });
      return r.model;
    }, 'ant auth login'),

    // GA4 실제 수집 — 플러그인 설정 때문에 조용히 0 이 되는 사고가 있었다
    check('GA4 수집', async () => {
      const { verifyGA4 } = await import('./ga-check.js');
      const r = await verifyGA4();
      if (!r.ok) throw new Error(r.reason ?? '히트가 나가지 않습니다');
      return `히트 ${r.collect}건 · ${r.measurementId}`;
    }, '티스토리 GA 플러그인을 끄고 스킨에 gtag 직접 삽입 (OPERATIONS.md 참고)'),

    // Google API — 만료되면 리포트가 빈다
    check('Google API', async () => {
      const { google } = await import('googleapis');
      const { authClient } = await import('../collect/google.js');
      const auth = await authClient();
      const sites = (await google.searchconsole({ version: 'v1', auth }).sites.list()).data.siteEntry ?? [];
      if (!sites.length) throw new Error('접근 가능한 GSC 사이트 없음');
      return `GSC ${sites.length}개 사이트`;
    }, 'npm run check:google'),
  ]);
}

/** 상태가 바뀔 때만 알린다. 매일 "정상"을 보내면 알림을 무시하게 된다. */
export const runHealth = () =>
  trackRun('health', async () => {
    const results = await runChecks();
    const failed = results.filter((r) => !r.ok);
    const key = failed.map((r) => r.name).sort().join('|');
    const prev = getState('health_failed', '');
    setState('health_failed', key);

    for (const r of results) {
      (r.ok ? log.info : log.error)(`${r.name}: ${r.ok ? r.detail : r.detail}`);
    }

    if (failed.length && key !== prev) {
      let t = `🚨 <b>점검 실패</b>\n\n`;
      for (const f of failed) t += `❌ <b>${esc(f.name)}</b>\n   ${esc(f.detail)}\n   → <code>${esc(f.fixHint)}</code>\n\n`;
      t += `조치 전까지 해당 기능이 멈춥니다.`;
      await send(t);

      // 티스토리 세션 만료는 QR 로 바로 복구할 수 있다. 사람 손이 덜 가게 즉시 보낸다.
      if (failed.some((f) => f.name === '티스토리 세션')) {
        try {
          const { qrLogin } = await import('../../scripts/tistory-login-qr.mjs');
          await qrLogin({ notify: true });
        } catch { /* 실패 알림은 qrLogin 이 보낸다 */ }
      }
    } else if (!failed.length && prev) {
      await send('✅ <b>복구됨</b> — 모든 점검을 통과했습니다.');
    }
    return failed.length ? `failed: ${key}` : 'all ok';
  });

if (process.argv[1]?.endsWith('health.js')) {
  runChecks().then((rs) => {
    for (const r of rs) console.log(`${r.ok ? '✅' : '❌'} ${r.name.padEnd(16)} ${r.detail}${r.ok ? '' : `\n   → ${r.fixHint}`}`);
    process.exit(rs.every((r) => r.ok) ? 0 : 1);
  });
}
