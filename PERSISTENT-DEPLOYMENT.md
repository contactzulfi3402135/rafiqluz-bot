# Persistent deployment and recovery

## What this protects—and what it does not

Raqifluz is a **single-instance application**. For a host that provides persistent disk, `RAQ_STATE_DIR` puts the SQLite database, linked-device sessions, saved inbox media, held queue media, backups and logs under that directory. It keeps files when the process or application container is replaced **provided the same durable volume is mounted again**. It does not protect against disk failure, accidental deletion, a stolen volume, a revoked WhatsApp session or every crash. Keep independent, encrypted backups and regularly test offline recovery. Never run two instances against the same SQLite database or linked-device session.

## Cooperative local instance guard

Current versions acquire a SQLite filesystem lock in each configured database parent, session root and inbox-media root **before** cloud restore, database migration, worker startup or WhatsApp connection. A second current-version process with one of those exact resolved roots on the same properly locking local filesystem fails startup. The offline SMTP credential migration also takes the guard. A stopped or killed process releases OS locks; an empty lock file remaining on disk does not itself indicate the app is running. The reserved `.raqifluz-instance-lock.sqlite` and its SQLite sidecars at the session and media roots are excluded from snapshots; do not use these names for application data, and never delete, replace or rename the lock files or their parent directories while a process is running.

**This is not a distributed lock, tenant isolation or a guarantee of single-instance operation.** Older versions and third-party tools do not cooperate. It does not detect shared paths that merely overlap without being the same resolved root, copies of a linked session, separate disks or Heroku dynos with separate ephemeral filesystems; it is not tested or supported on network filesystems or platforms that do not implement SQLite locking correctly. The operator must prevent simultaneous instances, stop old versions and all workers before migration/recovery, and arrange external orchestration/fencing if running across hosts. A lock cannot stop an already-started provider request.

If startup says another process owns the state, identify and gracefully stop it, then retry. Do not resolve a conflict by deleting lock files: that can let two writers run. The process requires permission to create/open the guard files; correct access to the state roots rather than disabling the guard. Retain verified backups and validate recovery.

Heroku dynos do not provide durable local volumes. The Compose volume described below is not available on Heroku. Heroku users should follow `README-HEROKU.txt` and use cloud snapshots and independent backups, understanding that the snapshots are periodic and do not guarantee zero data loss. They are not a shared database or a multi-dyno architecture.

## Persistent paths

Without `RAQ_STATE_DIR`, existing relative paths are unchanged. With `RAQ_STATE_DIR=/var/lib/raqifluz`, defaults are:

- `/var/lib/raqifluz/data/bot.sqlite` and its SQLite WAL/SHM files; held media lives in `/var/lib/raqifluz/data/media-hold/`.
- `/var/lib/raqifluz/sessions/`, `/var/lib/raqifluz/media/`, `/var/lib/raqifluz/backups/` and `/var/lib/raqifluz/logs/`.

`DATABASE_PATH`, `SESSION_DIR`, `MEDIA_DIR`, `BACKUP_DIR` and `LOG_DIR`, when set, override the corresponding defaults. Absolute values are absolute; relative values are relative to the application directory. Ensure every override is also on persistent storage. Mounts must be writable by the process. Setting a new path does **not** migrate existing state.

## Docker Compose on a persistent-volume host

1. Install Docker and the Compose plugin. Copy `.env.docker.example` to `.env.docker` and replace the dashboard password and session secret with long, unique values. Keep this file private and out of version control. If you are using a previous installation, migrate its state as described below **before** starting this service.
2. From the project directory run `docker compose up -d --build`. The provided configuration mounts a named volume at `/var/lib/raqifluz` and publishes the dashboard only on `127.0.0.1:20249` of the host. Open it locally or use a correctly configured authenticated HTTPS reverse proxy; don't expose an unencrypted dashboard directly to the internet. Configure proxy trust appropriately.
3. Check `docker compose logs -f raqifluz`, log in, and link WhatsApp if this is a first installation. Confirm cloud-backup status if configured. Create an independent complete backup in Settings and test it on a disconnected copy.
4. For an upgrade use `docker compose up -d --build` again. Keep the **same Compose project name and named volume**. Do not run `docker compose down -v` or delete the volume: either permanently removes its data. `docker compose down` without `-v` normally retains named volumes. Verify the volume name with `docker compose config` and `docker volume ls`.

A synthetic Docker/Compose check built this image with Docker 26 and recreated the service with a named volume; synthetic settings and session bytes persisted. The test used a network-isolated override with WhatsApp mocked and no published ports; image building required host networking in the restricted test environment. The default network/port publishing, live providers, upgrades, backup/restore and production deployment have not been verified. Validate the unmodified configuration on a non-production host and run an independent restore drill before relying on it. The `.dockerignore` limits build context to the source and scripts used by the image, but inspect those directories for secrets before every build; ignore patterns are not a comprehensive secret scanner.

## Moving an existing installation

1. Stop the old bot and all workers. Back up the existing database **including WAL and SHM files**, sessions, `media/`, the `data/media-hold/` directory and configuration. Store a second copy elsewhere; do not delete or alter the original while testing.
2. With the new application stopped, copy the old database and its sidecars into the new state directory's `data/`; copy the old session tree into `sessions/`, old `media/` into `media/`, and old held media into `data/media-hold/`. Preserve filenames, directory structure and private permissions. If you have configured custom paths, copy from/to the actual configured paths. Set the new volume's ownership so the service account can read and write it.
3. Start **one** instance. Check settings, channels, queue, saved media and delivery review before enabling automation. Check the linked-device status. Don't run the old and new instance with the same linked session simultaneously. WhatsApp may still require a new link.
4. Make a fresh independent complete backup and test recovery. Keep the original stopped installation until the new one is verified.

## SMTP credential protection

SMTP passwords remain plaintext by default. Optional protection with a separately managed `RAQ_SECRETS_KEY` and an offline migration/rotation procedure is documented in `EMAIL-CREDENTIAL-PROTECTION.md`. It does not encrypt WhatsApp sessions, all database fields or cloud snapshots. Keep the key separately and retain previous keys for older backups.

## Cloud snapshots

Cloud memory, when enabled, contains private database content and linked-device credentials. Use a private repository, restrict and rotate the token, and retain independent encrypted backups. By default it excludes saved inbox and held queue media; `PERSIST_INBOX_MEDIA=1` and `PERSIST_HOLD_MEDIA=1` explicitly opt them in. Media may contain sensitive messages and may exceed GitHub or application size limits. The UI's separate **complete backup** includes both; see `COMPLETE-BACKUP-RECOVERY.md`.

Cloud snapshot inputs are limited to 256 MB per file, 512 MB total uncompressed and 50,000 archive entries; uploads also retain the 95 MB compressed ZIP limit. A missing database, symbolic link, changed file or oversized input causes the snapshot to fail before uploading, leaving the previous cloud copy intact. Files are copied into private temporary staging before archiving, which requires additional free disk space and can fail while session files are changing. Limits and stricter validation may reject previously accepted large or linked state directories; monitor cloud status and maintain a separate backup.

Cloud metadata responses are limited to 2 MiB and a downloaded archive to 100 MiB; raw downloads stream to a private temporary file and must match the advertised size when supplied. Requests use a 120-second deadline and do not follow redirects with the repository token. A renamed or redirected GitHub repository must be updated in configuration. An oversized, malformed, interrupted or unverifiable download stops recovery and blocks writes rather than intentionally replacing the cloud backup. Archive capture and uploads still require temporary disk space and memory. These transport checks have mocked tests, not a live GitHub recovery drill.

Cloud recovery rejects an unrelated or structurally incompatible SQLite database before installing session or media files. For a missing local database, it first validates the downloaded database, folds any legacy SQLite WAL into a private standalone staged copy, validates that copy, then installs it with a same-filesystem, no-overwrite hard link. Filesystems that do not support hard links cannot complete this recovery. If a local `-wal`, `-shm` or `-journal` exists without the database, recovery stops rather than attaching it to an unrelated copy; preserve these files and investigate offline. Sessions and media are separate from this step: recovery is **not globally atomic**, and a failed restore may have installed session files even if database installation failed. A process or host crash may leave sensitive `.restore-db-*` staging directories; investigate and dispose of them securely only after stopping the application and preserving evidence. No claim is made that a hard link or a completed restore is durable across power loss.

A cloud snapshot uses a consistent SQLite copy but captures sessions and media separately. If startup cannot verify the cloud copy, cloud writes are blocked to avoid overwriting it. If the local database or linked session is absent, startup stops rather than creating a new empty installation. Investigate the GitHub connection and saved backup before retrying. If both local database and linked session exist, the bot may start from them with cloud writes blocked for that process; verify both copies before restarting. A successful new startup can resume cloud sync.

Never delete or reset the backup branch as a troubleshooting shortcut unless you have independently verified another recovery copy. The service no longer automatically deletes the branch when a snapshot update fails. Cloud snapshots are not a substitute for durable local storage, transactionally consistent session backups, or an independently tested recovery plan.

## Feed, webhook and media compatibility

RSS/Atom feed fetches and outgoing webhooks now require public HTTP(S) destinations without URL credentials. DNS results are checked and pinned; private-network destinations and redirects to them are rejected. Webhook POST redirects are not followed, to avoid forwarding event payloads unexpectedly. Existing private-network feed or webhook configurations remain saved but will fail until moved to a permitted public endpoint. Feed responses are limited to 2 MB; webhook responses to 64 KB. Webhook retries can produce duplicate deliveries if a receiver accepts a request but its response is lost, so receivers should deduplicate using the `eventId` that remains the same across retries of one webhook delivery. The ID is not a durable queue and is regenerated if the process creates a new delivery.

Source channel media is fetched with public-address checks and a 64 MB raw-download cap. A known plaintext checksum mismatch or an unavailable attachment fails the post instead of silently publishing only the caption. These compatibility changes were tested with mocked transports, not live WhatsApp CDN traffic. Other provider and linked-device download paths are separate and have not been comprehensively verified.

## Scheduling and time zones

The WhatsApp channel and personal-message scheduling interfaces currently enter Asia/Karachi wall time; API clients can supply a valid IANA time zone. Invalid dates, invalid time zones and local times skipped by a daylight-saving change are rejected. A repeated wall time selects its earlier occurrence. For a recurring job whose usual wall time does not exist on a transition day, that occurrence is skipped and the next valid occurrence is used. Missed jobs may execute after the app resumes; review them before resuming. The calendar displays once/daily/weekly/weekday jobs using their configured local dates. Verify any critical schedule and its destination on a test account.

### Dashboard source integrity on startup

The app checks the six critical dashboard source files against `src/web-integrity.json` before creating state directories or initiating cloud recovery, database migrations or provider connections. It also refuses two sets of known stale workspace bytes. A mismatch stops startup; it **does not** restore or modify any files. First back up and inspect current files and compare them with a verified source backup. Never replace the database, sessions, uploads or backups during source reconciliation.

After intentionally editing and reviewing those dashboard files, a developer must run `node scripts/update-web-integrity.js --acknowledge-source-review`, then run the full tests and include the regenerated manifest in the release. A missing or malformed manifest also blocks startup. This local checksum is an accidental-change/mixed-version guard, **not** a digital signature, tamper protection or proof that the software is safe: someone who can modify both source and manifest can defeat it. It does not check other application files. Back up the reviewed source separately from user data.

### Process readiness (pending verification)

An additional `/readyz` endpoint has been implemented but not yet tested. It returns 200 only after startup wiring has reached the ready point, before shutdown begins, and a trivial SQLite read succeeds; otherwise it returns 503. It is deliberately narrow: it does **not** prove WhatsApp or other providers are connected, that writes will succeed, that storage is durable, that a backup exists, or that distributed jobs are healthy. `/healthz` remains a liveness response and the Docker health check still uses it. Deployment monitoring, alerts, realistic failure drills and an independent backup/restore test remain necessary.
