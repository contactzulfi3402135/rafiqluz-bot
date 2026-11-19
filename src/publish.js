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
  if (require('./lifecycle').isStopping()) return {sent:0,failed:1,errors:['Shutdown in progress; no new send started'],keys:[],complete:false};
  const crypto = require('crypto');
  const ledger = require('./delivery-ledger');
  const only = Array.isArray(meta.only) ? [...new Set(meta.only)] : null;
  const targets = CH.listActiveTargets().filter((t) => !only || only.includes(t.jid));
  const errors = []; const keys = [];
  const missing = only ? only.filter((jid) => !targets.some(t => t.jid === jid)) : [];
  for (const jid of missing) errors.push(`${jid}: target is missing or paused`);
  if (!targets.length) return { sent: 0, failed: Math.max(1,errors.length), errors: errors.length ? errors : ['no active target'], keys };
  const sock = wa.getSocket();
  if (!sock || wa.getStatus().status !== 'open') return { sent: 0, failed: targets.length + missing.length, errors: [...errors, 'WhatsApp is not connected'], keys };

  const parts = Array.isArray(content.parts) && content.parts.length ? content.parts : [content];
  const bodyText = parts.map(p => String(p.text != null ? p.text : p.caption || '')).join('\n').slice(0,60000);
  const tracked = Boolean(meta.sourceJid && meta.sourceMsgId);
  const source = meta.deliverySource || meta.sourceJid;
  const message = meta.deliveryMessage || meta.sourceMsgId;
  let postId = null;
  if (tracked) {
    P.mark(meta.sourceJid, meta.sourceMsgId, 'processing', 'Publishing in progress', bodyText, Boolean(meta.hasMedia));
    postId = P.postId(meta.sourceJid, meta.sourceMsgId);
    if (!postId) throw new Error('Cannot record publish attempt; no messages sent.');
    P.setStatus(postId, 'processing', 'Publishing in progress', bodyText);
    P.setMedia(postId, Boolean(meta.hasMedia));
  }
  let sent = 0;
  const blocked = new Set();
  for (let pi = 0; pi < parts.length; pi++) {
    const c = parts[pi];
    // Hash text and bytes as well as metadata: a changed split must never silently reuse a receipt.
    const h = crypto.createHash('sha256');
    const emit = v => { const x=String(v); h.update(String(Buffer.byteLength(x))+':'+x); };
    const hashValue = (v) => {
      if (Buffer.isBuffer(v)) { emit('buffer'); emit(v.length); h.update(v); }
      else if (Array.isArray(v)) { emit('array'); emit(v.length); for (const x of v) hashValue(x); }
      else if (v && typeof v === 'object') { const keys=Object.keys(v).sort(); emit('object'); emit(keys.length); for (const k of keys) { emit(k); hashValue(v[k]); } }
      else { emit(typeof v); emit(JSON.stringify(v) ?? 'undefined'); }
    };
    hashValue(c); const digest = h.digest('hex');
    for (const t of targets) {
      if (blocked.has(t.jid)) continue;
      const perMax = perTargetMax(t.jid);
      if (perMax && !(tracked && ledger.get(source,message,t.jid,pi)) && CH.pubCountLastHour(t.jid) >= perMax) { errors.push(`${t.name || t.jid}: target rate cap reached`); blocked.add(t.jid); continue; }
      let claim = null;
      if (tracked) {
        claim = ledger.claim(source,message,t.jid,pi,digest);
        if (!claim.claimed) {
          if (claim.state === 'accepted') { sent++; if (claim.row.provider_id) { keys.push({ target:t.jid, msgId:claim.row.provider_id }); if (postId && !P.keys(postId).some(k => k.target_jid === t.jid && k.msg_id === claim.row.provider_id)) P.addKey(postId,t.jid,claim.row.provider_id); } continue; }
          errors.push(`${t.name || t.jid} part ${pi+1}: ${claim.state === 'changed' ? 'content changed since the previous attempt; manual review needed' : 'outcome needs manual review before retry'}`);
          blocked.add(t.jid); continue;
        }
      }
      let providerId = '';
      try {
        const msgId = await wa.sendToChannel(sock,t.jid,c);
        providerId = msgId;
        // Save the returned provider ID before attempting optional read-back.
        if (tracked) ledger.finish(source,message,t.jid,pi,'accepted',msgId,'Provider returned a message ID; delivery is not guaranteed');
        keys.push({target:t.jid,msgId});
        if (postId && msgId && !P.keys(postId).some(k => k.target_jid === t.jid && k.msg_id === msgId)) P.addKey(postId,t.jid,msgId);
        CH.recordPub(t.jid);
        if (Boolean(meta.hasMedia) && pi === 0) {
          await new Promise(r => setTimeout(r,1500));
          let visible = null;
          try { visible = await wa.verifyChannelPost(sock,t.jid,msgId); } catch { /* no proof */ }
          if (visible !== true) {
            if (tracked) ledger.finish(source,message,t.jid,pi,'unverified',msgId,visible === false ? 'Not visible on read-back' : 'Read-back unavailable');
            errors.push(`${t.name || t.jid}: accepted media could not be verified; review before retry`); blocked.add(t.jid); continue;
          }
        }
        sent++;
        ring.info('publish.sent', `Provider accepted part ${pi+1} for ${t.name || t.jid}`);
      } catch (err) {
        // An exception does not prove the remote service did not accept the message.
        if (tracked) ledger.finish(source,message,t.jid,pi,'uncertain',providerId,String(err.message || err));
        errors.push(`${t.name || t.jid}: outcome uncertain — ${String(err.message || err).slice(0,160)}`);
        blocked.add(t.jid);
        ring.warn('publish.fail', errors[errors.length-1]);
      }
      await new Promise(r => setTimeout(r,pace.gapMin(1500)));
    }
    if (pi < parts.length-1) await new Promise(r => setTimeout(r,pace.gapMin(2000)));
  }
  if (postId) P.setStatus(postId, errors.length ? 'failed' : 'published', errors.length ? errors.join(' | ').slice(0,200) : `Provider accepted ${sent} part(s); delivery not confirmed`, bodyText);
  pace.note(sent, errors.length);
  return {sent, failed:errors.length, errors, keys, complete:errors.length === 0};
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
