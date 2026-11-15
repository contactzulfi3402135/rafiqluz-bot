'use strict';
/**
 * v6.0.0 — the WhatsApp engine. Every connection behavior here is a battle scar:
 *  · crash-safe login file (atomic .bak + restore) — a hard kill never costs the login
 *  · 440 = maybe our own deploy overlap → wait 75 s once; a second = real takeover
 *  · 500 after a working connection → ONE silent retry with the same login
 *  · "QR refs attempts ended" = waiting for a scan → never touch the disk
 *  · unstable-but-recently-accepted login → patient 5-min rests, never a hasty QR
 *  · before ever showing a QR: auto-restore the newest good quarantined login (≤48 h)
 *  · gentle reconnects — no startup floods
 */
const path = require('path');
const fs = require('fs');
const EventEmitter = require('events');
const {
  default: makeWASocket, useMultiFileAuthState, makeCacheableSignalKeyStore,
  DisconnectReason, Browsers, fetchLatestBaileysVersion, proto,
  getBinaryNodeChild, getBinaryNodeChildren, jidNormalizedUser
} = require('@whiskeysockets/baileys');
const qrcodeTerminal = require('qrcode-terminal');

const cfg = require('./config');
const { logger, baileysLogger, ring } = require('./logger');
const { S, CH } = require('./db');

const sessionDir = path.join(cfg.config.paths.sessions, cfg.config.whatsapp.sessionName);
const events = new EventEmitter();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let sock = null;
let connecting = false;
let intentionalClose = false;
let status = 'idle';            // idle|connecting|qr|open|reconnecting|logout|close
let lastDetail = '';
let lastQr = null;
let reconnectAttempts = 0;
let replacedCount = 0;          // consecutive 440s
let badSessionRetried = false;  // one-shot 500 retry
let lastCloseWasQrWait = false;
let firstOpenDone = false;
let currentOpenAt = 0;
let lastOpenAt = 0;
let shortOpenCount = 0;
let cooldownRounds = 0;
let quarantineRestoreDone = false;
let ownPhone = S.get('main.phone', '');

function setStatus(next, detail) {
  status = next; lastDetail = detail || '';
  logger.info({ status: next, detail: lastDetail }, `WhatsApp status: ${next}`);
  events.emit('wa.status', { status: next, detail: lastDetail });
}

/* ---------------- channel queries (protocol) ---------------- */
/** Fetch the newest posts of a channel as parsed message objects. */
async function fetchChannelPosts(socket, jid, count = 10) {
  const node = {
    tag: 'newsletter', attrs: { jid },
    content: [{ tag: 'messages', attrs: { count: String(count) } }]
  };
  const result = await socket.query({ type: 'get', node, timeoutMs: 15000 });
  const msgsNode = getBinaryNodeChild(result, 'messages');
  if (!msgsNode) return [];
  const out = [];
  for (const m of getBinaryNodeChildren(msgsNode, 'message')) {
    try {
      // standard wrapper: <message><plaintext/><media>… children carry server_id; the
      // decoded content lives in the binary "web" child used by Baileys' own parser
      const id = m.attrs.id || m.attrs.server_id || '';
      const ts = Number(m.attrs.t || 0);
      let message = null;
      for (const child of m.content || []) {
        if (child.tag === 'web' && child.content) {
          const buf = child.content instanceof Uint8Array ? child.content
            : Buffer.isBuffer(child.content) ? child.content
              : Array.isArray(child.content) ? Buffer.concat(child.content.filter((c) => c instanceof Uint8Array)) : null;
          if (buf) message = proto.WebMessageInfo.decode(buf).message;
        }
      }
      if (id && message) out.push({ key: { id, remoteJid: jid, fromMe: false }, messageTimestamp: ts, message });
    } catch { /* skip one bad row */ }
  }
  return out;
}

/** Subscribe to a channel's live push updates.
 *  Returns { duration } (WhatsApp tells us when the subscription EXPIRES —
 *  seconds) or null when it could not be confirmed. Never throws. */
async function subscribeChannel(socket, jid) {
  try {
    if (!socket || typeof socket.subscribeNewsletterUpdates !== 'function') return null;
    const res = await Promise.race([
      socket.subscribeNewsletterUpdates(jid),
      new Promise((_, rej) => setTimeout(() => rej(new Error('subscribe timeout')), 12000))
    ]);
    if (res && Number(res.duration) > 0) return { duration: Number(res.duration) };
    return null; // no live_updates confirmation → treat as NOT subscribed, retry honestly
  } catch { return null; }
}

/** Verify a just-sent post is really visible in a channel (true/false/null=unknown). */
async function verifyChannelPost(socket, jid, msgId) {
  try {
    const posts = await fetchChannelPosts(socket, jid, 10);
    if (!posts || !posts.length) return null;             // could not read the channel back
    return posts.some((p) => String(p.key?.id || '') === String(msgId));
  } catch { return null; }
}

/** Send raw content to a channel and return the created message id. */
async function sendToChannel(socket, jid, content) {
  const sent = await socket.sendMessage(jid, content);
  if (!sent?.key?.id) throw new Error('WhatsApp did not confirm the send');
  return sent.key.id;
}

/**
 * EDIT a published channel post (OWNER/ADMIN only). Mirrors the real
 * WhatsApp-Web newsletter edit: the target message's OWN id + edit="8"?? no —
 * delete uses edit="8" (AdminRevoke); EDIT uses edit="1"? v6 contract: Baileys
 * exposes no newsletter-edit helper; the working stanza (whatsmeow EditAttribute)
 * is: <message to=jid id=TARGET_OWN_MESSAGE_ID type="text" edit="1"> with the
 * new plaintext. Server ACKs then applies.
 */
async function editChannelPost(socket, jid, targetMsgId, newText) {
  // VERIFIED against Baileys 6.7.24's own newsletter send path
  // (messages-send.js: edit='1'; generics.js: plaintext = proto.Message.encode(...)):
  // the plaintext is a protobuf Message wrapping a MESSAGE_EDIT protocolMessage —
  // NOT raw UTF-8. The stanza id is the target post's own message id (same rule
  // as the delete contract).
  const edited = proto.Message.fromObject({
    protocolMessage: {
      key: { remoteJid: jid, fromMe: true, id: targetMsgId },
      editedMessage: { conversation: String(newText || '') },
      timestampMs: Date.now(),
      type: proto.Message.ProtocolMessage.Type.MESSAGE_EDIT
    }
  });
  const bytes = proto.Message.encode(edited).finish();
  const node = {
    tag: 'message',
    attrs: { to: jid, id: targetMsgId, type: 'text', edit: '1' },
    content: [{ tag: 'plaintext', attrs: {}, content: bytes }]
  };
  await socket.query({ type: 'set', node, timeoutMs: 15000 });
  return true;
}

/**
 * DELETE a published channel post (OWNER/ADMIN only). THE VERBATIM CONTRACT:
 * <message to=jid id=TARGET_POST_OWN_MESSAGE_ID type="text" edit="8">
 *   <plaintext>{EMPTY BUFFER}</plaintext></message>
 * — no server_id attribute, no fresh tag. edit="8" = AdminRevoke. The old
 * wrong form (fresh id + server_id) gets ACKed then silently ignored —
 * that bug family is dead forever.
 */
async function deleteChannelPost(socket, jid, targetMsgId) {
  const node = {
    tag: 'message',
    attrs: { to: jid, id: targetMsgId, type: 'text', edit: '8' },
    content: [{ tag: 'plaintext', attrs: {}, content: Buffer.alloc(0) }]
  };
  await socket.query({ type: 'set', node, timeoutMs: 15000 });
  return true;
}

/** A channel's name+role from its metadata (null on failure).
 *  role: OWNER / ADMIN = can post · GUEST / SUBSCRIBER = followed only · '' = not followed. */
async function channelMeta(socket, jid) {
  try {
    const meta = await Promise.race([
      socket.newsletterMetadata('jid', jid),
      new Promise((_, rej) => setTimeout(() => rej(new Error('metadata timeout')), 10000))
    ]);
    if (!meta) return null;
    const name = meta?.name || meta?.thread_metadata?.name?.text || '';
    const role = String(
      meta?.thread_metadata?.viewer_metadata?.role
      || meta?.viewer_metadata?.role
      || ''
    ).toUpperCase();
    // 5I (I1): expose the subscriber count when Baileys includes it (best-effort; undefined otherwise)
    const subs = Number(meta?.subscribers ?? meta?.thread_metadata?.subscribers_count ?? NaN);
    return { name, role, canPost: role === 'OWNER' || role === 'ADMIN', subscribers: Number.isFinite(subs) && subs >= 0 ? subs : undefined };
  } catch { return null; }
}

/* ---------------- crash-safe login file ---------------- */
const credsIntact = (p) => {
  try {
    const parsed = JSON.parse(fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '');
    return Boolean(parsed && typeof parsed === 'object' && Object.keys(parsed).length > 0);
  } catch { return false; }
};

function guardCreds() {
  const credsFile = path.join(sessionDir, 'creds.json');
  const bak = credsFile + '.bak';
  if (!credsIntact(credsFile)) {
    if (credsIntact(bak)) {
      try {
        fs.copyFileSync(bak, credsFile);
        ring.warn('wa.creds.restored', 'Login file restored from the crash-safe backup — reconnecting WITHOUT a new QR scan');
      } catch { /* best effort */ }
    }
  }
  return credsIntact(credsFile);
}

function makeSaveSafe(saveCreds) {
  const credsFile = path.join(sessionDir, 'creds.json');
  const bak = credsFile + '.bak';
  return async () => {
    await saveCreds();
    try {
      if (credsIntact(credsFile)) {
        const tmp = bak + '.tmp';
        fs.writeFileSync(tmp, fs.readFileSync(credsFile));
        fs.renameSync(tmp, bak); // atomic — unkillable
      }
    } catch { /* backup is best effort */ }
  };
}

/* ---------------- connect ---------------- */
async function connect() {
  if (connecting) return;
  connecting = true;
  intentionalClose = false;
  setStatus('connecting');
  try {
    fs.mkdirSync(sessionDir, { recursive: true });

    // 1. crash-safe restore + quarantine auto-restore (BEFORE any QR)
    let hadCreds = guardCreds();
    try {
      const credsFile = path.join(sessionDir, 'creds.json');
      const pairedHere = (() => { try { return Boolean(JSON.parse(fs.readFileSync(credsFile, 'utf8'))?.registered); } catch { return false; } })();
      if (!pairedHere && !quarantineRestoreDone) {
        const parent = path.dirname(sessionDir);
        const base = path.basename(sessionDir);
        let best = null;
        for (const e of fs.readdirSync(parent)) {
          if (!e.startsWith(`${base}.quarantine-`)) continue;
          const qc = path.join(parent, e, 'creds.json');
          if (!credsIntact(qc)) continue;
          let reg = false; try { reg = Boolean(JSON.parse(fs.readFileSync(qc, 'utf8'))?.registered); } catch { }
          if (!reg) continue;
          const st = fs.statSync(qc).mtimeMs;
          if (Date.now() - st > 48 * 3600e3) continue;
          if (!best || st > best.st) best = { q: path.join(parent, e), st };
        }
        if (best) {
          quarantineRestoreDone = true;
          fs.rmSync(sessionDir, { recursive: true, force: true });
          fs.renameSync(best.q, sessionDir);
          hadCreds = true;
          ring.warn('wa.creds.restore', `Restored the saved login WhatsApp accepted earlier — trying it BEFORE any QR`);
        }
      }
    } catch { /* best effort */ }

    // 2. resolve the WA version (live → bundled fallback)
    let version;
    try { ({ version } = await fetchLatestBaileysVersion()); } catch { version = undefined; }

    const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
    connectHadCreds = hadCreds;
    qrRejectionLogged = false;

    sock = makeWASocket({
      version,
      logger: baileysLogger,
      auth: { creds: state.creds, keys: makeCacheableSignalKeyStore(state.keys, baileysLogger) },
      browser: Browsers.ubuntu(cfg.config.whatsapp.browserName), // the proven identity
      printQRInTerminal: false,
      markOnlineOnConnect: false,
      generateHighQualityLinkPreview: false,
      syncFullHistory: true,          // full WA-Web parity archive
      emitOwnEvents: true,
      retryRequestDelayMs: 2000,
      defaultQueryTimeoutMs: 120000,  // slow-server patience
      getMessage: async () => null
    });
    wireEvents(sock, makeSaveSafe(saveCreds));
  } catch (err) {
    logger.error({ err: err.message }, 'Socket creation failed — retrying');
    connecting = false;
    return scheduleReconnect();
  }
  connecting = false;
}

let connectHadCreds = false;
let qrRejectionLogged = false;

function wireEvents(socket, saveCreds) {
  socket.ev.on('creds.update', () => {
    saveCreds();
    // v7.2: keys/creds changed → push them to cloud memory shortly (debounced)
    try { require('./persist').syncSoon('creds', 25000); } catch { }
  });

  socket.ev.on('connection.update', (u) => handleUpdate(u, socket));

  socket.ev.on('messaging-history.set', (payload) => {
    const { chats, isLatest } = payload || {};
    try {
      const freshList = [];
      for (const c of chats || []) {
        const jid = String(c.id || '');
        if (!jid.endsWith('@newsletter')) continue;
        const known = CH.dirList().some((d) => d.jid === jid);
        CH.recordDir(jid, c.name || '', null);
        if (!known) freshList.push({ jid, name: c.name || jid });
      }
      // v7.7.3: emit on EVERY chunk that carries fresh channels, not only the
      // final one — WhatsApp delivers the full follow list in several
      // messaging-history.set chunks on a fresh link, and channels that arrive
      // in a non-final chunk used to be recorded in the pickers but NEVER
      // auto-added to Sources (the reported "I don't see my channels" bug).
      if (freshList.length) {
        ring.info('channel.directory', `Channel list synced — ${freshList.length} new channel(s)${isLatest ? '' : ' (history chunk, not final)'}`);
        events.emit('directory.changed', { fresh: freshList });
      }
    } catch { /* best effort */ }
    // v7: the SAME history WhatsApp sends to a new device also feeds our inbox
    try { events.emit('wa.history', payload); } catch { }
  });

  // live channel updates → new posts into the pipeline (push path)
  socket.ev.on('message-receive', (m) => { try { events.emit('wa.message', m); } catch { } });
  // own sends + normal messages (WA-tab archive) — Baileys upsert covers both paths
  socket.ev.on('messages.upsert', ({ messages }) => {
    try { for (const m of messages) events.emit('wa.message', m); } catch { }
  });
  // v7: address book + calls for the main number
  socket.ev.on('contacts.upsert', (list) => { try { events.emit('wa.contacts', list); } catch { } });
  // v7.3: WhatsApp tells us the phone number behind a 15-digit @lid id → learn it
  socket.ev.on('chats.phoneNumberShare', ({ lid, jid } = {}) => {
    try { require('./inbox').learnMapping('main', lid, jid); } catch { }
  });
  socket.ev.on('contacts.update', (list) => { try { events.emit('wa.contacts', list); } catch { } });
  socket.ev.on('call', (calls) => { try { for (const c of calls || []) events.emit('wa.call', c); } catch { } });
}

function handleUpdate(u, socket) {
  const { connection, lastDisconnect, qr } = u;

  if (qr) {
    lastQr = qr;
    const rejected = connectHadCreds;
    setStatus('qr', rejected
      ? 'WhatsApp rejected the saved login — scan ONCE to re-link (nothing was deleted)'
      : 'Scan the QR code');
    if (rejected && !qrRejectionLogged) {
      qrRejectionLogged = true;
      ring.warn('wa.qr.rejected', 'QR requested although a saved login existed — WhatsApp rejected the session. One fresh scan re-links the bot; nothing is deleted.');
    }
    logger.info('Scan the QR code below (also visible on the dashboard):');
    qrcodeTerminal.generate(qr, { small: true });
    events.emit('wa.qr', qr);
    return;
  }

  if (connection === 'open') {
    const isFirstOpen = !firstOpenDone;
    firstOpenDone = true;
    currentOpenAt = Date.now();
    lastOpenAt = Date.now();
    lastQr = null;
    reconnectAttempts = 0;
    replacedCount = 0;
    badSessionRetried = false;
    try { ownPhone = String(socket.user?.id || '').split(':')[0].split('@')[0].replace(/\D/g, ''); if (ownPhone) S.set('main.phone', ownPhone); } catch { }
    setStatus('open', `Logged in as ${socket.user?.name || ownPhone || 'unknown'}`);
    ring.info('wa.connected', `WhatsApp connected: ${socket.user?.name || ownPhone || ''}`);
    // v7.2: this login just worked → save it to cloud memory right away (debounced)
    try { require('./persist').syncSoon('connected', 8000); } catch { }
    events.emit('wa.open', { first: isFirstOpen });
    return;
  }

  if (connection === 'close') {
    const code = lastDisconnect?.error?.output?.statusCode;
    const reason = lastDisconnect?.error?.message || `code ${code || 'unknown'}`;
    lastCloseWasQrWait = /QR refs/i.test(reason);

    if (intentionalClose) { setStatus('close', 'Stopped intentionally'); return; }

    /* 440 — our own deploy overlap? wait once, 75 s */
    if (code === DisconnectReason.connectionReplaced) {
      replacedCount += 1;
      if (replacedCount >= 2) {
        replacedCount = 0;
        setStatus('logout', 'This device was replaced by another link — scan the fresh QR once');
        ring.warn('wa.replaced', 'Connection replaced twice — a real takeover. Issuing a fresh QR (old session kept as backup).');
        return recoverFromLogout();
      }
      setStatus('reconnecting', 'Another copy took over (deploy?) — waiting 75 s, then reconnecting once');
      ring.warn('wa.replaced', 'Connection replaced (440) — if this is a deploy, the old copy dies within a minute. The saved login is NOT wiped.');
      setTimeout(() => { if (!intentionalClose) { reconnectAttempts = 0; connect(); } }, 75000).unref?.();
      return;
    }

    const deadCreds = code === DisconnectReason.badSession
      || code === DisconnectReason.multideviceMismatch
      || code === DisconnectReason.forbidden;
    const loggedOut = code === DisconnectReason.loggedOut;

    if (loggedOut || deadCreds) {
      /* 500 after a working connection — ONE silent retry with the same login */
      if (deadCreds && !loggedOut && code === DisconnectReason.badSession && !badSessionRetried) {
        badSessionRetried = true;
        setStatus('reconnecting', 'WhatsApp hiccup — restoring the session (no new QR needed)');
        ring.warn('wa.session.retry', `Session rejected once (${reason}) — retrying ONCE with the same saved login. The login is NOT wiped.`);
        setTimeout(() => { if (!intentionalClose) connect(); }, 10000).unref?.();
        return;
      }
      setStatus('logout', deadCreds && !loggedOut ? `Session unusable (${reason})` : 'Device was logged out');
      ring.warn('wa.logout', `WhatsApp session ${loggedOut ? 'logged out' : `unusable (${reason})`} — issuing a fresh QR. Nothing is ever deleted.`);
      return recoverFromLogout();
    }

    /* patient rests — a recently-accepted login is GOOD; unstable ≠ dead */
    const lifeMs = currentOpenAt > 0 ? Date.now() - currentOpenAt : -1;
    if (lifeMs >= 120000) { shortOpenCount = 0; cooldownRounds = 0; }
    else if (lifeMs > 0) shortOpenCount += 1;
    currentOpenAt = 0;
    const minsSinceOpen = lastOpenAt > 0 ? Math.round((Date.now() - lastOpenAt) / 60000) : -1;
    const recentlyAccepted = minsSinceOpen >= 0 && minsSinceOpen < 15;
    if (!lastCloseWasQrWait && cooldownRounds < 6 && (shortOpenCount >= 3 || (reconnectAttempts >= 3 && recentlyAccepted))) {
      cooldownRounds += 1;
      reconnectAttempts = 0;
      shortOpenCount = 0;
      setStatus('reconnecting', 'WhatsApp keeps dropping the connection — resting 5 minutes, then retrying automatically (login saved, no QR needed)');
      ring.warn('wa.cooldown', `Connection unstable (${reason}) — but WhatsApp accepted this login ${minsSinceOpen} min ago, so it is good. Resting 5 min (round ${cooldownRounds}/6) instead of asking for a QR. Missed posts are recovered automatically.`);
      setTimeout(() => { if (!intentionalClose) connect(); }, 5 * 60 * 1000).unref?.();
      return;
    }
    if (!lastCloseWasQrWait && cooldownRounds >= 6) {
      ring.warn('wa.cooldown.giveup', 'Six 5-minute rests did not stabilise the connection — issuing a fresh QR (previous session kept as backup).');
    }

    if (reconnectAttempts >= 3) {
      setStatus('logout', 'WhatsApp refused to restore the connection — scan the fresh QR once (nothing is ever deleted)');
      ring.warn('wa.repair', `Connection kept failing (${reason}) after 3 attempts — issuing a fresh QR. One scan re-links the bot.`);
      return recoverFromLogout();
    }

    setStatus('reconnecting', reason);
    ring.warn('wa.disconnect', `Connection closed (${reason}) — reconnecting (attempt ${reconnectAttempts + 1}/3)`);
    require('./alerts').maybe('wa', 'WhatsApp disconnected', reason); // 5D (R65)
    scheduleReconnect();
  }
}

/** v7.3.7: ZOMBIE SOCKET REPAIR. The socket reports "open" but the underlying
 *  connection is dead: push events stopped, and every query (channel fetch,
 *  directory check) times out SILENTLY - so nothing reconnects, nothing errors,
 *  and the bot simply stops posting with a clean-looking log. That is exactly
 *  the "made posts, then stopped, no response" state. Fix: end this socket
 *  instance and let the normal close handler reconnect with the SAME saved
 *  login (no QR). Creds/session are never touched. Rate-limited to 1/5 min. */
let lastZombieRepair = 0;
function forceReconnect(signal) {
  if (intentionalClose || connecting || !sock) return;
  if (Date.now() - lastZombieRepair < 5 * 60e3) return;
  lastZombieRepair = Date.now();
  reconnectAttempts = 0;
  ring.warn('wa.zombie.repair', `Socket reports "open" but cannot fetch anything - dead connection detected (${signal}). Reconnecting with the same saved login (no QR needed); missed posts are auto-recovered after it.`);
  setStatus('reconnecting', 'dead-connection repair (no QR needed)');
  try { sock.end(new Error('zombie-socket-repair')); } catch { }
}

function scheduleReconnect() {
  const ms = Math.min(3000 * 2 ** reconnectAttempts, 60000);
  reconnectAttempts += 1;
  logger.info(`Reconnecting in ${Math.round(ms / 1000)}s (attempt ${reconnectAttempts})`);
  setTimeout(() => { if (!intentionalClose) connect(); }, ms).unref?.();
}

/** Move the session aside — only when it was really paired or failures were not QR-waits. */
async function recoverFromLogout() {
  reconnectAttempts = 0;
  badSessionRetried = false;
  try { sock?.end?.(); } catch { }
  sock = null;
  let wasPaired = false;
  try { wasPaired = Boolean(JSON.parse(fs.readFileSync(path.join(sessionDir, 'creds.json'), 'utf8'))?.registered); } catch { }
  if (wasPaired || !lastCloseWasQrWait) {
    try {
      if (fs.existsSync(sessionDir) && fs.readdirSync(sessionDir).length) {
        const target = `${sessionDir}.quarantine-${new Date().toISOString().replace(/[:.]/g, '-')}`;
        fs.renameSync(sessionDir, target);
        fs.mkdirSync(sessionDir, { recursive: true });
        ring.warn('session.quarantine', `Session moved aside (kept as backup): ${path.basename(target)}`);
      }
    } catch { /* best effort */ }
  }
  await sleep(2000);
  return connect();
}

async function close() {
  intentionalClose = true;
  try { await sock?.end?.(); } catch { }
  sock = null;
  setStatus('close', 'Stopped');
}

module.exports = {
  connect, close, events,
  getSocket: () => sock,
  forceReconnect,
  getStatus: () => ({ status, detail: lastDetail, phone: ownPhone, qr: status === 'qr' ? lastQr : null }),
  fetchChannelPosts, subscribeChannel, sendToChannel, editChannelPost, deleteChannelPost, channelMeta, verifyChannelPost,
  sessionDir
};
