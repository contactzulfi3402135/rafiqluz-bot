'use strict';
/** Periodic maintenance. Saved inbox media is deleted by age only if the
 * owner explicitly enables the option; old refetchable avatar cache files
 * are cleaned independently. History and uptime rows are retained. */
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
    if (S.getBool('inbox.mediaPruneEnabled',false)) {
      const m = IB.pruneMedia(keepDays());
      out.files = m.files; out.blobs = m.blobs;
    }
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
