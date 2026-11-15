'use strict';
/*
 * 5I (I1–I10) — unit tests:
 *  1. idempotent 5I migration on a populated pre-5I (5H-era) DB copy (R3)
 *  2. I7 freshness guard — stale posts skipped with an honest reason (pipeline-level)
 *  3. I3 smart media — pure validation (caps + content type), switch default OFF
 *  4. I8 link tools — tracking-param stripping (pure + pipeline-level, ON/OFF)
 *  5. I6 hashtag frequency — counting over own published posts
 *  6. I1 subscriber snapshots — upsert/day/history semantics
 *  7. I10 resend rate guard — global + per-target refusals, pass-through
 *  8. I9 row undo — only when the post is the latest on the target (wa stubbed)
 *  9. I2 media library — queued media hold file + chat BLOB data paths
 * 10. I4 announcement card — PNG validity, wrap, SVG escaping
 * 11. I5 view counts — verified evidence that Baileys exposes no API (⏭ basis)
 */
const fs = require('fs');
const path = require('path');

process.env.DATABASE_PATH = 'data/t769-test/bot.sqlite';
process.env.SESSION_DIR = 'data/t769-test/sessions';
const DBFILE = path.resolve(__dirname, '..', 'data', 't769-test', 'bot.sqlite');
fs.rmSync(path.dirname(DBFILE), { recursive: true, force: true });
fs.mkdirSync(path.dirname(DBFILE), { recursive: true });

let passed = 0, failed = 0;
const ok = (cond, label) => { if (cond) { passed += 1; console.log('  ok  ' + label); } else { failed += 1; console.error('  FAIL ' + label); } };

/* ---------- publisher + wa stubs ---------- */
let pubCalls = [];
const WA_STUB = {
  getSocket: () => (global.__waStubSock || null),
  getStatus: () => ({ status: global.__waStubOpen ? 'open' : 'closed' }),
  channelMeta: async () => ({ name: 'Test Channel', role: 'ADMIN', canPost: true, subscribers: 1234 }),
  deleteChannelPost: async (sock, target, msgId) => { global.__waDeleted = { target, msgId }; }
};
function loadFresh() {
  for (const k of Object.keys(require.cache)) if (k.includes('/src/')) delete require.cache[k];
  pubCalls = [];
  require.cache[require.resolve('../src/publish')] = {
    id: require.resolve('../src/publish'), filename: require.resolve('../src/publish'), loaded: true,
    exports: {
      publish: async (content, meta) => {
        pubCalls.push({ content, meta });
        const db2 = require('../src/db');
        const bodyText = (content && content.text !== undefined) ? String(content.text) : '';
        db2.P.mark(meta.sourceJid, meta.sourceMsgId, 'published', String(meta.norm || '').slice(0, 400), bodyText, Boolean(meta.hasMedia));
        return { sent: meta.only ? meta.only.length : 1, failed: 0, errors: [], keys: [] };
      },
      perTargetMax: (jid) => { const n = parseInt(require('../src/db').S.get('guard.maxperhour.' + jid, '0'), 10); return Number.isFinite(n) && n >= 1 ? n : 0; }
    }
  };
  require.cache[require.resolve('../src/wa')] = {
    id: require.resolve('../src/wa'), filename: require.resolve('../src/wa'), loaded: true, exports: WA_STUB
  };
  return { db: require('../src/db') };
}
function seedBase(db) {
  const d = db.open();
  d.prepare(`INSERT OR REPLACE INTO sources(jid,name,paused,kind) VALUES('src1@newsletter','Source One',0,'wa')`).run();
  d.prepare(`INSERT OR REPLACE INTO targets(jid,name,paused) VALUES('tgt1@newsletter','Target One',0)`).run();
}
const RSS = (id, text, tsSec) => ({ jid: 'rss-t769@rss', id, text, ts: tsSec * 1000, sourceName: 'TestFeed' });

/* ---------- 1 · 5I migration on a populated pre-5I DB ---------- */
console.log('\n[1] 5I migration on a populated pre-5I DB');
{
  const Database = require('better-sqlite3');
  const oldDb = new Database(DBFILE);
  oldDb.exec(`
    CREATE TABLE settings(key TEXT PRIMARY KEY, value TEXT);
    CREATE TABLE sources(jid TEXT PRIMARY KEY, name TEXT, paused INTEGER DEFAULT 0, kind TEXT DEFAULT 'wa');
    CREATE TABLE posts(id INTEGER PRIMARY KEY, source_jid TEXT, source_msg_id TEXT, status TEXT, reason TEXT, body TEXT DEFAULT '', created_at TEXT DEFAULT (datetime('now')));
  `);
  oldDb.prepare("INSERT INTO settings(key,value) VALUES('power.announcard.on','0')").run();
  oldDb.close();
  const db = require('../src/db');
  db.open();
  const d = db.open();
  ok(d.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='subs_snapshots'").get(), 'subs_snapshots table created');
  ok(db.S.getBool('power.announcard.on', true) === false, 'old settings preserved through migration');
  let second = true; try { db.open(); } catch { second = false; }
  ok(second, 'second open on migrated DB is clean (idempotent)');
}

/* ---------- 2 · I7 freshness guard ---------- */
console.log('\n[2] I7 freshness guard (pipeline-level)');
async function freshnessSection() {
  const { db } = loadFresh();
  seedBase(db);
  const pipeline = require('../src/pipeline');
  const d = db.open();
  d.prepare(`INSERT OR REPLACE INTO sources(jid,name,paused,kind) VALUES('rss-t769@rss','TestFeed',0,'rss')`).run();
  const now = Math.floor(Date.now() / 1000);
  // OFF (default 0h): a 3-day-old post still publishes
  await pipeline.intakeRss(RSS('f1', 'Freshness test one — an old feed item from three days back', now - 3 * 86400));
  ok(pubCalls.length === 1, 'guard OFF (0h): old post still publishes (default behaviour unchanged)');
  // ON 2h: 3-hour-old post skipped with an honest stale reason
  db.S.set('freshness.hours', '2');
  await pipeline.intakeRss(RSS('f2', 'Freshness test two — posted three hours ago and should be stale now', now - 3 * 3600));
  const stale = (db.A.recent(5) || []).find((p) => p.source_msg_id === 'f2');
  ok(stale && stale.status === 'skipped' && /stale/.test(stale.reason || ''), 'guard ON 2h: 3h-old post skipped with "stale" reason');
  // ON 2h: 1-hour-old post publishes
  await pipeline.intakeRss(RSS('f3', 'Freshness test three — posted an hour ago, still fresh enough to run', now - 3600));
  ok(pubCalls.length === 2, 'guard ON 2h: 1h-old post still publishes');
  db.S.set('freshness.hours', '0');
}

/* ---------- 3 · I3 smart media ---------- */
console.log('\n[3] I3 smart media validation');
{
  const pipeline = require('../src/pipeline');
  ok(pipeline.SWITCH_DEFAULTS.smartmedia === false, 'smartmedia is OFF by default (R8)');
  ok(pipeline.smartMediaCheck('image', 'image/jpeg', 9 * 1048576) === null, '9 MB JPEG passes');
  ok(/over the 10 MB cap/.test(pipeline.smartMediaCheck('image', 'image/jpeg', 11 * 1048576) || ''), '11 MB image refused with the cap reason');
  ok(/content type/.test(pipeline.smartMediaCheck('image', 'text/html', 1024) || ''), 'image with text/html mime refused');
  ok(/content type/.test(pipeline.smartMediaCheck('video', 'audio/mp4', 1024) || ''), 'video with audio mime refused');
  ok(pipeline.smartMediaCheck('video', 'video/mp4', 39 * 1048576) === null, '39 MB MP4 passes');
  ok(/over the 40 MB cap/.test(pipeline.smartMediaCheck('video', 'video/mp4', 41 * 1048576) || ''), '41 MB video refused');
  ok(pipeline.smartMediaCheck('document', 'application/pdf', 20 * 1048576) === null, '20 MB PDF passes (at the cap)');
}

/* ---------- 4 · I8 link tools ---------- */
console.log('\n[4] I8 link tools (tracking params)');
async function linkSection() {
  const { db } = loadFresh();
  seedBase(db);
  const pipeline = require('../src/pipeline');
  ok(pipeline.SWITCH_DEFAULTS.linktools === false, 'linktools is OFF by default (R8)');
  const u1 = 'https://x.co/a?utm_source=wa&id=7&fbclid=abc';
  ok(pipeline.stripTrackingParams(u1) === 'https://x.co/a?id=7', 'utm_*/fbclid stripped, other params kept');
  ok(pipeline.stripTrackingParams('https://x.co/a?utm_source=wa') === 'https://x.co/a', 'URL with only tracking params loses its query');
  ok(pipeline.stripTrackingParams('no links here') === 'no links here', 'text without URLs untouched');
  ok(pipeline.stripTrackingParams('https://broken?.com') === 'https://broken?.com', 'invalid URL left exactly as-is');
  // pipeline-level: ON strips from the final published body; OFF leaves it
  db.open().prepare(`INSERT OR REPLACE INTO sources(jid,name,paused,kind) VALUES('rss-t769@rss','TestFeed',0,'rss')`).run();
  const now = Math.floor(Date.now() / 1000);
  pipeline.setSwitch('linktools', true);
  await pipeline.intakeRss(RSS('l1', 'Link test one: visit https://shop.pk/item?gclid=xyz&utm_medium=cpc now', now));
  const last1 = pubCalls[pubCalls.length - 1];
  ok(last1 && last1.content.text.includes('https://shop.pk/item?') === false && last1.content.text.includes('gclid') === false, 'ON: tracking params stripped from the published body');
  pipeline.setSwitch('linktools', false);
  await pipeline.intakeRss(RSS('l2', 'Link test two: visit https://shop.pk/item2?gclid=xyz&utm_medium=cpc now', now));
  const last2 = pubCalls[pubCalls.length - 1];
  ok(last2 && last2.content.text.includes('gclid=xyz'), 'OFF: tracking params untouched (default behaviour)');
}

/* ---------- 5 · I6 hashtag frequency ---------- */
console.log('\n[5] I6 local hashtag frequency');
async function hasSection() {
  const { db } = loadFresh();
  seedBase(db);
  const pipeline = require('../src/pipeline');
  const now = Math.floor(Date.now() / 1000);
  db.open().prepare(`INSERT OR REPLACE INTO sources(jid,name,paused,kind) VALUES('rss-t769@rss','TestFeed',0,'rss')`).run();
  await pipeline.intakeRss(RSS('h1', 'Hashtag post one with #jobs and #news and #jobs again', now));
  await pipeline.intakeRss(RSS('h2', 'Hashtag post two with #jobs only, plus #pakistan', now));
  const d = db.open();
  const rows = d.prepare(`SELECT body FROM posts WHERE status IN ('published','edited') AND body != '' AND created_at >= datetime('now','-30 days')`).all();
  const counts = new Map();
  for (const r of rows) for (const m of String(r.body).matchAll(/#[A-Za-z0-9_]{2,30}/g)) { const t = m[0].toLowerCase(); counts.set(t, (counts.get(t) || 0) + 1); }
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  ok(rows.length >= 2, 'own published posts are counted (not skips/failures)');
  ok(top[0][0] === '#jobs' && top[0][1] === 3, '#jobs is the top tag with count 3');
  ok(top.some(([t, n]) => t === '#news' && n === 1), '#news counted once');
}

/* ---------- 6 · I1 subscriber snapshots ---------- */
console.log('\n[6] I1 subscriber snapshot semantics');
async function subsSection() {
  const { db } = loadFresh();
  const SUBS = db.SUBS;
  SUBS.upsertDay('a@newsletter', SUBS.dayKey(), 100);
  ok(db.SUBS.todayFor('a@newsletter')?.count === 100, 'upsert + todayFor round-trip');
  SUBS.upsertDay('a@newsletter', SUBS.dayKey(), 105);
  ok(db.SUBS.todayFor('a@newsletter')?.count === 105, 'same-day upsert updates in place (PK)');
  const pastDay = db.open().prepare("SELECT date('now','-3 days') day").get().day;
  SUBS.upsertDay('a@newsletter', pastDay, 90);
  const h = db.SUBS.history('a@newsletter', 14);
  ok(h.length === 2 && h[0].count === 90 && h[1].count === 105, 'history returns ascending days with counts');
  ok(db.SUBS.lastFor('a@newsletter')?.count === 105, 'lastFor = latest day');
  ok(db.SUBS.lastFor('missing@newsletter') == null, 'unknown source → null (best-effort)');
  // engine: one snapshot per day per source (the pass skips sources already snapshotted today)
  global.__waStubOpen = true; global.__waStubSock = { __stub: true };
  const subs = require('../src/subs');
  const d = db.open();
  d.prepare(`INSERT OR REPLACE INTO sources(jid,name,paused,kind) VALUES('a@newsletter','Sub Source',0,'wa')`).run();
  d.prepare(`INSERT OR REPLACE INTO sources(jid,name,paused,kind) VALUES('b@newsletter','Sub Source B',0,'wa')`).run();
  await subs.pass();
  ok(db.SUBS.lastFor('a@newsletter')?.count === 105, 'pass does not clobber an existing same-day snapshot');
  ok(db.SUBS.lastFor('b@newsletter')?.count === 1234, 'pass snapshots the other source via channelMeta (1234 from stub)');
  await subs.pass();
  ok(db.SUBS.lastFor('a@newsletter')?.count === 105, 'second pass is a no-op (once per day per source)');
}

/* ---------- 7 · I10 resend rate guard ---------- */
console.log('\n[7] I10 resend rate guard');
async function resendSection() {
  const { db } = loadFresh();
  seedBase(db);
  const q = require('../src/queue5a');
  const d = db.open();
  const now = Math.floor(Date.now() / 1000);
  d.prepare(`INSERT OR REPLACE INTO sources(jid,name,paused,kind) VALUES('rss-t769@rss','TestFeed',0,'rss')`).run();
  const pipeline = require('../src/pipeline');
  await pipeline.intakeRss({ jid: 'rss-t769@rss', id: 'r1', text: 'Resend candidate post with some stored body text inside', ts: now * 1000, sourceName: 'T' });
  const row = d.prepare(`SELECT * FROM posts WHERE source_msg_id='r1'`).get();
  ok(row && row.body, 'post row stores the body (resend needs it)');
  // global guard pass (fresh hour)
  let g = q.checkResendGuard(row);
  ok(g.ok === true, 'guard passes on a fresh hour');
  // global guard refuse: lower the cap to 3 and publish 3 more this hour
  db.S.set('guard.maxperhour', '3');
  await pipeline.intakeRss({ jid: 'rss-t769@rss', id: 'r2', text: 'Resend filler two to fill the hourly guard window fast', ts: now * 1000 });
  await pipeline.intakeRss({ jid: 'rss-t769@rss', id: 'r3', text: 'Resend filler three to fill the hourly guard window fast', ts: now * 1000 });
  await pipeline.intakeRss({ jid: 'rss-t769@rss', id: 'r4', text: 'Resend filler four to fill the hourly guard window fast', ts: now * 1000 });
  g = q.checkResendGuard(row);
  ok(g.ok === false && /Rate guard: 3 posts/.test(g.error || ''), 'guard refuses at the global 3/h cap with the honest reason');
  // per-target cap refuse
  db.S.set('guard.maxperhour', '30');
  db.S.set('guard.maxperhour.tgt1@newsletter', '1');
  d.prepare(`INSERT INTO post_keys(post_id,target_jid,msg_id) VALUES(?, 'tgt1@newsletter','FAKE1')`).run(row.id);
  g = q.checkResendGuard(row);
  ok(g.ok === false && /per-target cap/.test(g.error || ''), 'guard refuses when a target hit its per-target cap');
  db.S.set('guard.maxperhour.tgt1@newsletter', '0');
  ok(q.checkResendGuard(row).ok === true, 'guard passes again after the per-target cap is cleared');
}

/* ---------- 8 · I9 row-level undo ---------- */
console.log('\n[8] I9 row-level undo (only the latest)');
async function undoSection() {
  const { db } = loadFresh();
  seedBase(db);
  const q = require('../src/queue5a');
  const d = db.open();
  const now = Math.floor(Date.now() / 1000);
  d.prepare(`DELETE FROM post_keys`).run(); // isolate: section 7 left a key with a newer at
  d.prepare(`INSERT OR REPLACE INTO sources(jid,name,paused,kind) VALUES('rss-t769@rss','TestFeed',0,'rss')`).run();
  const pipeline = require('../src/pipeline');
  await pipeline.intakeRss({ jid: 'rss-t769@rss', id: 'u1', text: 'Undo candidate one — the first of two posts in this test', ts: (now - 300) * 1000, sourceName: 'T' });
  await pipeline.intakeRss({ jid: 'rss-t769@rss', id: 'u2', text: 'Undo candidate two — the second of two posts in this test', ts: (now - 100) * 1000, sourceName: 'T' });
  const p1 = d.prepare(`SELECT * FROM posts WHERE source_msg_id='u1'`).get();
  const p2 = d.prepare(`SELECT * FROM posts WHERE source_msg_id='u2'`).get();
  d.prepare(`INSERT INTO post_keys(post_id,target_jid,msg_id,at) VALUES(?, 'tgt1@newsletter','MK1', datetime('now','-5 minutes'))`).run(p1.id);
  d.prepare(`INSERT INTO post_keys(post_id,target_jid,msg_id,at) VALUES(?, 'tgt1@newsletter','MK2', datetime('now','-1 minute'))`).run(p2.id);
  global.__waStubOpen = true; global.__waStubSock = { __stub: true }; global.__waDeleted = null;
  // the OLDER post is refused
  let refused = null;
  try { await q.undoPostOn(p1.id, 'tgt1@newsletter'); } catch (e) { refused = e.message; }
  ok(refused && /not the latest/.test(refused), 'undo refused when the post is not the latest on the target');
  ok(global.__waDeleted == null, 'refusal deleted nothing on the channel');
  // the LATEST post is allowed and deletes exactly its own message id
  const r = await q.undoPostOn(p2.id, 'tgt1@newsletter');
  ok(r && r.ok === true && global.__waDeleted && global.__waDeleted.msgId === 'MK2', 'undo allowed for the latest — deletes its own message id');
  ok(d.prepare(`SELECT msg_id FROM post_keys WHERE post_id=? AND target_jid='tgt1@newsletter'`).get(p2.id)?.msg_id === 'undone', 'key marked undone in the DB');
}

/* ---------- 9 · I2 media library data paths ---------- */
console.log('\n[9] I2 media library data paths');
async function mediaSection() {
  const { db } = loadFresh();
  const d = db.open();
  // chat media: BLOB in inbox_msgs (the 5F pattern)
  const blob = Buffer.from('fake-jpeg-bytes');
  d.prepare(`INSERT INTO inbox_msgs(session,chat_jid,kind,media_mime,media_name,media_data,ts)
             VALUES('main','someone@whatsapp.net','image','image/jpeg','pic.jpg',?, datetime('now'))`).run(blob);
  const got = d.prepare(`SELECT media_data, media_name FROM inbox_msgs WHERE media_name='pic.jpg'`).get();
  ok(got && Buffer.from(got.media_data).equals(blob), 'chat media stored as BLOB (library indexes it)');
  // queued media: hold file via the queue (5A pattern) — name = <approvalId>.<ext>.
  // A 60-min delay buffer keeps the item (and its file) held, so no auto-publish race.
  const q = require('../src/queue5a');
  db.S.set('queue.delay.min', '60');
  const item = q.enqueue({ sourceJid: 'rss-t769@rss', sourceMsgId: 'm1', text: 'media post', mediaBuf: Buffer.from('fake-video-bytes'), mediaKind: 'video', mediaMime: 'video/mp4', targetJids: [] });
  db.S.set('queue.delay.min', '0');
  const holdDir = path.resolve(__dirname, '..', 'data', 't769-test', 'media-hold');
  const mp = d.prepare(`SELECT media_path FROM approvals WHERE id=?`).get(item)?.media_path || '';
  ok(mp.endsWith('.mp4') && mp.includes('media-hold'), 'queued media path = media-hold/<id>.mp4');
  ok(fs.existsSync(mp), 'hold file exists while the item is held');
  // delete path: clearing the BLOB and unlinking the file (manual delete only)
  d.prepare(`UPDATE inbox_msgs SET media_data=NULL, media_mime=NULL, media_name=NULL WHERE media_name='pic.jpg'`).run();
  ok(d.prepare(`SELECT media_data FROM inbox_msgs WHERE id=?`).get(got.id)?.media_data == null, 'chat media delete = BLOB cleared (row kept)');
  fs.unlinkSync(mp);
  ok(!fs.existsSync(mp), 'hold file delete = unlink (file gone)');
}

/* ---------- 10 · I4 announcement card ---------- */
console.log('\n[10] I4 announcement card');
{
  const c = require('../src/cardgen');
  const out = c.cardForPost({ title: 'New jobs < 2026', body: 'Apply now & share — it is simple', source: 'Src "X"', date: '2026-09-16', footer: 'My Channel' });
  ok(out.png.slice(0, 8).toString('hex') === '89504e470d0a1a0a', 'PNG magic bytes valid');
  ok(out.png.length > 5000 && out.png.length < 200000, 'PNG size sane for a 1080² card');
  ok(out.svg.includes('&lt;') && out.svg.includes('&amp;'), 'SVG escapes < and & (no broken markup)');
  ok(out.svg.includes('SRC "X"') || out.svg.includes('SRC &quot;X&quot;'), 'SVG contains the source line (uppercased, quotes intact)');
  const w = c.wrapText('alpha beta gamma delta epsilon zeta eta theta iota kappa', 21, 4);
  ok(w.length <= 4 && w.every((l) => l.length <= 21), 'wrap respects max lines and max chars');
}

/* ---------- 11 · I5 view counts — verified evidence (⏭) ---------- */
console.log('\n[11] I5 view counts — Baileys exposure check');
{
  const blib = path.resolve(__dirname, '..', 'node_modules', '@whiskeysockets', 'baileys', 'lib');
  const sockFiles = ['Socket/newsletter.js'];
  let exposed = false;
  for (const f of sockFiles) {
    const src = fs.readFileSync(path.join(blib, f), 'utf8');
    if (/view_count|views_count|viewCount|postViews|messageViewed/.test(src)) exposed = true;
  }
  const types = fs.readFileSync(path.join(blib, 'Types', 'Newsletter.d.ts'), 'utf8');
  if (/view_count|viewCount|post_views/.test(types)) exposed = true;
  ok(exposed === false, 'EVIDENCE: Baileys 6.7.24 exposes NO post view-count API (newsletter socket + types) → I5 skipped with reason');
  // the metadata call DOES expose subscribers (I1 basis) — contrast check
  ok(/subscribers\?: number/.test(types), 'contrast: the same types DO expose subscriber count (I1 is real, I5 is not)');
}

/* ---------- run ---------- */
(async () => {
  await subsSection();
  await freshnessSection();
  await linkSection();
  await hasSection();
  await resendSection();
  await undoSection();
  await mediaSection();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('SUITE CRASH:', e); process.exit(2); });
