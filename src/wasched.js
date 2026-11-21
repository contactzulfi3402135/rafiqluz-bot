/* 5F (R76): SCHEDULED WHATSAPP SENDS — the owner schedules a personal message
   from the linked number to a contact/chat (once / daily / weekly / weekdays /
   every N minutes). Runs on its own 30-second tick in index.js; it sends with
   the normal WhatsApp sendMessage API (subject to the link's own state) and
   never touches the channel pipeline, the queue, or the rate guards.
   Repeat math reuses the 5A scheduler's drift-free advance() (PKT default). */
'use strict';
const db = require('./db');
const wa = require('./wa');
const power = require('./power');
const { ring } = require('./logger');
const { WAS, AUD, NTF } = db;

/** Send every due item for the session. Safe to call from a timer. */
const running = new Set();
async function tick(session = 'main') {
  if (running.has(session) || require('./lifecycle').isStopping() || require('./panic').active()) return;
  const sock = require('./numbers').getSocket(session);
  if (!sock || require('./numbers').statusOf(session) !== 'open') return;
  running.add(session);
  try {
    for (const row of WAS.due(Date.now(),session)) {
      const text = String(row.text || '').slice(0,4096);
      if (!text) continue;
      const ledger = require('./delivery-ledger');
      const source = `wasched:${session}`;
      const occurrence = `${row.id}:${row.at}`;
      const digest = require('crypto').createHash('sha256').update(JSON.stringify({jid:row.jid,text})).digest('hex');
      const claim = ledger.claim(source,occurrence,row.jid,0,digest);
      if (!claim.claimed && claim.state !== 'accepted') continue;
      if (claim.claimed) {
        try {
          const result = await sock.sendMessage(row.jid,{text});
          ledger.finish(source,occurrence,row.jid,0,'accepted',result?.key?.id || '', 'Provider accepted; delivery not confirmed');
        } catch (err) {
          ledger.finish(source,occurrence,row.jid,0,'uncertain','',String(err.message || err));
          ring.warn('wasched.uncertain',`Scheduled send outcome unknown; review before retry: ${String(err.message || err).slice(0,100)}`);
          continue;
        }
      }
      const current = WAS.get(row.id);
      if (!current || current.at !== row.at) continue;
      const next = nextRun(row);
      db.open().prepare('UPDATE wa_scheduled SET sent=sent+1,last_sent=?,at=?,enabled=? WHERE id=? AND at=?').run(new Date().toISOString(),next || row.at,next ? current.enabled : 0,row.id,row.at);
      AUD.log('queue','wasched.sent',`Scheduled send accepted by provider (${row.repeat}) to ${row.jid}; delivery not confirmed`);
      ring.info('wasched.sent',`Scheduled send accepted by provider to ${row.jid}`);
      try { require('./webhooks').fire('wasched.sent',{to:row.name || row.jid,repeat:row.repeat,text:text.slice(0,120)}); } catch {}
    }
  } finally { running.delete(session); }
}

/** Start the 30-second tick (called from index.js boot, like the other engines). */
function start() {
  setInterval(() => {
    const nums = ['main', ...db.N.all().map((r) => r.id).filter((id) => id !== 'main')];
    for (const sess of nums) { try { tick(sess).catch(() => { }); } catch { } }
  }, 30 * 1000).unref?.();
  ring.info('wasched.ready', 'Scheduled WhatsApp sends armed (30 s tick)');
}

/** Next run time after `at` (drift-free; reuses the 5A scheduler math). */
function nextRun(row) {
  const job = {
    at: row.at, repeat: row.repeat,
    weekdays: row.weekdays || '', intervalMin: row.interval_min || 0, tz: row.tz || 'Asia/Karachi'
  };
  return power.advance(job);
}

/** Create a send. `localAt` is a PKT wall-clock "YYYY-MM-DDTHH:MM" (UI sends local). */
function add({ session, jid, text, localAt, repeat = 'once', weekdays = '', intervalMin = 0 }) {
  const rep = ['once', 'daily', 'weekly', 'weekdays', 'interval'].includes(repeat) ? repeat : 'once';
  const atIso = power.localToUtc(String(localAt || ''), 'Asia/Karachi');
  if (!atIso || !jid || !String(text || '').trim()) throw new Error('A contact, message and time are required.');
  const id = WAS.add({
    session, jid, text,
    at: rep === 'interval' ? new Date(Math.max(Date.now(), Date.parse(atIso))).toISOString() : atIso,
    repeat: rep, weekdays: rep === 'weekdays' ? String(weekdays || '1,2,3,4,5') : '',
    interval_min: rep === 'interval' ? Math.max(1, Math.min(10080, parseInt(intervalMin, 10) || 30)) : 0
  });
  if (!id) throw new Error('Could not save the scheduled send.');
  try { AUD.log('owner', 'wasched.add', `Scheduled send created (${rep}) to ${jid} — ${String(text || '').slice(0, 80)}`); } catch { }
  return WAS.get(id);
}

module.exports = { tick, start, add, nextRun };
