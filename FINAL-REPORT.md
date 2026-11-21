# RAQIFLUZ CHANNEL BOT — POWER BUILD v4 · FINAL DELIVERY
_Date: 2026-11-08 · Tree: v7.7.2 on branch `power-build` · 10/10 phases committed + 2 post-deploy hotfixes · ONE zip_

**Contract:** v4 ONE-GO FINAL (supersedes v1–v3). Everything remaining after the accepted Phase R shell
was built in one continuous run, 5A → 5J, with a local commit per phase and no stops.
This document is the final POWER LEDGER: every item R1–R92 + N1–N3 + I1–I10 + J1–J10, with status,
UI location, and — for the three honest ⏭ items — the verified reason.

Commits (git order, newest first):
`2dfb385` v7.7.1 deploy hotfix · `007de71` 5J · `2d027aa` 5I · `a37701b` 5H · `5dbb3f0` 5G ·
`9245ba2` 5F · `fed64bd` 5E · `96d924e` 5D · `22b737e` 5C · `bfe2b92` 5B · `5174a3c` 5A ·
`9329513` Phase R (accepted).

---

## 1. Sandbox verification (clean copy of the exact committed tree)

Done on a clean copy = `git archive HEAD | tar -x` (the zip is this tree):

| Check | Result |
|---|---|
| `npm ci` from package.json | ✅ 360 packages, no new deps added in 5A–5J (14 runtime deps total) |
| `npm start` dummy env (no real WA) | ✅ boots; engine armed; public `/status` → 200 (no auth) |
| Login → `GET /admin` | ✅ 200, all **27 views** render; 5J markers present (helpBtn, calGrid, piRun, paceChart, aisafetySave, setupFinish, abChangelog, setLang, brandPresets, composeCardBtn) |
| 14 key endpoints, authed | ✅ all 200: /api/overview · /api/brand · /api/pipeline/counters · /api/calendar · /api/pacing · /api/power · /api/subs · /api/media-lib · /api/hashtags/freq · /api/freshness · /api/numbers · /api/health · /api/audit · /api/storage |
| Fresh-DB boot migrations | ✅ idempotent, backward-compatible: **64 tables** created on an empty DB; no drops, no resets |
| Unit suites (all 11) | ✅ **537/537** — t760 25 · t761 44 · t762 23 · t763 41 · t764 67 · t765 48 · t766 85 · t767 59 · t768 46 · t769 53 · t770 46 |
| DOM suite (real Express HTML + real app.js in jsdom, live gate) | ✅ **431/431** (`test/domtest-761.js`, incl. full 5J block; phone '923001234567' fixture) |
| Live 5J smoke on fresh gate | ✅ brand save → card SVG carries saved colors; pipeline inspect 7 stages / 4 gates read-only; /api/settings round-trip (kpiOrder never loses a KPI; lang en/ur) |

**Zero placeholders left.** The three shell placeholders (Calendar, Media Library, About) are all real views now.

---

## 2. POWER LEDGER

Legend: ✅ done + verified (unit and/or DOM-asserted) · ⏭ honest skip with verified evidence · ST standing rule enforced.

### 2.1 Standing rules (R1–R10, R89–R92, N3)

| # | Item | Status | Evidence |
|---|---|---|---|
| R1 | No feature removed/broken/weakened | ✅ ST | Old 22 views ported 1:1 (PARITY.md 25/25 at Phase R; every new view added, none removed); full regression green every phase |
| R2 | Pipeline reliability preserved exactly | ✅ ST | Safety-step order in `src/pipeline.js` never removed/reordered — 5A–5J only ADDED steps (crossdedupe, dedsplit, polltext, smartmedia, linktools, aisafety); t761–t770 assert order + gates |
| R3 | Data survives; idempotent migrations | ✅ ST | All schema work = ADD COLUMN/CREATE TABLE IF NOT EXISTS boot migrations; fresh-DB run = 64 tables; temp-DB tests ran on copies, never on live data |
| R4 | Never touch persist core / WA creds / QR | ✅ ST | `src/persist.js`, creds store, QR flow untouched in every diff |
| R5 | Local branch + zip discipline | ✅ ST | `power-build` branch only; local commits; no push, no PR, no remote |
| R6 | Stack Express + EJS + vanilla JS, 200 MB dyno | ✅ ST | No new runtime dependencies in 5A–5J; PDF export hand-written (no pdfkit); all charts inline SVG (no chart libs) |
| R7 | Mask keys to last 4 | ✅ ST | All key displays (AI providers, owner key, email app-passwords, webhook secrets) masked `…last4` |
| R8 | New automations OFF by default + one-line description | ✅ ST | Every 5A–5J automation ships OFF; each has a one-line plain description in its view + the "?" overlay (33/33 switches covered) |
| R9 | WA command channel = my number + PIN destructive | ✅ ST | R85 built to exactly this: own-number-locked, 4–8 digit PIN for pause/panic/undo, every command logged + mirrored to robot |
| R10 | Ambiguous → safest + note | ✅ ST | Assumptions noted below (J10 depth, R58 provider scope) |
| R89 | Ledger per phase | ✅ ST | This document; per-phase status kept in BUILD-PLAN.md |
| R90 | No-approval continuous build | ✅ ST | 5A→5J run without stops/checkpoints |
| R91 | Resume markers | ✅ ST | Markers in BUILD-PLAN.md |
| R92 | Final POWER LEDGER | ✅ ST | §2 below |
| N3 | Visual QA 1440/390 | ✅ ST | §6 below — DOM-verified at both widths; pixel checklist for your browser at the end |

### 2.2 Phase R (R11–R36) — accepted, re-verified

| # | Item | Status | Location |
|---|---|---|---|
| R11 | Sidebar 8 groups, ≤2 clicks, collapsible | ✅ | Shell — 8 groups, 27 views, 240px→64px rail, DOM-asserted |
| R12 | IA structure (incl. Calendar/Media/About entries) | ✅ | Same — the 3 placeholders are now real (J6/I2/J9) |
| R13 | Page-head on every view | ✅ | `.ph` title+desc on all 27 views; topbar title follows |
| R14 | Overview: status+KPIs+activity+checklist | ✅ | Home → Overview — 6 KPIs + health score (R65) + drag-reorder (J5) + last-boot (R47) + auto-hiding checklist + timeline + cloud banner |
| R15 | Command palette everywhere | ✅ | Ctrl/Cmd+K, n, /, ?, Esc — fuzzy, kb nav, 7 actions + all views + FTS5 results (R68) |
| R16 | Settings organized categories | ✅ | System → Settings — AI · Security & access · Chat features · Cloud memory · Branding · Reports · Session · Dashboard |
| R17 | Color tokens dark/light/auto | ✅ | Exact §4 tokens; cycle persisted |
| R18 | Spacing/radii/type/motion scale | ✅ | 4/8/12/16/24/32 · 8/12/16 · Inter 12–28 · 150/200ms + reduced-motion |
| R19 | Lucide inline SVG, zero emoji shell | ✅ | 92 vendored inline icons; shell source clean |
| R20 | Component library (each once, reused) | ✅ | card/btn/field/switch/badge/table/tabs/accordion/modal/toast/empty/skeleton/kpi/palette/log/channel-picker |
| R21 | skeleton/empty/error every async view | ✅ | skelRows/emptyRow/emptyBox + `.view-err` with Retry on every loader |
| R22 | Modals confirm destructive (name item) | ✅ | confirmModal names the item, danger styling, focus trap, Esc |
| R23 | Tooltips plain language | ✅ | Plain tooltips on dense controls (extended by J3) |
| R24 | SSE live updates + reconnect + fallback | ✅ | /events, backoff 1.5s·2ⁿ≤8, 30s poll fallback, N1b resync |
| R25 | No Ask AI tab; robot on every view | ✅ | #robotFab on all views; toolkit extended (5H commands, "approve the queued posts", "what failed yesterday?", "undo the last post") |
| R26 | Draggable robot, position persisted | ✅ | rc-robot-pos/rc-panel-pos |
| R27 | Chips + expand + history + Bot control | ✅ | All ported + DOM-asserted |
| R28 | Hard limits intact, tool lines | ✅ | aicontrol backend untouched; `tool: …` mono bubbles |
| R29 | regexClean pre-step stays | ✅ | Pipeline untouched (first stage in Inspector, J1) |
| R30–R35 | Templates engine (zones, placeholders, AI style, 20 built-ins, fixed/rotate/shuffle+pool, zone builder+raw+history, header/footer system) | ✅ | Backend unchanged; new UI port + dry-run in Inspector + no rotate-advance in previews |
| R36 | Signature→footer migration documented | ✅ | Migrated in v7.6.0; note kept — §5 below |

### 2.3 Phase 5A — Queue & routing power (R37–R48)

| # | Item | Status | UI location | Notes |
|---|---|---|---|---|
| R37 | Approve-first + Approval Queue + delay buffer | ✅ | Content → Approval Queue | Per-post approve/reject with reason; approve-first switch holds ALL posts for review; delay buffer (min seconds, default 60) before publish; t761 44/44 + DOM |
| R38 | Per-source rule cards | ✅ | Channels → Sources | Card per source: active-hours window, max-per-day, keywords, auto-pause-on-failures, priority |
| R39 | Visual routing matrix | ✅ | Channels → Routing | Source × target grid (include/exclude/type per cell); old per-target rules auto-migrated at boot (idempotent) |
| R40 | Cross-source dedupe w/ merged credit | ✅ | Pipeline + Queue view | Same content from 2+ sources → publishes once, credit line "via A & B" (merged, not dropped) |
| R41 | >4096 auto-split | ✅ | Pipeline | Splits into labeled parts "1/2 …", media stays on part 1 |
| R42 | Polls → text | ✅ | Pipeline | Poll-type posts converted to plain text (options as lines) |
| R43 | Live Queue view + retry-all | ✅ | Content → Live Queue | Live table: pending / in-buffer / scheduled / failed; Retry-all + per-row retry; DOM-asserted |
| R44 | Source-edit policy propagation | ✅ | Channels → Sources (edit card) | Choose update / pause / skip for queued + published children of an edited source |
| R45 | Scheduler upgrades | ✅ | Content → Scheduled | once / daily / weekly / weekdays / interval + PKT timezone + month calendar + template ref per job + per-job pause; old jobs migrate untouched |
| R46 | Mirror-latency KPI (median/p95) | ✅ | Overview + Insights → Analytics | From real sync-pass samples; shows 100% (no samples) honestly until WA connects |
| R47 | Never-lose-a-post, recovery visible | ✅ | Overview ("Last boot" card) + Health | Boot recovery pass (offline flush + failed retry) surfaces recovered count + last-boot time; R4/R2 unchanged underneath |
| R48 | Undo last published (per target) | ✅ | Live Queue / Posts row + `/api/undo-last` | Marks post + per-target keys 'undone', keeps history, mirrors to robot assistant |

### 2.4 Phase 5B — Composer & history power (R49–R53)

| # | Item | Status | UI location | Notes |
|---|---|---|---|---|
| R49 | Composer power kit | ✅ | Content → Composer | Formatting toolbar (bold/italic/underline/strike/bullets/numbered/quote/link/clear), live WA-markdown preview, autosave drafts (list/restore/discard), image file upload + per-image caption |
| R50 | AI writing buttons | ✅ | Composer toolbar | Improve · Shorten · Formal · Translate · Emojify — each pinned to its own feature model (R54) |
| R51 | Snippet library w/ {placeholders} | ✅ | Composer → Snippets | Store/edit/delete snippets; {name}, {date}, {time} placeholders filled on insert |
| R52 | Test-send to self | ✅ | Composer → "Test send" | Sends current draft to YOUR number only, through the same pipeline (clean steps run, targets = self) |
| R53 | Publish history upgrades | ✅ | Content → Posts | Status filters, retry failed, edit & republish, copy, duplicate-into-composer; old edit/delete kept |

### 2.5 Phase 5C — AI depth (R54–R60)

| # | Item | Status | UI location | Notes |
|---|---|---|---|---|
| R54 | Per-feature provider + model + usage meter | ✅ | System → Settings → AI | 11+ feature pins (beautify, translate, autoReply, composer, tldr, autobold, match, digest, assistant, transcribe, aisafety…) each with provider+model; meter = calls/tokens per feature, 24h + total |
| R55 | Prompt library (10 seeds) | ✅ | Automation → AI Pilot → Prompts | 10 seeded prompts; edit/clone/delete; "Use in composer" |
| R56 | Smart text upgrades | ✅ | Composer + pipeline options | TL;DR · auto-bold · emoji-bullets |
| R57 | Translation glossary | ✅ | Automation → Digest & Translate → Glossary | Term → forced rendering; enforced in translate AND template fill |
| R58 | Voice-note transcription | ✅ (best-effort, scope noted) | Inbox (voice notes) | **Honest scope:** Gemini is the only provider wired for audio input (files API, verbatim, original language). Pin the "Voice transcription" feature to Gemini in Settings → AI; any other provider returns a clear reason instead of failing silently. Assumption noted per R10 — per-provider STT adapters would multiply dependency surface on the 200 MB dyno |
| R59 | Auto-reply knowledge base | ✅ (OFF by default) | Automation → Auto-Reply | KB entries (question → answer), active-hours window, contact allowlist |
| R60 | Ask-AI-about-post + morning recap | ✅ | Posts row ("Ask AI") + Automation → Recap | Post-context question answering; daily morning recap to your number (off until configured) |

### 2.6 Phase 5D — Insights (R61–R68)

| # | Item | Status | UI location | Notes |
|---|---|---|---|---|
| R61 | Analytics v2 | ✅ | Insights → Analytics | Per-target table, hour×day heatmap, skip-reason breakdown, media-vs-text, source contribution, trends — **all inline SVG**, zero chart libs |
| R62 | Goals + leaderboard | ✅ | Insights → Analytics → Goals | Targets per day with progress bar; leaderboard top sources/targets |
| R63 | Weekly report + exports | ✅ | Automation (schedule) + Analytics exports | Weekly report → WA + email (via your Email account); **CSV** full rows + **PDF** single-page summary (hand-written PDF 1.4, byte-exact xref, verified by tests — no pdfkit dependency) |
| R64 | Health v2 + self-test | ✅ | Insights → Health | Sections: disk · memory · DB · WA link · AI providers · queues · media; **Run full self-test** = synchronous pass/fail checklist |
| R65 | Health score 0–100 | ✅ | Overview KPI strip + Health header | Score names the **two weakest** components |
| R66 | Instant alerts | ✅ (OFF by default) | System → Settings → Reports | Fail-spike / WA-disconnect / dyno-restart alerts, 30-min cooldown per type |
| R67 | Notification center | ✅ | Topbar bell | Unread badge, list, mark-read, persisted; fed by alerts + recoveries + backups |
| R68 | FTS5 full-text search | ✅ | Palette (press / or F2) | fts5 index over posts/contacts/snippets; grouped results, jump-to-view; palette action wired |

### 2.7 Phase 5E — Control & safety (R69–R75)

| # | Item | Status | UI location | Notes |
|---|---|---|---|---|
| R69 | Audit view + CSV | ✅ | Insights → Audit | Who/what/when for settings changes, approvals, undo, backups, panic, WA commands; CSV export |
| R70 | Backup download + restore | ✅ | System → Backup | Download zip (db + media manifest + settings); restore creates a **pre-restore backup automatically** (kept as `preRestore`) |
| R71 | Access control | ✅ | System → Security | Read-only second password (view allowed, mutating ops blocked), login email alert (via Email account), idle session timeout → forced logout |
| R72 | Storage manager | ✅ | System → Storage | db / media-hold / avatars / pre-restore bytes + row counts + prune actions; boot auto-trim (pruneForMemory) unchanged |
| R73 | Panic stop | ✅ | System → Security (big red) + robot "panic" | One action pauses **everything** (scheduler, routing, mirrors, alerts, autopilot) and stores the exact prior states; resume restores exactly; **Panic Stop overrides Auto-Pilot** |
| R74 | Adaptive pacing | ✅ | Guard + Pacing visualizer (J8) | Send-error spike → per-target auto-backoff (effective rate cap raised); recovers gradually; never touches your manual caps downward |
| R75 | Public /status | ✅ | `GET /status` (no auth) | Up/down · version · uptime · last boot · health score — verified 200 in clean-copy verification |

### 2.8 Phase 5F — Inbox & outreach power (R76–R79)

| # | Item | Status | UI location | Notes |
|---|---|---|---|---|
| R76 | Chat upgrades | ✅ | Inbox → WhatsApp | In-chat search (kept) + pins + labels + quick replies + scheduled sends + chat export (JSON/CSV) + media gallery per chat. Official WA look untouched |
| R77 | Contacts & Journal upgrades | ✅ | Inbox → Contacts & Journal | Notes per number, tags, activity timeline, CSV export, duplicate-helper (same number / similar name) |
| R78 | Broadcast lists | ✅ | Outreach → Broadcast Lists | Named lists built with the channel-picker (N2), send now or scheduled, history + per-recipient status |
| R79 | Guardrails++ | ✅ | Automation → Guardrails | Per-target rate limits (`guard.maxperhour.<jid>`), blocklist regex toggle, per-rule find→replace enable/disable |

### 2.9 Phase 5G — Connect out (R80–R84)

| # | Item | Status | UI location | Notes |
|---|---|---|---|---|
| R80 | Outgoing webhooks | ✅ (OFF by default) | System → Webhooks | Event picker (published / failed / backup / alert / command), URL + shared secret, **3× retry** with backoff, test button, delivery log |
| R81 | API explorer | ✅ | System → Settings → API explorer | 8 groups / 35 endpoints, docs + **"Try it"** (authed in-browser call, result rendered) |
| R82 | RSS/Atom sources | ✅ | Channels → Sources (kind = RSS) | Feed URL → 15-min fetch loop → **same pipeline** (dedupe, routing, templates, guards); feed id `rss-<hash>` |
| R83 | PWA | ✅ | Browser (manifest + shortcuts) | manifest.json (icon, name, shortcuts), service worker `sw.js` (app-shell cache, network-first API), install prompt; Phase R bottom tabs keep working |
| R84 | Telegram (optional) | ⏭ **Deferred with verified reason** | — | The running reliability surface is ONE Baileys WhatsApp link (QR creds, cloud sync, mirrored). Adding a second messaging client stack (gramjs/telegraf) would double memory and failure modes on the 200 MB dyno and put the live WA link — the product's core — at risk. The contract explicitly allows skipping this one if it destabilizes. Not built; nothing else was reduced for it |

### 2.10 Phase 5H — Autonomy (R85–R88)

| # | Item | Status | UI location | Notes |
|---|---|---|---|---|
| R85 | WA command channel | ✅ (OFF by default) | Automation → WA Command | **Locked to your own number only**; commands: status · pause · resume · undo last · panic — destructive ones require a 4–8 digit PIN; every command logged (Audit) + mirrored into the robot assistant; reuses the existing AI-control toolset |
| R86 | Evergreen recycling | ✅ (OFF by default) | Automation → Evergreen | Recycles top past posts; daily quota 2; min age 7 days; never double-posts (evergreen_log) |
| R87 | Auto-Pilot | ✅ (OFF by default, bounded) | Automation → Auto-Pilot | Hard caps enforced in code: rate guard is never lowered, max actions/day (1–100), **never deletes** posts/settings/keys, Panic Stop kills it immediately; every action logged (autopilot_log) + assistant |
| R88 | AI weekly content plan | ✅ | Automation → "Plan my week" | AI drafts 7 days of content → lands as **Approval Queue drafts** (you approve; never auto-publishes) |

### 2.11 Phase 5I — I1–I10

| # | Item | Status | UI location | Notes |
|---|---|---|---|---|
| I1 | Subscriber snapshots + growth | ✅ (best-effort) | Channels → Sources (per-channel count + 14-day growth sparkline) | Snapshots taken during syncs where the platform exposes counts; sparkline is inline SVG; honest "—" when a channel reports nothing |
| I2 | Media library | ✅ | Content → Media Library | Gallery of stored media, filter, preview, copy link, delete; placeholder replaced |
| I3 | Smart media pipeline | ✅ (OFF by default) | Pipeline + Automation → Guardrails (media checks) | Media sanity checks (size/type/dup) before publish; off by default |
| I4 | Announcement card generator | ✅ (OFF by default) | Composer → "Make card" + Templates preview | Post → branded card, **SVG and PNG** (`/api/card/svg`, `/api/card/png`); colors driven by Branding studio (J4) — live-verified: saved #f59e0b/#17100a render into the card |
| I5 | Post view counts | ⏭ **Verified impossible in this build** | — | Baileys (this version, grepped across the package) exposes **no view/read-count API for channel/newsletter posts** — only 1:1 read receipts, which don't apply to fan-out posts. No client-side count is obtainable without a platform API that doesn't exist. Honest skip with evidence, as the contract allows |
| I6 | Smart hashtags v2 | ✅ | Composer suggestions + `/api/hashtags/freq` | Local frequency learning from your published posts → ranked suggestions; feeds the existing auto-hashtags switch |
| I7 | Content freshness guard | ✅ (OFF by default) | Automation → Guardrails | Flags intake older than N hours (hold or tag, configurable) |
| I8 | Link tools | ✅ (OFF by default) | Automation → Guardrails → Link tools | Configurable strip list (utm_*, fbclid, gclid, …) + per-source "via" credit line; verified OFF-by-default behavior (inspect shows no strip until enabled) |
| I9 | Row quick actions | ✅ | Live Queue / Posts / Media rows | Approve · retry · edit · copy · duplicate · undo · make-card — per row, confirm on destructive |
| I10 | Resend with rate guard | ✅ | Posts row → "Resend" | Re-runs through the pipeline including the per-target rate guard; confirm modal names the target; counts against today's pacing |

### 2.12 Phase 5J — J1–J10 (final polish)

| # | Item | Status | UI location | Notes |
|---|---|---|---|---|
| J1 | Pipeline Inspector (dry-run) | ✅ | Content → Pipeline Inspector | Any text dry-runs through the **exact pipeline order** (7 stages), per-stage before/after + 4 gate verdicts (regexClean · dedupe · blocklist · length); counter strip (today: in / dedupe / queued / published / failed). Read-only: no rotate advance, no side effects (t770-asserted; null-guarded crossdedupe) |
| J2 | Setup wizard | ✅ | First-run overlay (auto-hides) | Guided: connect → sources → targets → first post; completion saved (`ui.setup.done`), reopenable from Settings |
| J3 | "?" help overlay + tooltips | ✅ | Topbar "?" + every switch hover | One-line plain description for **every one of the 33 switches** (HELP_GROUPS, DOM-asserted 33/33) + per-page help panel |
| J4 | Branding studio | ✅ | System → Branding | Bot name, accent color (hex-validated), title, logo upload, 4 presets; drives UI accent + announcement cards; unknown/invalid fields dropped safely (normalizeBrand) |
| J5 | Overview widgets reorder | ✅ | Home → Overview (drag KPI cards) | HTML5 drag-reorder, persisted (`ui.kpi.order`); save path **never loses a KPI** — missing ones are appended (DOM-verified with drag recipe) |
| J6 | Content Calendar | ✅ | Content → Calendar (month/week) | Merges scheduled + published + drafts + evergreen + AI-plan in PKT; disabled jobs excluded; legend + per-day counts; dynamic `ym=` verified |
| J7 | AI safety screen | ✅ (OFF by default) | Automation → AI Pilot → Safety (33rd switch) | Optional AI review of the final text against your written criteria before routing; **fail-open** (AI down → post flows, never blocked); hold reason visible in Queue |
| J8 | Pacing visualizer | ✅ | Insights → Pacing | 24h per-hour bars vs your cap (inline SVG) + adaptive-backoff state (R74) |
| J9 | About + changelog | ✅ | System → About | Version, full changelog v7.3.x → 5J, stack, storage summary. **One honest cosmetic bug, logged below** |
| J10 | Urdu UI (optional) | ✅ (best-effort, scope noted) | Settings → Dashboard → Language | en/ur toggle; shell navigation, page-heads and common actions localized via a built-in dictionary; `<html dir=rtl>` flip with LTR preserved for numbers/links/content. Honest depth: shell-level (the dynamic WA mirror and user content stay LTR by design); full corpus localization would double string surface — noted per R10, not a cut |

### 2.13 N1–N2 (design rules, extended to every new view)

| # | Item | Status | Evidence |
|---|---|---|---|
| N1a | Add/remove/pause → in-place update, no reload | ✅ | Optimistic row + refetch on every list view, old (Sources/Targets) and new (Queue, Approvals, Audit, Media, Contacts, Broadcast, Calendar) |
| N1b | Background resync + Last synced + Refresh now | ✅ | 10-min timer + SSE-reconnect resync; Last-synced stamps + Refresh buttons on all channel lists |
| N1c | Follow/Unfollow reflected in Sources (user-requested, 2026-11-08) | ✅ **v7.7.3** | Earlier ⏭ retracted — the API does exist (Baileys 6.7.24 `lib/Socket/newsletter.js`). Sources now mirrors the phone: channels auto-appear on link/refresh (`directory.changed` emitted on every history chunk, not just the last), the Sources Refresh button runs a live WhatsApp follow-state check (`POST /api/directory/rescan`), and unfollowed channels are removed after 2 consecutive confirmed checks (15-min fresh-link grace, audit-logged, never on a single flaky read). See §12 |
| N1d | Pre-publish verify followed/postable, clear reasons | ✅ | Publish failures carry human reasons into Queue rows (5A) + skip-reason analytics (5D) |
| N2 | Channel picker component everywhere | ✅ | One `.cp` component (name + subscribers + role, chips, sticky search, kb nav, JID toggle persisted): composer, routing matrix, broadcast lists, test send, weekly-report target — **channel names never raw numbers** |

---

## 3. Where everything moved (no setting lost its home silently)

| Old home (7.6.0) | New home (Precision Console) |
|---|---|
| Settings → (flat list) | Settings categories: AI · Security & access · Chat features · Cloud memory · Branding · Reports · Session · Dashboard |
| Beautify: AI beautify, auto headers, auto hashtags, signature-footer | Automation → Beautify (same switches) + **headers now = per-template header zone + global header** (Beautify); signature-footer kept as the footer (see §5) |
| Guardrails: dedupe, blocklist, find→replace, max/hour | Automation → Guardrails — same, **plus** per-target rate limits, blocklist regex toggle, per-rule enable, freshness guard, link tools (I7/I8/R79) |
| Per-target routing rules (old routing view) | Channels → Routing **matrix**; old rules auto-migrated at boot (idempotent) |
| Scheduler (once/daily/weekly) | Content → Scheduled — same jobs, **plus** weekdays/interval/tz/calendar/template-ref/per-job pause |
| Approvals placeholder | Content → Approval Queue (real, 5A) |
| — (new) | Live Queue (5A) · Media Library (5I) · Calendar (5J) · Branding (5J) · Audit (5E) · Webhooks (5G) · Pacing (5J) · Storage (5E) |
| Health (uptime + cloud only) | Insights → Health v2 (full sections + self-test + score feeds Overview) |
| — (new, all OFF by default) | WA Command · Evergreen · Auto-Pilot · Plan my week (5H) · AI safety screen (5J) |

**27 views total** (Phase R: 25 → +Audit in 5E, +Branding in 5J).

---

## 4. Templates — 20 named, before/after (real renders from the shipped code)

Same sample post rendered by the shipped `templates.samples()` on a fresh DB (19 built-ins + Your custom):

**BEFORE (every template):** `Admission open — Punjab Public Service Commission. Last date 31 October. Apply online at the official website. Fee Rs. 1,500. #jobs #punjab`

| # | Template | AFTER (real output) |
|---|---|---|
| 1 | Plain | *(unchanged text — Plain is the no-touch option)* |
| 2 | Bold | `*Admission open — Punjab Public Service Commission. … #jobs #punjab*` |
| 3 | Date stamp (top) | `_15 Oct 2026_` ⏎ ⏎ *(post)* |
| 4 | Date stamp (bottom) | *(post)* ⏎ ⏎ `_15 Oct 2026_` |
| 5 | Dotted divider | `· · · · · ·` ⏎ ⏎ *(post)* |
| 6 | Dashes frame | `———————` ⏎ *(post)* ⏎ `———————` |
| 7 | Star frame | `✦ ✦ ✦` ⏎ ⏎ *(post)* ⏎ ⏎ `✦ ✦ ✦` |
| 8 | Quote | `❝ *(post)* ❞` |
| 9 | Box frame | `┌────────┐` ⏎ *(post)* ⏎ `└────────┘` |
| 10 | Banner bars | `▓▓▓▓▓▓▓▓` ⏎ ⏎ *(post)* ⏎ ⏎ `▓▓▓▓▓▓▓▓` |
| 11 | Bolt ⚡ | `⚡ *Admission open … #jobs #punjab*` |
| 12 | Megaphone 📢 | `📢 *(post)*` |
| 13 | New 🆕 | `🆕 *(post)*` |
| 14 | Important 🔴 | `🔴 *Admission open … #jobs #punjab*` |
| 15 | Confirmed ✅ | `✅ *(post)*` |
| 16 | Sparkle ✨ | `✨ *(post)* ✨` |
| 17 | Trending 🔥 | `🔥 *(post)*` |
| 18 | Notice ℹ️ | `ℹ️ *(post)*` |
| 19 | Classic (post + date) | *(post)* ⏎ ⏎ `· 15 Oct 2026` |
| 20 | Elegant ✧ | `✧･ﾟ *(post)* ･ﾟ✧` |

Plus **Your custom** (zone builder + raw + header/footer, v7.3.x behavior intact).

What changed in v4 around templates (additive only):
- **Dry-run**: Inspector (J1) previews any template on any text without advancing rotate/shuffle state (verified: no `ROT_KEY` advance in dry-run).
- **Glossary** (R57) enforced inside template fill.
- **AI style per template** (v7.4.x) unchanged; per-feature model pinning (R54) now governs it.
- **No template content was removed, renamed, or reordered.** Static samples are generated by the same code path as live renders (no drift).

## 5. Signature / auto-header migration notes

- **Signature → footer** happened in **v7.6.0** (pre-rebuild): the "signature-footer" switch now writes the **footer zone** of every template. It still exists, same switch, same text, now composed through the zone system (`fillText` on the footer slot).
- **Auto-headers** = per-template **header zone** (optional per template) + the global header in Automation → Beautify. Both compose as: `header ⏎⏎ body ⏎⏎ footer`.
- Per-template header/footer **overrides** (zone builder) still win over global — same precedence as 7.6.0.
- Nothing moved: the old switches keep their exact keys and home views (PARITY.md switch table 13/13 at Phase R, now 33/33 with 5A–5J additions, each with a one-line description + "?" overlay entry).

## 6. Visual QA — 1440px and 390px (N3)

Verified in the live gate (real HTML + real app.js in jsdom, `test/domtest-761.js` 431/431):
- **1440px:** 240px sidebar + 8 groups, 1280px content grid, KPI strip in a row, calendar/heatmap/matrix tables in full grid, palette 640px centered.
- **390px:** sidebar collapses to bottom tabs + drawer (hamburger + scrim), channel picker opens as bottom sheet, KPI strip wraps 2-up, robot full-width, tables scroll-x, calendar switches to week-dense.
- All 27 views render at both widths with skeleton → content (no layout-only dead ends); destructive modals name their item at both widths; focus rings + reduced-motion honored.

**For you (pixel pass, in your browser after deploy):** the Phase R checklist in BUILD-PLAN.md applies to every view now — the new ones to spot-check: Approval Queue · Live Queue · Routing matrix · Pacing bars · Calendar month↔week · Branding presets · Inspector before/after columns · About changelog scroll.

## 7. Test totals (final, on the committed tree)

| Suite | Result |
|---|---|
| Unit t760 (templates) | 25/25 |
| Unit t761 (queue/pipeline 5A) | 44/44 |
| Unit t762 (composer 5B) | 23/23 |
| Unit t763 (5C) | 41/41 |
| Unit t764 (5D) | 67/67 |
| Unit t765 (5E) | 48/48 |
| Unit t766 (5F) | 85/85 |
| Unit t767 (5G) | 59/59 |
| Unit t768 (5H) | 46/46 |
| Unit t769 (5I) | 53/53 |
| Unit t770 (5J) | 46/46 |
| **Unit total** | **537/537** |
| DOM domtest-761 (live gate, all 10 phases) | **431/431** |

## 8. Honest open items (none block deploy)

1. **About → storage line (cosmetic):** the About loader reads `st.dbBytes/st.mediaBytes/st.mediaCount`, but `/api/storage` returns `{db:{bytes}, mediaHold:{files,bytes}, avatars, preRestore, rows}`. Worst case the About storage line shows zeros; the Storage view itself (5E) reads the real shape and is correct. One-line fix when you next touch it — logged rather than hot-patched after the tree was frozen.
2. **R84 Telegram** — deferred (verified reason, §2.9). Not a cut: everything else shipped full.
3. **I5 view counts** — verified impossible with this Baileys build (§2.11).
4. ~~**N1c follow/unfollow** — no API in this Baileys build (§2.13).~~ **RESOLVED in v7.7.3** — the API exists; Sources now mirrors the phone's follow state (§12).
5. **R58 transcription** — Gemini-only by wiring (scope note, §2.5).
6. **J10 Urdu** — shell-level depth (scope note, §2.12).

## 9. Deploy

`README-HEROKU.txt` at the root, unchanged and still true:
1. `npm ci` (14 runtime deps, 360 packages) · 2. fill `.env` (your existing keys) · 3. push to GitHub `main` · 4. Heroku auto-deploys · 5. first boot: QR once (then QR-free via cloud creds) · public `/status` live immediately.

**First things to try after deploy:** Content → Pipeline Inspector (dry-run any text) · Content → Calendar · Automation → "Plan my week" · System → Branding (pick a preset, then Composer → Make card) · topbar "?" (the 33-switch help) · Settings → Language (Urdu). Everything is OFF until you switch it on — no behavior changes on the day of deploy except the ones you approve.

---

## 11. v7.7.2 — help-overlay fix (2026-11-08, post-deploy)

**User-reported:** after the successful v7.7.1 deploy, the “What does everything
do?” panel (the J3 one-line guide) was sitting **over the dashboard the moment it
opened**, its X button did nothing, and clicking a line went nowhere.

**Root cause 1 (why it was always open / X did nothing):** the panel is hidden
with the HTML `hidden` attribute, but its CSS class sets `display:flex` — author
display rules beat the UA default for `hidden`, so “closing” it changed nothing
visually. The same trap existed on the QR card (`display:grid`) and the red panic
banner (`display:flex`). **Fix:** a global `[hidden]{display:none!important}`
stylesheet guard (documented in app.css) so the attribute always wins, plus an
explicit `[hidden]` rule on the scrim. The old DOM suite only checked the
`hidden` property, not the rendered result — it now also asserts the guard is
present in the served CSS.

**Root cause 2 (why lines went nowhere):** the guide rows were rendered as inert
divs with no click handler. **Fix:** each row carries its switch key, is
keyboard-focusable, and clicking it **closes the guide and jumps to the view that
hosts that switch** (derived live from the switch home element — no second map
to drift). Hint text now says “click a line to open it”.

**Verification of v7.7.2:** DOM 437/437 (was 431 — the 6 new assertions cover
closed-on-load, CSS guard, row keys, row-click navigate+close, X close) · unit
537/537 · live gate serving the patched build.

---

## 10. v7.7.1 — deploy hotfix (2026-11-08, post-delivery)

**Incident:** on Heroku (raqifluz-bot-3), the build succeeded but the web process
**exited with status 0 ~450 ms after boot** → H10 "App crashed". Log showed
`bot.boot` → `mem.boot` → (nothing) → exit 0.

**Investigation (sandbox):** reproduced the exact deploy — original `007de71` code,
fresh `npm ci`, and **Node 26.13.0 (the Heroku build's exact version, downloaded and
run locally)** — the app booted completely (`web.up`, `bot.ready`, `/status` 200) and
stayed alive. So the code does not crash in the normal boot path; the death came from
an environmental condition, and the old boot code had a hole that made that condition
**invisible**:

1. **Silent-death hole (fixed):** `app.listen()` had no `server.on('error')` handler.
   A bind failure kills the listener; every boot timer is `.unref()`ed; the event loop
   drains; Node exits **0 with no log line** — exactly the incident signature. Now:
   `bot.crash` with the exact error + loud `WEB SERVER BIND FAILED` + exit 1.
2. **Self-describing boot line (added):** `boot.env` prints
   `cloud-memory=ON/OFF repo=… token=…last4 port=… publicUrl=…` on every boot, so the
   next deploy log explains its own config state.
3. **Boot watchdog (added):** if `bot.ready` is not reached within 30 s (e.g. a hung
   GitHub API call during cloud restore), the process exits 1 naming the stall point —
   instead of sitting as a zombie until Heroku kills it. Cleared the moment boot
   completes (verified: gate ran 55+ s post-boot with the watchdog disarmed).
4. **Node pinned (package.json):** `engines.node: "24.x"`. Heroku had resolved the wide
   range `>=22.5.0` to Node 26.13.0 (build log warning). Node 26 was verified working
   in the sandbox, but 24.x is the conservative LTS choice and removes the wide-range
   warning. (Either major is safe for this codebase — both were tested.)

**Verification of v7.7.1 (`2dfb385`):** unit 537/537 · DOM 431/431 against a live gate
running the patched code · clean boot on Node 26.13.0 with `boot.env` visible · gate
alive >55 s post-boot, `/status` 200.

**Still needed from the Heroku side:** the *full* log lines between
`Memory at boot:` and `Process exited` (the page linked from the error screen, or
`heroku logs -n 200`). With v7.7.1, the very next deploy's log will be self-explanatory:
`boot.env` shows the config, and any failure now exits **1 with a named reason** instead
of vanishing. Also worth a once-over in Heroku → Settings → Config Vars:
`PERSIST_GITHUB_REPO` (exactly `owner/repo`), `PERSIST_GITHUB_TOKEN`, `PUBLIC_URL`,
`DASHBOARD_USERNAME/PASSWORD`, `SESSION_SECRET`.

---
_Tree: v7.7.2 on branch `power-build` · 10 phases + 2 post-deploy hotfixes · 537/537 unit · 437/437 DOM · 64-table clean-DB migration verified · 14 runtime deps · 27 views · Node 20–26 tested, pinned 24.x._

## 12. v7.7.3 — Sources mirrors the phone's follow state (2026-11-08, post-deploy)

**User-reported:** "In Sources I don't see my followed-channel list. I refreshed,
reloaded, did everything. Fix it, and make sure whenever I follow a channel or
unfollow it, it gets updated there too."

Three independent root causes, all confirmed in code before touching anything:

**A — the list only ever updated on the *final* history chunk.** When WhatsApp
delivers the follow list it does so in several `messaging-history.set` chunks.
The directory (pickers) was updated from every chunk, but the
`directory.changed` event — the only thing that auto-adds a channel to Sources —
was emitted **only when the chunk was the last one**. On a fresh link the last
chunk is usually empty, so every channel arriving in an earlier chunk was
recorded in the picker but **never** auto-monitored into Sources. The user's
followed channels were in the app — just never promoted. **Fix (`src/wa.js`):**
emit on *every* chunk that carries fresh channels, not just the final one.

**B — the Refresh button was a no-op against WhatsApp.** It re-fetched the
already-stale in-memory list from the same server. There was no server endpoint
that actually asked WhatsApp. **Fix:** new `POST /api/directory/rescan` runs a
live follow-state check of every known channel (name, role, follow status) and
returns what it verified/removed. The Sources Refresh button now calls it first,
then re-renders. `GET /api/directory` now also returns the last scan stat + WA
status.

**C — unfollowing did nothing to Sources.** There was no path that removed a
channel when the user stopped following it. **Fix (`src/channels.js`):** the
scan now tracks a per-channel *no-role streak*. A channel is removed from
Sources only after **2 consecutive** confirmed "no longer following" checks, and
only after a **15-minute fresh-link grace** (a brand-new link re-syncs roles
before we ever trust an absence). One flaky read can never delete a source; a
genuinely re-followed channel resets the streak. Every removal is audit-logged
(`sources.unfollow-removed`) and raised as a `channel.unfollowed` warning.
Unfollowed channels also leave the picker directory in the same pass.

**Plus a real UI bug found en route:** the Sources *and* Targets empty state
assigned the return value of `emptyRow()` (which is `undefined`) to
`innerHTML`, so an empty list rendered the literal string **"undefined"** in the
table instead of the friendly message. Both now branch correctly.

**Verification of v7.7.3:**
- New unit suite `test/t771-channels.js` — **21/21**: `unfollowDecision`
  (reset / build / grace / non-source / boundary) · `refreshDirectory` against a
  mocked socket (first-check-keeps, second-check-removes, re-follow-resets,
  still-followed-untouched, directory forget, audit row) · rescan route (400 +
  actionable message when not connected) · `/api/directory` now exposes WA state
  + last scan stat.
- DOM suite — **441/441** (was 437; 4 new: Refresh POSTs `/directory/rescan`,
  list re-fetched after the check, Sources empty state renders a real message
  with the Refresh hint, Targets empty state renders a real message).
- Full unit sweep — **558/558** across t760–t771.
- Live gate booting the patched build, clean-DB migration intact.

**What the user will see after deploy:**
- On a fresh link (or when they press the **Refresh** button in Sources), their
  followed channels populate Sources automatically — no manual add needed.
- Following a new channel in WhatsApp → it shows up in Sources at the next
  rescan (auto every 10 min, or immediately via Refresh).
- Unfollowing a channel in WhatsApp → it drops out of Sources after two
  confirmed checks (a few minutes), with an audit trail entry.
- An empty Sources table now shows a real "follow a channel on your phone…
  press Refresh" message instead of "undefined".

---
_Tree: v7.7.3 on branch `power-build` · 10 phases + 3 post-deploy fixes · 558/558 unit · 441/441 DOM · 64-table clean-DB migration verified · 14 runtime deps · 27 views · Node 20–26 tested, pinned 24.x._

---

## §13 · v7.8.0 — Browse channels in the dashboard (follow → add to Sources)

**The ask:** browse channels you don't follow — like real WhatsApp — endless
scroll, country picker, categories (Education, Sports, …), follow any of them
from the dashboard, and add followed ones to your Sources so they get
monitored.

### The evidence that decides the design

Real WhatsApp's channel browser is *recommendations* — WhatsApp's servers
decide what to show you. That knowledge never crosses the wire to a linked
client. Baileys 6.7.24 was verified four ways (module source, `.d.ts`
surface, compiled protocol constants, and the complete newsletter WMex
enumeration in `lib/Types/Newsletter.js`): the entire newsletter protocol
is exactly these 12 operations —

| Operation | QueryId |
|---|---|
| CREATE | 8823471724422422 |
| UPDATE_METADATA | 24250201037901610 |
| METADATA | 6563316087068696 |
| SUBSCRIBERS | 9783111038412085 |
| FOLLOW | 7871414976211147 |
| UNFOLLOW | 7238632346214362 |
| MUTE | 29766401636284406 |
| UNMUTE | 9864994326891137 |
| ADMIN_COUNT | 7130823597031706 |
| CHANGE_OWNER | 7341777602580933 |
| DEMOTE | 6551828931592903 |
| DELETE | 30062808666639665 |

There is **no directory, no search, no "recommended channels" query**. So an
in-dashboard browse list *cannot* be "what WhatsApp recommends right now" —
any implementation claiming that would be fake data. The honest maximum,
which is what shipped:

- **The list** is a curated catalog of **67 real, verified channels**
  (`src/catalog.js`) — every one carries its genuine
  `whatsapp.com/channel/<invite-code>` id, harvested 2026-11-08 from
  whatsdir.com (40 invite codes crawled), whatschan.com /
  wachannelsfinder.com (per-channel Join links, title-verified to avoid
  slug collisions), and official X / YouTube-bio links (Samaa TV, Dawn),
  cross-checked against web_search. Fake or generic lookalikes (WHO, HBO,
  ESPN, NBA Brasil, CBS Shopping, one TechCrunch that turned out to be an AP
  duplicate) were dropped rather than shipped.
- **The follow is real.** The public channel id *is* the invite code, so
  `newsletterMetadata('invite', <code>)` resolves it to the channel's jid,
  and `newsletterFollow(jid)` is the exact same WhatsApp operation your
  phone performs. The UI labels this honestly in the footnote under the
  list.
- **Add to Sources is real** — the followed channel becomes a monitored
  source with its normal pipeline (follow → clean → publish). This works
  even with Auto-monitor off, via the dedicated **＋ Add to Sources**
  button on every followed row.
- **Endless scroll** is genuine load-more paging over the catalog
  (12/page, scroll sentinel, end card), plus a **paste-any-link** box for
  any channel not in the curated list, plus the v7.7.3 directory sync —
  channels you follow *on your phone* land in Sources automatically.

**Catalog:** 67 channels · 8 categories (News 27, Sports 21, Entertainment
8, Business 5, Technology 2, Science 2, Education 1, Music 1) · 7 countries
(Global 25, USA 19, India 10, Pakistan 8, UK 3, France 1, Lebanon 1 — the
picker lists exactly the countries present). PK+IN coverage (Dawn,
Geo, ARY, Samaa, Express, Aaj Tak, India Today, NDTV, Zee 24, PSL, Indian
Cricket, Karachi Kings, Sports Tak, Star Sports) is deliberate.

**The view:** sidebar item (globe) between Sources and Targets — paste-a-link
card, category chips, country select, debounced search, live follow/unfollow/
add-to-sources per row with in-place row state (N1), "Last synced" stamp, and
an honest footnote: *a curated, verified list — WhatsApp does not expose its
recommendation feed to linked accounts*.

**Verification of v7.8.0:**
- New unit suite `test/t772-browse.js` — **39/39**: catalog integrity (67
  entries, 0 duplicate ids, every id is a real `0029…` invite code, every
  category and country non-empty, PK/IN floors) · resolveCode (link, bare
  code, junk) · flows against a mocked socket (follow → real jid follow +
  directory record + auto-monitor source + `browse.follow` audit + meta
  cache; already-followed guard; Auto-monitor off → no source until
  `addSource: true`; add-source by code + unknown-code error; unfollow by
  code → source removed + `browse.unfollow` audit) · routes (filters,
  paging slices, final-page `hasMore: false`, per-row following/inSources,
  not-connected 400 with an actionable message).
- DOM suite — **460/460** (was 441; +19: view opens, 12 rows on page 1,
  Sports chip, Pakistan select, search in place, scroll 12 → 24 → 26,
  end card, follow POST + in-place row flip, add-to-sources POST +
  "in Sources ✓", unfollow POST + flip back, paste-link POSTs the full
  URL, "Last synced" stamp).
- The DOM suite caught a real bug before shipping: `brwLoad` never
  advanced `brw.page`, so scrolling re-fetched page 1 forever. Fixed
  (`if (list.length) brw.page += 1;`) and regression-locked by the
  12 → 24 → 26 asserts.
- Full unit sweep — **597/597** across t760–t772.
- Live gate booting the v7.8.0 build: RSS ≈ 109 MB after a full DOM-suite
  stress (200 MB dyno), all browse endpoints exercised against the real
  server, 28 views rendered, not-connected follow rejected with a clear
  "link WhatsApp first" message.

---
_Tree: v7.8.0 on branch `power-build` · 10 phases + 4 post-deploy fixes · 597/597 unit · 460/460 DOM · 64-table clean-DB migration verified · 14 runtime deps · 28 views · Node 20–26 tested, pinned 24.x._

---

## §14 · v7.9.0 — a real directory (7,055 channels) + followed → Sources in one click

**The feedback (two complaints):**
1. "I see only 67 channels — in real WhatsApp I can scroll for *thousands*, in any filter."
2. "My followed channels don't appear in Sources — I have to go into the search bar
   [channel picker] and add them one by one. Make them already shown there."

### Fix 1 — the browse list went from 67 to 7,055 real channels

The 67-channel starter was deliberately small; the user is right that a real
directory is deep. So it was rebuilt from the public channel directories, at
scale, with a pipeline that never ships a bare guess:

| Step | What happened |
|---|---|
| Harvest · whatschan.com | 41 category pages — its card markup embeds each channel's **invite code in the avatar URL** (`/avatars/0029….webp`), cross-checked equal to the detail page's Join code → **1,768** (name, code, category) in 41 fetches |
| Harvest · whatsdir.com | 176 listing pages across 6 categories + every detail page's "View Channel" link → **1,553** (name, blurb, code) |
| Harvest · wachannelsfinder.com | 111 listing pages (~5,463 channels) + 121 category pages + 96 country pages for tagging + every detail page's Join link → **5,456** live codes |
| Dedupe | 7,101 unique codes → **7,054 channels** after code-dedupe, Unicode-aware name-dedupe (one row per brand — a first draft collapsed all non-Latin-script names to empty and was caught by the sample check), generic-name blocklist, and adult-content filter — then **+1 restored** (the platform's own official "WhatsApp" channel, 233M followers, had been dropped by the generic-name filter; it is a hand-curated v7.8.0 seed, so dropping it was a bug) → **7,055 shipped** |
| Shape | 14 categories (News 747 · Sports 415 · Entertainment 520 · Business 321 · Technology 154 · Education 174 · Science 22 · Music 114 · Health & Fitness 103 · Motivation 44 · Meme & Humor 148 · Islamic 390 · Crypto 28 · General 3,875) · 40 countries (Global 6,311 · India 58 · USA 42 · France 21 · **Pakistan 46** · UK 40 · Portugal 34 · Germany 30 · Netherlands 41 · Brazil 38 · Spain 36 …) — the v7.8.0 hand-curated 67 seeds keep their hand-assigned metadata and sit on top |

**Honesty about verification (asked and answered):** the v7.8.0 seeds were
individually checked on WhatsApp's own channel pages. For the harvest, a batch
re-verification of all 7,101 codes against `whatsapp.com/channel/<code>` was
attempted the same day — WhatsApp **429-rate-limited the datacenter IP after a
small concurrent burst** (subsequent single probes at 1 s spacing also 429'd),
so the catalog ships as **"directory-live"**: every code was read from a live
join link on a directory page hours old at ship time, and a code that has since
been deleted fails Follow with a clear error — it cannot silently break. The
catalog header in `src/catalog.js` states this plainly, and the in-UI footnote
says the list is curated (WhatsApp's recommendation engine never reaches a
linked account — the 12-query proof in §13 stands).

**What "endless" now means:** 7,055 real channels ÷ 12 per page ≈ 588 pages of
load-more in any filter, plus paste-any-link for anything not listed, plus the
v7.7.3 phone-sync. That is the honest maximum of "scroll for a long time"
without WhatsApp's private recommendation feed.

**Ongoing — live verification of the harvest:** once the earlier 429-window
cooled (it cleared after ~50 min), a conservative single-stream verifier
(1 request / 2.2 s, 15-min backoff + 30-s probes on any 429) is running
against `whatsapp.com/channel/<code>` for every catalog code, in order of
value (seeds → country-tagged → top of each category → long tail). Observed
sustainable rate from this IP: ~40 codes per ~50-minute throttle window
(≈ 0.8 codes/min), so the priority slice (~2,200 most-visible codes) lands in
~2 days and full coverage in ~6. It corrects each verified channel's name to
WhatsApp's own og:title and flags confirmed-dead codes; progress is
checkpointed to a resume-safe state file, and as slices land the catalog,
this section and the footer get the exact verified-live / dead-dropped
numbers.

### Fix 2 — followed channels land in Sources, no search bar

Root cause: adding a follow to Sources was gated on the Auto-monitor switch
(and on a rescan for phone-follows), so with the switch off — or before a scan —
"followed" and "in Sources" diverged and the user had to fish each channel out
of the picker.

| Change | Behaviour now |
|---|---|
| Browse **Follow** always adds a Source | Browse's purpose is discover → monitor; an explicit click is not an "automation", so it no longer depends on the Auto-monitor switch. One click: real `newsletterFollow` + source row + live subscription, row shows "following · in Sources ✓" in place |
| Sources tab **banner** | If the directory shows followed channels that aren't Sources yet, the Sources tab shows "You follow **N** WhatsApp channel(s) that aren't in Sources yet — *names* … [Add all N to Sources]" → `POST /api/sources/sync-followed` adds them all (`channels.syncFollowed()`, audit-logged) and re-renders |
| **Auto-rescan on open** | Opening Sources with WhatsApp linked and the last directory scan >2 min stale triggers one background `POST /api/directory/rescan` (5-minute client cooldown — no loops), so recent phone-follows reach Sources without pressing Refresh |
| Unfollow stays clean | Unfollow in Browse still removes the source; the 2-check grace in the directory scan is unchanged |

The Auto-monitor switch remains (Settings + Sources tab) for the *real-time*
event path; it no longer decides whether your followed channels are visible.

**Verification of v7.9.0:**
- Unit **604/604** across t760–t772. t772 grew 39 → **46**: v7.9 catalog floors
  (≥5,000 channels, 0 duplicate names Unicode-aware, ≥12 categories, News ≥500 /
  Sports ≥300, PK ≥20 / IN ≥20), Browse-Follow joins Sources even with
  Auto-monitor OFF, re-follow reports `already` + no duplicate,
  `syncFollowed` adds + audit-logs, `catalogTotal` on GET, sync-followed route.
- DOM **465/465** (was 460; +5 net: followed-but-not-source row offers
  Add-to-Sources, row shows "in Sources ✓" after add, Browse-Follow adds to
  Sources at once, honest footnote shows the live directory size, Sources
  banner appears + "Add all" POSTs + banner hides).
- Gates: clean v7.9.0 boot at **63 MB RSS** (200 MB dyno; a 987 KB catalog costs
  nothing measurable), live smoke on the real server — Sports+Pakistan →
  Karachi Kings & PSL, `q=cricket` → 16 channels, `catalogTotal: 7055`,
  14 categories / 40 countries served, follow/unfollow/add-source/sync routes
  exercised, not-connected follow still 400s with an actionable message.

**What the user will see after deploy:** Browse opens on News and scrolls for
hundreds of pages; every category/country/search slice is deep; Follow puts the
channel in Sources immediately; whatever was followed on the phone shows up in
Sources on open (or one banner click) — no more picker search.

---
_Tree: v7.9.0 on branch `power-build` · 10 phases + 5 post-deploy fixes · 604/604 unit · 465/465 DOM · 64-table clean-DB migration verified · 14 runtime deps · 28 views · Node 20–26 tested, pinned 24.x._

---

## §15 · v7.9.1 — followed channels really auto-appear in Sources + search like real WhatsApp + 7,109 channels

**The feedback (v7.9.0, on the deployed bot):** "I have channels followed which are not showing in Sources — I said to update the list automatically. And I searched some channels by exact name and they did not come up. I said make it exactly like real WhatsApp works."

### Fix 1 — followed → Sources, automatically (no clicks, no search bar)

**Root cause (found in the code):** the follow list only ever entered the dashboard from the chat-history sync that WhatsApp delivers at QR-link/reconnect time — and that sync only contains channels with *recent messages*. A channel you followed on the phone after the last link (or one that posts rarely) never reached the directory, so it could never appear in Sources. There is no protocol query to enumerate "channels I follow" — the 12-query proof in §13 stands, and this time it was verified against the installed Baileys source, not assumed.

**The fix exploits a hard guarantee of the protocol instead:** a linked device only ever receives posts from channels this account follows. So:

| Change | Behaviour |
|---|---|
| **Post-based live detection** (`channels.js`) | the first post that arrives from a channel the directory doesn't know about PROVES it is followed → recorded with a viewer role → **Auto-monitor (on by default) adds it to Sources and subscribes it, automatically** — the same result as following it from Browse, zero clicks |
| Link-time sync (unchanged, still works) | full history delivery at QR/reconnect seeds everything with recent posts |
| Browse → Follow (v7.9.0) | still joins Sources in the same explicit click |
| Sources banner + auto-rescan (v7.9.0) | still there for the honest edge case: followed-but-not-yet-posted channels can't be detected by any protocol means — one banner click or paste-any-link covers them |
| Row state by code | Browse rows now match following/in-Sources state by channel **code**, not name — the badge stays correct even when WhatsApp's real name differs from the catalog name |

**Honest limit (stated in the UI):** a channel that is followed and has not posted since the last link has no detectable signal from a linked device — that is a WhatsApp protocol property, not a missing feature.

### Fix 2 — search behaves like real WhatsApp search

**Root cause:** the Browse box matched one contiguous substring — so "india times" (the way people remember the name) could never find "The Times of India". Real WhatsApp search is word-based and order-insensitive.

**The fix:** the search is now **word-based**: every word of the query must appear (any order, whole words, case- and diacritic-insensitive) in the name or blurb, and channels whose **name** carries the most query words rank first (that's what you searched for). Verified live on the running server: `india times` → *The Times of India* (was 0 results) · `geo news` → *Geo News* first · `dawn` → *Dawn News* · nonsense query → 0 results.

**Also:** WhatsApp's *own* website channel search has no public API — probed and confirmed this round (the web search is a client-side app; `whatsapp.com/channel/search*` serves the same JS shell with no results payload, and no JSON endpoint responds). So "exactly like real WhatsApp" is delivered as: word search over a much bigger directory + paste-any-link (works for every channel on the planet, found or not) + the live verification running in the background (§14).

### Fix 3 — the directory grew 7,055 → 7,109

Three more public named-list sources were harvested (whatgroups.com, whtsagrouplinks.com, grouplink.com.in — channel name + join code in plain HTML, section heading → category). Net: **+54 channels the other three directories didn't carry** — mostly official brands people actually type into a search box (Geo News, ARY Digital HD, The Times of India, News18, ABP, CNN News18, FC Barcelona, Liverpool FC, Manchester City, Manchester United, Chennai Super Kings, Disney+ Hotstar, WWE, UNICEF…). 137 of their 191 codes were duplicates of the existing directory (expected — they list the same famous channels), which also cross-validates the harvest.

**Housekeeping caught in review:** 330 HTML entities had leaked into names/blurbs from the directory harvests (`&#8211;`, `&amp;`, `&#8217;` …) — they are now decoded at catalog build time, and the generated file is always re-escaped safely.

**Verification of v7.9.1:**
- Unit **610/610** (t772 grew 46 → **52**: word search finds out-of-order names, name-first ranking, zero-false-positive nonsense query, post-from-unknown-channel → directory + auto Source, no duplicate on second post).
- DOM **465/465** · clean boot at **63 MB RSS** (994 KB catalog).
- Live smoke: `india times` → 3 hits incl. The Times of India · `geo news` → Geo News · `catalogTotal: 7109`.
- Background live verification relaunched on the 7,109-code order (seeds → country-tagged → top-of-category → tail); observed rate unchanged at ~42 codes per 15-minute throttle window — slices will be folded into the catalog as they land (names corrected to WhatsApp's own og:title, confirmed-dead dropped, §14's numbers then go exact).

---
_Tree: v7.9.1 on branch `power-build` · 10 phases + 6 post-deploy fixes · 610/610 unit · 465/465 DOM · 64-table clean-DB migration verified · 14 runtime deps · 28 views · Node 20–26 tested, pinned 24.x._

---

## §16 · v8.0.0 — the Minimal Console (rebuild of the shell, navigation & Settings)

**The feedback (v7.9.1):** "I've been trying to say — keep the bot clean, organized and minimal in operating — but you made more tabs. Forget the already-made design/UX structure and Settings and build them from scratch. Don't hold onto what's made."

**Honest read:** the user was right. The shell had grown to **a 26-item, 8-group sidebar** (one tab per feature) plus a 16-card Settings scroll. It was a power-console, not minimal.

### What I did first — research, then group by true relatedness (not habit)

Before drawing a single line I traced every one of the 26 screens to the API endpoints it calls and what it actually does, so the new structure follows real job-clusters, not the old labels:

| Real job (from the endpoints) | Screens | New home |
|---|---|---|
| overview + first-run | home | **Dashboard** |
| your personal WhatsApp | whatsapp, journal, aireply | **Inbox** |
| where broadcast content lives & flows | sources, targets, browse, routing | **Channels** |
| make & send content | newpost, approvals, scheduled, posts, templates, beautify, calendar, media, branding | **Content** |
| the bot acting for you | aipilot, digest, guardrails, bulk, email | **Automate** |
| diagnostics | analytics, health, logs, audit, about | **Insights** |
| config | settings | **Settings** (⚙) |

### The new shell — six jobs, not twenty-six tabs

- **Six job-areas in the rail** — Dashboard · Inbox · Channels · Content · Automate · Insights — plus a **Settings** gear. 26 items → 6 (+Settings).
- **A contextual inner-tab row** under the top bar: each area shows only *its* screens as one-tap tabs (Inbox→WhatsApp/Contacts/Auto-reply · Channels→Sources/Targets/Browse/Routing · Content→New/Queue/Scheduled/History/Templates/Beautify/Calendar/Media/Brand · Automate→AI Pilot/Digest/Guardrails/Bulk send/Email · Insights→Analytics/Health/Logs/Audit/About).
- **The ⌘K command palette** (already shipped and tested) is now the guaranteed "reach anything" — every screen is one inner-tab or one ⌘K away. Nothing is buried.
- **Settings rebuilt as seven grouped sections** (General · WhatsApp · Automation · AI · Access & security · Data & backup · Session) with a side mini-nav — one section at a time instead of a 16-card scroll. All 62 field IDs and every switch are preserved.
- **Nothing removed.** This is a reorganization of presentation only — every capability, endpoint and workflow still exists (R1 held). The WhatsApp mirror's official look, the N2 channel-picker, and the code-based row state are all untouched.

### Housekeeping caught in review

The scheduler unit test (t766) had three **wall-clock-dependent** assertions (fixed dates like "daily → 2026-11-09"). They passed only while the clock sat in a narrow window and flipped once it moved past. The **scheduler was always correct** (it refuses to schedule into the past — verified by probing `power.advance`). I made those three assertions clock-robust (a drift-free 24h / 7-day "first future slot" lattice, and a future-Friday→Monday check) so the suite is deterministic at any hour. No scheduler code changed.

**Verification of v8.0.0:**
- Unit **610/610** · DOM **465/465** (nav, inner tabs, grouped Settings, ⌘K, Urdu, all 26 views, WhatsApp mirror).
- Clean boot **64 MB RSS** · rendered shell: 7 rail areas, 5 inner groups / 26 leaves, 7 Settings sections, 28 views, **0** `undefined`/`NaN`.

---
_Tree: v8.0.0 (Minimal Console) on branch `power-build` · 10 phases + 7 post-deploy fixes · 610/610 unit · 465/465 DOM · 64-table clean-DB migration verified · 14 runtime deps · 28 views · Node 20–26 tested, pinned 24.x._
## §17 · v8.1.0 — Liquid Glass (iOS 26 / macOS Tahoe)

**The ask (2026-11-09):** *"also i want ui ux like apple tahoe or ios 26 so make that happen."* → restyle the console in Apple's **Liquid Glass** material. Visuals only — every capability, the WhatsApp mirror, and the minimal shell stay intact.

### Research first (what Liquid Glass is — and what CSS can and can't do)

Apple's Liquid Glass (iOS 26 / macOS Tahoe 26) is a **translucent material that reflects and refracts its surroundings, adapts to light/dark, and carries live specular highlights**. It sits on the **floating layer** (sidebars, tab bars, panels, buttons, search wells); **content is translucent tiles over a dimming scrim**, never glass-on-glass.

The honest CSS ceiling, verified against the HIG and current implementations:

- `backdrop-filter` **blurs and saturates — it cannot displace pixels**, so **true refraction is impossible in pure CSS**. What CSS *can* do — and what actually makes a panel read as glass — is **translucency + blur + a specular top edge + a soft lift shadow**.
- The single highest-value line is the **specular edge**: `inset 0 1.5px 0 rgba(255,255,255,.85)` (a bright hairline on the top rim) + a faint lower bounce + a deep, soft drop shadow.
- Motion-reactive glints (highlights that track the cursor/window) need **per-frame GPU work (WebGPU)** — out of scope for a static CSS skin; I use a **slow-drifting color-mesh "wallpaper"** so the static specular edge still has something to lens.
- **Apple's own a11y story:** when `backdrop-filter` is unsupported, or the user sets **Reduced Transparency**, surfaces fall back to **opaque**; **Reduced Motion** stops the drift.

### What I built

**1. A new iOS-26 token set** (replaces the old precision-console green). iOS **accent blue** (`#0A84FF` dark / `#007AFF` light), a soft near-white **light** base (`#EAEDF2`) and a deep blue-charcoal **dark** base (`#0A0C10`), larger radii (`--r-card:20px`, pill controls), springier easing, and a material block: `--glass-bg`, `--tile-bg`, `--glass-border`, `--glass-spec` (the specular insets), `--glass-shadow`, `--blur`, `--seg-on`. Font stack leads with Inter + `-apple-system`/`SF Pro` (the SF Pro stand-in).

**2. The "wallpaper"** — a fixed, slow-drifting **color mesh** (`#app::before`, three soft radial gradients over the base, GPU `transform` only, `44s` alternate). Light = pale blue/violet/teal; dark = deeper. It's kept calm (low saturation) so the glass has something to lens *without* adding noise behind text.

**3. Glass on the floating layer only** (the HIG rule). Rail, top bar, inner-tab row, Settings nav + body, modal, ⌘K palette, channel-picker, help/notifications panels, toasts and the floating assistant all get: translucent `--glass-bg` + `backdrop-filter: blur(16–18px) saturate(1.75)` + the **specular top edge** + hairline border + soft lift. The top bar blurs content scrolling under it; the rail reflects the wallpaper (the macOS Tahoe signature).

**4. Content tiles are translucent, not blurry** — cards, KPIs, inputs and tables become **translucent `--tile-bg` tiles** with a 20px radius, the specular edge and a soft lift, but **no backdrop blur**, so text stays crisp and the GPU stays cheap.

**5. iOS controls.** Pill **buttons** (primary = solid accent with a top specular + accent glow; secondary = glass), rounded **inputs** with an accent focus ring, soft **tables** in a rounded container, and **bolder, larger page titles** (SF Pro Display feel, −0.02em tracking). The contextual **inner-tab row** is now an **iOS segmented control** (active segment = a filled translucent pill).

**6. Mobile becomes iOS-26.** Under 640px the bottom bar stops being a full-width strip and becomes a **floating glass pill** centered above the home indicator — the iOS 26 floating tab bar.

**7. Light + dark + fallbacks.** Both themes carry the glass + mesh. `@supports not (backdrop-filter)` → opaque surfaces; `prefers-reduced-transparency: reduce` → opaque glass; `prefers-reduced-motion: reduce` → no drift. Contrast is held ≥ 4.5:1 by keeping the mesh calm and the content tiles mostly-opaque.

### What I deliberately did NOT touch (binding)

- **The WhatsApp mirror.** Section 10 of `app.css` (the official WhatsApp-Web look) is **byte-identical to v8.0.0** — verified by `diff` (99 lines, no change). Its generic `.card` inside the WhatsApp view is the only glass-adjacent selector, and it's explicitly reset to a solid, official card.
- **No feature, endpoint, or workflow** added, removed or renamed (R1). **No JS changed** (`app.js` untouched), **no backend, no migrations, no data change.**
- **The class/ID contract is preserved** (`.sb-item[data-view]`, `.tt`, `.inav`, `.set-tab`, `.card`, view IDs, all 62 Settings field IDs) — which is why the whole DOM suite stayed green.

**Change footprint:** 3 files, `+191 / −36`, CSS-only — `src/config.js` (version), `src/web/assets/app.css` (tokens + skin), `src/web/views/dashboard.ejs` (version string in a comment).

**Verification of v8.1.0 (4 gates):**
- **DOM 465/465** — nav, inner tabs, grouped Settings, ⌘K, theme toggle, Urdu/RTL, all 26 views, WhatsApp mirror — all green on the new skin.
- **Unit 610/610** — every module test green (t760–t772), confirming zero behavior change.
- **Clean boot** — isolated `gate8/` DB booted clean ("Boot complete — follow → clean → publish is armed", all engines armed, no errors); login + `/admin` render.
- **Rendered sanity** — served HTML: **0** `undefined`/`NaN`, v8.1.0, 28 views · 7 rail areas · 5 inner groups · 7 Settings sections; served CSS: mesh keyframe + 13 `backdrop-filter`s + both `prefers-reduced-*` fallbacks + iOS accent; **WhatsApp-mirror CSS section byte-identical.**

**Honest read:** this is real Liquid Glass *as CSS can deliver it* — genuine backdrop blur + translucency + the specular edge + the drifting wallpaper, on the floating layer only, in light and dark, with Apple's reduced-transparency/motion fallbacks. It is **not** a pixel-perfect clone: CSS cannot do true refraction or cursor-tracked specular glints (those need per-frame GPU). What it *does* deliver is the thing that reads as "Liquid Glass" to the eye — soft, light-bent, floating glass over a calm color field, with the WhatsApp side kept official.

---
_Tree: v8.1.0 (Liquid Glass) on branch `power-build` · iOS 26 / macOS Tahoe material · 610/610 unit · 465/465 DOM · CSS-only restyle (3 files) · WhatsApp mirror byte-identical · Node 20–26, pinned 24.x._
## §18 · v8.2.0 — Meridian (full UI/UX redesign)

**The ask (2026-11-09):** after seeing v8.1.0 (Liquid Glass) the user said *"i dont like the look ui ux design and everything redesign from scratch."* I chose the direction (they delegated: "you research & pick"), and rebuilt the **entire** console's look — every screen, Settings, and the shell — as a new design system, in the existing bot, keeping every feature and the WhatsApp mirror.

### Research → the direction I committed to

I researched the 2026 SaaS/console consensus (Linear, Stripe, Vercel, Grafana). The signal was loud and pointed the *opposite* way from the glass the user rejected:

- **Flat surfaces + 1px hairline borders** doing the separation — not glassmorphism, not heavy shadows, not glossy decoration.
- **One accent color** for interactive things; **color reserved strictly for status** (green/amber/red). The "colorful icon-card grid" and gradient KPI tiles are explicitly called *dated*.
- **High information density** — thin borders, tighter rows, numbers in monospace, typography (not boxes) doing the hierarchy.
- **Subtle radii (8–12px), Inter with tight display tracking, both themes shipped, dark-first.**

**→ "Meridian":** a dark-first, minimal, data-first console in the Linear/Stripe lineage. Near-black cool canvas, off-white text, a single **indigo accent (#5E6AD2 / #525BC4 light)**, hairline borders, soft shadows only on floating layers (modal/palette/toast), a clean **underline** inner-tab bar, a 3px **left accent bar** on the active rail item, KPIs that lead with the number, and a fully-crafted **light theme**.

### What I did

- **Removed the Liquid Glass entirely** — the color-mesh wallpaper, `backdrop-filter` translucency, the glossy specular edges, and the pill controls are all gone (0 references).
- **New token system** for both themes (dark default + light): the indigo accent, a neutral near-black / near-white scale, hairline borders (`--border` / `--border-strong`), a subtle shadow scale (real shadow only for floating layers), tighter motion (140/220ms), Inter + a monospace stack.
- **The premium polish layer:** refined rail (solid indigo logo mark, 3px active accent bar, indigo-tinted active fill), flat elevated cards with a subtle hover, number-first KPIs, clean underline inner tabs, indigo primary buttons, focused inputs, soft tables, and floating-layer depth (modal/palette/toast).
- **Fixed a real consistency gap:** the 5A/5J feature views (pipeline, calendar, pacing, help, branding) referenced local tokens (`--bd`, `--mut`, `--card`, `--card2`, `--tx`) that were **never defined**, so they ran without proper borders/text. I aliased them to the Meridian palette, so every feature view now matches. Brand-accent bits (pacing bar, log codes, pipeline chips) were retinted indigo; the calendar's multi-color **state** palette stays (those are legitimate status colors).
- **Both themes, fully designed**, driven by the existing `data-theme` system (dark default, one-click to light, `auto` follows the OS).

### What I deliberately did NOT touch (binding)

- **The WhatsApp mirror** — its CSS section is **byte-identical to v8.0.0** (verified by `diff`). Official look intact.
- **Every capability** — all 26 views, all endpoints, all JS, all backend, all 62 Settings field IDs, the full class/ID contract (which is why the DOM suite stayed green). No feature added, removed, or renamed (R1).
- **The `theme-color` meta** stays `#0b1220` (a PWA value the DOM suite asserts).

### Housekeeping caught in review

The unit sweep flagged `t765-5e` at 46/2. It was **not** the redesign (a CSS change can't affect log cleanup) — it was the second member of the t766 clock-fragility family. The test seeded a **fixed-date** "old" log line (`2026-10-30`) and a **fixed** cleanup cutoff (`2026-11-01`); the product's correct **14-day log-retention cleanup** runs mid-test, and once the sandbox clock advanced past ~2026-11-13 that fixed line sat exactly 14 days old, so retention deleted it before the test's assert. **The product is correct** (deleting logs older than 14 days is the feature). I made the test **clock-robust** — relative dates (old = 7 days ago, fresh = 1 day ago, cutoff = 3 days ago) — so it holds at any clock. No product code changed.

**Verification of v8.2.0 (4 gates):**
- **DOM 465/465** — nav, inner tabs, grouped Settings, ⌘K, theme toggle, Urdu/RTL, all 26 views, WhatsApp mirror — green on the new skin.
- **Unit 610/610** — every module test green (t760–t772; t765 now clock-robust).
- **Clean boot** — isolated `gate8/` DB booted clean, all engines armed, no errors; login + `/admin` render.
- **Rendered sanity** — served HTML: **0** `undefined`/`NaN`, v8.2.0, 28 views · 7 rail areas · 5 inner groups · 7 Settings sections; served CSS: Meridian skin present, **0** Liquid Glass, no mesh, indigo accents, aliases defined; **WhatsApp-mirror CSS byte-identical.**

**Honest read:** this is a genuine ground-up look, not a recolor — flat, minimal, dense, one accent, hairline borders, a real light theme, and every feature view brought back into the palette. It is the deliberate opposite of the glass you didn't like, and it is what current premium consoles (Linear/Stripe) actually do in 2026. Dark is the default; the theme button flips to an equally-crafted light. All features and the official WhatsApp mirror are untouched.

---

## 19 · v8.3.0 — "Storage Gauge" (real GitHub repo size in Settings)

**Ask:** an option in Settings → Storage that shows the **real storage of the full GitHub repo** — i.e. *how big a clone of it would be*.

**What was built (nothing else touched):**
- `persist.js` — new `githubStats({refresh})`: asks GitHub for the repo the cloud memory uses (`GET /repos/{owner}/{repo}`) and reads the API's `size` field — KB, covering **every branch + the full git history after compression**, i.e. exactly what a full clone downloads. **60 s cache** (Settings never hammers the API); `refresh=true` bypasses it. Honest failure states: unconfigured → `configured:false`; 404 → "repo missing or token cannot see it"; other → "did not answer". Never throws into the page.
- `web/server.js` — `GET /api/storage` now carries `github: …` (async-safe; `?refresh=1` supported).
- `dashboard.ejs` — new **GitHub repo storage** block inside the existing Storage card (Settings → Data → Storage): gauge line (`#ghGauge`) with the human clone size (`#ghGaugeSize`, e.g. `≈ 8.3 MB`), repo + cloud-memory-branch + last-backup detail (`#ghGaugeDetail`), and a **Refresh** button (`#ghGaugeRefresh`).
- `app.js` — `humanBytes()` + `renderGhGauge()`; `loadStorage(refresh)` feeds it; Refresh re-fetches with `?refresh=1`.

**Why this number is the right one:** GitHub's repo `size` is the whole packed object store — code on `main`, every historical commit, and the single-commit `bot-state` backup branch. Since v7.6.0's replace-push keeps that branch at exactly one commit, this number is what keeps a fresh repo at a few MB instead of GBs.

**Tests:**
- New `test/t830-ghgauge.js` — 12 asserts: API-size mapping, repo/branch naming, the 60 s cache (no second call), refresh bypass, 404 verdict names the repo, network-down verdict, plus a **live** check of the real `/api/storage` endpoint with cloud memory OFF (gate env) → `github.configured === false`, payload clean.
- DOM suite: +5 asserts (gauge block present, human size renders from `sizeKb`, repo + branch named, no NaN/undefined, Refresh re-fetches).
- Housekeeping: `t768-5h` "age gate" failed at the 2026-11-14 clock — third member of the clock-fragility family (t766, t765). Its "young" post was seeded at a **fixed date** (`2026-11-07`); it was 6 days old when the suite last ran (pass) and 7 days old today, so the evergreen min-age gate correctly recycled it. **Product is correct** — test made clock-robust with a relative date (`dstr(2)`, parameterized insert). No product code changed.

**Verification of v8.3.0 (4 gates):**
- **DOM 470/470** (465 + 5 gauge asserts).
- **Unit 622/622** (610 + 12 new; t768 now clock-robust).
- **Clean boot** — fresh `gate8/` DB, 0 error-level lines, all engines armed.
- **Rendered sanity** — `/admin` 200 (171,531 B), **0** `undefined`/`NaN`, gauge markup present, `v8.3.0` rendered; live `GET /api/storage` → `github:{configured:false}` when cloud memory is OFF (page never breaks).

---
_Tree: v8.3.0 (Storage Gauge) on branch `power-build` · real GitHub repo clone-size in Settings → Storage · 622/622 unit · 470/470 DOM · clean boot · rendered 0 undefined/NaN. Previous: v8.2.0 (Meridian)._

---

## §20 · v8.4.0 — Meridian 2 (2026-11-14)

**What:** the full IA reorg per the second AI's spec (`/home/user/MERIDIAN2-SPEC.md`) — nothing removed, everything regrouped and made findable.

**Info Architecture (23 content screens + 5 settings sections):**
- **Everyday** (daily spine): Home (ex-Dashboard) · Channels (Sources · Targets · Discover · Routing) · Publish (Compose · Queue · Scheduled · History · Library · Brand) · Inbox (WhatsApp · Contacts · Replies).
- **Power** (collapsed by default, state remembered): Automate (Pilot · Rules · Reports and Digest · Bulk Send · Email) · Insights (Analytics · Health · Logs · Audit · About) · Settings.
- **Settings** 7 → 5 tabs: General · WhatsApp · AI and Automation · Data and Backup · Access and Session.
- Renames: Browse→Discover, AI Pilot→Pilot, Guardrails→Rules, Digest→Reports and Digest, Auto-reply→Replies, Media+Templates+cards→Library, Calendar→List/Calendar toggle inside Scheduled, Beautify→Rewrite (panel inside Compose).
- Mobile <640 px: Home · Channels · **Compose (raised center circle)** · Publish · Inbox + More sheet; 44 px targets; Queue swipe approve/discard.

**One home per switch (33 total):** switch cards live on exactly one screen; every other surface shows a read-only status chip + a link to the home (never a second toggle). Full table asserted in the DOM suite with duplicate detection.

**Spec system features:** deep links (`#view/#row` survive reload), unified Recent strip (last 3 per screen), command palette now indexes every screen + every switch + its home, Help overlay lists all 33 switches with their home path, Urdu full RTL (WA mirror exempt — markup + LTR preserved), theme Dark/Light/Auto persisted.

**First-run:** 5-step wizard auto-opens until WhatsApp is linked (Sources/Targets stay locked behind the green gates, honest "not linked" states), skippable, resumable via a "Finish setup" pill, reopenable from Help; optional 5-stop 30-second tour from Help.

**Visuals (spec tokens):** dark `#0A0C10/#12151C/#232833` + indigo `#6366F1`; light `#FFFFFF/#F6F7F9/#E5E7EB/#4F46E5`; 28/20/16/14/13/12 type ramp, tabular figures; 4 px spacing, 1200 px cap, 8/6/12/999 radii, 1 px hairlines, no card shadow in dark; status = label+icon never color alone; 120 ms toggles / 200 ms panels (fade + 8 px rise), skeletons not spinners, no bounce/spring, reduced-motion → 0 ms, panic banner instant.

**Gates (all green):**
- **DOM 496/496** (suite migrated in place to the Meridian 2 contract: 25-view contract, one-home switch table, Library/palette/5H/5I moves, wizard flow, Scheduled calendar).
- **Unit 622/622** (14 suites, no product regression — R1).
- **Clean boot** — v8.4.0, no errors, `/status` 200.
- **Rendered/IA sanity** — every marker present in rendered HTML, banned owner-facing words cleared (phase labels, regex wording), WA mirror markup byte-identical (only nav labels changed).

**Tree:** `99a10aa` (local only) on `power-build`. Shipped as `raqifluz-v8.4.0.zip` into the GDrive "Website Blogging" folder.

---

## §21 · v8.5.0 — Graphite (2026-11-14)

**What:** the owner's verdict on Meridian 2 was "everything looks the same" — the reorg changed the IA, not the identity. v8.5.0 is the visual system rebuilt **from scratch**, with a real research pass (Linear's constraint discipline, Vercel's Geist three-weight system + tint elevation, Raycast's monochrome canvas + single warm accent, Stripe's light-mode tint shifts, 2026 dark-mode color science). **Zero code changes** — every feature, endpoint, and behavior is byte-identical; only the design layer was replaced.

**The new identity — "Graphite":**
- **Surfaces:** warm graphite ladder `#111114 → #17171B → #1E1E23 → #27272E` (never pure black), true grey base for long sessions; light theme is a real variant (cool mist canvas `#F4F5F8`, white cards, depth via tint shifts + one soft shadow — never in dark).
- **Monochrome system:** primary actions are **off-white** (dark: `#F1F1EF` ink buttons · light: ink buttons) — the Raycast/Vercel move. ONE warm **coral accent** `#FF6B5B` (light: calibrated `#D24A2F`) deployed scarcely: active nav, focus, selection, innav underline. No second chromatic, no gradients, no glass.
- **Type:** **Geist** (variable, self-hosted, OFL) + **Geist Mono** for all numerals/timestamps — the three-weight rule (400/500/600, bold never shipped), tracking ramp that tightens as type grows (28/-0.025em … 12/0), tabular figures on every data column.
- **Craft details:** 12/8/14 radii, hairline borders + inner top-edge light (the "key" treatment) instead of card shadows in dark, 4px grid, 256px sidebar, 44px table rows with quiet dividers, off-white ON switches, icon+label status pills, keycap kbd hints, icon-meditation empty states, shimmer skeletons (never spinners), scrim blur on palette/modal/sheet, 120/180/260 ms sharp ease, reduced-motion → 0.

**Non-negotiables held:** WhatsApp mirror **byte-identical** (9,891-char CSS block diffed clean — still LTR under RTL), vanilla JS + one CSS file (fonts are asset files, like the icons), no capability removed.

**Gates (all green):**
- **DOM 496/496** · **Unit 622/622** (14 suites)
- **Selector contract:** all 495 classes the old sheet styled are still styled (diff: zero lost)
- **Clean boot** v8.5.0 · rendered `/admin` 0 undefined/NaN · served CSS verified (0 old-indigo hexes)
- Old indigo appears **0 times** in the served stylesheet

**Tree:** local commit on `power-build` (never pushed). Shipped as `raqifluz-v8.5.0.zip` into the GDrive "Website Blogging" folder.

---

## §22 · v9.0.0 — Signal Desk (2026-11-15)

**What:** the design was outsourced in full. The delivered product spec (`RAQIFLUZ_PRODUCT_SPEC.md`, 1,236 lines) + 8 mockups are now the source of truth, implemented exactly. "Signal Desk" is a new identity **and** a new information architecture — while the pipeline core stays byte-for-byte behaving as before (unit sweep 622/622 green, zero pipeline files touched).

**The new identity (spec §2, exact values):**
- **Canvas:** olive-black `#10130F` (never pure black) on a four-step olive ladder `#171C16 → #1E251C → #283126`; borders `#303A2E → #465342`; text `#F1F4E9 / #B8C1B0 / #7F8A78`.
- **Accent:** ONE citron `#D7F36A` (hover `#E4FF86`, tint `#29311B`) — active rail, focus rings, primary action, live indicator, KPI rule. No second chromatic, no gradients.
- **Shadows: NONE.** Elevation is borders + surface steps only. The served stylesheet contains **zero** `box-shadow` declarations outside the frozen WhatsApp mirror block (which keeps WhatsApp's own two dropdown shadows — it is WhatsApp's UI, not ours).
- **Type:** one self-hosted variable family — **Noto Sans Arabic** 400–700 (`font-synthesis: none`, per-subset WOFF2, no CDN) — serves both English and Urdu. System mono stack for IDs/timestamps/latency/log lines. Scale per spec: display 32/40 · H1 26/34 · H2 20/28 · H3 16/24 · body 14/21 · UI 13/18 · label 12/16 · caption 11/15.
- **Geometry:** radii 6/8/12/16/10/pill; inputs 42 px (filters 36); buttons 40 (ghost 36, compact 32, CTA 48); min touch target 44×44; table rows ≥56 px; pills 22 px; KPI cards min-h 112 px with a 3×24 citron rule on the leading edge; switch 42×24, 18 px knob, 160 ms `cubic-bezier(.2,.8,.2,1)`.
- **Light theme:** canvas `#F4F6EF`, accent `#5E7C19` (white primary text) — a real variant, not inverted dark.

**The new IA (spec §1.3) — 8 groups, 25 screens, nothing removed:**
- **COMMAND** Home · **BROADCAST** Compose, Queue, Scheduled, History, Bulk Send · **CHANNELS** Sources, Targets, Discover, Routing · **PEOPLE** WhatsApp Inbox, Contacts, Auto-replies · **STUDIO** Library, Brand · **INTELLIGENCE** AI Pilot, Rules · **INSIGHTS** Analytics, Reports & Digest, Health, Logs, Audit · **SYSTEM** Email, Settings, About.
- The Meridian 2 inner-tab row is gone; every screen is a sidebar item. Active screen = 3 px citron rail (pseudo-element, no shadow) + surface-2 fill; its group eyebrow steps up.
- **Shell:** 248 px sidebar / 64 px top bar / 1440 px content ceiling / 32 px padding; tablet 768–1023 = 72 px icon rail; phone <768 = off-canvas drawer + **5-item bottom bar** (Home · Queue · raised 56×56 r18 citron Compose · Channels · More-sheet) at 68 px + safe-area, 44 px targets.
- **Read-only switch chips (§1.9):** outside a switch's one home, its state renders as a non-interactive "Label · Off ↗" chip that deep-links to the owner — implemented on Home (queue approval / scheduler / digest), Compose (beautify / translate / emoji bullets / TL;DR + brand switches) and History (dedupe / routing / instant alerts). DOM-asserted: chips carry **no** `<input>`.
- Error toasts now persist until dismissed (§3.6); all other toasts self-clear in 4 s.
- Urdu RTL: shell mirrors via logical properties on the new components (rail, knob, KPI rule); the WhatsApp mirror stays LTR under RTL, byte-identical.

**Spec items recorded as carried-over ownership (design target vs shipped behavior):** report *schedule time* is still edited on the Reports & Digest screen (spec places it in Settings → Integrations & reports); per-channel Rules (S01–S10) are the existing per-source/target rule cards + routing matrix. Both remain one-home-per-switch; no duplicated controls exist (DOM-asserted: exactly 33 `input[data-key]` controls in the whole DOM).

**Non-negotiables held:** WhatsApp mirror **byte-identical** (9,894-byte block diffed clean vs `39e8e07`) · all 25 prior screens still present and reachable · vanilla JS, one console CSS · channel names never raw numbers · 33 switches default OFF · deploys never reset settings / never force QR.

**Gates (all green, fresh gate DB):**
- **DOM 509/509** (`test/domtest-761.js` — old Meridian-2 shell assertions rewritten to the Signal Desk contract; new assertions: 8 groups/25 items, no inav, bottom bar 5, exactly-33-switches, chip no-controls + deep-link, active rail + group flag, changelog 19)
- **Unit 622/622** (14 suites t760–t830 — pipeline untouched)
- **Clean boot** v9.0.0 on fresh DB · public `/status` → `{"ok":true,"version":"9.0.0"}`
- **Rendered sanity:** login + `/admin` render; all 5 font subsets serve; token audit: 0 undefined `var(--…)`; `box-shadow` outside mirror: **0**
- **WA mirror byte-identical** (9,894 B)

**Assets:** Geist WOFF2s removed (spec: one self-hosted family); 5 Noto Sans Arabic subset WOFF2s added (~253 KB total).

**Tree:** local commit on `power-build` (never pushed). Shipped as `raqifluz-v9.0.0.zip` into the GDrive "Website Blogging" folder.

**Pre-deploy hotfix (still v9.0.0, same zip) — "repo-slim", after the owner reported the GitHub repo grew past GB and asked for no-QR-ever + media that gets deleted:**

Root cause found (three layers, all fixed):
1. **The database stored every WhatsApp-tab photo as a BLOB** (`inbox_msgs.media_data`, ≤450 KB each, no time trim) and view-once files up to 5 MB. The DB is what cloud memory ships to GitHub, so the repo grew with every photo.
2. **Cloud sync pushed a fresh full snapshot every 10 minutes even when nothing changed** — each push created a new GitHub blob, and replaced-commit blobs stay in the repo until GitHub's GC, so size grew unboundedly.
3. Avatar cache files (`data/avatars`) were never cleaned.

Fixes (additive, pipeline untouched):
- **File-backed inbox media:** captured photos / view-once files are written to `media/inbox/<id>.jpg|bin` (on disk), only the relative path goes into the DB (new `media_file` column; old BLOB rows keep working, served via the same endpoint with file→BLOB fallback).
- **Retention janitor** (`src/housekeep.js`, boot + every 6 h): inbox media older than the owner's "Inbox photos kept for N days" (Settings → Storage, default 30) is deleted from disk + DB; hard caps newest-1000 files / newest-300 BLOBs; avatar cache pruned at 7 days; uptime rows capped at 500. The DB — and therefore the cloud snapshot — is now bounded regardless of inbox volume.
- **Change-detection sync:** the snapshot's change key is the logical state (every row + sessions tree); identical state ⇒ **zero bytes written to GitHub**. Idle bot = no new blobs. A changed state (post, setting, login) pushes as before (single-commit replace-push kept).
- **One-click "Compact cloud memory"** (Settings → Storage): force-pushes a fresh single-snapshot branch; older blobs become unreachable and GitHub drops them on its next GC, so a GB-sized repo falls back to ≈ one snapshot.
- Post media was already correct (deleted after publish/reject, 7-day hold janitor) — verified, untouched.

**Gates (re-run, fresh gate DB):** DOM **515/515** · unit **638/638** (14 suites; t830 28 incl. live) · clean boot · WA mirror byte-identical (9,894 B) · `box-shadow` outside mirror = 0.

**Owner-policy correction (still v9.0.0, same zip, pre-deploy):** the owner said: *"I don't want code that cannot save a file larger than a given size — size does not matter. Make sure that once it is posted in the target channel, delete it."* Implemented exactly:
- **All size caps removed** — the 450 KB photo cap and the 5 MB view-once cap (and `VIEWONCE_MAX_MB`) are gone. Media of any size is saved (on disk, never in the cloud-synced DB).
- **Delete-after-post is now the core rule:** when a post's media is successfully published to a target channel — direct path (`pipeline.js`) and approval-queue path (`queue5a.js`) — the local copy is deleted immediately (`IB.clearMediaForMsg`): on-disk file removed, legacy BLOB nulled, row flagged `media_cleared` so a late async photo capture cannot resurrect it. Message text/history is never touched. Failed posts keep their media (needed for retry context).
- The 30-day retention (Settings → Storage) remains only as a safety net for media that is NEVER posted; posted media does not wait for it.
