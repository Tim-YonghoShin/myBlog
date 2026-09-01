// 글의 「한눈에 보기」 표 데이터로 요약 카드를 만든다.
//
// 스톡 이미지는 저작권·적합성 문제가 있고 글과 무관하다. 대신 글이 실제로 담은 수치를
// 카드로 만들면 내용과 100% 일치하고, 저작권 문제가 없으며, 공유 시 썸네일로도 쓰인다.
// 티스토리가 인라인 SVG 를 보존하는 것을 확인해 업로드 없이 삽입한다.
import { PALETTE } from './style.js';

const esc = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/** 한글은 라틴 문자의 약 2배 폭을 차지한다. */
const visualWidth = (s) =>
  [...String(s)].reduce((w, ch) => w + (/[ᄀ-ᇿ가-힯㄰-㆏一-鿿]/.test(ch) ? 1 : 0.52), 0);

/** 주어진 폭(글자 단위)에 맞춰 줄바꿈한다. */
function wrap(text, maxUnits, maxLines) {
  const words = String(text).split(/\s+/).filter(Boolean);
  const lines = [];
  let cur = '';
  for (const w of words) {
    const cand = cur ? `${cur} ${w}` : w;
    if (visualWidth(cand) > maxUnits && cur) { lines.push(cur); cur = w; }
    else cur = cand;
    if (lines.length === maxLines) break;
  }
  if (cur && lines.length < maxLines) lines.push(cur);
  if (lines.length === maxLines) {
    const last = lines[maxLines - 1];
    if (visualWidth(last) > maxUnits) lines[maxLines - 1] = last.slice(0, Math.floor(maxUnits)) + '…';
  }
  return lines;
}

/** HTML 의 첫 번째 표에서 라벨/값 쌍을 뽑는다. */
export function extractTablePairs(html, limit = 4) {
  const table = html.match(/<table[\s\S]*?<\/table>/i)?.[0];
  if (!table) return [];
  const rows = [...table.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)].map((m) => m[1]);
  const pairs = [];
  for (const row of rows) {
    const cells = [...row.matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/gi)]
      .map((m) => m[1].replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim());
    if (cells.length < 2 || !cells[0] || !cells[1]) continue;
    // 헤더 행(항목/내용 같은 라벨)은 건너뛴다
    if (/^(항목|구분|내용|区分)$/.test(cells[0])) continue;
    pairs.push({ label: cells[0], value: cells[1] });
    if (pairs.length >= limit) break;
  }
  return pairs;
}

const FONT = "'Pretendard','Apple SD Gothic Neo','Malgun Gothic','Noto Sans KR',sans-serif";

/**
 * 요약 카드 SVG 를 만든다. viewBox 기반이라 폭에 맞춰 자동으로 늘어난다.
 */
export function summaryCard({ title, pairs, today, blogName = '' }) {
  if (!pairs?.length) return '';
  const W = 860, PAD = 36;
  const LABEL_W = 190;                       // 라벨 열 폭(px)
  const VALUE_X = PAD + LABEL_W;
  const VALUE_FS = 18;
  const VALUE_UNITS = (W - VALUE_X - PAD) / VALUE_FS;   // 값 열에 들어가는 글자 수

  // ── 헤더: 아이브로우 → 제목 순서 (겹치지 않게 위아래로 배치)
  const titleLines = wrap(title, 25, 2);
  const TITLE_FS = 30, TITLE_LH = 40;
  const headH = 30 + 22 + titleLines.length * TITLE_LH + 22;
  const eyebrowY = 40;
  const titleY0 = eyebrowY + 40;

  // ── 본문: 값이 길면 두 줄까지 허용하고 행 높이를 늘린다
  const LINE_H = 27;
  const laid = pairs.map((p) => {
    const valueLines = wrap(p.value, VALUE_UNITS, 2);
    return { label: wrap(p.label, 10, 1)[0] ?? '', valueLines, h: 26 + valueLines.length * LINE_H };
  });
  const bodyH = laid.reduce((a, r) => a + r.h, 0);
  const footH = 46;
  const H = headH + bodyH + footH;

  let y = headH;
  const rows = laid.map((r, i) => {
    const top = y; y += r.h;
    const bg = i % 2 === 1 ? `<rect x="0" y="${top}" width="${W}" height="${r.h}" fill="${PALETTE.zebra}"/>` : '';
    const values = r.valueLines.map((l, j) =>
      `<text x="${VALUE_X}" y="${top + 30 + j * LINE_H}" font-family="${FONT}" font-size="${VALUE_FS}" fill="${PALETTE.text}">${esc(l)}</text>`
    ).join('\n    ');
    return `${bg}
    <text x="${PAD}" y="${top + 30}" font-family="${FONT}" font-size="17" font-weight="700" fill="${PALETTE.muted}">${esc(r.label)}</text>
    ${values}
    <line x1="0" y1="${top + r.h}" x2="${W}" y2="${top + r.h}" stroke="${PALETTE.border}" stroke-width="1"/>`;
  }).join('\n');

  const titleTspans = titleLines.map((l, i) =>
    `<text x="${PAD}" y="${titleY0 + i * TITLE_LH}" font-family="${FONT}" font-size="${TITLE_FS}" font-weight="800" fill="#ffffff">${esc(l)}</text>`
  ).join('\n  ');

  return `<p style="margin:8px 0 30px;max-width:100%;min-width:0;overflow:hidden;"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="${esc(title)} 요약" style="display:block;width:100%;max-width:100%;height:auto;border-radius:10px;border:1px solid ${PALETTE.border};">
  <rect width="${W}" height="${H}" fill="#ffffff"/>
  <rect width="${W}" height="${headH}" fill="${PALETTE.headBg}"/>
  <text x="${PAD}" y="${eyebrowY}" font-family="${FONT}" font-size="14" font-weight="600" letter-spacing="2" fill="#a5b4fc">한눈에 보기</text>
  ${titleTspans}
  ${rows}
  <text x="${PAD}" y="${H - 16}" font-family="${FONT}" font-size="13" fill="${PALETTE.muted}">기준일 ${esc(today)}${blogName ? ` · ${esc(blogName)}` : ''}</text>
</svg></p>`;
}
