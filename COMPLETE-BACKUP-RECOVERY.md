# Complete backup and offline recovery

A complete backup is an **unencrypted secret**. It contains the database, API keys and linked WhatsApp session files, as well as saved inbox media and held queue media when present. Anyone with a copy may be able to access your accounts. Store it on a trusted device in encrypted storage with restricted access; do not email it, commit it to Git, or put it in a public cloud location.

An optional offline tool can encrypt a downloaded ZIP with a passphrase. It does not encrypt the dashboard download or live data; see `ENCRYPTED-BACKUPS.md`.

## Make and inspect a backup

1. In Settings → Data & backup, choose **Download complete backup…**, read the warning and confirm. The separate database-only backup does not include sessions, saved inbox media or held media.
2. Move the downloaded ZIP to secure storage. The complete backup has a 100 MB database limit, a 250 MB total uncompressed input limit and a 10,000-file limit; errors are shown if those limits are exceeded.
   Source files are copied to private temporary staging before archiving; allow extra free disk space. If a file changes during capture, or a symbolic link or oversized file is found, backup fails rather than silently using a different file. This does not make all files transactionally consistent.
3. On an isolated machine with Node 24 and the project dependencies installed, validate and extract it into a **new directory outside the application and all configured data, session, media, backup and log directories**. The parent directory must already exist:

   ```sh
   node scripts/restore-full-backup.js /secure/backup.zip /secure/new-recovery-copy
   ```

   The command refuses an existing destination, validates archive paths and CRCs, checks the manifest and database integrity, and creates an offline recovery copy. It does **not** touch a running installation.
4. Inspect the files and test recovery on a disconnected clone. The resulting directory can contain `bot.sqlite`, `sessions/`, `media/`, and `media-hold/`, plus a manifest. Do not connect two copies of the same linked device simultaneously.

## Dashboard database-only restore

The dashboard can preview and restore a database-only backup, but it cannot stop provider requests already in flight. An offline recovery on a stopped instance is safer. For a dashboard restore, engage panic stop first, allow in-flight work to settle, keep an independently verified backup, inspect the table comparison and confirm the exact uploaded file. The API requires the preview SHA-256 and an explicit confirmation header. Existing API clients must be updated.

Restoring can bring back older waiting jobs, keys and settings. The transaction deliberately keeps panic stop active and mirroring paused even if the backup contained a running state. Clearing panic after this kind of restore still leaves mirroring manually paused; inspect queue items, schedules, destinations, credentials and potential duplicate sends before explicitly resuming. The backup's earlier pause value is retained in `restore.previous_mirror_paused` for inspection. A local pre-restore snapshot is not an independent durable backup. No live-restore procedure can recall a network request already started.

## Replacing a stopped installation

Stop the bot and all workers before changing its files. Keep a separate, verified copy of the current database **including its WAL/SHM files if present**, sessions, saved inbox media, held media and configuration. On a host with durable storage, restore the validated database to the configured `DATABASE_PATH`, the session tree to `SESSION_DIR`, saved inbox media to the application’s `media/` directory, and held media to the `media-hold` directory next to the database. Do not merge sessions with an existing session tree or overwrite the only copy. Check ownership and restrictive permissions before starting one instance, and verify settings, channels, queue and delivery review before resuming automation.

Heroku dyno files are ephemeral: merely copying files into a running dyno does not make them durable. Use a tested durable recovery mechanism and the deployment guide; do not assume a copied local file will survive a restart. The ZIP is a point-in-time database snapshot plus independently changing session/media files, not one transaction across all three. A backup may contain partially updated session files or miss changes made while it was being created. Keep independent backups and perform regular offline restore drills; no backup method here guarantees recovery, a retained session, or no lost messages.

## Retention and capacity

History and saved media are retained by default in this build. The owner can explicitly enable automatic deletion or run cleanup in Storage. Retaining more data increases local disk use and the size of backups; backups fail when their documented limits are exceeded. Monitor space and test recovery regularly. Neither retention settings nor a local ZIP protect against ephemeral disk loss.
