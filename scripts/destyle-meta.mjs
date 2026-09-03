#!/usr/bin/env node
// 메타 파일(draft_path)에 저장된 HTML 에서 발행용 장식을 벗겨 모델 원본 상태로 되돌린다.
//
// 초기 버그로 일부 글의 메타에 '완성본'이 저장됐다. 그대로 재렌더하면 옛 스타일이
// 남은 채 새 스타일이 덧씌워진다. 원본만 남겨야 재렌더가 항상 최신 규칙을 따른다.
import { readFileSync, writeFileSync } from 'node:fs';
import { db } from '../src/core/db.js';

/** 발행 단계에서 코드가 붙인 것들을 제거한다. */
export function destyle(html) {
  let h = html;
  // 1) 요약 카드 (인라인 SVG 블록)
  h = h.replace(/<p[^>]*>\s*<svg[\s\S]*?<\/svg>\s*<\/p>\s*/gi, '');
  // 2) 표 가로 스크롤 래퍼 벗기기
  h = h.replace(/<div style="overflow-x:auto[^"]*">([\s\S]*?)<\/div>/gi, '$1');
  // 3) 모든 인라인 style 속성 제거
  h = h.replace(/\s+style="[^"]*"/gi, '');
  // 4) 링크에 붙인 target/rel 도 정리 (렌더 단계에서 다시 붙는다)
  h = h.replace(/\s+(target|rel)="[^"]*"/gi, '');
  return h.replace(/\n{3,}/g, '\n\n').trim();
}

if (process.argv[1]?.endsWith('destyle-meta.mjs')) {
  let changed = 0;
  for (const p of db.prepare('SELECT * FROM posts').all()) {
    if (!p.draft_path) continue;
    const meta = JSON.parse(readFileSync(p.draft_path, 'utf8'));
    const before = meta.html ?? '';
    const after = destyle(before);
    if (after === before) { console.log(`  이미 원본: ${p.title}`); continue; }
    meta.html = after;
    writeFileSync(p.draft_path, JSON.stringify(meta, null, 2));
    console.log(`  정리: ${p.title} — ${before.length} → ${after.length} bytes`);
    changed++;
  }
  console.log(`\n${changed}편 정리 완료`);
}
