'use strict';
/** v6.0.0 — daily WhatsApp report to the owner: published / failed / skipped.
 *  5D (R63) — weekly report: WA + email, plus deterministic text/CSV builders
 *  reused by the Analytics export endpoints. The daily behavior is untouched. */
const cfg = require('./config');
const { ring } = require('./logger');
const { S, A } = require('./db');
const wa = require('./wa');

function pktHHMM() { const d = new Date(Date.now() + 5 * 3600e3); return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`; }
function pktDate() { return new Date(Date.now() + 5 * 3600e3).toISOString().slice(0, 10); }
function pktDayName() { const d = new Date(Date.now() + 5 * 3600e3); return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getUTCDay()]; }
/* Monday of the current PKT week — the weekly report's "already sent" guard key */
function weekKey() {
  const d = new Date(Date.now() + 5 * 3600e3);
  const dow = (d.getUTCDay() + 6) % 7; // Mon=0
  const mon = new Date(d.getTime() - dow * 86400e3);
  return mon.toISOString().slice(0, 10);
}

function weeklyConfig() {
  const at = String(S.get('weekly.at', 'Mon 09:00')).trim();
  const m = at.match(/^(\w{3})\s+(\d{1,2}):(\d{2})$/);
  const day = m ? m[1].slice(0, 3) : 'Mon';
  const hh = m ? String(parseInt(m[2], 10)).padStart(2, '0') : '09';
  const mm = m ? m[3] : '00';
  return { at: `${day} ${hh}:${mm}`, day, hhmm: `${hh}:${mm}` };
}

/* Deterministic weekly summary — pure DB reads, so tests and the
 * "send now" button see exactly what the schedule will send. */
function weeklyText() {
  const since = new Date(Date.now() - 7 * 86400e3).toISOString().slice(0, 19).replace('T', ' ');
  const rows = Object.fromEntries(A.since(since).map((r) => [r.status, r.n]));
  const pub = rows.published || 0, fail = rows.failed || 0, skip = rows.skipped || 0, edit = rows.edited || 0;
  const sources = A.perSource(since).slice(0, 5);
  const dir = (() => { try { return require('./db').CH.dirList(); } catch { return []; } })();
  const names = Object.fromEntries(dir.map((c) => [c.jid, c.name || c.jid]));
  const media = A.mediaSplit(since);
  const reasons = A.skipReasons(since).slice(0, 3);
  const normReason = (r) => String(r || '').split(':')[0].split('(')[0].trim() || 'other';
  const reasonCount = {};
  for (const r of A.skipReasons(since)) reasonCount[normReason(r.reason)] = (reasonCount[normReason(r.reason)] || 0) + r.n;
  const topReasons = Object.entries(reasonCount).sort((a, b) => b[1] - a[1]).slice(0, 3);
  const lines = [
    '📊 *RAQIFLUZ WEEKLY REPORT*',
    `${weekKey()} week (last 7 days)`, '',
    `Published: ${pub}   Edited: ${edit}   Skipped: ${skip}   Failed: ${fail}`,
    `Media posts: ${media.withMedia}   Text posts: ${media.text}`, ''
  ];
  if (sources.length) {
    lines.push('*Top sources:*');
    for (const s of sources) lines.push(`• ${names[s.jid] || s.jid}: ${s.n}`);
    lines.push('');
  }
  if (topReasons.length) {
    lines.push('*Why things were skipped:*');
    for (const [r, n] of topReasons) lines.push(`• ${r}: ${n}`);
    lines.push('');
  }
  lines.push(fail ? `⚠️ ${fail} post(s) FAILED this week — Health tab for details.` : '✅ No failures this week.');
  lines.push('_Analytics tab → full numbers, goals and exports._');
  return lines.join('\n');
}

async function sendWeekly({ now = false } = {}) {
  const text = weeklyText();
  const sent = [];
  const phone = S.get('report.phone', S.get('main.phone', ''));
  const sock = wa.getSocket();
  if (sock && wa.getStatus().status === 'open' && phone) {
    try {
      await sock.sendMessage(`${phone}@s.whatsapp.net`, { text });
      sent.push(`WhatsApp +${phone}`);
    } catch (e) { ring.warn('weekly.wa.fail', `Weekly report WA send failed: ${e.message}`); }
  } else {
    ring.warn('weekly.wa.skip', 'Weekly report: no WhatsApp connection/phone — email only (if configured)');
  }
  /* Email goes to the owner's own default account (send-to-self — the only
     address the bot knows belongs to the owner; no new setting invented). */
  let emailErr = '';
  try {
    const email = require('./email');
    const accts = email.publicAccounts() || [];
    const self = (accts.find((a) => a.isDefault) || accts[0] || {}).user || '';
    if (!self) throw new Error('no email account connected');
    const r = await email.sendOrQueue({ to: self, subject: `Raqifluz weekly report — ${weekKey()}`, body: text.replace(/\*/g, '') });
    if (r && r.queued) sent.push('email (queued)');
    else sent.push(`email ${self}`);
  } catch (e) { emailErr = String(e.message || e).slice(0, 120); }
  const ok = sent.length > 0;
  if (now) ring.info('weekly.sent.now', `Weekly report sent now: ${sent.join(', ') || 'nowhere'}`);
  else { S.set('weekly.lastweek', weekKey()); ring.info('weekly.sent', `Weekly report sent: ${sent.join(', ') || 'nowhere (no channel available)'}`); }
  require('./db').NTF.add('weekly', `Weekly report ${ok ? 'sent to ' + sent.join(', ') : 'could not be delivered anywhere'}`);
  if (!ok) require('./alerts').maybe('report', 'Weekly report could not be delivered', emailErr || 'no WhatsApp connection and no email account');
  return { ok, sent, emailErr, text: text.slice(0, 400) };
}

function start() {
  setInterval(async () => {
    try {
      if (require('./panic').active()) return; // 5E (R73): panic stop
      if (!S.getBool('report.enabled', true)) return;
      if (pktHHMM() !== cfg.config.reportAt) return;
      const today = pktDate();
      if (S.get('report.lastdate', '') === today) return;
      S.set('report.lastdate', today); // set first — a failure never spams retries

      const phone = S.get('report.phone', S.get('main.phone', ''));
      if (!phone) { ring.warn('report.fail', 'Daily report could not be sent: no report phone set (Uptime tab)'); return; }
      const since = new Date(Date.now() - 24 * 3600e3).toISOString().slice(0, 19).replace('T', ' ');
      const rows = Object.fromEntries(A.since(since).map((r) => [r.status, r.n]));
      const text = [
        '📊 *RAQIFLUZ DAILY REPORT*', '',
        `Published: ${rows.published || 0}   Edited: ${rows.edited || 0}   Skipped: ${rows.skipped || 0}`,
        rows.failed ? `⚠️ FAILED: ${rows.failed}` : '✅ No failures — everything published cleanly.',
        '', '_Logs tab → every detail._'
      ].join('\n');

      const sock = wa.getSocket();
      if (!sock) throw new Error('WhatsApp not connected');
      await sock.sendMessage(`${phone}@s.whatsapp.net`, { text }); // object form — the v5.7.32 lesson
      ring.info('report.sent', `Daily report sent to +${phone}`);
    } catch (err) {
      ring.warn('report.fail', `Daily report could not be sent: ${String(err.message).slice(0, 140)}`);
      require('./alerts').maybe('report', 'Daily report could not be sent', err.message); // 5D (R65)
    }
  }, 30000).unref?.();

  /* 5D (R63) — the weekly run: same 30 s tick, PKT day+time match, week guard */
  setInterval(async () => {
    try {
      if (require('./panic').active()) return; // 5E (R73): panic stop
      if (!S.getBool('power.weekly.on', false)) return;
      const w = weeklyConfig();
      if (pktDayName() !== w.day || pktHHMM() !== w.hhmm) return;
      if (S.get('weekly.lastweek', '') === weekKey()) return;
      await sendWeekly({ now: false });
    } catch (err) {
      ring.warn('weekly.fail', `Weekly report failed: ${String(err.message).slice(0, 140)}`);
    }
  }, 30000).unref?.();
}

module.exports = { start, weeklyText, sendWeekly, weeklyConfig, weekKey };
