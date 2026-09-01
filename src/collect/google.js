// Google API 클라이언트 공용 초기화.
import '../core/net.js';
import { existsSync } from 'node:fs';
import { google } from 'googleapis';
import { config } from '../core/config.js';

let cached;
export async function authClient() {
  if (cached) return cached;
  if (!existsSync(config.google.serviceAccountPath)) {
    throw new Error(`서비스계정 JSON 이 없습니다: ${config.google.serviceAccountPath}`);
  }
  const auth = new google.auth.GoogleAuth({
    keyFile: config.google.serviceAccountPath,
    scopes: [
      'https://www.googleapis.com/auth/webmasters.readonly',
      'https://www.googleapis.com/auth/analytics.readonly',
    ],
  });
  return (cached = await auth.getClient());
}

export const ymd = (d) => d.toISOString().slice(0, 10);
export const daysAgo = (n) => ymd(new Date(Date.now() - n * 864e5));

/** 글 URL/경로를 posts.id 로 매핑한다. 티스토리 글 주소는 /{번호} 형태. */
export function postIdResolver(db) {
  const rows = db.prepare("SELECT id, url FROM posts WHERE url IS NOT NULL AND url != ''").all();
  const byPath = new Map();
  for (const r of rows) {
    try { byPath.set(new URL(r.url).pathname.replace(/\/$/, ''), r.id); } catch { /* 잘못된 url 무시 */ }
  }
  return (urlOrPath) => {
    if (!urlOrPath) return null;
    let path = urlOrPath;
    if (/^https?:\/\//.test(urlOrPath)) {
      try { path = new URL(urlOrPath).pathname; } catch { return null; }
    }
    return byPath.get(path.replace(/\/$/, '')) ?? null;
  };
}
