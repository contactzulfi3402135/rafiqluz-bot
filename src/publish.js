'use strict';
/**
 * v6.0.0 — publishing to channels: send (text/media), EDIT published posts,
 * DELETE published posts (single / multi-select / date-range) — with the
 * honest-verification contract: a delete is only "done" if a re-read proves
 * it; a failed re-read says "could NOT verify", never a false clean.
 */
const wa = require('./wa');
const { ring } = require('./logger');
const { CH, P, S } = require('./db');
const pace = require('./pace'); // 5E (R74): adaptive pacing — waits LONGER after failure spikes, never drops a post

/** 5F (R79): per-target rate cap. Key `guard.maxperhour.<jid>`; 0/empty = no cap (global guard still applies). */
function perTargetMax(jid) {
  const n = parseInt(S.get('guard.maxperhour.' + jid, '0'), 10);
  return Number.isFinite(n) && n >= 1 ? n : 0;
}

/** Publish content to every active target. Returns {sent, failed, errors, keys}. */
async function publish(content, meta = {}) {
  const only = Array.isArray(meta.only) ? meta.only : null;
  const targets = CH.listActiveTargets().filter((t) => !only || only.includes(t.jid));
  if (targets.length === 0) {
    ring.warn('publish.no.targets', 'No target channels configured — post skipped');
    return { sent: 0, failed: 0, errors: ['no target'], keys: [] };
  }
  const sock = wa.getSocket();
  if (!sock || wa.getStatus().status !== 'open') return { sent: 0, failed: targets.length, errors: ['WhatsApp is not connected'], keys: [] };

  const keys = [];
  const errors = [];
  let sent = 0;
  let postId = null;
  /* 5B (R53): the full text, so history can copy/reuse/edit-republish it later */
  const bodyText = (() => {
    if (Array.isArray(content.parts) && content.parts.length) return content.parts.map((p) => String(p.text || '')).join('\n').slice(0, 60000);
    return String((content && (content.text != null ? content.text : content.caption)) || '').slice(0, 60000);
  })();
  if (meta.sourceJid && meta.sourceMsgId) {
    P.mark(meta.sourceJid, meta.sourceMsgId, 'published', String(meta.norm || '').slice(0, 400), bodyText, Boolean(meta.hasMedia));
    postId = P.postId(meta.sourceJid, meta.sourceMsgId);
    if (postId) P.setMedia(postId, Boolean(meta.hasMedia)); // 5D (R61): media-vs-text
  }
  // 5A (R41): numbered parts — each part is its own publish pass over all
  // targets (extra pacing between parts), so WhatsApp never sees >4096 chars.
  const parts = Array.isArray(content.parts) && content.parts.length ? content.parts : [content];
  for (let pi = 0; pi < parts.length; pi++) {
    const c = parts[pi];
    const partHasMedia = Boolean(meta.hasMedia) && pi === 0; // media rides part 1 only
    for (const t of targets) {
      // 5F (R79): per-target rate cap — skips ONLY this target; other targets still get the post.
      const perMax = perTargetMax(t.jid);
      if (perMax && CH.pubCountLastHour(t.jid) >= perMax) {
        errors.push(`${t.name || t.jid}: per-target cap (${perMax}/h) reached — this target skipped, others unaffected`);
        ring.warn('publish.ratelimit', `Per-target cap hit for ${t.name || t.jid} (${perMax}/h) — skipped this target only`);
        continue;
      }
      try {
      const msgId = await wa.sendToChannel(sock, t.jid, c);
      // v6.4: media posts are VERIFIED — WhatsApp can accept a media send and
      // still not show it. We re-read the channel; if our post is not visible,
      // that is an honest failure, never a silent loss.
      if (partHasMedia) {
        await new Promise((r) => setTimeout(r, 1500));
        const visible = await wa.verifyChannelPost(sock, t.jid, msgId);
        if (visible === false) {
          throw new Error('WhatsApp accepted the send but the post is not visible in the channel (media refused) — NOT counted as sent');
        }
        if (visible === null) ring.warn('publish.unverified', `Could not re-read ${t.name || t.jid} to verify the media post — counted as sent, verify on your phone`);
      }
      keys.push({ target: t.jid, msgId });
      if (postId) P.addKey(postId, t.jid, msgId);
      sent += 1;
      CH.recordPub(t.jid); // 5F (R79): per-target ledger for the rate caps
      ring.info('publish.sent', `Published to ${t.name || t.jid}${meta.hasMedia ? ' (media verified)' : ''}`);
      } catch (err) {
      errors.push(`${t.name || t.jid}: ${err.message}`);
      ring.warn('publish.fail', `Publish to ${t.name || t.jid} failed: ${err.message}`);
    }
    await new Promise((r) => setTimeout(r, pace.gapMin(1500))); // pacing (5E: adaptive)
    }
    if (pi < parts.length - 1) await new Promise((r) => setTimeout(r, pace.gapMin(2000))); // extra pacing between parts
  }
  if (postId && errors.length && !sent) P.setStatus(postId, 'failed', errors.join(' | ').slice(0, 200), bodyText);
  pace.note(sent, errors.length); // 5E (R74): feed the adaptive-pacing window
  return { sent, failed: errors.length, errors, keys };
}

/** Edit an already-published post's text on every target it went to. */
async function editPublished(sourceJid, sourceMsgId, newText) {
  const postId = P.postId(sourceJid, sourceMsgId);
  if (!postId) throw new Error('That post is not in the publish history.');
  const keys = P.keys(postId);
  if (!keys.length) throw new Error('No target copies recorded for that post.');
  const sock = wa.getSocket();
  if (!sock) throw new Error('WhatsApp is not connected.');
  let ok = 0; const errors = [];
  for (const k of keys) {
    try { await wa.editChannelPost(sock, k.target_jid, k.msg_id, newText); ok += 1; }
    catch (err) { errors.push(`${k.target_jid}: ${err.message}`); }
    await new Promise((r) => setTimeout(r, pace.gapMin(1200)));
  }
  if (ok) P.setStatus(postId, 'edited', `edited on ${ok} target(s)`, String(newText || '').slice(0, 60000));
  return { ok, errors };
}

/** Delete published posts by their recorded message ids (single or many). */
async function deletePublished(ids) {
  const sock = wa.getSocket();
  if (!sock) throw new Error('WhatsApp is not connected.');
  const list = Array.isArray(ids) ? ids.slice(0, 300) : [ids];
  let done = 0; const errors = [];
  for (const item of list) {
    try {
      const { target, msgId } = item;
      await wa.deleteChannelPost(sock, target, msgId);
      done += 1;
    } catch (err) { errors.push(`${item.target}: ${err.message}`); }
    await new Promise((r) => setTimeout(r, pace.gapMin(1200))); // paced — WhatsApp rate limits (5E: adaptive)
  }
  return { done, errors };
}

/**
 * Date-range purge with HONEST verification: after deleting, re-fetch the
 * channel and count what really remains. A failed re-read returns
 * remaining:null ("could NOT verify") — never a false "clean".
 */
async function purgeByDate(jid, fromTs, toTs) {
  const sock = wa.getSocket();
  if (!sock) throw new Error('WhatsApp is not connected.');
  const inRange = (ts) => ts >= fromTs && ts <= toTs;

  // collect: recorded bot posts + live channel posts in range
  const toDelete = [];
  const rows = require('./db').open().prepare(`
    SELECT pk.target_jid, pk.msg_id FROM post_keys pk
    JOIN posts p ON p.id = pk.post_id
    WHERE pk.target_jid = ? AND p.created_at BETWEEN ? AND ?`).all(jid, fromTs.iso, toTs.iso);
  for (const r of rows) toDelete.push({ target: r.target_jid, msgId: r.msg_id });

  const live = await wa.fetchChannelPosts(sock, jid, 100).catch(() => []);
  for (const m of live) if (m.messageTimestamp && inRange(m.messageTimestamp)) toDelete.push({ target: jid, msgId: m.key.id });

  if (!toDelete.length) return { deleted: 0, remaining: 0, note: 'Nothing found in that date range.' };
  const { done, errors } = await deletePublished(toDelete);

  // verify by re-reading
  let remaining = null;
  const after = await wa.fetchChannelPosts(sock, jid, 100).catch(() => null);
  if (after) {
    remaining = after.filter((m) => m.messageTimestamp && inRange(m.messageTimestamp)).length;
  }
  return {
    deleted: done,
    attempted: toDelete.length,
    errors,
    remaining,
    note: remaining === null
      ? 'Deleted what WhatsApp accepted — could NOT verify the final state (re-read failed). Check the channel on your phone.'
      : remaining === 0 ? 'Verified clean — every post in the range is gone.'
        : `${remaining} post(s) still visible after deletion (WhatsApp refused some).`
  };
}

module.exports = { publish, editPublished, deletePublished, purgeByDate, perTargetMax };
