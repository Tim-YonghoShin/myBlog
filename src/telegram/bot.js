// 텔레그램 명령 수신기 (long polling). 지시는 전부 여기로 들어온다.
import '../core/net.js';
import { config, readiness } from '../core/config.js';
import { createLogger } from '../core/logger.js';
import { readFileSync } from 'node:fs';
import { db, migrate, getState, setState } from '../core/db.js';
import { call, send, edit, answer, esc, isConfigured } from './client.js';
import { recordDecision, pendingApprovals } from '../content/approve.js';
import { publish, recordPublished } from '../publish/publisher.js';

const log = createLogger('bot');
migrate();

const HELP = `<b>블로그 자동 운영 봇</b>

<b>확인</b>
/status — 시스템 준비 상태
/queue — 발행 대기 중인 글
/report — 일간 리포트
/week — 주간 리포트
/month — 월간 리포트
/collect — 지금 지표 수집
/mine — 기회 키워드 발굴

<b>지시</b>
/write [키워드] — 초안 작성 (키워드 생략 시 다음 순번)
/retry &lt;키워드&gt; — 다시 작성
/next — 다음에 쓸 글감 미리보기
/pending — 승인 대기 목록
/keywords — 글감 풀 현황
/categories — 카테고리 현황·제안
/catwatch — 카테고리 점검 (승인 버튼)
/rate [n] — 하루 발행 편수 확인·변경
/login — 티스토리 재로그인 (QR 코드를 보냅니다)
/health — 세션·인증 점검
/pause — 자동 발행 일시정지
/resume — 자동 발행 재개

<b>대화</b>
슬래시 없이 그냥 말을 걸면 운영 에이전트가 답합니다.
  "어제 성과 어때?"
  "재산세 글 다시 써줘"
  "연말정산 관련 키워드 10개 추가해줘"
  "지금 승인 대기 뭐 있어?"
/reset — 대화 기록 초기화

초안이 완성되면 이 채팅으로 미리보기와 함께 승인 요청이 옵니다.`;

const handlers = {
  '/start': () => HELP,
  '/help': () => HELP,

  '/status': () => {
    const rows = readiness();
    const done = rows.filter((r) => r.ok).length;
    let out = `<b>시스템 상태</b>  (${done}/${rows.length} 준비됨)\n\n`;
    for (const r of rows) out += `${r.ok ? '✅' : '⬜'} ${esc(r.label)}${r.ok ? '' : ` — <i>${esc(r.hint)}</i>`}\n`;

    const p = db.prepare(`SELECT status, COUNT(*) c FROM posts GROUP BY status`).all();
    const k = db.prepare(`SELECT COUNT(*) c FROM keywords WHERE status='new'`).get().c;
    out += `\n<b>콘텐츠</b>\n`;
    out += p.length ? p.map((r) => `· ${esc(r.status)}: ${r.c}편`).join('\n') : '· 아직 글 없음';
    out += `\n· 대기 중인 글감: ${k}개`;

    const paused = getState('paused') === '1';
    out += `\n\n자동 발행: ${paused ? '⏸ 일시정지' : '▶️ 가동'}`;
    return out;
  },

  '/keywords': () => {
    const rows = db.prepare(`
      SELECT category, difficulty, COUNT(*) c FROM keywords WHERE status='new'
      GROUP BY category, difficulty ORDER BY category
    `).all();
    if (!rows.length) return '글감 풀이 비었습니다. <code>npm run db:seed</code> 를 실행하세요.';
    let out = '<b>대기 중인 글감</b>\n\n';
    let cur = '';
    for (const r of rows) {
      if (r.category !== cur) { out += `\n<b>${esc(r.category)}</b>\n`; cur = r.category; }
      out += `  난이도 ${esc(r.difficulty)}: ${r.c}개\n`;
    }
    return out;
  },

  '/queue': () => {
    const rows = db.prepare(`
      SELECT title, status, created_at FROM posts
      WHERE status IN ('draft','review','approved') ORDER BY created_at LIMIT 10
    `).all();
    if (!rows.length) return '대기 중인 글이 없습니다.';
    const label = { draft: '작성중', review: '승인대기', approved: '발행대기' };
    return '<b>발행 대기</b>\n\n' + rows.map((r) => `· [${label[r.status] ?? r.status}] ${esc(r.title)}`).join('\n');
  },

  // 발행량 변경. 스케줄은 기동 시 확정되므로 상태를 저장하고 프로세스를 재시작한다
  // (systemd Restart=always 가 즉시 다시 띄운다).
  '/rate': async (arg) => {
    const cur = Number(getState('posts_per_day', config.postsPerDay));
    if (!arg) return `현재 하루 <b>${cur}편</b>\n변경: <code>/rate 5</code>  (1~12)`;
    const n = Number(arg.trim());
    if (!Number.isFinite(n) || n < 1 || n > 12) return '1~12 사이 숫자를 지정하세요. 예: <code>/rate 5</code>';
    const { spreadHours } = await import('../core/scheduler.js');
    setState('posts_per_day', n);
    const hours = spreadHours(n).join(', ');
    const cost = (n * 0.43 * 30).toFixed(0);
    await send(`발행량을 하루 <b>${n}편</b>으로 변경합니다.\n생성 시각: ${hours}시\n예상 비용: 월 $${cost}\n\n적용을 위해 재시작합니다…`);
    setTimeout(() => process.exit(0), 1200);   // systemd 가 새 스케줄로 다시 띄운다
    return null;
  },

  '/reset': async () => {
    const { clearHistory } = await import('./agent.js');
    clearHistory();
    return '대화 기록을 지웠습니다. 다음 메시지부터 새로 시작합니다.';
  },

  '/pause': () => { setState('paused', '1'); return '⏸ 자동 발행을 정지했습니다. <code>/resume</code> 으로 재개합니다.'; },
  '/resume': () => { setState('paused', '0'); return '▶️ 자동 발행을 재개했습니다.'; },

  '/pending': () => {
    const rows = pendingApprovals();
    if (!rows.length) return '승인 대기 중인 글이 없습니다.';
    return '<b>승인 대기</b>\n\n' + rows.map((r) => `· [${r.quality_score}점] ${esc(r.title)}`).join('\n');
  },

  // 초안 생성은 몇 분 걸리므로 백그라운드로 돌리고 즉시 응답한다.
  '/write': (arg) => {
    if (getState('paused') === '1') return '⏸ 일시정지 상태입니다. <code>/resume</code> 먼저 실행하세요.';
    startDraft(arg || null);
    return arg
      ? `「${esc(arg)}」 초안을 작성합니다. 3~5분 걸립니다.`
      : '다음 순번 글감으로 초안을 작성합니다. 3~5분 걸립니다.';
  },
  '/retry': (arg) => {
    if (!arg) return '사용법: <code>/retry 키워드</code>';
    startDraft(arg);
    return `「${esc(arg)}」 를 다시 작성합니다.`;
  },
  '/next': () => {
    // 선정기가 다음에 무엇을 고를지 미리 보여준다
    return import('../content/selector.js').then(({ pickNext }) => {
      const picks = pickNext(5);
      if (!picks.length) return '남은 글감이 없습니다.';
      return '<b>다음 글감 (점수순)</b>\n\n' +
        picks.map((p, i) => `${i + 1}. ${esc(p.keyword)}\n   ${esc(p.tistoryCat)} · 난이도 ${esc(p.difficulty)} · ${p.score}점`).join('\n');
    });
  },

  // 리포트는 전송 자체가 응답이므로 즉시 안내만 돌려주고 백그라운드로 보낸다
  '/report': () => runReport('daily'),
  '/week':   () => runReport('weekly'),
  '/month':  () => runReport('monthly'),
  '/collect': () => {
    import('../collect/index.js').then(({ collectAll }) => collectAll({ days: 14 }))
      .then((r) => send(`수집 완료\n<code>${esc(String(r).slice(0, 300))}</code>`))
      .catch((e) => send(`⚠️ 수집 실패\n<code>${esc(e.message)}</code>`));
    return '지표를 수집합니다…';
  },
  '/categories': () => {
    import('../publish/category-watch.js').then(({ detect }) => detect()).then(({ live, suggestions, crowded }) => {
      let t = '<b>카테고리 현황</b>\n\n';
      for (const c of live) t += `${'　'.repeat(c.depth - 1)}${esc(c.name)} (${c.entries}편)\n`;
      if (suggestions.length) {
        t += `\n<b>제안 ${suggestions.length}건</b>\n`;
        for (const s of suggestions) t += `· ${esc(s.parent ? s.parent + ' / ' : '')}${esc(s.name)} — ${esc(s.reason)}\n`;
        t += '\n<code>/catwatch</code> 로 승인 버튼을 받으세요.';
      } else t += '\n목표 구조와 일치합니다.';
      if (crowded.length) t += `\n\n과밀: ${crowded.map((c) => `${esc(c.category)}(${c.c}편)`).join(', ')}`;
      return send(t);
    }).catch((e) => send(`⚠️ 조회 실패\n<code>${esc(e.message)}</code>`));
    return '카테고리를 확인합니다…';
  },
  '/catwatch': () => {
    import('../publish/category-watch.js').then(({ runCategoryWatch }) => runCategoryWatch())
      .then((r) => { if (r === 'no findings' || r === 'unchanged') send('추가가 필요한 카테고리가 없습니다.'); })
      .catch((e) => send(`⚠️ 실패\n<code>${esc(e.message)}</code>`));
    return '점검 중…';
  },

  '/login': () => {
    import('../../scripts/tistory-login-qr.mjs').then(({ qrLogin }) => qrLogin({ notify: true }))
      .catch(() => {});   // 실패 알림은 qrLogin 내부에서 보낸다
    return '카카오 QR 코드를 준비합니다… 잠시 후 이미지가 도착합니다.';
  },

  '/health': () => {
    import('../core/health.js').then(({ runChecks }) => runChecks()).then((rs) => {
      const t = '<b>시스템 점검</b>\n\n' + rs.map((r) =>
        `${r.ok ? '✅' : '❌'} <b>${esc(r.name)}</b>\n   ${esc(r.detail)}` +
        (r.ok ? '' : `\n   → <code>${esc(r.fixHint)}</code>`)).join('\n');
      return send(t);
    }).catch((e) => send(`⚠️ 점검 실패\n<code>${esc(e.message)}</code>`));
    return '점검 중…';
  },
  '/mine': () => {
    import('../content/mining.js').then(({ runMining }) => runMining())
      .then((r) => { if (r === 'no findings') send('발굴된 항목이 없습니다. 검색 노출 데이터가 더 쌓여야 합니다.'); })
      .catch((e) => send(`⚠️ 마이닝 실패\n<code>${esc(e.message)}</code>`));
    return '기회 키워드를 발굴합니다…';
  },
};

function runReport(kind) {
  import('../report/index.js')
    .then((m) => ({ daily: m.dailyReport, weekly: m.weeklyReport, monthly: m.monthlyReport }[kind]()))
    .catch(async (e) => {
      log.error(`리포트 실패 ${kind}`, e);
      await send(`⚠️ 리포트 생성 실패\n<code>${esc(e.message)}</code>`).catch(() => {});
    });
  return '리포트를 생성합니다…';
}

/** 초안 생성을 비동기로 시작한다. 완료되면 승인 요청이 따로 도착한다. */
function startDraft(keyword) {
  import('../content/pipeline.js')
    .then(({ createDraft }) => createDraft({ keyword }))
    .catch(async (e) => {
      log.error('초안 생성 실패', e);
      await send(`⚠️ 초안 생성 실패\n<code>${esc(e.message)}</code>`).catch(() => {});
    });
}

const notReady = (what, phase) =>
  `${what} 기능은 아직 구축 중입니다.\n<i>${esc(phase)}</i> 완료 후 사용할 수 있습니다.`;

async function handleMessage(msg) {
  const text = (msg.text ?? '').trim();
  if (!text) return;

  // 슬래시 명령이 아니면 운영 에이전트에게 넘긴다.
  if (!text.startsWith('/')) return handleAgentMessage(text);
  // 그룹에서 /help@botname 형태로 올 수 있다
  const [cmdRaw, ...rest] = text.split(/\s+/);
  const cmd = cmdRaw.split('@')[0].toLowerCase();
  const arg = rest.join(' ').trim();

  const fn = handlers[cmd];
  if (!fn) return send(`모르는 명령입니다: <code>${esc(cmd)}</code>\n/help 를 보세요.`);
  try {
    const out = await await fn(arg);
    if (out) await send(out);
  } catch (e) {
    log.error(`명령 처리 실패 ${cmd}`, e);
    await send(`⚠️ 처리 중 오류가 났습니다.\n<code>${esc(e.message)}</code>`);
  }
}

/** 자유 문장 → Claude 운영 에이전트. 응답까지 수 초~수십 초 걸리므로 입력 표시를 유지한다. */
async function handleAgentMessage(text) {
  let typing = null;
  try {
    const ping = () => call('sendChatAction', { chat_id: config.telegram.chatId, action: 'typing' }).catch(() => {});
    ping();
    typing = setInterval(ping, 5000);
    const { ask } = await import('./agent.js');
    const reply = await ask(text);
    clearInterval(typing); typing = null;
    const { sendLong } = await import('./client.js');
    await sendLong(reply);
  } catch (e) {
    if (typing) clearInterval(typing);
    log.error('에이전트 처리 실패', e);
    await send(`⚠️ 처리 중 오류가 났습니다.\n<code>${esc(e.message.slice(0, 300))}</code>`).catch(() => {});
  }
}

async function handleCallback(cb) {
  const [action, idStr] = (cb.data ?? '').split(':');
  const postId = Number(idStr);
  const isCategoryAction = action === 'catadd' || action === 'catskip';
  const post = isCategoryAction ? null : db.prepare('SELECT * FROM posts WHERE id=?').get(postId);
  if (!isCategoryAction && !post) { await answer(cb.id, '글을 찾을 수 없습니다'); return; }

  const strike = (label) =>
    edit(cb.message.message_id, cb.message.text ? `<s>${esc(cb.message.text.slice(0, 60))}…</s>\n\n${label}` : label)
      .catch(() => {});

  try {
    if (action === 'approve' || action === 'private') {
      await answer(cb.id, '발행 중…');
      const html = readFileSync(post.html_path, 'utf8');
      const meta = JSON.parse(readFileSync(post.draft_path, 'utf8'));
      const res = await publish({
        title: post.title,
        html,
        category: post.category,
        tags: meta.tags ?? [],
        visibility: action === 'private' ? 'private' : 'public',
      });
      recordPublished(postId, res);
      recordDecision(postId, action);
      db.prepare("UPDATE keywords SET status='done' WHERE keyword=?").run(post.keyword);
      await send(
        `✅ <b>발행 완료</b>${action === 'private' ? ' (비공개)' : ''}\n\n` +
        `<b>${esc(post.title)}</b>\n${esc(res.url)}`,
        { preview: true }
      );
      return;
    }

    // 카테고리 제안 승인/건너뛰기
    if (action === 'catadd' || action === 'catskip') {
      const raw = getState(`cat_suggest_${idStr}`, null);
      if (!raw) { await answer(cb.id, '만료된 제안입니다'); return; }
      const sug = JSON.parse(raw);
      if (action === 'catskip') {
        await answer(cb.id, '건너뜁니다');
        await strike(`건너뜀: ${esc(sug.name)}`);
        return;
      }
      await answer(cb.id, '만드는 중…');
      const { applySuggestion } = await import('../publish/category-watch.js');
      const r = await applySuggestion(sug);
      await send(r.created
        ? `✅ 카테고리 생성\n<b>${esc(sug.parent ? sug.parent + ' / ' : '')}${esc(sug.name)}</b>\n앞으로 해당 글감이 여기로 발행됩니다.`
        : `이미 존재합니다: ${esc(sug.name)}`);
      return;
    }

    if (action === 'reject') {
      db.prepare("UPDATE posts SET status='rejected', updated_at=datetime('now') WHERE id=?").run(postId);
      db.prepare("UPDATE keywords SET status='skip' WHERE keyword=?").run(post.keyword);
      recordDecision(postId, 'reject');
      await answer(cb.id, '반려했습니다');
      await strike('🗑 반려됨');
      return;
    }

    if (action === 'retry') {
      db.prepare("UPDATE posts SET status='rejected', updated_at=datetime('now') WHERE id=?").run(postId);
      db.prepare("UPDATE keywords SET status='new' WHERE keyword=?").run(post.keyword);
      recordDecision(postId, 'retry');
      await answer(cb.id, '다시 작성합니다');
      await strike('🔄 재작성 중…');
      startDraft(post.keyword);
      return;
    }

    await answer(cb.id, '알 수 없는 동작');
  } catch (e) {
    log.error(`승인 처리 실패 ${action} id=${idStr}`, e);
    await answer(cb.id, '오류가 났습니다');
    await send(`⚠️ ${esc(action)} 처리 실패${post ? `\n<b>${esc(post.title)}</b>` : ''}\n<code>${esc(e.message)}</code>`);
  }
}

export async function poll() {
  if (!isConfigured()) {
    log.error('텔레그램이 설정되지 않았습니다. scripts/setup-telegram.mjs 를 먼저 실행하세요.');
    process.exit(1);
  }
  const me = await call('getMe');
  log.info(`봇 시작: @${me.username}`);
  await send('🤖 봇이 시작되었습니다. /help');

  let offset = Number(getState('tg_offset', 0));
  for (;;) {
    try {
      const updates = await call('getUpdates', {
        offset,
        timeout: 50,
        allowed_updates: ['message', 'callback_query'],
      });
      for (const u of updates) {
        offset = u.update_id + 1;
        setState('tg_offset', offset);
        // 등록된 관리자 채팅 외의 요청은 무시한다
        const from = u.message?.chat?.id ?? u.callback_query?.message?.chat?.id;
        if (String(from) !== String(config.telegram.chatId)) {
          log.warn(`허용되지 않은 채팅 무시: ${from}`);
          continue;
        }
        if (u.message) await handleMessage(u.message);
        else if (u.callback_query) await handleCallback(u.callback_query);
      }
    } catch (e) {
      log.error('폴링 오류, 5초 후 재시도', e);
      await new Promise((r) => setTimeout(r, 5000));
    }
  }
}

if (import.meta.url === `file://${process.argv[1]}`) poll();
