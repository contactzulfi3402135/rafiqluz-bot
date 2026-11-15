'use strict';
/*
 * 5H (R85–R87) — unit tests:
 *  1. idempotent 5H migration on a populated pre-5H (5G-era) DB copy (R3)
 *  2. WA command channel engine — catalog, PIN gating for destructive
 *     commands, pause/panic/approve/failed/status (publisher stubbed)
 *  3. evergreen recycling — quota, rotation, age gate, rate guard,
 *     pause/panic kill (publisher stubbed)
 *  4. auto-pilot — retry failed queue items, unstick zombies, daily cap,
 *     off-by-default, panic kill
 */
const fs = require('fs');
const path = require('path');

process.env.DATABASE_PATH = 'data/t768-test/bot.sqlite';
process.env.SESSION_DIR = 'data/t768-test/sessions';
const DBFILE = path.resolve(__dirname, '..', 'data', 't768-test', 'bot.sqlite');
fs.rmSync(path.dirname(DBFILE), { recursive: true, force: true });
fs.mkdirSync(path.dirname(DBFILE), { recursive: true });

let passed = 0, failed = 0;
const ok = (cond, label) => { if (cond) { passed += 1; console.log('  ok  ' + label); } else { failed += 1; console.error('  FAIL ' + label); } };
/* clock-robust relative timestamp (UTC 'YYYY-MM-DD HH:MM:SS') — "young" posts
   must stay younger than the evergreen min-age (7 d) whenever the suite runs
   (same fixed-date drift class as t765). */
const dstr = (daysAgo) => new Date(Date.now() - daysAgo * 86400000).toISOString().replace('T', ' ').slice(0, 19);

/* ---------- 1 · 5H migration on a populated pre-5H DB ---------- */
console.log('\n[1] 5H migration on a populated pre-5H DB');
{
  const Database = require('better-sqlite3');
  const oldDb = new Database(DBFILE);
  oldDb.exec(`
    CREATE TABLE settings(key TEXT PRIMARY KEY, value TEXT);
    CREATE TABLE sources(
      jid TEXT PRIMARY KEY, name TEXT, added_at TEXT DEFAULT (datetime('now')),
      added_by TEXT DEFAULT '', paused INTEGER DEFAULT 0, targets TEXT DEFAULT '', last_post_at TEXT DEFAULT '',
      kind TEXT DEFAULT 'wa', url TEXT DEFAULT ''
    );
  `);
  oldDb.prepare("INSERT INTO settings(key,value) VALUES('power.evergreen.on','0')").run();
  oldDb.close();

  const db = require('../src/db');
  db.open();
  const d = db.open();
  const tables = d.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('evergreen_log','autopilot_log')").all().map((r) => r.name).sort();
  ok(JSON.stringify(tables) === JSON.stringify(['autopilot_log', 'evergreen_log']), '5H tables created (evergreen_log, autopilot_log)');
  ok(db.S.getBool('power.evergreen.on', true) === false, 'old settings preserved through migration');
  let second = true;
  try { db.open(); } catch { second = false; }
  ok(second, 'second open on migrated DB is clean (idempotent)');
}

/* ---------- publisher stub (same pattern as t767) ---------- */
let pubCalls = [];
function loadFresh() {
  for (const k of Object.keys(require.cache)) {
    if (k.includes('/src/')) delete require.cache[k];
  }
  pubCalls = [];
  require.cache[require.resolve('../src/publish')] = {
    id: require.resolve('../src/publish'), filename: require.resolve('../src/publish'), loaded: true,
    exports: {
      publish: async (content, meta) => {
        pubCalls.push({ content, meta });
        const db2 = require('../src/db');
        const bodyText = (content && (content.text !== undefined ? content.text : '')) || '';
        db2.P.mark(meta.sourceJid, meta.sourceMsgId, 'published', String(meta.norm || '').slice(0, 400), bodyText, Boolean(meta.hasMedia));
        return { sent: meta.only ? meta.only.length : 1, failed: 0, errors: [], keys: [] };
      }
    }
  };
  return { db: require('../src/db') };
}

/* ---------- 2 · WA command channel engine ---------- */
console.log('\n[2] WA command channel (R85)');
async function commandSection() {
  const { db } = loadFresh();
  const wc = require('../src/wacommand');
  const d = db.open();

  ok(Array.isArray(wc.COMMANDS) && wc.COMMANDS.length >= 7, 'command catalog has the full set');
  ok((await wc.handle('hello there')) === null, 'a normal message is NOT a command (no trigger)');
  ok((await wc.handle('')) === null, 'empty message → null');

  // status works with everything disconnected
  const st = await wc.handle('status');
  ok(st && st.includes('Bot status') && st.includes('Approval queue'), 'status returns connection + queue summary');

  // approve: empty queue
  ok((await wc.handle('approve')).includes('empty'), 'approve with an empty queue is an honest answer');

  // approve: with a pending item (publisher stubbed)
  d.prepare("INSERT INTO targets(jid,name) VALUES('T@newsletter','Target')").run();
  d.prepare("INSERT INTO approvals(source_jid,source_msg_id,text,targets) VALUES('s1@newsletter','a1','queued item text','T@newsletter')").run();
  const r1 = await wc.handle('approve');
  ok(r1.includes('Approved 1'), 'approve from WA approves the queue item');
  const qrow = d.prepare("SELECT status FROM approvals WHERE id=1").get();
  ok(qrow && (qrow.status === 'approved' || qrow.status === 'published' || qrow.status === 'processing'), 'the queue item left pending (approved/published)');
  ok(pubCalls.length === 1 && pubCalls[0].meta.only.join(',') === 'T@newsletter', 'the approval went through the normal publish path');

  // failed: none
  ok((await wc.handle('failed')).includes('Nothing failed'), 'failed with a clean history is honest');
  // failed: with a row
  d.prepare("INSERT INTO posts(source_jid,source_msg_id,status,reason) VALUES('s1@newsletter','f1','failed','WhatsApp is not connected')").run();
  ok((await wc.handle('failed')).includes('WhatsApp is not connected'), 'failed lists the last-24h failures with reasons');

  // destructive without PIN set → refused
  ok((await wc.handle('pause')).includes('Set a command PIN'), 'destructive command refused while no PIN is set');
  ok((await wc.handle('undo last')).includes('Set a command PIN'), 'undo is PIN-gated too');

  // set PIN → wrong PIN refused, right PIN executes
  db.S.set('waCommand.pin', '4321');
  ok(wc.pinSet(), 'pinSet() reflects the saved PIN');
  ok((await wc.handle('pause 9999')).includes('Wrong PIN'), 'wrong PIN is refused and nothing happens');
  ok(!db.S.getBool('mirror.paused', false), 'wrong PIN left the pause state untouched');

  const pauseReply = await wc.handle('pause 4321');
  ok(pauseReply.includes('Paused') && db.S.getBool('mirror.paused', false), 'correct PIN engages the global pause');
  const resumeReply = await wc.handle('resume 4321');
  ok(resumeReply.includes('Resumed') && !db.S.getBool('mirror.paused', false), 'correct PIN clears the pause');

  const panicReply = await wc.handle('panic 4321');
  ok(panicReply.includes('PANIC STOP') && db.S.getBool('panic.on', false), 'correct PIN engages panic stop');
  require('../src/panic').restore('test');
  ok(!db.S.getBool('panic.on', false), 'panic restored for the next tests');

  // audit trail: every command logged
  const audList = db.AUD.recent(100).map((a) => String(a.action));
  ok(audList.filter((a) => a.startsWith('wa.command')).length >= 5, 'every command is logged in the audit trail');

  // PIN shape validation is server-side — engine treats non-PIN as unset
  db.S.set('waCommand.pin', '');
  ok(!wc.pinSet(), 'cleared PIN → destructive stays off');
}

/* ---------- 3 · evergreen recycling ---------- */
console.log('\n[3] evergreen recycling (R86)');
async function evergreenSection() {
  const { db } = loadFresh();
  const egr = require('../src/evergreen');
  const d = db.open();
  d.prepare("INSERT OR REPLACE INTO targets(jid,name) VALUES('T@newsletter','Target')").run();

  // OFF by default: switch off → nothing happens
  db.S.set('power.evergreen.on', '0');
  d.prepare("INSERT INTO posts(source_jid,source_msg_id,status,body,created_at) VALUES('s1@newsletter','old1','published','A proven post that did well and should come back around again later','2026-10-01 10:00:00')").run();
  await egr.tick();
  ok(pubCalls.length === 0, 'switch OFF (default) → nothing is recycled');

  // ON + old post → one recycle
  const oldId = d.prepare("SELECT id FROM posts WHERE source_msg_id='old1'").get().id;
  db.S.set('power.evergreen.on', '1');
  await egr.tick();
  ok(pubCalls.length === 1, 'switch ON → one post recycled per tick');
  const postRow = d.prepare("SELECT * FROM posts WHERE source_msg_id=?").get('eg' + oldId);
  ok(postRow && postRow.status === 'published', 'the recycle is a normal post row (undo/analytics see it)');
  ok(postRow && postRow.source_jid === 'evergreen@bot', 'credited as the Evergreen source');
  ok(d.prepare("SELECT COUNT(*) c FROM evergreen_log").get().c === 1, 'evergreen log row written');

  // rotation: the same post is not recycled again
  await egr.tick();
  ok(pubCalls.length === 1, 'rotation guard: the same post is not recycled twice (21-day window)');

  // quota: default 2 → a second distinct post still recycles, then the day is done
  d.prepare("INSERT INTO posts(source_jid,source_msg_id,status,body,created_at) VALUES('s1@newsletter','old2','published','Another proven post with plenty of text to qualify for recycling now','2026-10-02 10:00:00')").run();
  await egr.tick();
  ok(pubCalls.length === 2, 'quota=2 allows the second distinct post');
  await egr.tick();
  ok(pubCalls.length === 2, 'quota reached → no further recycling today');

  // age gate: a young post is never recycled
  db.S.set('evergreen.quota', '5');
  d.prepare("INSERT INTO posts(source_jid,source_msg_id,status,body,created_at) VALUES('s1@newsletter','young1','published',?,?)").run('A brand new post that is far too young to be recycled by evergreen', dstr(2));
  const before = pubCalls.length;
  await egr.tick();
  ok(pubCalls.length === before, 'age gate: posts younger than min-age (7 d) are skipped');

  // rate guard: guard would be breached → skip
  db.S.set('guard.maxperhour', '3');
  for (let i = 0; i < 3; i++) d.prepare("INSERT INTO posts(source_jid,source_msg_id,status,body,created_at) VALUES('s1@newsletter','rg" + i + "','published','recent post " + i + " published within the last hour to trip the rate guard','2026-11-08 07:00:00')").run();
  const before2 = pubCalls.length;
  await egr.tick();
  ok(pubCalls.length === before2, 'rate guard: when the per-target limit would be breached, recycling waits');
  db.S.set('guard.maxperhour', '30');

  // pause + panic kill it
  db.S.set('mirror.paused', '1');
  const before3 = pubCalls.length;
  await egr.tick();
  ok(pubCalls.length === before3, 'global pause holds recycling');
  db.S.set('mirror.paused', '0');
  db.S.set('panic.on', '1');
  const before4 = pubCalls.length;
  await egr.tick();
  ok(pubCalls.length === before4, 'panic stop kills recycling');
  db.S.set('panic.on', '0');

  // view shape
  const v = egr.view();
  ok(v.on === true && v.quota === 5 && v.usedToday >= 2 && Array.isArray(v.log), 'view() exposes quota, today usage and the log');
}

/* ---------- 4 · auto-pilot ---------- */
console.log('\n[4] auto-pilot (R87)');
async function autopilotSection() {
  const { db } = loadFresh();
  const ap = require('../src/autopilot');
  const d = db.open();

  // OFF by default → a pass is a no-op
  db.S.set('power.autopilot.on', '0');
  const qFailRow = d.prepare("INSERT INTO approvals(source_jid,source_msg_id,text,status) VALUES('s1@newsletter','aq1','failed queue item','failed')").run();
  const qFailId = Number(qFailRow.lastInsertRowid);
  await ap.pass();
  const st1 = d.prepare("SELECT status FROM approvals WHERE id=?").get(qFailId);
  ok(st1.status === 'failed', 'switch OFF (default) → the pilot does nothing');
  ok(d.prepare("SELECT COUNT(*) c FROM autopilot_log").get().c === 0, 'no log rows when off');

  // ON → retries the failed queue item
  db.S.set('power.autopilot.on', '1');
  await ap.pass();
  const st2 = d.prepare("SELECT status FROM approvals WHERE id=?").get(qFailId);
  ok(st2.status === 'pending' || st2.status === 'approved' || st2.status === 'processing' || st2.status === 'published', 'failed queue item re-queued (and its normal publish path ran)');
  const logs = d.prepare('SELECT action FROM autopilot_log ORDER BY id ASC').all().map((r) => r.action);
  ok(logs.includes('retry-queue') && logs.includes('pass'), 'actions + pass are logged');

  // zombie unstick
  const zRow = d.prepare("INSERT INTO approvals(source_jid,source_msg_id,text,status,created_at) VALUES('s1@newsletter','aq2','stuck item','processing','2026-11-08 05:00:00')").run();
  const zId = Number(zRow.lastInsertRowid);
  await ap.pass();
  const st3 = d.prepare("SELECT status FROM approvals WHERE id=?").get(zId);
  ok(st3.status === 'pending', 'zombie processing row (30+ min) reset to pending');

  // daily cap: maxDay=1 → next pass blocked
  db.S.set('autopilot.maxday', '1');
  const before = d.prepare("SELECT COUNT(*) c FROM autopilot_log").get().c;
  await ap.pass();
  const afterLogs = d.prepare('SELECT action FROM autopilot_log WHERE id > ? ORDER BY id ASC').all(before).map((r) => r.action);
  ok(afterLogs.includes('cap') && !afterLogs.includes('retry-queue'), 'daily cap reached → pilot idles (honest cap log)');

  // panic kill
  db.S.set('autopilot.maxday', '50');
  db.S.set('panic.on', '1');
  const before2 = d.prepare("SELECT COUNT(*) c FROM autopilot_log").get().c;
  await ap.pass();
  const after2 = d.prepare('SELECT COUNT(*) c FROM autopilot_log WHERE id > ?').get(before2).c;
  ok(after2 === 0, 'panic stop kills the pilot instantly (no logs at all)');
  db.S.set('panic.on', '0');

  // the pilot NEVER deletes / touches settings / keys: structural — it only imports queue5a + db;
  // verify the posts table is untouched across a full pass (row count unchanged)
  const postsBefore = d.prepare('SELECT COUNT(*) c FROM posts').get().c;
  await ap.pass();
  const postsAfter = d.prepare('SELECT COUNT(*) c FROM posts').get().c;
  ok(postsBefore === postsAfter, 'structural check: the pilot never created or deleted post rows');

  // view shape
  const v = ap.view();
  ok(v.on === true && v.maxDay === 50 && typeof v.usedToday === 'number' && Array.isArray(v.log), 'view() exposes cap, usage and the log');
}

(async () => {
  await commandSection();
  await evergreenSection();
  await autopilotSection();
  console.log(`\nALL — ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('CRASH', e); process.exit(1); });
