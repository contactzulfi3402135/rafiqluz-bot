'use strict';
/**
 * 5G (R80): OUTGOING WEBHOOKS — the owner registers one or more HTTPS endpoints
 * and picks which events to receive. On each event the bot POSTs a small JSON
 * body. OFF by default: no rows = nothing is sent. Delivery is fire-and-forget
 * with up to 3 attempts (2 s, then 10 s backoff) and NEVER blocks or breaks the
 * pipeline — a dead endpoint only costs its own retries. Last result is shown in
 * the UI so the owner can see exactly what happened.
 */
const db = require('./db');
const { S, AUD } = db;

/** Event catalog: [key, plain-English one-liner]. The UI renders these. */
const EVENTS = [
  ['post.published', 'A post went out to at least one target'],
  ['post.failed', 'A post failed (with the reason)'],
  ['post.queued', 'A post entered the approval queue'],
  ['bulk.sent', 'A bulk / saved-list send finished'],
  ['wasched.sent', 'A scheduled personal WhatsApp send went out'],
  ['panic.on', 'Panic stop engaged — everything paused'],
  ['panic.off', 'Panic stop restored — exact states back'],
  ['alert', 'An instant alert fired']
];

const KEY = new Set(EVENTS.map((e) => e[0]));

function list() {
  try {
    return db.open().prepare('SELECT * FROM webhooks ORDER BY id ASC').all().map((w) => ({
      id: w.id, name: w.name, url: w.url, events: String(w.events || '').split(',').filter(Boolean),
      enabled: !!w.enabled, last_status: w.last_status || '', last_at: w.last_at || ''
    }));
  } catch { return []; }
}

function add({ name, url, events }) {
  const n = String(name || '').trim().slice(0, 60);
  const u = String(url || '').trim();
  if (!n) throw new Error('Name the webhook first.');
  let parsed;
  try { parsed = new URL(u); } catch { throw new Error('Enter a full URL, starting with https://'); }
  if (!/^https?:$/.test(parsed.protocol) || parsed.username || parsed.password) throw new Error('Only HTTP(S) URLs without credentials are allowed.');
  const host=parsed.hostname.replace(/^\[|\]$/g,'');
  if (require('net').isIP(host) && !require('./safe-image-fetch').publicAddress(host)) throw new Error('Webhook address is private or restricted.');
  const evs = (Array.isArray(events) ? events : String(events || '').split(',')).map((e) => String(e).trim()).filter((e) => KEY.has(e));
  if (!evs.length) throw new Error('Pick at least one event.');
  const r = db.open().prepare('INSERT INTO webhooks(name,url,events) VALUES(?,?,?)').run(n, parsed.href, evs.join(','));
  try { AUD.log('owner', 'webhook.add', `Outgoing webhook created: ${n} (${evs.length} event(s))`); } catch { }
  return r.lastInsertRowid;
}

function setEnabled(id, on) {
  try { db.open().prepare('UPDATE webhooks SET enabled=? WHERE id=?').run(on ? 1 : 0, Number(id)); } catch { }
}

function del(id) {
  try { db.open().prepare('DELETE FROM webhooks WHERE id=?').run(Number(id)); } catch { }
}

function _last(id, status) {
  try { db.open().prepare('UPDATE webhooks SET last_status=?, last_at=datetime(\'now\') WHERE id=?').run(String(status).slice(0, 120), Number(id)); } catch { }
}

/** Deliver to one webhook with 3 attempts. Never throws. */
async function deliver(w, event, payload) {
  const body = JSON.stringify({
    eventId: require('crypto').randomUUID(),
    bot: S.get('bot.name', 'Raqifluz'), event,
    at: new Date().toISOString(),
    payload: payload || {}
  });
  for (let attempt = 1; attempt <= 3; attempt++) {
    if (require('./lifecycle').isStopping() || (require('./panic').active() && event !== 'panic.on')) { _last(w.id,'paused'); return {ok:false,error:'Webhook paused by panic stop or shutdown.'}; }
    try {
      const res = await require('./safe-public-fetch').fetchPublic(w.url, {
        method:'POST',headers:{'content-type':'application/json','x-raqifluz-event':event,'user-agent':'RaqifluzBot-webhook/1.0'},
        body,timeoutMs:10000,maxBytes:64*1024,allowEmpty:true,returnStatus:true
      });
      _last(w.id, 'ok ' + res.status); try { AUD.log('webhook', 'webhook.delivered', `Webhook “${w.name}” accepted ${event} (HTTP ${res.status})`); } catch { } return {ok:true,status:res.status};
    } catch (err) {
      _last(w.id, 'error: ' + String(err?.message || err).replace(/^Feed /,'Webhook ').slice(0,80));
    }
    if (attempt < 3) await new Promise((r) => setTimeout(r, (attempt === 1 ? 2000 : 10000) * _delayScale));
  }
  try { AUD.log('webhook', 'webhook.failed', `Webhook “${w.name}” could not be reached for ${event} after 3 attempts`); } catch { }
  return { ok: false };
}

/** Fire an event to every enabled webhook subscribed to it. Never throws. */
function fire(event, payload) {
  if (!KEY.has(event) || require('./lifecycle').isStopping() || (require('./panic').active() && event !== 'panic.on')) return;
  try {
    const rows = db.open().prepare('SELECT * FROM webhooks WHERE enabled=1').all();
    for (const w of rows) {
      const evs = String(w.events || '').split(',');
      if (!evs.includes(event)) continue;
      deliver(w, event, payload).catch(() => { });
    }
  } catch { /* a webhook can never break the pipeline */ }
}

/** UI "Test" button: one synthetic delivery to that webhook only. */
async function testHook(id) {
  try {
    const w = db.open().prepare('SELECT * FROM webhooks WHERE id=?').get(Number(id));
    if (!w) throw new Error('Webhook not found.');
    return await deliver(w, 'webhook.test', { message: 'Test from the Raqifluz dashboard' });
  } catch (err) { return { ok: false, error: err.message }; }
}

/* tests only: scale the retry backoff (production stays at 1) */
let _delayScale = 1;
function _setDelayScale(x) { _delayScale = Math.max(0, Number(x) || 0); }

module.exports = { EVENTS, list, add, setEnabled, del, fire, testHook, _setDelayScale };
