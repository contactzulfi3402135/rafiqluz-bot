'use strict';
/**
 * 5A (v7.7.0) — the hold & approval queue.
 * R37: per-source "approve first" + global delay buffer (hold N minutes, cancellable).
 * R43: Live Queue = pending / processing / failed right now, with retry + dismiss.
 * R47: failed posts stay until retried or dismissed; boot recovery pass is visible.
 * R48: "delete last published post" per target (confirm at the UI) + audit.
 *
 * The queue publishes through the SAME publishMod.publish() the pipeline uses —
 * media verification, pacing and honest failures all stay exactly as before.
 */
const fs = require('fs');
const path = require('path');
const cfg = require('./config');
const { ring } = require('./logger');
const { S, Q, P, CH, AUD, LAT } = require('./db');
const publishMod = require('./publish');
const wa = require('./wa');

/* held media lives next to the database (both are persisted state) */
const HOLD_DIR = path.join(path.dirname(cfg.config.paths.database), 'media-hold');

/* ---------- hold media on disk (respect the same caps as the rest of the bot) ---------- */
function storeMedia(id, buf, kind) {
  try {
    fs.mkdirSync(HOLD_DIR, { recursive: true });
    const ext = kind === 'video' ? '.mp4' : kind === 'document' ? '.bin' : '.jpg';
    const p = path.join(HOLD_DIR, `${id}${ext}`);
    fs.writeFileSync(p, buf);
    return p;
  } catch (e) { ring.warn('queue.media.fail', `Could not hold media for queue item ${id}: ${e.message}`); return ''; }
}
function localMediaPath(p) { const name = path.basename(String(p || '')); return /^\d+\.(jpg|mp4|bin)$/.test(name) ? path.join(HOLD_DIR,name) : ''; }
function readMedia(p) { try { const f=localMediaPath(p); return f && fs.existsSync(f) ? fs.readFileSync(f) : null; } catch { return null; } }
function delMedia(p) { try { const f=localMediaPath(p); if (f && fs.existsSync(f)) fs.unlinkSync(f); } catch { } }

/* cleanup: held media for settled items older than 7 days */
function pruneHold() {
  try {
    fs.mkdirSync(HOLD_DIR, { recursive: true });
    const now = Date.now();
    for (const f of fs.readdirSync(HOLD_DIR)) {
      const st = fs.statSync(path.join(HOLD_DIR, f));
      const full = path.join(HOLD_DIR, f);
      const itemId = Number(f.split('.')[0]);
      const ref = require('./db').open().prepare("SELECT 1 FROM approvals WHERE id=? AND status NOT IN ('published','rejected') LIMIT 1").get(itemId);
      if (!ref && now - st.mtimeMs > 7 * 86400e3) fs.unlinkSync(full);
    }
  } catch { }
}

/** Queue one post (called by the pipeline instead of publishing directly).
    targetJids = the EXACT target set the pipeline computed (mapping + routing +
    matrix), so a held post publishes to the same place it would have. */
function enqueue({ sourceJid, sourceMsgId, text, mediaBuf, mediaKind, mediaMime, msgTs = 0, targetJids = [], requireApproval = false }) {
  const delayMin = Math.max(0, Math.min(1440, parseInt(S.get('queue.delay.min', '0'), 10) || 0));
  const holdUntil = !requireApproval && delayMin > 0 ? new Date(Date.now() + delayMin * 60000).toISOString() : '';
  const id = Q.add({ source_jid: sourceJid, source_msg_id: sourceMsgId, text, media_kind: mediaKind || '', hold_until: holdUntil, msg_ts: msgTs || 0, targets: (targetJids || []).join(',') });
  if (!id) throw new Error('queue insert failed');
  const p = mediaBuf ? storeMedia(id, mediaBuf, mediaKind) : '';
  if (mediaBuf && !p) { require('./db').open().prepare('DELETE FROM approvals WHERE id=?').run(id); throw new Error('Could not store queued media; no post was sent.'); }
  try { require('./db').open().prepare('UPDATE approvals SET media_path=? WHERE id=?').run(p, id); } catch { }
  P.mark(sourceJid, sourceMsgId, 'queued', 'waiting in approval queue', String(text || '').slice(0, 60000));
  const pid = P.postId(sourceJid, sourceMsgId);
  if (pid) { try { require('./db').open().prepare("UPDATE posts SET queued_at=datetime('now') WHERE id=?").run(pid); } catch { } }
  AUD.log('pipeline', 'post.queued', `Post from ${sourceJid} entered the queue (${delayMin ? `hold ${delayMin} min` : 'approve first'})`);
  ring.info('post.queued', `Post held in the approval queue (${String(text || '').slice(0, 60)}${String(text || '').length > 60 ? '…' : ''})`);
  tick().catch(() => { }); // a zero-delay buffer publishes on the next pass anyway
  return id;
}

/** Re-publish one queued item through the normal publisher. */
async function release(id) {
  if (require('./lifecycle').isStopping()) return null;
  const row = Q.one(id);
  if (!row || (row.status !== 'pending' && row.status !== 'approved')) return null;
  const now = Date.now();
  // the hold buffer only gates PENDING items — an explicit owner approval publishes now (cancellable hold)
  if (row.status === 'pending' && (!row.hold_until || !Number.isFinite(Date.parse(row.hold_until)) || Date.parse(row.hold_until) > now)) return 'held';
  const d = require('./db').open();
  if (require('./delivery-ledger').hasLegacyCopies(row.source_jid,row.source_msg_id)) { Q.setStatus(id,'failed','Older recorded copies need manual checking; use republish only after reviewing destinations.'); const pid=P.postId(row.source_jid,row.source_msg_id); if (pid) P.setStatus(pid,'failed','Older recorded copies need manual checking before any resend.'); return 'done'; }
  const claimed = d.prepare("UPDATE approvals SET status='processing' WHERE id=? AND status=?").run(id, row.status);
  if (!claimed.changes) return null;
  try {
    const mediaBuf = readMedia(row.media_path);
    if (row.media_kind && !mediaBuf) throw new Error('Queued media is missing. No text-only substitute was sent; restore the media or discard.');
    const hasMedia = Boolean(mediaBuf) && row.media_kind;
    const content = hasMedia
      ? (row.media_kind === 'video'
        ? { video: mediaBuf, caption: row.text }
        : row.media_kind === 'document'
          ? { document: mediaBuf, caption: row.text, mimetype: 'application/octet-stream', fileName: 'file' }
          : { image: mediaBuf, caption: row.text, mimetype: 'image/jpeg' })
      : { text: row.text };
    const t0 = Date.now();
    const only = String(row.targets || '').split(',').map((x) => x.trim()).filter(Boolean);
    const res = await publishMod.publish(content, {
      sourceJid: row.source_jid, sourceMsgId: row.source_msg_id,
      only: only.length ? only : null, hasMedia,
      norm: String(row.text || '').slice(0, 400)
    });
    const ms = Date.now() - t0;
      if (res.complete) {
      Q.setStatus(id, 'published', `sent to ${res.sent} target(s)`);
      const pid = P.postId(row.source_jid, row.source_msg_id);
      if (pid) {
        P.setStatus(pid, 'published', String(row.text || '').slice(0, 400), String(row.text || ''));
        /* R46: honest latency = original source post time → actual publish time (hold included) */
        const latMs = row.msg_ts ? Math.max(1000, Date.now() - row.msg_ts * 1000) : ms;
        LAT.record(pid, latMs);
      }
      AUD.log('queue', 'post.published', `Queue item ${id} published (${res.sent} targets, ${Math.round(ms / 1000)}s)`);
      ring.info('queue.published', `Approval queue: post published to ${res.sent} target(s)`);
      delMedia(row.media_path);
      /* v9.0.0 (owner policy): also delete the inbox copy of the source post's
         media — the media is in the target channel now, nothing kept locally. */
      if (hasMedia) { try { require('./db').IB.clearMediaForMsg('main', row.source_jid, row.source_msg_id); ring.info('queue.media.cleaned', `Post media deleted right after publishing (${row.media_kind}) — it lives in the target channel now`); } catch { } }
    } else {
      Q.setStatus(id, 'failed', (res.errors || []).join(' | ').slice(0, 200));
      const pid = P.postId(row.source_jid, row.source_msg_id);
      if (pid) P.setStatus(pid, 'failed', (res.errors || []).join(' | ').slice(0, 200), String(row.text || ''));
      AUD.log('queue', 'post.failed', `Queue item ${id} failed: ${(res.errors || []).join(' | ').slice(0, 200)}`);
      ring.warn('queue.failed', `Approval queue: publish failed — ${(res.errors || [])[0] || 'unknown'}`);
      require('./alerts').maybe('failed', 'A queued post failed to publish', (res.errors || [])[0] || 'unknown'); // 5D (R65)
    }
  } catch (err) {
    Q.setStatus(id, 'failed', err.message.slice(0, 200));
    const pid = P.postId(row.source_jid, row.source_msg_id);
    if (pid) P.setStatus(pid, 'failed', String(err.message).slice(0,200));
    AUD.log('queue', 'post.failed', `Queue item ${id}: ${err.message}`);
  }
  return 'done';
}

/** The 15 s pump: release what may run now. */
let ticking = false;
async function tick() {
  if (ticking || require('./lifecycle').isStopping()) return;
  ticking = true;
  try {
    if (require('./panic').active()) return; // 5E (R73): panic stop freezes the pump — items stay pending
    for (const row of Q.pending(50)) {
      if (row.status === 'pending' && (!row.hold_until || !Number.isFinite(Date.parse(row.hold_until)) || Date.parse(row.hold_until) > Date.now())) continue;
      await release(row.id);
      const extra = Math.max(0, require('./pace').gapMin(1500) - 1500); // 5E (R74): adaptive backoff between items
      if (extra) await new Promise((r) => setTimeout(r, extra));
    }
    Q.trimOld(7);
  } finally { ticking = false; }
}
function start() {
  // Previous process may have stopped after sending; never auto-replay it.
  const d = require('./db').open();
  // Older versions did not distinguish approval drafts from timed holds.
  d.prepare("UPDATE approvals SET hold_until='' WHERE status='pending' AND (source_jid='plan@bot' OR source_jid IN (SELECT source_jid FROM source_rules WHERE approve_first=1))").run();
  const stranded = d.prepare("SELECT * FROM approvals WHERE status='processing'").all();
  for (const row of stranded) {
    Q.setStatus(row.id, 'failed', 'Interrupted during publishing; review delivery outcomes before retry.');
    const pid = P.postId(row.source_jid,row.source_msg_id);
    if (pid) P.setStatus(pid, 'failed', 'Interrupted during publishing; review delivery outcomes before retry.');
  }
  setInterval(() => { tick().catch(() => { }); pruneHold(); }, 15000).unref?.(); }

/* ---------- owner actions ---------- */
function pendingCount() { try { return Q.pending(500).filter((q) => q.status === 'pending').length; } catch { return 0; } }
function editText(id, text) { const r = Q.one(id); if (!r) throw new Error('Item not found.'); Q.edit(id, String(text || '').slice(0, 20000)); }

function approve(id, note) { const r = Q.one(id); if (!r) throw new Error('Item not found.'); if (r.status !== 'pending') throw new Error('Item already decided.'); Q.setStatus(id, 'approved', note || 'approved by owner'); AUD.log('owner', 'queue.approve', `Approved queue item ${id} (${String(r.text || '').slice(0, 60)})`); ring.info('queue.approve', `Approved: ${String(r.text || '').slice(0, 50)}`); tick().catch(() => { }); return Q.one(id); }
function reject(id, note) { const r = Q.one(id); if (!r) throw new Error('Item not found.'); if (r.status !== 'pending') throw new Error('Item already decided.'); Q.setStatus(id, 'rejected', note || 'rejected by owner'); AUD.log('owner', 'queue.reject', `Rejected queue item ${id}`); delMedia(r.media_path); const pid = P.postId(r.source_jid, r.source_msg_id); if (pid) P.setStatus(pid, 'skipped', 'rejected in approval queue'); return Q.one(id); }
function approveAll() { let n = 0; for (const r of Q.pending(200)) { try { if (r.status === 'pending') { Q.setStatus(r.id, 'approved', 'approved all by owner'); n += 1; } } catch { } } if (n) AUD.log('owner', 'queue.approve-all', `Approved ${n} queued posts`); tick().catch(() => { }); return n; }
function dismiss(id) { const r = Q.one(id); if (!r) throw new Error('Item not found.'); Q.setStatus(id, 'failed', 'dismissed by owner'); const pid = P.postId(r.source_jid, r.source_msg_id); if (pid) { try { require('./db').open().prepare('UPDATE posts SET dismissed=1 WHERE id=?').run(pid); } catch { } } AUD.log('owner', 'queue.dismiss', `Dismissed queue item ${id}`); return Q.one(id); }
function retry(id) { const r = Q.one(id); if (!r) throw new Error('Item not found.'); if (r.status !== 'failed') throw new Error('Only failed items can be retried.'); if (require('./delivery-ledger').hasLegacyCopies(r.source_jid,r.source_msg_id)) throw new Error('Older recorded copies need manual checking; retry is disabled to avoid duplicates.'); if (require('./delivery-ledger').hasUnresolved(r.source_jid,r.source_msg_id)) throw new Error('Review uncertain deliveries first to avoid duplicates.'); require('./db').open().prepare("UPDATE approvals SET status='approved', hold_until='', note='' WHERE id=?").run(id); AUD.log('owner', 'queue.retry', `Retried queue item ${id}`); tick().catch(() => { }); return Q.one(id); }

/* ---------- R43: Live Queue view data ---------- */
function liveView() {
  const d = require('./db').open();
  const queue = Q.pending(200);
  const failed = d.prepare("SELECT p.*, (SELECT MAX(a.id) FROM approvals a WHERE a.source_jid=p.source_jid AND a.source_msg_id=p.source_msg_id AND a.status='failed') queue_id FROM posts p WHERE p.status='failed' AND p.dismissed=0 ORDER BY p.id DESC LIMIT 100").all();
  const queued = d.prepare("SELECT COUNT(*) n FROM posts WHERE status='queued'").get().n;
  const processing = d.prepare("SELECT COUNT(*) n FROM approvals WHERE status='processing'").get().n;
  const reasons = {};
  for (const f of failed) {
    const key = String(f.reason || 'unknown').split(':')[0].slice(0, 40) || 'unknown';
    (reasons[key] = reasons[key] || []).push({ id: f.id, when: f.created_at, source: f.source_jid, reason: f.reason || '', snippet: String(f.reason || '').slice(0, 80) });
  }
  return {
    pending: queue.filter((q) => q.status === 'pending').map((q) => ({ ...q, text: String(q.text || '') })),
    approved: queue.filter((q) => q.status === 'approved').map((q) => ({ ...q, text: String(q.text || '') })),
    processing, queued,
    failed: failed.map((f) => ({ id: f.id, when: f.created_at, source_jid: f.source_jid, source_msg_id: f.source_msg_id, queue_id: f.queue_id, reason: f.reason || '' })),
    failedGrouped: Object.fromEntries(Object.entries(reasons).map(([k, v]) => [k, { n: v.length, items: v }])),
    delayMin: Math.max(0, Math.min(1440, parseInt(S.get('queue.delay.min', '0'), 10) || 0)),
    recovery: S.get('recovery.last', ''),
    latency: LAT.stats(7)
  };
}

/* ---------- R43/R47/R53: retry failed posts (re-feed through the real pipeline) ---------- */
async function refeedOne(f) {
  if (String(f.source_jid).startsWith('system:') || String(f.source_jid).endsWith('@bot')) throw new Error('This is not a source-channel post; inspect the destination and deliberately compose again if needed.');
  if (require('./delivery-ledger').hasLegacyCopies(f.source_jid,f.source_msg_id)) throw new Error('Older recorded copies need manual checking; retry is disabled to avoid duplicates.');
  if (require('./delivery-ledger').hasUnresolved(f.source_jid,f.source_msg_id)) throw new Error('Review uncertain deliveries first to avoid duplicates.');
  const sock = wa.getSocket();
  if (!sock || wa.getStatus().status !== 'open') throw new Error('WhatsApp is not connected — the post stays in the queue and will be retried on reconnect.');
  const posts = await wa.fetchChannelPosts(sock, f.source_jid, 50).catch(() => []);
  const found = (posts || []).find((x) => x?.key?.id === f.source_msg_id);
  if (!found) throw new Error('The original post is no longer on the source channel (deleted, or older than the 50-post fetch range) — cannot re-feed it.');
  const d = require('./db').open();
  d.prepare("DELETE FROM posts WHERE id=?").run(f.id); // clear the seen-mark; re-intake re-records it
  await require('./pipeline').intake(found);
  return true;
}
async function retryOneFailed(postId) {
  const f = require('./db').open().prepare("SELECT id, source_jid, source_msg_id FROM posts WHERE id=? AND status='failed'").get(Number(postId));
  if (!f) throw new Error('Only failed posts can be retried.');
  const queued = require('./db').open().prepare("SELECT id,status FROM approvals WHERE source_jid=? AND source_msg_id=? ORDER BY id DESC LIMIT 1").get(f.source_jid,f.source_msg_id);
  if (queued) {
    if (queued.status !== 'failed') throw new Error('This post has a queue item that is not failed; manage it in the Approval queue.');
    retry(queued.id); return {ok:true, queued:true};
  }
  await refeedOne(f);
  AUD.log('owner', 'post.retry', `Retried failed post ${f.id} through the pipeline`);
  ring.info('post.retry', `Failed post ${f.id} re-fed through the pipeline`);
  return { ok: true };
}
async function retryAllFailed() {
  const d = require('./db').open();
  const failed = d.prepare("SELECT p.id, p.source_jid, p.source_msg_id FROM posts p WHERE p.status='failed' AND p.dismissed=0 AND p.source_jid NOT LIKE 'system:%' AND p.source_jid NOT LIKE '%@bot' AND NOT EXISTS (SELECT 1 FROM approvals a WHERE a.source_jid=p.source_jid AND a.source_msg_id=p.source_msg_id) ORDER BY p.id ASC LIMIT 100").all();
  let retried = 0; const skipped = [];
  for (const f of failed) {
    try { await refeedOne(f); retried += 1; } catch { skipped.push(f.id); }
    await new Promise((r) => setTimeout(r, 1500));
  }
  AUD.log('owner', 'queue.retry-all', `Retried ${retried} failed post(s), ${skipped.length} not re-found on the channel`);
  ring.info('queue.retry-all', `Retried ${retried} failed post(s) through the pipeline`);
  return { retried, skipped: skipped.length, note: skipped.length && !retried ? 'None could be re-found on the source channels — see the individual errors.' : '' };
}

/* ---------- 5B (R53): edit-republish — push stored (or new) text to the
   targets that source is routed to RIGHT NOW (mapping + routing + matrix). ---------- */
async function republishOne(postId, newText) {
  const d = require('./db').open();
  const row = d.prepare('SELECT * FROM posts WHERE id=?').get(Number(postId));
  if (!row) throw new Error('Post not found.');
  const text = (newText != null && String(newText).trim() ? String(newText) : (row.body || row.reason || '')).trim();
  if (!text) throw new Error('No text is stored for that post — paste the text you want to publish.');
  const sock = wa.getSocket();
  if (!sock || wa.getStatus().status !== 'open') throw new Error('WhatsApp is not connected.');
  let targets = CH.listActiveTargets();
  const src = CH.listSources().find((s) => s.jid === row.source_jid);
  const mapped = src ? String(src.targets || '').trim() : '';
  if (mapped) targets = targets.filter((t) => mapped.split(',').map((x) => x.trim()).filter(Boolean).includes(t.jid));
  targets = targets.filter((t) => require('./pipeline').routeAllowed(t, { text, hasMedia: false }));
  if (!targets.length) throw new Error('No target is currently allowed for that source (mapping/routing) — nothing was published.');
  const res = await publishMod.publish({ text: text.slice(0, 60000) }, {
    sourceJid: row.source_jid, sourceMsgId: row.source_msg_id,
    deliverySource: 'republish@bot', deliveryMessage: require('crypto').randomUUID(),
    only: targets.map((t) => t.jid), hasMedia: false, norm: text.slice(0, 400)
  });
  if (res.sent) AUD.log('owner', 'post.republish', `Post ${row.id} republished to ${res.sent} target(s)${newText ? ' with edited text' : ''}`);
  return { sent: res.sent, failed: res.failed, errors: res.errors };
}

/* ---------- R47: boot recovery pass with visible results ---------- */
function recordRecovery(summary) {
  const s = { ...summary, at: new Date().toISOString() };
  S.set('recovery.last', JSON.stringify(s));
  ring.info('recovery.pass', `Boot recovery pass: ${s.recovered || 0} post(s) recovered, ${s.failed || 0} failed, ${s.skipped || 0} skipped`);
  return s;
}

/* ---------- R48: undo — delete the last published post on ONE target ---------- */
async function undoLast(targetJid) {
  const d = require('./db').open();
  /* post_keys has no id column — the stable tie-breaker is post_id (newer posts
     get higher ids), so at DESC + post_id DESC is a total order. */
  const row = d.prepare(`SELECT pk.post_id, pk.msg_id, p.source_jid, p.source_msg_id, p.created_at
    FROM post_keys pk JOIN posts p ON p.id = pk.post_id
    WHERE pk.target_jid = ? AND p.status IN ('published','edited')
    ORDER BY pk.at DESC, pk.post_id DESC LIMIT 1`).get(String(targetJid));
  if (!row) throw new Error('No published post found on that target to undo.');
  const sock = wa.getSocket();
  if (!sock || wa.getStatus().status !== 'open') throw new Error('WhatsApp is not connected — cannot undo.');
  await wa.deleteChannelPost(sock, targetJid, row.msg_id);
  d.prepare("UPDATE post_keys SET msg_id='undone' WHERE post_id=? AND target_jid=?").run(row.post_id, targetJid);
  AUD.log('owner', 'post.undo', `Deleted the last published post on ${targetJid} (source ${row.source_jid}, msg ${row.source_msg_id})`);
  ring.info('post.undo', `Undo: last post deleted from ${targetJid}`);
  return { ok: true, postId: row.post_id };
}

/** 5I (I10): the resend rate guard — checked BEFORE anything is sent.
    Returns { ok: true } or { ok: false, error } with the honest reason. */
function checkResendGuard(postRow) {
  const d = require('./db');
  const max = Math.max(3, parseInt(d.S.get('guard.maxperhour', '30'), 10) || 30);
  if (d.CH.publishedLastHour() >= max) {
    return { ok: false, error: `Rate guard: ${max} posts already published this hour — resend refused to protect the channel.` };
  }
  const src = d.CH.listSources().find((s) => s.jid === postRow.source_jid);
  const mapped = src ? String(src.targets || '').trim() : '';
  let targets = d.CH.listActiveTargets();
  if (mapped) targets = targets.filter((t) => mapped.split(',').map((x) => x.trim()).filter(Boolean).includes(t.jid));
  const per = require('./publish').perTargetMax;
  const hot = targets.filter((t) => {
    const cap = per(t.jid);
    if (!cap) return false;
    const n = d.open().prepare(
      `SELECT COUNT(*) c FROM post_keys k JOIN posts p ON p.id=k.post_id WHERE k.target_jid=? AND k.at >= datetime('now','-1 hour') AND p.status IN ('published','edited')`
    ).get(t.jid)?.c || 0;
    return n >= cap;
  });
  if (hot.length) return { ok: false, error: `Rate guard: ${hot.length} target(s) hit their per-target cap this hour — resend refused.` };
  return { ok: true };
}

/** 5I (I9): row-level undo — ONLY when this exact post is the latest on the
    target; otherwise an honest refusal (the global Undo stays the safe path). */
async function undoPostOn(postId, targetJid) {
  const d = require('./db').open();
  const latest = d.prepare(`SELECT pk.post_id FROM post_keys pk JOIN posts p ON p.id = pk.post_id
    WHERE pk.target_jid = ? AND p.status IN ('published','edited') ORDER BY pk.at DESC, pk.post_id DESC LIMIT 1`).get(String(targetJid));
  if (!latest) throw new Error('Nothing published on that target to undo.');
  if (Number(latest.post_id) !== Number(postId)) throw new Error('This post is not the latest on that target — use the global Undo card so nothing else gets caught up in it.');
  return undoLast(targetJid);
}

module.exports = { enqueue, release, tick, start, approve, reject, approveAll, dismiss, retry, liveView, pendingCount, editText, retryOneFailed, retryAllFailed, republishOne, recordRecovery, undoLast, undoPostOn, checkResendGuard, pruneHold };
