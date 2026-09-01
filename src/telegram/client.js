// 텔레그램 Bot API 클라이언트. 리포트 전송과 승인 버튼을 담당한다.
import '../core/net.js';
import { fetchRetry } from '../core/net.js';
import { config } from '../core/config.js';
import { createLogger } from '../core/logger.js';

const log = createLogger('telegram');
const base = () => `https://api.telegram.org/bot${config.telegram.token}`;

export const isConfigured = () => Boolean(config.telegram.token && config.telegram.chatId);

export async function call(method, params = {}, { timeoutMs } = {}) {
  if (!config.telegram.token) throw new Error('TELEGRAM_BOT_TOKEN 이 설정되지 않았습니다 (.env)');
  // 롱폴링(getUpdates)은 서버가 params.timeout 초까지 붙잡고 있으므로 HTTP 타임아웃을 더 길게 준다
  const budget = timeoutMs ?? (params.timeout ? (params.timeout + 20) * 1000 : 30_000);
  const res = await fetchRetry(`${base()}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(params),
    timeoutMs: budget,
  }, { retries: params.timeout ? 0 : 3 });   // 롱폴링은 재시도하지 않는다 (바깥 루프가 다시 돈다)
  const json = await res.json();
  if (!json.ok) {
    log.error(`${method} 실패: ${json.description}`, { params: Object.keys(params) });
    throw new Error(`Telegram ${method}: ${json.description}`);
  }
  return json.result;
}

/** 텔레그램 MarkdownV2 는 이스케이프 규칙이 까다로워 HTML 파스모드를 쓴다. */
export const esc = (s) =>
  String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export async function send(text, { buttons, chatId, silent = false, preview = false } = {}) {
  return call('sendMessage', {
    chat_id: chatId ?? config.telegram.chatId,
    text,
    parse_mode: 'HTML',
    disable_notification: silent,
    link_preview_options: { is_disabled: !preview },
    ...(buttons ? { reply_markup: { inline_keyboard: buttons } } : {}),
  });
}

export async function edit(messageId, text, { buttons, chatId } = {}) {
  return call('editMessageText', {
    chat_id: chatId ?? config.telegram.chatId,
    message_id: messageId,
    text,
    parse_mode: 'HTML',
    link_preview_options: { is_disabled: true },
    ...(buttons ? { reply_markup: { inline_keyboard: buttons } } : {}),
  });
}

/** 버튼을 누른 사용자에게 즉시 피드백을 준다 (누른 채로 멈춘 것처럼 보이지 않게). */
export const answer = (callbackQueryId, text) =>
  call('answerCallbackQuery', { callback_query_id: callbackQueryId, text, show_alert: false });

/** 텔레그램 메시지 상한은 4096자. 넘치면 잘라서 여러 통으로 보낸다. */
export async function sendLong(text, opts = {}) {
  const LIMIT = 3900;
  if (text.length <= LIMIT) return send(text, opts);
  const chunks = [];
  let cur = '';
  for (const line of text.split('\n')) {
    if ((cur + line).length > LIMIT) { chunks.push(cur); cur = ''; }
    cur += line + '\n';
  }
  if (cur.trim()) chunks.push(cur);
  let last;
  for (const [i, c] of chunks.entries()) {
    last = await send(c, i === chunks.length - 1 ? opts : { ...opts, buttons: undefined, silent: true });
  }
  return last;
}
