'use strict';
/*
 * v7.8.0 — Browse channels: curated catalog integrity, follow/unfollow/
 * add-source flows (mocked socket), browse routes, browse_meta cache.
 */
const fs = require('fs');
const path = require('path');

process.env.DATABASE_PATH = 'data/t772-test/bot.sqlite';
process.env.SESSION_DIR = 'data/t772-test/sessions';
const DBFILE = path.resolve(__dirname, '..', 'data', 't772-test', 'bot.sqlite');
fs.rmSync(path.dirname(DBFILE), { recursive: true, force: true });
fs.mkdirSync(path.dirname(DBFILE), { recursive: true });

let passed = 0, failed = 0;
const ok = (cond, label) => { if (cond) { passed += 1; console.log('  ok  ' + label); } else { failed += 1; console.error('  FAIL ' + label); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

for (const k of Object.keys(require.cache)) if (k.includes('/src/')) delete require.cache[k];
const { S, CH, AUD, BM, open } = require('../src/db');
const wa = require('../src/wa');
const channels = require('../src/channels');
const catg = require('../src/catalog');

/* ================= 1 · catalog integrity ================= */
console.log('\n[1] catalog integrity');
{
  const ids = new Set();
  let dup = 0, bad = 0;
  for (const e of catg.CATALOG) {
    if (ids.has(e.id)) dup += 1;
    ids.add(e.id);
    if (!/^0029[A-Za-z0-9]{16,}$/.test(e.id) || !e.name) bad += 1;
    if (!catg.CATEGORIES.includes(e.category) || !catg.COUNTRIES.includes(e.country)) bad += 1;
  }
  ok(catg.CATALOG.length >= 5000, 'catalog ships a real directory (v7.9: ≥5000 channels — scroll for a long time)');
  ok(dup === 0, 'no duplicate channel ids');
  ok(bad === 0, 'every entry has a valid code, name, known category + country');
  const names = new Set();
  for (const e of catg.CATALOG) names.add(e.name.trim().toLowerCase());
  ok(names.size === catg.CATALOG.length, 'no duplicate channel names (one row per brand)');
  const perCat = {};
  for (const e of catg.CATALOG) perCat[e.category] = (perCat[e.category] || 0) + 1;
  ok(catg.CATEGORIES.length >= 12, 'v7.9: 12+ categories (Education, Sports and many more)');
  ok(catg.CATEGORIES.every((c) => perCat[c] >= 1), 'every category has at least one channel');
  ok((perCat.News || 0) >= 500 && (perCat.Sports || 0) >= 300, 'News and Sports are deep (the two biggest browse categories)');
  const pk = catg.CATALOG.filter((e) => e.country === 'Pakistan').length;
  const in_ = catg.CATALOG.filter((e) => e.country === 'India').length;
  ok(pk >= 20 && in_ >= 20, 'Pakistan + India well covered (owner’s regions)');
  ok(catg.resolveCode('https://whatsapp.com/channel/0029Va7aTwe5vKAEyI4EIB2O?ref=x') === '0029Va7aTwe5vKAEyI4EIB2O', 'resolveCode: whatsapp.com/channel link + query');
  ok(catg.resolveCode('https://chat.whatsapp.com/0029VaCpW8CBfxo2ZsEYST0c') === '0029VaCpW8CBfxo2ZsEYST0c', 'resolveCode: chat.whatsapp.com invite');
  ok(catg.resolveCode('https://channels.whatsapp.com/0029Va6rPOA2Jl8J28ykFD0l') === '0029Va6rPOA2Jl8J28ykFD0l', 'resolveCode: channels.whatsapp.com');
  ok(catg.resolveCode('0029Va9uaY5GehEUKumxYV1B') === '0029Va9uaY5GehEUKumxYV1B', 'resolveCode: raw code');
  ok(catg.resolveCode('https://example.com/nope') === null, 'resolveCode: rejects non-channel links');
}

/* ================= 2 · follow / unfollow / add-source (mocked socket) ================= */
console.log('\n[2] browse flows (mocked WA)');
const CODE = '0029VaTestChannelCode0001';
const JID = '1203630000000000099@newsletter';
const fakeSock = { calls: [] };
fakeSock.newsletterMetadata = async (type, key) => {
  if (type === 'invite' && key === CODE) return { id: JID, name: 'Test Channel' };
  return null;
};
fakeSock.newsletterFollow = async (jid) => { fakeSock.calls.push(['follow', jid]); return {}; };
fakeSock.newsletterUnfollow = async (jid) => { fakeSock.calls.push(['unfollow', jid]); return {}; };
const realGetSocket = wa.getSocket, realStatus = wa.getStatus;

(async () => {
  wa.getSocket = () => fakeSock;
  wa.getStatus = () => ({ status: 'open' });

  let r = await channels.browseFollow(CODE);
  ok(r.ok && r.jid === JID && r.name === 'Test Channel', 'follow resolves the code → jid and follows it');
  ok(fakeSock.calls.some((c) => c[0] === 'follow' && c[1] === JID), 'real newsletterFollow called with the jid');
  ok(CH.dirList().some((d) => d.jid === JID), 'followed channel recorded in the directory (pickers)');
  ok(CH.listSources().some((s) => s.jid === JID), 'Browse-Follow → channel joins Sources (discover → monitor)');
  ok(open().prepare("SELECT COUNT(*) n FROM audit WHERE action='browse.follow'").get().n >= 1, 'follow is audit-logged');
  ok(BM.get(CODE) && BM.get(CODE).jid === JID, 'code→jid resolved once and cached (browse_meta)');

  r = await channels.browseFollow(CODE);
  ok(r.ok && r.already === true && r.inSources === true, 'second follow of the same channel → already, reports Sources state');

  /* v7.9: Browse-Follow ALWAYS adds the channel to Sources — the tab's purpose
     is discover → monitor; the Auto-monitor switch does not gate an explicit click. */
  S.set('channels.automonitor', '0');
  const CODE2 = '0029VaTestChannelCode0002';
  const JID2 = '1203630000000000098@newsletter';
  fakeSock.newsletterMetadata = async (type, key) => (key === CODE2 ? { id: JID2, name: 'Second Channel' } : null);
  let r2 = await channels.browseFollow(CODE2, {});
  ok(r2.addedToSources && CH.listSources().some((s) => s.jid === JID2), 'Browse-Follow joins Sources even with Auto-monitor OFF (explicit action)');
  r2 = await channels.browseFollow(CODE2, {});
  ok(r2.already === true && r2.addedToSources === false && r2.inSources === true, 're-follow of an already-followed source → already, no duplicate');
  ok(open().prepare("SELECT COUNT(*) n FROM audit WHERE action='browse.follow'").get().n >= 1, 'still audit-logged');

  /* v7.9: syncFollowed — one click adds every followed, not-yet-source channel */
  CH.removeSource(JID2); // followed but NOT a source (as if Auto-monitor had been off)
  const added = channels.syncFollowed();
  ok(added.includes('Second Channel'), 'syncFollowed adds followed channels that are not sources yet');
  ok(CH.listSources().some((s) => s.jid === JID2), 'syncFollowed: the source row exists');
  ok(open().prepare("SELECT COUNT(*) n FROM audit WHERE action='sources.sync-followed'").get().n >= 1, 'syncFollowed is audit-logged');

  /* add-source by code for an already-followed channel */
  S.set('channels.automonitor', '1');
  CH.removeSource(JID2); // clean state: the channel is followed but NOT a source
  const r3 = await channels.browseAddSource(CODE2);
  ok(r3.ok && CH.listSources().some((s) => s.jid === JID2), 'add-source by public code resolves and adds');
  let r3e = null;
  try { await channels.browseAddSource('0029VaNeverSeenCode00003'); } catch (e) { r3e = e.message; }
  ok(/not recognised|not found/i.test(r3e || ''), 'add-source for an unknown channel → clear error');

  /* unfollow by code → removes source + audit */
  const r4 = await channels.browseUnfollow(CODE);
  ok(r4.ok && r4.removedFromSources === true, 'unfollow by code removes the channel from Sources');
  ok(!CH.listSources().some((s) => s.jid === JID), 'source row gone');
  ok(fakeSock.calls.some((c) => c[0] === 'unfollow' && c[1] === JID), 'real newsletterUnfollow called');
  ok(open().prepare("SELECT COUNT(*) n FROM audit WHERE action='browse.unfollow'").get().n >= 1, 'unfollow is audit-logged');

  wa.getSocket = realGetSocket; wa.getStatus = realStatus;

  /* ================= 3 · routes ================= */
  console.log('\n[3] /api/browse routes');
  const { build } = require('../src/web/server');
  const express = require('express');
  const a = express();
  build(a);
  const layer = a._router.stack.find((l) => !l.route && l.name === 'router' && l.handle.stack && l.handle.stack.some((x) => x.route && x.route.path === '/browse/channels'));
  ok(!!layer, 'api router exposes /browse/channels');
  const router = layer.handle;
  const routeOf = (method, p) => {
    const local = p.startsWith('/api') ? p.slice(4) : p;
    const l = router.stack.find((x) => x.route && x.route.path === local && x.route.methods[method.toLowerCase()]);
    if (!l) throw new Error('route not found: ' + method + ' ' + p);
    const handles = l.route.stack.map((s) => s.handle).filter(Boolean);
    return handles[handles.length - 1];
  };

  let g = null;
  routeOf('GET', '/api/browse/channels')({ query: {} }, { json: (b) => { g = b; } });
  ok(g.ok && Array.isArray(g.list) && g.list.length === 12, 'GET default: page of 12');
  ok(g.total >= 60 && g.hasMore === true, 'GET default: total + hasMore for endless paging');
  ok(g.categories.includes('Sports') && g.countries.includes('Pakistan'), 'GET default: categories + countries for the filters');
  ok(g.list.every((c) => typeof c.following === 'boolean' && typeof c.inSources === 'boolean'), 'GET rows carry live follow/source state');

  routeOf('GET', '/api/browse/channels')({ query: { category: 'Sports' } }, { json: (b) => { g = b; } });
  ok(g.list.length > 0 && g.list.every((c) => c.category === 'Sports'), 'category filter narrows to Sports only');
  routeOf('GET', '/api/browse/channels')({ query: { country: 'Pakistan' } }, { json: (b) => { g = b; } });
  ok(g.list.every((c) => c.country === 'Pakistan'), 'country filter narrows to Pakistan only');
  routeOf('GET', '/api/browse/channels')({ query: { q: 'cricket' } }, { json: (b) => { g = b; } });
  ok(g.total >= 3 && g.list.every((c) => (c.name + ' ' + c.blurb).toLowerCase().includes('cricket')), 'search filters by name/blurb');
  routeOf('GET', '/api/browse/channels')({ query: {} }, { json: (b) => { g = b; } });
  ok(g.catalogTotal === catg.CATALOG.length, 'v7.9: GET exposes catalogTotal for the honest footnote count');
  const p1 = [];
  routeOf('GET', '/api/browse/channels')({ query: { size: '10', page: '1' } }, { json: (b) => { p1.push(b); } });
  const p2 = [];
  routeOf('GET', '/api/browse/channels')({ query: { size: '10', page: '2' } }, { json: (b) => { p2.push(b); } });
  ok(p1[0].list[0].id !== p2[0].list[0].id && p2[0].hasMore === true, 'pagination: page 2 is a different slice, still more');
  const last = [];
  routeOf('GET', '/api/browse/channels')({ query: { size: '50', page: String(Math.ceil(p1[0].total / 50)) } }, { json: (b) => { last.push(b); } });
  ok(last[0].hasMore === false, 'pagination: final page reports hasMore=false (scroll ends)');

  /* follow route (mocked again) */
  wa.getSocket = () => fakeSock;
  wa.getStatus = () => ({ status: 'open' });
  let st = 0, body = null;
  const resMock = { status: (c) => { st = c; return { json: (b) => { body = b; } }; }, json: (b) => { body = b; } };
  routeOf('POST', '/api/browse/follow')({ body: { link: 'https://whatsapp.com/channel/' + CODE } }, resMock);
  await sleep(60);
  ok(st !== 400 && body && body.ok === true && body.name === 'Test Channel', 'POST follow with a full link → ok (via route)');
  wa.getSocket = realGetSocket; wa.getStatus = realStatus;
  st = 0; body = null;
  routeOf('POST', '/api/browse/follow')({ body: { link: CODE } }, resMock);
  await sleep(60);
  ok(st === 400 && /not connected/i.test(String(body && body.error)), 'POST follow without WhatsApp → 400 with an actionable message');

  /* v7.9: one-click "add all followed channels" from the Sources tab */
  st = 0; body = null;
  routeOf('POST', '/api/sources/sync-followed')({ body: {} }, resMock);
  await sleep(40);
  ok(st !== 400 && body && body.ok === true && Array.isArray(body.added) && typeof body.count === 'number', 'v7.9: POST /sources/sync-followed → ok + added list + count');

  /* ================= 4 · v7.9.1 search behaves like real WhatsApp search ================= */
  console.log("\n[4] v7.9.1 — word-based search (the \"exact name didn't come up\" fix)");
  {
    const g1 = [];
    routeOf('GET', '/api/browse/channels')({ query: { q: 'india times' } }, { json: (b) => g1.push(b) });
    ok(g1[0].list.some((c) => /times of india/i.test(c.name)), 'word search finds "The Times of India" for "india times" (words out of order — the exact-name miss, fixed)');
    const g2 = [];
    routeOf('GET', '/api/browse/channels')({ query: { q: 'geo news' } }, { json: (b) => g2.push(b) });
    ok(g2[0].list.length > 0 && /geo/i.test(g2[0].list[0].name) && /news/i.test(g2[0].list[0].name), 'multi-word search: the name carrying every word ranks first ("geo news" → Geo News)');
    const g3 = [];
    routeOf('GET', '/api/browse/channels')({ query: { q: 'zzqxnonexistentword' } }, { json: (b) => g3.push(b) });
    ok(g3[0].total === 0, 'nonsense query → 0 results (no false positives)');
  }

  /* ================= 5 · v7.9.1 phone follows appear in Sources automatically ================= */
  console.log('\n[5] v7.9.1 — a followed channel\'s first post auto-joins Sources (no clicks)');
  {
    S.set('channels.automonitor', '1'); // the documented default: auto-update the list
    channels.init(); // register the wa.message detection listener
    const PF_JID = '99999999999999901@newsletter';
    wa.events.emit('wa.message', { key: { remoteJid: PF_JID, id: 'msg-phone-follow' }, pushName: 'Phone Followed Channel' });
    await sleep(80);
    const dirRow = CH.dirList().find((d) => d.jid === PF_JID);
    ok(!!dirRow && dirRow.role === 'VIEWER', 'post from an unknown @newsletter → recorded in the directory with a viewer role (a linked device only receives posts from followed channels)');
    ok(CH.listSources().some((s) => s.jid === PF_JID), 'auto-monitor added the phone-followed channel to Sources automatically');
    wa.events.emit('wa.message', { key: { remoteJid: PF_JID, id: 'msg-again' }, pushName: 'Phone Followed Channel' });
    await sleep(80);
    ok(CH.listSources().filter((s) => s.jid === PF_JID).length === 1, 'second post → no duplicate source row');
  }

  console.log(`\nT772-BROWSE: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((err) => { console.error('SUITE CRASH:', err); process.exit(1); });
