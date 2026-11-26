/**
 * 營養切切樂：每天晚上 12 點左右，把後台資料同步到 Google Drive 資料夾。
 *
 * 會在資料夾裡建立／更新：
 *   1. Google 試算表「營養切切樂 遊玩紀錄」，分頁：
 *      摘要、每支手機、每日（最近 30 天，含每次開啟的時間點）、每週、開啟紀錄（每次開啟一筆）、遊玩紀錄（每局一筆）
 *   2. 子資料夾「每日備份」裡當天的兩個 CSV（開啟紀錄、遊玩紀錄，保留 60 天）
 *
 * 安裝（只要做一次，需用電腦）：
 *   1. 打開 https://script.google.com ，按「新專案」
 *   2. 刪掉原本的程式碼，貼上這整個檔案
 *   3. 把下面 CONFIG 裡的 ADMIN_KEY 換成後台密碼（FOLDER_ID 換成雲端資料夾網址最後那串）
 *   4. 上方函式選單選「setup」，按「執行」，依畫面授權
 *      （出現「Google 尚未驗證這個應用程式」是正常的：按「進階」→「前往…（不安全）」→「允許」，
 *        因為這是你自己的程式，不是別人發布的 App）
 *   5. 完成後資料夾會立刻出現試算表，之後每晚 12 點左右自動更新
 */

const CONFIG = {
  SITE: 'https://new-ch-cpb.pages.dev',
  ADMIN_KEY: '在這裡貼上後台密碼',
  FOLDER_ID: '在這裡貼上資料夾ID',
  SHEET_NAME: '營養切切樂 遊玩紀錄',
  BACKUP_FOLDER: '每日備份',
  KEEP_BACKUP_DAYS: 60,
  TZ: 'Asia/Taipei',
};

/** 第一次安裝時執行：設定每晚自動同步，並馬上同步一次 */
function setup() {
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'syncNow')
    .forEach(t => ScriptApp.deleteTrigger(t));
  // 每天 00:00～00:30 之間執行（Google 會在這段時間內挑一個時間點）
  ScriptApp.newTrigger('syncNow')
    .timeBased().everyDays(1).atHour(0).nearMinute(15)
    .inTimezone(CONFIG.TZ)
    .create();
  syncNow();
}

/** 同步一次（每晚自動執行，也可以手動執行） */
function syncNow() {
  const folder = DriveApp.getFolderById(CONFIG.FOLDER_ID);
  const csvText = api_('/api/stats?format=csv').getContentText('UTF-8');
  const sessionsCsv = api_('/api/stats?format=csv&table=sessions').getContentText('UTF-8');
  const stats = JSON.parse(api_('/api/stats').getContentText('UTF-8'));
  const now = Utilities.formatDate(new Date(), CONFIG.TZ, 'yyyy-MM-dd HH:mm');

  const ss = getSpreadsheet_(folder);
  writeSummary_(ss, stats, now);
  writeDevices_(ss, stats.byDevice || []);
  writeDays_(ss, stats.usageByDay || [], stats.byDay || []);
  writeWeeks_(ss, stats.usageByWeek || [], stats.byWeek || []);
  writeCsvSheet_(ss, '開啟紀錄', 4, sessionsCsv,
    ['開啟時間(台灣)', '最後使用時間(台灣)', '名稱', '手機代號', '手機型號', '開啟方式', '完整代號'], []);
  writeCsvSheet_(ss, '遊玩紀錄', 5, csvText,
    ['遊玩時間(台灣)', '上傳時間(台灣)', '名稱', '手機代號', '手機型號', '難度', '完整代號'], ['正確率', '命中率']);
  removeOtherSheets_(ss, ['摘要', '每支手機', '每日', '每週', '開啟紀錄', '遊玩紀錄']);

  backupCsv_(folder, '遊玩紀錄', csvText);
  backupCsv_(folder, '開啟紀錄', sessionsCsv);
  console.log('同步完成：' + now + '，共 ' + ((stats.summary || {}).games || 0) + ' 局');
}

// ── 讀取後台 ─────────────────────────────────────────────

function api_(path) {
  const res = UrlFetchApp.fetch(CONFIG.SITE + path, {
    headers: { 'x-admin-key': CONFIG.ADMIN_KEY },
    muteHttpExceptions: true,
  });
  const code = res.getResponseCode();
  if (code === 401) throw new Error('後台密碼錯誤：請檢查 CONFIG.ADMIN_KEY 是否和 Cloudflare 設定的 ADMIN_KEY 一樣');
  if (code === 503) throw new Error('Cloudflare 還沒設定後台密碼 ADMIN_KEY');
  if (code !== 200) throw new Error('讀取後台失敗：HTTP ' + code);
  return res;
}

// ── 試算表 ───────────────────────────────────────────────

function getSpreadsheet_(folder) {
  const files = folder.getFilesByName(CONFIG.SHEET_NAME);
  while (files.hasNext()) {
    const f = files.next();
    if (f.getMimeType() === MimeType.GOOGLE_SHEETS && !f.isTrashed()) return SpreadsheetApp.open(f);
  }
  const ss = SpreadsheetApp.create(CONFIG.SHEET_NAME);
  DriveApp.getFileById(ss.getId()).moveTo(folder);
  return ss;
}

/**
 * 寫入一個分頁（整頁覆蓋）。
 * textCols：要當成文字的欄位（避免 0012AB、1E5000 這種代號被當成數字）
 * pctCols：顯示成百分比的欄位
 */
function writeSheet_(ss, name, position, rows, textCols, pctCols) {
  let sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name, position);
  sh.clear();
  if (!rows.length) return sh;
  const width = rows[0].length;
  (textCols || []).forEach(c => sh.getRange(1, c + 1, rows.length, 1).setNumberFormat('@'));
  sh.getRange(1, 1, rows.length, width).setValues(rows);
  if (rows.length > 1) {
    (pctCols || []).forEach(c => sh.getRange(2, c + 1, rows.length - 1, 1).setNumberFormat('0.0%'));
  }
  sh.getRange(1, 1, 1, width).setFontWeight('bold').setBackground('#e8f5e9');
  sh.setFrozenRows(1);
  sh.autoResizeColumns(1, width);
  return sh;
}

const codeOf_ = id => String(id || '').replace(/-/g, '').slice(0, 6).toUpperCase();
const round_ = v => (v == null ? '' : Math.round(Number(v)));
const ratio_ = v => (v == null ? '' : Number(v));

function writeSummary_(ss, stats, now) {
  const s = stats.summary || {}, u = stats.usage || {};
  const rows = [
    ['項目', '數值'],
    ['最後更新（台灣時間）', "'" + now],  // 開頭的 ' 讓它保持文字，不被轉成日期
    ['【使用情況】開啟次數', u.opens || 0],
    ['使用手機數', u.devices || 0],
    ['總使用分鐘', Math.round((u.total_sec || 0) / 60)],
    ['平均每次使用秒數', round_(u.avg_sec)],
    ['平均每支手機使用天數', u.devices ? Math.round(u.device_days / u.devices * 10) / 10 : ''],
    ['【遊戲成績】玩完局數', s.games || 0],
    ['平均分數', round_(s.avg_score)],
    ['平均正確率', ratio_(s.avg_accuracy)],
    ['平均命中率', ratio_(s.avg_hit_rate)],
    ['平均每局秒數', round_(s.avg_duration)],
    ['後台網址', CONFIG.SITE + '/admin'],
  ];
  const sh = writeSheet_(ss, '摘要', 0, rows, [], []);
  sh.getRange('B10:B11').setNumberFormat('0.0%');  // 平均正確率、平均命中率
}

function writeDevices_(ss, devices) {
  const rows = [['名稱', '手機代號', '手機型號', '開啟次數', '使用天數', '近7天用了幾天', '總使用分鐘', '平均每次使用秒數',
                 '玩完局數', '平均分數', '平均正確率', '最近一次', '第一次']]
    .concat(devices.map(d => [
      d.label || '（未取名）',
      (d.ids || []).map(codeOf_).join('、'),
      d.info || '',
      d.opens || 0,
      d.active_days || 0,
      Math.min(7, d.days7 || 0),
      Math.round((d.total_sec || 0) / 60),
      round_(d.avg_sec),
      d.games || 0,
      round_(d.avg_score),
      ratio_(d.avg_accuracy),
      d.last_tw || '',
      d.first_tw || '',
    ]));
  writeSheet_(ss, '每支手機', 1, rows, [0, 1, 2, 11, 12], [10]);
}

// 每日：開啟（使用）與玩完局數合併
function writeDays_(ss, usage, plays) {
  const u = {}, p = {};
  usage.forEach(r => { u[r.day] = r; });
  plays.forEach(r => { p[r.day] = r; });
  const days = Object.keys(Object.assign({}, u, p)).sort().reverse();
  const rows = [['日期', '開啟次數', '使用手機數', '總使用分鐘', '平均每次使用秒數', '玩完局數', '平均分數', '平均正確率', '開啟時間點']]
    .concat(days.map(d => {
      const a = u[d] || {}, b = p[d] || {};
      return [d, a.opens || 0, a.devices || 0, Math.round((a.total_sec || 0) / 60), round_(a.avg_sec),
              b.games || 0, round_(b.avg_score), ratio_(b.avg_accuracy), a.times || ''];
    }));
  writeSheet_(ss, '每日', 2, rows, [0, 8], [7]);
}

function writeWeeks_(ss, usage, plays) {
  const u = {}, p = {};
  usage.forEach(r => { u[r.week] = r; });
  plays.forEach(r => { p[r.week] = r; });
  const weeks = Object.keys(Object.assign({}, u, p)).sort().reverse();
  const rows = [['週（從週一開始）', '開啟次數', '使用手機數', '平均每支手機用幾天', '總使用分鐘', '玩完局數', '平均分數', '平均正確率']]
    .concat(weeks.map(w => {
      const a = u[w] || {}, b = p[w] || {};
      return [w, a.opens || 0, a.devices || 0, a.devices ? Math.round(a.device_days / a.devices * 10) / 10 : '',
              Math.round((a.total_sec || 0) / 60), b.games || 0, round_(b.avg_score), ratio_(b.avg_accuracy)];
    }));
  writeSheet_(ss, '每週', 3, rows, [0], [7]);
}

// 把後台的 CSV 原樣放進分頁；textNames 的欄位保持文字，pctNames 的欄位顯示成百分比
function writeCsvSheet_(ss, name, position, csvText, textNames, pctNames) {
  const rows = Utilities.parseCsv(csvText.replace(/^\uFEFF/, ''));
  if (!rows.length) return;
  const head = rows[0];
  const col = n => head.indexOf(n);
  const diff = col('難度');
  const textIdx = textNames.map(col).filter(i => i >= 0);
  const body = rows.slice(1).map(r => r.map((v, i) => {
    if (i === diff) return v === 'expert' ? '達人' : v === 'novice' ? '新手' : v;
    if (textIdx.indexOf(i) >= 0 || v === '') return v;
    const n = Number(v);
    return isNaN(n) ? v : n;
  }));
  writeSheet_(ss, name, position, [head].concat(body), textIdx, pctNames.map(col).filter(i => i >= 0));
}

function removeOtherSheets_(ss, keep) {
  ss.getSheets().forEach(sh => {
    if (keep.indexOf(sh.getName()) < 0 && ss.getSheets().length > 1) ss.deleteSheet(sh);
  });
}

// ── 每日 CSV 備份 ────────────────────────────────────────

function backupCsv_(folder, prefix, csvText) {
  const subs = folder.getFoldersByName(CONFIG.BACKUP_FOLDER);
  const sub = subs.hasNext() ? subs.next() : folder.createFolder(CONFIG.BACKUP_FOLDER);
  const name = prefix + '_' + Utilities.formatDate(new Date(), CONFIG.TZ, 'yyyy-MM-dd') + '.csv';
  const same = sub.getFilesByName(name);
  while (same.hasNext()) same.next().setTrashed(true);
  sub.createFile(name, csvText, MimeType.CSV);

  const cutoff = Date.now() - CONFIG.KEEP_BACKUP_DAYS * 24 * 60 * 60 * 1000;
  const all = sub.getFiles();
  while (all.hasNext()) {
    const f = all.next();
    if (f.getDateCreated().getTime() < cutoff) f.setTrashed(true);
  }
}
