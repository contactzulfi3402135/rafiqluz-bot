# Raqifluz v12.0.0 — “Obsidian” · Release notes & upgrade guide

**Type:** Visual + platform polish release. **Risk level:** low. **Schema changes:** none. **Behavior changes to the mirroring pipeline:** none.

## Upgrading from 11.x (read this first)

1. **Pause** mirroring and scheduled sends; wait for active sends to finish.
2. Download a dashboard database backup (Settings → Data & recovery). Store it securely — it contains credentials.
3. Record Heroku Config Vars, version and last good cloud snapshot. Do **not** commit `.env`, databases, sessions, media or tokens.
4. Deploy the new code to the **same** app with the **same** Config Vars. Do not reset the database or the `bot-state` branch.
5. Hard-refresh the console once (`Ctrl/⌘ Shift R`). The service worker bumps to `raqifluz-obsidian-v4` and caches `/premium.css`, `/premium.js` and the new artwork; the query strings on `app.css`/`app.js` also change.
6. Sign in → verify: Home shows **Mission Control**, the top bar shows a **clock** and a **system pill**, About shows **Release readiness** at 100 (or explains why not). Check Settings → AI provider: the v11.5 AI-sharing opt-in posture is unchanged.
7. Resume mirroring. Watch Queue → Live for one cycle before walking away.

## New in this release

### Sign-in & linking (`/login`, `/connect`)
Split-screen Obsidian design: living aurora artwork (`/brand/aurora.jpg`, self-hosted), brand lockup, proof-point feature rows, build tag `v12.0 · Obsidian`. Form gains show/hide password, loading spinner, `novalidate` + labels, security chips (rate-limited · session-signed · read-only role ready · audit-logged). Connect page keeps QR + pairing-code flows byte-compatible (same element IDs, same endpoints, same polling) with the new design and full keyboard access on the tabs.

### Dashboard shell
- **Mission Control strip** (Home): large local clock, full date, quick actions (`data-goview` deep links — the app’s own navigation, not a parallel one), and a **release-readiness ring** fed by `/api/overview` (WhatsApp open · mirror not paused · panic clear · cloud snapshot on).
- **Top bar**: frosted blur + gradient hairline; new **clock chip**; new **system-status pill** (polls `/api/overview` every 20 s; ok/warn/err states with ping-ring dot); **PWA install pill** appears only when the browser fires `beforeinstallprompt`.
- **Sidebar**: gradient brand mark with hover tilt, glass background, breathing health dot, sliding accent rail on the active item, icon nudge, and a **version whisper** (`RAQIFLUZ v12.0.0 · OBSIDIAN`) above the owner row.
- **Buttons**: primary buttons are now gradient with a light-sweep on hover, springy press states; danger buttons glow on hover.
- **Motion**: view-enter `riseIn` on cards/KPIs, toast spring entrance, bell badge pop, modal/palette `overlayIn`, panic banner animated hazard stripes, `dotBreath` on live indicators — all disabled under `prefers-reduced-motion`.
- **KPI tiles**: uppercase 10.5 px labels, tabular numerals, gradient values for accent/ok/err tones, one-time **count-up** on first paint.
- **Confetti**: 2 side cannons on genuinely successful toasts (sent/published/queued/saved/restored/approved/scheduled/completed), max one burst per 1.5 s, skipped for reduced-motion users, DPR-aware canvas, self-cleaning.

### Keyboard
`?` opens the **shortcut atlas** (also closes with `?`/`Esc`); `G` then a letter chord navigates (`H` home, `N` new post, `Q` queue, `P` history, `C` channels, `R` routing, `A` analytics, `I` inbox, `L` logs, `S` settings). Chords are ignored inside text fields and when modifier keys are held.

### About screen
New **Release readiness** card, computed live: six checks (WhatsApp session · mirror switch · panic latch · cloud snapshots · secure context · build fingerprint from the new `/api/meta`), a 0–100 score, verdict copy, per-check detail chips, and a fingerprint grid (version/codename, node, pid/RSS, uptime, environment, license). An Obsidian changelog entry is prepended client-side; the seeded CHANGELOG in `app.js` is untouched.

### Platform & security
- New read-only route: **`GET /api/meta`** (auth-required, no secrets) — powers the above.
- New headers on every response: `Permissions-Policy` (camera/mic/geo/payment/usb/accelerometer = none), `Cross-Origin-Opener-Policy: same-origin`, `Origin-Agent-Cluster: ?1`.
- Service worker `raqifluz-obsidian-v4`; manifest renamed to “Raqifluz Channel Bot — Signal Desk”, theme color aligned to `#0B0F14`.
- CSP is intentionally **not** shipped yet: the app relies on inline scripts/styles by design; a nonce-based CSP is tracked in SECURITY.md as future work.

### Repository
`docs/` (historical notes: BUILD-PLAN, FINAL-REPORT, DESIGN-SYSTEMS, PARITY, RESKIN_NOTES, UPGRADE_NOTES, RELEASE-11.4/11.5), `tools/` (dev scratch + CSS build kit), root is now: app source + Dockerfile + compose.yaml + Procfile + README/HEROKU guide + new `README.md`, `LICENSE`, `SECURITY.md`, `CONTRIBUTING.md`, `.github/workflows/ci.yml` (Node 24: `npm ci` + `npm test`).

## Files touched
`src/config.js` (version), `src/web/server.js` (headers + `/api/meta`), `src/web/views/dashboard.ejs` (CSS/JS links, theme-color, cache-bust), `src/web/views/login.ejs` (rewrite), `src/web/views/connect.ejs` (rewrite), `src/web/assets/premium.css` (new), `src/web/assets/premium.js` (new), `src/web/assets/brand/aurora.jpg` (new artwork), `src/web/assets/sw.js`, `src/web/assets/manifest.webmanifest`, `package.json` (+`dev`, `test:all`), plus docs/CI. `app.js` / `app.css` / pipeline / db: **untouched**.

## Verification
- `npm test` — all 6 legacy suites pass (26 delivery + 4 media + 3 migration + 8 web-delivery + backup/archive suites).
- `npm run test:all` — additionally runs the security + operations integration harnesses.
- Boot smoke test: `/healthz` 200, `/login` renders, `/api/meta` returns the fingerprint.

## Rollback
Replace the repo files with your previous 11.5 checkout and redeploy. No data was migrated; nothing to undo.
