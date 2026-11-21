'use strict';
/**
 * v7.2.0 — cloud memory (the "never scan a QR again" engine), rebuilt.
 *
 * v11.0.1 (v1.1.4) — cloud memory is now bulletproof against repo bloat:
 *   the ref-endpoint URLs in pushReplacing were missing the mandatory
 *   "heads/" prefix, so every replace-push 409'd and every save fell back
 *   to the classic APPEND (one ~3 MB commit per cycle — a 4 GB branch in
 *   4 days). Fixed, plus a save ladder: replace → reset (delete+recreate,
 *   self-heals a bloated branch) → capped classic append → self-protect
 *   skip. No token/permission combination can grow the branch again.
 *
 * v7.2 fixes the two bugs that made QR re-scans look unavoidable:
 *   1. the state was WRITTEN to the configured branch (bot-state) but READ
 *      from the repo's default branch — so every restart found nothing and
 *      asked for a QR. Every call is now branch-aware (?ref=), with a
 *      default-branch fallback so state saved by older builds is recovered.
 *   2. the branch was never created (GitHub refuses a write to a missing
 *      branch) and sha mismatches aborted uploads. The branch is now created
 *      automatically when needed and uploads retry once on a race.
 * Plus: syncs right after pairing and after every creds change, and flushes
 * on shutdown (SIGTERM = Heroku deploy) so the newest login always survives.
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const safeArchive = require('./safe-archive');
const cfg = require('./config');
const { ring } = require('./logger');

const C = cfg.config.persist;
const STATE_FILE = 'bot-state.zip';
const enabled = () => Boolean(C.repo && C.token);
/* PERSIST_GITHUB_REPO must be exactly owner/repo — v7.2.1 cleans up the most
   common paste mistakes (full URLs, .git suffix, sub-page URLs, spaces). */
function parseRepo(raw) {
  const orig = String(raw || '').trim();
  let v = orig
    .replace(/^git@github\.com:/i, '')
    .replace(/^ssh:\/\/git@github\.com\//i, '')
    .replace(/^https?:\/\/(www\.)?github\.com\//i, '')
    .replace(/^github\.com\//i, '')
    .split(/[?#]/)[0];
  v = v.replace(/\.git$/i, '').replace(/^\/+|\/+$/g, '');
  const parts = v.split('/').filter(Boolean);
  const full = parts.length >= 2 ? parts.slice(0, 2).join('/') : v;
  return { full, ok: parts.length >= 2, changed: full !== orig };
}
const repoUsed = () => parseRepo(C.repo).full;
const base = () => `${C.api}/repos/${repoUsed()}`;
const contentsUrl = (ref) => `${base()}/contents/${STATE_FILE}${ref ? `?ref=${encodeURIComponent(ref)}` : ''}`;
const headers = () => ({
  Authorization: `Bearer ${C.token}`, Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'raqifluz-v7', 'Content-Type': 'application/json'
});

const status = {
  enabled: false, repo: '', branch: '', lastSyncAt: '', lastSyncReason: '',
  lastError: '', lastBytes: 0, lastRestoreAt: '', restoredFiles: 0, branchReady: false, boots: 0,
  /* v9.0.0 (repo-slim): change detection + skip accounting */
  lastHash: '', lastSkipAt: '', skips: 0,
  /* v11.0.1 (v1.1.4): save-ladder visibility */
  lastPushMode: '', branchCommits: 0
};
let lastHash = '';   // hash of the last uploaded snapshot — identical state = no new GitHub blob

/* ── branch helpers ─────────────────────────────────────────────────── */

let branchReady = null;          // cached promise: the configured branch exists
async function ensureBranch() {
  if (branchReady) return branchReady;
  branchReady = (async () => {
    const refName = `heads/${C.branch}`;
    const check = await fetch(`${base()}/git/ref/${refName}`, { headers: headers() }).catch(() => null);
    if (check?.ok) { status.branchReady = true; return true; }
    // create it from the repo's default branch tip
    const repo = await fetch(base(), { headers: headers() }).catch(() => null);
    if (!repo?.ok) {
      const st = repo?.status;
      throw new Error(st === 404
        ? `GitHub says "${repoUsed()}" does not exist or the token cannot see it (HTTP 404) — press "Test cloud memory" on the Home tab for the exact reason`
        : `GitHub repo not reachable (HTTP ${st || '?'}) — check PERSIST_GITHUB_REPO / PERSIST_GITHUB_TOKEN`);
    }
    const defaultBranch = (await repo.json()).default_branch || 'main';
    const head = await fetch(`${base()}/git/ref/heads/${encodeURIComponent(defaultBranch)}`, { headers: headers() });
    if (!head.ok) throw new Error(`GitHub could not read the default branch (HTTP ${head.status})`);
    const sha = (await head.json()).object.sha;
    const make = await fetch(`${base()}/git/refs`, {
      method: 'POST', headers: headers(), body: JSON.stringify({ ref: `refs/heads/${C.branch}`, sha })
    });
    if (!make.ok && make.status !== 422) throw new Error(`GitHub could not create the branch "${C.branch}" (HTTP ${make.status})`);
    ring.info('persist.branch', `Cloud memory branch "${C.branch}" created automatically — no manual GitHub setup needed`);
    status.branchReady = true;
    return true;
  })().catch((err) => { branchReady = null; throw err; });
  return branchReady;
}

/** read the saved state on a given ref → { sha, content, size } or null */
async function getState(ref) {
  const res = await fetch(contentsUrl(ref), { headers: headers() }).catch(() => null);
  if (!res || res.status === 404) return null;
  if (res.status === 403 || res.status === 429) throw new Error(`GitHub API rate limit (HTTP ${res.status}) — cloud memory will retry on the next cycle`);
  if (!res.ok) return null;
  const data = await res.json().catch(() => null);
  /* v7.3.8: the SHA is what matters. GitHub omits `content` (empty string,
     encoding "none") for files larger than 1 MB — and the state file WILL
     outgrow 1 MB (inbox + media previews accumulate). Requiring `content`
     used to null the whole read: uploads then lost their sha and died with
     HTTP 422 "sha wasn't supplied", and restore could not find the state. */
  if (!data || !data.sha) return null;
  return { sha: data.sha, content: data.content || null, size: data.size || 0 };
}

/* ── snapshot / upload / download ───────────────────────────────────── */

/** Snapshot sessions/ + the SQLite file into a temp zip. */
async function snapshot() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'raq7-'));
  const zipPath = path.join(tmp, STATE_FILE);
  const dbFile = cfg.config.paths.database;
  /* v7.3.3 — the real reason "settings reset on every deploy": in WAL mode SQLite
     keeps the NEWEST writes (every settings change!) in bot.sqlite-wal, not in
     bot.sqlite. The old snapshot zipped only bot.sqlite, so the cloud copy was
     always a few writes behind (the last checkpoint) and every deploy "restored"
     old settings. Now: checkpoint the WAL first, then zip the DB + any leftover
     -wal/-shm so the cloud copy is always complete and up to date. */
  try {
    if (fs.existsSync(dbFile)) {
      const snapDb = require('better-sqlite3')(dbFile);
      try {
        snapDb.pragma('wal_checkpoint(TRUNCATE)');
        /* v9.0.0 (repo-slim): VACUUM so the shipped file is the compact form —
           same state ⇒ same bytes ⇒ the change-detection hash below is stable. */
        snapDb.exec('VACUUM');
      } finally { snapDb.close(); }
    }
  } catch { /* checkpoint is best-effort — the files below are still zipped */ }
  const { ZipArchive } = await import('archiver');
  await new Promise((resolve, reject) => {
    const output = fs.createWriteStream(zipPath);
    const archive = new ZipArchive({ zlib: { level: 6 } });
    output.on('close', resolve); archive.on('error', reject);
    archive.pipe(output);
    if (fs.existsSync(cfg.config.paths.sessions)) archive.directory(cfg.config.paths.sessions, 'sessions');
    const holdDir = path.join(path.dirname(dbFile), 'media-hold');
    if (process.env.PERSIST_HOLD_MEDIA === '1' && fs.existsSync(holdDir)) archive.directory(holdDir, 'media-hold');
    if (fs.existsSync(dbFile)) {
      archive.file(dbFile, { name: path.basename(dbFile) });
      for (const extra of [dbFile + '-wal', dbFile + '-shm']) {
        if (fs.existsSync(extra)) archive.file(extra, { name: path.basename(extra) });
      }
    }
    archive.finalize();
  });
  /* v9.0.0 (repo-slim): read once — the buffer is reused for the base64 upload. */
  const buf = fs.readFileSync(zipPath);
  /* The change key is the LOGICAL state (every row + the sessions tree), not
     the zip bytes: a no-op VACUUM still rewrites the file (mtime flips, zip
     bytes differ) even when nothing changed, and that would defeat the skip.
     Run AFTER the checkpoint above so the WAL is already in the file. */
  return { zipPath, size: buf.length, hash: stateHash() };
}

/** sha256 over the logical state: DB schema + every row (all tables) +
 *  sessions/ tree (sorted path + bytes). Stable across no-op VACUUMs. */
function stateHash() {
  const h = crypto.createHash('sha256');
  const dbFile = cfg.config.paths.database;
  try {
    if (fs.existsSync(dbFile)) {
      const d = require('better-sqlite3')(dbFile, { readonly: true, fileMustExist: true });
      try {
        const tables = d.prepare("SELECT name, sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all();
        h.update('db-schema:'); h.update(JSON.stringify(tables));
        for (const t of tables) {
          h.update('\n' + t.name + ':');
          h.update(JSON.stringify(d.prepare(`SELECT * FROM [${t.name}] ORDER BY rowid`).all()));
        }
      } finally { d.close(); }
    }
  } catch { /* unreadable DB → fall through to file bytes */ }
  const sess = cfg.config.paths.sessions;
  const walk = (dir, rel) => {
    let ents = [];
    try { ents = fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name)); } catch { return; }
    for (const e of ents) {
      const p = path.join(dir, e.name);
      const rp = rel ? rel + '/' + e.name : e.name;
      if (e.isDirectory()) walk(p, rp);
      else { try { h.update('f:' + rp + ':'); h.update(fs.readFileSync(p)); } catch { } }
    }
  };
  if (fs.existsSync(sess)) walk(sess, 'sessions');
  const holdDir = path.join(path.dirname(dbFile), 'media-hold');
  if (process.env.PERSIST_HOLD_MEDIA === '1' && fs.existsSync(holdDir)) walk(holdDir, 'media-hold');
  return h.digest('hex');
}

/** @returns {Promise<'saved'|'skipped'|false>} */
async function upload(force = false) {
  const snap = await snapshot();
  if (!snap.size) return false;
  /* v9.0.0 (repo-slim) — the real 2 GB fix, layer one: change detection.
     Nothing changed since the last push ⇒ do NOT create a new GitHub blob.
     An idle bot (the common case between posts) now writes ZERO bytes to
     GitHub, instead of a fresh full snapshot every 10 minutes. `force`
     (the "Compact cloud memory" button) always pushes. */
  if (!force && snap.hash === lastHash) {
    status.lastSkipAt = new Date().toISOString();
    status.skips += 1;
    status.lastBytes = snap.size;
    try { fs.rmSync(path.dirname(snap.zipPath), { recursive: true, force: true }); } catch { }
    return 'skipped';
  }
  await ensureBranch();
  /* v7.3.8: the Contents API caps one file at 100 MB — warn early, fail with
     a clear message at the wall (instead of an opaque GitHub error). */
  if (snap.size > 95 * 1024 * 1024) throw new Error(`State is ${Math.round(snap.size / 1048576)} MB — over GitHub's 100 MB file limit for cloud memory (it keeps growing with the WhatsApp tab's stored photos/messages).`);
  if (snap.size > 50 * 1024 * 1024) ring.warn('persist.big', `Cloud state is large: ${Math.round(snap.size / 1048576)} MB (GitHub limit 100 MB)`);
  const content = fs.readFileSync(snap.zipPath).toString('base64');
  try {
    /* v7.6.0 (P5E-pre): "replace" push — the branch stays a SINGLE commit
       (new root commit, ref force-updated), so 10,000 saved copies never
       pile up and the repo stays small (the 2 GB bloat fix). If any step
       fails, fall back to the classic Contents-API push (appends commits —
       always worked, just grows history). */
    /* v11.0.1 (v1.1.4) — bulletproof save ladder. The state branch must
       NEVER grow:
       1) replace-push keeps it at a SINGLE commit (force ref update);
       2) if the ref update is refused, DELETE + recreate resets the branch
          to one commit — this is also what self-heals an ALREADY bloated
          branch on the first save after an upgrade (the old history becomes
          unreachable and GitHub drops those blobs on its next GC);
       3) if the refs API is entirely blocked but Contents writes work, we
          append via the classic API — but only while the branch is under
          the commit cap;
       4) beyond the cap we REFUSE to append: the save is skipped with a
          loud warning, so the repo is protected no matter which API the
          token can reach. */
    let saved = false;
    let mode = null;
    try {
      await pushReplacing(content);
      mode = 'replace';
      saved = true;
    } catch (e1) {
      ring.warn('persist.replace.fail', `Replace-push failed (${e1.message}) — trying branch reset.`);
      try {
        await pushReset(content);
        mode = 'reset';
        saved = true;
        status.branchCommits = 1;
        ring.info('persist.reset', `Branch "${C.branch}" reset to a single commit — older copies are unreachable now and GitHub drops them on its next garbage collection.`);
      } catch (e2) {
        const n = await branchCommitCount();
        if (n === null || n <= MAX_BRANCH_COMMITS) {
          await pushClassic(content);
          mode = 'classic';
          saved = true;
          status.branchCommits = (n || 0) + 1;
          ring.warn('persist.classic.fallback', `Ref API unavailable (${e2.message}) — appended via Contents API; branch ≈ ${status.branchCommits}/${MAX_BRANCH_COMMITS} commits. Give the token Contents read+write so saves stop growing history.`);
        } else {
          status.lastError = `Self-protect: branch "${C.branch}" already has ${n} commits (cap ${MAX_BRANCH_COMMITS}) and replace/reset pushes failed — save skipped to protect the repo. Check the cloud-memory token (Contents: read+write), or delete the branch once on GitHub (Settings → Branches).`;
          ring.warn('persist.selfprotect', status.lastError);
          throw new Error(status.lastError);
        }
      }
    }
    if (saved) {
      lastHash = snap.hash;
      status.lastBytes = snap.size;
      status.lastHash = snap.hash.slice(0, 16);
      status.lastPushMode = mode;
      if (mode === 'replace') status.branchCommits = 1;
    }
    return saved ? 'saved' : false;
  } finally {
    try { fs.rmSync(path.dirname(snap.zipPath), { recursive: true, force: true }); } catch { }
  }
}

/** v9.0.0 (repo-slim) — one-click "Compact cloud memory".
    Forces a fresh single-commit replace-push. The branch again holds exactly
    ONE snapshot; every older blob becomes unreachable and GitHub drops it on
    its next garbage collection, so the repo's size falls back to ≈ one
    snapshot. Returns the new snapshot size for the UI toast. */
async function compactNow() {
  if (!enabled()) throw new Error('Cloud memory is not configured — set PERSIST_GITHUB_REPO + PERSIST_GITHUB_TOKEN first (README step 4).');
  if (localStateEmpty()) throw new Error('Nothing to compact yet.');
  const was = status.lastBytes;
  const ok = await upload(true);
  if (ok !== 'saved') throw new Error(status.lastError || 'Compact push failed — see the log.');
  return {
    bytes: status.lastBytes, wasBytes: was,
    drop: Math.max(0, was - status.lastBytes),
    hash: status.lastHash, at: new Date().toISOString()
  };
}

/* v11.0.1 (v1.1.4): the state branch's commit cap. Normal operation keeps it
   at exactly ONE commit (replace-push). If a save ever falls back to the
   classic Contents-API append, the branch must never exceed this many
   commits — beyond that, saves are skipped (see the upload ladder above). */
const MAX_BRANCH_COMMITS = 25;

/** Create a fresh ROOT commit (blob + tree + commit) for the snapshot.
    @returns the new commit sha */
async function makeRootCommit(content) {
  const msg = `bot-state ${new Date().toISOString()}`;
  let r = await fetch(`${base()}/git/blobs`, { method: 'POST', headers: headers(), body: JSON.stringify({ content, encoding: 'base64' }) });
  if (!r.ok) throw new Error(`blob HTTP ${r.status}`);
  const blobSha = (await r.json()).sha;
  r = await fetch(`${base()}/git/trees`, { method: 'POST', headers: headers(), body: JSON.stringify({ tree: [{ path: STATE_FILE, mode: '100644', type: 'blob', sha: blobSha }] }) });
  if (!r.ok) throw new Error(`tree HTTP ${r.status}`);
  const treeSha = (await r.json()).sha;
  r = await fetch(`${base()}/git/commits`, { method: 'POST', headers: headers(), body: JSON.stringify({ message: msg, tree: treeSha }) });
  if (!r.ok) throw new Error(`commit HTTP ${r.status}`);
  return (await r.json()).sha;
}

/** Push state as a fresh ROOT commit and force-update the branch ref.
    Branch history = exactly 1 commit, forever.
    NOTE (the 4 GB bug, fixed in v11.0.1): the GitHub ref endpoints require
    the FULL ref name — refs/heads/<branch>. The v7.6.0 code called
    /git/ref/<branch> and /git/refs/<branch> WITHOUT "heads/", so the
    existence check always 404'd, the "create new ref" call always 409'd
    (ref already exists), and every single save silently fell back to the
    classic append — piling up one ~3 MB commit every cycle (2,008 copies
    = 4.2 GB). The corrected URLs + the reset ladder below end that. */
async function pushReplacing(content) {
  const commitSha = await makeRootCommit(content);
  const ref = `heads/${C.branch}`;
  const exists = await fetch(`${base()}/git/ref/${ref}`, { headers: headers() }).then((x) => x.ok).catch(() => false);
  const r = exists
    ? await fetch(`${base()}/git/refs/${ref}`, { method: 'PUT', headers: headers(), body: JSON.stringify({ sha: commitSha, force: true }) })
    : await fetch(`${base()}/git/refs`, { method: 'POST', headers: headers(), body: JSON.stringify({ ref: `refs/heads/${C.branch}`, sha: commitSha }) });
  if (!r.ok) throw new Error(`ref HTTP ${r.status}`);
}

/** Reset ladder: delete the branch and recreate it with exactly one fresh
    commit. This is what self-heals an already-bloated branch — after the
    reset the old history is unreachable and GitHub drops those blobs on
    its next garbage collection, so a multi-GB branch goes back to ≈ one
    snapshot. */
async function pushReset(content) {
  const commitSha = await makeRootCommit(content);
  const del = await fetch(`${base()}/git/refs/heads/${C.branch}`, { method: 'DELETE', headers: headers() }).catch(() => null);
  if (del && !del.ok && del.status !== 404) throw new Error(`branch delete HTTP ${del.status}`);
  const make = await fetch(`${base()}/git/refs`, {
    method: 'POST', headers: headers(),
    body: JSON.stringify({ ref: `refs/heads/${C.branch}`, sha: commitSha })
  });
  if (!make.ok) throw new Error(`branch recreate HTTP ${make.status}`);
}

/** Cheap branch commit count: page number of the last page in the commits
    list (per_page=1). Returns null when unknown. */
async function branchCommitCount() {
  try {
    const r = await fetch(`${base()}/commits?sha=${encodeURIComponent(C.branch)}&per_page=1`, { headers: headers() });
    if (!r.ok) return null;
    const link = String(r.headers.get('link') || '');
    const last = (link.match(/<([^>]+)>;\s*rel="last"/) || [])[1];
    const pm = last && last.match(/[?&]page=(\d+)/);
    return pm ? parseInt(pm[1], 10) : 1;
  } catch { return null; }
}

/** Classic Contents-API push (one commit appended per save). */
async function pushClassic(content) {
  // sha MUST come from the same branch we write to (the v7.2 bug)
  const existing = await getState(C.branch);
  const body = { message: `bot-state ${new Date().toISOString()}`, content, branch: C.branch };
  if (existing?.sha) body.sha = existing.sha;
  let put = await fetch(contentsUrl(null), { method: 'PUT', headers: headers(), body: JSON.stringify(body) });
  if (!put.ok && (put.status === 409 || put.status === 422)) {
    // race (another sync finished first) → refresh the sha once and retry
    const again = await getState(C.branch);
    if (again?.sha) { body.sha = again.sha; put = await fetch(contentsUrl(null), { method: 'PUT', headers: headers(), body: JSON.stringify(body) }); }
  }
  if (!put.ok) throw new Error(`GitHub upload HTTP ${put.status}: ${(await put.text().catch(() => '')).slice(0, 140)}`);
  return true;
}

/** Download the state zip (null when none). Reads the configured branch first,
 *  then the default branch (state written by older builds). */
async function download() {
  await ensureBranch().catch(() => {});
  let hit = await getState(C.branch);
  let hitRef = C.branch;
  if (!hit) {
    hit = await getState(null);                       // default branch fallback
    if (hit) { hitRef = null; ring.info('persist.migrate', `Found saved state on the default branch — moving it to "${C.branch}" on the next sync`); }
  }
  if (!hit) return null;
  let buf;
  if (hit.content) {
    buf = Buffer.from(hit.content, 'base64');
  } else {
    /* v7.3.8: state over 1 MB — GitHub's object response omits the content.
       Fetch the raw bytes from the same endpoint with the raw media type
       (works for private repos; download_url would not). */
    const raw = await fetch(contentsUrl(hitRef), { headers: { ...headers(), Accept: 'application/vnd.github.raw+json' } });
    if (!raw.ok) throw new Error(`GitHub state download failed (HTTP ${raw.status})`);
    buf = Buffer.from(await raw.arrayBuffer());
    if (!buf.length) throw new Error('GitHub state download returned 0 bytes');
  }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'raq7-dl-'));
  const p = path.join(tmp, STATE_FILE);
  fs.writeFileSync(p, buf);
  return p;
}

/** Restore: only fill MISSING files — local state is always newer. */
async function restoreFromZip(zipPath) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'raq7-restore-'));
  try {
  await safeArchive.extract(zipPath, tmp);
  let sessionFiles = 0; let dbRestored = false;
  const sessSrc = path.join(tmp, 'sessions');
  if (fs.existsSync(sessSrc)) {
    const walk = (dir, rel) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const src = path.join(dir, e.name); const relPath = rel ? path.join(rel, e.name) : e.name;
        if (e.isDirectory()) { walk(src, relPath); continue; }
        const dst = path.join(cfg.config.paths.sessions, relPath);
        if (fs.existsSync(dst)) continue;
        fs.mkdirSync(path.dirname(dst), { recursive: true });
        fs.copyFileSync(src, dst); sessionFiles += 1;
      }
    };
    walk(sessSrc, '');
  }
  const dbSrc = path.join(tmp, path.basename(cfg.config.paths.database));
  if (fs.existsSync(dbSrc) && !fs.existsSync(cfg.config.paths.database)) {
    fs.mkdirSync(path.dirname(cfg.config.paths.database), { recursive: true });
    fs.copyFileSync(dbSrc, cfg.config.paths.database); dbRestored = true;
    for (const extra of ['-wal', '-shm']) {                  // v7.3.3: finish the WAL restore
      const e = path.join(tmp, path.basename(cfg.config.paths.database) + extra);
      const d = cfg.config.paths.database + extra;
      if (fs.existsSync(e) && !fs.existsSync(d)) { try { fs.copyFileSync(e, d); } catch { } }
    }
  }
  // Restore held media only alongside a newly restored database, never over local files.
  const holdSrc = path.join(tmp, 'media-hold');
  const holdDst = path.join(path.dirname(cfg.config.paths.database), 'media-hold');
  if (dbRestored && fs.existsSync(holdSrc)) {
    fs.mkdirSync(holdDst, { recursive:true });
    for (const entry of fs.readdirSync(holdSrc, {withFileTypes:true})) {
      if (entry.isFile() && /^\d+\.(jpg|mp4|bin)$/.test(entry.name)) {
        const dest = path.join(holdDst, entry.name);
        if (!fs.existsSync(dest)) fs.copyFileSync(path.join(holdSrc,entry.name),dest);
      }
    }
  }
  return { sessionFiles, dbRestored };
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
}

const localStateEmpty = () => {
  try { return !fs.existsSync(cfg.config.paths.database); } catch { return true; }
};
const credsPresent = () => {
  try {
    const f = path.join(cfg.config.paths.sessions, cfg.config.whatsapp.sessionName, 'creds.json');
    if (!fs.existsSync(f)) return false;
    const c = JSON.parse(fs.readFileSync(f, 'utf8')) || {};
    return Boolean(c.registered || c.me);        // v7.3: paired = registered flag OR an identity was assigned
  } catch { return false; }
};

/** Boot-time restore — runs BEFORE the DB is opened. Retries once: a cold
 *  dyno sometimes drops the very first HTTPS request, and a failed restore
 *  is exactly what forces a QR scan. */
async function restoreEarly() {
  status.enabled = enabled(); status.branch = C.branch; status.boots += 1;
  const rp = parseRepo(C.repo); status.repo = rp.full;
  if (enabled() && rp.changed) ring.warn('persist.repo.normalized', `PERSIST_GITHUB_REPO was "${C.repo}" — cleaned it up to "${rp.full}" automatically (use this exact form: owner/repo)`);
  if (!enabled()) {
    ring.warn('persist.off', '⚠️ Cloud memory is OFF — without it, every deploy/restart will ask for a QR scan again. Set PERSIST_GITHUB_REPO + PERSIST_GITHUB_TOKEN (README step 4).');
    return;
  }
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const zip = await download();
      if (!zip) {
        if (!status.branchReady) {
          ring.warn('persist.repo.warn', `Cloud memory could NOT reach ${repoUsed()} with the saved token — check PERSIST_GITHUB_REPO / PERSIST_GITHUB_TOKEN (README step 4). Until this works, deploys will ask for a QR scan again.`);
        } else {
          ring.info('persist.empty', `Cloud memory: nothing saved yet on ${C.repo}@${C.branch} — first run`);
        }
        return;
      }
      const r = await restoreFromZip(zip);
      status.lastRestoreAt = new Date().toISOString(); status.restoredFiles = r.sessionFiles;
      ring.info('persist.restored', `Cloud memory restored: ${r.sessionFiles} session file(s)${r.dbRestored ? ' + database' : ''} — login reused, no QR needed`);
      return;
    } catch (err) {
      status.lastError = String(err.message).slice(0, 160);
      ring.warn('persist.restore.fail', `Cloud memory restore attempt ${attempt} failed: ${String(err.message).slice(0, 140)}`);
      if (attempt === 1) await new Promise((r) => setTimeout(r, 4000));
    }
  }
  if (!credsPresent()) {
    ring.warn('persist.qr.warn', 'No saved login and cloud memory did not load → a QR scan will be needed. Scan ONCE; it is saved automatically right after connecting and reused from then on.');
  }
}

/* ── periodic + event-driven sync ───────────────────────────────────── */

let cycleFn = null;
let pendingTimer = null;
let running = false;

async function cycle(reason) {
  if (!enabled()) return false;
  if (running) return false;                       // never stack syncs
  if (localStateEmpty()) return false;             // never clobber good state with emptiness
  running = true;
  try {
    const res = await upload();
    if (res === 'skipped') {
      /* v9.0.0 (repo-slim): nothing changed — no GitHub write. This is the
         normal healthy state for an idle bot; reported, not an error. */
      status.lastSyncReason = 'unchanged (skipped)';
      ring.info('persist.skip', `cloud-state unchanged (${reason}) — skipped, no GitHub write (stays ${Math.round(status.lastBytes / 1024)} KB)`);
      return true;
    }
    status.lastSyncAt = new Date().toISOString(); status.lastSyncReason = reason; status.lastError = '';
    ring.info('persist.upload', `cloud-state synced (${reason}) → ${C.repo}@${C.branch} (${Math.round(status.lastBytes / 1024)} KB)`);
    return true;
  } catch (err) {
    status.lastError = String(err.message).slice(0, 160);
    ring.warn('persist.upload.fail', `cloud-state sync failed (${reason}): ${String(err.message).slice(0, 140)} — retrying next cycle`);
    return false;
  } finally { running = false; }
}

/** Debounced "save soon" — v7.3.3: retries up to 2x when a sync is busy,
 *  so a settings change is never silently dropped. */
function syncSoon(reason = 'event', delayMs = 20000) {
  if (!enabled()) return;
  if (pendingTimer) clearTimeout(pendingTimer);
  const run = (retriesLeft) => {
    cycle(reason).then((ok) => {
      if (!ok && retriesLeft > 0 && enabled() && !localStateEmpty()) {
        pendingTimer = setTimeout(() => { pendingTimer = null; run(retriesLeft - 1); }, 10000);
        pendingTimer.unref?.();
      }
    }).catch(() => { });
  };
  pendingTimer = setTimeout(() => { pendingTimer = null; run(2); }, Math.max(1500, delayMs));
  pendingTimer.unref?.();
}

/** Await a final sync (shutdown path) with a hard time limit. */
async function flush(reason = 'shutdown', timeoutMs = 12000) {
  if (!enabled() || localStateEmpty()) return false;
  if (pendingTimer) { clearTimeout(pendingTimer); pendingTimer = null; }
  return Promise.race([
    cycle(reason),
    new Promise((resolve) => setTimeout(() => resolve(false), timeoutMs))
  ]);
}

function start() {
  status.enabled = enabled();
  if (!enabled()) return { requestSync: cycle, status };
  ring.info('persist.on', `Cloud memory connected → ${repoUsed()} (branch ${C.branch}) — saving every ${C.intervalMin} min, right after pairing, and on every deploy`);
  cycleFn = cycle;
  const first = setTimeout(() => cycle('boot').catch(() => { }), 25000);
  first.unref?.();
  const iv = setInterval(() => cycle('interval').catch(() => { }), C.intervalMin * 60e3);
  iv.unref?.();
  return { requestSync: cycle, status };
}

/** Manual "Back up now" (Settings tab). */
async function backupNow() {
  if (!enabled()) throw new Error('Cloud memory is not configured — set PERSIST_GITHUB_REPO / PERSIST_GITHUB_TOKEN first (README step 4).');
  if (localStateEmpty()) throw new Error('Nothing to back up yet.');
  const ok = await cycle('manual');
  if (!ok) throw new Error(status.lastError || 'Sync failed — see the log.');
  return true;
}

function publicStatus() {
  return {
    enabled: enabled(), repo: C.repo, repoUsed: repoUsed(), branch: C.branch, heldMediaIncluded: process.env.PERSIST_HOLD_MEDIA === '1',
    lastSyncAt: status.lastSyncAt, lastSyncReason: status.lastSyncReason,
    lastError: status.lastError, lastKB: status.lastBytes ? Math.round(status.lastBytes / 1024) : 0,
    restoredFiles: status.restoredFiles, lastRestoreAt: status.lastRestoreAt,
    intervalMin: C.intervalMin, credsPresent: credsPresent(),
    /* v9.0.0 (repo-slim) */
    lastHash: status.lastHash, skips: status.skips, lastSkipAt: status.lastSkipAt,
    /* v11.0.1 (v1.1.4): which ladder rung the last save used + branch size */
    lastPushMode: status.lastPushMode, branchCommits: status.branchCommits
  };
}

/* ── v7.2.1 self-test: find the EXACT reason cloud memory is failing ── */
async function diagnose() {
  const out = { configured: enabled(), repo: C.repo, repoUsed: repoUsed(), repoLooksValid: true, branch: C.branch,
    tokenUser: '', tokenOk: null, repoOk: null, branchExists: null, stateOnBranch: null, stateOnDefault: null, verdict: '', fixes: [] };
  if (!enabled()) {
    out.verdict = 'Cloud memory is not configured yet (PERSIST_GITHUB_REPO / PERSIST_GITHUB_TOKEN are empty).';
    out.fixes = ['Heroku → Settings → Config Vars → add PERSIST_GITHUB_REPO (owner/repo), PERSIST_GITHUB_TOKEN and PERSIST_GITHUB_BRANCH=bot-state (README step 4), then redeploy.'];
    return out;
  }
  const p = parseRepo(C.repo);
  out.repoLooksValid = p.ok;
  if (!p.ok) {
    out.verdict = `PERSIST_GITHUB_REPO is "${C.repo}" — it must be exactly owner/repo (example: myname/raqifluz-bot).`;
    out.fixes = ['Heroku → Config Vars → PERSIST_GITHUB_REPO → paste exactly username/repo-name — no https://, no .git, no spaces.'];
    return out;
  }
  const me = await fetch(`${C.api}/user`, { headers: headers() }).catch(() => null);
  if (!me || !me.ok) {
    out.tokenOk = false;
    out.verdict = `GitHub rejected the token (HTTP ${me?.status || 'no reply'}). The token is wrong, expired or revoked.`;
    out.fixes = [
      'GitHub → Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token.',
      'Repository access → Only select repositories → tick your repo.',
      'Permissions → Repository permissions → Contents → Read and write (Metadata read is automatic).',
      'Copy the new token → Heroku → Settings → Config Vars → PERSIST_GITHUB_TOKEN → replace → redeploy.'
    ];
    return out;
  }
  out.tokenOk = true;
  out.tokenUser = String((await me.json().catch(() => ({}))).login || '');
  const repo = await fetch(`${C.api}/repos/${p.full}`, { headers: headers() }).catch(() => null);
  if (!repo || !repo.ok) {
    out.repoOk = false;
    if (repo?.status === 404) {
      out.verdict = `The token is valid (GitHub user: ${out.tokenUser}) but GitHub answers 404 for "${p.full}". Either that repo name is wrong / lives under another account, or this token was not given access to it.`;
      out.fixes = [
        `Open https://github.com/${p.full} in a browser: if it 404s too → fix PERSIST_GITHUB_REPO to the real owner/repo.`,
        'If it opens → the token is the problem: edit the token → Repository access → Only select repositories → tick that repo → Save; check Contents: Read and write.',
        'A token from a different GitHub account than the repo owner can never see a private repo.',
        'After fixing: Home tab → Test cloud memory again → redeploy.'
      ];
    } else {
      out.verdict = `GitHub answered HTTP ${repo?.status || '?'} for "${p.full}" — usually a network hiccup or an API rate limit. Try again in a minute.`;
      out.fixes = ['If it repeats, check https://www.githubstatus.com and restart the Heroku dyno.'];
    }
    return out;
  }
  out.repoOk = true;
  const info = await repo.json().catch(() => ({}));
  const ref = await fetch(`${base()}/git/ref/heads/${encodeURIComponent(C.branch)}`, { headers: headers() }).catch(() => null);
  out.branchExists = Boolean(ref?.ok);
  out.branchCommits = out.branchExists ? await branchCommitCount() : null;   /* v11.0.1 (v1.1.4) */
  if (out.branchCommits && out.branchCommits > 25) {
    out.verdict = `⚠️ Branch "${C.branch}" has ${out.branchCommits} commits — history is bloated. The next save will reset it to a single commit automatically; GitHub reclaims the old size on its next garbage collection (a few days).`;
  }
  out.stateOnBranch = Boolean(await getState(C.branch));
  out.stateOnDefault = Boolean(await getState(null));
  if (!info.default_branch) {
    out.verdict = `Repo "${p.full}" is reachable but appears EMPTY (no commits / no default branch yet) — the first save then fails.`;
    out.fixes = ['On GitHub open the repo → Add file → Create new file → name it README.md → Commit. Then Test again and redeploy.'];
  } else if (out.stateOnBranch) {
    out.verdict = `All good ✅ — repo reachable (${out.tokenUser}), branch "${C.branch}" exists and a saved login is stored. Deploys will NOT ask for a QR again.`;
  } else if (out.branchExists) {
    out.verdict = `Repo reachable and branch "${C.branch}" exists, but no saved login yet — scan a QR once and it is stored automatically within seconds.`;
  } else {
    out.verdict = `Repo reachable (${out.tokenUser}) — branch "${C.branch}" does not exist yet; it is created automatically on the first save. Scan a QR once.`;
  }
  return out;
}

/* ── v8.3.0 — GitHub storage gauge ─────────────────────────────────────
   Real repo size on GitHub (what a full clone would download): the API's
   `size` field, in KB, covers EVERY branch plus the full git history after
   compression. Cached 60 s so opening Settings never hammers the API. */
let _gh = { at: 0, val: null };
async function githubStats(opts) {
  if (!enabled()) return { configured: false };
  const now = Date.now();
  if (_gh.val && !(opts && opts.refresh) && now - _gh.at < 60000) return _gh.val;
  const r = await fetch(base(), { headers: headers() }).catch(() => null);
  let val;
  if (!r || !r.ok) {
    val = {
      configured: true, reachable: false, http: r ? r.status : null,
      verdict: r && r.status === 404
        ? `GitHub answers 404 for "${repoUsed()}" — the repo is missing or the token cannot see it`
        : `GitHub did not answer (HTTP ${r ? r.status : 'network'}) — press Refresh in a minute`
    };
  } else {
    const info = await r.json().catch(() => ({}));
    val = {
      configured: true, reachable: true,
      repo: repoUsed(), branch: C.branch,
      sizeKb: Number(info.size) || 0,
      defaultBranch: info.default_branch || '',
      lastSyncAt: status.lastSyncAt, lastSyncBytes: status.lastBytes || 0,
      updatedAt: new Date().toISOString()
    };
  }
  _gh = { at: now, val };
  return val;
}

module.exports = { restoreEarly, start, enabled, backupNow, syncSoon, flush, publicStatus, diagnose, parseRepo, upload, compactNow, githubStats, _test: { snapshot, restoreFromZip, stateHash } };
