// POST /api/device — 遊戲開啟時呼叫：確認這支手機的代號並記錄裝置資訊
import { resolvePid, pidCookie, touchDevice, json } from '../../lib/device.js';

export async function onRequestPost({ request, env }) {
  let d = {};
  try { d = await request.json(); } catch {}
  const pid = resolvePid(request, d.pid);
  await touchDevice(env.DB, pid, d.info).run();
  return json({ pid }, 200, { 'set-cookie': pidCookie(pid) });
}
