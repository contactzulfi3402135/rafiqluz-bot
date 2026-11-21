# Security policy

## Supported versions

| Version | Supported |
| --- | --- |
| 12.0.x (Obsidian) | ✅ current |
| 11.x | ⚠️ fixes only until the next minor |
| < 11 | ❌ end of life |

## Reporting a vulnerability

Please report privately — do **not** open a public issue for security reports.
Email the maintainer of the repository this code was deployed from, or use GitHub’s private vulnerability reporting (Security → Advisories → “Report a vulnerability”). Include: affected version, reproduction steps, impact, and any suggested fix. You should receive an acknowledgement within 7 days and a triage decision within 14.

## Security posture (what the app does today)

- **Auth**: session cookie (httpOnly, sameSite=lax, rolling), bcrypt-verified dashboard password, optional read-only second role, idle timeout (rolling, configurable 5–1440 min), login rate limiting (12 attempts / 15 min / IP), login alerts.
- **Headers** (v12): `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `X-Frame-Options: SAMEORIGIN` (except sanctioned embed hosts), `Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=(), accelerometer=()`, `Cross-Origin-Opener-Policy: same-origin`, `Origin-Agent-Cluster: ?1`, `x-powered-by` disabled.
- **Mutation guard**: cross-site `Sec-Fetch-Site` and origin-host mismatch are rejected with 403 before any handler runs.
- **CSRF**: cookie is `sameSite=lax` + JSON content-types + the origin check above. There is no separate CSRF token; same-site lax + origin enforcement is the current model.
- **Secrets**: `DASHBOARD_PASSWORD`, `SESSION_SECRET` and the GitHub persistence token are read from env only; nothing is written to the repo or logs. Rotate `SESSION_SECRET` to invalidate all sessions.
- **Cloud snapshots** (optional, off by default): content + linked-device credentials are pushed to the private GitHub repo you configure (`PERSIST_GITHUB_REPO`). Held media is excluded unless you set `PERSIST_HOLD_MEDIA=1`. That repo must stay private; rotate its token if exposure is suspected.
- **Logs**: auth events, admin actions and automation decisions are recorded in the audit log (Settings → audit view, CSV export).
- **Data**: SQLite under `data/` — treat the `data/` directory and any dashboard backup exports as credentials (they contain session tokens). Never share them; delete test artifacts.
- **Public surface**: only `/healthz`, `/login`, `/connect`, `/api/public/*` (only when `PUBLIC_PAIRING=1`) and `/status` (rate-limited, no secrets) are reachable without a session. The whole `/api/*` router requires auth.

## Known gaps & roadmap

- **No CSP yet.** The UI relies on inline `<script>`/`<style>` by design. A nonce- or hash-based CSP (dropping `unsafe-inline`) is the next hardening milestone; until then, XSS defense rests on output encoding (`esc()` in the SPA, EJS escaped output in templates) and the origin guard.
- **No dependency pinning beyond package-lock.** Keep `npm ci` in CI (it is the lockfile guarantee) and run `npm audit` on each release.
- **Unofficial WhatsApp library.** Baileys is not the Meta Cloud API. Session material can expire or be revoked by WhatsApp at any time. There is no security boundary between the process and the linked account — protect the host like you protect the account.
- **Offboarding**: unlink the device from WhatsApp → Linked devices, rotate Config Vars, then delete `data/`, `sessions/`, `media/`, `backups/` and the GitHub state branch.

## Hardening checklist for operators

- [ ] Strong, unique `DASHBOARD_PASSWORD` and a 48+ char random `SESSION_SECRET`
- [ ] `PUBLIC_PAIRING` left at `0` unless you are linking a phone right now
- [ ] GitHub snapshot repo is **private**; token is fine-grained and scoped to it
- [ ] Heroku Config Vars used instead of committed `.env`
- [ ] Read-only role for observers (`Settings → Security`)
- [ ] Audit log reviewed weekly; exports stored securely
