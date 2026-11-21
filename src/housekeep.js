'use strict';
/**
 * v9.0.0 (repo-slim) — the housekeeping janitor.
 *
 * One job: keep the persistent state small and bounded, so the cloud-memory
 * snapshot (sessions/ + bot.sqlite → GitHub `bot-state` branch) never grows
 * and the repo stays the size of ONE snapshot:
 *
 *   1. inbox media   — files in media/inbox/ + pre-build BLOBs, pruned by the
 *                      owner's "keep N days" setting (default 30) and a hard
 *                      newest-1000-files / newest-300-BLOBs row cap
 *   2. avatar cache  — media/avatars (profile photos, re-fetchable) → 7 days
 *   3. uptime rows   — the boot log table, capped at the newest 500
 *
 * Runs once ~20 s after boot (after the DB restore settles) and then every
 * 6 h. Everything is additive + idempotent; a failure is logged, never fatal.
 */
const fs = require('fs');
const path = require('path');
const cfg = require('./config');
const { ring } = require('./logger');
const { S, IB } = require('./db');

const KEEP_DAYS_KEY = 'inbox.mediaKeepDays';
const keepDays = () => Math.min(365, Math.max(1, parseInt(S.get(KEEP_DAYS_KEY, '30'), 10) || 30));

/** @returns {{files:number, blobs:number, avatars:number, uptime:number}} */
function sweep() {
  const out = { files: 0, blobs: 0, avatars: 0, uptime: 0 };
  try {
    const m = IB.pruneMedia(keepDays());
    out.files = m.files; out.blobs = m.blobs;
  } catch { }
  try {
    const ava = path.join(path.dirname(cfg.config.paths.database), 'avatars');
    const cutoff = Date.now() - 7 * 86400e3;
    for (const f of fs.readdirSync(ava)) {
      try {
        const st = fs.statSync(path.join(ava, f));
        if (st.isFile() && st.mtimeMs < cutoff) { fs.unlinkSync(path.join(ava, f)); out.avatars += 1; }
      } catch { }
    }
  } catch { }
  try {
    out.uptime = require('./db').open().prepare('DELETE FROM uptime WHERE id NOT IN (SELECT id FROM uptime ORDER BY id DESC LIMIT 500)').run().changes || 0;
  } catch { }
  return out;
}

function start() {
  const first = setTimeout(() => {
    try {
      const r = sweep();
      if (r.files || r.blobs || r.avatars || r.uptime) {
        ring.info('housekeep.sweep', `janitor: pruned ${r.files} inbox media file(s), ${r.blobs} old BLOB(s), ${r.avatars} avatar(s), ${r.uptime} uptime row(s)`);
      }
    } catch (e) { ring.warn('housekeep.fail', `janitor sweep failed: ${String(e?.message || e).slice(0, 140)}`); }
  }, 20000);
  first.unref?.();
  const iv = setInterval(() => {
    try {
      const r = sweep();
      if (r.files || r.blobs || r.avatars || r.uptime) {
        ring.info('housekeep.sweep', `janitor: pruned ${r.files} inbox media file(s), ${r.blobs} old BLOB(s), ${r.avatars} avatar(s), ${r.uptime} uptime row(s)`);
      }
    } catch (e) { ring.warn('housekeep.fail', `janitor sweep failed: ${String(e?.message || e).slice(0, 140)}`); }
  }, 6 * 3600e3);
  iv.unref?.();
  return { sweep, keepDays };
}

module.exports = { start, sweep, keepDays, KEEP_DAYS_KEY };
