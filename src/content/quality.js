// Phase 2-4 — 품질 게이트.
// 모델에게 "쓰지 마시오"라고 지시하는 것만으로는 부족하다. 발행 전에 기계적으로 검사한다.
// 하나라도 error 면 발행하지 않는다.

const OFFICIAL_TLD = /\.(go\.kr|or\.kr|gov\.kr)(\/|$)/;

/**
 * 내용이 없는 상투어. 하나라도 있으면 실패.
 * 친근한 도입("~하게 되죠", "저도 처음엔")은 상투어가 아니므로 막지 않는다.
 * '오늘은' 같은 표현도 뒤에 구체적인 내용이 오면 자연스러우므로 뺐다.
 */
const BANNED_PHRASES = [
  '안녕하세요', '여러분', '알아보겠습니다', '알아볼까요', '살펴보겠습니다',
  '도움이 되셨', '도움이 되길', '그럼 이만', '마무리하겠습니다',
  '이번 시간에는', '포스팅을 준비했', '함께 보시죠',
  '꼭 알아두세요', '놓치지 마세요', '충격적', '놀랍게도', '반드시 확인하세요!',
];

/** 제목이 정보량을 약속하는 형태인지 (검색 클릭률과 직결) */
const TITLE_HOOKS = /총정리|정리|하는 법|하는법|끝내는|완벽|한 번에|한번에|방법/;

/** 법적 리스크 표현. 보험업법·자본시장법. */
const LEGAL_RISK = [
  { re: /(보험|실비|실손)[^.]{0,20}(추천|비교해\s?드리|순위|best|베스트)/i, why: '보험 상품 추천·비교 (보험업법)' },
  { re: /(종목|주식|코인)[^.]{0,15}(추천|매수|매도)\s?(하세요|권합니다|추천합니다)/i, why: '투자 종목 추천 (자본시장법)' },
  { re: /수익률[^.]{0,20}(보장|확정|무조건)/,                                  why: '수익률 단정' },
  { re: /무조건\s?(받을\s?수\s?있|가능합니다|됩니다)/,                          why: '근거 없는 단정' },
];

const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/gu;
const MAX_EMOJI = 3;

/** HTML 에서 순수 텍스트만 뽑는다 (글자 수 계산용). */
export const textOf = (html) =>
  html.replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&[a-z]+;/gi, '')
      .replace(/\s+/g, ' ')
      .trim();

export function checkDraft(draft, { minChars = 1500, maxChars = 4800, minSources = 3 } = {}) {
  const issues = [];
  const add = (level, code, msg) => issues.push({ level, code, msg });

  const html = draft.html ?? '';
  const text = textOf(html);

  // ── 분량
  if (text.length < minChars) add('error', 'too_short', `본문 ${text.length}자 — 최소 ${minChars}자 필요`);
  else if (text.length > maxChars) add('warn', 'too_long', `본문 ${text.length}자 — ${maxChars}자 초과`);

  // ── 구조
  const h2 = (html.match(/<h2/gi) ?? []).length;
  if (h2 < 3) add('error', 'few_headings', `h2 제목 ${h2}개 — 최소 3개 필요`);
  if (!/<table/i.test(html)) add('error', 'no_table', '표가 없습니다 (「한눈에 보기」 필수)');
  if (!/<(ul|ol)/i.test(html)) add('warn', 'no_list', '목록이 없습니다');
  if (!/<blockquote/i.test(html)) add('warn', 'no_notice', '기준일 안내(blockquote)가 없습니다');

  // ── 출처
  const sources = draft.sources ?? [];
  const official = sources.filter((s) => OFFICIAL_TLD.test(s.url));
  if (sources.length < minSources) add('error', 'few_sources', `출처 ${sources.length}개 — 최소 ${minSources}개 필요`);
  if (!official.length) add('error', 'no_official_source', '공식 기관(go.kr/or.kr) 출처가 없습니다');
  // 본문에 실제 링크가 박혀 있는지 — 메타데이터에만 있고 본문에 없으면 독자에게는 출처가 없는 것과 같다
  const bodyLinks = (html.match(/<a\s+href="https?:/gi) ?? []).length;
  if (bodyLinks === 0) add('error', 'no_body_link', '본문에 출처 링크가 하나도 없습니다');

  // ── 금지 표현
  const hits = BANNED_PHRASES.filter((p) => text.includes(p));
  if (hits.length) add('error', 'banned_phrase', `상투어 발견: ${hits.join(', ')}`);
  const emojiCount = (text.match(EMOJI) ?? []).length;
  if (emojiCount > MAX_EMOJI) add('error', 'emoji', `이모지 ${emojiCount}개 — ${MAX_EMOJI}개까지만 허용`);

  // ── 법적 리스크
  for (const { re, why } of LEGAL_RISK) if (re.test(text)) add('error', 'legal_risk', `${why}`);

  // ── 안전성
  if (/<script|<style|javascript:|onerror=|onclick=/i.test(html)) add('error', 'unsafe_html', '허용되지 않는 HTML');
  if (/<h1[\s>]/i.test(html)) add('warn', 'h1_used', 'h1 은 티스토리가 제목에 씁니다');

  // ── 문체 — 해요체가 기본이어야 한다 (보고서 말투는 블로그에서 겉돈다)
  const politeHae = (text.match(/(?:해요|어요|아요|더라고요|볼게요|드릴게요|거예요|예요|이에요)[.!?\s]/g) ?? []).length;
  const formal = (text.match(/(?:합니다|입니다|습니다|하십시오)[.!?\s]/g) ?? []).length;
  if (formal > 0 && politeHae / (politeHae + formal) < 0.35) {
    add('warn', 'tone_formal', `딱딱한 말투 비중이 높습니다 (해요체 ${politeHae} / 합니다체 ${formal})`);
  }

  // ── 메타
  if (!draft.title) add('error', 'no_title', '제목이 없습니다');
  else {
    if (draft.title.length > 40) add('warn', 'long_title', `제목 ${draft.title.length}자 — 검색결과에서 잘립니다`);
    if (!TITLE_HOOKS.test(draft.title)) add('warn', 'title_weak', '제목에 정보량을 약속하는 표현(총정리·~하는 법 등)이 없습니다');
  }
  if ((draft.tags ?? []).length < 3) add('warn', 'few_tags', `태그 ${(draft.tags ?? []).length}개 — 5개 이상 권장`);

  // ── 반복 문장 (분량 채우기 탐지)
  const sentences = text.split(/[.!?]\s+/).map((s) => s.trim()).filter((s) => s.length > 25);
  const dupes = sentences.length - new Set(sentences).size;
  if (dupes > 0) add('warn', 'repeated', `중복 문장 ${dupes}개`);

  const errors = issues.filter((i) => i.level === 'error');
  const warns = issues.filter((i) => i.level === 'warn');
  // 100점에서 오류 20점, 경고 5점씩 차감
  const score = Math.max(0, 100 - errors.length * 20 - warns.length * 5);

  return {
    pass: errors.length === 0,
    score,
    chars: text.length,
    headings: h2,
    sources: sources.length,
    officialSources: official.length,
    issues, errors, warns,
  };
}

export const formatReport = (r) => {
  const lines = [`품질 ${r.score}점 · ${r.pass ? '통과' : '실패'} · 본문 ${r.chars}자 · 제목 ${r.headings}개 · 출처 ${r.sources}개(공식 ${r.officialSources})`];
  for (const i of r.issues) lines.push(`  ${i.level === 'error' ? '✖' : '△'} ${i.msg}`);
  return lines.join('\n');
};
