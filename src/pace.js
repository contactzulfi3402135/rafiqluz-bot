/* 5E (R74): ADAPTIVE PACING — when send FAILURES cluster (3+ in a rolling
   15-minute window and failures ≥ successes), the between-sends gap grows:
   30 s → 60 s → 120 s … capped at 10 minutes, and it clears itself 20 minutes
   after the last failure.
   It only ever WAITS LONGER between sends. It never lowers the fixed 1.5 s
   pacing, never touches the rate guard (max posts/hour), and never drops a
   post — a post that hits the gap simply rides the next pump tick.
   The failure window is stored in the database (it survives a restart, like
   the backoff itself); clean sends never clear it early — only quiet time does. */
'use strict';
const db = require('./db');

const WINDOW_MS = 15 * 60e3;   // observation window
const CLEAR_MS = 20 * 60e3;    // quiet time that clears the backoff
const BASE = 30e3;             // first backoff gap
const MAX = 10 * 60e3;         // cap
const MIN_FAILS = 3;           // trigger threshold

function _d() {
  const d = db.open();
  d.prepare('CREATE TABLE IF NOT EXISTS pace_failures(ts INTEGER)').run();
  return d;
}

/** Record the outcome of a publish pass. Call once per pass with real counts. */
function note(sent, failed, now = Date.now()) {
  const s = db.S;
  const d = _d();
  const inst = d.prepare('INSERT INTO pace_failures (ts) VALUES (?)');
  for (let i = 0; i < Math.min(50, Number(failed) || 0); i++) inst.run(now);
  // window: failures in the last 15 minutes
  const since = now - WINDOW_MS;
  const w = d.prepare('SELECT COUNT(*) n FROM pace_failures WHERE ts >= ?').get(since);
  const sentInWindow = sent; // the pass just finished is the freshest data point
  if (w.n >= MIN_FAILS && w.n >= sentInWindow) {
    const activeNow = s.getBool('pace.active', false);
    const prev = activeNow ? (parseInt(s.get('pace.gap', 0), 10) || 0) : 0;
    const ngap = prev ? Math.min(prev * 2, MAX) : BASE;
    s.set('pace.gap', String(ngap));
    s.set('pace.active', '1');
    s.set('pace.lastfail', String(now));
    s.set('pace.reason', `${w.n} failed sends in the last 15 min — waiting ${(ngap / 1000).toFixed(0)} s between sends`);
    try { db.AUD.log('pace', 'pace.backoff', s.get('pace.reason')); } catch { }
  }
  return status(now);
}

function status(now = Date.now()) {
  const s = db.S;
  let active = s.getBool('pace.active', false);
  const lastFail = parseInt(s.get('pace.lastfail', 0), 10) || 0;
  if (active && lastFail && now - lastFail > CLEAR_MS) {
    s.set('pace.active', '0'); s.set('pace.gap', '0'); s.set('pace.reason', '');
    active = false;
    try { db.AUD.log('pace', 'pace.cleared', 'Adaptive pacing cleared — no failures for 20 minutes'); } catch { }
  }
  const d = _d();
  const since = now - WINDOW_MS;
  const w = d.prepare('SELECT COUNT(*) n FROM pace_failures WHERE ts >= ?').get(since);
  d.prepare('DELETE FROM pace_failures WHERE ts < ?').run(since); // prune
  const gap = parseInt(s.get('pace.gap', 0), 10) || 0;
  return {
    active,
    gapMs: active ? gap : 0,
    lastFail,
    reason: active ? String(s.get('pace.reason', '')) : '',
    window: { failed: w.n, since }
  };
}

/**
 * publish.js / queue5a.js: the wait to use instead of the fixed pacing.
 * Returns at least `base`; when a backoff is active it returns the backoff gap.
 */
function gapMin(base = 1500, now = Date.now()) {
  const st = status(now);
  return Math.max(Number(base) || 1500, st.gapMs);
}

module.exports = { note, status, gapMin, WINDOW_MS, CLEAR_MS, BASE, MAX, MIN_FAILS };
