// Phase 4 통합 수집 진입점.
import { trackRun } from '../core/db.js';
import { createLogger } from '../core/logger.js';
import { collectGA4 } from './ga4.js';
import { collectGSC } from './gsc.js';

const log = createLogger('collect');

/** 수집은 한쪽이 실패해도 다른 쪽은 진행한다. */
export const collectAll = ({ days = 14 } = {}) =>
  trackRun('collect', async () => {
    const results = {};
    for (const [name, fn] of [['gsc', () => collectGSC({ days })], ['ga4', () => collectGA4({ days: Math.min(days, 30) })]]) {
      try { results[name] = await fn(); }
      catch (e) { log.error(`${name} 수집 실패`, e); results[name] = { error: e.message }; }
    }
    return JSON.stringify(results);
  });

if (process.argv[1]?.endsWith('index.js')) {
  const days = Number(process.argv.find((a) => /^\d+$/.test(a)) ?? 14);
  collectAll({ days })
    .then((r) => { console.log('\n수집 결과:', r); process.exit(0); })
    .catch((e) => { console.error(e.message); process.exit(1); });
}
