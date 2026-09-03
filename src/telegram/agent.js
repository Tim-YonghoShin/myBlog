// 텔레그램 운영 에이전트.
//
// 슬래시 명령은 확정적·무료·즉시 응답이므로 그대로 두고, 자유 문장만 여기로 온다.
// Claude 가 도구를 호출해 실제 작업을 수행한다. 셸·파일시스템은 노출하지 않는다.
import '../core/net.js';
import Anthropic from '@anthropic-ai/sdk';
import { db, getState } from '../core/db.js';
import { config } from '../core/config.js';
import { createLogger } from '../core/logger.js';
import { TOOLS, runTool } from './agent-tools.js';

const log = createLogger('agent');
const MODEL = 'claude-opus-5';
const MAX_TURNS = 8;          // 도구 호출 왕복 상한
const HISTORY_LIMIT = 16;     // 유지할 대화 메시지 수

db.exec(`
  CREATE TABLE IF NOT EXISTS chat (
    id         INTEGER PRIMARY KEY,
    role       TEXT NOT NULL,
    content    TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

const SYSTEM = `당신은 티스토리 수익형 블로그 「리춍의 성장연구소」를 운영하는 에이전트입니다.
사용자(블로그 주인)와 텔레그램으로 대화하며, 도구를 써서 실제 운영 작업을 수행합니다.

## 이 시스템이 하는 일

매일 정해진 시각에 글감을 골라 Claude 가 공식 기관 사이트를 검색해 초안을 쓰고,
품질 검사(상투어·출처·이모지·법적 리스크)를 통과하면 텔레그램으로 승인 요청을 보냅니다.
사용자가 승인 버튼을 눌러야 발행됩니다. 발행 후 GA4·Search Console 지표를 수집하고
일간·주간·월간 리포트를 보냅니다.

카테고리: 생활의 성장(지원금·환급 / 절약·생활금융 / 생활정보·서류)이 자동 발행 대상이고,
부의 성장(투자공부/시황분석/투자철학)은 사용자가 직접 쓰는 영역이라 건드리지 않습니다.

## 답변 방식

- 한국어로, 간결하게. 텔레그램이라 긴 글은 읽히지 않습니다.
- 숫자를 물으면 추측하지 말고 sql_select 나 get_status 로 실제 값을 조회해서 답하시오.
- 모르면 모른다고 하시오. 지어내지 마시오.
- HTML 태그는 <b> <i> <code> <a> 만 쓸 수 있습니다. 마크다운(**, ##)은 쓰지 마시오.
- 표가 필요하면 줄바꿈과 · 기호로 정리하시오.

## 글에 대한 피드백을 받으면

사용자가 글의 내용·형식에 불만이나 요구를 말하면, 둘 중 무엇인지 먼저 판단하시오.
애매하면 물어보시오.

- **이 글만** 고치는 것 → revise_post (발행된 글은 같은 URL 로 갱신됨)
- **앞으로 전부** 그렇게 → add_guideline (다음 글부터 적용, 기존 글에는 소급 안 됨)
- 둘 다 원하면 add_guideline 먼저 하고, 기존 글은 revise_post 로 하나씩

"표가 너무 빽빽해" 같은 말은 대개 둘 다입니다. 확인하고 처리하시오.

## 주의

- publish_post 는 되돌리기 어렵습니다. 사용자가 명시적으로 "발행해"라고 하지 않았으면
  먼저 무엇을 발행할지 알려주고 확인을 받으시오.
- set_rate 는 데몬을 재시작시킵니다. 사용자에게 미리 알리시오.
- 발행량을 급격히 올리면 구글이 scaled content abuse 로 판단할 수 있습니다.
  사용자가 크게 올리려 하면 위험을 한 줄로 알리되, 결정은 사용자에게 맡기시오.`;

let client;
const getClient = () => (client ??= new Anthropic());

const loadHistory = () =>
  db.prepare(`SELECT role, content FROM chat ORDER BY id DESC LIMIT ?`).all(HISTORY_LIMIT)
    .reverse()
    .map((r) => ({ role: r.role, content: r.content }));

const saveTurn = (role, content) =>
  db.prepare('INSERT INTO chat (role, content) VALUES (?,?)').run(role, String(content).slice(0, 8000));

export const clearHistory = () => db.exec('DELETE FROM chat');

/** 현재 상태를 매 요청 앞에 붙여 모델이 최신 값을 알게 한다. */
function stateLine() {
  const posts = db.prepare("SELECT COUNT(*) c FROM posts WHERE status='published'").get().c;
  const review = db.prepare("SELECT COUNT(*) c FROM posts WHERE status='review'").get().c;
  const kw = db.prepare("SELECT COUNT(*) c FROM keywords WHERE status='new'").get().c;
  const rate = getState('posts_per_day', config.postsPerDay);
  const paused = getState('paused') === '1';
  const today = new Date().toLocaleString('sv-SE', { timeZone: config.tz }).slice(0, 16);
  return `[현재 ${today} · 발행 ${posts}편 · 승인대기 ${review}편 · 글감 ${kw}개 · 하루 ${rate}편${paused ? ' · 일시정지중' : ''}]`;
}

/**
 * 자유 문장 하나를 처리하고 답변 텍스트를 돌려준다.
 * @param {string} text 사용자 메시지
 * @param {(s:string)=>void} [onProgress] 도구 실행 알림 (선택)
 */
export async function ask(text, onProgress) {
  const messages = [...loadHistory(), { role: 'user', content: `${stateLine()}\n\n${text}` }];
  let totalCost = 0;

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const res = await getClient().messages.create({
      model: MODEL,
      max_tokens: 8000,
      system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
      thinking: { type: 'adaptive' },
      // 대화형이라 응답 속도가 중요하다. 복잡한 분석은 도구가 대신한다.
      output_config: { effort: 'medium' },
      tools: TOOLS,
      messages,
    });

    const u = res.usage;
    totalCost += ((u.input_tokens ?? 0) * 5 + (u.cache_creation_input_tokens ?? 0) * 6.25 +
                  (u.cache_read_input_tokens ?? 0) * 0.5 + (u.output_tokens ?? 0) * 25) / 1e6;

    if (res.stop_reason === 'refusal') return '요청을 처리할 수 없습니다.';

    messages.push({ role: 'assistant', content: res.content });

    const toolUses = res.content.filter((b) => b.type === 'tool_use');
    if (!toolUses.length) {
      const reply = res.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
      saveTurn('user', text);
      saveTurn('assistant', reply);
      log.info(`대화 처리: ${turn + 1}턴 · $${totalCost.toFixed(4)}`);
      return reply || '(응답이 비어 있습니다)';
    }

    const results = [];
    for (const t of toolUses) {
      onProgress?.(t.name);
      log.info(`도구 호출: ${t.name} ${JSON.stringify(t.input).slice(0, 160)}`);
      let out;
      try { out = await runTool(t.name, t.input ?? {}); }
      catch (e) { out = `오류: ${e.message}`; log.error(`도구 실패 ${t.name}`, e); }
      results.push({ type: 'tool_result', tool_use_id: t.id, content: String(out).slice(0, 12000) });
    }
    messages.push({ role: 'user', content: results });
  }
  return '작업이 너무 길어져 중단했습니다. 좀 더 구체적으로 요청해 주세요.';
}
