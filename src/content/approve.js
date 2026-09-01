// Phase 2-6 — 텔레그램 승인 게이트.
// 발행 전 사람이 한 번 본다. 애드센스 정책(scaled content abuse) 리스크를 막는 마지막 방어선.
import { db } from '../core/db.js';
import { config } from '../core/config.js';
import { send, esc } from '../telegram/client.js';
import { textOf } from './quality.js';

/** 미리보기는 텔레그램 메시지 한 통에 들어가야 한다. */
const preview = (html, n = 400) => {
  const t = textOf(html);
  return t.length > n ? t.slice(0, n) + '…' : t;
};

export async function requestApproval({ postId, draft, quality }) {
  const warnLines = quality.warns.length
    ? '\n\n' + quality.warns.map((w) => `△ ${esc(w.msg)}`).join('\n')
    : '';

  const text =
    `📝 <b>발행 승인 요청</b>\n\n` +
    `<b>${esc(draft.title)}</b>\n\n` +
    `${esc(draft.summary)}\n\n` +
    `<b>미리보기</b>\n<i>${esc(preview(draft.html))}</i>\n\n` +
    `─────────────\n` +
    `품질 <b>${quality.score}점</b> · 본문 ${quality.chars}자 · 소제목 ${quality.headings}개\n` +
    `출처 ${quality.sources}개 (공식 ${quality.officialSources}개)\n` +
    `태그: ${esc(draft.tags.join(', '))}\n` +
    `비용: $${draft.costUsd?.toFixed(3) ?? '?'} · 검색 ${draft.searches ?? 0}회` +
    warnLines +
    `\n\n<b>출처</b>\n` +
    draft.sources.map((s) => `· ${esc(s.name)} — ${esc(s.url)}`).join('\n');

  const msg = await send(text, {
    buttons: [
      [{ text: '✅ 승인하고 발행', callback_data: `approve:${postId}` }],
      [{ text: '🔒 비공개로 발행', callback_data: `private:${postId}` }],
      [{ text: '🔄 다시 쓰기', callback_data: `retry:${postId}` },
       { text: '🗑 반려', callback_data: `reject:${postId}` }],
    ],
  });

  db.prepare('INSERT INTO approvals (post_id, message_id) VALUES (?,?)').run(postId, msg.message_id);
  return msg;
}

export function recordDecision(postId, decision, feedback = null) {
  db.prepare(`
    UPDATE approvals SET decision=?, feedback=?, decided_at=datetime('now')
    WHERE post_id=? AND decided_at IS NULL
  `).run(decision, feedback, postId);
}

export const pendingApprovals = () =>
  db.prepare(`
    SELECT a.id, a.post_id, a.message_id, p.title, p.category, p.quality_score
    FROM approvals a JOIN posts p ON p.id = a.post_id
    WHERE a.decided_at IS NULL ORDER BY a.requested_at
  `).all();
