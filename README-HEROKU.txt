RAQIFLUZ CHANNEL BOT — HEROKU DEPLOYMENT AND RECOVERY (11.5)

Heroku is supported and remains the primary deployment path. This application is
currently a SINGLE workspace on ONE web dyno. WhatsApp channel automation uses
an unofficial linked-device library, not the official Meta WhatsApp Cloud API.
Capabilities, access and reliability can change; use a test account first.

BEFORE UPGRADING AN EXISTING INSTALL
1. Pause mirroring and scheduled sends; wait for active sends to finish. Save a
   dashboard database backup and keep a separate copy of the GitHub state branch
   if configured. The dashboard DB export contains credentials and does NOT
   contain linked-device session files or held media. Store all backups securely.
2. Record your Heroku Config Vars, version and last successful cloud snapshot.
   Do not commit .env, database files, sessions, backup archives or tokens.
3. Deploy this code to the SAME app and keep the existing Config Vars. Do not
   reset the database or GitHub state branch. Schema changes are additive.
4. Check Settings → Data & recovery and Approval queue → Live → Delivery review.
   Old approve-first and AI-week-plan drafts remain manual approvals. Previously
   recorded target copies without a new delivery journal cannot safely be retried
   automatically; check target channels before deliberately republishing.
5. AI provider content sharing is OFF after upgrade until an owner explicitly
   enables it in Settings → AI provider and saves. Existing keys/settings remain.
   Review your AI-safety fallback and automation switches before resuming.

NEW HEROKU INSTALL
1. Install the Heroku CLI, log in, create an app and deploy the project (GitHub
   integration or `git push heroku main`). This ZIP omits node_modules: Heroku's
   Node buildpack installs dependencies using package-lock.json and Node 24. If
   starting from an extracted ZIP, initialise a Git repository and commit the
   code first, then add the Heroku Git remote; never commit runtime data.
2. Set Config Vars in the Heroku dashboard: DASHBOARD_USERNAME,
   DASHBOARD_PASSWORD (strong and unique), SESSION_SECRET (long and random).
   Heroku supplies PORT automatically. PUBLIC_PAIRING stays off by default.
3. Optional GitHub cloud snapshots: set PERSIST_GITHUB_REPO to owner/private-repo,
   PERSIST_GITHUB_TOKEN to a fine-grained Contents read/write token for that repo,
   and PERSIST_GITHUB_BRANCH to a dedicated state branch. This explicitly sends database contents and linked-device credentials to that
   private repository. Queued media and saved inbox media are excluded unless
   you explicitly set PERSIST_HOLD_MEDIA=1 and PERSIST_INBOX_MEDIA=1. Media
   can contain private messages and increase snapshot size. Protect access;
   rotate exposed credentials. If not configured,
   no GitHub snapshot is created.
4. Run ONE web dyno (`heroku ps:scale web=1`), open the app, sign in, and connect
   WhatsApp from the authenticated dashboard. Add sources/targets and test with
   a controlled target before enabling automation.

IMPORTANT HEROKU LIMITS
• Heroku files are ephemeral and isolated per dyno. SQLite, session files and
  held media can disappear at any restart or deploy. GitHub saves are periodic
  and best-effort snapshots, NOT a transactional durable store; recent changes
  and send receipts can be lost, saves/restores can fail, and shutdown flushes
  are not guaranteed. Monitor snapshot status and keep separate backups.
• Do not scale to multiple dynos: SQLite, timers, sessions, sockets and delivery
  journal are not shared. This is not multi-tenant SaaS or high availability.
• The journal reduces repeat sends when its state survives. Timeouts, crashes,
  stale snapshots, external changes and retries can still cause duplicates or
  missing messages. Accepted by a provider does not mean delivered. Check the
  target before resolving an uncertain outcome or allowing a retry.
• If cloud recovery cannot be verified on startup, cloud writes are blocked.
  If the local database or linked session is missing, startup stops to protect
  the remote copy. Check logs and the recovery guide before restarting.
• GitHub storage and archive limits apply. Large media, unavailable APIs, token
  expiry or failed snapshots can prevent recovery. A dashboard DB backup only
  has media references, not the media or linked-device session files.
• Dyno sleeping, uptime and self-ping are subject to Heroku policy; self-ping
  does not guarantee availability. Test restores and reconnects regularly.

EMAIL AND RECOVERY
Email uses a local single-instance queue; interrupted sends require review rather
than automatic replay. Complete backups are sensitive and are not encrypted by the dashboard.
SMTP passwords are plaintext by default; optional protection and migration are
explained in EMAIL-CREDENTIAL-PROTECTION.md. Read EMAIL-OPERATIONS.md first.
For optional offline encryption of a downloaded backup, see ENCRYPTED-BACKUPS.md.
See CHANNEL-OPERATIONS.md for channel edit and deletion safety limitations.

LOCAL TEST
Use Node 24: `npm ci` then `npm test`. See RELEASE-11.5.md for changes and test
scope. Do not run mutation/integration tests against a production app.

SINGLE INSTANCE: current versions have a cooperative local filesystem guard.
It cannot coordinate separate Heroku dynos or older instances. Run one instance
and follow PERSISTENT-DEPLOYMENT.md; do not delete active lock files.
