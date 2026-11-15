'use strict';
/**
 * v6.1.0 — AI DAILY DIGEST (switch OFF by default): once a day at the
 * configured time (default 22:00 PKT), the AI turns everything published
 * today into one attractive "📰 DAILY DIGEST" post and publishes it to the
 * targets. If AI is unavailable the digest is skipped with an honest log —
 * it never posts a raw list.
 */
const cfg = require('./config');
const { ring } = require('./logger');
const { S, A } = require('./db');
const ai = require('./ai');
const publishMod = require('./publish');
const wa = require('./wa');

function pktHHMM() { const d = new Date(Date.now() + 5 * 3600e3); return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`; }
function pktDate() { return new Date(Date.now() + 5 * 3600e3).toISOString().slice(0, 10); }

function start() {
  setInterval(async () => {
    try {
      if (require('./panic').active()) return; // 5E (R73): panic stop
      if (!S.getBool('power.digest.on', false)) return;
      const at = String(S.get('digest.at', '22:00')).trim() || '22:00';
      if (pktHHMM() !== at) return;
      const today = pktDate();
      if (S.get('digest.lastdate', '') === today) return;
      S.set('digest.lastdate', today); // set first — a failure never spams retries

      const sock = wa.getSocket();
      if (!sock || wa.getStatus().status !== 'open') { ring.warn('digest.skip', 'Daily digest skipped — WhatsApp is not connected right now'); return; }
      const rows = require('./db').open().prepare(
        "SELECT reason FROM posts WHERE status='published' AND created_at >= date('now','-1 day') AND source_jid NOT LIKE 'system:%' ORDER BY id DESC LIMIT 60"
      ).all().map((r) => r.reason).filter(Boolean);
      if (rows.length < 3) { ring.info('digest.skip', 'Daily digest skipped — fewer than 3 posts today'); return; }

      const lang = String(S.get('ai.translate.lang', '')).trim();
      const digest = await ai.summarize(rows, lang || undefined);
      if (!digest || digest.length < 30) throw new Error('AI returned an empty digest');

      const res = await publishMod.publish({ text: digest }, { sourceJid: 'system:digest', sourceMsgId: `digest-${today}`, norm: 'AI daily digest' });
      if (res.sent) ring.info('digest.sent', `AI daily digest published to ${res.sent} target(s) — ${rows.length} posts summarized`);
      else ring.warn('digest.fail', `Daily digest could not be published: ${(res.errors || []).join(' | ').slice(0, 140)}`);
    } catch (err) {
      ring.warn('digest.fail', `Daily digest could not be created: ${String(err.message).slice(0, 140)} — will try again tomorrow`);
    }
  }, 30000).unref?.();
}
module.exports = { start };
