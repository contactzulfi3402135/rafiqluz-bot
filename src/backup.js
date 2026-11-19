/* 5E (R70): LOCAL BACKUP & RESTORE — download the whole bot state as a zip,
   restore from a zip (or raw .sqlite) with an automatic PRE-RESTORE snapshot.
   Restore is a single all-or-nothing SQL transaction on the LIVE database
   handle (no restart, no file swap): every table is copied from the attached
   uploaded file, tables that no longer exist are cleared, FTS indexes are
   rebuilt. Nothing here ever touches WhatsApp credentials or bot-state. */
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const db = require('./db');

const BACKUP_DIR = path.join(path.dirname(require('./config').config.paths.database), 'pre-restore');
const KEEP = 5; // pre-restore snapshots to keep

/* ── minimal ZIP writer (STORE or DEFLATE) — zero dependencies ── */
let CRC_TABLE = null;
function crc32(buf) {
  if (!CRC_TABLE) {
    CRC_TABLE = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      CRC_TABLE[n] = c;
    }
  }
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function dosDate(d = new Date()) {
  const time = (d.getUTCHours() << 11) | (d.getUTCMinutes() << 5) | (d.getUTCSeconds() >> 1);
  const date = (((d.getUTCFullYear() - 1980) & 0x7f) << 9) | ((d.getUTCMonth() + 1) << 5) | d.getUTCDate();
  return { time, date };
}
function buildZip(files) { // [{ name, data: Buffer }]
  const { time, date } = dosDate();
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const f of files) {
    const name = Buffer.from(f.name, 'utf8');
    const data = f.data;
    const crc = crc32(data);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(20, 4);          // version needed
    lh.writeUInt16LE(0, 6);           // flags
    lh.writeUInt16LE(0, 8);           // method: STORE
    lh.writeUInt16LE(time, 10); lh.writeUInt16LE(date, 12);
    lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(data.length, 18);
    lh.writeUInt32LE(data.length, 22);
    lh.writeUInt16LE(name.length, 26);
    lh.writeUInt16LE(0, 28);
    locals.push(lh, name, data);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0);
    ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6);
    ch.writeUInt16LE(0, 8); ch.writeUInt16LE(0, 10);
    ch.writeUInt16LE(time, 12); ch.writeUInt16LE(date, 14);
    ch.writeUInt32LE(crc, 16);
    ch.writeUInt32LE(data.length, 20);
    ch.writeUInt32LE(data.length, 24);
    ch.writeUInt16LE(name.length, 28);
    ch.writeUInt32LE(offset, 42);
    centrals.push(ch, name);
    offset += 30 + name.length + data.length;
  }
  const cd = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, eocd]);
}

/* ── minimal ZIP reader (STORE + DEFLATE) for uploads ── */
function readZip(buf) {
  // Untrusted uploads: bound compressed and expanded sizes, entry count and
  // offsets before touching a decompressor. Never extract paths to disk.
  const MAX_ARCHIVE = 200 * 1024 * 1024, MAX_TOTAL = 200 * 1024 * 1024, MAX_ENTRY = 100 * 1024 * 1024;
  if (!Buffer.isBuffer(buf) || buf.length > MAX_ARCHIVE || buf.length < 22) throw new Error('Invalid or oversized zip file.');
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50 && i + 22 + buf.readUInt16LE(i + 20) === buf.length) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('Not a valid zip file.');
  const count = buf.readUInt16LE(eocd + 10), dirSize = buf.readUInt32LE(eocd + 12);
  let p = buf.readUInt32LE(eocd + 16), expanded = 0;
  if (buf.readUInt16LE(eocd + 4) || buf.readUInt16LE(eocd + 6) || count !== buf.readUInt16LE(eocd + 8) || count > 64 || p + dirSize > eocd) throw new Error('Unsupported zip directory.');
  const end = p + dirSize, out = [];
  for (let n = 0; n < count; n++) {
    if (p + 46 > end || buf.readUInt32LE(p) !== 0x02014b50) throw new Error('Corrupt zip central directory.');
    const flags = buf.readUInt16LE(p + 8), method = buf.readUInt16LE(p + 10), crc = buf.readUInt32LE(p + 16);
    const size = buf.readUInt32LE(p + 20), outputSize = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28), extraLen = buf.readUInt16LE(p + 30), cmtLen = buf.readUInt16LE(p + 32), localOff = buf.readUInt32LE(p + 42);
    if ((flags & 1) || ![0,8].includes(method) || outputSize > MAX_ENTRY || (expanded += outputSize) > MAX_TOTAL || p + 46 + nameLen + extraLen + cmtLen > end) throw new Error('Unsupported or oversized zip entry.');
    const name = buf.slice(p + 46, p + 46 + nameLen).toString('utf8');
    if (name.includes('..') || name.includes('\\') || name.startsWith('/')) throw new Error('Invalid zip entry name.');
    if (localOff + 30 > buf.length || buf.readUInt32LE(localOff) !== 0x04034b50) throw new Error('Corrupt zip entry.');
    const start = localOff + 30 + buf.readUInt16LE(localOff + 26) + buf.readUInt16LE(localOff + 28);
    if (start + size > end || start > end) throw new Error('Corrupt zip data.');
    const raw = buf.subarray(start, start + size);
    let data;
    try { data = method === 8 ? zlib.inflateRawSync(raw, {maxOutputLength: MAX_ENTRY}) : raw; }
    catch { throw new Error('Invalid or oversized compressed entry.'); }
    if (data.length !== outputSize || crc32(data) !== crc) throw new Error('Zip entry integrity check failed.');
    out.push({ name, data });
    p += 46 + nameLen + extraLen + cmtLen;
  }
  if (p !== end) throw new Error('Invalid zip directory length.');
  return out;
}

/* ── download: a consistent snapshot of the live DB + manifest ── */
function downloadZip() {
  const d = db.open();
  const tmp = path.join(path.dirname(require('./config').config.paths.database), `_dl-${require('crypto').randomBytes(12).toString('hex')}.sqlite`);
  d.exec(`VACUUM INTO '${tmp.replace(/'/g, "''")}'`);
  const sql = fs.readFileSync(tmp);
  fs.unlinkSync(tmp);
  const counts = {};
  for (const t of ['posts', 'logs', 'audit', 'approvals', 'settings', 'inbox_msgs']) {
    try { counts[t] = d.prepare(`SELECT COUNT(*) c FROM [${t}]`).get().c; } catch { counts[t] = null; }
  }
  const manifest = {
    app: 'raqifluz-channel-bot',
    version: String(db.S.get('version.mark', '')) || require('../package.json').version,
    madeAt: new Date().toISOString(),
    tables: counts,
    note: 'Restore from Dashboard → Settings → Backup & restore. This file contains your settings and API keys — keep it private.'
  };
  const readme = 'Raqifluz Channel Bot backup\n============================\n\nContents:\n  bot.sqlite — the complete bot database (settings, sources, targets, posts,\n               logs, audit, queue, media references, API keys)\n  manifest.json — what is inside and when it was made\n\nRestore: Dashboard → Settings → Backup & restore → choose this zip.\nA pre-restore snapshot is made automatically before every restore, so a\nrestore can itself be undone (Settings → Backup & restore → snapshots).\n\nThis file contains credentials. Keep it private, like a password.';
  return buildZip([
    { name: 'bot.sqlite', data: sql },
    { name: 'manifest.json', data: Buffer.from(JSON.stringify(manifest, null, 2), 'utf8') },
    { name: 'README.txt', data: Buffer.from(readme, 'utf8') }
  ]);
}

/* ── pre-restore snapshots ── */
function preRestoreSnapshot() {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const name = `pre-restore-${new Date().toISOString().replace(/[:.]/g, '-')}.sqlite`;
  const file = path.join(BACKUP_DIR, name);
  db.open().exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
  // retention: keep the newest KEEP
  const all = fs.readdirSync(BACKUP_DIR).filter((f) => f.startsWith('pre-restore-') && f.endsWith('.sqlite'))
    .map((f) => ({ f, m: fs.statSync(path.join(BACKUP_DIR, f)).mtimeMs }))
    .sort((a, b) => b.m - a.m);
  for (const x of all.slice(KEEP)) { try { fs.unlinkSync(path.join(BACKUP_DIR, x.f)); } catch { } }
  return { name, file, bytes: fs.statSync(file).size };
}
function listPreRestore() {
  try {
    return fs.readdirSync(BACKUP_DIR).filter((f) => f.startsWith('pre-restore-') && f.endsWith('.sqlite'))
      .map((f) => { const st = fs.statSync(path.join(BACKUP_DIR, f)); return { name: f, bytes: st.size, at: st.mtime.toISOString() }; })
      .sort((a, b) => (a.at < b.at ? 1 : -1));
  } catch { return []; }
}

/* ── restore: upload zip or raw sqlite → all-or-nothing copy into the live DB ── */
function extractSqlite(buf) {
  if (buf.slice(0, 4).toString('latin1') === 'PK\x03\x04') {
    const files = readZip(buf).filter((f) => f.name.endsWith('.sqlite'));
    if (!files.length) throw new Error('Zip does not contain a bot.sqlite file.');
    return files[0].data;
  }
  return buf; // raw .sqlite upload
}
function restoreFromBuffer(buf) {
  const data = extractSqlite(buf);
  if (data.slice(0, 15).toString('latin1') !== 'SQLite format 3') throw new Error('Not a SQLite database.');
  const staged = path.join(path.dirname(require('./config').config.paths.database), `_restore-${require('crypto').randomBytes(12).toString('hex')}.sqlite`);
  fs.writeFileSync(staged, data);
  let before;
  try {
    before = preRestoreSnapshot();
    const inc = new (require('better-sqlite3'))(staged, { readonly: true });
    const ok = inc.prepare('PRAGMA integrity_check').get().integrity_check === 'ok';
    const tables = inc.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all().map((r) => r.name);
    inc.close();
    if (!ok) throw new Error('The uploaded database failed integrity_check — nothing was changed.');
    for (const t of ['settings', 'posts']) if (!tables.includes(t)) throw new Error('Not a Raqifluz bot database (missing table: ' + t + ').');
    const d = db.open();
    const lit = "'" + staged.replace(/'/g, "''") + "'";
    d.exec(`ATTACH DATABASE ${lit} AS src`);
    try {
      const txn = d.transaction(() => {
        const liveTables = d.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '%_fts%' AND name NOT LIKE '%_data' AND name NOT LIKE '%_idx' AND name NOT LIKE '%_content' AND name NOT LIKE '%_docsize'").all().map((r) => r.name);
        for (const t of liveTables) {
          // A backup from an older version cannot erase newer tables. Copy
          // shared columns explicitly so additive schema migrations survive.
          if (!tables.includes(t)) continue;
          const quote = x => '"' + String(x).replace(/"/g, '""') + '"';
          const current = d.prepare(`PRAGMA main.table_info(${quote(t)})`).all();
          const incoming = new Set(d.prepare(`PRAGMA src.table_info(${quote(t)})`).all().map(c => c.name));
          const cols = current.filter(c => incoming.has(c.name)).map(c => quote(c.name));
          if (!cols.length) throw new Error('No compatible columns in table: ' + t);
          d.exec(`DELETE FROM ${quote(t)}; INSERT INTO ${quote(t)} (${cols.join(',')}) SELECT ${cols.join(',')} FROM src.${quote(t)};`);
        }
        // INSERT updates live AUTOINCREMENT sequences; untouched newer tables keep theirs.
        for (const f of ['posts_fts', 'logs_fts', 'inbox_fts']) { try { d.exec(`INSERT INTO [${f}]([${f}]) VALUES('rebuild')`); } catch { } }
      });
      txn();
    } finally { d.exec('DETACH DATABASE src'); }
    try { fs.unlinkSync(staged); } catch { }
    return { preRestore: before.name };
  } catch (e) {
    try { fs.unlinkSync(staged); } catch { }
    throw e;
  }
}

module.exports = { downloadZip, restoreFromBuffer, preRestoreSnapshot, listPreRestore, BACKUP_DIR, buildZip, readZip };
