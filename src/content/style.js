// 발행용 스타일링 — 모델 출력(순수 HTML)에 인라인 스타일을 입힌다.
//
// 티스토리는 <style> 블록을 허용하지 않지만 인라인 style, 인라인 SVG, data URI 는 보존한다(검증 완료).
// 모델에게 스타일까지 맡기면 글마다 달라지므로, 구조만 생성시키고 외형은 코드가 결정한다.

export const PALETTE = {
  accent:    '#1a56db',
  accentDark:'#1e3a8a',
  headBg:    '#1e40af',
  headText:  '#ffffff',
  zebra:     '#f1f5f9',
  border:    '#dbe2ea',
  text:      '#1f2937',
  muted:     '#5b6472',
  noticeBg:  '#f8fafc',
};

const S = {
  // 대제목과 소제목의 크기 차이를 크게 벌린다 (30px vs 20px)
  h2: `font-size:30px;line-height:1.35;font-weight:800;color:${PALETTE.accentDark};`
    + `margin:56px 0 20px;padding-top:22px;border-top:3px solid ${PALETTE.accent};letter-spacing:-0.02em;`,
  h3: `font-size:20px;line-height:1.45;font-weight:700;color:${PALETTE.accent};margin:34px 0 12px;`,
  p:  `font-size:17px;line-height:1.85;color:${PALETTE.text};margin:0 0 18px;`,
  // min-width 는 쓰지 않는다. 이 스킨은 본문이 flex 아이템이라 표에 min-width 를 주면
  // 래퍼가 그만큼 늘어나 페이지 전체(제목 포함)가 가로로 밀린다.
  // 라벨이 "과세/기준/일" 처럼 쪼개지는 문제는 첫 열 nowrap 으로만 해결한다.
  table: `border-collapse:collapse;width:100%;max-width:100%;margin:0;font-size:15px;`
       + `border:1px solid ${PALETTE.border};table-layout:auto;`,
  // word-break:keep-all 은 한국어를 단어 중간에서 끊지 않는다
  th: `background:${PALETTE.headBg};color:${PALETTE.headText};font-weight:700;`
    + `padding:11px 12px;border:1px solid ${PALETTE.headBg};text-align:left;word-break:keep-all;`,
  td: `padding:11px 12px;border:1px solid ${PALETTE.border};vertical-align:top;line-height:1.65;word-break:keep-all;`,
  blockquote: `margin:24px 0;padding:16px 18px;background:${PALETTE.noticeBg};`
            + `border-left:4px solid ${PALETTE.accent};color:${PALETTE.muted};font-size:15px;line-height:1.7;border-radius:0 6px 6px 0;`,
  li: `margin:0 0 9px;line-height:1.8;font-size:17px;color:${PALETTE.text};`,
  ul: `margin:16px 0 22px;padding-left:22px;`,
};

/** 태그에 style 속성을 주입한다. 이미 style 이 있으면 앞에 덧붙인다. */
function applyStyle(html, tag, style) {
  return html.replace(new RegExp(`<${tag}(\\s[^>]*)?>`, 'gi'), (m, attrs = '') => {
    const a = attrs ?? '';
    if (/\sstyle\s*=/.test(a)) return m.replace(/style\s*=\s*"([^"]*)"/i, (_, v) => `style="${style}${v}"`);
    return `<${tag}${a} style="${style}">`;
  });
}

/** 표에 얼룩무늬(zebra)를 넣어 행 구분을 쉽게 한다. */
function zebraStripe(html) {
  return html.replace(/<tbody[^>]*>([\s\S]*?)<\/tbody>/gi, (m, body) => {
    let i = 0;
    const striped = body.replace(/<tr(\s[^>]*)?>/gi, (trm, attrs = '') => {
      const bg = i++ % 2 === 1 ? `background:${PALETTE.zebra};` : '';
      if (!bg) return trm;
      const a = attrs ?? '';
      if (/\sstyle\s*=/.test(a)) return trm.replace(/style\s*=\s*"([^"]*)"/i, (_, v) => `style="${bg}${v}"`);
      return `<tr${a} style="${bg}">`;
    });
    return m.replace(body, striped);
  });
}

/** 표를 좁은 화면에서 가로 스크롤되게 감싼다 (모바일 대응). */
const wrapTables = (html) =>
  html.replace(/<table[\s\S]*?<\/table>/gi, (t) =>
    // max-width:100% + min-width:0 이 없으면 래퍼가 flex 아이템으로서 표의 min-width 만큼
    // 늘어나 페이지 전체를 가로로 밀어낸다 (제목까지 잘림).
    `<div style="overflow-x:auto;-webkit-overflow-scrolling:touch;margin:22px 0;max-width:100%;min-width:0;">${t}</div>`);

/** 표의 첫 열(라벨)은 줄바꿈되지 않게 고정폭을 준다. */
const fixFirstColumn = (html) =>
  html.replace(/<tbody[^>]*>([\s\S]*?)<\/tbody>/gi, (m, body) =>
    m.replace(body, body.replace(/<tr([^>]*)>\s*<td/gi,
      (trm, a) => trm.replace(/<td/, '<td style="white-space:nowrap;font-weight:600;"'))));

export function styleHtml(html) {
  let out = html;
  out = applyStyle(out, 'h2', S.h2);
  out = applyStyle(out, 'h3', S.h3);
  out = applyStyle(out, 'p', S.p);
  out = applyStyle(out, 'blockquote', S.blockquote);
  out = applyStyle(out, 'ul', S.ul);
  out = applyStyle(out, 'ol', S.ul);
  out = applyStyle(out, 'li', S.li);
  out = applyStyle(out, 'th', S.th);
  out = applyStyle(out, 'td', S.td);
  out = zebraStripe(out);
  out = fixFirstColumn(out);
  out = applyStyle(out, 'table', S.table);
  out = wrapTables(out);
  return out;
}
