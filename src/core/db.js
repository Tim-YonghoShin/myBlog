// SQLite 스키마 및 접근 계층. Node 22 내장 node:sqlite 사용 (네이티브 빌드 불필요).
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { config } from './config.js';

mkdirSync(dirname(config.paths.db), { recursive: true });
export const db = new DatabaseSync(config.paths.db);

db.exec(`PRAGMA journal_mode = WAL;`);
db.exec(`PRAGMA foreign_keys = ON;`);

export function migrate() {
  db.exec(`
    -- 글감 풀. seed CSV 와 GSC 쿼리 마이닝(6-1) 양쪽에서 채워진다.
    CREATE TABLE IF NOT EXISTS keywords (
      id          INTEGER PRIMARY KEY,
      keyword     TEXT NOT NULL UNIQUE,
      category    TEXT NOT NULL,
      intent      TEXT,                       -- 정보 | 비교 | 리뷰
      difficulty  TEXT,                       -- 하 | 중 | 상
      season      TEXT,                       -- '연중' 또는 '1~2월' 등
      money       TEXT,                       -- 애드센스 | 쿠팡
      note        TEXT,
      source      TEXT NOT NULL DEFAULT 'seed',   -- seed | gsc | manual
      status      TEXT NOT NULL DEFAULT 'new',    -- new | queued | done | skip
      priority    REAL NOT NULL DEFAULT 0,        -- 선정기가 계산해 넣는 점수
      created_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- 글 한 편의 전체 생애주기.
    CREATE TABLE IF NOT EXISTS posts (
      id             INTEGER PRIMARY KEY,
      keyword        TEXT NOT NULL,
      title          TEXT NOT NULL,
      category       TEXT NOT NULL,
      type           TEXT NOT NULL DEFAULT 'info',   -- info | review | compare
      status         TEXT NOT NULL DEFAULT 'draft',
        -- draft(작성중) → review(승인대기) → approved → published
        -- 실패 경로: rejected | failed
      draft_path     TEXT,
      html_path      TEXT,
      word_count     INTEGER DEFAULT 0,
      source_count   INTEGER DEFAULT 0,             -- 인용한 공식 출처 개수 (품질 게이트)
      quality_score  REAL DEFAULT 0,
      tistory_id     TEXT,
      url            TEXT,
      published_at   TEXT,
      last_updated_at TEXT,                         -- 갱신 큐(6-3)가 사용
      created_at     TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_posts_status ON posts(status);
    CREATE INDEX IF NOT EXISTS idx_posts_url    ON posts(url);

    -- 글별 일자 지표. GA4 + GSC + AdSense 를 한 행에 합친다.
    CREATE TABLE IF NOT EXISTS metrics_daily (
      date        TEXT NOT NULL,
      post_id     INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
      pageviews   INTEGER DEFAULT 0,
      users       INTEGER DEFAULT 0,
      clicks      INTEGER DEFAULT 0,      -- GSC
      impressions INTEGER DEFAULT 0,      -- GSC
      position    REAL,                   -- GSC 평균순위
      revenue     REAL DEFAULT 0,         -- AdSense (원)
      PRIMARY KEY (date, post_id)
    );

    -- 사이트 전체 일자 지표. 리포트의 기본 단위.
    CREATE TABLE IF NOT EXISTS site_daily (
      date        TEXT PRIMARY KEY,
      users       INTEGER DEFAULT 0,
      sessions    INTEGER DEFAULT 0,
      pageviews   INTEGER DEFAULT 0,
      clicks      INTEGER DEFAULT 0,
      impressions INTEGER DEFAULT 0,
      position    REAL,
      revenue     REAL DEFAULT 0,
      collected_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- GSC 쿼리 단위 원본. 피드백 루프(6-1)의 입력.
    CREATE TABLE IF NOT EXISTS queries_daily (
      date        TEXT NOT NULL,
      query       TEXT NOT NULL,
      page        TEXT NOT NULL DEFAULT '',
      clicks      INTEGER DEFAULT 0,
      impressions INTEGER DEFAULT 0,
      position    REAL,
      PRIMARY KEY (date, query, page)
    );
    CREATE INDEX IF NOT EXISTS idx_queries_query ON queries_daily(query);

    -- 승인 게이트. 텔레그램 메시지 ↔ 글 매핑.
    CREATE TABLE IF NOT EXISTS approvals (
      id           INTEGER PRIMARY KEY,
      post_id      INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
      message_id   INTEGER,
      decision     TEXT,                  -- approve | reject | revise
      feedback     TEXT,
      requested_at TEXT NOT NULL DEFAULT (datetime('now')),
      decided_at   TEXT
    );

    -- 잡 실행 이력. 장애 추적과 중복 실행 방지에 쓴다.
    CREATE TABLE IF NOT EXISTS runs (
      id          INTEGER PRIMARY KEY,
      job         TEXT NOT NULL,
      status      TEXT NOT NULL,          -- running | ok | error
      detail      TEXT,
      started_at  TEXT NOT NULL DEFAULT (datetime('now')),
      finished_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_runs_job ON runs(job, started_at);

    -- 임의 키-값 (마지막 수집일 등)
    CREATE TABLE IF NOT EXISTS state (
      key   TEXT PRIMARY KEY,
      value TEXT
    );
  `);
}

export const getState = (key, fallback = null) =>
  db.prepare('SELECT value FROM state WHERE key = ?').get(key)?.value ?? fallback;

export const setState = (key, value) =>
  db.prepare('INSERT INTO state(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value')
    .run(key, String(value));

/** 잡 실행을 기록하고, 끝나면 결과를 남긴다. */
export function trackRun(job, fn) {
  const { lastInsertRowid: id } = db.prepare("INSERT INTO runs(job,status) VALUES(?,'running')").run(job);
  const finish = (status, detail) =>
    db.prepare("UPDATE runs SET status=?, detail=?, finished_at=datetime('now') WHERE id=?")
      .run(status, detail ? String(detail).slice(0, 2000) : null, id);
  return Promise.resolve()
    .then(fn)
    .then((r) => { finish('ok', typeof r === 'string' ? r : null); return r; })
    .catch((e) => { finish('error', e.stack ?? e.message); throw e; });
}

if (process.argv.includes('--init')) {
  migrate();
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all();
  console.log(`DB 초기화 완료: ${config.paths.db}`);
  console.log('테이블:', tables.map((t) => t.name).join(', '));
}
