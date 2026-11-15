/* v8.3.0 UNIT TESTS — GitHub repo storage gauge (persist.githubStats).
   Covers: mapped repo size (API `size` KB → gauge fields), the 60 s cache,
   the refresh bypass, and the 404/unreachable verdicts. Plus a live check of
   the real /api/storage endpoint against the gate server when it is up
   (cloud memory OFF there → github.configured === false, page never breaks).
   v9.0.0 (repo-slim) adds: the media_file migration, file-backed inbox media
   + IB.pruneMedia retention, and persist change-detection (identical state ⇒
   zero GitHub writes) + compactNow force-push.
   Usage: node test/t830-ghgauge.js   Exits 0 when all pass. */
'use strict';

process.env.PERSIST_GITHUB_REPO = 'contactzulfi3402135/raqifluz-bot';
process.env.PERSIST_GITHUB_TOKEN = 'ghp_test_token_123';
process.env.DATABASE_PATH = 'data/t830-test/bot.sqlite';
process.env.SESSION_DIR = 'data/t830-test/sessions';

const persist = require('../src/persist');

let passed = 0, failed = 0;
function ok(cond, label) {
  if (cond) { passed++; console.log('  ok  ' + label); }
  else { failed++; console.log('  FAIL ' + label); }
}

/* stub the GitHub API (v9.0.0: routes the git-data endpoints used by the
   replace-push, and lets 127.0.0.1.* go to the REAL fetch for the live gate) */
const realFetch = global.fetch;
let fetches = 0;
let nextResponse = null;
let blobCount = 0;
global.fetch = async (url, opts) => {
  const u = String(url);
  if (u.startsWith('http://127.0.0.1') || u.startsWith('http://localhost')) return realFetch(url, opts);
  fetches++;
  if (u.endsWith('/git/blobs')) return { ok: true, status: 200, json: async () => ({ sha: 'blob-' + (++blobCount) }) };
  if (u.endsWith('/git/trees')) return { ok: true, status: 200, json: async () => ({ sha: 'tree-1' }) };
  if (u.endsWith('/git/commits')) return { ok: true, status: 200, json: async () => ({ sha: 'commit-1' }) };
  if (u.includes('/git/ref/')) return { ok: true, status: 200, json: async () => ({}) };
  if (u.includes('/git/refs/')) return { ok: true, status: 200, json: async () => ({}) };
  if (u.includes('/repos/contactzulfi3402135/raqifluz-bot')) return nextResponse;
  return { ok: false, status: 500, json: async () => ({}) };
};

(async () => {
  /* 1 — happy path: API size (KB) maps onto the gauge fields */
  nextResponse = { ok: true, status: 200, json: async () => ({ size: 8500, default_branch: 'main' }) };
  const s1 = await persist.githubStats();
  ok(s1.configured === true && s1.reachable === true, 'gauge: configured repo answers reachable');
  ok(s1.sizeKb === 8500, 'gauge: sizeKb is the API size verbatim (8500)');
  ok(s1.repo === 'contactzulfi3402135/raqifluz-bot' && s1.branch === 'bot-state', 'gauge: names the repo + the cloud-memory branch');
  ok(s1.defaultBranch === 'main' && typeof s1.updatedAt === 'string', 'gauge: carries default branch + updatedAt');
  ok(fetches === 1, 'gauge: exactly one API call for the first read');

  /* 2 — 60 s cache: a second read does NOT hit the API */
  const s2 = await persist.githubStats();
  ok(fetches === 1, 'gauge: cached within 60 s (no second API call)');
  ok(s2.sizeKb === 8500, 'gauge: cached value is identical');

  /* 3 — refresh bypasses the cache */
  const s3 = await persist.githubStats({ refresh: true });
  ok(fetches === 2, 'gauge: refresh=true forces a new API call');
  ok(s3.sizeKb === 8500, 'gauge: refreshed value still maps correctly');

  /* 4 — 404 verdict (repo missing / token cannot see it) */
  nextResponse = { ok: false, status: 404, json: async () => ({}) };
  const s4 = await persist.githubStats({ refresh: true });
  ok(s4.reachable === false && s4.http === 404, 'gauge: 404 → reachable=false with the HTTP code');
  ok(s4.verdict.includes('404') && s4.verdict.includes('contactzulfi3402135/raqifluz-bot'), 'gauge: 404 verdict names the repo');

  /* 5 — network down verdict */
  nextResponse = null; // stub answers 500 for the repo URL
  const s5 = await persist.githubStats({ refresh: true });
  ok(s5.reachable === false && /did not answer/.test(s5.verdict), 'gauge: non-404 failure → "did not answer" verdict');

  /* 6 — live gate server (if up): the real endpoint stays healthy with
     cloud memory OFF (no PERSIST env in the gate environment) */
  const BASE = process.env.GATE_BASE || 'http://127.0.0.1:3131';
  try {
    const login = await fetch(BASE + '/login', {
      method: 'POST', headers: { 'content-type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'test123' })
    });
    if (login.status !== 200) { console.log(`  skip  live gate check (login answered HTTP ${login.status} — rate limiter, run t830 alone for live coverage)`); }
    else {
      const cookie = (login.headers.get('set-cookie') || '').split(';')[0];
      const st = await fetch(BASE + '/api/storage', { headers: { cookie } });
      const j = await st.json();
      ok(st.status === 200 && j.ok === true, 'live: /api/storage answers 200 ok');
      ok(j.github && j.github.configured === false, 'live: gauge reports "not connected" when cloud memory is OFF');
      ok(!JSON.stringify(j).includes('undefined'), 'live: payload contains no undefined values');
    }
  } catch (e) {
    console.log('  skip  live gate check (server not up: ' + e.message + ')');
  }

  /* 7 — v9.0.0 (repo-slim): file-backed inbox media + retention prune */
  const db = require('../src/db');
  const cfg = require('../src/config');
  require('fs').mkdirSync(require('path').dirname(cfg.config.paths.database), { recursive: true });
  db.open();
  const cols = db.open().prepare('PRAGMA table_info(inbox_msgs)').all().map((c) => c.name);
  ok(cols.includes('media_file'), 'slim: media_file column exists (additive migration)');
  const mediaDir = require('path').join(cfg.config.paths.media, 'inbox');
  require('fs').mkdirSync(mediaDir, { recursive: true });
  const oldTs = new Date(Date.now() - 40 * 86400e3).toISOString().slice(0, 19).replace('T', ' ');
  const rid = db.IB.add({ session: 'main', chat_jid: '111@s.whatsapp.net', from_me: 0, ts: oldTs, sender_name: '', sender_jid: '', body: 'old photo', msg_id: 't830-1', kind: 'photo', media_mime: '', media_name: '', media_data: null });
  ok(rid && rid > 0, 'slim: test row inserted (IB.add happy path)');
  const rel = 'inbox/' + rid + '.jpg';
  db.IB.setMediaRef(rid, 'image/jpeg', 'photo.jpg', rel);
  require('fs').writeFileSync(require('path').join(cfg.config.paths.media, rel), Buffer.from([1, 2, 3]));
  let row = db.IB.mediaOf('main', rid);
  ok(row.media_file === rel && row.media_data == null, 'slim: setMediaRef stores the path, not the bytes');
  const pr = db.IB.pruneMedia(30);
  row = db.IB.mediaOf('main', rid);
  ok(pr.files === 1 && !require('fs').existsSync(require('path').join(cfg.config.paths.media, rel)), 'slim: pruneMedia(30) deletes the 40-day-old file from disk');
  ok(row.media_file === '', 'slim: pruneMedia clears the ref in the DB');
  db.open().prepare('DELETE FROM inbox_msgs').run();
  for (const f of require('fs').readdirSync(mediaDir)) { try { require('fs').unlinkSync(require('path').join(mediaDir, f)); } catch { } }
  ok(db.IB.inboxMediaBytes() === 0, 'slim: inboxMediaBytes is 0 after cleanup');

  /* 8 — v9.0.0 (repo-slim): change detection — identical state = zero GitHub writes */
  const sessDir = cfg.config.paths.sessions;
  require('fs').mkdirSync(sessDir, { recursive: true });
  require('fs').writeFileSync(require('path').join(sessDir, 'creds.json'), JSON.stringify({ registered: true }));
  const blobsBefore = blobCount;
  const r1 = await persist.upload();
  ok(r1 === 'saved', 'slim: first upload pushes the snapshot');
  ok(blobCount - blobsBefore === 1, 'slim: exactly one GitHub blob created on the first push');
  const r2 = await persist.upload();
  ok(r2 === 'skipped', 'slim: unchanged state → upload is SKIPPED');
  ok(blobCount === blobsBefore + 1, 'slim: the skip wrote ZERO bytes to GitHub (the 2 GB fix)');
  require('fs').appendFileSync(require('path').join(sessDir, 'creds.json'), ' ');
  const r4 = await persist.upload();
  ok(r4 === 'saved' && blobCount === blobsBefore + 2, 'slim: a changed state pushes again (one new blob)');
  const cs = persist.publicStatus();
  ok(typeof cs.skips === 'number' && cs.skips >= 1 && /^[\da-f]{16}$/.test(cs.lastHash || ''), 'slim: publicStatus exposes skips + lastHash');
  const comp = await persist.compactNow();
  ok(typeof comp.bytes === 'number' && comp.bytes > 0 && blobCount === blobsBefore + 3, 'slim: compactNow force-pushes a fresh snapshot');

  /* 9 — v9.0.0 (owner policy): posted media is deleted after publishing, any size */
  const nowIso = new Date().toISOString().slice(0, 19).replace('T', ' ');
  const rid2 = db.IB.add({ session: 'main', chat_jid: '222@s.whatsapp.net', from_me: 0, ts: nowIso, sender_name: '', sender_jid: '', body: 'posted photo', msg_id: 't830-posted', kind: 'photo', media_mime: '', media_name: '', media_data: null });
  const rel2 = 'inbox/' + rid2 + '.jpg';
  db.IB.setMediaRef(rid2, 'image/jpeg', 'photo.jpg', rel2);
  require('fs').writeFileSync(require('path').join(cfg.config.paths.media, rel2), Buffer.alloc(900 * 1024, 9)); // any size
  ok(db.IB.clearMediaForMsg('main', '222@s.whatsapp.net', 't830-posted') === 1, 'policy: clearMediaForMsg deletes the post media after publishing');
  ok(!require('fs').existsSync(require('path').join(cfg.config.paths.media, rel2)), 'policy: the on-disk file is gone (any size)');
  const row2 = db.IB.mediaOf('main', rid2);
  ok(row2.media_file === '' && row2.media_data == null, 'policy: the DB ref + any BLOB are cleared');
  ok(db.open().prepare('SELECT media_cleared FROM inbox_msgs WHERE id=?').get(rid2).media_cleared === 1, 'policy: row is flagged so a late capture cannot recreate the media');
  ok(db.IB.clearMediaForMsg('main', '222@s.whatsapp.net', 'no-such-msg') === 0, 'policy: unknown message → 0, nothing thrown');
  /* cleanup the test artifacts */
  try { require('fs').rmSync(sessDir, { recursive: true, force: true }); } catch { }
  for (const x of [cfg.config.paths.database, cfg.config.paths.database + '-wal', cfg.config.paths.database + '-shm']) {
    try { require('fs').rmSync(x, { force: true }); } catch { }
  }

  console.log(`\nt830-ghgauge: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('  FAIL  crashed: ' + e.message); process.exit(1); });
