// Phase 2 통합 — 글감 선정 → 초안 생성 → 품질 검사 → 저장 → 승인 요청.
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { db, migrate, trackRun, getState } from '../core/db.js';
import { config } from '../core/config.js';
import { createLogger } from '../core/logger.js';
import { KEYWORD_TO_TISTORY } from '../core/categories.js';
import { pickNext, markQueued } from './selector.js';
import { generateDraft } from './generate.js';
import { checkDraft, formatReport } from './quality.js';
import { requestApproval } from './approve.js';
import { finalizeHtml } from './render.js';

const log = createLogger('pipeline');
migrate();

/** 초안 한 편을 만들어 DB·파일에 저장하고 승인 요청까지 보낸다. */
export async function createDraft({ keyword, category, type = 'info', notify = true } = {}) {
  // 키워드가 지정되지 않으면 선정기가 고른다
  if (!keyword) {
    const [pick] = pickNext(1);
    if (!pick) throw new Error('발행 가능한 글감이 없습니다. 글감 풀을 확인하세요.');
    keyword = pick.keyword;
    category = pick.tistoryCat;
    type = pick.intent === '리뷰' ? 'review' : pick.intent === '비교' ? 'compare' : 'info';
  }
  category ??= KEYWORD_TO_TISTORY[
    db.prepare('SELECT category FROM keywords WHERE keyword=?').get(keyword)?.category
  ];
  if (!category) throw new Error(`'${keyword}' 의 카테고리를 결정할 수 없습니다.`);

  log.info(`초안 생성 시작: ${keyword} (${category}, ${type})`);
  const today = new Date().toLocaleDateString('sv-SE', { timeZone: config.tz });
  const generated = await generateDraft({ keyword, category, type, today });
  // 출처 블록은 코드가 붙인다. 모델 출력에 의존하지 않는다.
  const draft = { ...generated, html: finalizeHtml(generated, { today, blogName: '리춍의 성장연구소' }) };
  const quality = checkDraft(draft);
  log.info(`\n${formatReport(quality)}`);

  // 파일로 보존 — 발행 실패해도 결과물이 남는다
  mkdirSync(config.paths.drafts, { recursive: true });
  const stamp = new Date().toLocaleDateString('sv-SE', { timeZone: config.tz });
  const slug = keyword.replace(/[\/\\:*?"<>|]/g, '').replace(/\s+/g, '-');
  const htmlPath = join(config.paths.drafts, `${stamp}-${slug}.html`);
  writeFileSync(htmlPath, draft.html);
  const metaPath = join(config.paths.drafts, `${stamp}-${slug}.json`);
  // 메타에는 **모델 원본** HTML 을 남긴다. 완성본은 html_path 에만 둔다.
  // 여기에 완성본을 저장하면 재렌더 시 카드·스타일이 중복 적용된다.
  writeFileSync(metaPath, JSON.stringify(
    { ...draft, html: generated.html, finalizedLength: draft.html.length, raw: undefined, quality }, null, 2));

  const status = quality.pass ? 'review' : 'draft';
  const { lastInsertRowid: postId } = db.prepare(`
    INSERT INTO posts (keyword, title, category, type, status, draft_path, html_path,
                       word_count, source_count, quality_score)
    VALUES (?,?,?,?,?,?,?,?,?,?)
  `).run(keyword, draft.title, category, type, status, metaPath, htmlPath,
         quality.chars, quality.sources, quality.score);

  markQueued(keyword);

  if (!quality.pass) {
    log.warn(`품질 미달로 승인 요청을 보내지 않습니다: ${keyword}`);
    if (notify) {
      const { send, esc } = await import('../telegram/client.js');
      await send(
        `⚠️ <b>품질 게이트 실패</b>\n\n<b>${esc(draft.title)}</b>\n키워드: ${esc(keyword)}\n\n` +
        quality.errors.map((e) => `✖ ${esc(e.msg)}`).join('\n') +
        `\n\n초안은 보존했습니다. <code>/retry ${esc(keyword)}</code> 로 재생성할 수 있습니다.`
      );
    }
    return { postId, draft, quality, approved: false };
  }

  if (notify) await requestApproval({ postId, draft, quality });
  return { postId, draft, quality };
}

/** 스케줄러가 호출하는 진입점. 일시정지 상태를 존중한다. */
export const runDraftJob = () =>
  trackRun('create_draft', async () => {
    if (getState('paused') === '1') { log.info('일시정지 상태 — 건너뜁니다'); return 'paused'; }
    const { postId, draft } = await createDraft({});
    return `post=${postId} "${draft.title}"`;
  });

if (process.argv[1]?.endsWith('pipeline.js')) {
  const keyword = process.argv.slice(2).find((a) => !a.startsWith('-'));
  createDraft({ keyword, notify: !process.argv.includes('--no-notify') })
    .then((r) => { console.log(`\n완료: post #${r.postId} · ${r.draft.title}`); process.exit(0); })
    .catch((e) => { console.error(`실패: ${e.message}`); process.exit(1); });
}
