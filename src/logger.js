'use strict';
/** v6.0.0 — logging: console + daily file + DB ring (dashboard Live Logs, 14 days). */
const path = require('path');
const fs = require('fs');
const pino = require('pino');

const cfg = require('./config');
const LOG_DIR = cfg.config.paths.logs;

const logger = pino(
  { level: process.env.LOG_LEVEL || 'info' },
  pino.multistream([
    { stream: process.stdout }, // Heroku log drain
    { stream: pino.destination({ dest: path.join(LOG_DIR, `bot-${new Date().toISOString().slice(0, 10)}.log`), mkdir: true, sync: true }) }
  ])
);
/* sync: true — the file opens synchronously at boot, so a fast process.exit
   (tests) can never hit a "sonic boom is not ready yet" flush race. */
const baileysLogger = pino({ level: 'warn' }, pino.destination({ dest: path.join(LOG_DIR, 'baileys.log'), mkdir: true, sync: true }));

// WhatsApp's newsletter engagement telemetry (reaction/forward counts) is pure
// noise at warn level — demote to debug (v5.7.37 lesson).
const origWarn = baileysLogger.warn.bind(baileysLogger);
baileysLogger.warn = (obj, msg, ...rest) => {
  try {
    const text = `${obj?.message || ''} ${typeof msg === 'string' ? msg : ''}`;
    if (/Unknown newsletter notification/i.test(text)) return baileysLogger.debug(obj, msg, ...rest);
  } catch { /* never break logging */ }
  return origWarn(obj, msg, ...rest);
};

/** DB-backed log ring for the dashboard (populated once db.js is up). */
const ring = {
  db: null,
  info(code, msg, extra) { write('info', code, msg, extra); },
  warn(code, msg, extra) { write('warn', code, msg, extra); },
  error(code, msg, extra) { write('error', code, msg, extra); }
};
function write(level, code, msg, extra) {
  logger[level === 'error' ? 'error' : level]({ code, extra: extra || undefined }, msg || code);
  try {
    ring.db?.prepare("INSERT INTO logs(ts, level, code, msg, extra) VALUES(datetime('now'),?,?,?,?)")
      .run(level, String(code || '').slice(0, 48), String(msg || '').slice(0, 500), extra ? JSON.stringify(extra).slice(0, 500) : null);
    ring.db?.prepare("DELETE FROM logs WHERE ts < datetime('now', '-14 days')").run();
  } catch { /* best effort */ }
  try { logEvents.emit('log', { level, code: String(code || ''), msg: String(msg || '').slice(0, 160) }); } catch { /* never break logging */ }
}

/* v7.6.0 (R24): in-process event tap for the dashboard SSE feed */
const logEvents = new (require('events').EventEmitter)();

module.exports = { logger, baileysLogger, ring, logEvents };
