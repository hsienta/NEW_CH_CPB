// POST /api/session — 使用紀錄（黏著度）：每次開啟遊戲一筆，使用中定期更新。
// body: { session_id, player_id, started_at, last_active_at, active_sec, games, source }
// 同一個 session_id 重送（補傳、定期更新）只會更新同一筆，使用秒數與局數取較大值。
import { resolvePid, pidCookie, cleanStr, clientTime, json } from '../../lib/device.js';

const SID_RE = /^[A-Za-z0-9-]{8,64}$/;
const int = (v, max) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(max, Math.max(0, n)) : 0;
};

export async function onRequestPost({ request, env }) {
  let d;
  try { d = await request.json(); } catch { return json({ error: 'bad_json' }, 400); }
  if (!SID_RE.test(d.session_id || '')) return json({ error: 'bad_session_id' }, 400);
  const pid = resolvePid(request, d.player_id);
  await env.DB.prepare(
    `INSERT INTO sessions (id, player_id, started_at, last_active_at, active_sec, games, source)
     VALUES (?, ?, COALESCE(?, datetime('now')), COALESCE(?, datetime('now')), ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       last_active_at = MAX(COALESCE(sessions.last_active_at, ''), excluded.last_active_at),
       active_sec = MAX(sessions.active_sec, excluded.active_sec),
       games = MAX(sessions.games, excluded.games),
       updated_at = datetime('now')`
  ).bind(
    d.session_id, pid,
    clientTime(d.started_at), clientTime(d.last_active_at),
    int(d.active_sec, 6 * 3600),   // 單次最多算 6 小時
    int(d.games, 500),
    cleanStr(d.source, 20),
  ).run();
  return json({ ok: true, pid }, 200, { 'set-cookie': pidCookie(pid) });
}
