// 텔레그램 운영 에이전트가 쓸 수 있는 도구들.
// 셸이나 파일 시스템은 노출하지 않는다. 블로그 운영에 필요한 동작만 연다.
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { db, getState, setState } from '../core/db.js';
import { config, readiness } from '../core/config.js';
import { createLogger } from '../core/logger.js';

const log = createLogger('agent-tools');

export const TOOLS = [
  {
    name: 'get_status',
    description: '시스템 준비 상태, 발행 현황, 발행 속도, 일시정지 여부, 글감 잔량을 반환한다.',
    input_schema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'sql_select',
    description:
      '블로그 DB 에 읽기 전용 SELECT 질의를 실행한다. 통계·집계·상세 조회에 쓴다. ' +
      '테이블: posts(id,keyword,title,category,type,status,url,tistory_id,word_count,source_count,quality_score,published_at,created_at), ' +
      'keywords(keyword,category,intent,difficulty,season,money,note,source,status), ' +
      'site_daily(date,users,sessions,pageviews,clicks,impressions,position,revenue), ' +
      'metrics_daily(date,post_id,users,pageviews,clicks,impressions,position,revenue), ' +
      'queries_daily(date,query,page,clicks,impressions,position), runs(job,status,detail,started_at,finished_at), approvals.',
    input_schema: {
      type: 'object',
      properties: { query: { type: 'string', description: 'SELECT 로 시작하는 SQL. 최대 50행 반환.' } },
      required: ['query'], additionalProperties: false,
    },
  },
  {
    name: 'add_keywords',
    description: '글감 풀에 키워드를 추가한다. 이미 있는 키워드는 무시된다.',
    input_schema: {
      type: 'object',
      properties: {
        items: {
          type: 'array', maxItems: 40,
          items: {
            type: 'object',
            properties: {
              keyword: { type: 'string' },
              category: { type: 'string', enum: ['정책지원금', '세금환급', '생활금융', '생활정보', '리뷰쇼핑'] },
              difficulty: { type: 'string', enum: ['하', '중', '상'] },
              season: { type: 'string', description: "'연중' 또는 '1~2월', '5월/9월' 형태" },
              note: { type: 'string' },
            },
            required: ['keyword', 'category'], additionalProperties: false,
          },
        },
      },
      required: ['items'], additionalProperties: false,
    },
  },
  {
    name: 'create_draft',
    description: '초안 작성을 시작한다. 3~5분 걸리며 완료되면 승인 요청이 별도로 도착한다. 즉시 결과를 반환하지 않는다.',
    input_schema: {
      type: 'object',
      properties: { keyword: { type: 'string', description: '생략하면 선정기가 다음 순번을 고른다' } },
      additionalProperties: false,
    },
  },
  {
    name: 'publish_post',
    description: '승인 대기(review) 상태의 글을 티스토리에 발행한다. 되돌리기 어려우므로 사용자에게 먼저 확인받고 호출하시오.',
    input_schema: {
      type: 'object',
      properties: {
        post_id: { type: 'integer' },
        visibility: { type: 'string', enum: ['public', 'private'], default: 'public' },
        confirm: { type: 'boolean', description: '사용자가 명시적으로 발행에 동의했으면 true' },
      },
      required: ['post_id', 'confirm'], additionalProperties: false,
    },
  },
  {
    name: 'set_rate',
    description: '하루 발행 편수를 바꾼다(1~12). 데몬이 재시작되어야 적용되므로 사용자에게 알리시오.',
    input_schema: {
      type: 'object',
      properties: { per_day: { type: 'integer', minimum: 1, maximum: 12 } },
      required: ['per_day'], additionalProperties: false,
    },
  },
  {
    name: 'set_paused',
    description: '자동 초안 생성을 멈추거나 재개한다.',
    input_schema: {
      type: 'object',
      properties: { paused: { type: 'boolean' } },
      required: ['paused'], additionalProperties: false,
    },
  },
  {
    name: 'run_report',
    description: '리포트를 즉시 생성해 텔레그램으로 보낸다.',
    input_schema: {
      type: 'object',
      properties: { kind: { type: 'string', enum: ['daily', 'weekly', 'monthly'] } },
      required: ['kind'], additionalProperties: false,
    },
  },
  {
    name: 'collect_metrics',
    description: 'GA4 와 Search Console 지표를 지금 수집한다.',
    input_schema: {
      type: 'object',
      properties: { days: { type: 'integer', minimum: 1, maximum: 90, default: 14 } },
      additionalProperties: false,
    },
  },
  {
    name: 'read_logs',
    description: '최근 로그를 읽는다. 장애 원인 파악에 쓴다.',
    input_schema: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: '정규식 필터 (선택)' },
        lines: { type: 'integer', minimum: 1, maximum: 120, default: 40 },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'get_post_content',
    description: '특정 글의 본문 텍스트를 읽는다. 내용 검토나 수정 판단에 쓴다.',
    input_schema: {
      type: 'object',
      properties: { post_id: { type: 'integer' }, max_chars: { type: 'integer', default: 2500 } },
      required: ['post_id'], additionalProperties: false,
    },
  },
  {
    name: 'revise_post',
    description:
      '이미 발행됐거나 승인 대기 중인 글을 지시대로 고치고 티스토리에 반영한다. ' +
      '"이 글 이렇게 고쳐줘" 같은 요청에 쓴다. 발행된 글은 같은 URL 이 유지된다. ' +
      '되돌리기 어려우므로 무엇을 어떻게 고칠지 사용자에게 먼저 알리고 동의를 받으시오. 1~2분 걸린다.',
    input_schema: {
      type: 'object',
      properties: {
        post_id: { type: 'integer' },
        instruction: { type: 'string', description: '무엇을 어떻게 고칠지. 구체적으로.' },
        allow_title: { type: 'boolean', description: '제목도 함께 다듬어도 되면 true' },
        confirm: { type: 'boolean', description: '사용자가 수정에 동의했으면 true' },
      },
      required: ['post_id', 'instruction', 'confirm'], additionalProperties: false,
    },
  },
  {
    name: 'add_guideline',
    description:
      '앞으로 쓰는 모든 글에 적용될 지침을 추가한다. "앞으로는 ~하게 써줘" 같은 요청에 쓴다. ' +
      '이 지침은 생성 프롬프트에 영구적으로 들어간다. 이미 발행된 글에는 소급되지 않는다.',
    input_schema: {
      type: 'object',
      properties: { text: { type: 'string', description: '한 문장으로 명확하게' } },
      required: ['text'], additionalProperties: false,
    },
  },
  {
    name: 'list_guidelines',
    description: '현재 적용 중인 글쓰기 지침 목록을 반환한다.',
    input_schema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'remove_guideline',
    description: '지침을 번호로 삭제한다. 번호는 list_guidelines 의 순서(0부터).',
    input_schema: {
      type: 'object',
      properties: { index: { type: 'integer', minimum: 0 } },
      required: ['index'], additionalProperties: false,
    },
  },
  {
    name: 'health_check',
    description: '티스토리 세션·Anthropic 인증·Google API 상태를 점검한다.',
    input_schema: { type: 'object', properties: {}, additionalProperties: false },
  },
];

/** 도구 실행. 항상 문자열을 돌려준다. */
export async function runTool(name, input) {
  switch (name) {
    case 'get_status': {
      const r = readiness();
      const byStatus = db.prepare('SELECT status, COUNT(*) c FROM posts GROUP BY status').all();
      return JSON.stringify({
        readiness: r.map((x) => ({ [x.label]: x.ok })),
        posts: Object.fromEntries(byStatus.map((x) => [x.status, x.c])),
        keywordsLeft: db.prepare("SELECT COUNT(*) c FROM keywords WHERE status='new'").get().c,
        postsPerDay: Number(getState('posts_per_day', config.postsPerDay)),
        paused: getState('paused') === '1',
        blogUrl: config.tistory.blogUrl,
      });
    }

    case 'sql_select': {
      const q = String(input.query ?? '').trim();
      if (!/^select\s/i.test(q) || /;\s*\S/.test(q)) return '오류: SELECT 단일 질의만 허용됩니다.';
      if (/\b(insert|update|delete|drop|alter|attach|pragma|create)\b/i.test(q)) return '오류: 읽기 전용만 허용됩니다.';
      try {
        const rows = db.prepare(q).all().slice(0, 50);
        return rows.length ? JSON.stringify(rows) : '(결과 없음)';
      } catch (e) { return `SQL 오류: ${e.message}`; }
    }

    case 'add_keywords': {
      const stmt = db.prepare(`
        INSERT INTO keywords (keyword, category, intent, difficulty, season, money, note, source)
        VALUES (?,?,'정보',?,?,'애드센스',?, 'manual')
        ON CONFLICT(keyword) DO NOTHING
      `);
      let added = 0;
      for (const it of input.items ?? []) {
        added += stmt.run(it.keyword.trim(), it.category, it.difficulty ?? '중', it.season ?? '연중', it.note ?? '').changes;
      }
      return `${added}개 추가 (전체 ${db.prepare("SELECT COUNT(*) c FROM keywords WHERE status='new'").get().c}개 대기)`;
    }

    case 'create_draft': {
      import('../content/pipeline.js')
        .then(({ createDraft }) => createDraft({ keyword: input.keyword || null }))
        .catch(async (e) => {
          log.error('에이전트 초안 생성 실패', e);
          const { send, esc } = await import('./client.js');
          await send(`⚠️ 초안 생성 실패\n<code>${esc(e.message)}</code>`).catch(() => {});
        });
      return `초안 작성을 시작했습니다${input.keyword ? ` (${input.keyword})` : ' (다음 순번)'}. 3~5분 뒤 승인 요청이 도착합니다.`;
    }

    case 'publish_post': {
      if (!input.confirm) return '거부: 사용자 확인 없이는 발행하지 않습니다. 먼저 사용자에게 물어보시오.';
      const post = db.prepare('SELECT * FROM posts WHERE id=?').get(input.post_id);
      if (!post) return `글 #${input.post_id} 을 찾을 수 없습니다.`;
      if (post.status === 'published') return `이미 발행됨: ${post.url}`;
      const [{ publish, recordPublished }, fs] = await Promise.all([import('../publish/publisher.js'), import('node:fs')]);
      const meta = JSON.parse(fs.readFileSync(post.draft_path, 'utf8'));
      const res = await publish({
        title: post.title, html: fs.readFileSync(post.html_path, 'utf8'),
        category: post.category, tags: meta.tags ?? [],
        visibility: input.visibility ?? 'public',
      });
      recordPublished(post.id, res);
      db.prepare("UPDATE keywords SET status='done' WHERE keyword=?").run(post.keyword);
      return `발행 완료: ${res.url}`;
    }

    case 'set_rate': {
      setState('posts_per_day', input.per_day);
      setTimeout(() => process.exit(0), 2500);   // systemd 가 새 스케줄로 재기동
      return `하루 ${input.per_day}편으로 변경했습니다. 적용을 위해 데몬을 재시작합니다(수 초 내 복귀).`;
    }

    case 'set_paused':
      setState('paused', input.paused ? '1' : '0');
      return input.paused ? '자동 초안 생성을 멈췄습니다.' : '자동 초안 생성을 재개했습니다.';

    case 'run_report': {
      const m = await import('../report/index.js');
      const fn = { daily: m.dailyReport, weekly: m.weeklyReport, monthly: m.monthlyReport }[input.kind];
      await fn();
      return '리포트를 전송했습니다.';
    }

    case 'collect_metrics': {
      const { collectAll } = await import('../collect/index.js');
      return String(await collectAll({ days: input.days ?? 14 }));
    }

    case 'read_logs': {
      const dir = config.paths.logs;
      const files = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.log')).sort().slice(-2) : [];
      let lines = [];
      for (const f of files) lines.push(...readFileSync(join(dir, f), 'utf8').split('\n'));
      if (input.pattern) {
        try { const re = new RegExp(input.pattern, 'i'); lines = lines.filter((l) => re.test(l)); }
        catch { return '오류: 정규식이 올바르지 않습니다.'; }
      }
      return lines.filter(Boolean).slice(-(input.lines ?? 40)).join('\n').slice(0, 6000) || '(해당 로그 없음)';
    }

    case 'get_post_content': {
      const post = db.prepare('SELECT * FROM posts WHERE id=?').get(input.post_id);
      if (!post || !existsSync(post.html_path)) return `글 #${input.post_id} 의 본문을 찾을 수 없습니다.`;
      const { textOf } = await import('../content/quality.js');
      const text = textOf(readFileSync(post.html_path, 'utf8'));
      return JSON.stringify({ title: post.title, status: post.status, url: post.url, chars: text.length,
        text: text.slice(0, input.max_chars ?? 2500) });
    }

    case 'revise_post': {
      if (!input.confirm) return '거부: 사용자 확인 없이는 수정하지 않습니다. 먼저 무엇을 고칠지 알리고 동의를 받으시오.';
      const { revisePost } = await import('../content/revise.js');
      const r = await revisePost(input.post_id, input.instruction, { allowTitle: input.allow_title === true });
      return r.updated
        ? `수정 완료 (품질 ${r.quality.score}점, 본문 ${r.quality.chars}자)${r.titleChanged ? `\n새 제목: ${r.title}` : ''} — ${r.url}`
        : `초안을 수정했습니다 (품질 ${r.quality.score}점). 아직 발행 전이라 티스토리에는 반영되지 않았습니다.`;
    }

    case 'add_guideline': {
      const { addGuideline } = await import('../content/revise.js');
      const list = addGuideline(input.text);
      return `지침 등록 완료. 현재 ${list.length}개가 앞으로 쓰는 모든 글에 적용됩니다.\n` +
             list.map((g, i) => `${i}. ${g.text}`).join('\n');
    }

    case 'list_guidelines': {
      const { getGuidelines } = await import('../content/revise.js');
      const list = getGuidelines();
      return list.length ? list.map((g, i) => `${i}. ${g.text} (${g.added_at})`).join('\n') : '(등록된 지침 없음)';
    }

    case 'remove_guideline': {
      const { removeGuideline } = await import('../content/revise.js');
      const r = removeGuideline(input.index);
      return r ? `삭제됨: ${r.text}` : '해당 번호의 지침이 없습니다.';
    }

    case 'health_check': {
      const { runChecks } = await import('../core/health.js');
      return JSON.stringify(await runChecks());
    }

    default:
      return `알 수 없는 도구: ${name}`;
  }
}
