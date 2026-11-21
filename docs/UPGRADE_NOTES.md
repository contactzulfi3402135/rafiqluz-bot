# UPGRADE_NOTES — v1.1.2 · channel names, manual refresh, no "Add all", login restyle (2026-09-16)

**User report (verbatim, 5 asks):** "i see some channels name written in numbsers fix it / refresh it manually when i click on refresh … if i unfollowed or followed new channel shows there / remove add all option, i will select and add / in AI … it just feels like refresh automatically, there is option to refresh so remove automatic refresh / admin sign in is still that bare html look, no css"

## Fixes
| # | Ask | Fix |
|---|---|---|
| 1 | Channel names shown as bare numbers | New `chanLbl(name, jid)` helper (wraps existing `chanName`) — a stored name that is a bare number/jid renders as **"Channel •last4"**, never digits. Applied to **14 display sites**: Sources/Targets picker, scheduler target dropdowns (×3), Map modal (header + rows), Rule card title, routing matrix (headers + rows), routing rules list, Posts source cell + source filter, AI goal rows, activity-chart source rows, followed-channels banner, Signal Desk `sourceName()` |
| 2 | Manual Refresh must reflect follows/unfollows | `#srcRefresh` now finishes with a **full `loaders.sources()` re-render** (table + count + subscribers **and** the "you follow N channels" banner) after the live WhatsApp follow-state check (`/api/directory/rescan` → `channels.scanChannels()`: name/role refresh, 2-strike unfollow removal, grace period kept) |
| 3 | Remove "Add all" | The `srcSyncAll` button is gone. The followed-channels banner is now a **list — one row per channel with its own Add button** (existing `/api/browse/add-source` endpoint, per-jid; row disappears on success, banner hides when empty). Owner picks exactly which followed channels become Sources |
| 4 | Remove automatic refresh | Three auto-refresh loops deleted: (a) **10-minute background channel resync** (`setInterval resyncChannels`), (b) **background directory auto-rescan** on opening Sources (`srcAutoRescan`), (c) **AI assistant 8-second auto-reload** while the panel is open. What remains: event-driven updates (open panel / send / add / remove / pause re-render in place) + a **new manual Refresh button in the AI assistant header** (`#robotRefresh`). Reconnect-time resync (state change, announced via toast) is intentionally kept |
| 5 | Admin sign-in bare HTML | Root cause: the reskin **dropped the entire `.login-*` CSS block** from app.css — login.ejs referenced 9 classes that no longer existed. Rebuilt the block on the current reskin tokens: centered card (surface-1, border-1, r-card, layered shadow), emerald radial glow on the page bg, 42px inputs (surface-2, accent focus ring 3px), error box on error-soft, `btn-block` added, ≤480px phone layout. Works in dark and light themes |

## Files changed
- `src/web/assets/app.js` — `chanLbl()` helper; 14 name-display sites; banner rewrite (per-channel Add); srcRefresh → full re-render; 3 auto-refresh loops removed; `#robotRefresh` wiring
- `src/web/assets/app.css` — appended: banner-list styles (`.ssb-*`), rebuilt `.login-*` block, `.btn-block`; cache-bust `?v=s15`
- `src/web/views/dashboard.ejs` — `#robotRefresh` icon button in the AI panel header; cache-bust `app.css?v=s15` / `app.js?v=s14`
- `src/web/views/login.ejs` — cache-bust `app.css?v=s15`

## Kept on purpose (logged decisions)
- Server-side **Auto-monitor** (new channels followed on the phone enter the directory when they post) is a data-ingestion switch, not a UI auto-refresh — untouched, still OFF by default
- Reconnect resync on WhatsApp link/relink (one-shot, toast-announced) — a genuine state change, not polling
- `.ch-jid`/`.cp-jid` columns still show the raw ID — that is the ID column, not the name column
- WA inbox contact names (chat mirror) keep WA's own name-or-number behavior — v600 "mirror never themed" constraint

## Verification (live server, 2026-09-16)
- `node --check` app.js OK; app.css brace depth 0 / min 0; comment balance intact
- Puppeteer: /login desktop 1440 + phone 390 — card styled (bg/border/radius/focus ring verified via computed styles), no console errors
- Puppeteer: Sources banner rendered from stubbed `followedMissing` (numeric name → "Channel •last4", real name → as-is); per-channel Add click → API hit + row removed + banner hidden when empty
- Puppeteer: AI panel auto-refresh check — with the panel open for 12 s, `/api/ai/chat` requested exactly once (was ~2–3 with the 8 s timer); manual `#robotRefresh` click fires a new request
- Ship gate: API probes 200 · 33/33 switches OFF (original keys) · SSE 200 · 25 views · 518 ids (was 517, +robotRefresh) · css balanced · no CDN in ejs

---


# UPGRADE_NOTES — v1.1.1 · phone pass + overlap fixes (2026-11-15)

**User report:** "i'll see some mixed up like getting into each other and also make it for phone so it works for phone." Design reference supplied: `uploads/raqifluz-dashboard-redesigned.html` (light "Signal Desk" mockup) — treated as the phone's target look.

## Root causes found (evidence from the shipped v1.1.0)
| # | Bug | Evidence / fix |
|---|---|---|
| 1 | **Corrupted CSS comment fragment** — a stray `*/` (orphaned comment tail, old L1658) made Chrome's error recovery swallow the very next rule: `.ww { display: flex; … }` — at **every width**. The WhatsApp mirror's flex container was broken; on phone the list pane and chat pane stacked and collided (the "mixed up" report). | Fragment removed; comment balance now 136/136. Verified present in shipped v1.1.0 via `git show v1.1.0:src/web/assets/app.css` |
| 2 | **`.panic-lbl` overflow** — top-right panic button is an `icon-btn` (fixed 36px) carrying a "Panic stop" text label → label always extended 21px past the viewport's right edge | Mockup shows an icon-only shield. `.panic-top` is now a square icon button; label hidden everywhere (kept in DOM for title/aria) |
| 3 | **`.duo` / `.comp2` grids never collapsed** — v1.1 base rules (old L2105/L2155) landed *after* the original `@media (max-width:1023px)` collapse rules; equal specificity → later rule won at every width → 2-up cards at 390px (health score card text bleeding into the Parts card) | `@media (max-width:1023px) { .duo, .comp2 { grid-template-columns: 1fr; } }` appended last (source order now wins) |
| 4 | **Phone topbar overflow (390px)** — right cluster (search + palette + buttons) exceeded 390px by 37px on every view | `.command-search` hidden on phone (palette still reachable via the `pal-btn` icon), icon buttons 34px, gaps tightened |

## Phone (≤767px) — mockup light look, desktop untouched
- One trailing `@media (max-width: 767px)` block: light tokens (bg `#F8FAFC`, white surfaces, `#E2E8F0` borders, slate text, emerald `#059669` accent, `color-scheme: light`), scoped to `:root:not([data-theme="light"]):not([data-theme="glass"])` — explicit light/glass theme picks keep their own tokens; **desktop (≥768px) is byte-identical in behavior** (dark default)
- KPI cards carry the mockup's green gradient (`#ECFDF5 → #FFF`); cards 12px radius + whisper shadow
- Tables (`.t`) scroll horizontally **inside their card** (`.tw` / `.rosw` likewise) — no page-level overflow
- Charts/SVG shrink to fit (`svg { max-width: 100% }`); activity chart 1-col; bar columns 96px
- **WhatsApp mirror — still dark, LTR, never themed (v600 constraint kept)**: full-bleed under the 56px topbar; side pane 100%; **new chat toggle**: tap a chat → conversation goes full-width with a back button (`.wa-back` / `#waBackBtn`), back returns to the list. Implemented with a `.ww.chat-open` class (toggled in `waOpen()`) + one binding next to the other WA buttons. Composer lifts above the fixed bottom tab bar (`padding-bottom: 64px + safe-area`)
- Settings tabs: horizontal scroll instead of wrap

## Files changed
- `src/web/assets/app.css` — all visual changes (orphan fragment removed, panic button, grid collapse block, phone block)
- `src/web/assets/app.js` — two additions only: `chat-open` toggle inside `waOpen()`, `#waBackBtn` click binding
- `src/web/views/dashboard.ejs` — `#waBackBtn` inside `.wa-pane`; cache-bust bumps `app.css?v=s14` / `app.js?v=s13`

## Verification (live server, 2026-11-15)
- Puppeteer overflow audit: desktop 1440 + phone 390 (iPhone UA) across 16 view runs = **0 overflows, 0 console errors, 0 page errors**
- Phone WA toggle test: closed → list only; open → pane full height (56→844) with back button; back click removes the class
- Ship gate: API probes all 200 · **33/33 switches OFF (original keys)** · SSE 200 · 25 `data-view` sections · 517 ids · 33 opt-rows · 8 settings tabs · jsdom boots real app.js · `show()` on all 25 views · vtab click OK · css comment balance 136/136 · wa.js QR refs intact · no CDN scripts in ejs

## NOT changed
package.json/lock, all backend/APIs/DB, WA auth/QR/automation, the 33 switches (OFF by default, original keys), all 25 screens, v1.1 sidebar/vtabs/panic-modal behavior, light/glass theme picks.

---

# UPGRADE_NOTES.md — v1.1 bug fixes · sidebar reorganization · visual upgrade

**Base:** the reskinned v1.0.0 (function = v11.0.0 core, look rebuilt per Raqifluz-UI-Reskin-Spec).
**This round is user-directed behavior changes** — the reskin's "function frozen" constraint was explicitly overridden for the items below. Everything NOT listed here is untouched.

## 1 · Critical fixes (all user-reported)
| Bug | Fix |
|---|---|
| Sidebar footer permanently pinned over the scrollable menu | `.sidebar` no longer scrolls as a whole; header + health row + footer are `flex: none`, and **only `.sb-areas` (the nav) scrolls** (`flex: 1 1 auto; min-height: 0; overflow-y: auto`) — the exact flex-column structure requested |
| Top-bar "Panic stop" breaking out / pushing down | `.topbar` overflow hidden; every top-bar control is inline, `flex-wrap: nowrap`, uniform **36px** height, `white-space: nowrap`; the search field is the only shrinkable element (`flex: 0 1 560px; min-width: 96px`) |
| Two "Scan QR" controls in the top bar | The duplicate status badge (`#waBadge`) is **removed from the markup**; the single unified **connection pill** now carries state + name and, when not linked, clicking it jumps to the QR card on Home (when linked, it opens the inbox). The JS binding that painted the badge is null-safe |
| "Panic stop" in two places | The sidebar-footer panic button is **removed**; the top-right panic button (already wired to the original `/api/panic/stop` + `/api/panic/restore` handlers **with a confirmation modal**) is the only control. Its status painer is null-safe |
| Banner "Mirroring is running" vs card "reconnecting" | `paintPauseBar(paused, waStatus)` — mutually exclusive states: **WhatsApp disconnected wins** → "Mirroring paused — WhatsApp disconnected." + the bar's button becomes "Connect WhatsApp via QR" (opens/scrolls the QR card). Paused and running states keep their exact original texts; the pause button branches on `data-mode` (link vs pause) |
| "All systems healthy 5/8" | Sidebar health label now counts **passed checks, not the average score**: all 8 pass → "All systems healthy"; otherwise "**N systems need attention**" (N = 8 − passed) with a warn/err dot. Verified live: fresh instance renders "4 systems need attention · 4/8" |
| KPI grid 4 + 2 half cards | `.kpi-grid` is a uniform **3-column** grid (6 KPIs = two full rows; 2-col at tablet, 1-col on phones — all rows complete) |
| Thick solid black bars under "Published today"/"Failed today" | The reskin had dropped the sparkline paint rules, so the SVG area path rendered with the default black fill. **Restored** `.k-spark` line/area rules mapped to the new palette tokens (accent/emerald/red/amber per KPI tone). Verified live: both sparklines paint |
| "QR refs attempts ended" typo | Display-side fix `fixDetail()` rewrites "QR refs" → "**QR refresh**" wherever the detail string is shown (QR card + WhatsApp KPI). The internal state-matching regex in `src/wa.js` is untouched (it matches the library's literal string) |
| "0pending approval" — number touching the word | `.queue-total` is a flex baseline row with an 8px gap (big tabular number + label); `.queue-metrics` rows styled too |
| Avatar + workspace name | Avatar enlarged 32→**38px** with centered initials (breathing room, per the 16–20px padding intent); name row already truncates (nowrap + ellipsis) |
| Developer debug string in the top banner (repo · branch · interval) | When cloud memory is ON the banner is now a compact pill: **"Cloud Memory Synced · Last saved {real time}"** with the repo/branch/interval/KB/error detail moved into a hover tooltip, plus a small "Test" link (same `/api/persist/test` as before). When cloud memory is OFF the existing setup-guidance card is kept (it is the only place the PERSIST_GITHUB_* instructions live — removing it would hide setup help) |

## 2 · Sidebar: 8 flat groups → 5 collapsible categories
Native `<details>/<summary>` — zero JS for the collapse. Real **16px Lucide icons** (vendored SVGs, already in the app) replace the letter glyphs. Merged entries light up across their tabs via a new `data-views` family read by the existing `show()` router — **all 25 original screens still exist as `data-view` sections** (deep links `#view=…`, saved views, recent strip, palette, wizard, rosw chips all keep working):

1. **Overview** — Home · **Analytics & Reports** (Analytics + Reports & Digest)
2. **Publishing & Content** — Compose · **Queue & Scheduled** (Queue + Scheduled) · Bulk Send · **Content Library** (was Studio > Library) · History
3. **Channels & Routing** — **Sources & Targets** · **Routing Rules** (Routing + Rules) · Discover
4. **Audience & Automation** — WhatsApp Inbox · Contacts · **Auto-Replies & AI Pilot**
5. **System & Workspace** — **Brand & Workspace** · **System Health & Logs** (Health + Logs + Audit) · **Email & Notifications** · **Settings & About**

Merged screens carry an in-view **underline tab row** (`.vtab-row`, 15 views, 33 tabs) that routes through the existing `show()` — no new loaders, no new routes. `AREA`/`GROUP_LABEL`/breadcrumb labels and the mobile More-sheet grouping were updated to the same 5 categories. The mobile bottom bar (Home · Queue · Compose · Channels · More) is unchanged.

## 3 · Visual / UX polish
- Cards: **12px radius** (was 14), **soft shadow** token (`--sh-1`, subtle in all three themes) on cards/KPIs/cloud pill; light-theme border set to **#E5E7EB** per the Linear/Stripe/Vercel reference
- **`tabular-nums`** on all metrics (KPI values, health score, pacing, queue counts, pills)
- Actionable empty states: WhatsApp KPI gets **"Connect WhatsApp via QR"** (or "Connecting…" disabled) when not linked; Sources KPI gets **"Add first source"** when 0 — both reuse the existing QR/flows, no new backend
- Connection pill restyled as the single status control (36px, state-colored)

## 4 · Files changed (verified by diff)
`src/web/assets/app.css` · `src/web/assets/app.js` · `src/web/views/dashboard.ejs` — cache-bust `app.css?v=s13`, `app.js?v=s12`. No dependency changes (`package.json`/`package-lock.json` byte-identical). `server.js`, all bot modules, `wa.js`, `connect.ejs`, `login.ejs` untouched.

## 5 · Verification (jsdom runtime harness against the live server + API probes)
- **Zero runtime errors** executing the full app.js: home paints (6 KPIs, 2 sparklines, chart, queue panel, health panel, activity feed); new CTAs present with correct labels; pause bar shows "Mirroring paused — WhatsApp disconnected." + link-mode button; cloud note renders (OFF card — no GitHub env in the test instance)
- Merged routing: `show(digest)` lights the "Analytics & Reports" sidebar item + digest tab; `show(audit)` lights "System Health & Logs" + audit tab; breadcrumbs read OVERVIEW / SYSTEM & WORKSPACE
- Live API: 33 switches all OFF with original keys; overview/status/health/queue/persist/settings/qr 200; SSE 200 authed; login/.connect/status/healthz 200
- HTML: 25 views intact; 516 element ids = 527 − 11 intentional removals (waBadge×2, sbPanicStatus, 8 group-container ids)
- CSS brace balance 0; `node --check app.js` clean

## 6 · Decisions / notes
- "Brand & Workspace": v11 has no separate Workspace screen — the Brand view is the workspace's home (owner identity already lives in the sidebar footer row); entry named per the request, one screen behind it
- Panic confirmation: the top-right button **already** had a confirmation modal (openModal with "Pause everything"/"Restore") — kept as-is; only the duplicate was removed
- Cloud badge "Last saved" uses the real `/api/persist/status` timestamp (e.g. "Nov 15, 12:19 AM")
- The "33 Options" static index (from the reskin) is unchanged and still reachable under Settings & About → Settings
