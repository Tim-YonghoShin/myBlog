// 콘솔 + 일자별 파일 로깅.
import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { config } from './config.js';

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const threshold = LEVELS[config.logLevel] ?? LEVELS.info;
mkdirSync(config.paths.logs, { recursive: true });

const stamp = () =>
  new Date().toLocaleString('sv-SE', { timeZone: config.tz }).replace(' ', 'T');

function emit(level, scope, msg, extra) {
  if (LEVELS[level] < threshold) return;
  const time = stamp();
  const detail = extra === undefined ? '' : ' ' + (extra instanceof Error ? (extra.stack ?? extra.message) : JSON.stringify(extra));
  const line = `${time} [${level.toUpperCase()}] (${scope}) ${msg}${detail}`;
  (level === 'error' || level === 'warn' ? console.error : console.log)(line);
  try {
    appendFileSync(join(config.paths.logs, `${time.slice(0, 10)}.log`), line + '\n');
  } catch {
    /* 로그 파일 쓰기 실패가 본 작업을 막지는 않게 한다 */
  }
}

export const createLogger = (scope) => ({
  debug: (m, e) => emit('debug', scope, m, e),
  info: (m, e) => emit('info', scope, m, e),
  warn: (m, e) => emit('warn', scope, m, e),
  error: (m, e) => emit('error', scope, m, e),
});
