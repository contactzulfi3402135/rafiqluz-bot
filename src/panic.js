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
  // Repeated stop requests must not overwrite the original paused state.
  if (active()) return state() || {mirrorPaused:true,at:Date.now(),by:'unknown'};
  const prev = db.S.getBool('mirror.paused', false);
  const st = { mirrorPaused: prev, at: Date.now(), by: String(by).slice(0, 40) };
  // Commit the saved state and both gates together. A storage failure must
  // never leave a half-written panic record that looks successfully engaged.
  db.S.setMany([['panic.state', JSON.stringify(st)], ['panic.on', '1'], ['mirror.paused', '1']]);
  try { db.AUD.log(st.by, 'panic.stop', `Panic stop engaged — mirroring was ${prev ? 'already paused' : 'running'}; queue, scheduler, auto-replies and reports are frozen until restore`); } catch { }
  try { db.NTF.add('panic', 'Panic stop engaged — everything paused. Restore it from the red banner.'); } catch { }
  try { require('./webhooks').fire('panic.on', { by: st.by, mirroringWas: st.mirrorPaused ? 'paused' : 'running' }); } catch { } // 5G (R80)
  return st;
}

function restore(by = 'owner') {
  // A repeated restore must not unpause a manually paused installation.
  if (!active()) return {mirrorPaused:db.S.getBool('mirror.paused',false),at:0,by:'already restored'};
  // Missing/corrupt saved state must fail closed rather than unpausing.
  const st = state() || { mirrorPaused: true, at: 0, by: '?' };
  db.S.setMany([['mirror.paused', st.mirrorPaused ? '1' : '0'], ['panic.on', '0'], ['panic.state', '']]);
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
