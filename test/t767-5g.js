'use strict';
/*
 * 5G (R80–R83) — unit tests:
 *  1. idempotent 5G migration on a populated pre-5G (5F-era) DB copy (R3)
 *  2. RSS/Atom parser (RSS2 + Atom, CDATA, entities, title-dup, caps, guids)
 *  3. webhooks engine — validation, off-by-default, event filtering, 3×retry
 *  4. pipeline.intakeRss — same-pipeline integration (stubbed publisher),
 *     guard rails: @rss-only, known sources, pause + panic, dedupe
 *  5. rss.pollOnce — fetch stub → pipeline + rss_seen belt
 */
const fs = require('fs');
const path = require('path');
const os = require('os');

process.env.DATABASE_PATH = 'data/t767-test/bot.sqlite';
process.env.SESSION_DIR = 'data/t767-test/sessions';
const DBFILE = path.resolve(__dirname, '..', 'data', 't767-test', 'bot.sqlite');
fs.rmSync(path.dirname(DBFILE), { recursive: true, force: true });
fs.mkdirSync(path.dirname(DBFILE), { recursive: true });

let passed = 0, failed = 0;
const ok = (cond, label) => { if (cond) { passed += 1; console.log('  ok  ' + label); } else { failed += 1; console.error('  FAIL ' + label); } };

/* ---------- 1 · 5G migration on a populated pre-5G DB ---------- */
console.log('\n[1] 5G migration on a populated pre-5G DB');
{
  const Database = require('better-sqlite3');
  const oldDb = new Database(DBFILE);
  oldDb.exec(`
    CREATE TABLE sources(
      jid TEXT PRIMARY KEY, name TEXT, added_at TEXT DEFAULT (datetime('now')),
      added_by TEXT DEFAULT '', paused INTEGER DEFAULT 0,
      targets TEXT DEFAULT '', last_post_at TEXT DEFAULT ''
    );
    CREATE TABLE settings(key TEXT PRIMARY KEY, value TEXT);
    CREATE TABLE targets(jid TEXT PRIMARY KEY, name TEXT, added_at TEXT DEFAULT (datetime('now')), added_by TEXT DEFAULT '', paused INTEGER DEFAULT 0);
  `);
  oldDb.prepare("INSERT INTO sources(jid,name,targets) VALUES('111@newsletter','Old WA Source','1@x,2@x')").run();
  oldDb.prepare("INSERT INTO settings(key,value) VALUES('power.dedupe.on','1')").run();
  oldDb.close();

  const db = require('../src/db');
  db.open();
  const d = db.open();
  const row = d.prepare('SELECT * FROM sources WHERE jid=?').get('111@newsletter');
  ok(row && row.kind === 'wa' && row.url === '', 'pre-existing WA source defaults to kind=wa, url="" (behavior unchanged)');
  ok('targets' in row && row.targets === '1@x,2@x', 'old columns untouched by migration');
  const tables = d.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('webhooks','rss_seen')").all().map((r) => r.name).sort();
  ok(JSON.stringify(tables) === JSON.stringify(['rss_seen', 'webhooks']), '5G tables created (webhooks, rss_seen)');
  ok(db.S.getBool('power.dedupe.on', false) === true, 'old settings preserved');

  // idempotent: a second open on the same DB must not throw
  let second = true;
  try { db.open(); } catch { second = false; }
  ok(second, 'second open on migrated DB is clean (idempotent)');
}

/* ---------- 2 · RSS/Atom parser ---------- */
console.log('\n[2] RSS/Atom parser');
{
  const rss = require('../src/rss');
  const RSS2 = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel><title>Dawn Business</title>
  <item>
    <title><![CDATA[First & biggest story]]></title>
    <link>https://dawn.com/story/1</link>
    <guid isPermaLink="false">dawn-1</guid>
    <pubDate>Wed, 08 Nov 2026 09:30:00 GMT</pubDate>
    <description><![CDATA[<p>First &amp; biggest story</p><p>The body of the story with <b>bold</b> and a line<br>break.</p>]]></description>
  </item>
  <item>
    <title>Second story</title>
    <link>https://dawn.com/story/2</link>
    <pubDate>Wed, 08 Nov 2026 08:00:00 GMT</pubDate>
    <description>Plain description &amp; entity test</description>
  </item>
</channel></rss>`;
  const items = rss.parseFeed(RSS2);
  ok(items.length === 2, 'parses 2 RSS2 items');
  ok(items[0].title === 'First & biggest story', 'CDATA + &amp; entities decoded in title');
  ok(items[0].link === 'https://dawn.com/story/1', 'link extracted');
  ok(items[0].id === 'dawn-1', 'guid used as item id');
  ok(items[0].ts === Date.parse('Wed, 08 Nov 2026 09:30:00 GMT'), 'pubDate parsed to epoch ms');
  ok(items[0].text.startsWith('First & biggest story') && items[0].text.includes('bold'), 'description stripped of tags, title kept');
  ok(!items[0].text.includes('First & biggest story\n\nFirst'), 'duplicated title in description not doubled');
  ok(items[1].id === 'https://dawn.com/story/2', 'guid falls back to link when absent');
  ok(items[1].text.includes('entity test'), 'plain-text description with entities decoded');

  const ATOM = `<?xml version="1.0"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Atom feed</title>
  <entry>
    <title>Atom headline</title>
    <link rel="alternate" href="https://blog.example/post/9"/>
    <id>tag:blog.example,2026:9</id>
    <updated>2026-11-08T10:00:00Z</updated>
    <summary>Atom summary text</summary>
  </entry>
</feed>`;
  const ai = rss.parseFeed(ATOM);
  ok(ai.length === 1 && ai[0].title === 'Atom headline', 'Atom entry parsed');
  ok(ai[0].link === 'https://blog.example/post/9', 'Atom link rel=alternate picked');
  ok(ai[0].id === 'tag:blog.example,2026:9', 'Atom <id> used');
  ok(ai[0].ts === Date.parse('2026-11-08T10:00:00Z'), 'Atom <updated> parsed');

  const many = Array.from({ length: 40 }, (_, i) => `<item><title>Item ${i}</title><link>https://x/${i}</link></item>`).join('');
  const capped = rss.parseFeed(`<rss version="2.0"><channel>${many}</channel></rss>`);
  ok(capped.length === 20, 'per-fetch item cap is 20 (runaway feed protection)');

  ok(rss.parseFeed('<rss version="2.0"><channel><title>empty</title></channel></rss>').length === 0, 'empty feed → 0 items');
  ok(rss.parseFeed('not xml at all').length === 0, 'garbage input → 0 items, no throw');

  const j1 = rss.rssJid('https://Dawn.com/feed'), j2 = rss.rssJid('https://dawn.com/feed/');
  ok(/@rss$/.test(j1) && j1.startsWith('rss-'), 'rss jid: rss-…@rss shape');
  ok(rss.rssJid('https://Dawn.com/feed') === rss.rssJid('https://Dawn.com/feed'), 'rss jid deterministic for the same URL');
  ok(j1 !== rss.rssJid('https://dawn.com/other') , 'different URL → different jid');
  void j2;
}

/* ---------- 3 · webhooks engine ---------- */
console.log('\n[3] webhooks engine');
async function webhooksSection() {
  const wh = require('../src/webhooks');
  const db = require('../src/db');
  const d = db.open();
  d.prepare('DELETE FROM webhooks').run();

  // validation
  let threw = '';
  try { wh.add({ url: 'https://x.com/hook', events: ['post.published'] }); } catch (e) { threw = e.message; }
  ok(/name/i.test(threw), 'add rejects a missing name');
  threw = '';
  try { wh.add({ name: 'No url' }); } catch (e) { threw = e.message; }
  ok(/url/i.test(threw), 'add rejects a missing/invalid URL');
  threw = '';
  try { wh.add({ name: 'Bad proto', url: 'ftp://x.com' }); } catch (e) { threw = e.message; }
  ok(/http/i.test(threw), 'add rejects non-http(s) URLs');
  threw = '';
  try { wh.add({ name: 'No events', url: 'https://x.com/hook' }); } catch (e) { threw = e.message; }
  ok(/event/i.test(threw), 'add rejects an empty event list');
  threw = '';
  try { wh.add({ name: 'Fake', url: 'https://x.com/hook', events: ['not.a.real.event'] }); } catch (e) { threw = e.message; }
  ok(/event/i.test(threw), 'add rejects unknown event keys only (none left valid)');

  // success + list
  const id1 = wh.add({ name: 'Zapier', url: 'https://zap.example/hook', events: ['post.published', 'panic.on'] });
  const id2 = wh.add({ name: 'N8n', url: 'https://n8n.example/hook', events: ['post.failed'] });
  const list = wh.list();
  ok(list.length === 2 && list[0].name === 'Zapier' && list[0].events.length === 2, 'list returns added webhooks with event arrays');
  ok(list[1].id === id2, 'ids are stable');

  // capture fetch
  const calls = [];
  const realFetch = global.fetch;
  global.fetch = async (url, opts) => { calls.push({ url: String(url), opts }); return { ok: true, status: 200 }; };
  try {
    wh.fire('post.published', { source: 'X' });
    wh.fire('post.failed', { source: 'X' });
    wh.fire('panic.on', {});
    wh.fire('not.a.real.event', {});
    await new Promise((r) => setTimeout(r, 30));
    ok(calls.length === 3, 'fire sends only to subscribed, enabled webhooks (3 hits: zapier×2, n8n×1)');
    const body = JSON.parse(calls[0].opts.body);
    ok(body.event === 'post.published' && body.payload.source === 'X' && body.bot && body.at, 'payload has bot/event/at/payload envelope');
    ok(calls[0].opts.headers['x-raqifluz-event'] === 'post.published', 'event header sent');

    // disabled → nothing (zapier was the only post.published subscriber)
    wh.setEnabled(id1, false);
    calls.length = 0;
    wh.fire('post.published', {});
    await new Promise((r) => setTimeout(r, 20));
    ok(calls.length === 0, 'disabled webhook receives nothing');
    wh.fire('post.failed', {});
    await new Promise((r) => setTimeout(r, 20));
    ok(calls.length === 1, 'the other webhook (n8n, enabled) still receives its event');
    wh.setEnabled(id1, true);

    // retry: success on 2nd attempt
    let n = 0;
    global.fetch = async () => { n++; return n < 2 ? { ok: false, status: 500 } : { ok: true, status: 200 }; };
    wh._setDelayScale(0);
    await wh.testHook(id1);
    wh._setDelayScale(1);
    ok(n === 2, 'test retries (500 then 200) — 2 attempts');
    const row1 = d.prepare('SELECT * FROM webhooks WHERE id=?').get(id1);
    ok(/ok 200/.test(row1.last_status), 'last_status records the successful attempt');

    // all fail → 3 attempts, honest status
    n = 0;
    global.fetch = async () => { n++; throw new Error('ECONNREFUSED'); };
    wh._setDelayScale(0);
    const bad = await wh.testHook(id1);
    wh._setDelayScale(1);
    ok(n === 3 && bad.ok === false, 'unreachable endpoint: exactly 3 attempts, honest failure');
    const row1b = d.prepare('SELECT * FROM webhooks WHERE id=?').get(id1);
    ok(/ECONNREFUSED/.test(row1b.last_status), 'last_status records the final error');

    // off-by-default: delete all → fire is a no-op
    wh.del(id1); wh.del(id2);
    n = 0;
    global.fetch = async () => { n++; return { ok: true, status: 200 }; };
    wh.fire('alert', {});
    await new Promise((r) => setTimeout(r, 20));
    ok(n === 0, 'no webhooks configured → nothing is ever sent (off by default)');
    const none = await wh.testHook(999);
    ok(none.ok === false && /not found/i.test(none.error), 'test on a missing id is an honest error');
  } finally { global.fetch = realFetch; }
}

/* ---------- 4 · pipeline.intakeRss (stubbed publisher) ---------- */
console.log('\n[4] pipeline.intakeRss — same pipeline, guard rails');
let pubCalls = [];
function loadPipelineFresh() {
  for (const k of Object.keys(require.cache)) {
    if (k.includes('/src/')) delete require.cache[k];
  }
  pubCalls = [];
  require.cache[require.resolve('../src/publish')] = {
    id: require.resolve('../src/publish'), filename: require.resolve('../src/publish'), loaded: true,
    exports: {
      publish: async (content, meta) => {
        pubCalls.push({ content, meta });
        // mirror the REAL publish.js side effects (post row + key) minus the socket
        const db2 = require('../src/db');
        const bodyText = (content && (content.text !== undefined ? content.text : (content.parts ? (content.parts[0].text || (content.parts[0].caption || '')) : ''))) || '';
        db2.P.mark(meta.sourceJid, meta.sourceMsgId, 'published', String(meta.norm || '').slice(0, 400), bodyText, Boolean(meta.hasMedia));
        const postId = db2.P.postId(meta.sourceJid, meta.sourceMsgId);
        if (postId) db2.P.addKey(postId, 'T@newsletter', 'RSSSTUB');
        return { sent: 1, failed: 0, errors: [], keys: [{ target: 'T@newsletter', msgId: 'RSSSTUB' }] };
      }
    }
  };
  return require('../src/pipeline');
}
async function intakeSection() {
  const pipeline = loadPipelineFresh();
  const db = require('../src/db');
  const d = db.open();
  const rss = require('../src/rss');
  const jid = rss.rssJid('https://feeds.example/rss');
  const srcName = 'Example Feed';
  d.prepare("INSERT INTO sources(jid,name,kind,url,targets) VALUES(?,?,?,?,?)").run(jid, srcName, 'rss', 'https://feeds.example/rss', 'T@newsletter');
  d.prepare("INSERT OR REPLACE INTO targets(jid,name) VALUES('T@newsletter','My Target')").run();

  // 1) happy path: RSS item flows through the pipeline and "publishes"
  await pipeline.intakeRss({ jid, id: 'msg-1', text: 'Breaking: the RSS pipeline works end to end.', ts: Date.now(), title: 'Breaking', link: 'https://x/1', url: 'https://feeds.example/rss', sourceName: srcName });
  ok(pubCalls.length === 1, 'RSS item went through the pipeline (publisher called once)');
  const post = d.prepare('SELECT * FROM posts WHERE source_jid=? AND source_msg_id=?').get(jid, 'msg-1');
  ok(post && post.status === 'published', 'post row created with status published');
  ok(post && /RSS pipeline works/.test(post.reason || ''), 'post body carried through');
  ok(pubCalls[0].meta.only.join(',') === 'T@newsletter', 'per-source mapping targets respected');

  // 2) dedupe: same id again → no second publish
  await pipeline.intakeRss({ jid, id: 'msg-1', text: 'Breaking: the RSS pipeline works end to end.', ts: Date.now(), title: 'Breaking', link: 'https://x/1', url: 'https://feeds.example/rss', sourceName: srcName });
  ok(pubCalls.length === 1, 'same item id re-fed → deduped (no second publish)');

  // 3) non-rss jid → ignored, even if it looks like a real channel
  await pipeline.intakeRss({ jid: '999@newsletter', id: 'x-1', text: 'should be ignored', ts: Date.now() });
  ok(pubCalls.length === 1, 'non-@rss jid is ignored (intakeRss never touches WA channels)');

  // 4) unknown rss jid (not a source) → ignored
  await pipeline.intakeRss({ jid: rss.rssJid('https://not-added.example/feed'), id: 'x-2', text: 'no source', ts: Date.now() });
  ok(pubCalls.length === 1, 'rss jid without a matching source is ignored');

  // 5) paused rss source → ignored
  d.prepare('UPDATE sources SET paused=1 WHERE jid=?').run(jid);
  await pipeline.intakeRss({ jid, id: 'msg-2', text: 'while paused', ts: Date.now(), sourceName: srcName });
  ok(pubCalls.length === 1, 'paused feed is ignored');
  d.prepare('UPDATE sources SET paused=0 WHERE jid=?').run(jid);

  // 6) global pause (mirror.paused) → ignored
  db.S.set('mirror.paused', '1');
  await pipeline.intakeRss({ jid, id: 'msg-3', text: 'while globally paused', ts: Date.now(), sourceName: srcName });
  ok(pubCalls.length === 1, 'global pause holds RSS intake too');
  db.S.set('mirror.paused', '0');

  // 7) panic stop → ignored
  db.S.set('panic.on', '1');
  await pipeline.intakeRss({ jid, id: 'msg-4', text: 'during panic', ts: Date.now(), sourceName: srcName });
  ok(pubCalls.length === 1, 'panic stop holds RSS intake too');
  db.S.set('panic.on', '0');

  // 8) overlong text is truncated, never lost to a crash
  await pipeline.intakeRss({ jid, id: 'msg-5', text: 'word '.repeat(4000).trim(), ts: Date.now(), sourceName: srcName });
  ok(pubCalls.length === 2, 'overlong item still processed (truncated, no throw)');

  // 9) intake() (the WA entry) still refuses @rss — contract untouched (R2)
  await pipeline.intake({ key: { remoteJid: jid, id: 'wa-1', fromMe: false }, message: { extendedTextMessage: { text: 'x' } }, messageTimestamp: Math.floor(Date.now() / 1000) });
  ok(pubCalls.length === 2, 'intake() untouched: an @rss jid arriving as a WA message is not processed by the WA entry');

  // 10) keyword source-rule applies to RSS posts too (same pipeline)
  db.SR.save(jid, { include: 'special' });
  await pipeline.intakeRss({ jid, id: 'msg-6', text: 'a plain item without the keyword', ts: Date.now(), sourceName: srcName });
  const skipped = d.prepare('SELECT status FROM posts WHERE source_jid=? AND source_msg_id=?').get(jid, 'msg-6');
  ok(pubCalls.length === 2 && skipped && skipped.status === 'skipped', 'source rule card (keyword include) filters RSS posts like WA posts');
  d.prepare('DELETE FROM source_rules WHERE source_jid=?').run(jid);
}

/* ---------- 5 · rss.pollOnce — fetch → pipeline + rss_seen belt ---------- */
console.log('\n[5] rss.pollOnce — fetch, dedupe belt, cap');
async function pollSection() {
  loadPipelineFresh();
  const rss = require('../src/rss');
  const db = require('../src/db');
  const d = db.open();
  const url = 'https://feeds2.example/rss';
  const jid = rss.rssJid(url);
  d.prepare("INSERT INTO sources(jid,name,kind,url,targets) VALUES(?,?,?,?,?)").run(jid, 'Feed Two', 'rss', url, 'T@newsletter');

  const XML = `<?xml version="1.0"?><rss version="2.0"><channel><title>F2</title>
    <item><title>Poll item A</title><link>https://f2.example/a</link><guid>pa</guid><pubDate>Wed, 08 Nov 2026 09:00:00 GMT</pubDate><description>Alpha story body.</description></item>
    <item><title>Poll item B</title><link>https://f2.example/b</link><guid>pb</guid><pubDate>Wed, 08 Nov 2026 09:30:00 GMT</pubDate><description>Beta story body.</description></item>
  </channel></rss>`;
  const realFetch = global.fetch;
  global.fetch = async (u) => { if (String(u).startsWith(url)) return { ok: true, text: async () => XML }; throw new Error('unexpected fetch ' + u); };
  try {
    const r1 = await rss.pollOnce({ jid, name: 'Feed Two', url });
    ok(r1.items === 2 && r1.added === 2 && r1.seen === 0, 'first poll: 2 items, both added');
    const posts = d.prepare('SELECT source_msg_id FROM posts WHERE source_jid=?').all(jid).map((p) => p.source_msg_id).sort();
    ok(JSON.stringify(posts) === JSON.stringify(['pa', 'pb']), 'both items reached the pipeline as posts');
    const r2 = await rss.pollOnce({ jid, name: 'Feed Two', url });
    ok(r2.added === 0 && r2.seen === 2, 'second poll: rss_seen belt blocks re-publish (added 0, seen 2)');
    const seenRows = d.prepare('SELECT COUNT(*) c FROM rss_seen WHERE url=?').get(url).c;
    ok(seenRows === 2, 'rss_seen rows persisted per (url, guid)');
  } finally { global.fetch = realFetch; }
}

(async () => {
  await webhooksSection();
  await intakeSection();
  await pollSection();
  console.log(`\nALL — ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('CRASH', e); process.exit(1); });
