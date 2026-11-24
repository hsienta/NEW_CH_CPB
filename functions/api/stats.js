// GET /api/stats — 後台資料（需 x-admin-key 標頭等於環境變數 ADMIN_KEY）
// ?format=csv 下載全部紀錄
// 所有時間以「實際遊玩時間」played_at 為準，換算成台灣時間（UTC+8）。
const TW = `datetime(played_at, '+8 hours')`;

const CSV_COLS = [
  ['id', '編號'],
  [`${TW} AS played_tw`, '遊玩時間(台灣)'],
  [`datetime(created_at, '+8 hours') AS uploaded_tw`, '上傳時間(台灣)'],
  ['player_id', '玩家代號'],
  ['difficulty', '難度'],
  ['duration_sec', '遊玩秒數'],
  ['final_score', '最終分數'],
  ['raw_score', '原始分數'],
  ['accuracy', '正確率'],
  ['hit_rate', '命中率'],
  ['correct_spawned', '正確食物出現數'],
  ['correct_hits', '切對'],
  ['wrong_hits', '切錯健康食物'],
  ['bad_hits', '切到垃圾食物'],
  ['l1_score', '第一關分數'],
  ['l2_score', '第二關分數'],
  ['l3_score', '第三關分數'],
];
const key = expr => expr.split(' AS ').pop();

const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
});

export async function onRequestGet({ request, env }) {
  if (!env.ADMIN_KEY) return json({ error: 'not_configured' }, 503);
  if (request.headers.get('x-admin-key') !== env.ADMIN_KEY) return json({ error: 'unauthorized' }, 401);

  const url = new URL(request.url);
  if (url.searchParams.get('format') === 'csv') {
    const { results } = await env.DB.prepare(
      `SELECT ${CSV_COLS.map(c => c[0]).join(',')} FROM plays ORDER BY played_at, id`
    ).all();
    const esc = v => (v == null ? '' : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
    const csv = '﻿' + [
      CSV_COLS.map(c => c[1]).join(','),
      ...results.map(r => CSV_COLS.map(c => esc(r[key(c[0])])).join(',')),
    ].join('\r\n');
    return new Response(csv, {
      headers: {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': 'attachment; filename="swether-plays.csv"',
        'cache-control': 'no-store',
      },
    });
  }

  const agg = `COUNT(*) AS games, COUNT(DISTINCT player_id) AS players,
    AVG(final_score) AS avg_score, AVG(accuracy) AS avg_accuracy`;
  const [summary, byDiff, byDay, byWeek, byWeekday, byTimeOfDay, recent] = await env.DB.batch([
    env.DB.prepare(`SELECT ${agg}, AVG(hit_rate) AS avg_hit_rate,
      AVG(duration_sec) AS avg_duration, SUM(duration_sec) AS total_duration FROM plays`),
    env.DB.prepare(`SELECT difficulty, ${agg} FROM plays GROUP BY difficulty`),
    env.DB.prepare(`SELECT date(${TW}) AS day, ${agg}
      FROM plays GROUP BY day ORDER BY day DESC LIMIT 30`),
    // 週一為一週的開始
    env.DB.prepare(`SELECT date(${TW}, '-6 days', 'weekday 1') AS week, ${agg}
      FROM plays GROUP BY week ORDER BY week DESC LIMIT 12`),
    env.DB.prepare(`SELECT CAST(strftime('%w', ${TW}) AS INTEGER) AS weekday, ${agg}
      FROM plays GROUP BY weekday`),
    env.DB.prepare(`SELECT CASE
        WHEN h BETWEEN 5 AND 7 THEN 0
        WHEN h BETWEEN 8 AND 11 THEN 1
        WHEN h BETWEEN 12 AND 16 THEN 2
        WHEN h BETWEEN 17 AND 20 THEN 3
        ELSE 4 END AS slot, ${agg}
      FROM (SELECT *, CAST(strftime('%H', ${TW}) AS INTEGER) AS h FROM plays)
      GROUP BY slot`),
    env.DB.prepare(`SELECT id, ${TW} AS played_tw, player_id, difficulty, duration_sec, final_score,
      accuracy, hit_rate, correct_hits, wrong_hits, bad_hits, l1_score, l2_score, l3_score
      FROM plays ORDER BY played_at DESC, id DESC LIMIT 200`),
  ]);
  return json({
    summary: summary.results[0],
    byDifficulty: byDiff.results,
    byDay: byDay.results,
    byWeek: byWeek.results,
    byWeekday: byWeekday.results,
    byTimeOfDay: byTimeOfDay.results,
    recent: recent.results,
  });
}
