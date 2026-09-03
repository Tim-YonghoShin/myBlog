// 발행된 글 수정 + 지속 지침(guideline) 관리.
//
// 사용자가 텔레그램으로 준 피드백을 두 갈래로 처리한다.
//   1) 이 글만 고쳐 → revisePost: 본문을 고쳐 티스토리에 PUT 반영
//   2) 앞으로 다 이렇게 해 → guideline: 프롬프트에 영구 주입
import '../core/net.js';
import Anthropic from '@anthropic-ai/sdk';
import { readFileSync, writeFileSync } from 'node:fs';
import { db, getState, setState } from '../core/db.js';
import { config } from '../core/config.js';
import { createLogger } from '../core/logger.js';
import { checkDraft, formatReport } from './quality.js';
import { SYSTEM } from './prompt.js';
import { finalizeHtml } from './render.js';
import { publish } from '../publish/publisher.js';

const log = createLogger('revise');
let client;
const getClient = () => (client ??= new Anthropic());

// ── 지속 지침 ───────────────────────────────────────────────
export const getGuidelines = () => {
  try { return JSON.parse(getState('guidelines', '[]')); } catch { return []; }
};

export function addGuideline(text) {
  const list = getGuidelines();
  const t = String(text).trim();
  if (!t) return list;
  if (list.some((g) => g.text === t)) return list;
  list.push({ text: t, added_at: new Date().toISOString().slice(0, 10) });
  setState('guidelines', JSON.stringify(list));
  log.info(`지침 추가: ${t.slice(0, 60)}`);
  return list;
}

export function removeGuideline(index) {
  const list = getGuidelines();
  if (index < 0 || index >= list.length) return null;
  const [removed] = list.splice(index, 1);
  setState('guidelines', JSON.stringify(list));
  return removed;
}

/** 생성 프롬프트에 덧붙일 지침 블록. 없으면 빈 문자열. */
export function guidelineBlock() {
  const list = getGuidelines();
  if (!list.length) return '';
  return `\n\n## 블로그 주인이 준 추가 지침\n\n아래는 이 블로그에 누적된 요구사항입니다. 위 규칙과 충돌하면 아래를 우선하시오.\n\n`
       + list.map((g, i) => `${i + 1}. ${g.text}`).join('\n');
}

// ── 글 수정 ─────────────────────────────────────────────────
const REVISE_SYSTEM = `당신은 이미 발행된 블로그 글을 고치는 편집자입니다.

- 요청받은 부분만 고치시오. 나머지는 내용을 그대로 유지하시오.
- **사실·수치를 새로 지어내지 마시오.** 날짜·금액·자격 조건·URL 은 원문 그대로 두시오.
  문체를 바꾸더라도 숫자는 한 글자도 바뀌면 안 됩니다.
- HTML 구조(h2/h3/table/ul/blockquote/strong)를 유지하시오. style 속성은 넣지 마시오.
  (외형은 발행 단계에서 코드가 일괄 적용합니다)
- 상투어("안녕하세요", "여러분", "알아보겠습니다", "도움이 되셨길")를 넣지 마시오.
- 이모지는 글 전체에서 최대 2개. 표 안에는 넣지 마시오.

## 출력 형식

제목도 함께 고쳐야 하면 아래 두 구분자를 모두 쓰고, 본문만 고칠 때는 ===HTML=== 만 쓰시오.

===TITLE===
(새 제목)
===HTML===
(수정된 본문 HTML)`;

/**
 * 발행된(또는 대기 중인) 글을 지시대로 고치고 티스토리에 반영한다.
 * @param {number} postId  posts.id
 * @param {string} instruction 사용자가 준 수정 지시
 * @param {{allowTitle?: boolean}} [opts] 제목 변경 허용 여부
 */
export async function revisePost(postId, instruction, opts = {}) {
  const post = db.prepare('SELECT * FROM posts WHERE id=?').get(postId);
  if (!post) throw new Error(`글 #${postId} 을 찾을 수 없습니다.`);

  const meta = JSON.parse(readFileSync(post.draft_path, 'utf8'));
  const original = meta.html;   // 모델 원본 (스타일 미적용)

  // max_tokens 가 크면 SDK 가 비스트리밍을 거부한다 (10분 타임아웃 위험). 스트리밍으로 받는다.
  const res = await getClient().messages.stream({
    model: 'claude-opus-5',
    max_tokens: 24000,
    system: [{ type: 'text', text: REVISE_SYSTEM, cache_control: { type: 'ephemeral' } }],
    thinking: { type: 'adaptive' },
    output_config: { effort: 'high' },
    messages: [{
      role: 'user',
      content: `제목: ${post.title}\n\n수정 지시: ${instruction}\n`
             + (opts.allowTitle ? '\n제목도 함께 다듬어도 됩니다. 바꾸려면 ===TITLE=== 을 포함하시오.\n' : '')
             + `\n--- 현재 본문 HTML ---\n${original}`,
    }],
  }).finalMessage();

  if (res.stop_reason === 'refusal') throw new Error('모델이 수정을 거절했습니다.');
  const raw = res.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();

  const titleMatch = raw.match(/===TITLE===\s*\n([\s\S]*?)(?=\n===HTML===)/);
  const newTitle = opts.allowTitle && titleMatch ? titleMatch[1].trim().slice(0, 60) : null;
  let html = (raw.match(/===HTML===\s*\n([\s\S]*)$/)?.[1] ?? raw).trim();
  html = html.replace(/^```(?:html)?\s*/i, '').replace(/```\s*$/, '').trim();
  if (html.length < 300) throw new Error(`수정 결과가 너무 짧습니다 (${html.length}자).`);

  const title = newTitle || post.title;

  const today = new Date().toLocaleDateString('sv-SE', { timeZone: config.tz });
  const finalHtml = finalizeHtml({ html, title, sources: meta.sources }, { today, blogName: '리춍의 성장연구소' });

  // 품질 검사는 **완성본** 기준으로 한다. 출처 블록은 finalizeHtml 이 붙이므로
  // 원본에 검사하면 "본문에 출처 링크가 없다"는 오탐이 난다 (파이프라인과 순서를 맞춘다).
  const quality = checkDraft({ ...meta, html: finalHtml, title });
  log.info(`\n${formatReport(quality)}`);

  writeFileSync(post.draft_path, JSON.stringify({ ...meta, html }, null, 2));
  writeFileSync(post.html_path, finalHtml);
  db.prepare("UPDATE posts SET title=?, word_count=?, quality_score=?, last_updated_at=datetime('now'), updated_at=datetime('now') WHERE id=?")
    .run(title, quality.chars, quality.score, postId);

  // 발행된 글이면 티스토리에 즉시 반영
  if (post.status === 'published' && post.tistory_id) {
    await publish({
      postId: post.tistory_id, title, html: finalHtml,
      category: post.category, tags: meta.tags ?? [], visibility: 'public',
    });
    return { updated: true, url: post.url, quality, title, titleChanged: Boolean(newTitle) };
  }
  return { updated: false, quality, title, titleChanged: Boolean(newTitle) };
}


// ── 톤·제목 일괄 재작성 ─────────────────────────────────────
const RETONE_SYSTEM = `${SYSTEM}

---

## 지금 하는 일은 '새로 쓰기'가 아니라 '다시 쓰기'입니다

이미 발행된 글을 위 규칙(문체·제목·구조)에 맞춰 고쳐 씁니다.

**절대 바꾸면 안 되는 것**

- 금액, 기간, 날짜, 요율, 자격 조건, 기관명, 전화번호, 서식 번호 등 모든 사실과 수치
- 원문에 없던 사실을 새로 추가하지 마시오. 검색해서 보태지도 마시오.
- 확신이 없으면 원문 표현을 그대로 두시오.

**바꿔야 하는 것**

- 문체를 해요체로. "~합니다" 위주 문장을 자연스러운 대화체로.
- 도입부를 독자가 처한 상황에서 시작하도록.
- 제목을 <주제+행위> 총정리, <구체적 약속> 형태로.
- 소제목을 문장형으로.
- 구조가 규칙에 안 맞으면(표 없음, FAQ 없음 등) 원문 정보 범위 안에서 재배치하시오.

출력은 ===TITLE=== / ===TAGS=== / ===SUMMARY=== / ===HTML=== 네 구분자만 사용하시오.
===SOURCES=== 는 쓰지 마시오. 출처는 코드가 따로 붙입니다.`;

/**
 * 발행된 글의 제목·문체를 현재 규칙에 맞게 다시 쓴다. 사실은 유지한다.
 */
export async function retonePost(postId) {
  const post = db.prepare('SELECT * FROM posts WHERE id=?').get(postId);
  if (!post) throw new Error(`글 #${postId} 을 찾을 수 없습니다.`);
  const meta = JSON.parse(readFileSync(post.draft_path, 'utf8'));

  const res = await getClient().messages.stream({
    model: 'claude-opus-5',
    max_tokens: 32000,
    system: [{ type: 'text', text: RETONE_SYSTEM, cache_control: { type: 'ephemeral' } }],
    thinking: { type: 'adaptive' },
    output_config: { effort: 'high' },
    messages: [{
      role: 'user',
      content: `아래 글을 규칙에 맞춰 다시 써 주세요.\n\n현재 제목: ${post.title}\n카테고리: ${post.category}\n\n--- 현재 본문 HTML ---\n${meta.html}`,
    }],
  }).finalMessage();
  if (res.stop_reason === 'refusal') throw new Error('모델이 재작성을 거절했습니다.');

  const text = res.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n');
  const section = (n) => {
    const m = text.match(new RegExp(`===${n}===\\s*\\n([\\s\\S]*?)(?=\\n===[A-Z]+===|$)`));
    return m ? m[1].trim() : '';
  };
  const title = section('TITLE');
  const html = section('HTML');
  const tags = section('TAGS').split(',').map((t) => t.trim()).filter(Boolean);
  if (!title || html.length < 500) throw new Error(`재작성 결과 파싱 실패 (제목 ${title.length}자 / 본문 ${html.length}자)`);

  const draft = { title, tags: tags.length ? tags : meta.tags, summary: section('SUMMARY') || meta.summary, html, sources: meta.sources };
  const today = new Date().toLocaleDateString('sv-SE', { timeZone: config.tz });
  const finalHtml = finalizeHtml(draft, { today, blogName: '리춍의 성장연구소' });

  // 출처 블록은 finalizeHtml 이 붙이므로 완성본으로 검사해야 오탐이 없다
  const quality = checkDraft({ ...draft, html: finalHtml });
  log.info(`\n[#${postId}] ${title}\n${formatReport(quality)}`);

  writeFileSync(post.draft_path, JSON.stringify({ ...meta, ...draft, quality }, null, 2));
  writeFileSync(post.html_path, finalHtml);
  db.prepare(`UPDATE posts SET title=?, word_count=?, quality_score=?, source_count=?,
              last_updated_at=datetime('now'), updated_at=datetime('now') WHERE id=?`)
    .run(title, quality.chars, quality.score, quality.sources, postId);

  if (post.status === 'published' && post.tistory_id) {
    await publish({ postId: post.tistory_id, title, html: finalHtml,
                    category: post.category, tags: draft.tags, visibility: 'public' });
  }
  return { oldTitle: post.title, title, quality, url: post.url };
}
