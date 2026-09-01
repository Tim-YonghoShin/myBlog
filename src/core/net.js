// 네트워크 부트스트랩. 모든 진입점에서 가장 먼저 import 할 것.
//
// 이 서버는 IPv6 경로가 없고 api.telegram.org 까지 TCP 핸드셰이크가 ~315ms 걸린다.
// Node 22 의 autoSelectFamily 기본 시도 타임아웃은 250ms 라서, IPv6 는 ENETUNREACH 로
// 즉시 실패하고 IPv4 는 250ms 에 잘려 fetch 가 ETIMEDOUT 으로 죽는다.
// IPv4 를 우선하고 시도 타임아웃을 넉넉히 준다.
import net from 'node:net';
import dns from 'node:dns';

dns.setDefaultResultOrder('ipv4first');
net.setDefaultAutoSelectFamilyAttemptTimeout(5000);

/** 일시적 네트워크 오류에 한해 지수 백오프로 재시도한다. */
export async function fetchRetry(url, options = {}, { retries = 3, baseDelay = 800 } = {}) {
  // timeoutMs 는 우리 옵션이라 fetch 로 넘기지 않는다
  const { timeoutMs = 30_000, ...fetchOptions } = options;
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs), ...fetchOptions });
      // 5xx 와 429 는 재시도할 가치가 있다. 4xx 는 그대로 돌려준다.
      if (res.status >= 500 || res.status === 429) {
        if (attempt < retries) { await sleep(baseDelay * 2 ** attempt); continue; }
      }
      return res;
    } catch (e) {
      lastError = e;
      if (attempt < retries) await sleep(baseDelay * 2 ** attempt);
    }
  }
  throw lastError;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
