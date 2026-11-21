'use strict';
/* Cloud-memory save ladder, tested against a MOCK GitHub API.
   Proves: (A) replace-push works with the corrected ref URLs and the old
   buggy URL is never touched; (B) a bloated branch self-heals to 1 commit
   on the first save; (C) a 409'd ref update falls to a non-destructive append;
   (D) refs fully blocked → capped classic append; (E) over the cap →
   self-protect SKIP (no append, repo protected); (F) unchanged state skips.
   Run: node tests/cloud-ladder-test.js  (no network, no real token) */
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'raqlad-'));
fs.mkdirSync(path.join(tmp, 'sessions', 'main'), { recursive: true });
fs.writeFileSync(path.join(tmp, 'sessions', 'main', 'creds.json'), JSON.stringify({ registered: true }));
const dbFile = path.join(tmp, 'bot.sqlite');
const db = require('better-sqlite3')(dbFile);
db.exec("CREATE TABLE t(k TEXT)");
const setRow = (v) => { db.prepare("DELETE FROM t").run(); db.prepare("INSERT INTO t VALUES (?)").run(v); };
setRow('v1');

process.env.PERSIST_GITHUB_REPO = 'testowner/testrepo';
process.env.PERSIST_GITHUB_TOKEN = 'fake-token';
process.env.PERSIST_GITHUB_BRANCH = 'bot-state';
process.env.PERSIST_INTERVAL_MIN = '10';
process.env.PERSIST_INBOX_MEDIA='0';process.env.PERSIST_HOLD_MEDIA='0';

const st = {
  branchExists: false, commits: 0, refPut: 'ok', refDelete: 'ok',
  replaces: 0, resets: 0, classicPuts: 0, buggyUrlHits: 0, stateSha: null
};

const srv = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  const p = u.pathname;
  const j = (o, code = 200, h = {}) => { res.writeHead(code, { 'Content-Type': 'application/json', ...h }); res.end(JSON.stringify(o)); };
  req.on('data', () => { }); req.on('end', () => {
    if (p === '/repos/testowner/testrepo' && req.method === 'GET') return j({ default_branch: 'main', size: 123 });
    if (p === '/user' && req.method === 'GET') return j({ login: 'testowner' });
    if (p === '/repos/testowner/testrepo/git/blobs' && req.method === 'POST') return j({ sha: 'blob' + Date.now() });
    if (p === '/repos/testowner/testrepo/git/trees' && req.method === 'POST') return j({ sha: 'tree1' });
    if (p === '/repos/testowner/testrepo/git/commits' && req.method === 'POST') return j({ sha: 'c' + Date.now() + Math.random() });
    if (p === '/repos/testowner/testrepo/git/ref/bot-state' && req.method === 'GET') {
      st.buggyUrlHits++; return j({ message: 'Not Found' }, 404);
    }
    if (p === '/repos/testowner/testrepo/git/ref/heads/bot-state' && req.method === 'GET')
      return st.branchExists ? j({ object: { sha: 'old' } }) : j({ message: 'Not Found' }, 404);
    if (p === '/repos/testowner/testrepo/git/ref/heads/main' && req.method === 'GET')
      return j({ object: { sha: 'mainhead' } });
    if (p === '/repos/testowner/testrepo/git/refs/heads/bot-state' && req.method === 'PUT') {
      if (st.refPut === '409') return j({ message: 'sha mismatch' }, 409);
      if (st.refPut === '403') return j({ message: 'Forbidden' }, 403);
      st.replaces++; st.branchExists = true; st.commits = 1;
      return j({ ref: 'refs/heads/bot-state', object: { sha: 'new' } });
    }
    if (p === '/repos/testowner/testrepo/git/refs/heads/bot-state' && req.method === 'DELETE') {
      if (st.refDelete === '403') return j({ message: 'Forbidden' }, 403);
      st.resets++; st.branchExists = false; st.commits = 0; return j({});
    }
    if (p === '/repos/testowner/testrepo/git/refs' && req.method === 'POST') {
      if (st.branchExists) return j({ message: 'Reference already exists' }, 409);
      st.branchExists = true; st.commits = Math.max(1, st.commits);
      return j({ ref: 'refs/heads/bot-state' }, 201);
    }
    if (p === '/repos/testowner/testrepo/contents/bot-state.zip') {
      if (req.method === 'GET') return st.stateSha ? j({ sha: st.stateSha, content: 'xx', size: 2 }) : j({ message: 'Not Found' }, 404);
      if (req.method === 'PUT') { st.classicPuts++; st.stateSha = 'cl' + st.classicPuts; st.commits += 1; return j({ content: { sha: st.stateSha } }, 201); }
    }
    if (p === '/repos/testowner/testrepo/commits' && req.method === 'GET') {
      const link = st.commits > 1 ? `<http://x?page=${st.commits}&per_page=1>; rel="last"` : '';
      return j([{}], 200, { Link: link });
    }
    return j({ message: 'unmocked ' + req.method + ' ' + p }, 404);
  });
});

let pass = 0, fail = 0;
const check = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ok  ${name}`); }
  else { fail++; console.log(`FAIL  ${name} ${extra}`); }
};

(async () => {
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  process.env.PERSIST_GITHUB_API = `http://127.0.0.1:${srv.address().port}`;

  const cfg = require('../src/config');
  cfg.config.paths.database = dbFile;
  cfg.config.paths.sessions = path.join(tmp, 'sessions');
  cfg.config.paths.media = path.join(tmp,'media');
  const persist = require('../src/persist');

  const save = async (label) => { setRow(label); return persist.upload(); };

  // ── A: fresh branch → replace-push, 1 commit, classic never used, old buggy URL untouched
  console.log('A) fresh branch → replace-push');
  let r = await save('v1');
  check('A1 saved', r === 'saved', `got ${r}`);
  check('A2 mode=replace', persist.publicStatus().lastPushMode === 'replace', persist.publicStatus().lastPushMode);
  check('A3 one commit on branch', st.commits === 1, String(st.commits));
  check('A4 classic never used', st.classicPuts === 0, String(st.classicPuts));
  check('A5 buggy /git/ref/bot-state URL never hit', st.buggyUrlHits === 0, String(st.buggyUrlHits));
  check('A6 1 replace call', st.replaces === 1, String(st.replaces));

  // ── B: bloated branch (500 commits) → first save self-heals to 1
  console.log('B) bloated branch self-heals');
  st.branchExists = true; st.commits = 500;
  r = await save('v2');
  check('B1 saved', r === 'saved', `got ${r}`);
  check('B2 mode=replace', persist.publicStatus().lastPushMode === 'replace');
  check('B3 branch back to 1 commit', st.commits === 1, String(st.commits));

  // ── C: replace 409 → reset (delete+recreate) → 1 commit, no classic
  console.log('C) 409 on ref update → safe append, no branch deletion');
  st.refPut = '409';
  r = await save('v3');
  check('C1 saved', r === 'saved', `got ${r}`);
  check('C2 mode=classic', persist.publicStatus().lastPushMode === 'classic', persist.publicStatus().lastPushMode);
  check('C3 existing branch never deleted', st.resets === 0 && st.commits === 2, `resets=${st.resets} commits=${st.commits}`);
  check('C4 one classic append', st.classicPuts === 1, String(st.classicPuts));
  st.refPut = 'ok';

  // ── D: refs API fully blocked, branch under cap → capped classic append
  console.log('D) refs blocked → capped classic append');
  st.refPut = '403'; st.refDelete = '403'; st.branchExists = true; st.commits = 3;
  r = await save('v4');
  check('D1 saved', r === 'saved', `got ${r}`);
  check('D2 mode=classic', persist.publicStatus().lastPushMode === 'classic', persist.publicStatus().lastPushMode);
  check('D3 exactly one append', st.classicPuts === 2 && st.commits === 4, `puts=${st.classicPuts} commits=${st.commits}`);

  // ── E: refs blocked AND over cap → self-protect skip, NO append
  console.log('E) over cap → self-protect');
  st.commits = 100;
  let err = null, rE;
  try { rE = await save('v5'); } catch (e) { err = e; }
  check('E1 save refused', rE !== 'saved' && Boolean(err), `got ${rE}`);
  check('E2 error names self-protect', /Snapshot not saved/.test(String(err && err.message) + (persist.publicStatus().lastError || '')));
  check('E3 zero appends happened', st.classicPuts === 2 && st.commits === 100, `puts=${st.classicPuts} commits=${st.commits}`);

  // ── F: refs work again + unchanged state → skip, no GitHub write
  console.log('F) unchanged state → skip');
  st.refPut = 'ok'; st.refDelete = 'ok'; st.commits = 1; st.branchExists = true;
  const before = st.replaces;
  setRow('v4'); // last state actually saved (E's v5 was refused)
  r = await persist.upload();
  check('F1 skipped', r === 'skipped', `got ${r}`);
  check('F2 no new replace call', st.replaces === before, `${before} → ${st.replaces}`);

  // ── G: publicStatus exposes the ladder state
  console.log('G) visibility');
  const ps = persist.publicStatus();
  check('G1 lastPushMode reported', typeof ps.lastPushMode === 'string');
  check('G2 branchCommits reported', typeof ps.branchCommits === 'number', String(ps.branchCommits));

  console.log(fail ? `FAIL: ${fail} cloud upload ladder checks failed` : `PASS: ${pass} cloud upload ladder checks`);
  srv.close(); db.close();
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { }
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('TEST CRASH', e); process.exit(1); });
