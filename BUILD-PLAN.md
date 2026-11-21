# RAQIFLUZ CHANNEL BOT — POWER BUILD v3 LEDGER
_Contract v3 (final, supersedes v1/v2) · 2026-11-08 · working branch `power-build` in /home/user/v600_

## Rebuild mandate (accepted)
Dashboard frontend = **legacy-free zone**: `src/web/views/dashboard.ejs`, `src/web/assets/app.js`,
`src/web/assets/app.css` deleted and rewritten from blank files. No old classes/DOM/JS patterns.
Login/connect pages: light restyle only, flow unchanged. Backend core (pipeline, wa/Baileys,
persist.js, db, auth, all API endpoints) is preserved and may be EXTENDED, never rewritten for
reliability logic. `PARITY.md` = living feature-parity table, shipped in every phase report.
Order: **PHASE R** (new shell + design system + full parity port) → 5A → 5B → … → 5J.

## Phase R plan (shell → components → parity port)
1. **Delete** old dashboard.ejs / app.js / app.css (git history keeps them).
2. **Design system CSS** (blank): §4 tokens (dark default + light + auto), foundations (spacing
   4/8/12/16/24/32, radii 8/12/16, Inter self-hosted 400–700, tabular numerals, ui-monospace),
   shell (240px→64px sidebar, 56px topbar, 1280px content, <1024 drawer, <640 bottom tabs),
   page anatomy (page-head, summary strip), components (card, btn, field, switch, badge, table,
   tabs, accordion, modal, toast, tooltip, empty, skeleton, kpi, progress, timeline, palette,
   log-viewer, **channel-picker N2**), motion 150/200ms, focus ring, reduced-motion, a11y.
3. **Shell EJS** (blank): 8 sidebar groups (P1 exact structure incl. Calendar J6, Media Library
   J2/I2, About J9 as placeholder entries), topbar (title, WA badge, palette trigger, bell,
   theme), 25 view sections, palette + modal + toasts + robot DOM.
4. **app.js** (blank): router, api/SSE client (reconnect + polling fallback), theme
   dark/light/auto, channel-picker component (N2), N1 live channel sync (in-place updates,
   10-min resync + on reconnect, Last synced / Refresh now), all 17 loaders ported 1:1 by
   behavior, robot assistant, palette (Ctrl/Cmd+K, n, /, ?), WhatsApp mirror (official look,
   unchanged behavior), collapsible cards.
5. **Verify**: sandbox boot (dummy env, no real WA), every view renders, endpoints answer,
   unit tests (t760-tpl, persist-push) green, new DOM tests green, N3 visual QA at 1440/390.
6. **Ship**: PARITY.md validated (m/n), commit, phase zip.

## Requirement ledger
Status: ✅ done+verified · 🔧 partial/rebuild · ❌ not started · ⏭ deferred (reason) · ST = standing rule
Phase R = rebuild shell providing P1–P4. 5A–5J on the new shell.

| # | Requirement | Phase | Status (2026-11-08) |
|---|---|---|---|
| R1 | No feature removed/broken/weakened | ST | ST — enforced via PARITY.md every phase |
| R2 | Pipeline reliability preserved exactly | ST | ST — backend untouched in Phase R |
| R3 | Data survives; idempotent migrations | ST | ST — no schema changes in Phase R |
| R4 | Never touch persist core / creds / QR | ST | ST |
| R5 | (replaced) local branch + per-phase zip | ST | ST — doing this |
| R6 | Keep stack, 512 MB dyno | ST | ST |
| R7 | Mask keys to last 4 | ST | ST |
| R8 | New automations OFF + one-line desc | ST | ST |
| R9 | WA command channel = my number + PIN | ST | ST (applies when 5H built) |
| R10 | Ambiguous → safest + note | ST | ST |
| R11 | Sidebar 8 groups, ≤2 clicks, collapsible | R | ✅ 8 groups exact structure; DOM-asserted 8/8 + 25 items |
| R12 | (IA structure) | R | ✅ exact P1 structure; Calendar/Media/About placeholders render |
| R13 | Page-head on every view | R | ✅ .ph title+desc on all 25 views; topbar title follows |
| R14 | Overview: status+KPIs+activity+checklist | R | ✅ 6 KPIs + auto-hiding checklist + timeline + cloud banner (DOM-asserted) |
| R15 | Command palette everywhere | R | ✅ 640px palette, fuzzy, kb nav, 7 actions + 25 views; Ctrl+K/n///?/Esc (DOM-asserted) |
| R16 | Settings organized categories | R | ✅ collapsed categories: AI · Security · Chat features · Cloud · Branding · Reports · Session · Dashboard |
| R17 | Color tokens dark/light/auto | R | ✅ exact §4 tokens; cycle light→dark→auto persisted (DOM-asserted) |
| R18 | Spacing/radii/type/motion scale | R | ✅ audit passed: 4/8/12/16/24/32 · 8/12/16 · Inter 12–28 · 150/200ms + reduced-motion |
| R19 | Lucide inline SVG, zero emoji shell | R | ✅ 92 vendored inline, stroke 1.75; shell source scanned clean (arrows OK) |
| R20 | Component library (each once, reused) | R | ✅ card/btn/field/switch/badge/table/tabs/accordion/modal/toast/empty/skeleton/kpi/palette/log/picker — single CSS + JS definitions |
| R21 | skeleton/empty/error every async view | R | ✅ skelRows/emptyRow/emptyBox + .view-err with Retry on loader failure |
| R22 | Modals confirm destructive (name item) | R | ✅ confirmModal names item, danger styling, focus trap, Esc; posts edit via modal (DOM-asserted) |
| R23 | Tooltips plain language | R | ✅ title/-based plain tooltips on dense controls |
| R24 | SSE live updates + reconnect + fallback | R | ✅ EventSource /events, backoff 1.5s·2ⁿ≤8, 30s status poll fallback, quiet views, N1b resync on open |
| R25 | No Ask AI tab; robot on every view | R | ✅ no aichat nav; #robotFab fixed on every view (DOM-asserted) |
| R26 | Draggable robot, position persisted | R | ✅ drag fab + panel, rc-robot-pos/rc-panel-pos persisted |
| R27 | Chips + expand + history + Bot control | R | ✅ quick chips, expand/restore, history, #aiControlToggle ↔ /api/ai/control (DOM-asserted) |
| R28 | Hard limits intact, tool lines | R | ✅ aicontrol backend untouched; tool lines render as `tool: …` mono bubbles (emoji-free) |
| R29 | regexClean pre-step stays | R | ✅ backend — pipeline untouched |
| R30 | Template = zones + placeholders + style | R | ✅ backend — UI port |
| R31 | AI rewrite to template style, media untouched | R | ✅ backend — UI port |
| R32 | 20 built-ins + static samples (no AI) | R | ✅ backend — UI port |
| R33 | Fixed/Rotate/Shuffle + pool | R | ✅ backend — UI port |
| R34 | Zone builder + raw + version history | R | ✅ backend — UI port |
| R35 | Header/footer system + per-template override | R | ✅ backend — UI port |
| R36 | Signature→footer migration documented | R | ✅ done in 7.6.0 — note kept |
| N1a | Add/remove/pause anywhere → in-place update | R | ✅ optimistic row update + refetch; DOM-asserted table 1→2 rows + picker re-render, no reload |
| N1b | Background resync (reconnect, 10 min) + Last synced + Refresh now | R | ✅ #srcSyncTime/#tgtSyncTime + Refresh buttons; 10-min timer + SSE status→open resync |
| N1c | Follow/Unfollow buttons if Baileys exposes | R | ⏭ Baileys (this build) exposes no join/leave-newsletter API — manual add kept (verified: no such code path in src/wa.js, src/channels.js) |
| N1d | Pre-publish verify followed/postable, clear reasons | 5A | 🔧 publish already fails-with-reason today; queue reasons land with R43 |
| N2 | Channel picker component everywhere | R | ✅ one .cp component: names+subs+role, chips, sticky search, kb nav, JID toggle persisted, composer preselect; DOM-asserted |
| N3 | Visual QA 1440/390 per phase | ST | ST — checklist in each report |
| R37 | Approval queue + approve-first + delay buffer | 5A | ❌ (placeholder view in shell) |
| R38 | Per-source rule cards | 5A | ❌ |
| R39 | Visual routing matrix | 5A | 🔧 rules UI exists (per-target include/exclude) — matrix view new |
| R40 | Cross-source dedupe (merged credit) | 5A | ❌ |
| R41 | Long-post auto-split | 5A | ❌ |
| R42 | Polls → text conversion | 5A | ❌ |
| R43 | Live Queue view + retry-all | 5A | ❌ |
| R44 | Source edit propagation policy | 5A | ❌ |
| R45 | Scheduler upgrades (weekdays, interval, tz, calendar, per-job pause) | 5A | 🔧 once/daily/weekly + pause exist — upgrades new |
| R46 | Mirror latency KPI | 5A | ❌ |
| R47 | Never-lose-a-post (recovery pass visible) | 5A | 🔧 recovery exists silently — visibility new |
| R48 | Undo publish | 5A | ❌ |
| R49 | Composer power kit | 5B | 🔧 text+image+beautify+targets exist — toolbar/drafts/upload/captions new |
| R50 | AI writing buttons | 5B | ❌ |
| R51 | Snippet library | 5B | ❌ |
| R52 | Test-send to me | 5B | ❌ |
| R53 | Publish history upgrades | 5B | 🔧 edit/delete exist — retry/filters/copy/duplicate new |
| R54 | Per-feature AI + usage meter | 5C | ❌ |
| R55 | Prompt library (10 seeds) | 5C | ❌ |
| R56 | Smart text upgrades | 5C | ❌ |
| R57 | Translation glossary | 5C | ❌ |
| R58 | Voice-note transcription | 5C | ❌ (best-effort) |
| R59 | Auto-reply knowledge base | 5C | ❌ |
| R60 | Ask AI about post + morning recap | 5C | ❌ |
| R61 | Advanced analytics | 5D | 🔧 basics exist — heatmap/breakdowns new (inline SVG) |
| R62 | Goals + leaderboard | 5D | ❌ |
| R63 | Weekly report email+WA, export CSV/PDF | 5D | 🔧 daily WA report + CSV posts/logs exist — weekly + PDF new |
| R64 | Health view full + self-test | 5D | 🔧 uptime+cloud exist — full report new |
| R65 | Health score 0–100 on Dashboard | 5D | ❌ |
| R66 | Instant alerts | 5D | ❌ |
| R67 | Notification center | 5D | ❌ (bell in shell, data lands 5D) |
| R68 | FTS5 full-text search in palette | 5D | ❌ |
| R69 | Audit view in Logs | 5E | ❌ |
| R70 | Backup download + restore | 5E | ❌ (push-to-GitHub backup exists) |
| R71 | Access control (2nd password, login email, timeout) | 5E | ❌ |
| R72 | Storage manager | 5E | 🔧 boot-trim (pruneForMemory) shipped — manager view new |
| R73 | Panic stop | 5E | ❌ |
| R74 | Adaptive pacing | 5E | ❌ |
| R75 | Public /status page | 5E | ❌ |
| R76 | Chat upgrades (search✓, pins, labels, quick replies, scheduled, export, gallery) | 5F | 🔧 in-chat search exists — rest new |
| R77 | Contacts & Journal upgrades | 5F | 🔧 journal exists — notes/tags/timeline/CSV new |
| R78 | Broadcast lists | 5F | ❌ |
| R79 | Guardrails++ | 5F | 🔧 blocklist/rate exist — per-target rate + per-rule toggle new |
| R80 | Outgoing webhooks | 5G | ❌ |
| R81 | API explorer card | 5G | ❌ |
| R82 | RSS/Atom sources | 5G | ❌ |
| R83 | PWA + mobile polish | 5G | 🔧 bottom tabs in Phase R — manifest/SW new |
| R84 | Telegram optional | 5G | ❌ (skip if destabilizing — allowed) |
| R85 | WhatsApp command channel | 5H | ❌ (aicontrol toolset exists as engine) |
| R86 | Evergreen recycling | 5H | ❌ |
| R87 | Auto-Pilot mode | 5H | ❌ |
| R88 | AI weekly content plan | 5H | ❌ |
| I1 | Subscriber growth tracking | 5I | ❌ (best-effort) |
| I2 | Media library | 5I | ❌ (files already stored — view new; placeholder in shell) |
| I3 | Smart media pipeline | 5I | ❌ |
| I4 | Announcement card generator | 5I | ❌ |
| I5 | Post view counts | 5I | ❌ (best-effort) |
| I6 | Smart hashtags v2 | 5I | 🔧 auto-hashtags switch exists — learning new |
| I7 | Content freshness guard | 5I | ❌ |
| I8 | Link tools (utm strip, attribution) | 5I | 🔧 link stripping exists in clean step — configurable list + via-line new |
| I9 | History quick actions | 5I | ❌ |
| I10 | Resend with rate guard | 5I | ❌ |
| J1 | Pipeline Inspector (dry-run) | 5J | ❌ |
| J2 | Setup wizard | 5J | 🔧 checklist exists — guided flow new |
| J3 | Contextual help + tooltips everywhere | 5J | 🔧 ? overlay + per-page help new (tooltips in Phase R) |
| J4 | Branding studio | 5J | 🔧 botName exists — logo/accent/title new |
| J5 | Overview widgets reorder | 5J | ❌ |
| J6 | Content Calendar | 5J | ❌ (placeholder entry in shell) |
| J7 | AI safety screen | 5J | ❌ |
| J8 | Pacing visualizer | 5J | ❌ (needs R74) |
| J9 | About page | 5J | ❌ (placeholder entry in shell) |
| J10 | Urdu UI (optional) | 5J | ❌ (skip with reason if bloating — allowed) |
| R89–R92 | Method (ledger, no-approval phases, resume markers, POWER LEDGER) | ST | ST — executing now |

## Deploy workflow (unchanged)
Local branch `power-build` → one commit per phase → zip of complete project → user pushes to
main via GitHub Desktop → Heroku auto-deploys. Never push from sandbox.

## Resume markers
Marker format: `last done: <item> · next: <item> · tests: n/n · parity: m/n`.

- **2026-11-08 — PHASE R COMPLETE.** Old dashboard.ejs/app.js/app.css deleted, rewritten from
  blank (Precision Console design, zero legacy classes). 25 views, 8 sidebar groups, N1/N2
  live channel sync + one picker component, 13 switches in home views, full WhatsApp mirror
  port, robot, palette, modals/toasts/skeletons, settings categories. Tests: unit 25/25 +
  7/7, DOM 79/79 (`test/domtest-761.js`, replaces dead domtest-760). Parity: 25/25 views —
  18 ✓ DOM-asserted, 4 ◐ wired-to-tested-loader (aipilot/aireply/digest/bulk/email deep
  interactions), 3 ✓ placeholders. N3: DOM+API-contract verified in sandbox; pixel-level
  1440/390 user-verified post-deploy (checklist below). `last done: R88 (end of Phase R) ·
  next: 5A R37 · tests: 25/25+7/7+79/79 · parity: 25/25`.

### Phase R — N3 visual QA checklist (user, in browser, 1440px + 390px)
1. 1440px: sidebar 240px, 8 groups, active item accent; collapse → 64px rail (icons only); content 1280px centered.
2. 390px: sidebar gone, hamburger opens drawer + scrim; bottom tabs (Home/Compose/Queue/Inbox/More); picker opens as bottom sheet; robot full-width.
3. Sources/Targets: picker rows show NAME + subscriber count + role badge (no jid boxes); search filters; chips in button; "Last synced …" + Refresh.
4. Pick 2 channels → Add → table grows in place, no page reload; Remove → confirm modal names the channel; Esc cancels.
5. Composer: picker pre-ticks all active targets; untick one → publishes to the rest only.
6. Theme button cycles dark→light→auto, choice survives reload. Ctrl+K palette: fuzzy "tem" → Templates, Enter jumps, Esc closes. `n` opens Composer.
7. Robot: drag + reopen at same spot; history persists; Bot control toggle; tool lines show `tool:` mono bubbles.
8. WhatsApp tab: official look untouched (#0b141a/#111b21/#00a884), number band shows +92…, chat list loads.
9. Dark mode: no white flashes, focus rings visible on Tab; light mode: same layout.
