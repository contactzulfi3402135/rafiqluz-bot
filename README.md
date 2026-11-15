# Raqifluz — Broadcast Bot Dashboard

Admin panel for the Raqifluz content-broadcast bot: Sources → filter/rewrite → Queue → paced publish → Targets, with a WhatsApp command channel and a locked read-only mirror.

Built exactly per `Raqifluz-Dashboard-Build-Spec.md`. Node 18+, Express, EJS partials, vanilla ES modules. **Zero runtime external dependencies, no CDN, no frameworks, no icon fonts** — every icon is an inline SVG symbol from one sprite, and fonts are vendored locally.

## Run

```bash
npm install
npm start          # http://localhost:3000  (PORT env var to override)
```

First boot seeds `data/db.json` automatically (delete the file to re-seed). Default mode is **simulation** — Telegram, WhatsApp and AI adapters echo realistic responses without any external service. The Simulation-mode note appears only on About and WhatsApp, per spec.

## Structure

```
server.js              entry: express app, EJS renderer, i18n locals, panic/audit wiring
lib/
  store.js             data/db.json behind a small collection API (get/insert/update/remove) + audit/log
  seed.js              §5 seed data (12 sources · 48 targets · 21-item queue · 80 history · KPIs · health 98/100 …)
  options.js           the 33 advanced options, 6 groups, ownership map (single source of truth)
  i18n.js              en/ur dictionaries, t() with interpolation, timeAgo
  icons.js             inline SVG sprite (90 symbols, 24×24, 1.75 stroke)
services/
  index.js             re-exports the active adapters
  telegram.js          SIM adapter — post/accept simulation
  whatsappMirror.js    SIM adapter — command channel + read-only mirror feed
  ai.js                SIM adapter — rewrite/score simulation
routes/
  pages.js             21 page routes (server-rendered EJS)
  api.js               §11 REST API (settings, queue, CRUD, panic, health, backup/export, audit)
locales/               en.json · ur.json (~924 keys each)
views/
  layout.ejs           shell: sidebar, topbar, mobile bar, modal/toast/palette mounts
  partials/            icons sprite, sidebar, topbar, mobile, shared templates
  pages/               21 page views
public/
  css/  tokens · base · components · pages   (4 files, CSS variables)
  js/   app.js + charts · queue · settings · palette · dnd · i18n-client   (7 modules, vanilla)
  fonts/ Inter (latin + ext) and Noto Naskh Arabic — vendored woff2
data/db.json           created on first boot; the only state file
```

## Swapping simulation adapters for real services

The dashboard only ever talks to `services/index.js`. To go live:

1. **Telegram** — implement `simTelegram`'s interface (`fetchUpdates()`, `publish(post, targets)` etc.) against the real Bot API and re-export it as `telegram` from `services/index.js`.
2. **WhatsApp** — replace `simWhatsApp` with your WhatsApp Business Cloud adapter; keep the `mirror` feed read-only (the UI is intentionally locked to it).
3. **AI** — swap `simAI` for a real model client (`rewrite`, `score`, `suggest`).
4. Flip `mode` from `simulation` to `live` in `data/db.json` (or seed) — the UI's Simulation note is driven by it.

Nothing in `views/`, `public/js` or `routes/` references an adapter directly, so no UI changes are needed.

## Notes

- Language: cookie `rq_lang=en|ur`; Urdu renders RTL (logical CSS properties throughout).
- Theme: `data-theme="dark|light"` on `<html>`, persisted in settings; 5 accent swatches.
- All state changes are audited (`/logs` → Audit tab) and logged (`/logs` → Activity tab).
- `POST /api/panic` = one-tap Panic Stop, no confirmation; `Resume` reverses it.
- See `NOTES.md` for every decision made where the spec was silent.
