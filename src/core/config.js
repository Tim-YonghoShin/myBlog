// .env 로더 + 설정 접근자. 외부 의존성 없이 동작한다.
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');

const parseEnv = (path) => {
  if (!existsSync(path)) return {};
  const out = {};
  for (const raw of readFileSync(path, 'utf8').split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    out[key] = val;
  }
  return out;
};

const fileEnv = parseEnv(join(ROOT, '.env'));
// 실제 환경변수가 .env 보다 우선한다 (systemd 로 주입할 때 유용)
const env = (key, fallback = '') => process.env[key] ?? fileEnv[key] ?? fallback;

export const config = {
  root: ROOT,
  tz: env('TZ', 'Asia/Seoul'),
  logLevel: env('LOG_LEVEL', 'info'),
  requireApproval: env('REQUIRE_APPROVAL', 'true') !== 'false',
  postsPerDay: Number(env('POSTS_PER_DAY', '3')),

  telegram: {
    token: env('TELEGRAM_BOT_TOKEN'),
    chatId: env('TELEGRAM_CHAT_ID'),
  },
  tistory: {
    blogUrl: env('TISTORY_BLOG_URL').replace(/\/$/, ''),
    blogName: env('TISTORY_BLOG_NAME'),
    sessionPath: join(ROOT, '.session/tistory.json'),
  },
  google: {
    serviceAccountPath: join(ROOT, env('GOOGLE_SERVICE_ACCOUNT_JSON', 'secrets/gcp-service-account.json')),
    ga4PropertyId: env('GA4_PROPERTY_ID'),
    gscSiteUrl: env('GSC_SITE_URL'),
  },
  adsense: {
    clientId: env('ADSENSE_CLIENT_ID'),
    clientSecret: env('ADSENSE_CLIENT_SECRET'),
    refreshToken: env('ADSENSE_REFRESH_TOKEN'),
    accountId: env('ADSENSE_ACCOUNT_ID'),
  },
  paths: {
    db: join(ROOT, 'data/blog.db'),
    logs: join(ROOT, 'logs'),
    drafts: join(ROOT, 'content/posts'),
    templates: join(ROOT, 'content/templates'),
  },
};

/** 어떤 기능이 아직 설정 미비로 막혀 있는지 알려준다. */
export function readiness() {
  const need = (label, ok, hint) => ({ label, ok: Boolean(ok), hint });
  return [
    need('텔레그램', config.telegram.token && config.telegram.chatId, 'Phase 0-2: @BotFather 로 봇 생성'),
    need('티스토리 주소', config.tistory.blogUrl && !config.tistory.blogUrl.includes('example'), 'Phase 0-1: .env 의 TISTORY_BLOG_URL'),
    need('티스토리 세션', existsSync(config.tistory.sessionPath), 'Phase 3-1: npm run session:login'),
    need('GA4', config.google.ga4PropertyId && existsSync(config.google.serviceAccountPath), 'Phase 0-3/0-4'),
    need('Search Console', config.google.gscSiteUrl && !config.google.gscSiteUrl.includes('example') && existsSync(config.google.serviceAccountPath), 'Phase 0-5'),
    need('애드센스', config.adsense.refreshToken, 'Phase 0-6 (승인 후)'),
  ];
}
