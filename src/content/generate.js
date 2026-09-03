// Phase 2-2/2-3 — 리서치 + 초안 생성.
//
// 공식 기관 도메인으로 제한한 web_search 서버 도구를 붙여, 모델이 최신 공고를 직접
// 확인한 뒤 글을 쓰게 한다. 기관마다 크롤러를 만드는 것보다 견고하고 출처가 함께 남는다.
import '../core/net.js';
import Anthropic from '@anthropic-ai/sdk';
import { config } from '../core/config.js';
import { createLogger } from '../core/logger.js';
import { SYSTEM, userMessage, domainsFor } from './prompt.js';
import { guidelineBlock } from './revise.js';

const log = createLogger('generate');

export const MODEL = 'claude-opus-5';

let client;
const getClient = () => (client ??= new Anthropic());

/** ===SECTION=== 구분자로 나눈 응답을 파싱한다. */
export function parseDraft(text) {
  const section = (name) => {
    const m = text.match(new RegExp(`===${name}===\\s*\\n([\\s\\S]*?)(?=\\n===[A-Z]+===|$)`));
    return m ? m[1].trim() : '';
  };
  const sources = section('SOURCES')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const [url, name] = l.split('|').map((s) => s.trim());
      return { url, name: name ?? '' };
    })
    .filter((s) => /^https?:\/\//.test(s.url));

  return {
    title: section('TITLE'),
    tags: section('TAGS').split(',').map((t) => t.trim()).filter(Boolean),
    summary: section('SUMMARY'),
    html: section('HTML'),
    sources,
  };
}

/**
 * 키워드 하나로 초안을 생성한다.
 * @returns {{title, tags, summary, html, sources, usage, costUsd}}
 */
export async function generateDraft({ keyword, category, type = 'info', today }) {
  const t0 = Date.now();
  const stream = getClient().beta.messages.stream({
    model: MODEL,
    max_tokens: 32000,
    // Opus 5 는 정책 거절 시 폴백 모델로 같은 요청을 이어서 처리한다.
    // 무인 운영이라 한 번의 거절로 파이프라인이 멈추지 않게 켜 둔다.
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    thinking: { type: 'adaptive' },
    output_config: { effort: 'high' },
    // 시스템 프롬프트는 고정이라 캐시가 걸린다. 동적 값은 전부 user 메시지에 있다.
    // 고정 규칙은 캐시하고, 누적 지침은 그 뒤에 붙인다 (지침이 바뀌어도 앞부분 캐시는 유지).
    system: [
      { type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } },
      ...(guidelineBlock() ? [{ type: 'text', text: guidelineBlock() }] : []),
    ],
    tools: [
      {
        type: 'web_search_20260209',
        name: 'web_search',
        // 카테고리에 맞는 도메인만 연다. 검색 횟수도 늘려 사실 확인 범위를 넓혔다.
        max_uses: 14,
        allowed_domains: domainsFor(category),
      },
    ],
    messages: [
      {
        role: 'user',
        content: userMessage({
          keyword, category, type,
          today: today ?? new Date().toLocaleDateString('sv-SE', { timeZone: config.tz }),
          blogName: '리춍의 성장연구소',
        }),
      },
    ],
  });

  const msg = await stream.finalMessage();

  if (msg.stop_reason === 'refusal') {
    throw new Error(`모델이 요청을 거절했습니다 (${msg.stop_details?.category ?? '사유 미상'}): ${keyword}`);
  }
  if (msg.stop_reason === 'max_tokens') {
    log.warn(`출력이 max_tokens 에서 잘렸습니다: ${keyword}`);
  }

  const text = msg.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n');
  const draft = parseDraft(text);

  const searches = msg.content.filter((b) => b.type === 'web_search_tool_result').length;
  const u = msg.usage;
  // Opus 5: 입력 $5 / 출력 $25 per MTok. 캐시 읽기는 약 1/10.
  const costUsd =
    ((u.input_tokens ?? 0) * 5 + (u.cache_creation_input_tokens ?? 0) * 6.25 +
     (u.cache_read_input_tokens ?? 0) * 0.5 + (u.output_tokens ?? 0) * 25) / 1_000_000;

  log.info(
    `초안 생성 완료: ${keyword} · ${draft.html.length}자 · 검색 ${searches}회 · ` +
    `$${costUsd.toFixed(3)} · ${((Date.now() - t0) / 1000).toFixed(0)}초`
  );

  if (!draft.title || !draft.html) {
    throw new Error(`응답 파싱 실패 (구분자 누락). 앞부분: ${text.slice(0, 300)}`);
  }
  return { ...draft, usage: u, costUsd, searches, raw: text };
}
