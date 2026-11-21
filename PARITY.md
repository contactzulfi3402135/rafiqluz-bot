# FEATURE PARITY TABLE (living — updated per phase report)
_Old dashboard (7.6.0 shell, deleted 2026-11-08) → new Precision Console shell.
One missing feature = failed phase._
_Status key — **✓** = DOM-asserted in the live gate run (`test/domtest-761.js`, 79/79 green, real Express HTML + real app.js in jsdom); **◐** = wired to the same loader path that ✓ rows exercise (no standalone DOM assert yet — will be covered the moment that view is exercised in a later phase's DOM pass)._

## Views (22 old → 25 new)
| Old view (data-view) | Old content | New location | Status |
|---|---|---|---|
| home | cloud banner, pause bar, 6 KPIs, QR card, setup checklist, activity feed | Overview → Dashboard (same blocks, new design) | ✓ |
| sources | add (invite link + compact multi-pick), automonitor switch, table (map/pause/remove), count | Channels → Sources — picker = N2 component; + Last synced/Refresh now (N1b) | ✓ |
| targets | add (invite link + multi-pick, admin-only), table (pause/remove, role badges), count | Channels → Targets — N2 picker + N1b | ☐ |
| routing | routing switch, per-target include/exclude/type rules, save | Channels → Routing (same behavior) | ✓ |
| newpost | composer: text, image URL, AI clean-up, target chips, publish | Content → Composer (N2 picker for targets) | ✓ |
| scheduled | scheduler switch, add form (target/name/time/repeat), table (pause/delete) | Content → Scheduled (same) | ✓ |
| approvals | static "arrives in 5A" empty state | Content → Approval Queue (placeholder; real queue = 5A) | ✓ placeholder |
| posts | history table (select/edit/delete), Edit Posts switch, purge-by-range | Content → Posts (same; prompt()→modal) | ✓ |
| templates | modes (off/fixed/rotate/shuffle), 20 grid + pool + samples, live bubble preview, zone builder, raw, history, ph chips, AI style per template | Content → Templates (same data, new layout) | ✓ |
| beautify | beautify switches (AI beautify/auto headers/auto hashtags/signature-footer), AI instruction, global header & footer | Automation → Beautify (same) | ✓ |
| aipilot | switch + rule input | Automation → AI Pilot (same) | ◐ |
| aireply | switch + instruction | Automation → Auto-Reply (same) | ◐ |
| digest | switches (translate/digest) + lang + time | Automation → Digest & Translate (same) | ◐ |
| guardrails | dedupe switch + blocklist + find→replace + max/hour | Automation → Guardrails (same) | ✓ |
| whatsapp | WhatsApp-Web mirror: chat list, contacts panel, number band + switcher + connect flow, conversation (media/voice/docs/deleted/edited/view-once, day dividers, search-in-chat, load older), send, emoji, live 8s refresh | Inbox → WhatsApp — **official look unchanged, behavior 1:1** | ✓ smoke |
| journal | watched numbers: add, table, remove | Inbox → Contacts & Journal (same) | ✓ |
| bulk | recipients+{name}+groups, paced send, history | Outreach → Bulk Send (same) | ◐ |
| email | accounts (connect/test/default/remove, app-password link), compose (send now/schedule), queue (cancel), history | Outreach → Email (same) | ◐ |
| analytics | days selector, 4 KPIs, stacked bar chart, analytics switch, top sources | Insights → Analytics (same) | ✓ |
| health | boots KPIs, boot log, 5D placeholder | Insights → Health (same) | ✓ |
| logs | level chips, 150-line log view | Insights → Logs (same + log-viewer wrap/copy niceties) | ✓ |
| settings | AI provider/model/key (20 providers, live model list, custom model, test, per-provider key line), owner API key (regen), chat features (4 switches), cloud memory (backup now, CSV exports), branding (bot name), daily report phone, session (logout) | System → Settings — collapsed categories: AI · Security & access · Chat features · Cloud memory · Branding · Reports · Session | ✓ |
| (new) calendar | — | Content → Calendar — placeholder "arrives in 5J (J6)" | ✓ placeholder |
| (new) media | — | Content → Media Library — placeholder "arrives in 5I (I2)" | ✓ placeholder |
| (new) about | — | System → About — placeholder "arrives in 5J (J9)" | ✓ placeholder |

## Switches (13, /api/power) — every one keeps its exact home view
| Key | Name | Home (old = new) |
|---|---|---|
| scheduler | Scheduler | Scheduled |
| routing | Smart routing | Routing |
| analytics | Analytics | Analytics |
| editposts | Edit posts | Posts |
| aipilot | AI pilot | AI Pilot |
| dedupe | Smart dedupe | Guardrails |
| beautify | AI beautify | Beautify |
| headers | Auto headers | Beautify |
| hashtags | Auto hashtags | Beautify |
| signature | Signature (footer) | Beautify |
| translate | AI translate | Digest & Translate |
| digest | AI daily digest | Digest & Translate |
| aireply | AI auto-reply | Auto-Reply |
Plus: automonitor (Sources), antidelete/antiviewonce/antiedit/rejectcalls (Settings → Chat features).

## API endpoints used by the old UI (all must keep answering — backend untouched)
/api/status · /api/qr · /api/overview · /api/logs · /api/power · /api/power/toggle ·
/api/power/template · /api/power/tplstyle · /api/power/aipilot · /api/power/routing ·
/api/power/scheduler[+/:id] · /api/sources[+/:id] · /api/sources/bulk · /api/targets[+/:id] ·
/api/targets/bulk · /api/directory · /api/settings · /api/compose · /api/posts · /api/posts/edit ·
/api/posts/delete · /api/posts/purge · /api/analytics · /api/numbers[+/:id] · /api/numbers/:id/qr ·
/api/inbox · /api/inbox/:jid · /api/inbox/:jid/avatar · /api/inbox/:jid/media/:id ·
/api/inbox/:jid/read · /api/inbox/:jid/open · /api/inbox/:jid/send · /api/inbox/:jid/history ·
/api/contacts · /api/watched[+/:phone] · /api/bulk · /api/bulk/history · /api/email/accounts[+/:id] ·
/api/email/accounts/:id/default · /api/email/test · /api/email/send · /api/email/queue/:id/cancel ·
/api/email/history · /api/features · /api/ai · /api/ai/models · /api/ai/test · /api/ai/chat ·
/api/ai/control · /api/apikey/regenerate · /api/mirror/pause · /api/persist/status ·
/api/persist/backup · /api/persist/test · /api/uptime · /api/export/posts.csv · /api/export/logs.csv ·
/events (SSE) · /icons/*.svg · /media/avatars/* · /app.css · /app.js

## Global behaviors
| Behavior | Old | New |
|---|---|---|
| SPA view routing + last-view persistence | ✓ | ✓ (same key semantics, new router) |
| 30 s status poll + SSE (status/activity, quiet views, focus guard) | ✓ | ✓ |
| Theme dark/light, persisted | ✓ | ✓ + **auto** (R17) |
| Sidebar collapse (240↔64) + group collapse, persisted | ✓ | ✓ |
| Floating robot: every view, draggable+persisted, history, Bot control, chips, expand, clear | ✓ | ✓ |
| Command palette Ctrl/Cmd+K (views + actions) | ✓ | ✓ + n = new post, / = search, ? = help, Esc |
| Collapsible cards (title click, persisted) | ✓ | ✓ (accordions) |
| Toasts (err/ok), 4 s | ✓ 5.2 s | ✓ 4 s + Undo where relevant (R22) |
| confirm()/prompt() usage | used for destructive/edit | **replaced by modals naming the item** (R22) |
| Skeleton/empty/error on async views | ✓ | ✓ |
| Zero emoji in shell (emoji only inside WhatsApp mirror + content data) | ✓ | ✓ (N3) |
| Channel names never raw numbers (jidPrettify/chanName) | ✓ | ✓ |
| Profile-photo hydration in mirror (data-ava-jid) | ✓ | ✓ |
| Keys/passwords never displayed in full | ✓ | ✓ (R7) |
| Login page (username/password, JSON login + bearer token, rate-limited note) | ✓ | ✓ restyled, same flow |
| Public /connect pairing page (QR + pairing code) | ✓ | ✓ unchanged (self-contained) |

## N1/N2 additions in Phase R
- N2 channel-picker used in: Sources add, Targets add, Composer targets, per-source Map modal.
- N1a: add/remove/pause from any surface updates the affected table row in place (optimistic + refetch), no page reload.
- N1b: Sources + Targets show "Last synced …" + Refresh now; auto-resync on WhatsApp reconnect (SSE status→open) and every 10 min.
- N1c: ⏭ no Baileys join/leave-newsletter API in this build → manual add kept (documented).
- N1d: current publish path already rejects dead targets with a reason; structured queue reasons ship in 5A (R43).

## Phase R verification record (2026-11-08)
**Gate run:** sandbox boot with dummy env (no PERSIST, closed WA) → `GET /admin` served 90,953-char HTML; login flow OK; SSE + status poll wired.
**Tests (all green):** `test/t760-tpl.js` 25/25 · `test/persist-push.js` 7/7 · `test/domtest-761.js` 79/79 (replaces domtest-760, which targeted the deleted shell).
**DOM-asserted (761):** 25 views + 8 sidebar groups + 5 bottom tabs · router + title + active state · zero emoji in shell · no "undefined" in DOM · N2 picker (names+subs, pre-tick, search, chips, JID toggle persisted, count chip) · N1a bulk add in place (table 1→2 rows, picker re-render, no reload) · composer preselect + publish payload · theme cycle + persistence · palette Ctrl+K/fuzzy/Enter/Esc · templates v2 grid · posts names-not-jids · scheduled table + target select · routing rules pre-fill · 13 switches exactly once in home views · settings populated (bot name, blocklist, AI state, provider list, API key) · confirm modal names item + danger style + Esc · robot history + send + Bot control toggle · logs lines + level filter + chip state · analytics bars + by-source names + KPIs · WhatsApp mirror smoke (.ww shell, number band +92…) · journal + health.
**N3 visual QA (honest scope):** jsdom has no layout engine — structural/DOM + full API-contract assertions done in-sandbox; pixel-level 1440px/390px rendering verified by the user in-browser after deploy (checklist ships with the phase report). Static CSS audit passed: only 4/8/12/16/24/32 spacing, 8/12/16 radii, Inter self-hosted (400/500/600/700), Lucide inline stroke 1.75, shell 240→64 rail / 56 topbar / 1280 content, <1024 drawer+scrim, <640 bottom tabs, prefers-reduced-motion honored, zero legacy class names, zero emoji in shell source.
**WhatsApp mirror:** official palette (#0b141a/#111b21/#202c33/#00a884) kept as an isolated `.ww/*` namespace — 22 refs, shell tokens do not leak in.
