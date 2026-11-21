'use strict';
/**
 * 5C (R60) — MORNING RECAP (switch OFF by default): once a day at the set time
 * (default 07:00 PKT) it sends a DETERMINISTIC (no AI) recap of the previous
 * 24 hours to the owner's OWN number: published / skipped / failed counts,
 * the failed reasons, and the jobs scheduled next. Nothing is published to
 * any channel — it is a private message to yourself.
 */
const { ring } = require('./logger');
const { S, AUD } = require('./db');
const wa = require('./wa');
const power = require('./power');

function pktHHMM() { const d = new Date(Date.now() + 5 * 3600e3); return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`; }
function pktDate() { return new Date(Date.now() + 5 * 3600e3).toISOString().slice(0, 10); }

/** Yesterday's deterministic recap text. Pure function of the DB handle. */
function buildRecap(d) {
  const rows = d.prepare(`SELECT status, COUNT(*) n FROM posts
    WHERE created_at >= datetime('now','-1 day') AND source_jid NOT LIKE 'system:%'
    GROUP BY status`).all();
  const n = (s) => (rows.find((r) => r.status === s) || {}).n || 0;
  const fails = d.prepare(`SELECT substr(reason,1,60) r FROM posts
    WHERE status='failed' AND created_at >= datetime('now','-1 day')
    GROUP BY r ORDER BY r LIMIT 4`).all();
  const today = pktDate();
  const upcoming = [];
  for (const j of power.jobs()) {
    if (!j.enabled) continue;
    const day = String(j.at || '').slice(0, 10);
    if (j.repeat === 'once' ? (day === today) : (day <= today)) upcoming.push(j);
  }
  const lines = [
    'Good morning — yesterday:',
    `Published: ${n('published')}   Skipped: ${n('skipped')}   Failed: ${n('failed')}`
  ];
  if (fails.length) lines.push('Failed: ' + fails.map((f) => f.r).join(' | '));
  if (upcoming.length) lines.push('Up next: ' + upcoming.slice(0, 5).map((j) => `${j.name || 'post'} (${j.repeat})`).join(', '));
  return lines.join('\n');
}

function start() {
  setInterval(async () => {
    try {
      if (require('./panic').active() || require('./lifecycle').isStopping()) return; // 5E (R73): panic stop
      if (!S.getBool('power.recap.on', false)) return;
      const at = String(S.get('recap.at', '07:00')).trim() || '07:00';
      if (pktHHMM() !== at) return;
      const today = pktDate();
      if (S.get('recap.lastdate', '') === today) return;
      S.set('recap.lastdate', today); // set first — a failure never spams retries
      const sock = wa.getSocket();
      if (!sock || wa.getStatus().status !== 'open') { ring.warn('recap.skip', 'Morning recap skipped — WhatsApp is not connected right now'); return; }
      const phone = String(S.get('report.phone', '')).replace(/\D/g, '');
      if (!/^\d{8,15}$/.test(phone)) { ring.warn('recap.skip', 'Morning recap skipped — no owner phone number in Settings · Reports'); return; }
      const text = buildRecap(require('./db').open());
      await sock.sendMessage(phone + '@s.whatsapp.net', { text: text.slice(0, 3000) });
      AUD.log('bot', 'recap.sent', `Morning recap sent to +${phone}`);
      ring.info('recap.sent', `Morning recap sent to +${phone}`);
    } catch (err) {
      ring.warn('recap.fail', `Morning recap failed: ${String(err.message).slice(0, 140)}`);
    }
  }, 30000).unref?.();
}
module.exports = { start, buildRecap };
