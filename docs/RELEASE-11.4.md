# Raqifluz 11.4 — foundation upgrade

This release is an incremental, working improvement to the existing single-workspace bot—not a claim of enterprise certification, a finished SaaS platform, or any particular business valuation. It preserves the three selectable dashboard designs and existing feature paths. It includes no real credentials or production data.

## Changes

- **Operations brief:** Home now surfaces live connection, channel, approval-queue and cloud-memory status with shortcuts to the relevant screens. The home status badge reflects the actual connection/pause state instead of claiming the bot is always live. The cloud warning avoids promising that a QR will never be needed again.
- **Safer authorization:** read-only bearer tokens retain the read-only role, cannot mutate via the API or retrieve backup files or pairing QR codes, and do not receive the owner API key in settings. An active read-only browser session cannot be elevated by supplying an owner bearer token. Browser login no longer stores bearer tokens in local storage. Logins regenerate the session ID; issued bearer credentials have idle and absolute limits and are revoked with their session on sign-out. The Settings sign-out button now submits the correct POST request.
- **Pairing and privacy:** public pairing and number listings now require owner login by default. To deliberately permit unauthenticated pairing, set `PUBLIC_PAIRING=1`; it exposes pairing capabilities to anyone who can reach the service, so use only on a controlled network. Avatar files require a signed-in session. Cross-origin browser mutations are rejected and security headers are applied; framing is restricted to the same origin except for Arena preview hosts. HTTPS remains essential.
- **Backup safety:** local ZIP imports reject malformed, corrupt, unsafe or oversized archives. Restoration from an older database leaves tables absent from that backup untouched, and copies compatible columns rather than assuming identical schemas. New cloud snapshot extraction rejects links, path escapes and excessive sizes and checks CRC before installing restored files. Always keep a separate, tested backup before any upgrade or restore.
- **Dependencies:** upgraded the email and archive libraries, replaced the vulnerable cloud ZIP extraction dependency, and locked transitive fixes. `npm audit --omit=dev` reported zero advisories when checked; advisory data changes over time. An override for the archive library's glob dependency is included and cloud snapshot generation was tested.
- **Deployment:** original Heroku path remains. Dockerfile and Compose configuration provide a second, local-first deployment path with persistent volumes. Docker/Compose itself was not available in the verification environment; validate it in staging before relying on it.

## Start or upgrade

1. Back up the live database, WhatsApp session files, and current configuration separately. Existing backups and sessions contain private data and credentials; store them securely.
2. Deploy the code on Node 24 and run `npm ci`. Keep the existing `DATABASE_PATH`, `SESSION_DIR`, dashboard credentials and cloud-memory configuration. Existing data is not included in the source ZIP and must be carried forward separately.
3. Set a long, unique random `SESSION_SECRET`. A missing or example secret now produces a temporary random secret, so browser sessions expire on restart. When behind a trusted single reverse proxy, set `TRUST_PROXY=1`; Heroku is detected automatically. Terminate TLS at a trusted proxy and do not expose the origin directly.
4. Public pairing is now off. Sign in as owner before opening `/connect`. Enable `PUBLIC_PAIRING=1` only if you understand and accept the exposure.
5. Test login, dashboard, connection, sources, targets, scheduled jobs, a non-production send, cloud sync and recovery in a staging environment before promoting.

### Optional Docker / Compose

Copy `.env.docker.example` to `.env`, replace the example password and secret with unique strong values, and run `docker compose up -d --build`. The port is bound to localhost by default. Place it behind a properly configured HTTPS reverse proxy for remote access; set `TRUST_PROXY=1` only for a trusted single proxy. Named volumes persist data, sessions, media, backups and logs; back them up separately. Never commit `.env`.

### Heroku and storage

Heroku dyno disks are ephemeral and isolated. The existing optional GitHub snapshot mechanism helps recovery but is not a transactional shared database, does not guarantee zero data loss, and is not suitable for scaling this bot to multiple web dynos. Use a single running instance and independently test recovery; Heroku's filesystem behavior is documented at https://devcenter.heroku.com/articles/how-heroku-works . The local downloaded backup contains sensitive database credentials; it does not contain WhatsApp session files. The optional cloud snapshot contains session material and must be treated as a secret.

## Verification

- Clean `npm ci` and automated backup/archive tests with Node 24; 10 checks.
- Security integration tests against an isolated Node 24 server; 24 checks. Run only on a disposable instance: `TEST_ALLOW_MUTATIONS=1 TEST_URL=http://127.0.0.1:20251 TEST_PASSWORD=... node tests/security-integration.js`.
- Existing mock cloud persistence save-ladder test (`node _persist_ladder_test.js`): 23 checks; channel sync/follow/unfollow regression (`node _sync_test.js`): 19 checks. They use mocks, not live production accounts.
- Browser layout audit: 25 views × five widths × three designs × two modes = 750 checks for view visibility and document/view horizontal overflow; system preference change and browser login, action shortcut, and sign-out also tested. This does not prove every populated dataset, device, assistive technology, or workflow is defect-free.
- Stream-transport email smoke test only; no real SMTP service or WhatsApp account was used. Docker, live provider integrations, actual multi-tenant operation and production-scale load were not tested.

## Important limitations and next work

- This remains a **single-workspace, single-process** application, with a local SQLite database and in-memory browser sessions. It does not implement isolated customer tenants, granular per-user roles, MFA, SSO, distributed scheduling, billing, or enterprise-grade high availability. The existing read-only role can still see substantial workspace data and is not a tenant-isolation boundary.
- WhatsApp channel functionality uses an unofficial library and may break or violate platform terms; use only with an account you are authorized to operate. The official Meta Cloud API is **not implemented** here and should not be represented as feature-equivalent to unofficial channel operations. Meta documents Cloud API messages and status events separately: https://developers.facebook.com/docs/whatsapp/cloud-api/overview and https://developers.facebook.com/docs/whatsapp/cloud-api/reference/messages/ . An accepted send is not proof of delivery; a future official integration must use delivery webhooks, consent and template-policy checks.
- No new paid provider or external AI integration was enabled. Existing configured integrations and automation settings remain in place; review them after upgrade. This release does not centrally enforce consent or approval for every legacy sending path. Use automation only with permission, appropriate opt-ins, limits and human oversight.
- Local SQLite backup restore is transactional, but migrations between substantially different schemas can fail and roll back. Archives that contain links, exceed limits, or contain unsupported structures are rejected. Rehearse restores on a copy.
- Security improvements are targeted fixes, not a complete security audit or OWASP ASVS certification. Before public, multi-user or high-stakes use: independent penetration testing, full endpoint-by-endpoint authorization review, modern session storage and revocation, rate limiting across instances, SSRF protection for outbound integrations, secret management, retention controls, and monitoring are needed. OWASP ASVS: https://owasp.org/www-project-application-security-verification-standard/ .
- Suggested next phase: map every send path and add explicit consent/approval gates, establish an idempotent delivery ledger, build contract tests around provider adapters, then implement official providers and tenant-aware storage with real isolation tests. Do not connect unreviewed third-party accounts or use real customers as test fixtures.
