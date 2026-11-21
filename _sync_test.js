'use strict';
/* v1.2 — follow/unfollow sync + name resolution, end-to-end through the REAL
   web server (only the WhatsApp socket is faked).
   Covers: follow → sources/browse/directory consistency, unfollow → reverse,
   idempotency (double follow), numeric-name masking + background recovery
   from WhatsApp metadata, SSE 'channels' broadcast.
   Run: node _sync_test.js */
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'raqsync-'));
process.env.DATABASE_PATH = path.join(tmp, 'bot.sqlite');
process.env.SESSION_DIR = path.join(tmp, 'sessions');
process.env.DASHBOARD_PASSWORD = 'testpw';

/* ---- fake WhatsApp socket (injected into the real wa module) ---- */
const wa = require('./src/wa');
const KNOWN = {
  '0029Va43T73BPzjaAmcDZf3x@newsletter': '20 Minuten',
  '0029Va4miHb4IBh62o0tsO2V@newsletter': '24 Horas | TVN',
  '1234567890@newsletter': 'Recovered Channel Name'
};
const followed = new Set();
let metaCalls = 0;
const fakeSocket = {
  newsletterFollow: async (jid) => { followed.add(jid); return {}; },
  newsletterUnfollow: async (jid) => { followed.delete(jid); },
  subscribeNewsletterUpdates: async () => ({ duration: 10 * 60e3 }),
  newsletterMetadata: async (kind, ref) => {
    metaCalls++;
    const jid = kind === 'invite' ? ref + '@newsletter' : ref;
    const name = KNOWN[jid] || 'Mock ' + String(ref).slice(-6);
    return { id: jid, name, thread_metadata: { name: { text: name }, viewer_metadata: { role: 'VIEWER' } } };
  }
};
wa.getSocket = () => fakeSocket;
wa.getStatus = () => ({ status: 'open' });
wa.subscribeChannel = async () => ({ duration: 10 * 60e3 });

/* config resolves DATABASE_PATH as path.join(ROOT, env) — create whatever it lands on */
const cfg = require('./src/config');
fs.mkdirSync(path.dirname(cfg.config.paths.database), { recursive: true });
fs.mkdirSync(cfg.config.paths.sessions, { recursive: true });

/* ---- boot the real web server ---- */
const express = require('express');
const { build } = require('./src/web/server');
const PORT = 20310;
const app = express();
build(app);
const srv = app.listen(PORT);

const BASE = `http://127.0.0.1:${PORT}`;
let pass = 0, fail = 0;
const check = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ok  ${name}`); }
  else { fail++; console.log(`FAIL  ${name} ${extra}`); }
};
const get = async (p, tok) => (await fetch(BASE + p, { headers: { authorization: 'Bearer ' + tok } })).json();

const rawEvents = [];
async function listenEvents(tok, ms) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    const res = await fetch(BASE + '/events', { headers: { authorization: 'Bearer ' + tok }, signal: ctl.signal });
    if (!res.ok) { rawEvents.push({ type: '__events_unauthorized__' }); return; }
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let i;
      while ((i = buf.indexOf('\n\n')) >= 0) {
        const chunk = buf.slice(0, i); buf = buf.slice(i + 2);
        for (const line of chunk.split('\n')) if (line.startsWith('data: ')) rawEvents.push(JSON.parse(line.slice(6)));
      }
    }
  } catch { }
  clearTimeout(t);
}

(async () => {
  const login = await (await fetch(BASE + '/login', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' }, body: JSON.stringify({ username: 'admin', password: 'testpw' }) })).json();
  const tok = login.token;
  check('login works', Boolean(tok));

  const evListener = listenEvents(tok, 25000);
  await new Promise((res) => setTimeout(res, 1500)); // let the SSE stream establish first

  const code = '0029Va43T73BPzjaAmcDZf3x'; // "20 Minuten"
  const jid = code + '@newsletter';

  /* ── A: follow from Browse ── */
  console.log('A) follow');
  let r = await (await fetch(BASE + '/api/browse/follow', { method: 'POST', headers: { authorization: 'Bearer ' + tok, 'Content-Type': 'application/json' }, body: JSON.stringify({ link: code }) })).json();
  check('A1 follow ok', r.ok === true, JSON.stringify(r));
  check('A2 name from WhatsApp metadata', r.name === '20 Minuten', r.name);
  check('A3 auto-added to Sources', r.addedToSources === true);
  r = await get('/api/sources', tok);
  const srcRow = (r.list || []).find((x) => x.jid === jid);
  check('A4 in sources list with real name', srcRow && srcRow.name === '20 Minuten', JSON.stringify(srcRow));
  check('A5 dir role VIEWER', srcRow && srcRow.role === 'VIEWER', srcRow && srcRow.role);
  r = await get('/api/browse/channels?page=1&size=5', tok);
  const brwRow = (r.list || []).find((x) => x.id === code);
  check('A6 browse shows following+inSources', brwRow && brwRow.following === true && brwRow.inSources === true, JSON.stringify(brwRow));
  r = await get('/api/directory', tok);
  check('A7 directory has it with real name', (r.list || []).some((d) => d.jid === jid && d.name === '20 Minuten' && d.role === 'VIEWER'));

  /* ── B: idempotency — follow again ── */
  console.log('B) double follow');
  r = await (await fetch(BASE + '/api/browse/follow', { method: 'POST', headers: { authorization: 'Bearer ' + tok, 'Content-Type': 'application/json' }, body: JSON.stringify({ link: code }) })).json();
  check('B1 already flagged', r.ok === true && r.already === true, JSON.stringify(r));
  r = await get('/api/sources', tok);
  check('B2 still exactly one row', (r.list || []).filter((x) => x.jid === jid).length === 1);

  /* ── C: unfollow ── */
  console.log('C) unfollow');
  r = await (await fetch(BASE + '/api/browse/unfollow', { method: 'POST', headers: { authorization: 'Bearer ' + tok, 'Content-Type': 'application/json' }, body: JSON.stringify({ code }) })).json();
  check('C1 unfollow ok', r.ok === true && r.removedFromSources === true, JSON.stringify(r));
  r = await get('/api/sources', tok);
  check('C2 gone from sources', !(r.list || []).some((x) => x.jid === jid));
  r = await get('/api/browse/channels?page=1&size=5', tok);
  const brwRow2 = (r.list || []).find((x) => x.id === code);
  check('C3 browse shows following:false + inSources:false', brwRow2 && brwRow2.following === false && brwRow2.inSources === false, JSON.stringify(brwRow2));

  /* ── D: SSE broadcast reached a live listener ── */
  await new Promise((res) => setTimeout(res, 800));
  const chanEvents = rawEvents.filter((e) => e.type === 'channels');
  check('D1 SSE channels events received', chanEvents.length >= 2, `got ${chanEvents.length}: ${JSON.stringify(chanEvents.map((e) => e.reason))}`);
  check('D2 follow + unfollow reasons seen', chanEvents.some((e) => e.reason === 'follow') && chanEvents.some((e) => e.reason === 'unfollow'));

  /* ── E: numeric name → masked in API, then recovered from WhatsApp ── */
  console.log('E) name recovery');
  const db = require('./src/db').open();
  db.prepare('INSERT INTO sources(jid,name,added_by) VALUES(?,?,?)').run('1234567890@newsletter', '1234567890', 'test');
  db.prepare('INSERT OR IGNORE INTO directory(jid,name,role) VALUES(?,?,?)').run('1234567890@newsletter', '1234567890', 'VIEWER');
  r = await get('/api/sources', tok);
  const numRow = (r.list || []).find((x) => x.jid === '1234567890@newsletter');
  check('E1 numeric name masked, never raw digits', numRow && /Channel •\d{4}$/.test(numRow.name), JSON.stringify(numRow));
  await new Promise((res) => setTimeout(res, 4500)); // background resolve: 2 metadata calls × 1.2 s pace
  r = await get('/api/sources', tok);
  const numRow2 = (r.list || []).find((x) => x.jid === '1234567890@newsletter');
  check('E2 real name recovered from WhatsApp', numRow2 && numRow2.name === 'Recovered Channel Name', JSON.stringify(numRow2));
  r = await get('/api/directory', tok);
  check('E3 directory name updated too', (r.list || []).some((d) => d.jid === '1234567890@newsletter' && d.name === 'Recovered Channel Name'));
  r = await (await fetch(BASE + '/api/channels/resolve-names', { method: 'POST', headers: { authorization: 'Bearer ' + tok, 'Content-Type': 'application/json' }, body: '{}' })).json();
  check('E4 manual resolve endpoint ok', r.ok === true, JSON.stringify(r));

  console.log(`\n${pass} passed, ${fail} failed (metadata calls: ${metaCalls})`);
  await evListener.catch(() => { });
  srv.close();
  db.close();
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { }
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('SYNC TEST CRASH', e); process.exit(1); });
