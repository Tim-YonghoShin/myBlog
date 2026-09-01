#!/usr/bin/env node
// Phase 7-2 — DB·세션·초안 백업. 오래된 백업은 자동 정리한다.
import { execFileSync } from 'node:child_process';
import { mkdirSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { config } from '../src/core/config.js';

const dir = process.argv[2] ?? join(homedir(), 'myblog-backups');
mkdirSync(dir, { recursive: true });
const stamp = new Date().toISOString().slice(0, 10);
const out = join(dir, `myblog-${stamp}.tar.gz`);

execFileSync('tar', ['czf', out, '-C', config.root, 'data', '.session', 'content/posts', '.env', 'secrets'],
  { stdio: 'inherit' });
console.log(`백업 완료: ${out} (${(statSync(out).size / 1024).toFixed(0)} KB)`);

// 14일 지난 백업 삭제
const cutoff = Date.now() - 14 * 864e5;
let removed = 0;
for (const f of readdirSync(dir)) {
  if (!f.startsWith('myblog-') || !f.endsWith('.tar.gz')) continue;
  const p = join(dir, f);
  if (statSync(p).mtimeMs < cutoff) { unlinkSync(p); removed++; }
}
if (removed) console.log(`오래된 백업 ${removed}개 삭제`);
