// POST /api/device-label — 後台幫手機取名字（例如「王奶奶」）。需 x-admin-key。
// body: { ids: [手機代號...], label: "名稱" }；label 空白代表清除名稱。
// 同一個人有兩支手機（或同一支手機用不同瀏覽器）時，取同一個名字就會合併統計。
import { validPid, cleanStr, isAdmin, json } from '../../lib/device.js';

export async function onRequestPost({ request, env }) {
  if (!env.ADMIN_KEY) return json({ error: 'not_configured' }, 503);
  if (!isAdmin(request, env)) return json({ error: 'unauthorized' }, 401);
  let d;
  try { d = await request.json(); } catch { return json({ error: 'bad_json' }, 400); }
  const ids = (Array.isArray(d.ids) ? d.ids : []).filter(validPid).slice(0, 50);
  if (!ids.length) return json({ error: 'no_ids' }, 400);
  const label = cleanStr(d.label, 40);
  await env.DB.batch(ids.map(id => env.DB.prepare(
    `INSERT INTO devices (id, label) VALUES (?, ?)
     ON CONFLICT(id) DO UPDATE SET label = excluded.label`
  ).bind(id, label)));
  return json({ ok: true });
}
