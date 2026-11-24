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
    `INSERT INTO plays (player_id, difficulty, duration_sec, final_score, raw_score,
      accuracy, hit_rate, correct_spawned, correct_hits, wrong_hits, bad_hits,
      l1_score, l2_score, l3_score, levels_json, user_agent)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
  ).bind(
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
