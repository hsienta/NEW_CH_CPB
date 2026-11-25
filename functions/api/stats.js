// GET /api/stats — 後台資料（需 x-admin-key 標頭等於環境變數 ADMIN_KEY）
//   ?players=代號1,代號2  只看這些手機（同一個人的多支手機）
//   ?format=csv           下載全部紀錄
// 所有時間以「實際遊玩時間」played_at 為準，換算成台灣時間（UTC+8）。
import { validPid, isAdmin, json } from '../../lib/device.js';

const TW = `datetime(played_at, '+8 hours')`;
const CODE = `upper(substr(replace(p.player_id, '-', ''), 1, 6))`;

const CSV_COLS = [
  ['p.id AS id', '編號'],
  [`datetime(p.played_at, '+8 hours') AS played_tw`, '遊玩時間(台灣)'],
  [`datetime(p.created_at, '+8 hours') AS uploaded_tw`, '上傳時間(台灣)'],
  [`d.label AS label`, '名稱'],
  [`${CODE} AS code`, '手機代號'],
  ['d.info AS info', '手機型號'],
  ['p.difficulty AS difficulty', '難度'],
  ['p.duration_sec AS duration_sec', '遊玩秒數'],
  ['p.final_score AS final_score', '最終分數'],
  ['p.raw_score AS raw_score', '原始分數'],
  ['p.accuracy AS accuracy', '正確率'],
  ['p.hit_rate AS hit_rate', '命中率'],
  ['p.correct_spawned AS correct_spawned', '正確食物出現數'],
  ['p.correct_hits AS correct_hits', '切對'],
  ['p.wrong_hits AS wrong_hits', '切錯健康食物'],
  ['p.bad_hits AS bad_hits', '切到垃圾食物'],
  ['p.l1_score AS l1_score', '第一關分數'],
  ['p.l2_score AS l2_score', '第二關分數'],
  ['p.l3_score AS l3_score', '第三關分數'],
  ['p.player_id AS player_id', '完整代號'],
];
const key = expr => expr.split(' AS ').pop();

export async function onRequestGet({ request, env }) {
  if (!env.ADMIN_KEY) return json({ error: 'not_configured' }, 503);
  if (!isAdmin(request, env)) return json({ error: 'unauthorized' }, 401);

  const url = new URL(request.url);
  if (url.searchParams.get('format') === 'csv') {
    const { results } = await env.DB.prepare(
      `SELECT ${CSV_COLS.map(c => c[0]).join(',')}
       FROM plays p LEFT JOIN devices d ON d.id = p.player_id
       ORDER BY p.played_at, p.id`
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

  // 篩選：只看某些手機
  const ids = (url.searchParams.get('players') || '').split(',').filter(validPid).slice(0, 50);
  const SRC = ids.length ? `(SELECT * FROM plays WHERE player_id IN (${ids.map(() => '?').join(',')}))` : 'plays';
  const q = sql => env.DB.prepare(sql).bind(...(sql.includes(SRC) && ids.length ? ids : []));

  const agg = `COUNT(*) AS games, COUNT(DISTINCT player_id) AS players,
    AVG(final_score) AS avg_score, AVG(accuracy) AS avg_accuracy`;
  const [summary, byDiff, byDay, byWeek, byWeekday, byTimeOfDay, recent, byDevice] = await env.DB.batch([
    q(`SELECT ${agg}, AVG(hit_rate) AS avg_hit_rate,
      AVG(duration_sec) AS avg_duration, SUM(duration_sec) AS total_duration FROM ${SRC}`),
    q(`SELECT difficulty, ${agg} FROM ${SRC} GROUP BY difficulty`),
    q(`SELECT date(${TW}) AS day, ${agg}
      FROM ${SRC} GROUP BY day ORDER BY day DESC LIMIT 30`),
    // 週一為一週的開始
    q(`SELECT date(${TW}, '-6 days', 'weekday 1') AS week, ${agg}
      FROM ${SRC} GROUP BY week ORDER BY week DESC LIMIT 12`),
    q(`SELECT CAST(strftime('%w', ${TW}) AS INTEGER) AS weekday, ${agg}
      FROM ${SRC} GROUP BY weekday`),
    q(`SELECT CASE
        WHEN h BETWEEN 5 AND 7 THEN 0
        WHEN h BETWEEN 8 AND 11 THEN 1
        WHEN h BETWEEN 12 AND 16 THEN 2
        WHEN h BETWEEN 17 AND 20 THEN 3
        ELSE 4 END AS slot, ${agg}
      FROM (SELECT *, CAST(strftime('%H', ${TW}) AS INTEGER) AS h FROM ${SRC})
      GROUP BY slot`),
    q(`SELECT id, ${TW} AS played_tw, player_id, difficulty, duration_sec, final_score,
      accuracy, hit_rate, correct_hits, wrong_hits, bad_hits, l1_score, l2_score, l3_score
      FROM ${SRC} ORDER BY played_at DESC, id DESC LIMIT 200`),
    // 每支手機（取了相同名稱的手機合併成一列）；不受篩選影響
    env.DB.prepare(`SELECT COALESCE(NULLIF(d.label, ''), p.player_id) AS grp,
        MAX(d.label) AS label,
        GROUP_CONCAT(DISTINCT p.player_id) AS ids,
        MAX(d.info) AS info,
        COUNT(*) AS games, AVG(p.final_score) AS avg_score, AVG(p.accuracy) AS avg_accuracy,
        datetime(MIN(p.played_at), '+8 hours') AS first_tw,
        datetime(MAX(p.played_at), '+8 hours') AS last_tw
      FROM plays p LEFT JOIN devices d ON d.id = p.player_id
      WHERE p.player_id IS NOT NULL
      GROUP BY grp ORDER BY MAX(p.played_at) DESC LIMIT 500`),
  ]);
  return json({
    filter: ids,
    summary: summary.results[0],
    byDifficulty: byDiff.results,
    byDay: byDay.results,
    byWeek: byWeek.results,
    byWeekday: byWeekday.results,
    byTimeOfDay: byTimeOfDay.results,
    recent: recent.results,
    byDevice: byDevice.results.map(r => ({ ...r, ids: String(r.ids || '').split(',').filter(Boolean).sort() })),
  });
}
