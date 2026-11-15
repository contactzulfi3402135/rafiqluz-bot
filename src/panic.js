/* 5E (R73): PANIC STOP — one button pauses EVERY outbound automation at once
   (mirroring intake, approval-queue pump, scheduler, auto-replies, reports)
   and restores the EXACT previous state on demand.
   Mechanics: it reuses the existing `mirror.paused` safety flag (same switch
   the manual pause uses, so offline recovery still works) plus a `panic.on`
   flag that every pump checks — so nothing can be manually un-paused while a
   panic is active. A crash mid-panic keeps the bot stopped: restore is always
   a conscious owner action (safest, R10). */
'use strict';
const db = require('./db');

function active() { return db.S.getBool('panic.on', false); }

function state() {
  try { return JSON.parse(db.S.get('panic.state', '') || 'null') || null; } catch { return null; }
}

function stop(by = 'owner') {
  const prev = db.S.getBool('mirror.paused', false);
  const st = { mirrorPaused: prev, at: Date.now(), by: String(by).slice(0, 40) };
  db.S.set('panic.state', JSON.stringify(st));
  db.S.set('panic.on', '1');
  db.S.set('mirror.paused', '1'); // same flag as the manual global pause
  try { db.AUD.log(st.by, 'panic.stop', `Panic stop engaged — mirroring was ${prev ? 'already paused' : 'running'}; queue, scheduler, auto-replies and reports are frozen until restore`); } catch { }
  try { db.NTF.add('panic', 'Panic stop engaged — everything paused. Restore it from the red banner.'); } catch { }
  try { require('./webhooks').fire('panic.on', { by: st.by, mirroringWas: st.mirrorPaused ? 'paused' : 'running' }); } catch { } // 5G (R80)
  return st;
}

function restore(by = 'owner') {
  const st = state() || { mirrorPaused: false, at: 0, by: '?' };
  db.S.set('mirror.paused', st.mirrorPaused ? '1' : '0'); // EXACT previous state
  db.S.set('panic.on', '0');
  db.S.set('panic.state', '');
  try { db.AUD.log(by, 'panic.restore', `Panic stop restored — mirroring ${st.mirrorPaused ? 'paused (as it was before)' : 'running (as it was before)'}`); } catch { }
  try { db.NTF.add('panic', 'Panic stop restored — normal operation resumed.'); } catch { }
  try { require('./webhooks').fire('panic.off', { mirroringNow: st.mirrorPaused ? 'paused (as before)' : 'running (as before)' }); } catch { } // 5G (R80)
  return st;
}

function view() {
  const st = state();
  return { on: active(), state: st, since: st && active() ? new Date(st.at).toISOString() : null };
}

function bootCheck() {
  if (!active()) return;
  if (!db.S.getBool('mirror.paused', false)) db.S.set('mirror.paused', '1'); // keep the invariant after a crash
  try { db.AUD.log('boot', 'panic.boot', 'Panic stop was active before the restart — it is STILL active; restore it manually from the dashboard'); } catch { }
}

module.exports = { active, stop, restore, view, state, bootCheck };
