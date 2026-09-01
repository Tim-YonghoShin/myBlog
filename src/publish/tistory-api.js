// 티스토리 관리자 내부 JSON API 래퍼.
// Open API 가 2024-02 종료되어, 관리자 화면이 쓰는 엔드포인트를 세션 쿠키로 직접 호출한다.
import '../core/net.js';
import pw from 'playwright-core';
import { existsSync } from 'node:fs';
import { config } from '../core/config.js';
import { createLogger } from '../core/logger.js';

const { chromium } = pw;
const log = createLogger('tistory');

export async function withSession(fn, { headless = true } = {}) {
  if (!existsSync(config.tistory.sessionPath)) {
    throw new Error('티스토리 세션이 없습니다. npm run session:login 을 먼저 실행하세요.');
  }
  const browser = await chromium.launch({ headless, executablePath: '/usr/bin/google-chrome' });
  const ctx = await browser.newContext({
    storageState: config.tistory.sessionPath,
    locale: 'ko-KR',
    timezoneId: config.tz,
    viewport: { width: 1500, height: 1000 },
  });
  try {
    return await fn(ctx);
  } finally {
    await browser.close();
  }
}

const base = () => config.tistory.blogUrl;

/** 세션 만료를 명확한 오류로 바꿔 준다 (로그인 페이지 HTML 이 돌아오는 경우). */
async function asJson(res, what) {
  const text = await res.text();
  if (!res.ok()) throw new Error(`${what}: HTTP ${res.status()}`);
  try {
    return JSON.parse(text);
  } catch {
    if (/auth\/login|kakao/i.test(text)) throw new Error(`${what}: 세션이 만료되었습니다. npm run session:login 재실행 필요`);
    throw new Error(`${what}: JSON 이 아닌 응답 (${text.slice(0, 120)})`);
  }
}

export const getCategories = (ctx) =>
  ctx.request.get(`${base()}/manage/category.json`).then((r) => asJson(r, '카테고리 조회'));

/**
 * 카테고리 트리를 변경한다.
 * @param {{append?: object[], delete?: number[], update?: object[]}} changes
 *   delete 는 카테고리 id 배열이다 (객체를 보내면 500 이 난다).
 */
export async function putCategories(ctx, changes) {
  const body = {
    rootLabel: '분류 전체보기',
    delete: changes.delete ?? [],
    append: changes.append ?? [],
    update: changes.update ?? changes.append ?? [],
  };
  const res = await ctx.request.put(`${base()}/manage/category.json`, {
    headers: { 'content-type': 'application/json' },
    data: body,
  });
  const json = await asJson(res, '카테고리 저장');
  log.info(`카테고리 저장: 추가 ${body.append.length} / 삭제 ${body.delete.length}`);
  return json;
}

/** append/update 에 넣을 카테고리 객체를 만든다. */
export const newCategory = ({ name, parent = 0, depth = 1, priority = 0, visibility = 20 }) => ({
  id: -1, name, children: [], depth, opened: true, priority, visibility,
  parent, viewChannel: null, entries: 0, categoryInfo: {}, isNew: true, updatedData: true,
});

/** 트리를 평탄화해 이름으로 찾기 쉽게 만든다. */
export function flatten(categories, depth = 1, parent = 0) {
  const out = [];
  for (const c of categories) {
    out.push({ id: c.id, name: c.name, label: c.label, entries: c.entries, priority: c.priority, depth, parent, raw: c });
    if (c.children?.length) out.push(...flatten(c.children, depth + 1, c.id));
  }
  return out;
}

export const findByName = (flat, name) => flat.find((c) => c.name === name);
