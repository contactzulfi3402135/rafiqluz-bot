'use strict';
/**
 * v7.0.0 — multi-number manager.
 *
 * The main number (the bot's own) is handled by wa.js exactly as before.
 * This module connects ADDITIONAL numbers: each one gets its own auth folder
 * (sessions/num-<id>), its own socket, its own chats/contacts, and the same
 * anti-delete / anti-view-once / anti-edit / call features.
 *
 * Pairing: a number is connected by scanning a QR shown on the PUBLIC
 * /connect page — no dashboard password needed to link a phone, but chats
 * stay inside the (password-protected) dashboard.
 */
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const {
  default: makeWASocket, useMultiFileAuthState, makeCacheableSignalKeyStore,
  DisconnectReason, Browsers, fetchLatestBaileysVersion
} = require('@whiskeysockets/baileys');

const cfg = require('./config');
const { logger, baileysLogger, ring } = require('./logger');
const { S, N, IB } = require('./db');

const events = require('./wa').events;      // same bus as the main number (wa.message etc. are main-only)
const MAX_NUMBERS = cfg.config.whatsapp.maxNumbers;

const conns = new Map();   // id → { sock, status, detail, qr, phone, dir, timer, attempts }
let cachedVersion = null;

async function waVersion() {
  if (cachedVersion) return cachedVersion;
  try { const { version } = await fetchLatestBaileysVersion(); cachedVersion = version; } catch { cachedVersion = undefined; }
  return cachedVersion;
}

const set = (id, patch) => { const c = conns.get(id) || {}; conns.set(id, { ...c, ...patch }); };

function dirFor(id) { return path.join(cfg.config.paths.sessions, `num-${id}`); }

function publicView(id) {
  const c = conns.get(id) || {};
  return { id, status: c.status || 'idle', detail: c.detail || '', phone: c.phone || '', qr: Boolean(c.qr),
    pairCode: String(c.pairCode || ''), pairPhone: String(c.pairPhone || '') };   // v7.3.3: pairing-code mode
}
async function qrDataUrl(id) {
  const c = conns.get(id);
  if (!c || !c.qr) return null;
  try { return await require('qrcode').toDataURL(c.qr, { width: 320, margin: 1 }); } catch { return null; }
}

/* ---------- socket ---------- */
async function spawn(id) {
  const row = N.get(id);
  if (!row) throw new Error('That number was removed.');
  const dir = dirFor(id);
  fs.mkdirSync(dir, { recursive: true });
  set(id, { dir, status: 'connecting', detail: '', attempts: conns.get(id)?.attempts || 0 });

  const { state, saveCreds } = await useMultiFileAuthState(dir);
  const version = await waVersion();
  const sock = makeWASocket({
    version,
    logger: baileysLogger,
    auth: { creds: state.creds, keys: makeCacheableSignalKeyStore(state.keys, baileysLogger) },
    browser: Browsers.ubuntu(cfg.config.whatsapp.browserName),
    printQRInTerminal: false,
    markOnlineOnConnect: false,
    generateHighQualityLinkPreview: false,
    syncFullHistory: true,                 // WhatsApp-Web style history for this number
    emitOwnEvents: true,
    retryRequestDelayMs: 2000,
    defaultQueryTimeoutMs: 120000,
    getMessage: async () => null
  });
  set(id, { sock, status: 'connecting' });

  sock.ev.on('creds.update', () => {
    try { saveCreds(); } catch { }
    try { require('./persist').syncSoon('num-creds', 25000); } catch { }
  });

  sock.ev.on('connection.update', (u) => {
    const { connection, lastDisconnect, qr } = u;
    if (qr) {
      set(id, { status: 'qr', qr, detail: 'Scan with WhatsApp → Linked devices' });
      N.setStatus(id, 'qr');
      ring.info('num.qr', `Number ${id} is waiting for a scan — QR shown on the public /connect page`);
    }
    if (connection === 'open') {
      const phone = String(sock.user?.id || '').split(':')[0].split('@')[0];
      set(id, { status: 'open', qr: null, detail: '', phone, attempts: 0 });
      N.setStatus(id, 'open', phone);
      S.set(`num.${id}.connected_at`, new Date().toISOString().slice(0, 19).replace('T', ' '));
      ring.info('num.open', `Number +${phone} connected — chats, contacts and features are live (session "${id}")`);
      try { require('./persist').syncSoon('num-connected', 8000); } catch { }
    }
    if (connection === 'close') {
      const code = lastDisconnect?.error?.output?.statusCode;
      const loggedOut = code === DisconnectReason.loggedOut || Boolean(lastDisconnect?.error?.data?.loggedOut) || code === 401;
      set(id, { sock: null, qr: null });
      if (loggedOut) {
        set(id, { status: 'logged_out', detail: 'The phone removed this device — scan again to reconnect' });
        N.setStatus(id, 'logged_out');
        ring.warn('num.logout', `Number ${id} was unlinked from the phone — open /connect and scan the QR again`);
        return;
      }
      const attempts = (conns.get(id)?.attempts || 0) + 1;
      set(id, { status: 'close', detail: `Disconnected — reconnecting (try ${attempts})`, attempts });
      N.setStatus(id, 'close');
      const wait = Math.min(30000, 3000 * attempts);
      const timer = setTimeout(() => {
        // the number may have been removed (or re-linked) while this timer waited
        if (!conns.has(id) || !N.get(id)) return;
        const c = conns.get(id);
        if (c?.sock) return;                        // a newer socket already took over
        spawn(id).catch((e) => ring.warn('num.spawn.fail', `Reconnect of ${id} failed: ${e.message}`));
      }, wait);
      timer.unref?.();
      set(id, { timer });
    }
  });

  sock.ev.on('messages.upsert', ({ messages }) => {
    for (const m of messages) {
      try { require('./inbox').archive(m, { session: id, sock }).catch(() => { }); } catch { }
    }
  });

  sock.ev.on('messaging-history.set', (payload) => {
    try { require('./inbox').importHistory(id, payload); } catch { }
  });

  sock.ev.on('contacts.upsert', (list) => { try { require('./inbox').contactsUpsert(id, list); } catch { } });
  sock.ev.on('chats.phoneNumberShare', ({ lid, jid } = {}) => {
    try { require('./inbox').learnMapping(id, lid, jid); } catch { }   // v7.3: resolve 15-digit @lid ids
  });
  sock.ev.on('contacts.update', (list) => { try { require('./inbox').contactsUpsert(id, list); } catch { } });

  sock.ev.on('call', (calls) => { for (const c of calls || []) { try { require('./inbox').logCall(id, c, sock).catch(() => { }); } catch { } } });
}

/* ---------- lifecycle ---------- */
async function add(label) {
  const total = N.all().length;
  if (total >= MAX_NUMBERS) throw new Error(`Limit is ${MAX_NUMBERS} numbers on this dyno (memory). Remove one first — connected: ${total}.`);
  const id = `n${crypto.randomBytes(3).toString('hex')}`;
  N.add(id, String(label || '').slice(0, 60), 'connected from /connect');
  events.emit('numbers.changed', { id, action: 'add' });
  try { await spawn(id); } catch (err) {
    N.remove(id);
    throw new Error(`Could not start pairing: ${err.message}`);
  }
  ring.info('num.add', `New number slot ${id} created — scan the QR at /connect to link the phone`);
  return { id, label: label || '' };
}

/* v7.3.3: pairing-code flow — the phone TYPES an 8-char code instead of scanning.
   Baileys needs the websocket open before the pairing IQ can be sent; the QR
   event is the proof the socket is alive, so we wait for it (then ignore the QR). */
async function addPair(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  if (digits.length < 8 || digits.length > 15) throw new Error('Enter the full number with country code (example: 923001234567).');
  const { id } = await add(`pair code •${digits.slice(-4)}`);
  for (let i = 0; i < 20; i += 1) {
    const c = conns.get(id);
    if (!c || !c.sock) throw new Error('The pairing session ended before it could start — try again.');
    if (c.status === 'logged_out') throw new Error('That number unlinked the device right away — check the number and try again.');
    if (c.qr || c.status === 'open') break;
    await new Promise((r) => setTimeout(r, 1500));
  }
  const c = conns.get(id);
  if (!c || !c.sock || typeof c.sock.requestPairingCode !== 'function') {
    throw new Error('Could not reach WhatsApp to create the code — try again in a minute.');
  }
  try {
    const code = String(await c.sock.requestPairingCode(digits));
    set(id, { pairCode: code, pairPhone: digits });
    ring.info('num.paircode', `Pairing code •${code.slice(-2)} issued for +${digits} (slot ${id}) — the phone types it in Linked devices`);
    return { id, code, phone: digits };
  } catch (err) {
    try { await remove(id); } catch { }
    throw new Error(`WhatsApp rejected the pairing (${String(err.message || 'unknown').slice(0, 120)}) — make sure that number is registered on WhatsApp, then try again.`);
  }
}

async function remove(id) {
  if (id === 'main') throw new Error('That is the main bot number — it is managed on the Home tab and cannot be removed here.');
  const c = conns.get(id);
  if (c?.timer) clearTimeout(c.timer);
  try { c?.sock?.end?.(new Error('removed from dashboard')); } catch { }
  try { c?.sock?.ws?.close?.(); } catch { }
  conns.delete(id);
  try { fs.rmSync(dirFor(id), { recursive: true, force: true }); } catch { }
  IB.wipeSession(id);
  N.remove(id);
  S.set(`num.${id}.history`, '');
  events.emit('numbers.changed', { id, action: 'remove' });
  ring.warn('num.remove', `Number ${id} removed — its chats, contacts and login file are deleted from the dashboard`);
}

async function relink(id) {
  if (id === 'main') throw new Error('Re-link the main number from the Home tab (QR card).');
  await remove(id);                                          // wipe the dead login, then a fresh slot
  const fresh = await add('re-link');
  return fresh;
}

/* v7.3.3: a pairing-code / QR session the human never finished (code typed by no one,
   QR never scanned) would otherwise reconnect forever and eat a number slot.
   Slots that never reached "open" are reaped after 24 h. logged_out slots stay —
   the user can re-scan to restore that number's history. */
function reapStaleNumbers() {
  try {
    const cutoff = new Date(Date.now() - 24 * 3600 * 1000).toISOString().slice(0, 19).replace('T', ' ');
    const stale = N.all().filter((r) => r.id !== 'main' && r.status !== 'open' && r.status !== 'logged_out'
      && String(r.created_at || '') < cutoff);
    for (const r of stale) {
      const c = conns.get(r.id);
      if (c?.timer) clearTimeout(c.timer);
      try { c?.sock?.end?.(new Error('stale session reaped')); } catch { }
      conns.delete(r.id);
      N.remove(r.id);
      ring.warn('num.reap', `Extra number ${r.id} never connected — removed after 24 h, slot freed`);
    }
    if (stale.length) try { require('./persist').syncSoon('num-reaped', 30000); } catch { }
  } catch (err) { try { ring.warn('num.reap.fail', String(err.message)); } catch { } }
}

async function startAll() {
  // the main number always has a row (label only — its socket lives in wa.js)
  reapStaleNumbers();
  try { const t = setInterval(reapStaleNumbers, 60 * 60 * 1000); t.unref?.(); } catch { }
  if (!N.get('main')) N.add('main', 'Main number', 'the bot\'s own number (channel mirroring)');
  for (const row of N.all()) {
    if (row.id === 'main') continue;
    if (conns.has(row.id)) continue;
    spawn(row.id).catch((err) => { set(row.id, { status: 'close', detail: err.message }); });
  }
  ring.info('num.ready', `Number manager ready — ${N.all().length - 1} extra number(s) restored from cloud memory`);
}

async function stopAll() {
  for (const [id, c] of conns) {
    if (c.timer) clearTimeout(c.timer);
    try { c.sock?.end?.(new Error('shutdown')); } catch { }
    N.setStatus(id, 'close');
  }
}

/** live socket for a session id (main → wa.js socket) */
function getSocket(id) {
  if (!id || id === 'main') return require('./wa').getSocket();
  const c = conns.get(id);
  return c && c.sock ? c.sock : null;
}
function statusOf(id) {
  if (!id || id === 'main') return require('./wa').getStatus().status;
  return (conns.get(id) || {}).status || 'idle';
}
/** every number, merged with live state — main first */
function list() {
  const rows = N.all();
  if (!rows.some((r) => r.id === 'main')) rows.unshift({ id: 'main', label: 'Main number', phone: '', status: '' });
  return rows.map((r) => {
    if (r.id === 'main') {
      const st = require('./wa').getStatus();
      return { id: 'main', label: r.label || 'Main number', phone: r.phone || st.phone || '', status: st.status, qr: Boolean(st.qr), history: S.get('num.main.history', '') };
    }
    const live = publicView(r.id);
    return { id: r.id, label: r.label || '', phone: live.phone || r.phone || '', status: live.status, qr: live.qr, history: S.get('num.' + r.id + '.history', '') };
  });
}

function init() {
  events.on('wa.history', () => { });   // main history is handled by inbox.init()
  return { startAll, stopAll, add, addPair, remove, relink, list, getSocket, statusOf, qrDataUrl, publicView, MAX_NUMBERS };
}

module.exports = { init, startAll, stopAll, add, addPair, remove, relink, list, getSocket, statusOf, qrDataUrl, publicView, MAX_NUMBERS };
