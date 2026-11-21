'use strict';
/** 5D (R65) — Instant alerts. OFF by default (R8). When ON, the owner's own
 *  number gets a WhatsApp message the moment something breaks (publish
 *  failures, WhatsApp disconnect, bot crash, report failure). Every alert
 *  TYPE has a hard 30-minute cooldown, so a failure storm never becomes a
 *  message storm. The cooldown stamp is written BEFORE the send: a send that
 *  fails will not re-spam on the next tick. */
const { S, NTF } = require('./db');
const { ring } = require('./logger');
const wa = require('./wa');

const COOLDOWN_MS = 30 * 60e3;

const enabled = () => S.getBool('power.instantalerts.on', false);

function maybe(type, title, detail) {
  try {
    if (require('./panic').active() || require('./lifecycle').isStopping()) return {sent:false,why:'panic stop or shutdown'};
    if (!enabled()) return { sent: false, why: 'off' };
    const last = Number(S.get(`alerts.last.${type}`, 0)) || 0;
    if (Date.now() - last < COOLDOWN_MS) return { sent: false, why: 'cooldown (30 min per type)' };
    const phone = S.get('report.phone', S.get('main.phone', ''));
    if (!phone) return { sent: false, why: 'no report phone set' };
    const sock = wa.getSocket();
    if (!sock || wa.getStatus().status !== 'open') return { sent: false, why: 'WhatsApp not connected' };
    S.set(`alerts.last.${type}`, String(Date.now()));
    const text = ['🚨 *' + title + '*', detail ? String(detail).slice(0, 160) : '', '', '_Instant alert · 30-min cooldown per type — repeats are logged, not messaged._'].filter((l, i) => l || i < 3).join('\n');
    Promise.resolve(sock.sendMessage(`${phone}@s.whatsapp.net`, { text })).catch(()=>ring.warn('alert.uncertain',`Instant alert (${type}) outcome is unknown`));
    NTF.add('alert', `${title}${detail ? ' — ' + String(detail).slice(0, 100) : ''}`);
    ring.warn('alert.requested', `Instant alert (${type}) requested to +${phone}; delivery is not confirmed`);
    try { require('./webhooks').fire('alert', { type, title, detail: String(detail || '').slice(0, 160) }); } catch { } // 5G (R80)
    return { sent: false, started: true, why: 'Alert request started; delivery is not confirmed.' };
  } catch (e) {
    ring.warn('alert.fail', `Instant alert (${type}) failed: ${String(e.message || e).slice(0, 120)}`);
    return { sent: false, why: String(e.message || e).slice(0, 80) };
  }
}

module.exports = { enabled, maybe, COOLDOWN_MS };
