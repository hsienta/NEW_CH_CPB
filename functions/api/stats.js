// GET /api/stats — 後台資料（需 x-admin-key 標頭等於環境變數 ADMIN_KEY）
// ?format=csv 下載全部紀錄
const COLS = ['id', 'created_at', 'player_id', 'difficulty', 'duration_sec', 'final_score',
  'raw_score', 'accuracy', 'hit_rate', 'correct_spawned', 'correct_hits', 'wrong_hits',
  'bad_hits', 'l1_score', 'l2_score', 'l3_score'];
const HEAD = ['編號', '時間(UTC)', '玩家代號', '難度', '遊玩秒數', '最終分數', '原始分數',
  '正確率', '命中率', '正確食物出現數', '切對', '切錯健康食物', '切到垃圾食物',
  '第一關分數', '第二關分數', '第三關分數'];

const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
});

export async function onRequestGet({ request, env }) {
  if (!env.ADMIN_KEY) return json({ error: 'not_configured' }, 503);
  if (request.headers.get('x-admin-key') !== env.ADMIN_KEY) return json({ error: 'unauthorized' }, 401);

  const url = new URL(request.url);
  if (url.searchParams.get('format') === 'csv') {
    const { results } = await env.DB.prepare(`SELECT ${COLS.join(',')} FROM plays ORDER BY id`).all();
    const esc = v => (v == null ? '' : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
    const csv = '﻿' + [HEAD.join(','), ...results.map(r => COLS.map(c => esc(r[c])).join(','))].join('\r\n');
    return new Response(csv, {
      headers: {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': 'attachment; filename="swether-plays.csv"',
        'cache-control': 'no-store',
      },
    });
  }

  const [summary, byDiff, byDay, recent] = await env.DB.batch([
    env.DB.prepare(`SELECT COUNT(*) AS games, COUNT(DISTINCT player_id) AS players,
      AVG(final_score) AS avg_score, AVG(accuracy) AS avg_accuracy, AVG(hit_rate) AS avg_hit_rate,
      AVG(duration_sec) AS avg_duration, SUM(duration_sec) AS total_duration FROM plays`),
    env.DB.prepare(`SELECT difficulty, COUNT(*) AS games, AVG(final_score) AS avg_score,
      AVG(accuracy) AS avg_accuracy FROM plays GROUP BY difficulty`),
    env.DB.prepare(`SELECT date(created_at, '+8 hours') AS day, COUNT(*) AS games,
      COUNT(DISTINCT player_id) AS players, AVG(final_score) AS avg_score
      FROM plays GROUP BY day ORDER BY day DESC LIMIT 30`),
    env.DB.prepare(`SELECT ${COLS.join(',')} FROM plays ORDER BY id DESC LIMIT 200`),
  ]);
  return json({
    summary: summary.results[0],
    byDifficulty: byDiff.results,
    byDay: byDay.results,
    recent: recent.results,
  });
}
