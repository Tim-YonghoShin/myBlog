// 발행용 스타일링 — 모델 출력(순수 HTML)에 인라인 스타일을 입힌다.
//
// 티스토리는 <style> 블록을 허용하지 않으므로 인라인 style 만 쓸 수 있고, 그래서
// @media 나 html.dark 선택자를 쓸 수 없다. 이 스킨은 다크모드에서 배경이 #212326 이 되므로
// 아래 규칙을 지켜 라이트/다크 양쪽에서 읽히게 만든다.
//
//   1) 본문 글자색은 지정하지 않는다 → 스킨 색을 상속받아 양쪽 모두 정상
//   2) 배경·테두리는 rgba 반투명 → 밝은 배경에선 옅게, 어두운 배경에선 은은하게
//   3) 강조색은 두 배경 모두에서 대비가 나오는 중간 밝기 파랑을 쓴다
//   4) 색을 고정해야 하는 곳(표 헤더)은 배경과 글자를 함께 고정한다

import { PALETTES, DEFAULT_PALETTE } from './palettes.js';

/** 현재 팔레트 (state 로 바꿀 수 있게 함수로 감싼다) */
export const PALETTE = PALETTES[DEFAULT_PALETTE];

/**
 * 팔레트로 스타일 규칙을 만든다.
 * headingColor 가 null 이면 제목은 본문색을 상속한다 (색을 선에만 쓰는 절제된 인상).
 */
function rules(P) {
  const headColor = P.headingColor ? `color:${P.headingColor};` : '';
  return {
    // clamp 로 화면 폭에 맞춰 줄어든다. 고정 크기면 모바일에서 단어가 쪼개진다.
    // 구분선과 글자 간격을 좁혀야 제목이 선에서 "붕 뜬" 느낌이 안 난다.
    h2: `font-size:clamp(21px,5.4vw,29px);line-height:1.32;font-weight:800;${headColor}`
      + `margin:44px 0 16px;padding-top:13px;border-top:3px solid ${P.accent};`
      + `letter-spacing:-0.02em;word-break:keep-all;scroll-margin-top:72px;`,
    h3: `font-size:clamp(17px,4.2vw,20px);line-height:1.45;font-weight:700;${headColor}`
      + `margin:30px 0 10px;word-break:keep-all;scroll-margin-top:72px;`
      + (P.headingColor ? '' : `border-left:3px solid ${P.accent};padding-left:10px;`),
    p:  `font-size:17px;line-height:1.85;margin:0 0 18px;`,
    table: `border-collapse:collapse;width:100%;max-width:100%;margin:0;font-size:15px;`
         + `border:1px solid ${P.border};table-layout:auto;`,
    th: `background:${P.headBg};color:${P.headText};font-weight:700;`
      + `padding:11px 12px;border:1px solid ${P.headBg};text-align:left;word-break:keep-all;`,
    td: `padding:11px 12px;border:1px solid ${P.border};vertical-align:top;line-height:1.65;word-break:keep-all;`,
    blockquote: `margin:24px 0;padding:16px 18px;background:${P.softBg};`
              + `border-left:4px solid ${P.accent};font-size:15px;line-height:1.7;border-radius:0 6px 6px 0;`,
    li: `margin:0 0 9px;line-height:1.8;font-size:17px;`,
    ul: `margin:16px 0 22px;padding-left:22px;`,
  };
}

/** 태그에 style 속성을 주입한다. 이미 style 이 있으면 앞에 덧붙인다. */
function applyStyle(html, tag, style) {
  return html.replace(new RegExp(`<${tag}(\\s[^>]*)?>`, 'gi'), (m, attrs = '') => {
    const a = attrs ?? '';
    if (/\sstyle\s*=/.test(a)) return m.replace(/style\s*=\s*"([^"]*)"/i, (_, v) => `style="${style}${v}"`);
    return `<${tag}${a} style="${style}">`;
  });
}

/** 표에 얼룩무늬(zebra)를 넣어 행 구분을 쉽게 한다. */
function zebraStripe(html, P) {
  return html.replace(/<tbody[^>]*>([\s\S]*?)<\/tbody>/gi, (m, body) => {
    let i = 0;
    const striped = body.replace(/<tr(\s[^>]*)?>/gi, (trm, attrs = '') => {
      const bg = i++ % 2 === 1 ? `background:${P.zebra};` : '';
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
    // max-width:100% + min-width:0 이 없으면 래퍼가 flex 아이템으로서 늘어나
    // 페이지 전체를 가로로 밀어낸다 (제목까지 잘림).
    `<div style="overflow-x:auto;-webkit-overflow-scrolling:touch;margin:22px 0;max-width:100%;min-width:0;">${t}</div>`);

/** 표의 첫 열(라벨)은 줄바꿈되지 않게 고정한다. */
const fixFirstColumn = (html) =>
  html.replace(/<tbody[^>]*>([\s\S]*?)<\/tbody>/gi, (m, body) =>
    m.replace(body, body.replace(/<tr([^>]*)>\s*<td/gi,
      (trm) => trm.replace(/<td/, '<td style="white-space:nowrap;font-weight:600;"'))));

/** 본문 링크는 강조색으로. 스킨 기본 링크색이 다크에서 안 보이는 경우가 있다. */
const styleLinks = (html, P) =>
  html.replace(/<a\s+([^>]*href="https?:[^>]*)>/gi, (m, attrs) =>
    /\sstyle\s*=/.test(attrs) ? m : `<a ${attrs} style="color:${P.accent};font-weight:600;">`);

export function styleHtml(html, paletteName = DEFAULT_PALETTE) {
  const P = PALETTES[paletteName] ?? PALETTES[DEFAULT_PALETTE];
  const S = rules(P);
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
  out = zebraStripe(out, P);
  out = fixFirstColumn(out);
  out = applyStyle(out, 'table', S.table);
  out = wrapTables(out);
  out = styleLinks(out, P);
  return out;
}
