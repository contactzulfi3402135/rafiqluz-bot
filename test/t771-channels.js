'use strict';
/*
 * v7.7.3 — follow-state sync: the Sources list mirrors the phone's follow state.
 *  1. unfollowDecision — streak / grace / reset (pure)
 *  2. refreshDirectory — mocked socket: names, roles, unfollow removal,
 *     directory forget, audit row, scan stat
 *  3. /api/directory/rescan + /api/directory — route contract
 */
const fs = require('fs');
const path = require('path');

process.env.DATABASE_PATH = 'data/t771-test/bot.sqlite';
process.env.SESSION_DIR = 'data/t771-test/sessions';
const DBFILE = path.resolve(__dirname, '..', 'data', 't771-test', 'bot.sqlite');
fs.rmSync(path.dirname(DBFILE), { recursive: true, force: true });
fs.mkdirSync(path.dirname(DBFILE), { recursive: true });

let passed = 0, failed = 0;
const ok = (cond, label) => { if (cond) { passed += 1; console.log('  ok  ' + label); } else { failed += 1; console.error('  FAIL ' + label); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

for (const k of Object.keys(require.cache)) if (k.includes('/src/')) delete require.cache[k];
const { CH, AUD, open } = require('../src/db');
const wa = require('../src/wa');
const channels = require('../src/channels');

/* ================= 1 · unfollowDecision (pure) ================= */
console.log('\n[1] unfollowDecision');
{
  const r = channels.unfollowDecision(5, true, true, 99 * 60e3);
  ok(r.streak === 0 && r.remove === false, 'role present → streak resets to 0, never removes');
  let d = channels.unfollowDecision(0, false, true, 16 * 60e3);
  ok(d.streak === 1 && d.remove === false, 'first no-role check → streak 1, no removal yet');
  d = channels.unfollowDecision(1, false, true, 16 * 60e3);
  ok(d.streak === 2 && d.remove === true, 'second consecutive no-role check (past 15-min grace, is a source) → remove');
  d = channels.unfollowDecision(1, false, false, 16 * 60e3);
  ok(d.streak === 2 && d.remove === false, 'streak counted but not a source → never removed');
  d = channels.unfollowDecision(1, false, true, 1 * 60e3);
  ok(d.remove === false, 'within the 15-minute fresh-link grace → no removal');
  d = channels.unfollowDecision(1, false, true, 14 * 60e3 + 59e3);
  ok(d.remove === false, 'grace boundary (just under 15 min) → no removal');
}

/* ================= 2 · refreshDirectory (mocked socket) ================= */
console.log('\n[2] refreshDirectory (mocked WA)');
const NEWSA = '1203630000000000001@newsletter'; // still followed
const NEWSB = '1203630000000000002@newsletter'; // unfollowed → removed after 2 checks
const NEWSC = '1203630000000000003@newsletter'; // unfollowed once, followed again → kept (reset)
const NEWSD = '1203630000000000004@newsletter'; // unfollowed, directory-only entry → forgotten
const metaMap = {
  [NEWSA]: { name: 'Alpha News', role: 'VIEWER' },
  [NEWSB]: { name: 'Beta News', role: '' },
  [NEWSC]: { name: 'Gamma News', role: '' },
  [NEWSD]: { name: 'Delta News', role: '' }
};

CH.recordDir(NEWSA, 'Alpha News', 'VIEWER');
CH.recordDir(NEWSB, 'Beta News', 'VIEWER');
CH.recordDir(NEWSC, 'Gamma News', 'VIEWER');
CH.recordDir(NEWSD, 'Delta News', 'VIEWER');
CH.addSource(NEWSA, 'Alpha News', 'auto-follow');
CH.addSource(NEWSB, 'Beta News', 'auto-follow');
CH.addSource(NEWSC, 'Gamma News', 'auto-follow');

const fakeSock = {};
const realGetSocket = wa.getSocket, realStatus = wa.getStatus, realMeta = wa.channelMeta;
wa.getSocket = () => fakeSock;
wa.getStatus = () => ({ status: 'open' });
wa.channelMeta = async (sock, jid) => {
  const m = metaMap[jid];
  if (!m) return null;
  return { name: m.name, role: m.role, canPost: m.role === 'OWNER' || m.role === 'ADMIN' };
};

(async () => {
  let s1 = await channels.refreshDirectory();
  ok(s1.checked >= 4, 'scan reports how many channels it checked');
  ok(CH.listSources().some((s) => s.jid === NEWSB), '1st no-role check → source still kept (streak 1, no false positive)');
  ok(CH.listSources().some((s) => s.jid === NEWSC), '1st no-role check → kept');

  metaMap[NEWSC].role = 'VIEWER'; // followed again before the 2nd check
  let s2 = await channels.refreshDirectory();
  ok(!CH.listSources().some((s) => s.jid === NEWSB), '2nd consecutive no-role check → removed from Sources');
  ok(s2.removed.some((n) => String(n).includes('Beta')), 'scan stat reports what it removed');
  ok(CH.listSources().some((s) => s.jid === NEWSC), 'followed again in the meantime → streak reset, source kept');
  ok(CH.listSources().some((s) => s.jid === NEWSA), 'still-followed source untouched');
  ok(!CH.dirList().some((d) => d.jid === NEWSD), 'unfollowed directory-only channel forgotten from the pickers');
  ok(!CH.dirList().some((d) => d.jid === NEWSB), 'unfollowed channel also leaves the pickers (directory) in the same pass');
  const audited = open().prepare("SELECT COUNT(*) n FROM audit WHERE action='sources.unfollow-removed'").get().n;
  ok(audited >= 1, 'removal is written to the audit trail');

  // restore real WA for the route tests (never connected → null socket)
  wa.getSocket = realGetSocket; wa.getStatus = realStatus; wa.channelMeta = realMeta;

  /* ================= 3 · routes ================= */
  console.log('\n[3] /api/directory routes');
  const { build } = require('../src/web/server');
  const express = require('express');
  const a = express();
  build(a);
  const layer = a._router.stack.find((l) => !l.route && l.name === 'router' && l.handle.stack && l.handle.stack.some((x) => x.route && x.route.path === '/directory/rescan'));
  ok(!!layer, 'api router exposes /directory/rescan');
  const router = layer.handle;
  const routeOf = (method, p) => {
    const local = p.startsWith('/api') ? p.slice(4) : p;
    const l = router.stack.find((x) => x.route && x.route.path === local && x.route.methods[method.toLowerCase()]);
    if (!l) throw new Error('route not found: ' + method + ' ' + p);
    const handles = l.route.stack.map((s) => s.handle).filter(Boolean);
    return handles[handles.length - 1];
  };

  let status = 0, body = null;
  routeOf('POST', '/api/directory/rescan')({}, { status: (c) => { status = c; return { json: (b) => { body = b; } }; }, json: (b) => { body = b; } });
  await sleep(50);
  ok(status === 400 && /not connected/i.test(String(body && body.error)), 'rescan without WhatsApp → 400 with a human, actionable message');

  let gbody = null;
  routeOf('GET', '/api/directory')({}, { json: (b) => { gbody = b; } });
  ok(gbody && gbody.ok === true && Array.isArray(gbody.list), 'GET /directory still returns the list');
  ok(gbody && !!gbody.wa && gbody.scan && typeof gbody.scan.checked === 'number', 'GET /directory now exposes WA state + last scan stat');
  ok(gbody.scan.removed.length === 1, 'scan stat carries the removed names into the UI payload');

  console.log(`\nT771-CHANNELS: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((err) => { console.error('SUITE CRASH:', err); process.exit(1); });
