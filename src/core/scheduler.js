// 최소 크론 스케줄러. 외부 의존성 없음.
//   3필드 '분 시 요일'       → '0 9 1,3,5'  월·수·금 09:00
//   4필드 '분 시 일 요일'    → '20 9 1 *'   매월 1일 09:20
// 요일: 0=일 … 6=토 / 일: 1~31 / '*' 는 전체
import { createLogger } from './logger.js';
import { config } from './config.js';

const log = createLogger('scheduler');

const matchField = (field, value) => {
  if (field === '*') return true;
  return field.split(',').some((part) => {
    if (part.includes('-')) {
      const [a, b] = part.split('-').map(Number);
      return value >= a && value <= b;
    }
    if (part.startsWith('*/')) return value % Number(part.slice(2)) === 0;
    return Number(part) === value;
  });
};

export function matches(spec, date = new Date()) {
  const f = spec.trim().split(/\s+/);
  const [min, hour, dom, dow] = f.length === 3 ? [f[0], f[1], '*', f[2]] : f;
  // 설정된 타임존 기준으로 판단한다 (서버 TZ 와 무관하게 동작)
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: config.tz, hour12: false,
    hour: '2-digit', minute: '2-digit', weekday: 'short', day: '2-digit',
  }).formatToParts(date);
  const get = (t) => parts.find((p) => p.type === t)?.value;
  const DOW = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return matchField(min, Number(get('minute')))
      && matchField(hour, Number(get('hour')) % 24)
      && matchField(dom, Number(get('day')))
      && matchField(dow, DOW[get('weekday')]);
}

/**
 * 잡을 등록하고 1분마다 검사한다.
 * @param {{name:string, spec:string, run:Function}[]} jobs
 */
export function start(jobs) {
  const fired = new Set(); // 같은 분에 두 번 실행되는 것을 막는다
  log.info(`스케줄러 시작 (${config.tz}) — 잡 ${jobs.length}개`);
  for (const j of jobs) log.info(`  ${j.spec.padEnd(12)} ${j.name}`);

  const tick = async () => {
    const now = new Date();
    const stamp = now.toISOString().slice(0, 16);
    for (const job of jobs) {
      const key = `${job.name}@${stamp}`;
      if (fired.has(key) || !matches(job.spec, now)) continue;
      fired.add(key);
      log.info(`실행: ${job.name}`);
      try { await job.run(); } catch (e) { log.error(`잡 실패: ${job.name}`, e); }
    }
    if (fired.size > 500) fired.clear();
  };

  tick();
  return setInterval(tick, 60_000);
}

/**
 * 하루 n 편을 09~22시 사이에 균등 분산한 시(hour) 목록을 만든다.
 * 한 번에 몰아 발행하면 사람이 쓴 리듬처럼 보이지 않는다.
 */
export function spreadHours(n) {
  const START = 9, END = 22;
  const count = Math.max(1, Math.min(12, Math.round(n)));
  if (count === 1) return [10];
  const step = (END - START) / (count - 1);
  return [...new Set(Array.from({ length: count }, (_, i) => Math.round(START + i * step)))];
}
