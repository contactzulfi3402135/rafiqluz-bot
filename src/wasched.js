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
async function tick(session = 'main') {
  if (require('./panic').active()) return; // 5E (R73): panic stop freezes scheduled sends
  const sock = wa.getSocket();
  if (!sock || wa.getStatus().status !== 'open') return; // link not ready — items wait, nothing is lost
  const due = WAS.due(Date.now(), session);
  for (const row of due) {
    try {
      const name = String((row.name || '') || '').slice(0, 60);
      const text = String(row.text || '').slice(0, 4096);
      if (!text) continue;
      await sock.sendMessage(row.jid, { text });
      const nowIso = new Date().toISOString();
      WAS.markSent(row.id, nowIso);
      const next = nextRun(row);
      if (row.repeat === 'once' || !next) {
        WAS.setEnabled(row.id, false);
      } else {
        db.open().prepare('UPDATE wa_scheduled SET at=? WHERE id=?').run(next, row.id);
      }
      try { AUD.log('queue', 'wasched.sent', `Scheduled send delivered (${row.repeat}) to ${name || row.jid} — ${text.slice(0, 80)}`); } catch { }
      ring.info('wasched.sent', `Scheduled send delivered to ${name || row.jid} (${row.repeat})`);
      try { require('./webhooks').fire('wasched.sent', { to: name || row.jid, repeat: row.repeat, text: text.slice(0, 120) }); } catch { } // 5G (R80)
    } catch (err) {
      // not connected / contact not on WhatsApp / transient: retry gently (1 min), never lost
      const retry = new Date(Date.now() + 60e3).toISOString();
      db.open().prepare('UPDATE wa_scheduled SET at=? WHERE id=?').run(retry, row.id);
      ring.warn('wasched.fail', `Scheduled send to ${row.jid} failed — retrying in 1 min: ${String(err?.message || err).slice(0, 120)}`);
    }
  }
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
