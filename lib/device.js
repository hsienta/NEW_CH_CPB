// 手機（裝置）識別：每支手機一個隨機代號，不需要登入或輸入任何資料。
// 代號同時存在手機的 localStorage 和伺服器設定的 cookie（2 年）。
// iOS Safari 會在 7 天沒用時清掉網頁自己寫的 localStorage，但伺服器設的 cookie 不受影響，
// 所以以 cookie 為準，再把正確的代號回傳給手機。
const PID_RE = /^[A-Za-z0-9-]{8,64}$/;

export const validPid = v => typeof v === 'string' && PID_RE.test(v);

export function cookiePid(request) {
  const m = (request.headers.get('cookie') || '').match(/(?:^|;\s*)swether_pid=([^;]+)/);
  return m && validPid(m[1]) ? m[1] : null;
}

export const resolvePid = (request, clientPid) =>
  cookiePid(request) || (validPid(clientPid) ? clientPid : crypto.randomUUID());

export const pidCookie = pid =>
  `swether_pid=${pid}; Path=/; Max-Age=63072000; Secure; HttpOnly; SameSite=Lax`;

// 手機回報的時間（ISO UTC）轉成 D1 的 'YYYY-MM-DD HH:MM:SS'。
// 格式錯誤、比現在晚超過 10 分鐘、或早於一年前就回傳 null（呼叫端改用伺服器時間）。
export const clientTime = v => {
  const t = typeof v === 'string' ? Date.parse(v) : NaN;
  const now = Date.now();
  if (!Number.isFinite(t) || t > now + 10 * 60e3 || t < now - 365 * 864e5) return null;
  return new Date(t).toISOString().slice(0, 19).replace('T', ' ');
};

export const cleanStr = (v, max) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);

export const touchDevice = (db, pid, info) => db.prepare(
  `INSERT INTO devices (id, info) VALUES (?, ?)
   ON CONFLICT(id) DO UPDATE SET last_seen = datetime('now'), info = COALESCE(excluded.info, devices.info)`
).bind(pid, cleanStr(info, 120));

export const isAdmin = (request, env) =>
  !!env.ADMIN_KEY && request.headers.get('x-admin-key') === env.ADMIN_KEY;

export const json = (data, status = 200, headers = {}) => new Response(JSON.stringify(data), {
  status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...headers },
});
