'use strict';
/**
 * v6.0.0 — channel management: sources/targets, live subscriptions with a
 * self-heal loop, the PULL safety-net (posts flow even when push is dead —
 * the day-2 silence killer), auto-monitor (follow = source) and auto-target
 * (your own channel becomes the target automatically).
 */
const wa = require('./wa');
const { ring } = require('./logger');
const { S, CH, AUD, BM } = require('./db');
const { resolveCode } = require('./catalog');

const subOkUntil = new Map();    // jid → ms when its live-push subscription EXPIRES
const subMissingAt = new Map();  // 1/hour throttle for item-not-found notes

async function subscribe(jid) {
  const sock = wa.getSocket();
  if (!sock) return false;
  const res = await wa.subscribeChannel(sock, jid);
  if (res && res.duration) {
    // WhatsApp expires live-push subscriptions — re-arm BEFORE that moment
    // (75% of the lifetime, capped at 15 min so it can never silently die)
    const refreshMs = Math.min(Math.max(res.duration * 750, 60 * 1000), 15 * 60 * 1000);
    subOkUntil.set(jid, Date.now() + refreshMs);
    return true;
  }
  const now = Date.now();
  if (!subMissingAt.get(jid) || now - subMissingAt.get(jid) > 3600e3) {
    subMissingAt.set(jid, now);
    ring.warn('channel.subscribe.missing', `WhatsApp did not confirm live updates for ${jid} — the channel was deleted, this account no longer follows it, or WhatsApp is busy. Posts still arrive via the fast safety-net check (every ${Math.max(15, Number(process.env.SOURCE_PULL_SEC) || 30)} s).`);
  }
  return false;
}

async function subscribeAll(paceMs) {
  const sources = CH.listActiveSources();
  let first = true;
  for (const s of sources) {
    if (!first) await new Promise((r) => setTimeout(r, paceMs));
    first = false;
    await subscribe(s.jid);
  }
  if (sources.length) ring.info('channel.subscribed', `Live subscriptions refreshed for ${sources.length} source(s)`);
}

/* ---------------- PULL SAFETY-NET ---------------- */
/** v7.3.7: cap a promise so a hung socket query can never wedge the pull poll. */
const withTimeout = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('pull timeout ' + ms + 'ms')), ms))]);
function startPullPoll() {
  const sec = Math.max(15, Number(process.env.SOURCE_PULL_SEC) || 30);
  let pullBusy = false; // never stack cycles — a slow source must not pile up queries
  let failStreak = 0;      // v7.3.7: consecutive cycles where ALL fetches failed = zombie socket
  let lastHeartbeat = 0;   // v7.3.7: hourly pipeline heartbeat for the logs
  setInterval(async () => {
    const sock = wa.getSocket();
    if (!sock || wa.getStatus().status !== 'open' || pullBusy) return;
    pullBusy = true;
    let fetchOk = 0, fetchFail = 0;
    try {
      for (const src of CH.listActiveSources()) {
        try {
          const posts = await withTimeout(wa.fetchChannelPosts(sock, src.jid, 8), 25000).catch(() => null);
          if (posts === null) { fetchFail += 1; continue; }   // the fetch itself failed (dead connection)
          fetchOk += 1;
          let fed = 0;
          for (const m of posts) {
            if (!m?.key?.id || !m.messageTimestamp) continue;
            if (Date.now() / 1000 - m.messageTimestamp > 15 * 60) continue; // fresh posts only
            if (require('./db').P.seen(src.jid, m.key.id)) continue;
            wa.events.emit('wa.message', m);
            fed += 1;
          }
          if (fed) ring.info('channel.pull', `Pulled ${fed} new post(s) from ${src.name || src.jid} — live push had not delivered them (safety-net fetch)`);
        } catch { /* per-source best effort */ }
        await new Promise((r) => setTimeout(r, 2000)); // gentle pace between sources
      }
      /* v7.3.7: ZOMBIE SOCKET WATCHDOG. The socket claims "open" yet cannot
         complete a SINGLE fetch for 3 straight cycles: the connection is dead
         even though Baileys never saw a clean close (no events, no errors, no
         reconnect — the "bot stopped, no response" state). Force a clean
         reconnect with the saved login; missed posts auto-recover after it. */
      const total = fetchOk + fetchFail;
      if (total > 0 && fetchOk === 0) {
        failStreak += 1;
        if (failStreak === 1) ring.warn('channel.pull.fail', `Pull safety-net: all ${total} source fetch(es) failed while the socket reports "open" — the connection may be dead (self-repair after 2 more full-failure cycles)`);
        if (failStreak >= 3) { failStreak = 0; wa.forceReconnect(`3 consecutive pull cycles (every ${sec}s) failed all ${total} source fetch(es)`); }
      } else if (total > 0) {
        failStreak = 0;
      }
      /* hourly heartbeat: makes "is the pipeline alive?" answerable from the logs */
      if (Date.now() - lastHeartbeat > 3600e3) {
        lastHeartbeat = Date.now();
        const last = CH.lastSourceActivity();
        ring.info('channel.heartbeat', `Pipeline alive — ${total} source(s) polled, fetches ok/failed ${fetchOk}/${fetchFail}, last source post ${last ? last + ' (UTC)' : 'none yet'}`);
      }
    } finally { pullBusy = false; }
  }, sec * 1000).unref?.();
}

/**
 * MISSED-POST RECOVERY — runs once ~40 s after the bot (re)connects: pulls up
 * to 20 posts per source and feeds anything newer than the source was added /
 * the last 6 h that was never processed. This is how the bot catches up after
 * a Heroku dyno night-sleep or a deploy: nothing posted while offline is lost.
 */
async function recoverMissed() {
  const sock = wa.getSocket();
  if (!sock || wa.getStatus().status !== 'open') return;
  let total = 0;
  for (const src of CH.listActiveSources()) {
    try {
      const posts = await wa.fetchChannelPosts(sock, src.jid, 20).catch(() => []);
      const addedTs = Date.parse(String(src.added_at || '').replace(' ', 'T') + 'Z') || 0;
      const floor = Math.max(addedTs / 1000, Date.now() / 1000 - 6 * 3600);
      let fed = 0;
      for (const m of posts) {
        if (!m?.key?.id || !m.messageTimestamp) continue;
        if (m.messageTimestamp < floor) continue;                 // older than source/recovery window
        if (require('./db').P.seen(src.jid, m.key.id)) continue;  // already handled
        wa.events.emit('wa.message', m);
        fed += 1; total += 1;
      }
      if (fed) ring.info('channel.recovery', `Recovered ${fed} missed post(s) from ${src.name || src.jid} (posted while the bot was offline/restarting)`);
    } catch { /* per-source best effort */ }
    await new Promise((r) => setTimeout(r, 2500));
  }
  if (total) ring.info('channel.recovery.done', `Catch-up complete: ${total} missed post(s) recovered and published`);
  // 5A (R47): record the pass result so the Live Queue view can show it
  await new Promise((r) => setTimeout(r, 8000)); // let the fed posts finish their pipeline pass
  try {
    const rows = require('./db').open().prepare("SELECT status, COUNT(*) n FROM posts WHERE created_at >= datetime('now', '-3 minutes') GROUP BY status").all();
    const sum = Object.fromEntries(rows.map((r) => [r.status, r.n]));
    require('./queue5a').recordRecovery({ fed: total, recovered: sum.published || 0, queued: sum.queued || 0, failed: sum.failed || 0, skipped: sum.skipped || 0 });
  } catch { /* results display is best-effort */ }
}

/* ---------------- v7.4.0: AI-CONTROL CATCH-UP ----------------
   The same recovery logic as recoverMissed(), but with an owner-tunable window
   and feed cap — this is what the Ask-AI "Bot control" mode runs when the owner
   says "post the missed posts to my channel". dryRun=true only LISTS the missed
   posts without feeding anything (the AI shows them before acting). */
function clampWindow(o) {
  const hours = Math.min(Math.max(1, Number(o?.hours) || 24), 168);   // 1 h .. 7 days
  const limit = Math.min(Math.max(1, Number(o?.limit) || 20), 20);    // fetch depth per source
  const totalCap = Math.min(Math.max(1, Number(o?.totalCap) || 10), 30); // total feed per call
  return { hours, limit, totalCap };
}
async function catchUp(opts = {}) {
  const { hours, limit, totalCap } = clampWindow(opts);
  const dryRun = Boolean(opts.dryRun);
  const sock = wa.getSocket();
  if (!sock || wa.getStatus().status !== 'open') {
    throw new Error('WhatsApp is not connected — connect the number first, then ask again.');
  }
  const perSource = [];
  let fed = 0;
  for (const src of CH.listActiveSources()) {
    let posts = [];
    try { posts = (await wa.fetchChannelPosts(sock, src.jid, limit).catch(() => [])) || []; } catch { posts = []; }
    const addedTs = Date.parse(String(src.added_at || '').replace(' ', 'T') + 'Z') || 0;
    const floor = Math.max(addedTs / 1000, Date.now() / 1000 - hours * 3600);
    const missed = [];
    for (const m of posts) {
      if (!m?.key?.id || !m.messageTimestamp) continue;
      if (m.messageTimestamp < floor) continue;                    // outside the window
      if (require('./db').P.seen(src.jid, m.key.id)) continue;     // already handled
      missed.push(m);
      if (missed.length >= totalCap) break;
    }
    if (missed.length) perSource.push({ source: src.name || src.jid, missed: missed.length });
    if (!dryRun && missed.length) {
      const feedN = Math.min(missed.length, Math.max(0, totalCap - fed));
      for (let i = 0; i < feedN; i++) wa.events.emit('wa.message', missed[i]); // normal pipeline: clean → AI → rate guard → publish
      fed += feedN;
      ring.info('ai.catchup', `AI control: fed ${feedN} missed post(s) from ${src.name || src.jid} into the pipeline (last ${hours} h)`);
      if (fed >= totalCap) break;
    }
    await new Promise((r) => setTimeout(r, 2500)); // gentle pace
  }
  if (dryRun) return { mode: 'list', hours, perSource, totalMissed: perSource.reduce((a, x) => a + x.missed, 0) };
  return {
    mode: 'fed', hours, perSource, fed,
    note: fed ? 'These posts are going through the normal pipeline now (cleaning, AI, rate guard, publish) — check the Posts tab.'
      : 'Nothing missed in that window — everything posted is already handled.'
  };
}
/** read-only listing for the AI (never feeds anything) */
function missedList(opts) { return catchUp({ ...opts, dryRun: true }); }

/* ---------------- follow verification + directory enrichment ---------------- */
/* v7.7.3 — follow-state tracking: a channel the account no longer follows
   cannot produce posts, so it is removed from the Sources list (the user asked
   for the list to mirror the phone's follow state). We require TWO consecutive
   "no viewer role" checks plus a 15-minute grace period after a fresh link, so
   a flaky metadata call or the pre-role-sync window can never delete a source
   by mistake. A successful check WITH a role resets the streak immediately. */
let openedAt = 0;                       // set on every wa.open
const notFollowed = new Map();          // jid → consecutive no-role checks
let lastScan = null;                    // { at, wa, checked, removed:[] } — surfaced to the UI + /directory

function unfollowDecision(prev, hasRole, isSource, msSinceOpen) {
  if (hasRole) return { streak: 0, remove: false };       // follows it → reset, never remove
  const streak = (Number(prev) || 0) + 1;
  const remove = streak >= 2 && isSource && msSinceOpen > 15 * 60e3;
  return { streak, remove };
}

async function refreshDirectory() {
  const stat = { at: new Date().toISOString(), wa: wa.getStatus().status, checked: 0, removed: [] };
  lastScan = stat;
  const sock = wa.getSocket();
  if (!sock || wa.getStatus().status !== 'open') return stat;
  for (const d of CH.dirList()) {
    let meta = null;
    try { meta = await wa.channelMeta(sock, d.jid); } catch { /* best effort */ }
    stat.checked += 1;
    if (meta) {
      CH.recordDir(d.jid, meta.name || d.name, meta.role || d.role);
      // v6.4: the REAL channel name flows into the Sources/Targets tabs too —
      // the owner sees names, never bare numbers
      if (meta.name) CH.renameChannel(d.jid, meta.name);
      const isSrc = CH.listSources().some((s) => s.jid === d.jid);
      const isTgt = CH.listTargets().some((t) => t.jid === d.jid);
      const dec = unfollowDecision(notFollowed.get(d.jid), Boolean(meta.role), isSrc, Date.now() - openedAt);
      notFollowed.set(d.jid, dec.streak);
      if (dec.remove) {
        CH.removeSource(d.jid);
        stat.removed.push(d.name || d.jid);
        try { require('./db').AUD.log('owner', 'sources.unfollow-removed', `Removed "${d.name || d.jid}" from Sources — WhatsApp reports you no longer follow it (two consecutive checks)`); } catch { }
        ring.warn('channel.unfollowed', `No longer following "${d.name || d.jid}" — removed it from Sources`);
      }
      // no viewer role at all = this account no longer follows the channel →
      // it can not produce posts and must not appear in the pickers
      if (!meta.role && !CH.listSources().some((s) => s.jid === d.jid) && !isTgt) {
        CH.forgetDir(d.jid);
      }
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
  // also enrich sources/targets that are not in the directory yet (added by invite link)
  for (const row of [...CH.listSources(), ...CH.listTargets()]) {
    if (CH.dirList().some((d) => d.jid === row.jid)) continue;
    try {
      const meta = await wa.channelMeta(sock, row.jid);
      if (meta) {
        CH.recordDir(row.jid, meta.name || row.name, meta.role || null);
        if (meta.name) CH.renameChannel(row.jid, meta.name);
      }
    } catch { /* best effort */ }
    await new Promise((r) => setTimeout(r, 1500));
  }
  return stat;
}

/** On-demand full follow-state check (the Sources "Refresh" button). */
async function scanChannels() { return refreshDirectory(); }
function scanStatus() { return lastScan; }

/* ---------------- hands-off auto-setup ---------------- */
async function autoTarget() {
  try {
    if (CH.listActiveTargets().length > 0) return;
    const owners = CH.dirList().filter((c) => c.role === 'OWNER');
    if (owners.length !== 1) return;
    const r = CH.addTarget(owners[0].jid, owners[0].name, 'auto-setup');
    if (r.ok) {
      ring.info('channel.autotarget', `Hands-off setup: your channel "${owners[0].name || owners[0].jid}" was made the TARGET automatically — posts from your sources will be published there. Change it any time in the Targets tab.`);
    }
  } catch { /* best effort */ }
}

/* ---------------- auto-monitor: follow = source ---------------- */
function autoMonitor(newChannels) {
  if (!S.getBool('channels.automonitor', true)) return;
  let added = 0;
  for (const { jid, name } of newChannels) {
    if (CH.listTargets().some((t) => t.jid === jid)) continue; // never mirror a target into itself
    const r = CH.addSource(jid, name, 'auto-follow');
    if (r.ok) added += 1;
  }
  if (added) {
    ring.info('channel.automonitor', `Auto-monitoring ${added} newly followed channel(s) as source(s) — "Auto-monitor" in the Sources tab turns this off`);
    // v6: subscribe every newly added source immediately (the silent-feed bug, killed)
    (async () => {
      for (const { jid } of newChannels) {
        if (!CH.listActiveSources().some((s) => s.jid === jid)) continue;
        await subscribe(jid);
        await new Promise((r) => setTimeout(r, 700));
      }
    })().catch(() => { });
  }
}

function init() {
  let openedOnce = false;

  wa.events.on('wa.open', ({ first }) => {
    subOkUntil.clear();
    openedAt = Date.now();
    notFollowed.clear(); // fresh link → roles re-sync; never trust stale no-role streaks
    const delay = first ? 5000 : 20000;
    const pace = first ? 800 : 3000;
    setTimeout(() => subscribeAll(pace).catch(() => { }), delay).unref?.();
    if (first) {
      startPullPoll();
      // missed-post recovery: catch up on anything published while offline
      setTimeout(() => recoverMissed().catch(() => { }), 40000).unref?.();
      // directory enrichment + auto-target (roles arrive with first sync — two tries)
      setTimeout(() => { refreshDirectory().then(() => autoTarget()).catch(() => { }); }, 15000).unref?.();
      setTimeout(() => { refreshDirectory().then(() => autoTarget()).catch(() => { }); }, 100000).unref?.();
    } else {
      // v6.4: EVERY reconnect re-feeds what was posted while the bot was
      // briefly offline — not just the first boot (P.seen dedupes, so this is free)
      setTimeout(() => recoverMissed().catch(() => { }), 30000).unref?.();
      setTimeout(() => refreshDirectory().catch(() => { }), 60000).unref?.();
    }
    openedOnce = true;
  });

  // new followed channels detected during history sync → auto-monitor
  wa.events.on('directory.changed', ({ fresh } = {}) => {
    if (Array.isArray(fresh) && fresh.length) autoMonitor(fresh);
  });

  /* v7.9.1 — "make my followed channels already appear in Sources,
     automatically": a post arriving from a channel the directory does not
     know about PROVES this account follows it (a linked device only ever
     receives posts from channels it follows). WhatsApp ships no
     list-my-follows query (the 12-query proof in FINAL-REPORT §13), so a
     channel's first post while connected is the reliable live signal.
     Record it with a viewer role and let auto-monitor (on by default, and
     the whole point of this feature) turn it into a Source — exactly the
     same result as following it from Browse, zero clicks. */
  wa.events.on('wa.message', (m) => {
    try {
      const jid = String((m && m.key && m.key.remoteJid) || '');
      if (!jid.endsWith('@newsletter')) return;
      if (CH.listTargets().some((t) => t.jid === jid)) return; // your own channel is the target, never a source
      if (CH.dirList().some((d) => d.jid === jid)) return;    // already known — nothing to detect
      const name = (m.pushName && m.pushName !== jid) ? m.pushName : jid;
      CH.recordDir(jid, name, 'VIEWER');
      ring.info('channel.detected.follow', `Followed channel detected by its posts — "${name}" joined the follow list; auto-monitor adds it to Sources`);
      wa.events.emit('directory.changed', { fresh: [{ jid, name }] });
    } catch { /* detection is best-effort; the pipeline keeps running */ }
  });

  // v6.4 keep-alive for live push: every 60 s, re-subscribe any source whose
  // subscription is missing or about to expire. WhatsApp EXPIRES live-update
  // subscriptions — without this, posts silently degrade to safety-net speed.
  setInterval(async () => {
    const sock = wa.getSocket();
    if (!sock || wa.getStatus().status !== 'open') return;
    const now = Date.now();
    const due = CH.listActiveSources().filter((s) => {
      const until = subOkUntil.get(s.jid) || 0;
      return until < now + 30000; // expired, never-subscribed, or expiring within 30 s
    });
    for (const s of due) {
      await subscribe(s.jid);
      await new Promise((r) => setTimeout(r, 2000));
    }
  }, 60 * 1000).unref?.();

  // periodic follow verification + name sync (every 10 min)
  setInterval(() => refreshDirectory().catch(() => { }), 10 * 60 * 1000).unref?.();

  return {
    subscribe, subscribeAll,
    setAutoMonitor(on) { S.set('channels.automonitor', on ? '1' : '0'); },
    autoMonitorFlag: () => S.getBool('channels.automonitor', true)
  };
}

const autoMonitorFlag = () => S.getBool('channels.automonitor', true);
const setAutoMonitor = (on) => S.set('channels.automonitor', on ? '1' : '0');

/* ---------------- v7.8.0 · Browse: follow channels from the dashboard ---------------- */
/** Resolve a public channel code (invite code) to its jid, via WhatsApp.
    Cache-first (resolved codes never change); a miss asks WhatsApp directly. */
async function browseResolve(code) {
  const sock = wa.getSocket();
  if (!sock || wa.getStatus().status !== 'open') throw new Error('WhatsApp is not connected — link it in the WhatsApp tab first, then follow channels here.');
  const cached = BM.get(code);
  if (cached && cached.jid) return { jid: cached.jid, name: cached.name || '' };
  let meta = null;
  try { meta = await withTimeout(sock.newsletterMetadata('invite', code), 12000); } catch { meta = null; }
  if (!meta || !meta.id) throw new Error('Link not recognised as a WhatsApp channel — open it in WhatsApp to double-check it’s a channel link, then try again.');
  const jid = String(meta.id).includes('@newsletter') ? String(meta.id) : String(meta.id) + '@newsletter';
  if (meta.name) BM.set(code, { name: meta.name, jid, src: 'wa' });
  return { jid, name: meta.name || '' };
}

/** Follow a channel from the dashboard (Browse view). Real
    `newsletterFollow` under the hood; a followed channel is recorded in the
    directory and — like any phone follow — joins Sources while Auto-monitor
    is on (or always, when `addSource` is requested by the button). */
async function browseFollow(linkOrCode, opts = {}) {
  const code = resolveCode(linkOrCode);
  if (!code) throw new Error('Paste a valid channel link (whatsapp.com/channel/…) or a channel code.');
  const { jid, name } = await browseResolve(code);
  const dirRow = CH.dirList().find((d) => d.jid === jid);
  let followed = false;
  if (!(dirRow && dirRow.role)) {
    const sock = wa.getSocket();
    await sock.newsletterFollow(jid);
    followed = true;
    AUD.log('owner', 'browse.follow', `Followed “${name || jid}” from the dashboard (Browse)`);
    ring.info('channel.browse.follow', `Followed “${name || jid}” from the dashboard (Browse)`);
  }
  CH.recordDir(jid, name || (dirRow && dirRow.name) || jid, 'VIEWER');
  /* Browse = discover → monitor: a Follow here ALWAYS makes the channel a
     Source, regardless of the Auto-monitor switch (an explicit user action,
     not an automation). */
  let addedToSources = false;
  if (!CH.listTargets().some((t) => t.jid === jid) && !CH.listSources().some((s) => s.jid === jid)) {
    const r = CH.addSource(jid, name || (dirRow && dirRow.name) || jid, 'browse-follow');
    if (r.ok) { addedToSources = true; subscribe(jid).catch(() => { }); }
  }
  return { ok: true, already: !followed, code, jid, name: name || (dirRow && dirRow.name) || jid, addedToSources, inSources: CH.listSources().some((s) => s.jid === jid) };
}

/** One-click (Sources tab): every channel this account follows on WhatsApp
    that is not a Source (and not a Target) becomes a Source. */
function syncFollowed() {
  const added = [];
  for (const d of CH.dirList()) {
    if (!d.role) continue;
    if (CH.listTargets().some((t) => t.jid === d.jid)) continue;
    if (CH.listSources().some((s) => s.jid === d.jid)) continue;
    const r = CH.addSource(d.jid, d.name || d.jid, 'sync-followed');
    if (r.ok) {
      added.push(d.name || d.jid);
      subscribe(d.jid).catch(() => { });
    }
  }
  if (added.length) {
    AUD.log('owner', 'sources.sync-followed', `Added ${added.length} followed channel(s) to Sources from the Sources tab`);
    ring.info('channel.sync.followed', `Added ${added.length} followed channel(s) to Sources`);
  }
  return added;
}

/** Unfollow a channel from the dashboard. Accepts a public code or a jid.
    Removes it from Sources at once (the 10-minute follow-verification scan
    would also catch it). */
async function browseUnfollow(ref) {
  const sock = wa.getSocket();
  let jid = String(ref || '');
  if (jid && !jid.includes('@newsletter')) jid = (await browseResolve(ref)).jid;
  if (!jid) throw new Error('Paste a valid channel link (whatsapp.com/channel/…) or a channel code.');
  if (!sock || wa.getStatus().status !== 'open') throw new Error('WhatsApp is not connected — you can unfollow from the WhatsApp app instead.');
  const name = (CH.dirList().find((d) => d.jid === jid) || {}).name || jid;
  await sock.newsletterUnfollow(jid);
  notFollowed.set(jid, 2); // next periodic scan confirms the absence
  const wasSource = CH.listSources().some((s) => s.jid === jid);
  if (wasSource) {
    CH.removeSource(jid);
    AUD.log('owner', 'sources.unfollow-removed', `Stopped following “${name}” from the dashboard — removed from Sources`);
  }
  AUD.log('owner', 'browse.unfollow', `Unfollowed “${name}” from the dashboard (Browse)`);
  ring.warn('channel.unfollowed', `No longer following “${name}” — removed it from Sources`);
  return { ok: true, jid, name, removedFromSources: wasSource };
}

/** Add an already-followed channel to Sources (works even with Auto-monitor
    off). Accepts a public code or a jid. */
async function browseAddSource(ref) {
  let jid = String(ref || '');
  if (jid && !jid.includes('@newsletter')) jid = (await browseResolve(ref)).jid;
  const dirRow = CH.dirList().find((d) => d.jid === jid);
  if (!dirRow) throw new Error('Channel not found — follow it first, then add it to Sources.');
  if (CH.listTargets().some((t) => t.jid === jid)) throw new Error('That channel is one of your TARGETS — it can’t be mirrored as its own source.');
  const r = CH.addSource(jid, dirRow.name || jid, 'browse-add');
  if (!r.ok) return { ok: true, already: true, jid, name: dirRow.name || jid };
  subscribe(jid).catch(() => { });
  AUD.log('owner', 'browse.add-source', `Added “${dirRow.name || jid}” to Sources from the dashboard (Browse)`);
  ring.info('channel.automonitor', `Manually added “${dirRow.name || jid}” as a source (Browse)`);
  return { ok: true, already: false, jid, name: dirRow.name || jid };
}

module.exports = { init, subscribe, autoMonitor, autoMonitorFlag, setAutoMonitor, catchUp, missedList, recoverMissed, scanChannels, scanStatus, unfollowDecision, refreshDirectory, browseFollow, browseUnfollow, browseAddSource, browseResolve, syncFollowed };
