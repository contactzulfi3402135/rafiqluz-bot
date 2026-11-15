'use strict';
/**
 * v6.0.0 — boot sequence.
 * dirs → cloud-restore (BEFORE the DB is opened — it can bring the DB back)
 *      → DB open → password hash → module wiring → WhatsApp connect
 *      → web server → background services.
 */
const fs = require('fs');
const express = require('express');

const cfg = require('./config');
cfg.ensureDirs();

const { ring, logger } = require('./logger');

/* ---------- graceful shutdown (Heroku restarts: save what we can, exit clean) ---------- */
let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  ring.warn('bot.shutdown', `${signal} received — closing WhatsApp cleanly so the login stays valid`);
  try { await require('./persist').flush('deploy-shutdown', 12000); } catch { }   // v7.2: last-second save → no QR after deploy
  try { await require('./numbers').stopAll(); } catch { }
  try { await require('./wa').close(); } catch { }
  try { require('./db').open().close(); } catch { }
  process.exit(0);
}
process.on('SIGTERM', () => shutdown('SIGTERM (Heroku deploy/restart)'));
process.on('SIGINT', () => shutdown('SIGINT'));

/* ---------- crash-safe boot ---------- */
process.on('uncaughtException', (err) => { ring.error('bot.crash', `Uncaught exception: ${err.message}`); try { require('./alerts').maybe('crash', 'Bot hit an uncaught exception', err.message); } catch { } });
process.on('unhandledRejection', (err) => { ring.error('bot.crash', `Unhandled rejection: ${String(err?.message || err).slice(0, 200)}`); try { require('./alerts').maybe('crash', 'Bot hit an unhandled promise rejection', String(err?.message || err).slice(0, 160)); } catch { } });

(async () => {
  ring.info('bot.boot', `Raqifluz Channel Bot v${cfg.config.version} starting (Node ${process.version})`);
  /* v7.6.0: memory breadcrumbs — if a deploy ever crashes at boot again, these
     three lines show exactly where memory ran out (Heroku 512 MB dyno). */
  const _mem = () => { const m = process.memoryUsage(); return `rss=${Math.round(m.rss / 1048576)}MB heap=${Math.round(m.heapUsed / 1048576)}MB`; };
  ring.info('mem.boot', `Memory at boot: ${_mem()}`);

  /* v7.7.1: self-describing boot line + watchdog — a deploy must NEVER die silently.
     (Incident 2026-11-08: a fresh Heroku dyno exited 0 within 450 ms with no error
     line. This line prints the config state the boot is running with, and the
     watchdog turns any stall into a LOUD exit(1) with the stall point named.) */
  {
    const pc = cfg.config.persist;
    ring.info('boot.env', `Boot env: cloud-memory=${pc.repo && pc.token ? 'ON' : 'OFF'}${pc.repo ? ` repo=${pc.repo}@${pc.branch || 'bot-state'}` : ''} token=${pc.token ? `set (…${String(pc.token).slice(-4)})` : 'MISSING'} port=${cfg.config.dashboard.port} publicUrl=${cfg.config.dashboard.publicUrl || 'n/a'}`);
  }
  const bootWatch = setTimeout(() => {
    ring.error('bot.crash', 'Boot watchdog: boot did not finish in 30 s — the last boot.* line above is where it stalled (looking for: web.up, then bot.ready)');
    console.error('BOOT STALLED — see the boot.* lines above; the web server never came up.');
    setTimeout(() => process.exit(1), 200);
  }, 30e3);
  if (bootWatch.unref) bootWatch.unref();

  // 1. cloud memory restore — before DB open (it may restore the DB itself)
  await require('./persist').restoreEarly();
  ring.info('mem.restore', `Memory after cloud-state restore: ${_mem()}`);

  // 2. database (+ keep it small: trim unbounded log/chat tables)
  const { S } = require('./db');
  require('./db').open();
  try { require('./db').pruneForMemory(); } catch { }
  ring.info('mem.ready', `Memory after DB open + trim: ${_mem()}`);

  // 3. first-boot: store the dashboard password as a hash (bcrypt) + owner API key
  const bcrypt = require('bcryptjs');
  if (!S.get('dashboard.password_hash', '')) {
    if (cfg.config.dashboard.password) {
      S.set('dashboard.password_hash', bcrypt.hashSync(cfg.config.dashboard.password, 10));
      ring.info('dashboard.hash', 'Dashboard password stored (bcrypt-hashed)');
    } else {
      ring.warn('dashboard.nopass', 'DASHBOARD_PASSWORD is not set — the dashboard login will refuse logins until it is set (Heroku → Settings → Config Vars)');
    }
  }
  if (!S.get('api.key', '')) {
    S.set('api.key', require('crypto').randomBytes(24).toString('hex'));
    ring.info('apikey.created', 'Owner API key created — visible in Settings → Owner API key');
  }

  // 4. module wiring (listeners attach BEFORE the socket exists)
  require('./channels').init();     // subscriptions, pull safety-net, recovery, auto-setup
  require('./inbox').init();        // WhatsApp-parity inbox archive
  const pipeline = require('./pipeline');
  const wa = require('./wa');
  wa.events.on('wa.message', (m) => { pipeline.intake(m).catch(() => { }); });

  // 5. cloud-memory sync engine armed BEFORE the socket so pairing saves instantly
  require('./persist').start();
  // v7.3.3: ANY settings change (AI keys, channels, switches, ...) queues a cloud
  // save ~5 s after the last change — deploys can no longer roll settings back
  require('./db').S.onChange = () => { try { require('./persist').syncSoon('settings-changed', 5000); } catch { } };

  // 6. WhatsApp engine (main number) + v7 extra numbers manager
  wa.connect().catch((err) => ring.error('wa.connect.fail', `WhatsApp connect failed: ${err.message}`));
  require('./numbers').startAll().catch((err) => ring.warn('num.boot.fail', `Number manager boot issue: ${err.message}`));

  // 7. web server
  const app = express();
  require('./web/server').build(app);
  const server = app.listen(cfg.config.dashboard.port, '0.0.0.0', () => {
    ring.info('web.up', `Dashboard live on port ${cfg.config.dashboard.port} — /login → /admin`);
  });
  /* v7.7.1: a bind failure used to be SILENT — the unhandled 'error' event killed
     the listener, every boot timer is .unref()ed, the event loop drained and Node
     exited 0 with no error line (the 2026-11-08 Heroku incident). Now it is loud. */
  server.on('error', (err) => {
    ring.error('bot.crash', `Web server failed to bind port ${cfg.config.dashboard.port}: ${err.message}`);
    console.error(`WEB SERVER BIND FAILED (port ${cfg.config.dashboard.port}): ${err.message} — check the PORT config var and that no other process holds it. The app cannot serve traffic without it.`);
    setTimeout(() => process.exit(1), 300);
  });

  // 8. background services
  require('./power').start();       // scheduler engine (switch OFF by default)
  require('./queue5a').start();     // 5A: approval/hold queue pump (R37/R43)
  require('./housekeep').start();   // v9.0.0 (repo-slim): media/uptime janitor (keeps the cloud snapshot flat)
  require('./keepalive').start();   // self-ping (PUBLIC_URL-aware) + night pause
  require('./report').start();      // daily WhatsApp report 21:00 PKT
  require('./digest').start();      // AI daily digest (switch OFF by default)
  require('./recap').start();       // 5C (R60): morning recap to your own number (OFF by default)
  require('./wasched').start();     // 5F (R76): scheduled personal WhatsApp sends (30 s tick)
  require('./rss').start();         // 5G (R82): RSS/Atom source type (15-min fetch → same pipeline)
  require('./wacommand').register(); // 5H (R85): WA command channel (off by default, my-number-locked)
  require('./evergreen').start();    // 5H (R86): evergreen recycling (off by default, daily quota)
  require('./autopilot').start();    // 5H (R87): bounded auto-pilot (off by default, capped)
  require('./subs').start();         // 5I (I1): subscriber snapshots (best-effort, read-only)
  require('./email').start();       // email engine (manual sends, switchable accounts)
  try { require('./db').PL.seed(); } catch { /* 5C (R55): prompt library seeds 10 built-ins on first boot */ }
  require('./inbox').uptime.recordBoot('boot');
  try { require('./panic').bootCheck(); } catch { } // 5E (R73): a crash mid-panic keeps the bot stopped

  // 8. memory watchdog (512 MB dyno)
  setInterval(() => {
    const mb = process.memoryUsage().rss / 1048576;
    if (mb > cfg.config.memWarnMb) {
      ring.warn('bot.memory', `Memory ${Math.round(mb)} MB — above the ${cfg.config.memWarnMb} MB guard (512 MB dyno)`);
      if (global.gc) global.gc();
    }
  }, 5 * 60e3).unref?.();

  ring.info('bot.ready', 'Boot complete — follow → clean → publish is armed');
  clearTimeout(bootWatch); // boot finished — disarm the stall watchdog (it only fires if this line is never reached)

  /* v7.3.6: refresh WhatsApp-tab chat names at boot — every chat whose name
     is still a number gets re-resolved against the synced contacts + learned
     profile names (names learned from history/pushName finally show up). */
  try {
    const ib = require('./inbox');
    const nums = ['main', ...require('./db').N.all().map((r) => r.id).filter((id) => id !== 'main')];
    for (const sess of nums) { try { ib.syncChatNames(sess); } catch { } }
    ring.info('inbox.names', `Chat names refreshed for ${nums.length} session(s) at boot`);
  } catch { }
})().catch((err) => {
  ring.error('boot.fail', `Boot failed: ${err.message}`);
  console.error('BOOT FAILED:', err.message);
  setTimeout(() => process.exit(1), 300); // let log streams flush
});
