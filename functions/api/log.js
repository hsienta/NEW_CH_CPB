// POST /api/log — 接收一局遊戲的紀錄並寫入 D1（binding: DB）
const int = (v, min = 0, max = 1e7) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : null;
};
const ratio = v => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : null;
};
const str = (v, max) => (typeof v === 'string' ? v.slice(0, max) : null);

// 手機回報的實際遊玩時間（UTC），轉成 D1 的 'YYYY-MM-DD HH:MM:SS'。
// 格式錯誤、比現在晚超過 10 分鐘、或早於一年前就不採用，改用伺服器收到的時間。
const playedAt = v => {
  const t = typeof v === 'string' ? Date.parse(v) : NaN;
  const now = Date.now();
  if (!Number.isFinite(t) || t > now + 10 * 60e3 || t < now - 365 * 864e5) return null;
  return new Date(t).toISOString().slice(0, 19).replace('T', ' ');
};

export async function onRequestPost({ request, env }) {
  let d;
  try {
    d = await request.json();
  } catch {
    return new Response('bad json', { status: 400 });
  }
  const levels = Array.isArray(d.levels) ? d.levels.slice(0, 3).map(l => ({
    level: int(l?.level, 1, 3),
    score: int(l?.score),
    spawned: int(l?.spawned),
    hits: int(l?.hits),
    wrong: int(l?.wrong),
    bad: int(l?.bad),
  })) : [];
  const lv = i => levels[i]?.score ?? null;

  await env.DB.prepare(
    `INSERT OR IGNORE INTO plays (log_id, played_at, player_id, difficulty, duration_sec, final_score, raw_score,
      accuracy, hit_rate, correct_spawned, correct_hits, wrong_hits, bad_hits,
      l1_score, l2_score, l3_score, levels_json, user_agent)
     VALUES (?,COALESCE(?,datetime('now')),?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
  ).bind(
    str(d.log_id, 64),
    playedAt(d.played_at),
    str(d.player_id, 64),
    d.difficulty === 'expert' ? 'expert' : 'novice',
    int(d.duration_sec, 0, 86400),
    int(d.final_score),
    int(d.raw_score),
    ratio(d.accuracy),
    ratio(d.hit_rate),
    int(d.correct_spawned),
    int(d.correct_hits),
    int(d.wrong_hits),
    int(d.bad_hits),
    lv(0), lv(1), lv(2),
    JSON.stringify(levels),
    str(request.headers.get('user-agent'), 300),
  ).run();

  return new Response(JSON.stringify({ ok: true }), {
    headers: { 'content-type': 'application/json' },
  });
}
