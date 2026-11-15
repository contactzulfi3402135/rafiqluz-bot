'use strict';
/** v6.0.0 — keep-awake self-ping (Heroku eco dynos sleep after 30 min idle) + nightly pause window. */
const cfg = require('./config');
const { ring } = require('./logger');

function pktMinutes() { return (new Date(Date.now() + 5 * 3600e3)).getUTCHours() * 60 + new Date(Date.now() + 5 * 3600e3).getUTCMinutes(); }

function start() {
  const url = cfg.config.dashboard.publicUrl ? `${cfg.config.dashboard.publicUrl}/healthz` : '';
  const startMin = cfg.config.whatsapp.nightStart; const endMin = cfg.config.whatsapp.nightEnd;
  const nightLen = (endMin - startMin + 1440) % 1440;
  const isNight = (min = pktMinutes()) => nightLen > 0 && ((min - startMin + 1440) % 1440) < nightLen;

  if (url) {
    ring.info('keepawake.armed', `Self-ping keep-awake armed → ${url} every 5 min (night pause ${String(Math.floor(startMin / 60)).padStart(2, '0')}:00–${String(Math.floor(endMin / 60)).padStart(2, '0')}:00 PKT)`);
    setInterval(async () => {
      if (isNight()) return; // let it sleep at night — posts are recovered after wake
      try { await fetch(url, { signal: AbortSignal.timeout(15000) }); } catch { /* best effort */ }
    }, 5 * 60e3).unref?.();
  }
  return { isNight };
}
module.exports = { start };
