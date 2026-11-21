'use strict';
/**
 * v7.0.0 — WhatsApp-parity inbox for MANY numbers at once.
 *
 *  · archive(m, {session, sock})  — live messages: chats, groups, media previews
 *  · anti-delete   — a "delete for everyone" arrives as a revoke packet; we keep
 *                    the copy we already stored and mark it deleted
 *  · anti-view-once— view-once media is downloaded at arrival (before you open it
 *                    on the phone) and kept in the dashboard
 *  · anti-edit     — edited messages keep their original text (orig_body)
 *  · history sync  — the same chat history WhatsApp sends to a freshly linked
 *                    device (messaging-history.set) is imported per number
 *  · contacts sync — the phone's address book names every chat
 */
const fs = require('fs');
const path = require('path');
const wa = require('./wa');
const { ring } = require('./logger');
const { S, CT, IB, LM } = require('./db');
const cfg = require('./config');

const db = () => require('./db').open();

/* v9.0.0 (repo-slim): captured photos / view-once media are written to DISK
   (media/inbox/) and only the relative path is stored in the DB — the DB is the
   file cloud memory ships to GitHub, so its size must stay flat. Falls back to
   the old BLOB path if the disk write fails (the feature never regresses). */
const INBOX_MEDIA_DIR = () => path.join(cfg.config.paths.media, 'inbox');
function saveInboxMedia(rowId, buf, ext, mime, name) {
  try {
    /* v9.0.0 (owner policy): the post was already published → its media was
       deleted after posting. A late capture must not resurrect it. */
    try { if (db().prepare('SELECT media_cleared FROM inbox_msgs WHERE id=?').get(rowId)?.media_cleared) return true; } catch { }
    const dir = INBOX_MEDIA_DIR();
    fs.mkdirSync(dir, { recursive: true });
    const rel = 'inbox/' + rowId + '.' + ext;
    fs.writeFileSync(path.join(cfg.config.paths.media, rel), buf);
    IB.setMediaRef(rowId, mime, name, rel);
    /* the post may have been published between the check and the write */
    try {
      if (db().prepare('SELECT media_cleared FROM inbox_msgs WHERE id=?').get(rowId)?.media_cleared) {
        fs.unlinkSync(path.join(cfg.config.paths.media, rel));
        db().prepare("UPDATE inbox_msgs SET media_file='' WHERE id=?").run(rowId);
      }
    } catch { }
    return true;
  } catch (e) {
    ring.warn('inbox.media.disk', `Disk media write failed for msg ${rowId} (${e.message}) — falling back to BLOB`);
    return false;
  }
}

/* ---------- feature switches (default ON except call rejection) ---------- */
const FEATURES = {
  antidelete: () => S.getBool('feat.antidelete', true),
  antiviewonce: () => S.getBool('feat.antiviewonce', true),
  antiedit: () => S.getBool('feat.antiedit', true),
  rejectcalls: () => S.getBool('feat.rejectcalls', false)
};
/* v9.0.0 (owner policy): the old per-file size caps are GONE — media of any size
   is saved (on disk), and what gets posted is deleted right after publishing. */
const VIEWONCE_IMG_PX = 1080;           // view-once photos get resized to this edge

/* ---------- helpers ---------- */
function secsOf(ts) {                    // Baileys timestamps can be Long/number/object
  if (ts == null) return Math.floor(Date.now() / 1000);
  if (typeof ts === 'number') return ts > 1e12 ? Math.floor(ts / 1000) : ts;
  if (typeof ts === 'object' && ts.low != null) return Number(ts.low);
  const n = Number(ts); return Number.isFinite(n) ? (n > 1e12 ? Math.floor(n / 1000) : n) : Math.floor(Date.now() / 1000);
}
const isoOf = (ts) => new Date(secsOf(ts) * 1000).toISOString().slice(0, 19).replace('T', ' ');

/* ---------- v7.3.0: WhatsApp LID awareness ----------
   Most 1:1 chats are now addressed by a 15-digit @lid id, not the phone
   number. Without mapping they show up as raw 15-digit names and their
   messages used to be skipped entirely. These helpers resolve a lid to the
   real number (via jid_map, learned from contacts + chats.phoneNumberShare)
   and pick the best display label for any chat or sender. */
const isLid = (jid) => String(jid || '').endsWith('@lid');
const digitsOf = (jid) => String(jid || '').split('@')[0].split(':')[0].replace(/\D/g, '');
const pnLabel = (jid) => { const d = digitsOf(jid); return d ? `+${d}` : ''; };
const looksLikeId = (name) => !String(name || '').trim() || /^\d{6,}$/.test(String(name).trim());
/* v7.3.2: WhatsApp sync stores raw 15-digit LID digits in contact name/notify for LID-only
   contacts — those are ids, not names. Strip them so no raw digits can reach the UI. */
const cleanName = (name) => { const s = String(name || '').trim(); return looksLikeId(s) ? '' : s; };
/** best label: address book → resolved number → short id (never 15 raw digits) */
/* v7.3.6 - WhatsApp-Web name parity.
   isNumName: true when a "name" is really a number (+92..., 0300..., 15-digit id...).
   learnPushName: a chat not in the phone's address book gets named from the
   sender's profile name (pushName) - exactly how the official app labels it.
   A real address-book name (non-numeric) always wins. */
const isNumName = (x) => { const t = String(x || '').trim(); return !t || /^\+?[\d\s().-]{6,}$/.test(t); };
function learnPushName(session, m) {
  try {
    const s = String(session || 'main');
    const push = String(m?.pushName || '').trim().slice(0, 80);
    if (!push || isNumName(push) || m?.key?.fromMe) return;
    const jid = String(m.key?.remoteJid || '');
    if (!jid.endsWith('@s.whatsapp.net') && !jid.endsWith('@g.us') && !jid.endsWith('@lid')) return; // channel names come from the subject
    const targets = [];
    if (m.key?.participant) targets.push(String(m.key.participant));
    if (jid.endsWith('@s.whatsapp.net') || isLid(jid)) targets.push(jid);
    for (const t of [...new Set(targets)]) {
      if (!t || isNumName(t)) continue;
      if (!String(CT.nameOf(s, t) || '').trim()) CT.upsert(s, t, push, t);
    }
    // keep the chat list row itself in sync for 1:1 chats
    if (jid.endsWith('@s.whatsapp.net') || isLid(jid)) {
      const cur = String(db().prepare('SELECT name FROM inbox_chats WHERE session=? AND jid=?').get(s, jid)?.name || '');
      const resolved = labelFor(s, jid, push);
      if (isNumName(cur) && !isNumName(resolved) && resolved !== cur) {
        db().prepare('UPDATE inbox_chats SET name=? WHERE session=? AND jid=?').run(resolved.slice(0, 120), s, jid);
      }
    }
  } catch { /* names are best-effort */ }
}

function labelFor(session, jid, fallback) {
  const s = String(session || 'main');
  const raw = String(jid || '');
  const fb = String(fallback || '').trim();
  const fromBook = String(CT.nameOf(s, raw) || '').trim();
  if (fromBook && !looksLikeId(fromBook)) return fromBook.slice(0, 120);
  if (isLid(raw)) {
    const pn = LM.pnFor(s, raw);
    if (pn) { const n = String(CT.nameOf(s, pn) || '').trim(); return (n || pnLabel(pn) || 'Contact').slice(0, 120); }
    if (!looksLikeId(fb)) return fb.slice(0, 120);
    return `Contact •${digitsOf(raw).slice(-4)}`;
  }
  if (raw.endsWith('@newsletter')) {                                          // v7.3.3: channels
    if (!looksLikeId(fb)) return fb.slice(0, 120);
    return `Channel •${digitsOf(raw).slice(-4)}`;
  }
  if (!looksLikeId(fb)) return fb.slice(0, 120);
  if (raw.endsWith('@g.us')) return `Group •${digitsOf(raw).slice(-6)}`;
  return pnLabel(raw) || `Contact •${digitsOf(raw).slice(-4)}`;
}
/** sender inside a chat (groups): push name → address book → resolved number */
function senderLabel(m, session) {
  const s = String(session || 'main');
  const push = String(m.pushName || '').trim();
  if (push) return push.slice(0, 80);
  const p = String(m.key?.participant || '');
  if (p) {
    const n = String(CT.nameOf(s, p) || '').trim();
    if (n && !looksLikeId(n)) return n.slice(0, 80);
    if (isLid(p)) {
      const pn = LM.pnFor(s, p);
      if (pn) { const n2 = String(CT.nameOf(s, pn) || '').trim(); return ((n2 && !looksLikeId(n2) ? n2 : '') || pnLabel(pn) || 'Contact').slice(0, 80); }
      return `Contact •${digitsOf(p).slice(-4)}`;                                          // v7.3.2: unmapped LID sender
    }
    return (pnLabel(p) || `Contact •${digitsOf(p).slice(-4)}`).slice(0, 80);
  }
  return labelFor(s, String(m.key?.remoteJid || ''), '').slice(0, 80);
}

function unwrap(msg) {                   // peel the wrappers WhatsApp adds
  let m = msg || {};
  for (let i = 0; i < 4; i += 1) {
    const inner = m.viewOnceMessage?.message || m.viewOnceMessageV2?.message || m.viewOnceMessageV2Extension?.message
      || m.ephemeralMessage?.message || m.documentWithCaptionMessage?.message;
    if (!inner) break;
    m = inner;
  }
  return m;
}
function isViewOnce(msg) {
  const raw = msg || {};
  return Boolean(raw.viewOnceMessage || raw.viewOnceMessageV2 || raw.viewOnceMessageV2Extension)
    || Boolean(unwrap(msg).imageMessage?.viewOnce) || Boolean(unwrap(msg).videoMessage?.viewOnce)
    || Boolean(unwrap(msg).audioMessage?.viewOnce);
}

/** text/kind/mime/thumb for any message body (shared by live + history import) */
function describe(msg) {
  const m = unwrap(msg);
  const out = { body: '', kind: '', mime: '', name: '', thumb: null };
  const grabThumb = (node) => { if (node && Buffer.isBuffer(node.jpegThumbnail)) out.thumb = node.jpegThumbnail; };
  if (m.conversation) { out.body = String(m.conversation); out.kind = 'text'; }
  else if (m.extendedTextMessage?.text) { out.body = String(m.extendedTextMessage.text); out.kind = 'text'; }
  else if (m.imageMessage) { out.body = String(m.imageMessage.caption || ''); out.kind = 'photo'; out.mime = String(m.imageMessage.mimetype || 'image/jpeg'); grabThumb(m.imageMessage); }
  else if (m.videoMessage) { out.body = String(m.videoMessage.caption || ''); out.kind = 'video'; out.mime = String(m.videoMessage.mimetype || 'video/mp4'); grabThumb(m.videoMessage); }
  else if (m.audioMessage) { out.kind = 'voice'; out.mime = String(m.audioMessage.mimetype || 'audio/ogg'); out.body = m.audioMessage.ptt ? '' : ''; }
  else if (m.documentMessage) { out.kind = 'doc'; out.mime = String(m.documentMessage.mimetype || ''); out.name = String(m.documentMessage.fileName || 'file'); grabThumb(m.documentMessage); }
  else if (m.stickerMessage) { out.kind = 'sticker'; out.mime = String(m.stickerMessage.mimetype || 'image/webp'); }
  else if (m.pollCreationMessage || m.pollCreationMessageV3) {
    const p = m.pollCreationMessage || m.pollCreationMessageV3;
    out.kind = 'poll'; out.body = `${p.name || 'Poll'} — ${(p.options || []).map((o) => o.optionName).join(' · ')}`;
  }
  else if (m.locationMessage) { out.kind = 'location'; out.body = m.locationMessage.name || 'Location'; }
  else if (m.contactMessage) { out.kind = 'contact'; out.body = m.contactMessage.displayName || 'Contact'; }
  else if (m.contactsArrayMessage) { out.kind = 'contact'; out.body = `${(m.contactsArrayMessage.contacts || []).length} contacts`; }
  else if (m.protocolMessage) { out.kind = 'protocol'; }
  else if (m.reactionMessage) { out.kind = 'reaction'; }
  return out;
}
const KIND_ICON = { photo: '📷', video: '🎬', voice: '🎤', doc: '📄', sticker: '🎨', poll: '📊', location: '📍', contact: '👤', call: '📞' };
function bodyOf(m) {
  const d = describe(m.message || {});
  if (d.body) return d.body;
  if (KIND_ICON[d.kind]) return `${KIND_ICON[d.kind]} ${d.kind === 'photo' ? 'Photo' : d.kind === 'video' ? 'Video' : d.kind === 'voice' ? 'Voice message' : d.kind === 'doc' ? (d.name || 'Document') : d.kind === 'poll' ? 'Poll' : d.kind === 'location' ? 'Location' : d.kind === 'contact' ? 'Contact' : d.kind === 'sticker' ? 'Sticker' : 'Media'}`;
  return '';
}
function nameOf(m, session) {
  const jid = String(m.key?.remoteJid || '');
  const ann = m.messageStubParameters || [];
  const fallback = String(ann[0] || m.verifiedBizName || m.pushName || '');
  return labelFor(session || 'main', jid, fallback);
}

/* ---------- media helpers ---------- */
async function downloadMedia(m, sock) {
  try {
    const { downloadMediaMessage } = require('@whiskeysockets/baileys');
    const buf = await downloadMediaMessage(m, 'buffer', {},
      sock ? { logger: require('./logger').baileysLogger, reuploadRequest: sock.updateMediaMessage } : {});
    return Buffer.isBuffer(buf) ? buf : null;
  } catch (err) {
    ring.warn('inbox.media.fail', `Media download failed (${String(err?.message || err).slice(0, 80)}) — keeping the preview only`);
    return null;
  }
}
/** v7.3.6: full photo capture for the WhatsApp tab (photos stay <=450 KB after resize) */
async function capturePhoto(m, session, sock, rowId) {
  if (!rowId) return;
  const inner = unwrap(m.message || {});
  if (!inner.imageMessage) return;
  const buf = await downloadMedia(m, sock);
  if (!buf) return;
  const small = await shrinkImage(buf);
  /* v9.0.0 (owner policy): NO size cap — every size is saved (the file lives on
     disk, never in the cloud-synced DB). Media that gets posted to a target is
     deleted right after publishing (see clearMediaForMsg). */
  if (!saveInboxMedia(rowId, small, 'jpg', 'image/jpeg', 'photo.jpg')) {
    IB.setMedia(rowId, 'image/jpeg', 'photo.jpg', small);   // disk failed → old BLOB behavior
  }
}
async function shrinkImage(buf) {
  try {
    const sharp = require('sharp');
    return await sharp(buf).rotate().resize(VIEWONCE_IMG_PX, VIEWONCE_IMG_PX, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 72 }).toBuffer();
  } catch { return buf; }
}
/* 5C (R58): voice transcription (switch OFF by default) — download the audio,
   send it to the provider wired for audio (Gemini), store the text on the row.
   Any failure is logged honestly and the row keeps its "(Voice message)" label. */
async function captureVoice(m, session, sock, rowId) {
  if (!rowId) return;
  const inner = unwrap(m.message || {});
  if (!inner.audioMessage) return;
  const buf = await downloadMedia(m, sock);
  if (!buf || !buf.length) { ring.warn('transcribe.skip', 'Voice transcription skipped — WhatsApp returned no audio bytes'); return; }
  const ai = require('./ai');
  const out = await ai.transcribe(buf, String(inner.audioMessage.mimetype || 'audio/ogg'));
  const text = String(out || '').trim().slice(0, 4000);
  if (!text) return;
  db().prepare('UPDATE inbox_msgs SET voice_text=? WHERE id=? AND session=?').run(text, rowId, session);
  db().prepare(`UPDATE inbox_chats SET last_text=? WHERE session=? AND jid=?`).run(text.slice(0, 120), session, String(m.key?.remoteJid || ''));
  ring.info('transcribe.done', `Voice message transcribed: "${text.slice(0, 60)}${text.length > 60 ? '…' : ''}"`);
}
/** anti-view-once: fetch and store the media the moment it arrives */
async function captureViewOnce(m, session, sock, rowId) {
  if (!rowId) return;
  const inner = unwrap(m.message || {});
  const node = inner.imageMessage || inner.videoMessage || inner.audioMessage || inner.documentMessage;
  if (!node) return;
  const buf = await downloadMedia(m, sock);
  if (!buf) return;
  const isImg = (inner.imageMessage || (inner.documentMessage && String(node.mimetype || '').startsWith('image/')));
  if (isImg) {
    const small = await shrinkImage(buf);
    if (!saveInboxMedia(rowId, small, 'jpg', 'image/jpeg', 'view-once.jpg')) IB.setMedia(rowId, 'image/jpeg', 'view-once.jpg', small);
  } else {
    /* v9.0.0 (owner policy): NO size cap — any size is saved (on disk, never in
       the cloud-synced DB). Posted media is deleted after publishing. */
    if (!saveInboxMedia(rowId, buf, 'bin', String(node.mimetype || 'application/octet-stream'), 'view-once')) IB.setMedia(rowId, String(node.mimetype || 'application/octet-stream'), 'view-once', buf);
  }
}

/* ---------- live archive ---------- */
async function archive(m, opts = {}) {
  try {
    const session = String(opts.session || 'main');
    const jid = String(m.key?.remoteJid || '');
    if (!jid || jid === 'status@broadcast') return;
    const isChannel = jid.endsWith('@newsletter');
    if (!jid.endsWith('@s.whatsapp.net') && !jid.endsWith('@g.us') && !jid.endsWith('@lid') && !isChannel) return;   // v7.3: @lid chats included

    learnPushName(session, m);                    // v7.3.6: name chats from the sender's profile name
    const inner = unwrap(m.message || {});

    /* anti-delete: revoke packet → keep our stored copy, mark it deleted */
    const proto = m.message?.protocolMessage;
    if (proto) {
      const targetId = String(proto.key?.id || '');
      const chatJid = String(proto.key?.remoteJid || jid);
      const REVOKE = 0, EDIT = 14;
      if (proto.type === REVOKE && targetId) {
        const hit = IB.findByMsgId(session, chatJid, targetId);
        if (hit) {
          IB.markDeleted(session, chatJid, targetId);
          db().prepare('UPDATE inbox_chats SET last_text=?, last_at=? WHERE session=? AND jid=?')
            .run('🚫 This message was deleted', isoOf(m.messageTimestamp), session, chatJid);
          const kept = FEATURES.antidelete() ? ` — anti-delete kept the original: "${String(hit.body || '').slice(0, 60)}"` : '';
          ring.info('inbox.antidelete', `A message was deleted for everyone in ${chatJid.split('@')[0]}${kept}`);
        }
        return;
      }
      if (proto.type === EDIT && targetId) {
        const em = proto.editedMessage || {};          // Baileys: editedMessage is itself a Message
        const newText = String(em.message?.conversation || em.conversation
          || em.message?.extendedTextMessage?.text || em.extendedTextMessage?.text
          || em.message?.protocolMessage?.editedMessage?.conversation || '');
        const hit = IB.findByMsgId(session, chatJid, targetId);
        if (hit && newText) {
          IB.applyEdit(session, chatJid, targetId, newText);
          db().prepare('UPDATE inbox_chats SET last_text=?, last_at=? WHERE session=? AND jid=?')
            .run(newText.slice(0, 120), isoOf(m.messageTimestamp), session, chatJid);
          if (FEATURES.antiedit()) ring.info('inbox.antiedit', `An edited message's original text was preserved in ${chatJid.split('@')[0]}`);
        }
        return;
      }
      return;
    }
    if (inner.reactionMessage) return;                 // reactions sit on the bubble, not as rows

    const fromMe = Boolean(m.key.fromMe);
    const ts = isoOf(m.messageTimestamp);
    const d = describe(m.message || {});
    const body = bodyOf(m);
    const viewOnce = isViewOnce(m.message || {});
    const kind = viewOnce ? `viewonce-${d.kind || 'media'}` : (d.kind || '');

    /* media preview: keep the tiny thumbnail WhatsApp embeds in every media message */
    let mediaMime = '', mediaData = null;
    if (d.thumb && d.thumb.length) { mediaMime = 'image/jpeg'; mediaData = d.thumb; }

    const rowId = IB.add({
      session, chat_jid: jid, from_me: fromMe ? 1 : 0, ts,
      sender_name: fromMe ? '' : senderLabel(m, session),
      sender_jid: String(m.key?.participant || ''),            // v7.3.6: avatar for group senders
      body: (body || (kind === 'protocol' ? '' : '(media)')).slice(0, 2000),
      msg_id: String(m.key?.id || ''), kind, media_mime: mediaMime, media_name: d.name || '', media_data: mediaData
    });

    /* chat row (name from contacts when we have it) - v7.3.6: a real name is
       never downgraded back to a number by a message without a profile name */
    let chatName = nameOf(m, session);
    const existingChatName = String(db().prepare('SELECT name FROM inbox_chats WHERE session=? AND jid=?').get(session, jid)?.name || '');
    if (existingChatName && !isNumName(existingChatName) && isNumName(chatName)) chatName = existingChatName;
    db().prepare(`INSERT INTO inbox_chats(session, jid, name, last_at, last_text, unread) VALUES(?,?,?,?,?,?)
      ON CONFLICT(session,jid) DO UPDATE SET name=COALESCE(NULLIF(excluded.name,''), name), last_at=excluded.last_at,
        last_text=excluded.last_text, unread=unread+excluded.unread`)
      .run(session, jid, chatName, ts, (body || (viewOnce ? '👁️ View once' : '(media)')).slice(0, 120), fromMe ? 0 : 1);

    /* anti-view-once: download the real media NOW (before the phone consumes it) */
    if (viewOnce && FEATURES.antiviewonce() && rowId) {
      const sock = opts.sock || (session === 'main' ? wa.getSocket() : null);
      if (sock) await captureViewOnce(m, session, sock, rowId);
      ring.info('inbox.viewonce', `View-once ${d.kind || 'media'} in ${jid.split('@')[0]} was saved to the dashboard (viewing it on your phone cannot delete it from here)`);
    }

    /* v7.3.6: WhatsApp-Web parity - regular photos in chats are stored in full
       (resized, <=450 KB) so the tab shows pictures, not "preview not stored" */
    if (!viewOnce && d.kind === 'photo' && rowId && !isChannel) {
      const sock2 = opts.sock || (session === 'main' ? wa.getSocket() : null);
      if (sock2) capturePhoto(m, session, sock2, rowId).catch(() => { });
    }

    /* 5C (R58): voice transcription — main number, incoming only, switch ON */
    if (!viewOnce && d.kind === 'voice' && rowId && session === 'main' && !fromMe && S.getBool('power.transcribe.on', false)) {
      const sock3 = opts.sock || wa.getSocket();
      if (sock3) captureVoice(m, session, sock3, rowId).catch((e) => {
        ring.warn('transcribe.fail', `Voice transcription failed: ${String(e?.message || e).slice(0, 160)}`);
      });
    }

    /* watched numbers + KB auto-reply (5C) + AI auto-reply — main number only.
       The KB answers first (exact, no AI); when it answers, the AI stands down. */
    if (session === 'main') {
      const phone = jid.split('@')[0].split(':')[0];
      const w = db().prepare('SELECT * FROM watched WHERE phone=?').get(phone);
      if (w && !fromMe) {
        db().prepare(`INSERT INTO recovered(kind, chat_jid, sender, body) VALUES('watched_hit',?,?,?)`)
          .run(jid, String(m.pushName || w.name).slice(0, 80), body.slice(0, 400));
      }
      const kbSent = await maybeKbReply(jid, body, fromMe);
      if (!kbSent) maybeAutoReply(jid, body, fromMe);
    }

    // Archive history and media are retained unless the owner explicitly enables retention cleanup.
  } catch (err) {
    try { ring.warn('inbox.archive.fail', `Archive skipped one message: ${String(err?.message || err).slice(0, 120)}`); } catch { }
  }
}

/* ---------- history sync (the WhatsApp-Web style import) ---------- */
function importHistory(session, payload = {}) {
  const s = String(session || 'main');
  const { chats = [], contacts = [], messages = [], isLatest, progress } = payload;
  let nChats = 0, nMsgs = 0, nContacts = 0;
  try {
    let mapped = 0;
    for (const c of contacts) {
      const id = String(c.id || '');
      if (!id) continue;
      const isNews = id.endsWith('@newsletter');                       // v7.3.3: channel subjects sync too
      const cLid = isNews ? '' : String(c.lid || (isLid(id) ? id : ''));
      const cPn = isNews ? '' : String(c.jid || (!isLid(id) ? id : ''));
      const nm = cleanName(isNews ? String(c.name || c.notify || '') : String(c.name || c.verifiedName || ''));
      const nt = cleanName(String(c.notify || ''));
      if (cLid && cPn) { if (LM.set(s, cLid, cPn)) mapped += 1; }
      if (cLid) CT.upsert(s, cLid, nm, nt);
      if (cPn) CT.upsert(s, cPn, nm, nt);
      if (isNews) CT.upsert(s, id, nm || nt, nt || nm);
      nContacts += 1;
    }
    for (const c of chats) {
      const jid = String(c.id || '');
      if (!jid || jid.endsWith('@newsletter')) continue;
      const name = labelFor(s, jid, String(c.name || c.subject || ''));
      const lastAt = c.conversationTimestamp ? isoOf(c.conversationTimestamp) : isoOf(Date.now() / 1000);
      const muted = c.mutedUntil && secsOf(c.mutedUntil) * 1000 > Date.now() ? 1 : 0;
      db().prepare(`INSERT INTO inbox_chats(session, jid, name, last_at, last_text, unread, archived, pinned, muted)
        VALUES(?,?,?,?,COALESCE((SELECT last_text FROM inbox_chats WHERE session=? AND jid=?),''),?,?,?,?)
        ON CONFLICT(session,jid) DO UPDATE SET name=COALESCE(NULLIF(excluded.name,''), name),
          last_at=MAX(COALESCE(last_at,''), excluded.last_at), unread=MAX(unread, excluded.unread),
          archived=excluded.archived, pinned=excluded.pinned, muted=excluded.muted`)
        .run(s, jid, name, lastAt, s, jid, Math.max(0, Number(c.unreadCount || 0)), c.archived ? 1 : 0, c.pinned ? 1 : 0, muted);
      nChats += 1;
    }
    for (const m of messages) {
      const jid = String(m.key?.remoteJid || '');
      const mid = String(m.key?.id || '');
      if (!jid || !mid) continue;
      if (!jid.endsWith('@s.whatsapp.net') && !jid.endsWith('@g.us') && !jid.endsWith('@lid')) continue;   // v7.3: @lid history imported too
      learnPushName(s, m);                              // v7.3.6: history teaches names too
      const d = describe(m.message || {});
      if (d.kind === 'protocol' || d.kind === 'reaction') continue;
      db().prepare('INSERT INTO inbox_chats(session, jid, name, last_at, last_text, unread) VALUES(?,?,?,?,?,0) ON CONFLICT(session,jid) DO NOTHING')
        .run(s, jid, labelFor(s, jid, ''), isoOf(m.messageTimestamp), bodyOf(m).slice(0, 120));
      try {
        IB.add({
          session: s, chat_jid: jid, from_me: m.key?.fromMe ? 1 : 0, ts: isoOf(m.messageTimestamp),
          sender_name: m.key?.fromMe ? '' : senderLabel(m, s),
          sender_jid: String(m.key?.participant || ''),
          body: (bodyOf(m) || '(media)').slice(0, 2000), msg_id: mid, kind: d.kind || '',
          media_mime: d.thumb && d.thumb.length ? 'image/jpeg' : '', media_name: d.name || '', media_data: d.thumb || null
        });
        nMsgs += 1;
      } catch { /* duplicate — already stored (live message beat the import) */ }
    }
    if (mapped) { try { syncChatNames(s); } catch { } ring.info('inbox.lid', `History sync linked ${mapped} WhatsApp id(s) to real phone numbers — chats now show names/numbers instead of 15-digit ids`); }
    const state = isLatest ? 'done' : `importing ${nMsgs}`;
    S.set(`num.${s}.history`, state);
    if (nMsgs || nChats || nContacts) {
      ring.info('inbox.history', `History sync (${s}): ${nChats} chats, ${nMsgs} messages, ${nContacts} contacts${typeof progress === 'number' ? ` — ${progress}%` : ''}${isLatest ? ' — import complete' : ''}`);
    }
  } catch (err) {
    ring.warn('inbox.history.fail', `History import error (${s}): ${String(err?.message || err).slice(0, 140)}`);
  }
  return { chats: nChats, messages: nMsgs, contacts: nContacts };
}

function contactsUpsert(session, list = []) {
  const s = String(session || 'main'); let n = 0;
  let mapped = 0;
  for (const c of list) {
    const id = String(c.id || '');
    if (!id) continue;
    const isNews = id.endsWith('@newsletter');                       // v7.3.3: channel subjects sync too
    const cLid = isNews ? '' : String(c.lid || (isLid(id) ? id : ''));
    const cPn = isNews ? '' : String(c.jid || (!isLid(id) ? id : ''));
    const nm = cleanName(isNews ? String(c.name || c.notify || '') : String(c.name || c.verifiedName || ''));
    const nt = cleanName(String(c.notify || ''));
    if (cLid && cPn) { if (LM.set(s, cLid, cPn)) mapped += 1; }
    if (cLid) CT.upsert(s, cLid, nm, nt);
    if (cPn) CT.upsert(s, cPn, nm, nt);
    if (isNews) CT.upsert(s, id, nm || nt, nt || nm);
    n += 1;
  }
  if (n) syncChatNames(s);
  if (mapped) ring.info('inbox.lid', `Address book linked ${mapped} WhatsApp id(s) to phone numbers (${s})`);
  return n;
}
/** apply freshly synced contact names onto existing chat rows */
function syncChatNames(session = 'main') {
  try {
    const rows = db().prepare(`SELECT jid, name FROM inbox_chats WHERE session=?`).all(session);
    const upd = db().prepare('UPDATE inbox_chats SET name=? WHERE session=? AND jid=?');
    for (const r of rows) {
      const n = labelFor(session, r.jid, r.name);
      // v7.3.6: never downgrade a real name back to a number
      if (n && n !== r.name && !(isNumName(n) && !isNumName(r.name))) upd.run(n, session, r.jid);
    }
  } catch { }
}

/* ---------- calls (anti-call: log + optional auto-reject) ---------- */
async function logCall(session, call, sock) {
  try {
    if (!call || call.status !== 'offer') return;      // only the ring moment creates a row
    const s = String(session || 'main');
    const jid = String(call.from || '');
    if (!jid.endsWith('@s.whatsapp.net') && !jid.endsWith('@g.us') && !jid.endsWith('@lid')) return;
    const label = call.isVideo ? '📹 Missed video call' : '📞 Missed voice call';
    const ts = isoOf(Date.now() / 1000);
    IB.add({ session: s, chat_jid: jid, from_me: 0, ts, sender_name: '', body: label, msg_id: String(call.id || `call-${ts}`), kind: 'call', media_mime: '', media_name: '', media_data: null });
    db().prepare(`INSERT INTO inbox_chats(session, jid, name, last_at, last_text, unread) VALUES(?,?,?,?,?,1)
      ON CONFLICT(session,jid) DO UPDATE SET last_at=excluded.last_at, last_text=excluded.last_text, unread=unread+1`)
      .run(s, jid, labelFor(s, jid, ''), ts, label);
    if (!require('./lifecycle').isStopping() && !require('./panic').active() && FEATURES.rejectcalls() && sock?.rejectCall && call.id) {
      try { await sock.rejectCall(call.id, call.from); ring.info('inbox.call.reject', `Incoming ${call.isVideo ? 'video' : 'voice'} call from ${jid.split('@')[0]} auto-rejected (feature is ON)`); } catch { }
    }
  } catch { }
}

/* ---------- 5C (R59): knowledge-base auto-reply (OFF by default) ----------
 * Exact stored Q→A pairs — no AI involved. Owner-locked: an EMPTY allowlist
 * means nobody is auto-replied. Only inside the active-hours window (PKT).
 * Returns true when a KB reply was sent (so the AI auto-reply can stand down). */
const kbReplyAt = new Map();
async function maybeKbReply(jid, body, fromMe) {
  try {
    if (fromMe || !body) return false;
    if (!jid.endsWith('@s.whatsapp.net')) return false;
    if (S.getBool('panic.on', false)) return false; // 5E (R73): panic stop
    if (!S.getBool('power.replykb.on', false)) return false;
    const from = String(S.get('replykb.hours.from', '09:00')).trim() || '09:00';
    const to = String(S.get('replykb.hours.to', '21:00')).trim() || '21:00';
    const d = new Date(Date.now() + 5 * 3600e3);
    const now = `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
    const inWindow = from <= to ? (now >= from && now <= to) : (now >= from || now <= to); // overnight wrap
    if (!inWindow) return false;
    const allow = String(S.get('replykb.allowlist', '')).split(',').map((x) => x.replace(/\D/g, '')).filter(Boolean);
    const phone = jid.split('@')[0].split(':')[0];
    if (!allow.includes(phone)) return false; // empty allowlist = nobody
    const last = kbReplyAt.get(jid) || 0;
    if (Date.now() - last < 60e3) return false; // anti-loop: one KB reply per chat per minute
    const hit = require('./db').RB.match(body);
    if (!hit) return false;
    kbReplyAt.set(jid, Date.now());
    const sock = wa.getSocket();
    if (!sock) return false;
    await sock.sendMessage(jid, { text: String(hit.a).slice(0, 2000) });
    ring.info('replykb.sent', `KB auto-reply sent to ${phone} (matched: "${String(hit.q).slice(0, 40)}")`);
    return true;
  } catch { return false; }
}

/* ---------- AI auto-reply (personal chats; switch OFF by default) ---------- */
const autoReplyAt = new Map();
async function maybeAutoReply(jid, body, fromMe) {
  try {
    if (fromMe || !body) return;
    if (!jid.endsWith('@s.whatsapp.net')) return;
    if (S.getBool('panic.on', false)) return; // 5E (R73): panic stop
    if (!S.getBool('power.aireply.on', false)) return;
    const ai = require('./ai');
    if (!ai.state().hasKey || ai.state().paused) return;
    const last = autoReplyAt.get(jid) || 0;
    if (Date.now() - last < 10 * 60e3) return;
    autoReplyAt.set(jid, Date.now());
    const recent = db().prepare('SELECT from_me, body FROM inbox_msgs WHERE session=? AND chat_jid=? ORDER BY id DESC LIMIT 5').all('main', jid).reverse();
    const reply = await ai.autoReply(body, recent);
    if (require('./lifecycle').isStopping() || require('./panic').active()) return;
    if (!reply || !reply.trim()) return;
    const sock = wa.getSocket();
    if (!sock) return;
    await sock.sendMessage(jid, { text: reply.trim().slice(0, 2000) });
    ring.info('aireply.sent', `AI auto-reply sent to ${jid.split('@')[0]} (switch is ON — turn it off in Channel Power)`);
  } catch { }
}

/* ---------- public API used by the web layer ---------- */
const chats = (session) => IB.chats(session || 'main').map((c) => ({ ...c, name: labelFor(session || 'main', c.jid, c.name) }));
const messages = (session, jid) => IB.messages(session || 'main', jid);
const markRead = (session, jid) => { try { db().prepare('UPDATE inbox_chats SET unread=0 WHERE session=? AND jid=?').run(String(session || 'main'), String(jid || '')); } catch { } };
const ensureChat = (session, jid, name) => IB.ensureChat(session || 'main', jid, name);
const media = (session, id, jid) => IB.mediaOf(session || 'main', id, jid);
const historyState = (session) => S.get(`num.${session}.history`, '');
const features = () => ({
  antidelete: FEATURES.antidelete(), antiviewonce: FEATURES.antiviewonce(),
  antiedit: FEATURES.antiedit(), rejectcalls: FEATURES.rejectcalls()
});

/* ---------- watched numbers ---------- */
const watched = {
  list: () => db().prepare('SELECT * FROM watched ORDER BY phone').all(),
  add: (phone, name) => {
    phone = String(phone || '').replace(/\D/g, '');
    if (phone.length < 8) throw new Error('Give a full phone number with country code (e.g. 923001234567).');
    db().prepare("INSERT OR REPLACE INTO watched(phone,name,paired_at,status) VALUES(?,?,datetime('now'),'paired')").run(phone, String(name || '').slice(0, 80));
    return { phone, name: name || phone };
  },
  remove: (phone) => db().prepare('DELETE FROM watched WHERE phone=?').run(String(phone || '').replace(/\D/g, '')),
  lastActivity: (phone) => {
    const r = db().prepare('SELECT ts, body FROM inbox_msgs WHERE session=? AND chat_jid=? ORDER BY id DESC LIMIT 1').get('main', `${phone}@s.whatsapp.net`);
    return r || null;
  }
};

/* ---------- bulk sender v2 (names, {name} personalization, groups, history) ---------- */
async function bulkSend(recipients, text, meta = {}) {
  const sock = wa.getSocket();
  if (!sock || wa.getStatus().status !== 'open') throw new Error('WhatsApp is not connected — link it first (Home tab).');
  if (!String(text || '').trim()) throw new Error('Message text is required.');
  const seen = new Set(); const list = [];
  for (const rawLine of String(recipients || '').split(/[\n;]+/)) {
    const line = rawLine.trim();
    if (!line) continue;
    if (line.includes('@')) {
      if (!/^[0-9]{8,15}@s\.whatsapp\.net$/.test(line)) throw new Error('Bulk sends accept personal numbers only; groups and channels are not allowed. No messages were sent.');
      const phone=line.split('@')[0];
      if (!seen.has(phone)) { seen.add(phone); list.push({ jid: line, name:'', phone }); }
      continue;
    }
    const [rawPhone, ...nameParts] = line.split(',');
    const phone = String(rawPhone || '').replace(/\D/g, '');
    const name = nameParts.join(',').trim().slice(0, 60);
    if (!/^[+\d() .-]+$/.test(rawPhone) || phone.length < 8 || phone.length > 15) throw new Error('Invalid personal number in list. Correct it before sending; no messages were sent.');
    if (!seen.has(phone)) { seen.add(phone); list.push({ jid: `${phone}@s.whatsapp.net`, name, phone }); }
  }
  if (!list.length) throw new Error('No valid personal numbers. Use one per line: 923001234567,Name.');
  if (list.length > 200) throw new Error('Bulk send is limited to 200 recipients; no messages were sent.');
  const ledger=require('./delivery-ledger'), source='bulk:manual', batchId=require('crypto').randomUUID();
  const results = []; let sent = 0;
  for (const item of list) {
    const personal = String(text).replaceAll('{name}', item.name || '').slice(0, 4096);
    if (require('./panic').active() || require('./lifecycle').isStopping()) {
      results.push({to:item.phone || item.jid,name:item.name,ok:false,state:'not_sent',error:'Stopped before sending'}); continue;
    }
    const digest=require('crypto').createHash('sha256').update(JSON.stringify({jid:item.jid,text:personal})).digest('hex');
    const claim=ledger.claim(source,batchId,item.jid,0,digest);
    if (!claim.claimed) { results.push({to:item.phone || item.jid,name:item.name,ok:false,state:'review',error:'Prior outcome requires review'}); continue; }
    try {
      const response=await sock.sendMessage(item.jid, { text: personal });
      if (!response?.key?.id) throw new Error('Provider did not return a message ID');
      ledger.finish(source,batchId,item.jid,0,'accepted',response.key.id,'Provider accepted; delivery not confirmed');
      sent += 1; results.push({ to:item.phone || item.jid, name:item.name, ok:true, state:'accepted' });
    } catch (err) {
      const m = String(err?.message || err || '').slice(0, 120);
      ledger.finish(source,batchId,item.jid,0,'uncertain','',m);
      results.push({ to:item.phone || item.jid, name:item.name, ok:false, state:'uncertain', error:'Outcome uncertain — check Delivery review before sending again' });
    }
    await new Promise((r) => setTimeout(r, require('./pace').gapMin(1500)));
  }
  ring.info('bulk.send', `Bulk send: provider accepted ${sent}/${list.length}; delivery not confirmed`);
  if (!meta.skipRecord) require('./db').BULKH.record(list.length, sent, list.length - sent, text, meta.listId || 0, meta.listName || '');
  try { require('./webhooks').fire('bulk.sent', { sent, total: list.length, listName: meta.listName || '', via: meta.listId ? 'saved list' : 'ad-hoc' }); } catch { } // 5G (R80)
  return { sent, total: list.length, results, batchId };
}

/* ---------- uptime ---------- */
const uptime = {
  recordBoot: (source) => { try { db().prepare('INSERT INTO uptime(source) VALUES(?)').run(source); } catch { } },
  stats: () => ({
    boots: db().prepare('SELECT COUNT(*) n FROM uptime').get().n,
    last: db().prepare('SELECT * FROM uptime ORDER BY id DESC LIMIT 1').get() || null,
    recent: db().prepare('SELECT * FROM uptime ORDER BY id DESC LIMIT 20').all()
  })
};

function init() {
  wa.events.on('wa.message', (m) => { archive(m, { session: 'main' }).catch(() => { }); });
  wa.events.on('wa.history', (payload) => { try { importHistory('main', payload); } catch { } });
  wa.events.on('wa.contacts', (list) => { try { contactsUpsert('main', list); } catch { } });
  wa.events.on('wa.call', (call) => { logCall('main', call, wa.getSocket()).catch(() => { }); });
  return { chats, messages, watched, bulkSend, uptime, features };
}

/* ---------- v7.3.0: learn a lid↔phone link the moment WhatsApp shares it ---------- */
function learnMapping(session, lid, pn) {
  const s = String(session || 'main');
  if (!lid || !pn) return false;
  const ok = LM.set(s, lid, pn);
  if (ok) {
    try { syncChatNames(s); } catch { }
    try { ring.info('inbox.lid', `WhatsApp linked an id to ${'+' + digitsOf(pn)} — chat names updated`); } catch { }
  }
  return ok;
}

/* ---------- v7.3.0: on-demand history (ask the phone for older messages) ---------- */
async function requestHistory(session, jid, count = 50) {
  const s = String(session || 'main');
  const sock = require('./numbers').getSocket(s);
  if (!sock || !sock.fetchMessageHistory) throw new Error('That number is not connected right now — connect it and try again.');
  const oldest = db().prepare('SELECT msg_id, from_me, ts FROM inbox_msgs WHERE session=? AND chat_jid=? ORDER BY id ASC LIMIT 1').get(s, String(jid));
  if (!oldest || !oldest.msg_id) throw new Error('No history anchor yet: WhatsApp only serves older messages for a chat that already has at least one message here. New messages arrive automatically — try again after this chat gets one.');
  const key = { remoteJid: String(jid), fromMe: Boolean(oldest.from_me), id: String(oldest.msg_id) };
  const ms = new Date(String(oldest.ts).replace(' ', 'T') + (String(oldest.ts).endsWith('Z') ? '' : 'Z')).getTime();
  const n = Math.max(10, Math.min(200, Number(count) || 50));
  let res;
  try { res = await sock.fetchMessageHistory(n, key, ms); }
  catch (err) {
    const msg = String(err?.message || err);
    if (/not authenticated/i.test(msg)) throw new Error('That number is not connected right now — connect it on the WhatsApp tab (or /connect) and try again.');
    throw new Error(`WhatsApp refused the history request (${msg.slice(0, 80)}). Try again in a minute.`);
  }
  ring.info('inbox.history.request', `On-demand history requested for ${labelFor(s, jid, '')} (${n} messages) — status: ${res || 'sent'}`);
  return String(res || 'requested');
}

module.exports = {
  init, archive, importHistory, contactsUpsert, syncChatNames, logCall, learnMapping, requestHistory, labelFor, cleanName, isNumName, learnPushName,
  chats, messages, markRead, ensureChat, media, historyState, features,
  watched, bulkSend, uptime, FEATURES
};
