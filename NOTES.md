# NOTES.md — decisions where the spec was silent

One line per decision, per the spec's instruction ("make the best decision and log it here").

1. **Express 4.22 + npm `ejs`** — spec says Node 18+/Express/EJS but not versions; used express ^4 (stable) and the `ejs` package (there is no `node:ejs` builtin).
2. **`res.renderPage(name, data)` bound per request** — Express 4 does not surface `app.locals` on `res`, so a tiny middleware binds it; avoids 21 call-site changes in `routes/pages.js`.
3. **Store shape: collections live at db.json top level** (`db.queue`, `db.sources`…) while `lib/store.js` exposes get/insert/update/remove; `routes/api.js` CRUD was rewired to call `store.*` directly (it initially called the methods on the raw db object, which don't exist there).
4. **Seed ids assigned in one pass** — seed arrays originally used `id: 0` placeholders; a loop assigns 1..n to sources/targets/queue/library/contacts/auto-replies/routes/rules before the db object is built, so store `insert()` (max-id+1) never collides.
5. **Queue seed = 21 items (3P/1D/12A/5W)** — spec §5 requires those exact counts; the first draft only had 16 posts, so the filler list was extended to 17 (12 approved + 5 waiting) + 3 manual pending + 1 delayed.
6. **Queue type filter maps to the `media` field** — queue items have `media` (`text|city|laptop|plant|chart|chat`), not a `type` field; the API's `type=text|media` filter compares `media === 'text'`.
7. **`handle` vs `link` normalization** — seed and views use `handle`; client add/edit forms send `link`. The `/api/sources` and `/api/targets` validators accept either (`str(b.handle) || str(b.link)`) and always store `handle`. No data migration needed.
8. **Targets paginate client-side, 20/page** — matches spec §7.1 exactly (all 48 rows are server-rendered; `app.js` hides off-page rows and updates the "1–20 / 48" info + prev/next).
9. **5 accent swatches** — spec §2.1 fixes emerald as the default accent but lists no others; added violet, blue, amber, rose with full token overrides (explicit rgba per accent — `color-mix()` avoided for compatibility), persisted in settings and applied instantly.
10. **Settings save bar is sticky on mobile only** — desktop shows the in-form Save Changes button; mobile gets a sticky bottom bar that appears when the form is dirty (spec requires dirty-state gating but not where the button lives on mobile).
11. **33 options single-sourced in `lib/options.js`** — the 6 groups (pipeline/safety/timing/notify/intelligence/system) and the owner→sub-settings map live in one module; `views/pages/settings.ejs` renders from it, `__SWITCHES` is injected for the client, and locales carry every label (EN + UR).
12. **Sub-settings disabled at 40% opacity + "Turn on {X} to edit" hint** — spec says "disabled"; the exact affordance (40% + hint line) was chosen to match the component system.
13. **Icons: 90 symbols in one sprite** (`lib/icons.js` → `views/partials/icons.ejs`) — spec fixes the sprite approach and 24×24/1.75/round geometry but not the set; final set was cross-checked so every `href="#i-*"` in views/ and public/js resolves.
14. **Per-card self-test log** — the Home health card runs its own self-test; it gets its own hidden `.test-log` div (the Health page's log is `#ht-log`). The shared handler now scopes the log to its card via `host.querySelector`.
15. **Urdu served via `rq_lang` cookie, dir/labels set per request** — spec says full UR + RTL; cookie was the unspecified transport. `timeAgo` is locale-aware; numbers/charts stay LTR per spec.
16. **RTL via logical properties only** — `margin-inline`, `inset-inline-start`, `text-align: start`, plus a handful of `[dir="rtl"]` arrow flips; no mirrored copies of layout rules.
17. **Panic Stop writes 3 records**: Activity (`Panic Stop engaged by owner`), Audit (`panic:engaged`), and a WA mirror line; Resume mirrors all three. One tap, no confirm, per spec.
18. **`npm start` binds 0.0.0.0:3000** — spec says PORT 3000; 0.0.0.0 so the app is reachable outside the sandbox (harmless locally).
19. **`data/db.json` auto-created on boot** — spec defines the file but not seeding-on-missing; `server.js` seeds it if absent and deletes nothing. Debounced 300 ms writes with atomic rename.
20. **Toast/menu/modal/drawer mounts are global in `layout.ejs`** — pages never include their own; `app.js` owns their lifecycle (Esc closes all, ARIA roles set in one place).
21. **WhatsApp mirror rendered LTR regardless of theme/language** — the `.mirror-feed` block is pinned `direction: ltr` because the spec locks it as a core module (byte-stable, never themed).
22. **Sim adapters echo, not stream** — `services/*` are stateless functions with canned, realistic payloads; the SSE activity endpoint re-emits seeded `recentActivity` so the live feed works in simulation.
23. **44 px touch targets on mobile** — spec fixes the size; implemented as a single `@media (max-width:767.98px)` override pass in `base.css`/`components.css` rather than per-component media queries.
24. **prefers-reduced-motion** — all 160 ms transitions/animations collapse to opacity-only/none in one media query (spec §2.3 motion token).
25. **Git** — fresh repo for this build (previous UI was discarded per instruction); local commits only, per the standing workflow. No push.
