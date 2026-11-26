/**
 * 營養切切樂：每天晚上 12 點左右，把後台資料同步到 Google Drive 資料夾。
 *
 * 會在資料夾裡建立／更新：
 *   1. Google 試算表「營養切切樂 遊玩紀錄」（摘要、每支手機、每週、遊玩紀錄 四個分頁）
 *   2. 子資料夾「每日備份」裡當天的 CSV（保留 60 天）
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
  const stats = JSON.parse(api_('/api/stats').getContentText('UTF-8'));
  const now = Utilities.formatDate(new Date(), CONFIG.TZ, 'yyyy-MM-dd HH:mm');

  const ss = getSpreadsheet_(folder);
  writeSummary_(ss, stats, now);
  writeDevices_(ss, stats.byDevice || []);
  writeWeeks_(ss, stats.byWeek || []);
  writePlays_(ss, csvText);
  removeOtherSheets_(ss, ['摘要', '每支手機', '每週', '遊玩紀錄']);

  backupCsv_(folder, csvText);
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
  const s = stats.summary || {};
  const rows = [
    ['項目', '數值'],
    ['最後更新（台灣時間）', "'" + now],  // 開頭的 ' 讓它保持文字，不被轉成日期
    ['總局數', s.games || 0],
    ['手機數', s.players || 0],
    ['平均分數', round_(s.avg_score)],
    ['平均正確率', ratio_(s.avg_accuracy)],
    ['平均命中率', ratio_(s.avg_hit_rate)],
    ['平均每局秒數', round_(s.avg_duration)],
    ['累計遊玩分鐘', s.total_duration == null ? '' : Math.round(s.total_duration / 60)],
    ['後台網址', CONFIG.SITE + '/admin'],
  ];
  const sh = writeSheet_(ss, '摘要', 0, rows, [], []);
  sh.getRange('B6:B7').setNumberFormat('0.0%');
}

function writeDevices_(ss, devices) {
  const rows = [['名稱', '手機代號', '手機型號', '局數', '平均分數', '平均正確率', '最近一次玩', '第一次玩']]
    .concat(devices.map(d => [
      d.label || '（未取名）',
      (d.ids || []).map(codeOf_).join('、'),
      d.info || '',
      d.games || 0,
      round_(d.avg_score),
      ratio_(d.avg_accuracy),
      d.last_tw || '',
      d.first_tw || '',
    ]));
  writeSheet_(ss, '每支手機', 1, rows, [0, 1, 2, 6, 7], [5]);
}

function writeWeeks_(ss, weeks) {
  const rows = [['週（從週一開始）', '局數', '手機數', '平均分數', '平均正確率']]
    .concat(weeks.map(w => [w.week || '', w.games || 0, w.players || 0, round_(w.avg_score), ratio_(w.avg_accuracy)]));
  writeSheet_(ss, '每週', 2, rows, [0], [4]);
}

function writePlays_(ss, csvText) {
  const rows = Utilities.parseCsv(csvText.replace(/^﻿/, ''));
  if (!rows.length) return;
  const head = rows[0];
  const col = name => head.indexOf(name);
  const TEXT = ['遊玩時間(台灣)', '上傳時間(台灣)', '名稱', '手機代號', '手機型號', '難度', '完整代號'];
  const PCT = ['正確率', '命中率'];
  const diff = col('難度');
  const textIdx = TEXT.map(col).filter(i => i >= 0);
  const body = rows.slice(1).map(r => r.map((v, i) => {
    if (i === diff) return v === 'expert' ? '達人' : v === 'novice' ? '新手' : v;
    if (textIdx.indexOf(i) >= 0 || v === '') return v;
    const n = Number(v);
    return isNaN(n) ? v : n;
  }));
  writeSheet_(ss, '遊玩紀錄', 3, [head].concat(body), textIdx, PCT.map(col).filter(i => i >= 0));
}

function removeOtherSheets_(ss, keep) {
  ss.getSheets().forEach(sh => {
    if (keep.indexOf(sh.getName()) < 0 && ss.getSheets().length > 1) ss.deleteSheet(sh);
  });
}

// ── 每日 CSV 備份 ────────────────────────────────────────

function backupCsv_(folder, csvText) {
  const subs = folder.getFoldersByName(CONFIG.BACKUP_FOLDER);
  const sub = subs.hasNext() ? subs.next() : folder.createFolder(CONFIG.BACKUP_FOLDER);
  const name = '遊玩紀錄_' + Utilities.formatDate(new Date(), CONFIG.TZ, 'yyyy-MM-dd') + '.csv';
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
