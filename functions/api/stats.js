// GET /api/stats — 後台資料（需 x-admin-key 標頭等於環境變數 ADMIN_KEY）
//   ?players=代號1,代號2        只看這些手機（同一個人的多支手機）
//   ?format=csv                 下載全部遊玩紀錄（每局一筆）
//   ?format=csv&table=sessions  下載全部開啟紀錄（每次開啟一筆）
// 時間一律換算成台灣時間（UTC+8）：遊玩以 played_at、開啟以 started_at 為準。
import { validPid, isAdmin, json } from '../../lib/device.js';

const TW_P = `datetime(played_at, '+8 hours')`;
const TW_S = `datetime(started_at, '+8 hours')`;
const CODE = `upper(substr(replace(x.player_id, '-', ''), 1, 6))`;
const SLOT = h => `CASE
    WHEN ${h} BETWEEN 5 AND 7 THEN 0
    WHEN ${h} BETWEEN 8 AND 11 THEN 1
    WHEN ${h} BETWEEN 12 AND 16 THEN 2
    WHEN ${h} BETWEEN 17 AND 20 THEN 3
    ELSE 4 END`;

const CSV = {
  plays: {
    file: 'swether-plays.csv',
    from: 'plays x',
    order: 'x.played_at, x.id',
    cols: [
      ['x.id AS id', '編號'],
      [`datetime(x.played_at, '+8 hours') AS played_tw`, '遊玩時間(台灣)'],
      [`datetime(x.created_at, '+8 hours') AS uploaded_tw`, '上傳時間(台灣)'],
      ['d.label AS label', '名稱'],
      [`${CODE} AS code`, '手機代號'],
      ['d.info AS info', '手機型號'],
      ['x.difficulty AS difficulty', '難度'],
      ['x.duration_sec AS duration_sec', '遊玩秒數'],
      ['x.final_score AS final_score', '最終分數'],
      ['x.raw_score AS raw_score', '原始分數'],
      ['x.accuracy AS accuracy', '正確率'],
      ['x.hit_rate AS hit_rate', '命中率'],
      ['x.correct_spawned AS correct_spawned', '正確食物出現數'],
      ['x.correct_hits AS correct_hits', '切對'],
      ['x.wrong_hits AS wrong_hits', '切錯健康食物'],
      ['x.bad_hits AS bad_hits', '切到垃圾食物'],
      ['x.l1_score AS l1_score', '第一關分數'],
      ['x.l2_score AS l2_score', '第二關分數'],
      ['x.l3_score AS l3_score', '第三關分數'],
      ['x.player_id AS player_id', '完整代號'],
    ],
  },
  sessions: {
    file: 'swether-sessions.csv',
    from: 'sessions x',
    order: 'x.started_at, x.id',
    cols: [
      [`datetime(x.started_at, '+8 hours') AS started_tw`, '開啟時間(台灣)'],
      [`datetime(x.last_active_at, '+8 hours') AS last_tw`, '最後使用時間(台灣)'],
      ['d.label AS label', '名稱'],
      [`${CODE} AS code`, '手機代號'],
      ['d.info AS info', '手機型號'],
      ['x.active_sec AS active_sec', '使用秒數'],
      ['x.games AS games', '玩完局數'],
      ['x.source AS source', '開啟方式'],
      ['x.visible_sec AS visible_sec', '畫面開著秒數'],
      [`MAX(0, COALESCE(x.visible_sec, x.active_sec) - x.active_sec) AS idle_sec`, '放著不動秒數'],
      ['x.idle_count AS idle_count', '放著不動次數'],
      ['x.max_no_touch_sec AS max_no_touch_sec', '最長沒碰螢幕秒數'],
      [`datetime(x.ended_at, '+8 hours') AS ended_tw`, '離開時間(台灣)'],
      ['x.end_reason AS end_reason', '離開方式'],
      ['x.exit_screen AS exit_screen', '離開時的畫面'],
      ['x.away_sec AS away_sec', '距離上次離開秒數'],
      ['x.player_id AS player_id', '完整代號'],
    ],
  },
};
const key = expr => expr.split(' AS ').pop();

async function csvResponse(env, spec) {
  const { results } = await env.DB.prepare(
    `SELECT ${spec.cols.map(c => c[0]).join(',')}
     FROM ${spec.from} LEFT JOIN devices d ON d.id = x.player_id
     ORDER BY ${spec.order}`
  ).all();
  const esc = v => (v == null ? '' : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
  const csv = '\uFEFF' + [
    spec.cols.map(c => c[1]).join(','),
    ...results.map(r => spec.cols.map(c => esc(r[key(c[0])])).join(',')),
  ].join('\r\n');
  return new Response(csv, {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="${spec.file}"`,
      'cache-control': 'no-store',
    },
  });
}

export async function onRequestGet({ request, env }) {
  if (!env.ADMIN_KEY) return json({ error: 'not_configured' }, 503);
  if (!isAdmin(request, env)) return json({ error: 'unauthorized' }, 401);

  const url = new URL(request.url);
  if (url.searchParams.get('format') === 'csv') {
    return csvResponse(env, url.searchParams.get('table') === 'sessions' ? CSV.sessions : CSV.plays);
  }

  // 篩選：只看某些手機
  const ids = (url.searchParams.get('players') || '').split(',').filter(validPid).slice(0, 50);
  const IN = ids.length ? `player_id IN (${ids.map(() => '?').join(',')})` : '';
  const P = IN ? `(SELECT * FROM plays WHERE ${IN})` : 'plays';
  const S = IN ? `(SELECT * FROM sessions WHERE ${IN})` : 'sessions';
  const q = sql => {
    const n = IN ? sql.split(IN).length - 1 : 0;
    return env.DB.prepare(sql).bind(...Array.from({ length: n }, () => ids).flat());
  };

  const pAgg = `COUNT(*) AS games, COUNT(DISTINCT player_id) AS players,
    AVG(final_score) AS avg_score, AVG(accuracy) AS avg_accuracy`;
  const sAgg = `COUNT(*) AS opens, COUNT(DISTINCT player_id) AS devices,
    SUM(active_sec) AS total_sec, AVG(active_sec) AS avg_sec`;

  const IDLE = `MAX(0, COALESCE(visible_sec, active_sec) - active_sec)`;
  const [
    summary, sSummary, byExit, byDiff,
    byDay, sByDay, byWeek, sByWeek, byWeekday, sByWeekday, byTimeOfDay, sByTimeOfDay,
    recent, recentSessions, byDevice,
  ] = await env.DB.batch([
    q(`SELECT ${pAgg}, AVG(hit_rate) AS avg_hit_rate,
      AVG(duration_sec) AS avg_duration, SUM(duration_sec) AS total_duration FROM ${P}`),
    q(`SELECT ${sAgg}, COUNT(DISTINCT player_id || '|' || date(${TW_S})) AS device_days,
      AVG(COALESCE(visible_sec, active_sec)) AS avg_visible_sec, AVG(${IDLE}) AS avg_idle_sec,
      SUM(CASE WHEN idle_count > 0 THEN 1 ELSE 0 END) AS idle_visits,
      AVG(away_sec) AS avg_away_sec FROM ${S}`),
    // 離開時在哪個畫面（只算有記錄到離開的）
    q(`SELECT exit_screen, COUNT(*) AS opens, AVG(active_sec) AS avg_sec, AVG(${IDLE}) AS avg_idle_sec,
      SUM(games) AS games FROM ${S} WHERE exit_screen IS NOT NULL GROUP BY exit_screen ORDER BY opens DESC`),
    q(`SELECT difficulty, ${pAgg} FROM ${P} GROUP BY difficulty`),

    q(`SELECT date(${TW_P}) AS day, ${pAgg} FROM ${P} GROUP BY day ORDER BY day DESC LIMIT 30`),
    q(`SELECT date(${TW_S}) AS day, ${sAgg}, GROUP_CONCAT(t, '、') AS times
      FROM (SELECT *, strftime('%H:%M', ${TW_S}) AS t FROM ${S} ORDER BY started_at)
      GROUP BY day ORDER BY day DESC LIMIT 30`),
    // 週一為一週的開始
    q(`SELECT date(${TW_P}, '-6 days', 'weekday 1') AS week, ${pAgg} FROM ${P} GROUP BY week ORDER BY week DESC LIMIT 12`),
    q(`SELECT date(${TW_S}, '-6 days', 'weekday 1') AS week, ${sAgg},
      COUNT(DISTINCT player_id || '|' || date(${TW_S})) AS device_days
      FROM ${S} GROUP BY week ORDER BY week DESC LIMIT 12`),
    q(`SELECT CAST(strftime('%w', ${TW_P}) AS INTEGER) AS weekday, ${pAgg} FROM ${P} GROUP BY weekday`),
    q(`SELECT CAST(strftime('%w', ${TW_S}) AS INTEGER) AS weekday, ${sAgg} FROM ${S} GROUP BY weekday`),
    q(`SELECT ${SLOT('h')} AS slot, ${pAgg}
      FROM (SELECT *, CAST(strftime('%H', ${TW_P}) AS INTEGER) AS h FROM ${P}) GROUP BY slot`),
    q(`SELECT ${SLOT('h')} AS slot, ${sAgg}
      FROM (SELECT *, CAST(strftime('%H', ${TW_S}) AS INTEGER) AS h FROM ${S}) GROUP BY slot`),

    q(`SELECT id, ${TW_P} AS played_tw, player_id, difficulty, duration_sec, final_score,
      accuracy, hit_rate, correct_hits, wrong_hits, bad_hits, l1_score, l2_score, l3_score
      FROM ${P} ORDER BY played_at DESC, id DESC LIMIT 200`),
    q(`SELECT ${TW_S} AS started_tw, player_id, active_sec, games, source,
      visible_sec, ${IDLE} AS idle_sec, idle_count, max_no_touch_sec,
      datetime(ended_at, '+8 hours') AS ended_tw, end_reason, exit_screen, away_sec
      FROM ${S} ORDER BY started_at DESC LIMIT 200`),

    // 每支手機（取了相同名稱的手機合併成一列）；不受篩選影響。
    // 包含「有開啟但還沒玩完一局」的手機。
    env.DB.prepare(`WITH
      lab AS (SELECT id, NULLIF(label, '') AS label, info FROM devices),
      p AS (SELECT COALESCE(lab.label, x.player_id) AS grp, COUNT(*) AS games,
              AVG(x.final_score) AS avg_score, AVG(x.accuracy) AS avg_accuracy,
              MIN(x.played_at) AS first_at, MAX(x.played_at) AS last_at
            FROM plays x LEFT JOIN lab ON lab.id = x.player_id
            WHERE x.player_id IS NOT NULL GROUP BY grp),
      s AS (SELECT COALESCE(lab.label, x.player_id) AS grp, COUNT(*) AS opens,
              SUM(x.active_sec) AS total_sec, AVG(x.active_sec) AS avg_sec,
              COUNT(DISTINCT date(x.started_at, '+8 hours')) AS active_days,
              COUNT(DISTINCT CASE WHEN x.started_at >= datetime('now', '-7 days')
                THEN date(x.started_at, '+8 hours') END) AS days7,
              MIN(x.started_at) AS first_at, MAX(x.started_at) AS last_at
            FROM sessions x LEFT JOIN lab ON lab.id = x.player_id
            WHERE x.player_id IS NOT NULL GROUP BY grp),
      u AS (SELECT player_id FROM plays WHERE player_id IS NOT NULL
            UNION SELECT player_id FROM sessions WHERE player_id IS NOT NULL),
      g AS (SELECT COALESCE(lab.label, u.player_id) AS grp, MAX(lab.label) AS label,
              GROUP_CONCAT(u.player_id) AS ids, MAX(lab.info) AS info
            FROM u LEFT JOIN lab ON lab.id = u.player_id GROUP BY grp)
      SELECT g.label, g.ids, g.info,
        COALESCE(p.games, 0) AS games, p.avg_score, p.avg_accuracy,
        COALESCE(s.opens, 0) AS opens, COALESCE(s.total_sec, 0) AS total_sec, s.avg_sec,
        COALESCE(s.active_days, 0) AS active_days, COALESCE(s.days7, 0) AS days7,
        datetime(NULLIF(max(COALESCE(p.last_at, ''), COALESCE(s.last_at, '')), ''), '+8 hours') AS last_tw,
        datetime(NULLIF(min(COALESCE(p.first_at, '9'), COALESCE(s.first_at, '9')), '9'), '+8 hours') AS first_tw
      FROM g LEFT JOIN p ON p.grp = g.grp LEFT JOIN s ON s.grp = g.grp
      ORDER BY last_tw DESC LIMIT 500`),
  ]);

  return json({
    filter: ids,
    summary: summary.results[0],
    usage: sSummary.results[0],
    byExitScreen: byExit.results,
    byDifficulty: byDiff.results,
    byDay: byDay.results,
    usageByDay: sByDay.results,
    byWeek: byWeek.results,
    usageByWeek: sByWeek.results,
    byWeekday: byWeekday.results,
    usageByWeekday: sByWeekday.results,
    byTimeOfDay: byTimeOfDay.results,
    usageByTimeOfDay: sByTimeOfDay.results,
    recent: recent.results,
    recentSessions: recentSessions.results,
    byDevice: byDevice.results.map(r => ({ ...r, ids: String(r.ids || '').split(',').filter(Boolean).sort() })),
  });
}
