// 발행용 본문 완성 — 요약 카드 + 스타일링 + 출처를 코드가 결정적으로 붙인다.
//
// 모델은 구조(제목·표·목록)만 만들고, 외형과 출처 블록은 여기서 통일한다.
// 모델 출력에 맡기면 글마다 스타일이 달라지고, 실제로 출처를 본문에 안 넣는 사고도 났다.
import { styleHtml } from './style.js';
import { PALETTES, DEFAULT_PALETTE } from './palettes.js';
import { summaryCard, extractTablePairs } from './svg-card.js';

const esc = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const hasSourceBlock = (html) => /출처|참고\s*자료/.test(html) && /<a\s+href="https?:/i.test(html);
/** 이미 요약 카드가 붙어 있는지 (재실행 시 중복 방지) */
const hasCard = (html) => /<svg[^>]*aria-label="[^"]*요약"/.test(html);
/** 이미 스타일이 입혀졌는지 — 우리 서명 값으로 판단한다 */
const isStyled = (html) => /border-top:3px solid #[0-9a-f]{6}/i.test(html);

export function renderSources(sources = [], { today, palette = DEFAULT_PALETTE } = {}) {
  const PALETTE = PALETTES[palette] ?? PALETTES[DEFAULT_PALETTE];
  const items = (sources ?? [])
    .filter((s) => /^https?:\/\//.test(s.url ?? ''))
    .map((s) => `<li><a href="${esc(s.url)}" target="_blank" rel="noopener nofollow" style="color:${PALETTE.accent};">${esc(s.name || s.url)}</a></li>`)
    .join('\n');
  if (!items) return '';
  return [
    '',
    '<h2>출처</h2>',
    `<p>아래 기관의 공식 자료를 근거로 작성했습니다. 조회일 ${esc(today)} 기준이며, 제도는 변경될 수 있으므로 신청 전 원문을 확인하시기 바랍니다.</p>`,
    '<ul>', items, '</ul>',
  ].join('\n');
}

/**
 * 발행 직전 본문을 완성한다.
 *  1) 첫 표에서 요약 카드(SVG)를 만들어 맨 앞에 넣는다
 *  2) 출처 블록을 붙인다
 *  3) 전체에 인라인 스타일을 입힌다 (티스토리는 <style> 을 허용하지 않는다)
 */
export function finalizeHtml(draft, { today, blogName = '', palette = DEFAULT_PALETTE } = {}) {
  let html = (draft.html ?? '').trim();

  // 각 단계는 이미 적용됐는지 확인하고 건너뛴다.
  // 스타일 변경 후 재렌더할 때 카드가 두 번 붙고 style 이 중첩되는 사고가 있었다.
  if (!hasSourceBlock(html)) html += '\n' + renderSources(draft.sources, { today, palette });
  if (!isStyled(html)) html = styleHtml(html, palette);

  if (hasCard(html)) return html;

  // 카드는 스타일링 후에 앞에 붙인다 (styleHtml 이 SVG 내부를 건드리지 않게)
  const pairs = extractTablePairs(draft.html ?? '');
  const card = summaryCard({ title: draft.title, pairs, today, blogName, palette });
  return (card ? card + '\n' : '') + html;
}
