# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**營養切切樂 (Swether)** — A mobile-first HTML5 canvas food-slicing game with a nutrition education theme. Three levels: protein (Level 1), vegetables (Level 2), healthy starches (Level 3). Target audience is elderly users (長輩).

## Deployment

- **No build step.** All code is in `index.html` (single file). Deploy by pushing to `main`.
- **Hosting:** Cloudflare Pages, connected to GitHub `main` branch — every push to `main` triggers auto-deployment.
- **Assets** (`images/`, `sounds/`) are committed to the repo and served from Cloudflare's same origin (`BASE = './'`). Do **not** revert this to the old `raw.githubusercontent.com` URL.
- `gen_icons.py` is a one-off utility script — do not commit it as part of features.

## Architecture

Everything lives in `index.html` (~1,400 lines). There is no module system.

### Screen Flow
```
#home → (tap) → difficulty modal → #intro → #k1Screen → #gameContainer
       → (level end) → #betweenLevel → #gameContainer (next level)
       → (all 3 levels) → #result
```
`showScreen(id, bgKey)` switches the active `.screen` div and sets its CSS background image.

### Game Loop
- `requestAnimationFrame(updateLoop)` — single loop, guarded by `loopRunning` flag to prevent double-starts.
- Food items fall via `spawnFood()` on a `setInterval` (`spawnTimerId`). Level ends via `setTimeout` (`levelEndTimerId`) at 30 seconds.
- Canvas pointer events (unified touch + mouse) trigger slice detection.

### Audio — Two-Track System
iOS requires user-gesture-gated audio. The game handles this with two separate systems:
1. **SFX** (`actx` / Web Audio API) — low-latency, decoded into `sfxBuffers`. Initialised inside `grantSoundPermission()` which must run synchronously within a gesture handler.
2. **BGM + cheer** (`<audio>` tags, `bgmAudio` / `cheerAudio`) — HTML5 audio for iOS compatibility.

`soundPermissionGranted` flag gates all audio. Never call `actx.resume()` outside a gesture handler on iOS.

### Food Data
- `LEVEL_CORRECT[1|2|3]` — emoji arrays for each level's correct foods.
- `BAD_FOODS` — junk food emojis (double penalty: −20 pts).
- `WRONG_POOL[level]` — pre-built distractor pool (bad foods + other levels' correct foods).
- Difficulty `novice`: 40% wrong items, 1500 ms spawn; `expert`: 55% wrong, 1200 ms spawn.

### Scoring
- Correct slice: +50 pts
- Wrong healthy food: −10 pts
- Bad food: −20 pts
- Minimum score: 100 pts
- Cheer/ribbon effect every 200 pts

## PWA

| File | Purpose |
|------|---------|
| `manifest.json` | App metadata, icons, `display: standalone`. Served through `functions/manifest.json.js`, which rewrites `start_url` to `./?pid=<device id>` (cookie first, then `?pid=` query). Linked with `crossorigin="use-credentials"` so the cookie is sent. |
| `sw.js` | Service worker — caching + offline |
| `icons/` | PNG icons (512, 192, 180 px); regenerate with `python3 gen_icons.py` |
| `.nojekyll` | Prevents GitHub Pages from running Jekyll |

### Service Worker Cache Strategy
- **Shell** (`swether-shell-v2`): `index.html`, manifest, icons → stale-while-revalidate
- **Assets** (`swether-assets-v2`): `images/*`, `sounds/*` → cache-first; pre-warmed in background on SW install

**When bumping the SW version** (e.g. after adding/removing assets), update both `SHELL_VER` and `ASSETS_VER` constants in `sw.js` so stale caches are evicted. The `activate` handler deletes any cache name not in `ALL_CACHES`.

### No Install Prompt, No Update Toast
- The owner asked to remove both. There is **no** install-to-home-screen overlay and **no** "new version" toast — do not add them back.
- New versions install silently: `sw.js` calls `skipWaiting()` + `clients.claim()`, and users get the new `index.html` on their next open.
- Only change `sw.js` (and bump `SHELL_VER`/`ASSETS_VER`) when cached files actually change; an unchanged `sw.js` means no SW update at all.
- `sw.js` never caches `/api/*`, `/admin*` or `/manifest.json` (it differs per phone). Navigations to `/` or `/index.html` with any query (`?pid=`, `?openExternalBrowser=`) share one cache entry keyed `./`, so a home-screen launch works offline.

## Key Constraints

- **iOS LINE WebView compatibility** — home screen uses `touchstart` + `click` double-binding with a debounce flag (`homeFired`). Do not simplify this.
- **Canvas resize** — only resize when dimensions actually change (`canvas.width !== window.innerWidth`), or the canvas context state is wiped mid-game.
- **`grantFired` flag** — prevents `grantSoundPermission()` from running twice (iOS fires both `onclick` and `ontouchstart`).
- **`FISH_KEY` / `VOICE_ID`** constants in `index.html` are legacy — unused but present; leave them.

## Play Logging (NEW_CH_CPB only)

- At `finishGame()` the client POSTs one record per game to `/api/log` (`functions/api/log.js`, a Pages Function).
- Stored in D1 database `swether-cpb` (binding `DB`, declared in `wrangler.toml`), table `plays`.
- Per-level counters live in `levelStats[level] = {spawned, hits, wrong, bad}`; `accuracy` = hits / all slices, `hit_rate` = hits / correct foods spawned.
- **Phone identity (no login, no typing):** each browser gets a random id stored in `localStorage` (`swether_pid`) **and** in a server-set HttpOnly cookie (`swether_pid`, 2 years). The server always prefers the cookie and returns the id, so the id survives iOS Safari wiping script storage. Shared helpers live in `lib/device.js`.
  - On load the game calls `POST /api/device` (`functions/api/device.js`) with the id + a device description (model/OS/browser/screen from `computeDeviceInfo()`), upserting table `devices` (`id, first_seen, last_seen, info, label`).
  - The result screen shows `本機代號 XXXXXX` (first 6 hex chars of the id, uppercase) so staff can match a physical phone to the admin list.
  - **LINE → browser:** a tiny script at the top of `<head>` redirects LINE's in-app browser to `?openExternalBrowser=1`, so LINE opens the page in Safari/Chrome (shared storage = same phone). It redirects only once; if the param is present and we're still in LINE (old LINE), the game just runs there. Outside LINE the param is stripped.
  - **iPhone home-screen app** has storage separate from Safari. Bridge: after `syncDevice()`, `pointManifestAtPid()` sets the manifest link to `manifest.json?pid=<id>`, so "Add to Home Screen" stores `start_url=./?pid=<id>`. On launch, `adoptPidFromStartUrl()` adopts that id **only** in standalone mode and only if the app has no id yet, then strips `?pid` from the URL. Android home-screen apps already share Chrome's storage.
  - Phones still split (e.g. used before these changes, or two different browsers) can be merged in admin by giving them the same name (`POST /api/device-label`, admin-only).
- **Usage / stickiness (table `sessions`, `POST /api/session` in `functions/api/session.js`):** one row per app visit with `started_at`, `last_active_at`, `active_sec`, `games`, `source` (桌面App / LINE / Facebook / 瀏覽器). Client logic is the 「使用紀錄（黏著度）」 block in `index.html`:
  - **Every** open and **every** return from background is a new visit, however short the absence (owner's explicit requirement — do not add a minimum gap or merge visits). `visibilitychange→hidden`/`pagehide` ends the visit (`session.ended`); becoming visible again starts a new one.
  - Only the 「再玩一次」 button (`replayGame()`) continues the same visit across its reload: it writes `swether_replay` to `sessionStorage`, and init continues the stored visit only if that flag matches and is < 60 s old. Any other load is a new visit. While the page is closing (`pageClosing`), no visit is started.
  - A page loaded while hidden starts its visit only when first shown. A game that finishes while hidden is credited to the visit that just ended.
  - Active time ticks every 5 s only while the page is visible **and** there was a touch/key in the last 5 min (each tick capped at 15 s).
  - Heartbeat every 60 s while visible; on `visibilitychange→hidden`/`pagehide` the snapshot is queued in `localStorage` (`swether_pending_sessions`) and sent with `sendBeacon`; the queue is flushed on load/online/visible. Upserts take `MAX()` of seconds/games, so resends are harmless.
  - The page that is about to hop from LINE to the browser (`window.__swetherRedirecting`) records nothing.
- Failed sends (e.g. offline) are queued in `swether_pending_logs` (max 20) and retried on page load, on the `online` event, and when the page becomes visible again.
- Each record carries `played_at` (client clock, ISO UTC) and a random `log_id`. The server stores `played_at` (falls back to upload time if invalid, >10 min in the future, or >1 year old) and uses `INSERT OR IGNORE` with a unique index on `log_id` so retries never create duplicates. `created_at` = upload time.
- All admin stats group by `played_at` converted to Taiwan time (`+8 hours`): daily, weekly (Mon start), weekday, and time-of-day slots.
- Schema changes must be applied to the production D1 by hand (no migrations folder); add columns before deploying code that writes them.
- **Nightly Google Drive sync:** `tools/google-drive-sync.gs` is a Google Apps Script the owner pastes into script.google.com (not run by Cloudflare). `setup()` installs a daily trigger (00:00–00:30 Asia/Taipei) and runs `syncNow()`, which reads `/api/stats` + `/api/stats?format=csv` with the admin key and overwrites the spreadsheet 「營養切切樂 遊玩紀錄」 (tabs 摘要/每支手機/每日/每週/開啟紀錄/遊玩紀錄) in the Drive folder, plus dated CSVs of both logs in 「每日備份」 (kept 60 days). The repo copy keeps `ADMIN_KEY`/`FOLDER_ID` as placeholders — never commit real values (the repo is served as static files). If you change the `/api/stats` response or CSV headers, update this script too.
- Admin page: `/admin` (`admin.html`) reads `/api/stats` (`functions/api/stats.js`; `?players=id1,id2` filters to one person, `?format=csv` for export). It lists every phone (grouped by name, including phones that opened the app but never finished a game) with opens / days used / days used in the last 7 / usage time, lets staff name phones, and filter all stats to one person (the daily table then also lists each opening time). `?format=csv&table=sessions` exports the visit log. Protected by the `ADMIN_KEY` secret set in the Cloudflare Pages dashboard — never put it in `wrangler.toml`. `sw.js` skips `/api/` and `/admin` so they are never cached.
