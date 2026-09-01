#!/usr/bin/env node
// 텔레그램 봇 토큰을 검증하고 chat_id 를 자동으로 찾아 .env 에 기록한다.
// 사용법: node scripts/setup-telegram.mjs <BOT_TOKEN>

import '../src/core/net.js';
import { fetchRetry } from '../src/core/net.js';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
// 복사 과정에서 붙는 보이지 않는 문자(제로폭 공백, BOM, 줄바꿈)를 제거한다.
const raw = process.argv.slice(2).join('');
const token = raw.replace(/[\u200B-\u200D\uFEFF\s]/g, '');

const mask = (t) => {
  const [id, secret = ''] = t.split(':');
  return `${id}:${secret.slice(0, 3)}${'*'.repeat(Math.max(0, secret.length - 6))}${secret.slice(-3)}`;
};

if (!token) {
  console.error('사용법: node scripts/setup-telegram.mjs <BOT_TOKEN>');
  console.error('토큰은 텔레그램에서 @BotFather 에게 /newbot 을 보내면 발급됩니다.');
  process.exit(1);
}

if (raw !== token) {
  console.log(`※ 붙여넣은 값에서 보이지 않는 문자 ${raw.length - token.length}개를 제거했습니다.`);
}

if (!/^\d+:[\w-]+$/.test(token)) {
  console.error(`토큰 형식이 올바르지 않습니다: ${mask(token)}`);
  console.error(`  · 길이: ${token.length}자 (정상은 보통 46자 안팎)`);
  console.error(`  · 형태: 숫자 8~10자리 + ':' + 영문/숫자/_/- 35자 안팎`);
  process.exit(1);
}

const api = async (method, params) => {
  const res = await fetchRetry(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(params ?? {}),
  });
  return res.json();
};

const me = await api('getMe');
if (!me.ok) {
  console.error(`\n토큰이 거부되었습니다: ${me.description}`);
  console.error(`  보낸 토큰: ${mask(token)} (${token.length}자)`);
  console.error(`
확인해 보세요:
  1) 텔레그램에서 @BotFather → /mybots → 봇 선택 → "API Token" 을 눌러
     현재 유효한 토큰을 확인하세요. (재발급했다면 예전 토큰은 죽습니다)
  2) 봇을 여러 개 만들었다면 어느 봇의 토큰인지 확인하세요.
  3) 토큰 전체를 복사했는지 확인하세요. 콜론(:) 앞뒤가 모두 있어야 합니다.

토큰을 따옴표로 감싸서 다시 실행하면 셸 문제도 함께 배제됩니다:
  node scripts/setup-telegram.mjs '1234567890:AAE...'`);
  process.exit(1);
}
console.log(`봇 확인됨: @${me.result.username} (${me.result.first_name})`);

// 이미 대화 이력이 있으면 바로 잡고, 없으면 사용자가 메시지를 보낼 때까지 기다린다.
console.log(`\n텔레그램에서 @${me.result.username} 을 열고 아무 메시지나 한 번 보내주세요.`);
console.log('(대화를 시작해야 봇이 메시지를 보낼 수 있습니다. "시작" 이라고만 쳐도 됩니다)\n');

let chatId = null;
const deadline = Date.now() + 180_000;
let dots = 0;
while (Date.now() < deadline) {
  const upd = await api('getUpdates', { timeout: 10, allowed_updates: ['message'] });
  const msg = upd.ok && upd.result.map((u) => u.message).filter(Boolean).pop();
  if (msg?.chat?.id) {
    chatId = msg.chat.id;
    console.log(`\nchat_id 확보: ${chatId} (${msg.chat.first_name ?? msg.chat.title ?? ''})`);
    break;
  }
  process.stdout.write(`\r메시지 대기 중${'.'.repeat((dots++ % 3) + 1)}   `);
}

if (!chatId) {
  console.error('\n시간 초과. 봇에게 메시지를 보낸 뒤 다시 실행해 주세요.');
  process.exit(1);
}

// .env 갱신
const envPath = join(ROOT, '.env');
let env = readFileSync(envPath, 'utf8');
const setKey = (k, v) =>
  new RegExp(`^${k}=.*$`, 'm').test(env)
    ? (env = env.replace(new RegExp(`^${k}=.*$`, 'm'), `${k}=${v}`))
    : (env += `\n${k}=${v}\n`);
setKey('TELEGRAM_BOT_TOKEN', token);
setKey('TELEGRAM_CHAT_ID', chatId);
writeFileSync(envPath, env);
console.log('.env 에 저장 완료.');

await api('sendMessage', {
  chat_id: chatId,
  text: '✅ 연결 완료\n\n블로그 자동 운영 봇이 연결됐습니다.\n앞으로 모든 승인 요청과 유입·수익 리포트가 여기로 옵니다.\n\n/help 로 명령어를 확인하세요.',
});
console.log('테스트 메시지를 보냈습니다. 텔레그램을 확인하세요.');
