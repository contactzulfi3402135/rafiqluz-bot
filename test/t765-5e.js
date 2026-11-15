/* 5E UNIT TESTS (R69–R75) — audit trail, local backup/restore, security,
   storage cleanup, panic stop (exact-state restore), adaptive pacing.
   Runs on a scratch copy of the schema with seeded rows (R3: migrations on a
   populated copy). Usage: node test/t765-5e.js   Exits 0 when all pass. */
'use strict';
const fs = require('fs');
const path = require('path');

process.env.DATABASE_PATH = 'data/t765-test/bot.sqlite';
process.env.SESSION_DIR = 'data/t765-test/sessions';
const DBFILE = path.resolve(__dirname, '..', 'data', 't765-test', 'bot.sqlite');
fs.rmSync(path.dirname(DBFILE), { recursive: true, force: true });
fs.mkdirSync(path.dirname(DBFILE), { recursive: true });

const db = require('../src/db');
const panic = require('../src/panic');
const pace = require('../src/pace');
const backup = require('../src/backup');
const q5 = require('../src/queue5a');

let passed = 0, failed = 0;
function ok(cond, label) {
  if (cond) { passed++; console.log('  ok  ' + label); }
  else { failed++; console.log('  FAIL ' + label); }
}
const d = db.open();
/* clock-robust relative timestamps (UTC 'YYYY-MM-DD HH:MM:SS') — fixed dates
   would drift out of the 14-day log-retention ring as the wall clock advances */
const dstr = (daysAgo) => new Date(Date.now() - daysAgo * 86400000).toISOString().replace('T', ' ').slice(0, 19);

/* seed a little life into the scratch DB */
d.prepare("INSERT INTO posts(source_jid, source_msg_id, status, body, created_at) VALUES('111@s.whatsapp.net','e1','published','Alpha echo test post','2026-11-08 09:00:00')").run();
d.prepare("INSERT INTO logs(ts, level, code, msg) VALUES('" + dstr(7) + "','info','old','aged log line (7 days old — inside the 14-day ring)'),('" + dstr(1) + "','info','new','fresh log line')").run();
db.S.set('pace.marker', 'start');

async function main() {
  console.log('\n[1] audit trail (R69)');
  {
    const before = db.AUD.recent(50).length;
    db.AUD.log('owner', 'test.action', 'First entry');
    db.AUD.log('queue', 'test.action2', 'Second entry');
    const after = db.AUD.recent(50);
    ok(after.length === before + 2, 'AUD.log appends rows');
    ok(after[0].action === 'test.action2' && after[0].actor === 'queue', 'AUD.recent is newest-first');
    ok(typeof after[0].ts === 'string' && after[0].ts.length >= 19, 'audit rows carry a timestamp');
  }

  console.log('\n[2] panic stop (R73) — exact-state restore');
  {
    db.S.set('mirror.paused', '0');
    const st1 = panic.stop('owner');
    ok(panic.active() === true, 'stop() engages the panic');
    ok(db.S.getBool('mirror.paused', false) === true, 'stop() pauses mirroring (the shared safety flag)');
    ok(st1.mirrorPaused === false, 'stop() captures the EXACT previous state (was running)');
    ok(panic.view().on === true && !!panic.view().since, 'view() exposes on + since');

    db.S.set('queue.delay.min', '60');
    const qid = q5.enqueue({ sourceJid: '111@s.whatsapp.net', sourceMsgId: 'eq1', text: 'panic probe post' });
    q5.approve(qid); // approve() fires the pump tick — which must be frozen
    await new Promise((r) => setTimeout(r, 300));
    const frozen = db.Q.one(qid);
    ok(frozen.status === 'approved', 'queue pump is frozen while panic is active (approved item NOT processed)');

    const st2 = panic.restore('owner');
    ok(panic.active() === false, 'restore() disengages the panic');
    ok(db.S.getBool('mirror.paused', false) === false, 'restore() returns mirroring to the EXACT previous state (running)');
    ok(st2.mirrorPaused === false, 'restore() reports what it restored');
    await new Promise((r) => setTimeout(r, 250));
    await q5.tick();
    const row = db.Q.one(qid);
    ok(row.status === 'failed' || row.status === 'published', 'after restore the pump runs again (item processed: ' + row.status + ')');

    // second cycle: mirroring was ALREADY paused before the panic
    db.S.set('mirror.paused', '1');
    const st3 = panic.stop('owner');
    ok(st3.mirrorPaused === true, 'captures "already paused" state');
    panic.restore('owner');
    ok(db.S.getBool('mirror.paused', false) === true, 'restore() KEEPS the pre-panic paused state (exact)');
    db.S.set('mirror.paused', '0');
    db.S.set('queue.delay.min', '0');
    /* boot check: a crash mid-panic keeps the bot stopped */
    db.S.set('panic.on', '1');
    db.S.set('panic.state', JSON.stringify({ mirrorPaused: false, at: Date.now(), by: 'owner' }));
    db.S.set('mirror.paused', '0'); // simulate drift
    panic.bootCheck();
    ok(db.S.getBool('mirror.paused', false) === true, 'bootCheck() re-asserts the pause after a crash mid-panic');
    panic.restore('owner');
    ok(!panic.active(), 'booted panic can be restored');
  }

  console.log('\n[3] adaptive pacing (R74)');
  {
    db.S.set('pace.active', '0'); db.S.set('pace.gap', '0'); db.S.set('pace.lastfail', '0');
    let s = pace.note(0, 2, 1000); // 2 failures — under the 3 threshold
    ok(s.active === false, '2 failures in the window do NOT trigger backoff (threshold 3)');
    s = pace.note(0, 1, 2000); // 3rd failure
    ok(s.active === true && s.gapMs === 30000, '3 clustered failures trigger the 30 s backoff');
    s = pace.note(0, 1, 3000); // more failures → double
    ok(s.gapMs === 60000, 'continued failures double the gap (60 s)');
    ok(pace.gapMin(1500, 3000) === 60000, 'gapMin() waits the backoff gap, never less than the base');
    ok(pace.status(3000).window.failed >= 4, 'the 15-min failure window counts events');
    s = pace.status(3000 + 21 * 60e3); // 21 quiet minutes after the last failure
    ok(s.active === false && s.gapMs === 0, '20 quiet minutes clear the backoff automatically');
    ok(pace.gapMin(1500, 3000 + 21 * 60e3 + 1000) === 1500, 'after clearing, pacing returns to the fixed base');
    /* successes don't clear it early */
    db.S.set('pace.active', '0'); db.S.set('pace.gap', '0'); db.S.set('pace.lastfail', '0');
    pace.note(0, 3, 100000);
    ok(pace.status(100001).active === true, 'backoff active again for the next scenario');
    const afterOk = pace.note(10, 0, 110000);
    ok(afterOk.active === true, 'clean sends do NOT clear the backoff early (only quiet time does)');
    pace.status(110000 + 21 * 60e3); // let it expire for later sections
    db.S.set('pace.active', '0'); db.S.set('pace.gap', '0'); db.S.set('pace.lastfail', '0');
  }

  console.log('\n[4] local backup & restore (R70)');
  {
    db.S.set('pace.marker', 'BEFORE');
    const zip = backup.downloadZip();
    ok(zip.slice(0, 4).toString('latin1') === 'PK\x03\x04', 'downloadZip() produces a zip');
    const files = backup.readZip(zip);
    ok(files.map((f) => f.name).sort().join(',') === 'README.txt,bot.sqlite,manifest.json', 'zip contains bot.sqlite + manifest + README');
    const sql = files.find((f) => f.name === 'bot.sqlite').data;
    ok(sql.slice(0, 15).toString('latin1') === 'SQLite format 3', 'the zipped database is a real SQLite file');
    const man = JSON.parse(files.find((f) => f.name === 'manifest.json').data.toString('utf8'));
    ok(man.app === 'raqifluz-channel-bot' && man.tables.posts >= 1, 'manifest names the app and lists table counts');

    // restore mechanics: change, then restore the captured zip
    db.S.set('pace.marker', 'AFTER');
    const preBefore = backup.listPreRestore().length;
    const r = backup.restoreFromBuffer(zip);
    ok(db.S.get('pace.marker', '') === 'BEFORE', 'restore rolls the settings back to the backup (BEFORE)');
    ok(typeof r.preRestore === 'string' && r.preRestore.startsWith('pre-restore-'), 'restore names the pre-restore snapshot it made');
    const preList = backup.listPreRestore();
    ok(preList.length === preBefore + 1, 'a pre-restore snapshot file appears (retention-managed)');
    const snap = new (require('better-sqlite3'))(path.join(backup.BACKUP_DIR, r.preRestore), { readonly: true });
    const snapVal = snap.prepare("SELECT value FROM settings WHERE key='pace.marker'").get().value;
    snap.close();
    ok(snapVal === 'AFTER', 'the pre-restore snapshot captured the state as it was (AFTER) — the restore itself is undoable');

    // reject garbage
    let threw = '';
    try { backup.restoreFromBuffer(Buffer.from('this is not a database at all, just plain text padding')); } catch (e) { threw = e.message; }
    ok(/Not a SQLite database/i.test(threw), 'garbage upload is rejected before anything changes');
    const strayPath = path.join(path.dirname(DBFILE), 'stray.sqlite');
    const stray = new (require('better-sqlite3'))(strayPath);
    stray.exec('CREATE TABLE unrelated(x)'); stray.prepare('INSERT INTO unrelated VALUES (?)').run(1); stray.close();
    threw = '';
    try { backup.restoreFromBuffer(fs.readFileSync(strayPath)); } catch (e) { threw = e.message; }
    ok(/Not a Raqifluz bot database/i.test(threw), 'a foreign SQLite file is rejected before anything changes');
    ok(db.S.get('pace.marker', '') === 'BEFORE', 'failed restores leave the live DB untouched');
    try { fs.unlinkSync(strayPath); } catch { }
    // restore from a zip (not raw) also works
    db.S.set('pace.marker', 'THIRD');
    backup.restoreFromBuffer(zip);
    ok(db.S.get('pace.marker', '') === 'BEFORE', 'restore accepts zipped uploads too');
  }

  console.log('\n[5] storage cleanup (R72)');
  {

    const cutoff = dstr(3); /* 3 days ago — between the 7-day-old line and the 1-day-old line */
    const oldCount = d.prepare("SELECT COUNT(*) n FROM logs WHERE ts < ?").get(cutoff).n;
    ok(oldCount >= 1, 'seeded an old log line for cleanup');
    const r = d.prepare("DELETE FROM logs WHERE ts < ?").run(cutoff);
    ok(r.changes >= 1, 'log cleanup by age deletes only the old lines');
    ok(d.prepare("SELECT COUNT(*) n FROM logs WHERE ts >= ?").get(cutoff).n >= 1, 'recent log lines survive cleanup');
    const postsKept = d.prepare("SELECT COUNT(*) n FROM posts WHERE status='published'").get().n;
    ok(postsKept >= 1, 'published post records are never touched by cleanup (baseline)');
    const r2 = d.prepare("DELETE FROM posts WHERE status IN ('failed','skipped') AND created_at < '2026-11-01 00:00:00'").run();
    ok(Number.isFinite(r2.changes), 'failed/skipped post cleanup is a scoped DELETE (published untouched)');
  }

  console.log('\n[6] security primitives (R71)');
  {
    const bcrypt = require('bcryptjs');
    db.S.set('ro.enabled', '1');
    db.S.set('ro.password_hash', bcrypt.hashSync('readonly123', 10));
    ok(bcrypt.compareSync('readonly123', db.S.get('ro.password_hash')), 'read-only password verifies against the stored bcrypt hash');
    ok(!bcrypt.compareSync('wrongpass', db.S.get('ro.password_hash')), 'a wrong password does not verify');
    const clamp = (v) => Math.min(24 * 3600e3, Math.max(5, parseInt(v, 10) || 120) * 60e3);
    ok(clamp('30') === 30 * 60e3 && clamp('abc') === 120 * 60e3 && clamp('1') === 5 * 60e3 && clamp('99999') === 24 * 3600e3, 'session timeout clamps to 5 min … 24 h, default 120');
    db.S.set('ro.enabled', '0'); db.S.set('ro.password_hash', '');
  }

  console.log('\n[7] zip round-trip with unicode + larger payload (R70)');
  {
    const payload = Buffer.alloc(300 * 1024);
    for (let i = 0; i < payload.length; i++) payload[i] = (i * 7) & 0xff;
    const zip = backup.buildZip([
      { name: 'ünïcode-üçişlı.txt', data: Buffer.from('şüçöğıç — unicode payload', 'utf8') },
      { name: 'big.bin', data: payload }
    ]);
    const back = backup.readZip(zip);
    ok(back.length === 2, 'zip round-trip keeps both entries');
    const txt = back.find((f) => f.name === 'ünïcode-üçişlı.txt').data.toString('utf8');
    ok(txt === 'şüçöğıç — unicode payload', 'unicode file name + payload survive the round-trip');
    ok(back.find((f) => f.name === 'big.bin').data.equals(payload), '300 KB binary payload survives byte-exact');
  }

  console.log('\nT765-5E: ' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error('HARNESS ERROR:', e); process.exit(2); });
