'use strict';
/*
 * 5D (v7.8.0) — unit tests for the insights build:
 *  1. idempotent 5D migrations on a populated DB copy (R3) + FTS5 rebuild path
 *  2. R61 analytics v2 — per-target, per-source-full, skip reasons, media split, PKT heatmap
 *  3. R62 goals — CRUD
 *  4. R63 weekly report — config parsing + deterministic text + no-channel safety
 *  5. R65 instant alerts — off by default, 30-min cooldown per type
 *  6. R64 health score — 0–100, weakest-two naming, parts math
 *  7. R64 full self-test — runs clean, scratch rows removed, history stored
 *  8. R66 notification center — add/unread/read-one/read-all
 *  9. R67 FTS5 full-text — posts/logs/chats, update + delete triggers
 *  10. R63 exports — CSV quoting + PDF structure (xref offsets verified)
 */
const fs = require('fs');
const path = require('path');

process.env.DATABASE_PATH = 'data/t764-test/bot.sqlite';
process.env.SESSION_DIR = 'data/t764-test/sessions';
const DBFILE = path.resolve(__dirname, '..', 'data', 't764-test', 'bot.sqlite');
fs.rmSync(path.dirname(DBFILE), { recursive: true, force: true });
fs.mkdirSync(path.dirname(DBFILE), { recursive: true });

let passed = 0, failed = 0;
const ok = (cond, label) => { if (cond) { passed += 1; console.log('  ok  ' + label); } else { failed += 1; console.error('  FAIL ' + label); } };

const now = Date.now();
const ts = (msAgo) => new Date(now - msAgo).toISOString().slice(0, 19).replace('T', ' ');
const H = 3600e3, D = 86400e3;

(async () => {
  const db = require('../src/db');
  db.open();
  const d = db.open();
  const D3 = require('better-sqlite3');

  /* seed: 2 sources, 2 targets, mixed statuses + media + skips */
  const insPost = (jid, mid, status, reason, body, media, at) =>
    d.prepare("INSERT INTO posts(source_jid, source_msg_id, status, reason, body, has_media, created_at) VALUES(?,?,?,?,?,?,?)")
      .run(jid, mid, status, reason || '', body || '', media ? 1 : 0, at || ts(1 * H));
  insPost('111@s.whatsapp.net', 'm1', 'published', '', 'Alpha alpha beta gamma', 1, ts(2 * H));
  insPost('111@s.whatsapp.net', 'm2', 'published', '', 'Beta delta epsilon', 0, ts(26 * H));
  insPost('222@s.whatsapp.net', 'm3', 'published', '', 'Gamma zeta eta theta', 0, ts(50 * H));
  insPost('222@s.whatsapp.net', 'm4', 'skipped', 'near-duplicate', '', 0, ts(3 * H));
  insPost('222@s.whatsapp.net', 'm5', 'skipped', 'blocklist: winner', '', 0, ts(5 * H));
  insPost('111@s.whatsapp.net', 'm6', 'failed', 'rate guard: 30/h limit reached', '', 0, ts(7 * H));
  insPost('333@s.whatsapp.net', 'm7', 'edited', '', 'Eta theta iota', 1, ts(10 * H));
  const pid1 = d.prepare("SELECT id FROM posts WHERE source_msg_id='m1'").get().id;
  const pid2 = d.prepare("SELECT id FROM posts WHERE source_msg_id='m2'").get().id;
  d.prepare('INSERT INTO post_keys(post_id, target_jid, msg_id) VALUES(?,?,?)').run(pid1, '999@s.whatsapp.net', 'k1');
  d.prepare('INSERT INTO post_keys(post_id, target_jid, msg_id) VALUES(?,?,?)').run(pid1, '888@s.whatsapp.net', 'k2');
  d.prepare('INSERT INTO post_keys(post_id, target_jid, msg_id) VALUES(?,?,?)').run(pid2, '999@s.whatsapp.net', 'k3');

  /* ---------- 1 · 5D migrations (R3) ---------- */
  console.log('\n[1] 5D migrations on populated copy');
  {
    ok(d.prepare("PRAGMA table_info(posts)").all().some((c) => c.name === 'has_media'), 'posts.has_media column added (R61)');
    const tables = d.prepare("SELECT name FROM sqlite_master WHERE type IN ('table','view') AND name IN ('goals','notifications','selftests')").all().map((r) => r.name).sort();
    ok(JSON.stringify(tables) === JSON.stringify(['goals', 'notifications', 'selftests']), '5D tables created on boot');
    const fts = d.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('posts_fts','logs_fts','inbox_fts')").all().map((r) => r.name).sort();
    ok(fts.length === 3, 'FTS5 virtual tables created (got: ' + fts.join(',') + ')');
    /* idempotent SCHEMA_5D re-run on a populated byte copy */
    db.NTF.add('test', 'seed notification');
    d.pragma('wal_checkpoint(TRUNCATE)');
    const copy = path.join(path.dirname(DBFILE), 'copy.sqlite');
    fs.copyFileSync(DBFILE, copy);
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'db.js'), 'utf8');
    const m = src.match(/const SCHEMA_5D = `([\s\S]*?)`;/);
    const c = new D3(copy);
    for (const stmt of m[1].split(/;\s*\n/)) { const o = stmt.trim(); if (o) { try { c.exec(o + ';'); } catch (e) { throw new Error('SCHEMA_5D not idempotent: ' + o.slice(0, 60) + ' → ' + e.message); } } }
    ok(c.prepare('SELECT COUNT(*) n FROM notifications').get().n === 1, 're-run on populated copy: notifications intact');
    ok(c.prepare("SELECT COUNT(*) n FROM posts WHERE has_media=1").get().n === 2, 're-run on populated copy: has_media data intact');
    /* the FTS rebuild path: clear the shadow index (simulates rows written
       before 5D) and rebuild it. External-content indexes are cleared with
       the same per-row 'delete' command the AFTER DELETE trigger uses. */
    for (const p of c.prepare('SELECT id, body FROM posts').all()) {
      c.prepare("INSERT INTO posts_fts(posts_fts, rowid, body) VALUES('delete', ?, ?)").run(p.id, p.body);
    }
    ok(c.prepare("SELECT COUNT(*) n FROM posts_fts WHERE posts_fts MATCH 'Alpha'").get().n === 0, 'cleared index finds nothing (documents removed)');
    c.prepare("INSERT INTO posts_fts(posts_fts) VALUES('rebuild')").run();
    const hit = c.prepare("SELECT COUNT(*) n FROM posts_fts WHERE posts_fts MATCH 'Alpha'").get().n;
    ok(hit === 1, 'rebuild re-indexes pre-5D rows (Alpha found)');
    c.close();
  }

  /* ---------- 2 · R61 analytics v2 ---------- */
  console.log('\n[2] analytics v2 primitives');
  {
    const from = ts(30 * D);
    const sf = Object.fromEntries(db.A.perSourceFull(from).map((r) => [r.source_jid, r]));
    ok(sf['111@s.whatsapp.net'] && sf['111@s.whatsapp.net'].pub === 2, 'perSourceFull: source 111 published 2');
    ok(sf['111@s.whatsapp.net'].failed === 1, 'perSourceFull: source 111 failed 1');
    ok(sf['111@s.whatsapp.net'].media === 1, 'perSourceFull: source 111 has 1 media post');
    ok(sf['333@s.whatsapp.net'] && sf['333@s.whatsapp.net'].edited === 1, 'perSourceFull: edited counted separately');
    const pt = Object.fromEntries(db.A.perTarget(from).map((r) => [r.target_jid, r]));
    ok(pt['999@s.whatsapp.net'] && pt['999@s.whatsapp.net'].pub === 2, 'perTarget: target 999 got 2 published (via post_keys)');
    ok(pt['888@s.whatsapp.net'] && pt['888@s.whatsapp.net'].pub === 1, 'perTarget: target 888 got 1');
    const media = db.A.mediaSplit(from);
    ok(media.withMedia === 2 && media.text === 2, 'mediaSplit: 2 media + 2 text (published/edited only)');
    const reasons = db.A.skipReasons(from);
    ok(reasons.length === 2 && reasons[0].n === 1, 'skipReasons: both skip rows listed');
    /* PKT heatmap: a 22:00 UTC post is 03:00 PKT — the day label must move
       with the +5h shift. Expected values computed in JS, so the test is
       deterministic at any wall-clock time. */
    const hmUtc = ts(6 * H).replace(/\d{2}:\d{2}:\d{2}$/, '22:00:00');
    d.prepare("INSERT INTO posts(source_jid, source_msg_id, status, body, created_at) VALUES('777@s.whatsapp.net','hm1','published','',?)").run(hmUtc);
    const pktT = new Date(hmUtc.replace(' ', 'T') + 'Z').getTime() + 5 * 3600e3;
    const expDay = new Date(pktT).toISOString().slice(0, 10);
    const expHr = new Date(pktT).getUTCHours();
    const buckets = db.A.hourBuckets(from);
    const hk = buckets.find((b) => b.day === expDay && b.hr === expHr);
    ok(!!hk, `hourBuckets: ${hmUtc} UTC lands on PKT ${expDay} ${String(expHr).padStart(2, '0')}:00`);
    d.prepare("DELETE FROM posts WHERE source_msg_id='hm1'").run();
    const rows = db.A.rows(from);
    const r1 = rows.find((r) => r.id === pid1);
    ok(r1 && r1.targets === '888@s.whatsapp.net | 999@s.whatsapp.net', 'A.rows: targets concatenated (sorted) for CSV');
  }

  /* ---------- 3 · R62 goals ---------- */
  console.log('\n[3] goals (R62)');
  {
    db.GO.set('111@s.whatsapp.net', 5, 'daily drive');
    db.GO.set('111@s.whatsapp.net', 7);
    const all = db.GO.all();
    ok(all.length === 1 && all[0].daily_n === 7, 'GO.set upserts (5 → 7)');
    ok(all[0].note === '', 'GO.set clears the note when omitted');
    db.GO.set('222@s.whatsapp.net', 3);
    db.GO.remove('222@s.whatsapp.net');
    ok(db.GO.all().length === 1, 'GO.remove deletes the goal');
    db.GO.remove('111@s.whatsapp.net');
  }

  /* ---------- 4 · R63 weekly report ---------- */
  console.log('\n[4] weekly report (R63)');
  {
    const report = require('../src/report');
    ok(report.weeklyConfig().day === 'Mon' && report.weeklyConfig().hhmm === '09:00', 'weeklyConfig defaults to Mon 09:00');
    db.S.set('weekly.at', 'Tue 08:05');
    const w = report.weeklyConfig();
    ok(w.day === 'Tue' && w.hhmm === '08:05', 'weeklyConfig parses Tue 08:05');
    db.S.set('weekly.at', 'garbage');
    ok(report.weeklyConfig().day === 'Mon', 'weeklyConfig falls back on garbage');
    const text = report.weeklyText();
    ok(text.includes('RAQIFLUZ WEEKLY REPORT'), 'weeklyText: header');
    ok(text.includes('Published: 3'), 'weeklyText: 3 published in window (2 published + 1 edited counted as published? no — verify)');
    ok(text.includes('111@') || text.includes('Top sources'), 'weeklyText: top sources section');
    ok(text.includes('near-duplicate') || text.includes('skipped'), 'weeklyText: skip reasons surfaced');
    ok(text.includes('1 post(s) FAILED'), 'weeklyText: failure count surfaced');
    /* no socket, no email account → honest "sent nowhere", no crash */
    const r = await report.sendWeekly({ now: true });
    ok(r.ok === false && r.sent.length === 0, 'sendWeekly with no channels: ok=false, sent nowhere');
    ok(!db.S.get('weekly.lastweek', ''), 'send-now does not consume the weekly schedule guard');
  }

  /* ---------- 5 · R65 instant alerts ---------- */
  console.log('\n[5] instant alerts (R65)');
  {
    const alerts = require('../src/alerts');
    const off = alerts.maybe('failed', 'x', 'y');
    ok(off.sent === false && off.why === 'off', 'alerts OFF by default (R8)');
    db.S.set('power.instantalerts.on', '1');
    db.S.set('report.phone', '923001112223'); // so the gate reaches the socket check
    const cd = alerts.maybe('failed', 'x', 'y');
    db.S.set('alerts.last.failed', String(Date.now()));
    const inCd = alerts.maybe('failed', 'x', 'y');
    ok(inCd.sent === false && /cooldown/i.test(inCd.why), '30-min cooldown blocks a second alert of the same type');
    const other = alerts.maybe('wa', 'x', 'y');
    ok(other.sent === false && !/cooldown/i.test(other.why), 'cooldown is per-type (wa not affected by failed stamp)');
    db.S.set('alerts.last.failed', String(Date.now() - 31 * 60e3));
    const stale = alerts.maybe('failed', 'x', 'y');
    ok(stale.sent === false && /WhatsApp not connected/i.test(stale.why), 'after 31 min the gate passes to the (absent) socket check');
    db.S.set('power.instantalerts.on', '0');
  }

  /* ---------- 6 · R64 health score ---------- */
  console.log('\n[6] health score (R64)');
  {
    const health = require('../src/health');
    const h = health.score();
    ok(Number.isInteger(h.score) && h.score >= 0 && h.score <= 100, 'score is an integer 0–100 (' + h.score + ')');
    ok(h.parts.length === 8, 'eight scored parts (got ' + h.parts.length + ')');
    const mean = Math.round(h.parts.reduce((s, p) => s + p.score, 0) / h.parts.length);
    ok(h.score === mean, 'score = mean of parts (' + h.score + ' vs ' + mean + ')');
    const sorted = [...h.parts].sort((a, b) => a.score - b.score);
    ok(h.weakest.length === 2 && h.weakest[0] === sorted[0].name && h.weakest[1] === sorted[1].name, 'weakest names the two lowest parts: ' + h.weakest.join(' + '));
    const pipe = h.parts.find((p) => p.id === 'pipeline');
    ok(pipe.score <= 100 && pipe.score >= 0, 'pipeline part computed (7-day success rate)');
    ok(typeof health.dbBytes() === 'number' && health.dbBytes() > 0, 'dbBytes reports a real size');
  }

  /* ---------- 7 · R64 full self-test ---------- */
  console.log('\n[7] full self-test (R64)');
  {
    const health = require('../src/health');
    const r = health.selfTest();
    ok(r.total === r.list.length, 'total matches the check list');
    ok(r.list.length === 11, 'eleven checks run (got ' + r.list.length + ')');
    const waCheck = r.list.find((c) => c.name === 'WhatsApp socket');
    ok(waCheck && waCheck.ok === false, 'WA socket check honestly FAILS without a connection');
    const dbCheck = r.list.find((c) => c.name === 'Database read/write');
    ok(dbCheck && dbCheck.ok === true, 'DB round-trip passes');
    const scratch = d.prepare("SELECT COUNT(*) n FROM selftests WHERE detail LIKE '%scratch%'").get().n;
    ok(scratch === 0, 'scratch rows are cleaned up');
    const hist = db.ST.recent(5);
    ok(hist.length >= 1 && hist[0].total === r.total, 'self-test history stored');
  }

  /* ---------- 8 · R66 notifications ---------- */
  console.log('\n[8] notification center (R66)');
  {
    d.prepare('DELETE FROM notifications').run(); // earlier sections legitimately added some
    db.NTF.add('alert', 'first alert');
    db.NTF.add('weekly', 'weekly sent');
    let v = db.NTF.list(30);
    ok(v.unread === 2, 'two unread after two adds');
    ok(v.list.length === 2 && v.list[0].kind === 'weekly', 'list is newest-first');
    db.NTF.readOne(v.list[0].id);
    v = db.NTF.list(30);
    ok(v.unread === 1, 'readOne marks exactly one');
    db.NTF.readAll();
    ok(db.NTF.list(30).unread === 0, 'readAll clears everything');
  }

  /* ---------- 9 · R67 FTS5 full-text ---------- */
  console.log('\n[9] FTS5 full-text search (R67)');
  {
    const r1 = db.F.posts('Alpha');
    ok(r1.list.length === 1 && r1.list[0].source_msg_id === undefined && r1.list[0].id === pid1, 'F.posts finds the unique word (fts5: ' + r1.engine + ')');
    const r2 = db.F.posts('alphadeltanope');
    ok(r2.list.length === 0, 'no false positives');
    /* update trigger: the post gets a new unique word → searchable */
    db.P.setStatus(pid1, 'published', '', 'Alpha alpha beta gamma ULTRAWIDGET');
    const r3 = db.F.posts('ULTRAWIDGET');
    ok(r3.list.length === 1 && r3.list[0].id === pid1, 'update trigger re-indexes changed body');
    /* delete trigger */
    d.prepare("DELETE FROM posts WHERE id=?").run(pid1);
    const r4 = db.F.posts('ULTRAWIDGET');
    ok(r4.list.length === 0, 'delete trigger removes the document');
    /* logs */
    d.prepare("INSERT INTO logs(ts, level, code, msg) VALUES(?,?,?,?)").run(ts(1 * H), 'info', 'test.zzz', 'unique logmarker zebra logline');
    const r5 = db.F.logs('logmarker');
    ok(r5.list.length === 1 && r5.list[0].code === 'test.zzz', 'F.logs finds the log line');
    /* chats */
    d.prepare("INSERT INTO inbox_msgs(session, chat_jid, from_me, ts, body) VALUES('main','555@s.whatsapp.net',0,?,?)").run(ts(2 * H), 'zebra chatmarker hello');
    const r6 = db.F.chats('chatmarker');
    ok(r6.list.length === 1 && r6.list[0].chat_jid === '555@s.whatsapp.net', 'F.chats finds the chat message');
    d.prepare("DELETE FROM posts WHERE id=?").run(pid2);
  }

  /* ---------- 10 · R63 exports ---------- */
  console.log('\n[10] CSV + PDF exports (R63)');
  {
    const exp = require('../src/export');
    const csv = exp.csv(30);
    const lines = csv.split('\n');
    ok(lines[0] === 'id,created_at,source,status,reason,targets,media,body', 'CSV header exact');
    ok(lines.length >= 6, 'CSV has the seeded rows (got ' + lines.length + ')');
    ok(csv.includes('222@s.whatsapp.net'), 'CSV names sources by jid when unknown');
    const summary = exp.summary(30);
    ok(summary.pub >= 1 && summary.fail === 1, 'summary aggregates seeded rows');
    /* PDF: structure must be parseable — header, xref offsets, EOF */
    const pdf = exp.pdf(30);
    ok(Buffer.byteLength(pdf) > 800, 'PDF is a real document (' + pdf.length + ' bytes)');
    ok(pdf.slice(0, 8).toString('latin1') === '%PDF-1.4', 'PDF header');
    ok(pdf.slice(-6).toString('latin1').includes('%%EOF'), 'PDF EOF marker');
    const startXref = Number(pdf.toString('latin1').match(/startxref\n(\d+)/)[1]);
    ok(pdf.toString('latin1').slice(startXref, startXref + 4) === 'xref', 'startxref points at the xref table');
    const xrefSec = pdf.toString('latin1').slice(startXref);
    const offs = xrefSec.match(/\n(\d{10}) 00000 n /g).map((x) => Number(x.slice(1, 11)));
    ok(offs.length === 5, 'xref lists the 5 body objects');
    const allGood = offs.every((o, i) => { const e = (i + 1) + ' 0 obj'; return pdf.toString('latin1').slice(o, o + e.length) === e; });
    ok(allGood, 'every xref offset points at its "N 0 obj"');
    ok(pdf.toString('latin1').includes('RAQIFLUZ CHANNEL BOT'), 'PDF carries the report title');
  }

  console.log(`\nT764-5D: ${passed} passed, ${failed} failed`);
  process.exitCode = failed ? 1 : 0;
  setTimeout(() => process.exit(process.exitCode || 0), 150);
})().catch((e) => { console.error('FATAL', e); process.exitCode = 1; setTimeout(() => process.exit(1), 100); });
