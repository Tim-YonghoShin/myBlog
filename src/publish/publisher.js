// Phase 3-2 — 티스토리 발행 모듈.
//
// 관리자 내부 API 를 세션 쿠키로 직접 호출한다. 브라우저 에디터를 조작하지 않으므로
// UI 변경에 영향을 덜 받는다. 발견된 엔드포인트:
//   POST   /manage/post.json        글 생성 (id:"0")
//   PUT    /manage/post/{id}.json    글 수정 — 생성과 엔드포인트가 다르다.
//                                    POST 에 id 를 넣으면 수정이 아니라 새 글이 만들어진다.
//   DELETE /manage/post/{id}.json   글 삭제
//   GET    /manage/posts.json       글 목록
import { withSession, getCategories, flatten } from './tistory-api.js';
import { db, getState } from '../core/db.js';
import { config } from '../core/config.js';
import { createLogger } from '../core/logger.js';

const log = createLogger('publisher');

export const VISIBILITY = { private: 0, protected: 15, public: 20 };

/** 캐시된 카테고리 id 를 쓰고, 없으면 티스토리에서 다시 읽어온다. */
export async function categoryId(ctx, name) {
  const cached = JSON.parse(getState('category_map', '{}'));
  if (cached[name]) return cached[name];
  const flat = flatten((await getCategories(ctx)).categories);
  const hit = flat.find((c) => c.name === name);
  if (!hit) throw new Error(`티스토리에 '${name}' 카테고리가 없습니다. npm run categories:sync 를 실행하세요.`);
  return hit.id;
}

/** 제목에서 URL 슬러그를 만든다. 티스토리는 한글 슬러그도 허용한다. */
export const toSlogan = (title) =>
  title.trim()
    .replace(/[\[\]()<>{}"'`.,!?:;/\\|@#$%^&*=+~]/g, '')
    .replace(/\s+/g, '-')
    .slice(0, 80);

/**
 * 글을 발행한다.
 * @param {object} p
 * @param {string} p.title
 * @param {string} p.html            본문 HTML
 * @param {string} p.category        티스토리 카테고리 이름
 * @param {string[]} [p.tags]
 * @param {'public'|'protected'|'private'} [p.visibility='public']
 * @param {Date} [p.publishAt]       미래 시각이면 예약 발행
 * @param {number|string} [p.postId] 기존 글 수정 시 지정
 */
export async function publish(p, { ctx } = {}) {
  const run = async (ctx) => {
    const catId = await categoryId(ctx, p.category);
    const published = p.publishAt ? Math.floor(p.publishAt.getTime() / 1000) : 1;
    const body = {
      id: String(p.postId ?? '0'),
      title: p.title,
      content: p.html,
      slogan: p.slogan ?? toSlogan(p.title),
      visibility: VISIBILITY[p.visibility ?? 'public'],
      category: catId,
      tag: (p.tags ?? []).join(','),
      published,
      uselessMarginForEntry: 1,
      cclCommercial: 0,
      cclDerive: 0,
      type: 'post',
      attachments: [],
      recaptchaValue: '',
      draftSequence: null,
      // 사람이 쓴 것과 비슷한 값을 넣는다. 0 이면 비정상으로 보일 수 있다.
      totalWritingTimeMs: p.writingTimeMs ?? 900_000,
    };
    // 수정과 생성은 엔드포인트가 다르다. POST 에 id 를 실어도 새 글이 생긴다.
    const isUpdate = p.postId && String(p.postId) !== '0';
    const url = isUpdate
      ? `${config.tistory.blogUrl}/manage/post/${p.postId}.json`
      : `${config.tistory.blogUrl}/manage/post.json`;
    const res = await ctx.request.fetch(url, {
      method: isUpdate ? 'PUT' : 'POST',
      headers: { 'content-type': 'application/json' },
      data: body,
    });
    const text = await res.text();
    if (!res.ok()) throw new Error(`발행 실패 HTTP ${res.status()}: ${text.slice(0, 200)}`);
    let json;
    try { json = JSON.parse(text); } catch { throw new Error(`발행 응답 파싱 실패: ${text.slice(0, 200)}`); }
    // 수정 응답에는 entryUrl 이 없을 수 있다.
    const entryUrl = json.entryUrl ?? (isUpdate ? `${config.tistory.blogUrl}/${p.postId}` : null);
    if (!entryUrl) throw new Error(`발행 응답에 entryUrl 이 없습니다: ${text.slice(0, 200)}`);

    const id = String(entryUrl).split('/').pop();
    log.info(`${isUpdate ? '수정' : '발행'} 완료: ${entryUrl} (${p.category}, ${p.visibility ?? 'public'})`);
    return { url: entryUrl, id, updated: isUpdate };
  };
  return ctx ? run(ctx) : withSession(run);
}

export async function remove(postId, { ctx } = {}) {
  const run = async (ctx) => {
    const res = await ctx.request.delete(`${config.tistory.blogUrl}/manage/post/${postId}.json`);
    if (!res.ok()) throw new Error(`삭제 실패 HTTP ${res.status()}`);
    log.info(`글 삭제: ${postId}`);
    return true;
  };
  return ctx ? run(ctx) : withSession(run);
}

export async function list({ page = 1, count = 30 } = {}, { ctx } = {}) {
  const run = async (ctx) => {
    const res = await ctx.request.get(`${config.tistory.blogUrl}/manage/posts.json?page=${page}&count=${count}`);
    const j = await res.json();
    return (j.items ?? j.posts ?? []).map((it) => ({
      id: it.id, title: it.title, visibility: it.visibility,
      category: it.categoryLabel ?? it.category ?? null, date: it.date ?? null, url: it.url ?? null,
    }));
  };
  return ctx ? run(ctx) : withSession(run);
}

/** 발행 결과를 posts 테이블에 반영한다. */
export function recordPublished(postRowId, { url, id }) {
  db.prepare(`
    UPDATE posts SET status='published', url=?, tistory_id=?,
      published_at=datetime('now'), updated_at=datetime('now')
    WHERE id=?
  `).run(url, String(id), postRowId);
}
