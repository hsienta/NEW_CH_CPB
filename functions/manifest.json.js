// GET /manifest.json — 依手機回傳 manifest：把這支手機的代號放進 start_url。
// iPhone「加入主畫面」後，桌面 App 和 Safari 的資料是分開的；
// 桌面 App 第一次開啟時從 start_url 的 ?pid= 取得同一組代號，就會記成同一支手機。
// 代號來源：伺服器 cookie 優先，其次是網址參數 ?pid=（頁面確認代號後會把它加到 manifest 連結上）。
import { cookiePid, validPid } from '../lib/device.js';

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const res = await env.ASSETS.fetch(new URL('/manifest.json', url.origin));
  if (!res.ok) return res;
  const manifest = await res.json();
  const qp = url.searchParams.get('pid');
  const pid = cookiePid(request) || (validPid(qp) ? qp : null);
  if (pid) manifest.start_url = './?pid=' + encodeURIComponent(pid);
  return new Response(JSON.stringify(manifest), {
    headers: {
      'content-type': 'application/manifest+json; charset=utf-8',
      'cache-control': 'private, no-store',
    },
  });
}
