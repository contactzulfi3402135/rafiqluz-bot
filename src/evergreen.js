'use strict';
/**
 * 5H (R86): EVERGREEN RECYCLING — re-publishes proven old posts on a
 * rotation, within a daily quota. OFF by default. Strictly additive: it
 * publishes through the SAME publish path (so history, analytics and undo
 * all see it as a normal post, credited as “Evergreen”), checks the SAME
 * per-target rate guard before sending (TOC-safe pacing, R8), and is killed
 * by the global pause and the panic stop. Text-only (media buffers from old
 * posts are gone), and a post is never recycled twice inside the rotation
 * window, so the feed stays varied.
 */
const { S, CH, P, EGR, AUD, NTF } = require('./db');
const { ring } = require('./logger');

const TICK_MS = 30 * 60e3;

const quota = () => Math.max(0, Math.min(10, parseInt(S.get('evergreen.quota', '2'), 10) || 2));
const minAgeDays = () => Math.max(0, Math.min(90, parseInt(S.get('evergreen.minage', '7'), 10) || 7));

/** True when publishing right now would breach the per-target rate guard. */
function rateGuardHit() {
  const max = Math.max(3, parseInt(S.get('guard.maxperhour', '30'), 10) || 30);
  return CH.publishedLastHour() >= max;
}

async function recycleOne(post, targets) {
  const publishMod = require('./publish');
  const body = String(post.body || '').trim();
  const r = await publishMod.publish({ text: body.slice(0, 4096) }, {
    sourceJid: 'evergreen@bot', sourceMsgId: 'eg' + post.id,
    only: targets.map((t) => t.jid),
    hasMedia: false,
    norm: body.slice(0, 400)
  });
  EGR.log(post.id, body, r.sent);
  AUD.log('evergreen', 'post.recycled', `Evergreen recycled post ${post.id} (${String(body).slice(0, 60)}) → ${r.sent} target(s)`);
  ring.info('evergreen.recycle', `Evergreen recycled a proven post → ${r.sent} target(s)`);
  return r;
}

async function tick() {
  if (!S.getBool('power.evergreen.on', false)) return;   // OFF by default
  if (S.getBool('panic.on', false) || S.getBool('mirror.paused', false)) return;
  const d = require('./db').open();
  const usedToday = d.prepare("SELECT COUNT(*) c FROM evergreen_log WHERE recycled_at >= date('now')").get().c || 0;
  if (usedToday >= quota()) return;
  const targets = CH.listActiveTargets();
  if (!targets.length) return;
  if (rateGuardHit()) { ring.info('evergreen.skip', 'Evergreen skipped — the per-target rate guard would be breached right now'); return; }
  const cutoff = new Date(Date.now() - minAgeDays() * 86400e3).toISOString().slice(0, 19).replace('T', ' ');
  const cands = d.prepare("SELECT id, body FROM posts WHERE status='published' AND has_media=0 AND length(body) >= 40 AND created_at <= ? ORDER BY id ASC").all(cutoff);
  for (const c of cands) {
    if (EGR.lastFor(c.id, 21)) continue;                 // rotation: nothing twice in 21 days
    if (!String(c.body || '').trim()) continue;
    try {
      await recycleOne(c, targets);
      return;                                            // one recycle per tick (the quota spreads the rest)
    } catch (err) {
      ring.warn('evergreen.fail', `Evergreen could not recycle post ${c.id}: ${String(err?.message || err).slice(0, 140)}`);
      return;
    }
  }
}

function view() {
  const d = require('./db').open();
  const log = EGR.list(10);
  return {
    on: S.getBool('power.evergreen.on', false),
    quota: quota(),
    minAgeDays: minAgeDays(),
    usedToday: d.prepare("SELECT COUNT(*) c FROM evergreen_log WHERE recycled_at >= date('now')").get().c || 0,
    total: d.prepare('SELECT COUNT(*) c FROM evergreen_log').get().c || 0,
    last: log[0] ? { body: log[0].body.slice(0, 160), targets: log[0].targets, at: log[0].recycled_at } : null,
    log: log.map((l) => ({ id: l.id, body: l.body.slice(0, 120), targets: l.targets, at: l.recycled_at }))
  };
}

function start() {
  setInterval(() => { tick().catch(() => { }); }, TICK_MS).unref?.();
  setTimeout(() => { tick().catch(() => { }); }, 3 * 60e3).unref?.();
  ring.info('evergreen.ready', 'Evergreen recycling armed (off by default — 30-min tick, daily quota)');
}

module.exports = { tick, view, quota, minAgeDays, start };
