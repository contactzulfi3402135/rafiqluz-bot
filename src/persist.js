'use strict';
/** Private GitHub snapshot transport for a single application instance.
 * SQLite is snapshotted consistently; sessions/media are captured separately.
 * Recovery and shutdown sync are best effort, never a guarantee of durability
 * or continued linking. See PERSISTENT-DEPLOYMENT.md before relying on it.
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const safeArchive = require('./safe-archive');
const staging = require('./full-backup');
const cloudHttp = require('./cloud-http');
// Do not follow redirects with a private repository token. Abort includes body reads.
const cloudFetch = (url,opts={}) => fetch(url,{...opts,redirect:'error',signal:AbortSignal.timeout(120000)});
const CLOUD_LIMITS={maxFiles:50000,maxFile:256*1024*1024,maxTotal:512*1024*1024};
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
  lastPushMode: '', branchCommits: 0, writeBlocked: false
};
let lastHash = '';   // hash of the last uploaded snapshot — identical state = no new GitHub blob

/* ── branch helpers ─────────────────────────────────────────────────── */

let branchReady = null;          // cached promise: the configured branch exists
async function ensureBranch() {
  if (branchReady) return branchReady;
  branchReady = (async () => {
    const refName = `heads/${C.branch}`;
    const check = await cloudFetch(`${base()}/git/ref/${refName}`, { headers: headers() }).catch(() => null);
    if (check?.ok) { status.branchReady = true; return true; }
    // An authorization or transport failure is not evidence that the branch
    // is absent. Never create from a different tip based on that assumption.
    if(!check || check.status!==404)throw Error(`Cloud branch could not be verified (HTTP ${check?.status || '?'}).`);
    // create it from the repo's default branch tip
    const repo = await cloudFetch(base(), { headers: headers() }).catch(() => null);
    if (!repo?.ok) {
      const st = repo?.status;
      throw new Error(st === 404
        ? `GitHub says "${repoUsed()}" does not exist or the token cannot see it (HTTP 404) — press "Test cloud memory" on the Home tab for the exact reason`
        : `GitHub repo not reachable (HTTP ${st || '?'}) — check PERSIST_GITHUB_REPO / PERSIST_GITHUB_TOKEN`);
    }
    const defaultBranch = (await cloudHttp.json(repo)).default_branch || 'main';
    const head = await cloudFetch(`${base()}/git/ref/heads/${encodeURIComponent(defaultBranch)}`, { headers: headers() });
    if (!head.ok) throw new Error(`GitHub could not read the default branch (HTTP ${head.status})`);
    const sha = (await cloudHttp.json(head)).object.sha;
    const make = await cloudFetch(`${base()}/git/refs`, {
      method: 'POST', headers: headers(), body: JSON.stringify({ ref: `refs/heads/${C.branch}`, sha })
    });
    if (!make.ok) {
      if(make.status!==422)throw new Error(`GitHub could not create the branch "${C.branch}" (HTTP ${make.status})`);
      // 422 can indicate a creation race OR an invalid request. Prove that
      // the expected ref exists before accepting the ambiguous response.
      const confirmed=await cloudFetch(`${base()}/git/ref/${refName}`,{headers:headers()});
      if(!confirmed.ok)throw Error('Cloud branch creation was not confirmed; preserve the existing backup and investigate.');
    }
    ring.info('persist.branch', `Cloud memory branch "${C.branch}" is available`);
    status.branchReady = true;
    return true;
  })().catch((err) => { branchReady = null; throw err; });
  return branchReady;
}

/** read the saved state on a given ref → { sha, content, size } or null */
async function getState(ref) {
  const res = await cloudFetch(contentsUrl(ref), { headers: headers() });
  if (res.status === 404) return null;
  if (res.status === 403 || res.status === 429) throw new Error(`GitHub API rate limit (HTTP ${res.status}) — cloud memory will retry on the next cycle`);
  if (!res.ok) throw new Error(`GitHub state read failed (HTTP ${res.status}).`);
  const data = await cloudHttp.json(res).catch(() => null);
  /* v7.3.8: the SHA is what matters. GitHub omits `content` (empty string,
     encoding "none") for files larger than 1 MB — and the state file WILL
     outgrow 1 MB (inbox + media previews accumulate). Requiring `content`
     used to null the whole read: uploads then lost their sha and died with
     HTTP 422 "sha wasn't supplied", and restore could not find the state. */
  if (!data || !data.sha) throw new Error('GitHub state response was incomplete.');
  return { sha: data.sha, content: data.content || null, size: data.size || 0 };
}

/* ── snapshot / upload / download ───────────────────────────────────── */

// Bound source inventory to the same limits accepted by cloud extraction.
// Fail before upload, preserving the previous cloud snapshot.
function cloudFiles() {
  const roots=[{root:cfg.config.paths.sessions,prefix:'sessions'}];
  if(process.env.PERSIST_HOLD_MEDIA==='1') roots.push({root:path.join(path.dirname(cfg.config.paths.database),'media-hold'),prefix:'media-hold'});
  if(process.env.PERSIST_INBOX_MEDIA==='1') roots.push({root:cfg.config.paths.media,prefix:'media'});
  let files=[],total=0;
  for(const {root,prefix} of roots){const part=staging.enumerate(root,prefix,CLOUD_LIMITS);files.push(...part.files);total+=part.total;}
  if(files.length>CLOUD_LIMITS.maxFiles||total>CLOUD_LIMITS.maxTotal) throw Error('Cloud snapshot exceeds extraction limits.');
  return {files,total};
}
function hashFile(h,item){
  let fd;const match=st=>st.isFile()&&st.dev===item.dev&&st.ino===item.ino&&st.size===item.bytes&&st.mtimeMs===item.mtimeMs&&st.ctimeMs===item.ctimeMs;
  try{
    if(!match(fs.lstatSync(item.disk)))throw Error('Cloud snapshot source changed. Try again.');
    fd=fs.openSync(item.disk,fs.constants.O_RDONLY|(fs.constants.O_NOFOLLOW||0));
    if(!match(fs.fstatSync(fd)))throw Error('Cloud snapshot source changed. Try again.');
    h.update('f:'+JSON.stringify([item.name,item.bytes])+':');const buffer=Buffer.allocUnsafe(256*1024);let read=0;
    while(read<item.bytes){const n=fs.readSync(fd,buffer,0,Math.min(buffer.length,item.bytes-read),read);if(!n)throw Error('Cloud snapshot source changed. Try again.');h.update(buffer.subarray(0,n));read+=n;}
    if(!match(fs.fstatSync(fd)))throw Error('Cloud snapshot source changed. Try again.');
  } finally {if(fd!==undefined)fs.closeSync(fd);}
}

/** Create an online-consistent SQLite snapshot plus independently captured files. */
async function snapshot() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'raq7-'));
  const zipPath = path.join(tmp, STATE_FILE);
  const dbFile = cfg.config.paths.database;
  try {
    if (!fs.existsSync(dbFile)) throw Error('Cloud snapshot cannot be made without a database; previous backup was not changed.');
    const before = stateHash();
    const stagedDb=path.join(tmp,'cloud-database-stage.sqlite');
    const source=require('better-sqlite3')(dbFile,{readonly:true,fileMustExist:true});
    try { source.exec(`VACUUM INTO '${stagedDb.replace(/'/g,"''")}'`); } finally { source.close(); }
    const inventory=cloudFiles();const dbSize=fs.statSync(stagedDb).size;
    if(dbSize>CLOUD_LIMITS.maxFile||dbSize+inventory.total>CLOUD_LIMITS.maxTotal||inventory.files.length+2>CLOUD_LIMITS.maxFiles)throw Error('Cloud snapshot exceeds extraction limits.');
    const stageDir=path.join(tmp,'files');fs.mkdirSync(stageDir,{mode:0o700});const files=[];
    for(let i=0;i<inventory.files.length;i++)files.push(await staging._stageFile(inventory.files[i],stageDir,i));
    const { ZipArchive } = await import('archiver');
    await new Promise((resolve, reject) => {
      const output = fs.createWriteStream(zipPath,{mode:0o600,flags:'wx'});
      const archive = new ZipArchive({ zlib: { level: 6 } });
      let failed=false;
      const fail=e=>{if(failed)return;failed=true;archive.abort();output.destroy();reject(e);};
      output.on('close',()=>{if(!failed)resolve();}); output.on('error',fail); archive.on('error',fail); archive.on('warning',fail);
      archive.pipe(output);
      for(const f of files) archive.file(f.disk,{name:f.name});
      archive.file(stagedDb, { name: 'bot.sqlite' });
      archive.append(JSON.stringify({format:1,databaseEntry:'bot.sqlite'}),{name:'cloud-manifest.json'});
      archive.finalize().catch(fail);
    });
    const after=stateHash();
    // If state changed while archiving, deliberately force the next cycle to
    // send again; never label a potentially stale snapshot with the new hash.
    const hash=before === after ? after : 'changed-during-snapshot:'+crypto.randomBytes(32).toString('hex');
    return { zipPath, size: fs.statSync(zipPath).size, hash };
  } catch(e) { fs.rmSync(tmp,{recursive:true,force:true}); throw e; }
}

/** sha256 over the logical state: DB schema + every row (all tables) +
 *  sessions/ tree (sorted path + bytes). Stable across no-op VACUUMs. */
function stateHash() {
  const h = crypto.createHash('sha256');
  const dbFile = cfg.config.paths.database;
  if (fs.existsSync(dbFile)) {
    const d = require('better-sqlite3')(dbFile, { readonly:true, fileMustExist:true });
    try {
      const tables=d.prepare("SELECT name, sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all();
      h.update('db-schema:');h.update(JSON.stringify(tables));
      for (const t of tables) {
        h.update('\n'+t.name+':');
        const ident='"'+t.name.replace(/"/g,'""')+'"';
        for(const row of d.prepare(`SELECT * FROM ${ident}`).iterate()) h.update(JSON.stringify(row)+'\n');
      }
    } finally { d.close(); }
  }
  for(const item of cloudFiles().files) hashFile(h,item);
  return h.digest('hex');
}

/** @returns {Promise<'saved'|'skipped'|false>} */
async function upload(force = false) {
  if (status.writeBlocked) throw new Error('Cloud writes are blocked because the startup restore could not be verified. Preserve the cloud copy and follow recovery instructions.');
  const snap = await snapshot();
  try {
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
      // Never delete an existing backup branch as a fallback: recreation can
      // fail after deletion and destroy the only recoverable snapshot.
      ring.warn('persist.replace.fail', `Replace-push failed (${e1.message}); attempting a non-destructive append.`);
      const n = await branchCommitCount();
      if (n !== null && n < MAX_BRANCH_COMMITS) {
        await pushClassic(content);
        mode = 'classic'; saved = true; status.branchCommits = n + 1;
        ring.warn('persist.classic.fallback', `Saved without deleting the branch; ${status.branchCommits}/${MAX_BRANCH_COMMITS} commits. Check cloud-memory permissions.`);
      } else {
        status.lastError = `Snapshot not saved: branch history ${n === null ? 'could not be checked' : `has ${n} commits (cap ${MAX_BRANCH_COMMITS})`} and replace failed. The existing backup was not deleted.`;
        throw new Error(status.lastError);
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
  if (running) throw new Error('A cloud backup is already in progress. Try again after it finishes.');
  running = true;
  try {
    const was = status.lastBytes;
    const ok = await upload(true);
    if (ok !== 'saved') throw new Error(status.lastError || 'Compact push failed — see the log.');
    if (status.lastPushMode !== 'replace') throw new Error('A backup was saved, but compaction did not succeed; existing branch history was preserved.');
    return {bytes: status.lastBytes, wasBytes: was, drop: Math.max(0,was-status.lastBytes), hash: status.lastHash, at: new Date().toISOString()};
  } finally { running = false; }
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
  let r = await cloudFetch(`${base()}/git/blobs`, { method: 'POST', headers: headers(), body: JSON.stringify({ content, encoding: 'base64' }) });
  if (!r.ok) throw new Error(`blob HTTP ${r.status}`);
  const blobSha = (await cloudHttp.json(r)).sha;
  r = await cloudFetch(`${base()}/git/trees`, { method: 'POST', headers: headers(), body: JSON.stringify({ tree: [{ path: STATE_FILE, mode: '100644', type: 'blob', sha: blobSha }] }) });
  if (!r.ok) throw new Error(`tree HTTP ${r.status}`);
  const treeSha = (await cloudHttp.json(r)).sha;
  r = await cloudFetch(`${base()}/git/commits`, { method: 'POST', headers: headers(), body: JSON.stringify({ message: msg, tree: treeSha }) });
  if (!r.ok) throw new Error(`commit HTTP ${r.status}`);
  return (await cloudHttp.json(r)).sha;
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
  const exists = await cloudFetch(`${base()}/git/ref/${ref}`, { headers: headers() }).then((x) => x.ok).catch(() => false);
  const r = exists
    ? await cloudFetch(`${base()}/git/refs/${ref}`, { method: 'PUT', headers: headers(), body: JSON.stringify({ sha: commitSha, force: true }) })
    : await cloudFetch(`${base()}/git/refs`, { method: 'POST', headers: headers(), body: JSON.stringify({ ref: `refs/heads/${C.branch}`, sha: commitSha }) });
  if (!r.ok) throw new Error(`ref HTTP ${r.status}`);
}

/** Cheap branch commit count: page number of the last page in the commits
    list (per_page=1). Returns null when unknown. */
async function branchCommitCount() {
  try {
    const r = await cloudFetch(`${base()}/commits?sha=${encodeURIComponent(C.branch)}&per_page=1`, { headers: headers() });
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
  let put = await cloudFetch(contentsUrl(null), { method: 'PUT', headers: headers(), body: JSON.stringify(body) });
  if (!put.ok && (put.status === 409 || put.status === 422)) {
    // race (another sync finished first) → refresh the sha once and retry
    const again = await getState(C.branch);
    if (again?.sha) { body.sha = again.sha; put = await cloudFetch(contentsUrl(null), { method: 'PUT', headers: headers(), body: JSON.stringify(body) }); }
  }
  if (!put.ok) throw new Error(`GitHub upload failed (HTTP ${put.status}).`);
  return true;
}

/** Download the state zip (null when none). Reads the configured branch first,
 *  then the default branch (state written by older builds). */
async function download() {
  await ensureBranch();
  let hit = await getState(C.branch);
  let hitRef = C.branch;
  if (!hit) {
    hit = await getState(null);                       // default branch fallback
    if (hit) { hitRef = null; ring.info('persist.migrate', `Found saved state on the default branch — moving it to "${C.branch}" on the next sync`); }
  }
  if (!hit) return null;
  const declared=Number(hit.size);
  if(!Number.isSafeInteger(declared) || declared<0 || declared>cloudHttp.ARCHIVE_LIMIT)throw Error('Cloud archive exceeds the safe download size.');
  const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'raq7-dl-')),p=path.join(tmp,STATE_FILE);
  try {
    let size;
    if(hit.content){
      if(typeof hit.content!=='string')throw Error('Cloud archive content is invalid.');
      const clean=hit.content.replace(/[\r\n\t ]/g,'');
      if(!clean || clean.length%4!==0 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(clean))throw Error('Cloud archive content is invalid.');
      const buf=Buffer.from(clean,'base64');if(!buf.length || buf.length>cloudHttp.ARCHIVE_LIMIT || buf.toString('base64')!==clean)throw Error('Cloud archive content is invalid.');
      fs.writeFileSync(p,buf,{flag:'wx',mode:0o600});size=buf.length;
    }else{
      const raw=await cloudFetch(contentsUrl(hitRef),{headers:{...headers(),Accept:'application/vnd.github.raw+json'}});
      if(!raw.ok)throw Error(`GitHub state download failed (HTTP ${raw.status})`);
      size=await cloudHttp.file(raw,p);
    }
    if(declared && size!==declared)throw Error('Cloud archive size does not match metadata.');
    return p;
  } catch(e){fs.rmSync(tmp,{recursive:true,force:true});throw e;}
}

/** Restore: only fill MISSING files — local state is always newer. */
function hasLocalEntry(p){try{fs.lstatSync(p);return true}catch(e){if(e.code==='ENOENT')return false;throw e;}}
async function restoreFromZip(zipPath) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'raq7-restore-'));
  let dbStage=null;
  try {
  await safeArchive.extract(zipPath, tmp);
  let sessionFiles = 0; let dbRestored = false;
  let entry = path.basename(cfg.config.paths.database);
  const manifestPath=path.join(tmp,'cloud-manifest.json');
  if (fs.existsSync(manifestPath)) {
    const manifest=JSON.parse(fs.readFileSync(manifestPath,'utf8'));
    if(manifest.format!==1 || typeof manifest.databaseEntry!=='string' || path.basename(manifest.databaseEntry)!==manifest.databaseEntry || manifest.databaseEntry==='cloud-manifest.json') throw new Error('Cloud manifest has an invalid database entry.');
    entry=manifest.databaseEntry;
  } else if (!fs.existsSync(path.join(tmp,entry))) {
    const candidates=fs.readdirSync(tmp,{withFileTypes:true}).filter(e=>e.isFile() && /\.(sqlite|sqlite3|db)$/i.test(e.name)).map(e=>e.name);
    if(candidates.length===1) entry=candidates[0];
  }
  const dbSrc = path.join(tmp,entry);
  if (!fs.existsSync(dbSrc)) throw new Error('Cloud snapshot has no identifiable database; no files were restored.');
  if (fs.existsSync(dbSrc)) {
    const candidate = require('better-sqlite3')(dbSrc, {readonly:true,fileMustExist:true});
    try {
      if (candidate.pragma('integrity_check', {simple:true}) !== 'ok') throw new Error('Cloud database failed integrity validation.');
      // A healthy unrelated SQLite file is not a valid application backup.
      // Reject it before writing any database, session or media files.
      for(const [table,required] of [['settings',['key','value']],['posts',['id','source_jid','source_msg_id']]]) {
        const entry=candidate.prepare("SELECT type FROM sqlite_master WHERE name=?").get(table);
        if(entry?.type!=='table')throw Error('Cloud database is not a recognizable Raqifluz state; no files were installed.');
        const columns=new Set(candidate.prepare(`PRAGMA table_info("${table}")`).all().map(x=>x.name));
        if(required.some(col=>!columns.has(col)))throw Error('Cloud database lacks required state columns; no files were installed.');
      }
      if(!fs.existsSync(cfg.config.paths.database)) {
        // A stale sidecar could be replayed into an unrelated restored DB.
        for(const suffix of ['-wal','-shm','-journal'])if(hasLocalEntry(cfg.config.paths.database+suffix))throw Error('Local database sidecars exist without the database. Stop and investigate before recovery.');
        const parent=path.dirname(cfg.config.paths.database);fs.mkdirSync(parent,{recursive:true,mode:0o700});
        dbStage=fs.mkdtempSync(path.join(parent,'.restore-db-'));
        // Fold any legacy WAL into a standalone database before publication.
        const standalone=path.join(dbStage,'snapshot.sqlite');candidate.exec(`VACUUM INTO '${standalone.replace(/'/g,"''")}'`);fs.chmodSync(standalone,0o600);
        const verify=require('better-sqlite3')(standalone,{readonly:true,fileMustExist:true});try{if(verify.pragma('integrity_check',{simple:true})!=='ok')throw Error('Staged cloud database failed integrity validation.');}finally{verify.close();}
      }
    } finally { candidate.close(); }
  }
  const sessSrc = path.join(tmp, 'sessions');
  if (fs.existsSync(sessSrc)) {
    // Never combine old and current encryption keys in a partly populated
    // session. Restore an entire missing/empty top-level session only.
    const copy = (src,dst) => {
      for (const e of fs.readdirSync(src,{withFileTypes:true})) {
        const a=path.join(src,e.name), b=path.join(dst,e.name);
        if (e.isDirectory()) { fs.mkdirSync(b,{recursive:true,mode:0o700}); copy(a,b); }
        else if (e.isFile()) { fs.copyFileSync(a,b,fs.constants.COPYFILE_EXCL); sessionFiles++; }
      }
    };
    fs.mkdirSync(cfg.config.paths.sessions,{recursive:true,mode:0o700});
    for (const e of fs.readdirSync(sessSrc,{withFileTypes:true})) {
      const src=path.join(sessSrc,e.name),dst=path.join(cfg.config.paths.sessions,e.name);
      if (e.isDirectory()) {
        if (fs.existsSync(dst) && (!fs.lstatSync(dst).isDirectory() || fs.lstatSync(dst).isSymbolicLink() || fs.readdirSync(dst).length)) continue;
        const stage=fs.mkdtempSync(path.join(cfg.config.paths.sessions,'.restore-session-'));
        try {
          copy(src,stage);
          if (fs.existsSync(dst)) fs.rmdirSync(dst); // remove only an empty directory
          fs.renameSync(stage,dst);
        } finally { fs.rmSync(stage,{recursive:true,force:true}); }
      } else if (e.isFile() && !fs.existsSync(dst)) { fs.copyFileSync(src,dst,fs.constants.COPYFILE_EXCL);sessionFiles++; }
    }
  }
  if (dbStage) {
    // link is atomic and no-overwrite on a supporting local filesystem. If a
    // competing process created state meanwhile, keep it and stop recovery.
    for(const suffix of ['-wal','-shm','-journal'])if(hasLocalEntry(cfg.config.paths.database+suffix))throw Error('Local database sidecars appeared during recovery; no database was installed.');
    try{fs.linkSync(path.join(dbStage,'snapshot.sqlite'),cfg.config.paths.database);}
    catch(e){throw Error('Could not atomically install recovered database; existing state was not overwritten. '+e.message);}
    dbRestored = true;
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
  // Optional inbox files accompany the newly restored database; never
  // overlay existing local files or merge them with an existing database.
  const inboxSrc=path.join(tmp,'media','inbox');
  if (dbRestored && fs.existsSync(inboxSrc)) {
    const target=path.join(cfg.config.paths.media,'inbox');fs.mkdirSync(target,{recursive:true,mode:0o700});
    for (const e of fs.readdirSync(inboxSrc,{withFileTypes:true})) {
      if (!e.isFile() || !/^[1-9][0-9]*\.(jpg|bin)$/.test(e.name)) continue;
      const dest=path.join(target,e.name);
      if(!fs.existsSync(dest)) fs.copyFileSync(path.join(inboxSrc,e.name),dest,fs.constants.COPYFILE_EXCL);
    }
  }
  return { sessionFiles, dbRestored };
  } finally { if(dbStage)fs.rmSync(dbStage,{recursive:true,force:true});fs.rmSync(tmp, { recursive: true, force: true }); }
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
    ring.warn('persist.off', 'Cloud memory is off. Use a verified persistent storage volume and independent backups; ephemeral disk can lose settings and linked sessions.');
    return;
  }
  status.writeBlocked = true; // never replace an unknown remote backup after failed recovery
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    let zip = null;
    try {
      zip = await download();
      if (!zip) {
        if (!status.branchReady) {
          ring.warn('persist.repo.warn', `Cloud memory could NOT reach ${repoUsed()} with the saved token — check PERSIST_GITHUB_REPO / PERSIST_GITHUB_TOKEN (README step 4). Until this works, deploys will ask for a QR scan again.`);
        } else {
          ring.info('persist.empty', `Cloud memory: nothing saved yet on ${C.repo}@${C.branch} — first run`);
        }
        status.lastError = ''; status.writeBlocked = false;
        return;
      }
      const r = await restoreFromZip(zip);
      status.lastError = ''; status.writeBlocked = false;
      status.lastRestoreAt = new Date().toISOString(); status.restoredFiles = r.sessionFiles;
      ring.info('persist.restored', `Cloud memory restored: ${r.sessionFiles} session file(s)${r.dbRestored ? ' + database' : ''}. Check the connection status; a QR may still be needed`);
      return;
    } catch (err) {
      status.lastError = String(err.message).slice(0, 160);
      ring.warn('persist.restore.fail', `Cloud memory restore attempt ${attempt} failed: ${String(err.message).slice(0, 140)}`);
      if (attempt === 1) await new Promise((r) => setTimeout(r, 4000));
    } finally { if (zip) try { fs.rmSync(path.dirname(zip),{recursive:true,force:true}); } catch {} }
  }
  ring.error('persist.blocked','Cloud writes are blocked for this process because the saved state could not be verified. Preserve the remote backup and investigate before restarting.');
  if (localStateEmpty() || !credsPresent()) {
    throw new Error('Cloud recovery failed and local database or linked session is missing. Startup stopped to avoid replacing the saved state with a new empty installation. Check the cloud connection and recovery guide.');
  }
  ring.warn('persist.local-only','Continuing with existing local database and session. Cloud writes remain blocked until a successful restart verifies the saved snapshot.');
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
  ring.info('persist.on', `Cloud memory connected → ${repoUsed()} (branch ${C.branch}) — scheduled sync every ${C.intervalMin} min, with best-effort pairing and shutdown sync`);
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
    enabled: enabled(), repo: C.repo, repoUsed: repoUsed(), branch: C.branch, heldMediaIncluded: process.env.PERSIST_HOLD_MEDIA === '1', inboxMediaIncluded: process.env.PERSIST_INBOX_MEDIA === '1',
    lastSyncAt: status.lastSyncAt, lastSyncReason: status.lastSyncReason,
    lastError: status.lastError, writeBlocked: status.writeBlocked, lastKB: status.lastBytes ? Math.round(status.lastBytes / 1024) : 0,
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
  const me = await cloudFetch(`${C.api}/user`, { headers: headers() }).catch(() => null);
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
  out.tokenUser = String((await cloudHttp.json(me).catch(() => ({}))).login || '');
  const repo = await cloudFetch(`${C.api}/repos/${p.full}`, { headers: headers() }).catch(() => null);
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
  const info = await cloudHttp.json(repo).catch(() => ({}));
  const ref = await cloudFetch(`${base()}/git/ref/heads/${encodeURIComponent(C.branch)}`, { headers: headers() }).catch(() => null);
  out.branchExists = Boolean(ref?.ok);
  out.branchCommits = out.branchExists ? await branchCommitCount() : null;   /* v11.0.1 (v1.1.4) */
  if (out.branchCommits && out.branchCommits > 25) {
    out.verdict = `⚠️ Branch "${C.branch}" has ${out.branchCommits} commits — history is bloated. A replace-style save may compact history if permissions allow; confirm the result. GitHub controls garbage collection and retention.`;
  }
  out.stateOnBranch = Boolean(await getState(C.branch));
  out.stateOnDefault = Boolean(await getState(null));
  if (!info.default_branch) {
    out.verdict = `Repo "${p.full}" is reachable but appears EMPTY (no commits / no default branch yet) — the first save then fails.`;
    out.fixes = ['On GitHub open the repo → Add file → Create new file → name it README.md → Commit. Then Test again and redeploy.'];
  } else if (out.stateOnBranch) {
    out.verdict = `Repo reachable (${out.tokenUser}); branch "${C.branch}" contains a state snapshot. Verify recovery and linked-device status; WhatsApp can still require a new QR.`;
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
  const r = await cloudFetch(base(), { headers: headers() }).catch(() => null);
  let val;
  if (!r || !r.ok) {
    val = {
      configured: true, reachable: false, http: r ? r.status : null,
      verdict: r && r.status === 404
        ? `GitHub answers 404 for "${repoUsed()}" — the repo is missing or the token cannot see it`
        : `GitHub did not answer (HTTP ${r ? r.status : 'network'}) — press Refresh in a minute`
    };
  } else {
    const info = await cloudHttp.json(r).catch(() => ({}));
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

module.exports = { restoreEarly, start, enabled, backupNow, syncSoon, flush, publicStatus, diagnose, parseRepo, upload, compactNow, githubStats, _test: { snapshot, restoreFromZip, stateHash, download, ensureBranch } };
