# RESKIN_NOTES.md — Look-layer rebuild, function frozen

**Function restored to:** Raqifluz v11.0.0 (commit `c83abca`, zip `raqifluz-v11.0.0.zip`) — the last working version before the redesign. Restored byte-for-byte by extraction; nothing in `src/` (bot backend), `src/web/server.js` (routes/API), or `src/web/assets/app.js` (all client behavior) is modified by this reskin. The superseded from-scratch design rebuild is preserved at `git tag superseded-design-rebuild` in the previous repo snapshot and at `~/raqifluz-design-rebuild-superseded.zip`.

## Function Inventory (parity contract)

### Pages / server routes (src/web/server.js)
| Route | What it does |
|---|---|
| `GET /` | redirect → `/admin` if authenticated, else `/connect` |
| `GET /connect` | public QR/pairing page (no login) |
| `POST /api/public/connect` | start a pairing session (rate-limited) |
| `POST /api/public/pair` | pair a number by code (rate-limited) |
| `GET /api/public/connect/:id` | poll pairing session state |
| `GET /api/public/numbers` | list connectable numbers (public) |
| `GET /login` · `POST /login` · `POST /logout` | session auth (JSON body), read-only secondary password support, bearer token issuance |
| `GET /events` | SSE live-update stream |
| `GET /admin` | the dashboard SPA (single EJS, 25 screens) |
| `GET /status` | public status page (rate-limited) |
| `GET /healthz` | liveness |
| static | `/app.css`, `/app.js`, `/icons/*`, `/fonts/*`, `/pwa/*`, `/manifest.webmanifest`, `/sw.js`, `/media/avatars/*` |

### API surface (mounted under `/api`, ~190 endpoints) — unchanged
Overview & state: `overview`, `overview/hourly`, `analytics` (+`export.csv`, `export.pdf`), `audit` (+`audit.csv`), `logs`, `latency`, `uptime`, `session`, `status`, `notifications` (+`read`, `:id/read`), `search`, `pipeline/counters`.
Channels: `browse/channels`, `browse/follow`, `browse/unfollow`, `browse/add-source`, `sources/rss`, `sources/sync-followed`, `routing-matrix`, `source-rules`, `watched`, `watched/:phone`, `subs`, `directory`, `directory/refresh`, `directory/rescan`, `hashtags/freq`.
Publish: `queue` (+`approve-all`, `delay`, `retry-all`, `:id`), `posts` (+`delete`, `edit`, `edit-republish`, `resend`, `retry-one`, `dismiss-failed`, `undo-row`, `purge`), `compose` (+`ai`, `test-send`), `card`, `card/:postId`, `card-svg`, `bulk` (+`history`), `broadcast` (+`:id/send`, `:id/delete`), `drafts` (+`:id`, DELETE), `snippets` (+`:id`, DELETE), `schedule`/`scheduler/calendar`, `calendar`, `plan-week`, `weekly` (+`/at`, `/send`).
AI: `ai` (+`control`, `features`, `test`, `usage`), `ai/models`, `ai/chat` (GET/POST/DELETE), `prompts` (+`:id`), `glossary` (+`:id` DELETE), `reply-kb` (+`:id`, `/settings`), `features`.
Power (33 switches + automation): `power`, `power/toggle`, `power/aipilot`, `power/aisafety`, `power/routing`, `power/scheduler` (+PATCH/DELETE `:id`), `power/template`, `power/tplstyle`, `evergreen`, `autopilot`, `recap/at`, `freshness`, `guardrates`, `matrix` (via `routing-matrix`), `freshness`.
WhatsApp: `inbox`, `inbox/:jid` (+`/avatar`, `/labels`, `/history`, `/pin`, `/read`, `/send`, `/open`, `/export`, `/media-gallery`, `/media/:id`), `inbox/labels` (+`:id/delete`), `inbox/quick-replies` (+`:id/delete`), `inbox/scheduled` (+`:id/delete`, `:id/enable`), `wacommand`, `mirror/pause`, `numbers` (+`/qr`, `/relink`, DELETE), `contacts` (+`.csv`, `:jid`, `:jid/note`, `:jid/tags`, `tags`, `dupes`).
System: `health` (+`selftest`), `panic`, `panic/stop`, `panic/restore`, `pacing`, `storage` (+`cleanup`, `keepdays`), `backup/download`, `backup/restore`, `backup/pre-restore` (+`/:name`), `persist/status`, `persist/test`, `persist/backup`, `persist/compact`, `security`, `apikey/regenerate`, `email/accounts` (+`:id/default`, DELETE), `email/send`, `email/test`, `email/queue/:id/cancel`, `email/history`, `webhooks` (+`/test`, `/enable`, `/delete`), `goals` (+`/global`, DELETE `:jid`), `export/posts.csv`, `export/logs.csv`, `media-lib` (+`/download`, `DELETE`), `settings`, `audit`, `qr`.

### The 33 switches (all OFF by default, keys/labels/descriptions as in `app.js` `SWITCHES`)
`scheduler, routing, analytics, editposts, aipilot, dedupe, beautify, headers, hashtags, translate, aireply, digest, signature, queue, crossdedupe, dedsplit, polltext, matrix, tldr, autobold, emojibullets, transcribe, replykb, recap, weekly, instantalerts, waCommand, evergreen, autopilot, smartmedia, linktools, announcard, aisafety`
Each has one documented home container (e.g. `#swGeneral`, `#swBrand`, `#swAipilot`, `#swRules`, `#swDigest/Recap/Weekly/Instantalerts`, `#swAireply/ReplyKb`, `#swQueue`, `#swPosts`, `#swRouting`, `#swAnalytics`, `#swLibrary`, `#swWaCommand`) rendered by `paintSwitches()`; toggle → `POST /api/power/toggle`. Read-only state chips (`rosw`) appear in `#homeSwitchChips`, `#composeSwitchChips`, `#historySwitchChips` and deep-link to the owner screen. Searchable "?" help overlay lists all 33 in 5 groups.

### Other settings keys (default in brackets)
`bot_name` [Raqifluz Channel Bot] · `ui.lang` [en] · `ui.setup.done` [false] · `ui.kpi.order` [] · `session.timeout_min` [120] · `login.alerts` [false] · `ro.enabled` [false] · `ro.password_hash` [] · `api.key` [auto] · `mirror.paused` [false] · `queue.delay.min` [0] · `power.routing.rules` [] · `power.aipilot.criteria` [] · `power.aisafety.criteria` [] · `power.header.text` [] · `power.signature.text` [] · `power.scheduler.jobs` [] · `guard.maxperhour` [30] · `freshness.hours` [0] · `ai.translate.lang` [] · `ai.prompt` [] · `power.aireply.prompt` [] · `replykb.hours.from/to` [09:00/21:00] · `replykb.allowlist` [] · `goals.daily` [0] · `weekly.lastweek` [] · `report.phone` [main phone] · `blocklist.words` [] · `blocklist.regex` [false] · `replace.rules` [] · `digest.at` [22:00] · `recap.at` [07:00] · `crossdedupe.window.min` [30] · `post.sourceedit.policy` [ignore] · `dashboard.password_hash` [from DASHBOARD_PASSWORD].

### Screens (25, all client-side views in `/admin`, unchanged)
Home · Sources · Discover (browse) · Targets · Routing · Compose (newpost) · Scheduled · Library (media) · Brand · Queue (approvals) · History (posts) · AI Pilot · Auto-Replies (aireply) · Digest · Guardrails · WhatsApp (mirror + inbox + commands) · Journal (watched) · Bulk send · Email · Analytics · Health (8-part + self-test) · Logs · Audit · Settings · About (+ global overlays: command palette, help, wizard, tour, AI robot FAB, modals, toasts).

### Key behaviors (frozen)
Panic Stop (`/panic/stop`, `/panic/restore`, banner + chip, Esc key) · adaptive pacing (rate controller, visualizer on Guardrails) · setup wizard (progress saved, `ui.setup.done`) · 8-part health + self-test · backup/restore zip + cloud memory (GitHub) + storage cleanup · WhatsApp QR pairing (one scan, cloud session) · SSE live updates · PWA (`sw.js`) · read-only secondary login · AI robot assistant · EN/اردو with `body.ur` class (best-effort labels, mirror stays WhatsApp-rendered).

## Settings Map (AS IMPLEMENTED in Phase 2 — spec's 8 tabs over the app's existing field cards; no key renamed, zero JS edits; tab wiring is the existing attribute-generic `data-setgroup`/`data-sets` mechanism)
- **General** (group key `general`) ← Branding (bot name), Dashboard (Show channel IDs, Language, Theme dark/light/glass/system), Security (read-only password + login alerts + session timeout), Owner API key, Session (sign out) + static bottom bar "33 optional switches — all off by default" (static text, no state claim).
- **WhatsApp** (key `whatsapp`) ← Chat features (per number), WA command channel (switch + PIN + command table), + new view-only "WhatsApp mirror — Locked" info card (the mirror itself untouched).
- **Pacing** (key `pacing`, new) ← Pipeline behavior card (cross-source dedupe window, source-edit policy — moved from Delivery controls), + "Where the rest of pacing lives" pointer card (rate-guard cap, per-target caps, 24 h pacing visualizer, freshness guard on Rules screen; delay buffer on Queue screen; controller readout on Home — all via existing `#view=` deep links). The pacing visualizer card itself was NOT moved: its paint is bound to the Guardrails view loader in frozen app.js, so moving it would leave it unpopulated (would be a function break).
- **Automation** (key `automation`) ← Posting switches (`#swGeneral` home — dedupe family + smart media), Automation/Auto-pilot card (limit + log).
- **AI & Rules** (key `ai`) ← AI provider + key + per-feature + prompt library + glossary, + pointer card to AI Pilot / Auto-replies / Rules screens (safety-screen criteria, reply instruction, KB hours live there with their frozen view loaders).
- **Notifications** (key `notifications`, new) ← Daily WhatsApp report card (phone + save — moved from WhatsApp group), + pointer card: digest/recap/weekly/instant-alerts switches + times + test button live on the Reports & Digest screen (their values are populated by the frozen digest view loader — moving them would break their save paths).
- **Storage** (key `data`, label renamed) ← Backup & restore, Cloud memory & exports, Storage (gauge, compact, keep-days, cleanup).
- **33 Options** (key `options`, new) ← read-only index of all 33 switches in 12 home-screen groups, each row = name + verbatim description + "Configure →" deep link to the switch's existing home (`#view=…`). No live On/Off state, no "n of 33" counter, no search box: all three require new client JS (frozen). No reset button — no reset behavior exists in v11. The real toggles stay in their existing homes (one-home-per-switch, `SWITCH_HOME` in frozen app.js).
- localStorage `rc-setgroup` drift handled: old tab keys `access`/`session` no longer exist → the frozen JS falls back to the EJS default (General), which is exactly v11's fallback behavior for unknown saved groups.

## UI_GAPS (design element → what the app actually has)
1. Design "Status chip: All Systems Healthy + chevron, click opens Health" → app has a live connection pill (`#connPill`) + 8/8 health readout in the sidebar; both kept, restyled. No separate "systems healthy" text existed; the health state is the connection pill (amber/red variants exist).
2. Design "Bell with unread dot" → app has notifications bell (`#notifBtn` + `#notifBadge` + panel) — bound as-is.
3. Design "user menu with avatar + name + menu" → app has a workspace-owner row in the sidebar footer (avatar, name, help "?", theme button) — kept in the new sidebar footer per existing wiring; no dropdown menu existed, so none invented.
4. Design "bottom tab bar: Home, Queue, Analytics, Settings" → app's existing mobile bottom bar has 5 items (kept, restyled — removing an existing tab would hide a feature).
5. Design "Queue: type dropdown Text/Media" → app queue has status tabs (Approvals / Live) + chips; no text/media type filter exists → not added.
6. Design "Sources tabs All/Active/Paused/Errors" → app Sources screen has a single live table + add/picker + RSS card; no status tabs exist → restyled as-is.
7. Design "Analytics stat row (Total Posts, Success Rate, Skipped, Failed, Avg Latency, Reach Est.)" → app has its own KPI strip (`#anKpis`) + daily trend + hourly heat + per-target + media/text + reasons + leaderboard + goals; all kept, restyled. "Reach Est." doesn't exist → not added.
8. Design "Discover: 3-column grid with match info" → app Discover has category/country chips + search + result rows (`#brwList`) — restyled as card rows; "match info" doesn't exist → not added.
9. Design "History: search + filters + pagination" → app History has filters (status/source/text) + table + bulk delete; pagination exists as the app's own list behavior — kept.
10. Design "Rules page" → app's equivalent is Guardrails (kept under its existing name and route — §4.6: keep the app's name).
11. Design "Contacts screen" → app keeps contacts inside the WhatsApp screen (panel `#waContactsPanel`) — no standalone Contacts screen exists → stays there.
12. Design "Range chips 1h·24h·7d·30d" on Home → app Home chart is fixed 24h (`/api/overview/hourly`); Analytics has its own day-range control — kept as-is (no fake ranges invented).
13. Design "KPI sparklines from existing history" → app KPIs already render sparklines (`k-spark`) from real counters — kept.
14. Design "Theme: Dark | Light segmented" → app theme setting is 4-way (dark/light/glass/system) — all four kept (removing glass/system would delete an existing setting); segmented control restyled.
15. Design "Panic Stop in sidebar footer full-width danger" → app has sidebar panic status button + topbar panic button + Home pause bar — all three kept (each has distinct existing behavior), restyled; the sidebar one becomes the full-width danger-solid control.
16. Design "Violet accent selector" → app has no accent setting (brand colors are the bot's post-brand palette, a different feature) → emerald stays the single live accent; `[data-accent="violet"]` tokens defined but not exposed, per §5.1.
17. Design "red Queue badge on the sidebar item" → v11 shows the live pending count in the Queue tab pill (`#queueBadge`); the sidebar item has no badge element and painting one needs new JS → not added (no fake counter).
18. Design "33 Options tab: search + 'n of 33 enabled' live counter" → both need new client JS (frozen) → the tab is a static read-only index (33 rows, verbatim names/descriptions, deep links to each home).
19. Design "one green Save Changes bar for all settings" → v11 uses per-card save buttons, each wired to its existing endpoint; unifying them is new JS → per-card saves kept (each still submits exactly what it did before).
20. Design "Sources: 72px rows with gear → 440px drawer; 480px modals" → v11 Sources is a live table with inline row actions (no drawer/modal anywhere); the §5.4 drawer/modal CSS is defined and styles the app's existing overlay surfaces (mobile More sheet, generic modal scrim), but no new row→drawer interaction was invented.
21. Design "aria-current='page' on the active nav item" → the frozen JS toggles the `.on` class only; setting the ARIA attribute needs JS → CSS targets both `.on` and `[aria-current="page"]`; translations/labels untouched.
22. Design "mobile bottom bar: 4 tabs (Home/Queue/Analytics/Settings)" → app's existing bar has 5 slots incl. Compose FAB and More sheet (see #4) → all 5 kept, restyled; 64px + safe area.
23. Design "top bar status chip reads 'Online • 24/7'" → v11 chip is the live connection pill (name + state, amber/red variants); the exact 'Online • 24/7' string doesn't exist → pill restyled per §6.2 with its real state text (no fake status).
24. Design "Home: Adaptive Pacing toggle" → v11 home pacing panel is a read-only mode chip + real stats (the controller is automatic; no manual toggle exists) → kept as-is.
25. Design "Home: Setup Wizard + rocket / Queue Overview / Quick Actions" → v11 has the Setup wizard card (progress saved), the Queue status card and the 24 h activity chart — all restyled; a separate "Quick Actions" row does not exist in v11 → not invented.

## Phase 2 decisions (look layer, 2026-11-15)
- `src/web/assets/app.css` rewritten from zero (~2100 lines): §5.1 tokens (dark `#0B0F14`/`#111827`/`#1F2937`/`#334155`/`#273244`, accent `#10B981`/`#059669`; light per §5.1; existing `glass` + `system(auto)` themes kept as variants since they are existing settings), §6 shell (260/72px sidebar, 64/56px top bar, 1280px content, 20px gap), §5.4 components (40px buttons/inputs, 40×22 toggle, 24px pill, underline tabs, 32px chips, 14px cards no shadow), §7–9 pages, §10 light/RTL/a11y (logical properties throughout, numbers stay LTR in RTL, 44px mobile targets, visible focus, reduced-motion).
- Legacy variable aliases: the frozen app.js/EJS reference old token names (`--accent --bd --border --card2 --err --muted --ok --t13 --t14 --text --warn --line --t15 --panel --in --sp* --r-* --sh2 --dur --ease --font --mono --sb-w --sb-rail --tb-h --maxw` …) — all resolved to the new palette so inline styles inside frozen code render in the new look.
- WhatsApp mirror: 124 v11 rules re-emitted byte-identical (verified programmatically rule-by-rule), covering the `.ww` frame, chat list, message bubbles, hbar, QR rows, media grid, WA-styled samples. Legacy tokens those rules reference are pinned to v11 values inside a `.ww, .wa-bubble-wrap` scope (`--r-card:12px; --r-ctl:8px; --border:#303A2E; --dur:120ms; v11 easing; v11 shadow; v11 font stack`) + `direction:ltr`, so theming/RTL can never reach it. The top-bar connection badge (`.wa-badge`) and the Sources/Targets lock-gate (`.wa-gate`) are console chrome, not mirror → restyled by the new layer.
- EJS changes, exactly: (a) settings section regrouped to the 8 spec tabs (whole existing cards moved; all 527 element ids in the file preserved, verified by diff; the two stray `</section>` closers inside the old settings section normalized — the HTML parser ignored them in v11 too, DOM unchanged); (b) `app.css?v=` cache-bust bumped in dashboard.ejs (`s11→s12`) and login.ejs (`s1→s2`) — required so browsers fetch the new sheet; `app.js?v=s11` untouched (byte-identical file, cache valid).
- New view-only static elements added (no JS, no state, no endpoints): mirror-Locked info card, three "where the rest lives" pointer cards (Pacing/AI/Notifications), 33-options index, General bottom bar. Everything else on screen binds to existing data/handlers.
- Unchanged (byte-verified vs `_backup_before_reskin/`): `src/web/server.js`, `src/web/assets/app.js`, `src/index.js`, `src/config.js`, all bot modules, `connect.ejs`, `login.ejs` body, all non-settings views.

## Could not restore
Nothing. v11.0.0 was available as a complete zip (commit c83abca) and was restored byte-for-byte; the server boots, all pages render, login/panic/queue/settings endpoints verified against the running instance.
