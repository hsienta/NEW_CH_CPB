// POST /api/session — 使用紀錄（黏著度）：每次開啟遊戲一筆，使用中定期更新。
// body: { session_id, player_id, started_at, last_active_at, active_sec, games, source,
//         visible_sec, idle_count, max_no_touch_sec, ended_at, end_reason, exit_screen, away_sec }
// 同一個 session_id 重送（補傳、定期更新）只會更新同一筆：
//   秒數、次數取較大值；結束時間取較晚的，結束方式／離開畫面跟著最晚的結束時間走。
import { resolvePid, pidCookie, cleanStr, clientTime, json } from '../../lib/device.js';

const SID_RE = /^[A-Za-z0-9-]{8,64}$/;
const int = (v, max) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(max, Math.max(0, n)) : 0;
};
const intOrNull = (v, max) => (v == null || v === '' ? null : int(v, max));
const DAY = 24 * 3600;

export async function onRequestPost({ request, env }) {
  let d;
  try { d = await request.json(); } catch { return json({ error: 'bad_json' }, 400); }
  if (!SID_RE.test(d.session_id || '')) return json({ error: 'bad_session_id' }, 400);
  const pid = resolvePid(request, d.player_id);
  await env.DB.prepare(
    `INSERT INTO sessions (id, player_id, started_at, last_active_at, active_sec, games, source,
       visible_sec, idle_count, max_no_touch_sec, ended_at, end_reason, exit_screen, away_sec)
     VALUES (?, ?, COALESCE(?, datetime('now')), COALESCE(?, datetime('now')), ?, ?, ?,
       ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       last_active_at = MAX(COALESCE(sessions.last_active_at, ''), excluded.last_active_at),
       active_sec = MAX(sessions.active_sec, excluded.active_sec),
       games = MAX(sessions.games, excluded.games),
       visible_sec = MAX(COALESCE(sessions.visible_sec, 0), excluded.visible_sec),
       idle_count = MAX(COALESCE(sessions.idle_count, 0), excluded.idle_count),
       max_no_touch_sec = MAX(COALESCE(sessions.max_no_touch_sec, 0), excluded.max_no_touch_sec),
       end_reason = CASE WHEN excluded.ended_at >= COALESCE(sessions.ended_at, '')
                         THEN excluded.end_reason ELSE sessions.end_reason END,
       exit_screen = CASE WHEN excluded.ended_at >= COALESCE(sessions.ended_at, '')
                          THEN excluded.exit_screen ELSE sessions.exit_screen END,
       ended_at = NULLIF(MAX(COALESCE(sessions.ended_at, ''), COALESCE(excluded.ended_at, '')), ''),
       away_sec = COALESCE(sessions.away_sec, excluded.away_sec),
       updated_at = datetime('now')`
  ).bind(
    d.session_id, pid,
    clientTime(d.started_at), clientTime(d.last_active_at),
    int(d.active_sec, 6 * 3600),   // 單次最多算 6 小時
    int(d.games, 500),
    cleanStr(d.source, 20),
    int(d.visible_sec, 12 * 3600),
    int(d.idle_count, 1000),
    int(d.max_no_touch_sec, 12 * 3600),
    clientTime(d.ended_at),
    cleanStr(d.end_reason, 20),
    cleanStr(d.exit_screen, 20),
    intOrNull(d.away_sec, 365 * DAY),
  ).run();
  return json({ ok: true, pid }, 200, { 'set-cookie': pidCookie(pid) });
}
