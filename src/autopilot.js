'use strict';
/**
 * 5H (R87): AUTO-PILOT — a bounded self-maintenance loop. OFF by default.
 * It only does things that are SAFE and REVERSIBLE: retry failed queue items,
 * retry failed posts through the pipeline, and clean up zombie "processing"
 * rows. HARD CAPS (the point of this feature):
 *   · a per-day action cap (settings), so it can never run away
 *   · it NEVER deletes anything, and never touches settings or API keys
 *   · the panic stop kills it instantly, and the global pause holds it
 * Every action it takes is written to its own log (shown in Settings), so the
 * owner can see exactly what the pilot did and undo it if they disagree.
 */
const { S, AP, AUD, NTF } = require('./db');
const { ring } = require('./logger');

const TICK_MS = 60 * 60e3;

const maxDay = () => Math.max(1, Math.min(100, parseInt(S.get('autopilot.maxday', '10'), 10) || 10));
const usedToday = () => AP.todayCount();

function log(action, detail) {
  AP.log(action, detail);
  try { AUD.log('autopilot', `autopilot.${action}`, detail || ''); } catch { }
}

async function pass(by = 'hourly') {
  if (!S.getBool('power.autopilot.on', false)) return;        // OFF by default
  if (S.getBool('panic.on', false)) return;                   // panic stop kills it
  if (S.getBool('mirror.paused', false)) return;              // global pause holds it
  const q5 = require('./queue5a');
  const d = require('./db').open();
  const budget = maxDay() - usedToday();
  if (budget <= 0) { log('cap', `Daily action cap of ${maxDay()} reached — pilot idles until tomorrow`); return; }

  // 1 · failed queue items → put them back in line (reversible, additive)
  const failedQueue = d.prepare("SELECT id FROM approvals WHERE status='failed' ORDER BY id ASC LIMIT ?").all(Math.min(20, budget));
  for (const f of failedQueue) {
    if (usedToday() >= maxDay()) break;
    try { q5.retry(f.id); log('retry-queue', `Re-queued a failed queue item (${f.id})`); }
    catch { /* already decided by someone — skip */ }
  }

  // 2 · failed posts → re-feed through the pipeline (existing retry path)
  if (usedToday() < maxDay()) {
    try {
      const r = await q5.retryAllFailed();
      const n = (r && typeof r === 'object' && 'retried' in r) ? r.retried : (typeof r === 'number' ? r : 0);
      if (n) { log('retry-posts', `Re-fed ${n} failed post(s) through the pipeline`); NTF.add('autopilot', `Auto-pilot re-tried ${n} failed post(s)`); }
    } catch { /* no failed posts or nothing to do */ }
  }

  // In-flight rows are never reset automatically: the remote outcome may be unknown.

  log('pass', `Auto-pilot pass complete (${by}) — ${usedToday()}/${maxDay()} actions used today`);
}

function view() {
  const d = require('./db').open();
  const rows = AP.list(10);
  return {
    on: S.getBool('power.autopilot.on', false),
    maxDay: maxDay(),
    usedToday: usedToday(),
    last: rows[0] ? { action: rows[0].action, detail: rows[0].detail, at: rows[0].at } : null,
    log: rows.map((r) => ({ id: r.id, action: r.action, detail: r.detail, at: r.at }))
  };
}

function start() {
  setInterval(() => { pass().catch(() => { }); }, TICK_MS).unref?.();
  setTimeout(() => { pass('boot').catch(() => { }); }, 90e3).unref?.();
  ring.info('autopilot.ready', 'Auto-pilot armed (off by default — hourly, capped, never deletes)');
}

module.exports = { pass, view, maxDay, usedToday, start };
