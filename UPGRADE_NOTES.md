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
