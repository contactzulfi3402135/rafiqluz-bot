'use strict';
/**
 * 5I (I1): SUBSCRIBER SNAPSHOTS + GROWTH (best-effort, as the contract asks).
 * Every 30 minutes it asks WhatsApp — through the EXISTING channelMetadata
 * path — for each followed source's subscriber count and stores ONE snapshot
 * per source per day (PKT). The Sources view then shows the current count and
 * a 14-day growth sparkline. Best-effort on purpose: Baileys may omit the
 * number in some responses or rate-limit metadata calls, so a missing value
 * simply means "no snapshot yet today" — never an error, never a retry storm.
 */
const { S, CH, SUBS } = require('./db');
const { ring } = require('./logger');

const TICK_MS = 30 * 60e3;

/** Fetch + store today's snapshot for one source. Returns the count or null. */
async function snapshotOne(jid) {
  const wa = require('./wa');
  const sock = wa.getSocket();
  if (!sock || wa.getStatus().status !== 'open') return null;
  try {
    const meta = await wa.channelMeta(sock, jid);
    const n = Number(meta?.subscribers ?? NaN);
    if (!Number.isFinite(n) || n < 0) return null;
    SUBS.upsertDay(jid, SUBS.dayKey(), n);
    return n;
  } catch {
    return null; // best-effort: metadata can fail for busy channels — skip quietly
  }
}

async function pass() {
  if (S.getBool('panic.on', false)) return;
  for (const s of CH.listActiveSources()) {
    if (s.kind && s.kind !== 'wa') continue;          // RSS feeds have no subscribers
    if (SUBS.todayFor(s.jid)) continue;               // one snapshot per day per source
    const n = await snapshotOne(s.jid);
    if (n != null) ring.info('subs.snap', `Subscriber snapshot: ${s.name || s.jid} = ${n}`);
  }
}

function start() {
  setInterval(() => { pass().catch(() => { }); }, TICK_MS).unref?.();
  setTimeout(() => { pass().catch(() => { }); }, 60e3).unref?.();
  ring.info('subs.ready', 'Subscriber snapshots armed (best-effort, once per day per source)');
}

module.exports = { pass, snapshotOne, start };
