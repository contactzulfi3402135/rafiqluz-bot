# Contributing

Thanks for helping make Raqifluz better. This is a single-dyno, single-workspace app — keep changes conservative, measurable and reversible.

## Development setup

```bash
node --version          # 24.x required
npm ci                  # reproducible install from package-lock.json
cp .env.example .env    # local only — never commit .env
npm run dev             # boots on http://localhost:20249
npm test                # legacy suites (must stay green)
npm run test:all        # + security & operations integration harnesses
```

## Ground rules

1. **Never commit** `.env`, `data/`, `sessions/`, `media/`, `backups/`, `logs/`, `*.sqlite*` or any tokens. `.gitignore` blocks these — don’t weaken it.
2. **Pipeline is sacred.** `src/pipeline.js`, the queue, the publish path and the panic stop behavior change only with tests and a release note.
3. **Additive over destructive.** Schema changes must migrate old data forward (see `tests/migration-test.js` for the pattern). No dropping columns, no deleting settings.
4. **The UI is vanilla.** No frameworks, no bundlers, no CDN assets. New screens use the existing view system (`.view[data-view]`), the existing icon set (`src/web/icons.js`) and the tokens in `app.css` / `premium.css`.
5. **IDs and classes are contracts.** `app.js` binds by id/class/`data-*`. Renaming a hook breaks silently — if you must rename, update both sides and say so in the PR.
6. **Accessibility is a feature.** Keep labels, aria attributes, focus-visible rings and `prefers-reduced-motion` support intact.
7. **Security first.** New routes ride the `auth` middleware unless they are deliberately public (and rate-limited). Validate and clamp every input. No secrets in logs or client bundles.

## Pull request checklist

- [ ] `npm test` green locally
- [ ] No new runtime dependencies without justification in the PR description
- [ ] New UI respects light/dark/glass themes and `prefers-reduced-motion`
- [ ] Docs updated (`README.md`, `docs/RELEASE-*.md`) when behavior changes
- [ ] Screenshot or short clip for visual changes

## Commit style

`area: imperative summary` — e.g. `web: add release-readiness card to About`. Keep the first line ≤ 72 chars; explain the *why* in the body.
