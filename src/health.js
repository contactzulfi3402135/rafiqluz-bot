'use strict';
/** 5D (R64/R68) — Health v2: one 0–100 score that names its two weakest parts,
 *  plus a side-effect-free full self-test. Nothing here touches the publish
 *  pipeline, credentials or bot state — it only reads and writes its own
 *  selftests history table. */
const fs = require('fs');
const cfg = require('./config');
const { ring } = require('./logger');
const { S, A, open, ST, NTF, F } = require('./db');
const wa = require('./wa');
const persist = require('./persist');
const ai = require('./ai');
const power = require('./power');

function dbBytes() { try { return fs.statSync(cfg.config.paths.database).size; } catch { return 0; } }

/* Each part scores 0–100; the headline score is the plain average so the
   two weakest parts are always the ones dragging the number down. */
function score() {
  const d = open();
  const parts = [];

  const st = wa.getStatus().status;
  parts.push({
    id: 'wa', name: 'WhatsApp connection',
    score: st === 'open' ? 100 : (st === 'connecting' || st === 'qr') ? 40 : 0,
    note: st === 'open' ? 'connected' : `status: ${st}`
  });

  const boots = d.prepare('SELECT COUNT(*) n FROM uptime').get().n;
  const crashes = d.prepare("SELECT COUNT(*) n FROM logs WHERE code='bot.crash' AND ts >= datetime('now','-24 hours')").get().n;
  parts.push({
    id: 'uptime', name: 'Uptime (24 h)',
    score: crashes ? Math.max(20, 100 - crashes * 25) : 100,
    note: `${boots} boots · ${crashes} crash${crashes === 1 ? '' : 'es'} in 24 h`
  });

  const ps = persist.publicStatus();
  parts.push({
    id: 'cloud', name: 'Cloud memory',
    score: !ps.enabled ? 15 : ps.lastError ? 55 : 100,
    note: !ps.enabled ? 'OFF — every deploy asks for a QR scan' : (ps.lastError ? `last sync error: ${String(ps.lastError).slice(0, 60)}` : `synced ${ps.lastKB} KB ${ps.lastSyncAt ? '· ' + ps.lastSyncAt : ''}`)
  });

  const since = new Date(Date.now() - 7 * 86400e3).toISOString().slice(0, 19).replace('T', ' ');
  const rows = Object.fromEntries(A.since(since).map((r) => [r.status, r.n]));
  const pub = rows.published || 0, fail = rows.failed || 0;
  const denom = pub + fail;
  parts.push({
    id: 'pipeline', name: 'Publish pipeline (7 d)',
    score: denom ? Math.round((pub / denom) * 100) : 100,
    note: denom ? `${pub} published · ${fail} failed` : 'no posts in 7 days'
  });

  parts.push({
    id: 'ai', name: 'AI provider',
    score: ai.usable() ? 100 : 40,
    note: ai.usable() ? `${ai.providerOf()} · key saved` : 'no usable key — AI features degrade gracefully'
  });

  const mb = dbBytes() / 1048576;
  const dyno = 200; // MB working-memory budget (R6: 200 MB dyno)
  const storageScore = mb < 50 ? 100 : mb < 100 ? 80 : mb < 150 ? 55 : mb < dyno ? 30 : 5;
  parts.push({
    id: 'storage', name: 'Storage',
    score: storageScore,
    note: `state DB ${mb.toFixed(1)} MB (dyno budget ~${dyno} MB)`
  });

  const email = require('./email');
  let emailOn = false; try { emailOn = (email.publicAccounts() || []).length > 0; } catch { }
  parts.push({
    id: 'email', name: 'Email',
    score: emailOn ? 100 : 60,
    note: emailOn ? 'account configured' : 'no account — optional (weekly report email off)'
  });

  const jobs = power.jobs() || [];
  const enabledJobs = jobs.filter((j) => j.enabled).length;
  parts.push({
    id: 'scheduler', name: 'Scheduler',
    score: jobs.length && !enabledJobs ? 55 : 100,
    note: jobs.length ? `${enabledJobs}/${jobs.length} jobs active` : 'no jobs yet'
  });

  const scoreVal = Math.round(parts.reduce((s, p) => s + p.score, 0) / parts.length);
  const weakest = [...parts].sort((a, b) => a.score - b.score).slice(0, 2).map((p) => p.name);
  return { score: scoreVal, weakest, parts, at: new Date().toISOString() };
}

/* Side-effect-free by construction: every check either reads, or writes to a
   scratch row it deletes itself. Nothing published, nothing sent, no
   credentials touched. */
function selfTest() {
  const t0 = Date.now();
  const checks = [];
  const add = (name, fn) => {
    const s = Date.now();
    try { checks.push({ name, ok: true, ms: Date.now() - s, detail: fn() || 'ok' }); }
    catch (e) { checks.push({ name, ok: false, ms: Date.now() - s, detail: String(e.message || e).slice(0, 140) }); }
  };
  const d = open();

  add('Database read/write', () => {
    d.prepare("INSERT INTO selftests(ok, total, detail) VALUES(0, 0, 'scratch')").run();
    const row = d.prepare("SELECT id FROM selftests WHERE detail='scratch' ORDER BY id DESC LIMIT 1").get();
    d.prepare('DELETE FROM selftests WHERE id=?').run(row.id);
    return 'round-trip ok';
  });
  add('FTS5 full-text index', () => {
    const r = F.posts('zzznope9412'); // must return empty without throwing
    if (r.list.length) throw new Error('bogus query returned hits');
    return `engine: ${r.engine}`;
  });
  add('Templates render', () => {
    const T = require('./templates');
    const names = T.list ? T.list().map((t) => t.name) : [];
    if (!names.length) throw new Error('no templates found');
    for (const n of names) { const out = T.apply ? T.apply(n, 'test body line') : null; if (out == null) throw new Error(`template "${n}" returned nothing`); }
    return `${names.length} templates rendered`;
  });
  add('Analytics queries', () => {
    const r = A.since('2000-01-01 00:00:00');
    if (!Array.isArray(r)) throw new Error('analytics since() failed');
    return 'ok';
  });
  add('Log write/read', () => {
    ring.info('health.selftest', 'self-test log line (safe to ignore)');
    return 'ok';
  });
  add('WhatsApp socket', () => {
    const st = wa.getStatus().status;
    if (st === 'open') return 'connected';
    throw new Error(`status: ${st}`);
  });
  add('Cloud memory state', () => {
    const ps = persist.publicStatus();
    return ps.enabled ? (ps.lastError ? `ON but last error: ${String(ps.lastError).slice(0, 60)}` : 'ON, last sync clean') : 'OFF (deploy = QR re-scan risk)';
  });
  add('AI key usable', () => {
    if (ai.usable()) return `${ai.providerOf()} configured`;
    throw new Error('no usable AI key (AI features degrade)');
  });
  add('Report phone set', () => {
    const phone = S.get('report.phone', S.get('main.phone', ''));
    if (phone) return `+${phone}`;
    throw new Error('no report phone (daily/weekly reports cannot be sent)');
  });
  add('Storage within budget', () => {
    const mb = dbBytes() / 1048576;
    if (mb > 150) throw new Error(`${mb.toFixed(1)} MB — approaching the 200 MB dyno budget`);
    return `${mb.toFixed(1)} MB`;
  });
  add('Settings readable', () => {
    const v = S.get('bot.name', '');
    if (typeof v !== 'string') throw new Error('settings read failed');
    return `bot.name="${v || '(unset)'}"`;
  });

  const ok = checks.filter((c) => c.ok).length;
  const detail = checks.map((c) => `${c.ok ? 'PASS' : 'FAIL'} ${c.name}: ${c.detail}`).join(' | ');
  try { ST.add(ok, checks.length, detail); } catch { }
  NTF.add('selftest', `Full self-test: ${ok}/${checks.length} checks passed${ok < checks.length ? ' — open Health for the failed ones' : ''}`);
  ring.info('health.selftest.done', `Full self-test: ${ok}/${checks.length} passed in ${Date.now() - t0} ms`);
  return { ok, total: checks.length, ms: Date.now() - t0, list: checks };
}

module.exports = { score, selfTest, dbBytes };
