'use strict';
/**
 * v7.0.0 — SQLite storage: one file, clean schema, everything survives restarts.
 * v7 adds: multiple WhatsApp numbers (numbers), contacts sync, and a
 * session-scoped inbox with anti-delete / anti-view-once / anti-edit fields.
 */
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const cfg = require('./config');
const { ring } = require('./logger');

let db = null;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE IF NOT EXISTS sources(
  jid TEXT PRIMARY KEY, name TEXT, added_at TEXT DEFAULT (datetime('now')),
  added_by TEXT DEFAULT '', paused INTEGER DEFAULT 0,
  targets TEXT DEFAULT '',            -- v6.1: comma jids — empty = publish to ALL targets
  last_post_at TEXT DEFAULT ''        -- v6.1: source health ("last post seen")
);
CREATE TABLE IF NOT EXISTS targets(
  jid TEXT PRIMARY KEY, name TEXT, added_at TEXT DEFAULT (datetime('now')),
  added_by TEXT DEFAULT '', paused INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS directory(
  jid TEXT PRIMARY KEY, name TEXT, role TEXT, seen_at TEXT DEFAULT (datetime('now'))
);
/* v7.8.0: Browse — cache of resolved channel metadata (public code → jid/name/followers) */
CREATE TABLE IF NOT EXISTS browse_meta(
  code TEXT PRIMARY KEY, name TEXT, jid TEXT, followers TEXT, src TEXT,
  updated_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_browse_jid ON browse_meta(jid);
CREATE TABLE IF NOT EXISTS posts(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_jid TEXT, source_msg_id TEXT, status TEXT DEFAULT 'published',   -- published|skipped|failed|edited
  reason TEXT DEFAULT '', created_at TEXT DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_posts_src ON posts(source_jid, source_msg_id);
CREATE INDEX IF NOT EXISTS idx_posts_day ON posts(created_at);
CREATE TABLE IF NOT EXISTS post_keys(
  post_id INTEGER, target_jid TEXT, msg_id TEXT, at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_keys_post ON post_keys(post_id);
CREATE TABLE IF NOT EXISTS logs(ts TEXT, level TEXT, code TEXT, msg TEXT, extra TEXT);
CREATE INDEX IF NOT EXISTS idx_logs_ts ON logs(ts);
/* ── v7: inbox is per-number (session) ─────────────────────────────── */
CREATE TABLE IF NOT EXISTS inbox_chats(
  session TEXT DEFAULT 'main', jid TEXT, name TEXT, last_at TEXT, last_text TEXT,
  unread INTEGER DEFAULT 0, archived INTEGER DEFAULT 0, pinned INTEGER DEFAULT 0, muted INTEGER DEFAULT 0,
  PRIMARY KEY(session, jid)
);
CREATE TABLE IF NOT EXISTS inbox_msgs(
  id INTEGER PRIMARY KEY AUTOINCREMENT, session TEXT DEFAULT 'main', chat_jid TEXT, from_me INTEGER, ts TEXT,
  sender_name TEXT, body TEXT, msg_id TEXT DEFAULT '', kind TEXT DEFAULT '', deleted INTEGER DEFAULT 0,
  edited INTEGER DEFAULT 0, orig_body TEXT DEFAULT '', media_mime TEXT DEFAULT '', media_name TEXT DEFAULT '',
  media_data BLOB
);
CREATE INDEX IF NOT EXISTS idx_inbox_chat ON inbox_msgs(session, chat_jid, id);
CREATE INDEX IF NOT EXISTS idx_inbox_mid ON inbox_msgs(session, chat_jid, msg_id);
CREATE INDEX IF NOT EXISTS idx_inbox_ts ON inbox_msgs(session, ts);
/* ── v7: connected numbers + synced contacts ───────────────────────── */
CREATE TABLE IF NOT EXISTS numbers(
  id TEXT PRIMARY KEY, label TEXT DEFAULT '', phone TEXT DEFAULT '', status TEXT DEFAULT 'new',
  created_at TEXT DEFAULT (datetime('now')), last_seen TEXT DEFAULT '', note TEXT DEFAULT ''
);
CREATE TABLE IF NOT EXISTS contacts(
  session TEXT DEFAULT 'main', jid TEXT, name TEXT DEFAULT '', notify TEXT DEFAULT '',
  updated_at TEXT DEFAULT (datetime('now')), PRIMARY KEY(session, jid)
);
CREATE TABLE IF NOT EXISTS jid_map(
  session TEXT DEFAULT 'main', lid TEXT, pn TEXT DEFAULT '', updated_at TEXT DEFAULT (datetime('now')), PRIMARY KEY(session, lid)
);
CREATE TABLE IF NOT EXISTS watched(
  phone TEXT PRIMARY KEY, name TEXT DEFAULT '', paired_at TEXT DEFAULT (datetime('now')),
  status TEXT DEFAULT 'paired'
);
CREATE TABLE IF NOT EXISTS uptime(id INTEGER PRIMARY KEY AUTOINCREMENT, booted_at TEXT DEFAULT (datetime('now')), source TEXT);
CREATE TABLE IF NOT EXISTS recovered(id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT, chat_jid TEXT,
  sender TEXT, body TEXT, ts TEXT DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS ai_chat(id INTEGER PRIMARY KEY AUTOINCREMENT, role TEXT, content TEXT, ts TEXT DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS bulk_history(id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT DEFAULT (datetime('now')),
  total INTEGER, sent INTEGER, failed INTEGER, text TEXT);
CREATE TABLE IF NOT EXISTS email_history(id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT DEFAULT (datetime('now')),
  account TEXT, to_addr TEXT, subject TEXT, ok INTEGER, error TEXT);
CREATE TABLE IF NOT EXISTS email_queue(id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT,
  account_id TEXT, to_list TEXT, subject TEXT, body TEXT, status TEXT DEFAULT 'pending', error TEXT, sent_at TEXT);
`;

/* v6.1 migrations — existing databases gain the new source columns silently */
const MIGRATIONS = [
  "ALTER TABLE sources ADD COLUMN targets TEXT DEFAULT ''",
  "ALTER TABLE sources ADD COLUMN last_post_at TEXT DEFAULT ''",
  "ALTER TABLE inbox_msgs ADD COLUMN sender_jid TEXT DEFAULT ''",   // v7.3.6: group-sender avatars
  /* 5A (v7.7.0) — power build: all idempotent, backward compatible, no drops */
  "ALTER TABLE posts ADD COLUMN via TEXT DEFAULT ''",               // R40: merged cross-source credit
  "ALTER TABLE posts ADD COLUMN pub_ms INTEGER",                    // R46: source→publish latency
  "ALTER TABLE posts ADD COLUMN dismissed INTEGER DEFAULT 0",       // R47: owner dismissed a failed post
  "ALTER TABLE posts ADD COLUMN part INTEGER DEFAULT 0",            // R41: split-part index (0 = unsplit)
  "ALTER TABLE posts ADD COLUMN queued_at TEXT DEFAULT ''",         // R37: entered the approval/hold queue
  /* 5B (v7.7.0) — full post text (the reason column only ever held 400-char notes) */
  "ALTER TABLE posts ADD COLUMN body TEXT DEFAULT ''",              // R53: copy / reuse / edit-republish
  /* 5C (v7.7.0) */
  "ALTER TABLE inbox_msgs ADD COLUMN voice_text TEXT DEFAULT ''",   // R58: transcription of voice messages
  /* 5D (v7.8.0) */
  "ALTER TABLE posts ADD COLUMN has_media INTEGER DEFAULT 0"        // R61: media-vs-text analytics
];

/* 5A tables — created statement-by-statement by execSafe (one failure never blocks the rest) */
const SCHEMA_5A = `
CREATE TABLE IF NOT EXISTS approvals(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_jid TEXT, source_msg_id TEXT, text TEXT, media_kind TEXT DEFAULT '',
  media_path TEXT DEFAULT '', status TEXT DEFAULT 'pending',   -- pending|approved|rejected|published|failed
  hold_until TEXT DEFAULT '', msg_ts INTEGER DEFAULT 0, targets TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now')), decided_at TEXT DEFAULT '', note TEXT DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_approvals_status ON approvals(status, created_at);
CREATE TABLE IF NOT EXISTS source_rules(
  source_jid TEXT PRIMARY KEY,
  approve_first INTEGER DEFAULT 0,     -- R37: this source waits in the Approval Queue
  active_from TEXT DEFAULT '',         -- R38: 'HH:MM' PKT — active hours window start (empty = always)
  active_to TEXT DEFAULT '',           -- R38: 'HH:MM' PKT — window end (wraps midnight when from > to)
  max_per_day INTEGER DEFAULT 0,       -- R38: 0 = unlimited
  include TEXT DEFAULT '',             -- R38: comma words — only post when one matches
  exclude TEXT DEFAULT '',             -- R38: comma words — never post when one matches
  auto_pause INTEGER DEFAULT 0,        -- R38: pause the source when its daily cap is hit
  priority INTEGER DEFAULT 3           -- R38: 1–5, backlog recovery order (5 = first)
);
CREATE TABLE IF NOT EXISTS routing_cells(
  source_jid TEXT, target_jid TEXT, enabled INTEGER,
  PRIMARY KEY(source_jid, target_jid)
);
CREATE TABLE IF NOT EXISTS audit(
  id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT DEFAULT (datetime('now')),
  actor TEXT DEFAULT 'owner', action TEXT, detail TEXT DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_audit_ts ON audit(ts);
`;

/* 5B (v7.7.0) — composer: snippets with {placeholders} + drafts */
const SCHEMA_5B = `
CREATE TABLE IF NOT EXISTS snippets(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT, body TEXT,
  created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS drafts(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT, text TEXT, image_path TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now'))
);
`;

/* 5C (v7.7.0) — AI features: usage meter (R54), prompt library (R55),
   glossary (R57), knowledge-base auto-reply (R59) */
const SCHEMA_5C = `
CREATE TABLE IF NOT EXISTS ai_usage(
  feature TEXT, provider TEXT, model TEXT,
  calls INTEGER DEFAULT 0, tokens INTEGER DEFAULT 0, ms INTEGER DEFAULT 0,
  last_at TEXT DEFAULT (datetime('now')),
  PRIMARY KEY(feature, provider, model)
);
CREATE TABLE IF NOT EXISTS prompts_lib(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT, body TEXT, builtin INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS glossary(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  from_term TEXT, to_term TEXT, note TEXT DEFAULT ''
);
CREATE TABLE IF NOT EXISTS reply_kb(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  q TEXT, a TEXT, enabled INTEGER DEFAULT 1
);
`;

/* 5D (R61–R68) — plain tables first (execSafe), FTS5 block runs as whole
   statements after, because trigger bodies contain their own semicolons
   and the statement splitter must never split inside a BEGIN…END. */
const SCHEMA_5D = `
CREATE TABLE IF NOT EXISTS goals(
  source_jid TEXT PRIMARY KEY,
  daily_n INTEGER NOT NULL DEFAULT 0,
  note TEXT DEFAULT ''
);
CREATE TABLE IF NOT EXISTS notifications(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT DEFAULT (datetime('now')),
  kind TEXT DEFAULT 'info', text TEXT, read INTEGER DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_notif_read ON notifications(read, id);
CREATE TABLE IF NOT EXISTS selftests(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT DEFAULT (datetime('now')),
  ok INTEGER DEFAULT 0, total INTEGER DEFAULT 0,
  detail TEXT DEFAULT ''
);
`;
/* 5F (R76–R78): chat labels, quick replies, scheduled WhatsApp sends,
   contact notes/tags/events, broadcast lists. All additive + idempotent (R3). */
const SCHEMA_5I = `
CREATE TABLE IF NOT EXISTS subs_snapshots(
  source_jid TEXT NOT NULL,
  day TEXT NOT NULL,              -- 'YYYY-MM-DD' (PKT day)
  count INTEGER NOT NULL,
  at TEXT DEFAULT (datetime('now')),
  PRIMARY KEY(source_jid, day)
);
`;
const SCHEMA_5H = `
CREATE TABLE IF NOT EXISTS evergreen_log(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id INTEGER NOT NULL, body TEXT DEFAULT '', targets INTEGER DEFAULT 0,
  recycled_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS autopilot_log(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT DEFAULT (datetime('now')),
  action TEXT NOT NULL, detail TEXT DEFAULT ''
);
`;
const SCHEMA_5G = `
CREATE TABLE IF NOT EXISTS webhooks(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL, url TEXT NOT NULL, events TEXT DEFAULT '',
  enabled INTEGER DEFAULT 1,
  last_status TEXT DEFAULT '', last_at TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS rss_seen(
  url TEXT NOT NULL, guid TEXT NOT NULL,
  seen_at TEXT DEFAULT (datetime('now')),
  PRIMARY KEY(url, guid)
);
`;
const SCHEMA_5F = `
CREATE TABLE IF NOT EXISTS chat_labels(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL, color TEXT DEFAULT '#10B981',
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS chat_label_map(
  session TEXT DEFAULT 'main', jid TEXT, label_id INTEGER NOT NULL,
  PRIMARY KEY(session, jid, label_id)
);
CREATE TABLE IF NOT EXISTS quick_replies(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  text TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS wa_scheduled(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session TEXT DEFAULT 'main', jid TEXT NOT NULL, text TEXT NOT NULL,
  at TEXT NOT NULL, repeat TEXT DEFAULT 'once', enabled INTEGER DEFAULT 1,
  sent INTEGER DEFAULT 0, last_sent TEXT DEFAULT '',
  weekdays TEXT DEFAULT '', interval_min INTEGER DEFAULT 0, tz TEXT DEFAULT 'Asia/Karachi',
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS contact_notes(
  session TEXT DEFAULT 'main', jid TEXT, note TEXT DEFAULT '',
  updated_at TEXT DEFAULT (datetime('now')), PRIMARY KEY(session, jid)
);
CREATE TABLE IF NOT EXISTS contact_tags(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS contact_tag_map(
  session TEXT DEFAULT 'main', jid TEXT, tag_id INTEGER NOT NULL,
  PRIMARY KEY(session, jid, tag_id)
);
CREATE TABLE IF NOT EXISTS contact_events(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session TEXT DEFAULT 'main', jid TEXT, kind TEXT DEFAULT 'note', note TEXT DEFAULT '',
  ts TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS broadcast_lists(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL, recipients TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now'))
);
/* 5F (R79): per-target publish ledger — powers the per-target rate caps */
CREATE TABLE IF NOT EXISTS target_publish_log(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  target_jid TEXT NOT NULL,
  ts TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_target_pub ON target_publish_log(target_jid, ts);
`;
const FTS_5D_STMTS = [
  `CREATE VIRTUAL TABLE IF NOT EXISTS posts_fts USING fts5(body, content='posts', content_rowid='id')`,
  `CREATE TRIGGER IF NOT EXISTS posts_fts_ai AFTER INSERT ON posts BEGIN
  INSERT INTO posts_fts(rowid, body) VALUES (new.id, new.body);
END`,
  `CREATE TRIGGER IF NOT EXISTS posts_fts_ad AFTER DELETE ON posts BEGIN
  INSERT INTO posts_fts(posts_fts, rowid, body) VALUES('delete', old.id, old.body);
END`,
  `CREATE TRIGGER IF NOT EXISTS posts_fts_au AFTER UPDATE OF body ON posts BEGIN
  INSERT INTO posts_fts(posts_fts, rowid, body) VALUES('delete', old.id, old.body);
  INSERT INTO posts_fts(rowid, body) VALUES (new.id, new.body);
END`,
  `CREATE VIRTUAL TABLE IF NOT EXISTS logs_fts USING fts5(msg, code, content='logs', content_rowid='rowid')`,
  `CREATE TRIGGER IF NOT EXISTS logs_fts_ai AFTER INSERT ON logs BEGIN
  INSERT INTO logs_fts(rowid, msg, code) VALUES (new.rowid, new.msg, new.code);
END`,
  `CREATE TRIGGER IF NOT EXISTS logs_fts_ad AFTER DELETE ON logs BEGIN
  INSERT INTO logs_fts(logs_fts, rowid, msg, code) VALUES('delete', old.rowid, old.msg, old.code);
END`,
  `CREATE VIRTUAL TABLE IF NOT EXISTS inbox_fts USING fts5(body, content='inbox_msgs', content_rowid='id')`,
  `CREATE TRIGGER IF NOT EXISTS inbox_fts_ai AFTER INSERT ON inbox_msgs BEGIN
  INSERT INTO inbox_fts(rowid, body) VALUES (new.id, new.body);
END`,
  `CREATE TRIGGER IF NOT EXISTS inbox_fts_ad AFTER DELETE ON inbox_msgs BEGIN
  INSERT INTO inbox_fts(inbox_fts, rowid, body) VALUES('delete', old.id, old.body);
END`,
  `CREATE TRIGGER IF NOT EXISTS inbox_fts_au AFTER UPDATE OF body ON inbox_msgs BEGIN
  INSERT INTO inbox_fts(inbox_fts, rowid, body) VALUES('delete', old.id, old.body);
  INSERT INTO inbox_fts(rowid, body) VALUES (new.id, new.body);
END`
];

/* ── v7 migrations: session-scope the old single-number inbox ─────── */
function cols(d, t) { try { return d.prepare(`PRAGMA table_info(${t})`).all().map((r) => r.name); } catch { return []; } }

function migrateV7(d) {
  // inbox_chats: jid PK → (session, jid) PK + archive/pin/mute flags
  const cc = cols(d, 'inbox_chats');
  if (cc.length && !cc.includes('session')) {
    d.exec(`CREATE TABLE IF NOT EXISTS inbox_chats_v7(
      session TEXT DEFAULT 'main', jid TEXT, name TEXT, last_at TEXT, last_text TEXT,
      unread INTEGER DEFAULT 0, archived INTEGER DEFAULT 0, pinned INTEGER DEFAULT 0, muted INTEGER DEFAULT 0,
      PRIMARY KEY(session, jid))`);
    d.exec(`INSERT OR IGNORE INTO inbox_chats_v7(session,jid,name,last_at,last_text,unread)
      SELECT 'main', jid, name, last_at, last_text, unread FROM inbox_chats`);
    d.exec('DROP TABLE inbox_chats');
    d.exec('ALTER TABLE inbox_chats_v7 RENAME TO inbox_chats');
    ring.info('db.migrate', 'Inbox chats migrated to multi-number schema (your old chat list is safe — session "main")');
  }
  // inbox_msgs: add the v7 columns one by one (ALTER ADD COLUMN is safe + instant)
  const mc = cols(d, 'inbox_msgs');
  const add = [
    ["session", "ALTER TABLE inbox_msgs ADD COLUMN session TEXT DEFAULT 'main'"],
    ["msg_id", "ALTER TABLE inbox_msgs ADD COLUMN msg_id TEXT DEFAULT ''"],
    ["kind", "ALTER TABLE inbox_msgs ADD COLUMN kind TEXT DEFAULT ''"],
    ["deleted", 'ALTER TABLE inbox_msgs ADD COLUMN deleted INTEGER DEFAULT 0'],
    ["edited", 'ALTER TABLE inbox_msgs ADD COLUMN edited INTEGER DEFAULT 0'],
    ["orig_body", "ALTER TABLE inbox_msgs ADD COLUMN orig_body TEXT DEFAULT ''"],
    ["media_mime", "ALTER TABLE inbox_msgs ADD COLUMN media_mime TEXT DEFAULT ''"],
    ["media_name", "ALTER TABLE inbox_msgs ADD COLUMN media_name TEXT DEFAULT ''"],
    ['media_data', 'ALTER TABLE inbox_msgs ADD COLUMN media_data BLOB'],
    /* v9.0.0 (repo-slim): full photos / view-once files live on DISK (media/inbox/),
       not as BLOBs — the DB is what cloud memory ships to GitHub, so it must stay small.
       media_data stays for rows stored before this build (old zips still restore fine). */
    ["media_file", "ALTER TABLE inbox_msgs ADD COLUMN media_file TEXT DEFAULT ''"],
    /* v9.0.0 (owner policy): set when a post's media was DELETED AFTER PUBLISHING —
       late captures (async photo download) must not recreate deleted media */
    ["media_cleared", "ALTER TABLE inbox_msgs ADD COLUMN media_cleared INTEGER DEFAULT 0"]
  ];
  for (const [name, sql] of add) { if (!mc.includes(name)) { try { d.exec(sql); } catch { /* exists */ } } }
  try { d.exec('CREATE INDEX IF NOT EXISTS idx_inbox_mid ON inbox_msgs(session, chat_jid, msg_id)'); } catch { }
  try { d.exec('CREATE INDEX IF NOT EXISTS idx_inbox_ts ON inbox_msgs(session, ts)'); } catch { }
  // one row per WhatsApp message id → history import and live archiving never double-store
  try { d.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_inbox_mid_uniq ON inbox_msgs(session, chat_jid, msg_id) WHERE msg_id != ''"); } catch { }
}

/* indexes that reference v7 columns — created AFTER the migration, never before
   (on an old database those columns don't exist yet and one bad statement would
   abort the whole schema exec — the v7.0.0 migration bug this guards against) */
const POST_INDEXES = [
  'CREATE INDEX IF NOT EXISTS idx_inbox_chat ON inbox_msgs(session, chat_jid, id)',
  'CREATE INDEX IF NOT EXISTS idx_inbox_mid ON inbox_msgs(session, chat_jid, msg_id)',
  'CREATE INDEX IF NOT EXISTS idx_inbox_ts ON inbox_msgs(session, ts)',
  "CREATE UNIQUE INDEX IF NOT EXISTS idx_inbox_mid_uniq ON inbox_msgs(session, chat_jid, msg_id) WHERE msg_id != ''"
,
  'CREATE INDEX IF NOT EXISTS idx_jidmap_pn ON jid_map(session, pn)'];

/** run a multi-statement schema string statement-by-statement so ONE failure
 *  (e.g. an index on a column an older database doesn't have yet) can never
 *  block the rest of the boot */
function execSafe(d, sql) {
  for (const stmt of String(sql).split(/;\s*\n/)) {
    const one = stmt.trim();
    if (!one) continue;
    try { d.exec(`${one};`); } catch { }
  }
}

function open() {
  if (db) return db;
  db = new Database(cfg.config.paths.database);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('busy_timeout = 5000');
  execSafe(db, SCHEMA);
  execSafe(db, SCHEMA_5A);
  execSafe(db, SCHEMA_5B);
  execSafe(db, SCHEMA_5C);
  execSafe(db, SCHEMA_5D);
  execSafe(db, SCHEMA_5I);
  execSafe(db, SCHEMA_5H);
  execSafe(db, SCHEMA_5G);
  execSafe(db, SCHEMA_5F);
  /* 5G (R82): RSS/Atom source type on the sources table (additive, defaults keep WA behavior) */
  try { db.exec("ALTER TABLE sources ADD COLUMN kind TEXT DEFAULT 'wa'"); } catch { /* already added */ }
  try { db.exec("ALTER TABLE sources ADD COLUMN url TEXT DEFAULT ''"); } catch { /* already added */ }
  /* 5F (R78): link bulk-send history rows to the saved list that fired them (additive) */
  try { db.exec("ALTER TABLE bulk_history ADD COLUMN list_id INTEGER DEFAULT 0"); } catch { /* already added */ }
  try { db.exec("ALTER TABLE bulk_history ADD COLUMN list_name TEXT DEFAULT ''"); } catch { /* already added */ }
  /* 5F (R76): repeat detail for scheduled WhatsApp sends (additive) */
  try { db.exec("ALTER TABLE wa_scheduled ADD COLUMN weekdays TEXT DEFAULT ''"); } catch { /* already added */ }
  try { db.exec("ALTER TABLE wa_scheduled ADD COLUMN interval_min INTEGER DEFAULT 0"); } catch { /* already added */ }
  try { db.exec("ALTER TABLE wa_scheduled ADD COLUMN tz TEXT DEFAULT 'Asia/Karachi'"); } catch { /* already added */ }
  for (const sql of MIGRATIONS) { try { db.exec(sql); } catch { /* column already exists */ } }
  try { migrateV7(db); } catch (err) { try { ring.error('db.migrate.fail', `DB migration failed: ${err.message}`); } catch { } }
  for (const sql of POST_INDEXES) { try { db.exec(sql); } catch { } }
  /* 5D (R67): FTS5 indexes — whole statements (trigger bodies hold semicolons),
     then a one-time rebuild so rows written before 5D are searchable too */
  for (const sql of FTS_5D_STMTS) {
    try { db.exec(sql); } catch (e) { try { ring.warn('db.fts', `FTS5 statement skipped: ${String(e.message).slice(0, 120)}`); } catch { } }
  }
  for (const [vt, src] of [['posts_fts', 'posts'], ['logs_fts', 'logs'], ['inbox_fts', 'inbox_msgs']]) {
    try {
      const n = db.prepare(`SELECT COUNT(*) c FROM ${vt}`).get().c;
      const s = db.prepare(`SELECT COUNT(*) c FROM ${src}`).get().c;
      if (n === 0 && s > 0) db.prepare(`INSERT INTO ${vt}(${vt}) VALUES('rebuild')`).run();
    } catch { /* FTS5 unavailable in this build — search falls back to LIKE */ }
  }
  ring.db = db;
  return db;
}

/* v7.6.0: keep the cloud state small. Two tables grow without bound — the
   activity log and the WhatsApp-Web chat archive — and every cloud save zips
   the whole DB (that is what made the state 20 MB and the repo 2 GB). Capping
   them here, on every boot, keeps restore fast and memory-safe. Nothing else
   is ever touched (settings, sources, targets, posts, journal stay intact). */
function pruneForMemory() {
  const d = open();
  try {
    const before = {
      logs: d.prepare('SELECT COUNT(*) c FROM logs').get().c,
      inbox: d.prepare('SELECT COUNT(*) c FROM inbox_msgs').get().c,
    };
    d.prepare('DELETE FROM logs WHERE rowid NOT IN (SELECT rowid FROM logs ORDER BY ts DESC LIMIT 6000)').run();
    d.prepare('DELETE FROM inbox_msgs WHERE rowid NOT IN (SELECT rowid FROM inbox_msgs ORDER BY ts DESC LIMIT 4000)').run();
    try { d.pragma('wal_checkpoint(TRUNCATE)'); } catch { }
    const after = { logs: d.prepare('SELECT COUNT(*) c FROM logs').get().c, inbox: d.prepare('SELECT COUNT(*) c FROM inbox_msgs').get().c };
    if (before.logs !== after.logs || before.inbox !== after.inbox) {
      ring.info('db.prune', `State trimmed to stay small: logs ${before.logs}→${after.logs}, chat archive ${before.inbox}→${after.inbox} (older entries are history only — posts and settings untouched)`);
    }
  } catch (e) {
    try { ring.warn('db.prune.fail', String(e?.message || e)); } catch { }
  }
}

/* ---- settings KV ---- */
const S = {
  get: (k, f = '') => { try { const r = open().prepare('SELECT value FROM settings WHERE key=?').get(k); return r ? r.value : f; } catch { return f; } },
  set: (k, v) => { try { open().prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(k, String(v)); } catch { } try { if (typeof S.onChange === 'function') S.onChange(k); } catch { } },
  onChange: null,   /* v7.3.3: wired in index.js — every settings write queues a cloud save */
  getBool: (k, f = false) => { const v = String(S.get(k, f ? '1' : '0')).toLowerCase(); return v === '1' || v === 'true'; }
};

/* ---- channels ---- */
const CH = {
  listSources: () => open().prepare('SELECT * FROM sources ORDER BY name COLLATE NOCASE').all(),
  listActiveSources: () => open().prepare('SELECT * FROM sources WHERE paused=0 ORDER BY name COLLATE NOCASE').all(),
  lastSourceActivity: () => { try { const r = open().prepare('SELECT MAX(last_post_at) t FROM sources').get(); return String(r?.t || ''); } catch { return ''; } },
  listTargets: () => open().prepare('SELECT * FROM targets ORDER BY name COLLATE NOCASE').all(),
  listActiveTargets: () => open().prepare('SELECT * FROM targets WHERE paused=0 ORDER BY name COLLATE NOCASE').all(),
  addSource: (jid, name, by) => { try { open().prepare('INSERT INTO sources(jid,name,added_by) VALUES(?,?,?)').run(jid, name || jid, by || ''); return { ok: true }; } catch { return { ok: false, existed: true }; } },
  addTarget: (jid, name, by) => { try { open().prepare('INSERT INTO targets(jid,name,added_by) VALUES(?,?,?)').run(jid, name || jid, by || ''); return { ok: true }; } catch { return { ok: false, existed: true }; } },
  pauseSource: (jid, p) => open().prepare('UPDATE sources SET paused=? WHERE jid=?').run(p ? 1 : 0, jid),
  pauseTarget: (jid, p) => open().prepare('UPDATE targets SET paused=? WHERE jid=?').run(p ? 1 : 0, jid),
  removeSource: (jid) => open().prepare('DELETE FROM sources WHERE jid=?').run(jid),
  removeTarget: (jid) => open().prepare('DELETE FROM targets WHERE jid=?').run(jid),
  recordDir: (jid, name, role) => { try { open().prepare("INSERT INTO directory(jid,name,role) VALUES(?,?,?) ON CONFLICT(jid) DO UPDATE SET name=excluded.name, role=COALESCE(excluded.role, role), seen_at=datetime('now')").run(jid, name || '', role || null); } catch { } },
  forgetDir: (jid) => { try { open().prepare('DELETE FROM directory WHERE jid=?').run(jid); } catch { } },
  dirRole: (jid) => { try { const r = open().prepare('SELECT role FROM directory WHERE jid=?').get(jid); return r ? (r.role || '') : ''; } catch { return ''; } },
  renameChannel: (jid, name) => { if (!name) return; try { open().prepare('UPDATE sources SET name=? WHERE jid=?').run(name, jid); open().prepare('UPDATE targets SET name=? WHERE jid=?').run(name, jid); } catch { } },
  dirList: () => open().prepare('SELECT * FROM directory ORDER BY name COLLATE NOCASE').all(),
  setSourceTargets: (jid, csv) => open().prepare('UPDATE sources SET targets=? WHERE jid=?').run(String(csv || '').replace(/[^0-9a-z@.,_-]/gi, '').slice(0, 2000), jid),
  setLastPost: (jid) => { try { open().prepare("UPDATE sources SET last_post_at=datetime('now') WHERE jid=?").run(jid); } catch { } },
  publishedLastHour: () => { try { return open().prepare("SELECT COUNT(*) n FROM posts WHERE status='published' AND created_at >= datetime('now','-1 hour')").get().n; } catch { return 0; } },
  pubCountLastHour: (targetJid) => { try { return open().prepare("SELECT COUNT(*) n FROM target_publish_log WHERE target_jid=? AND ts >= datetime('now','-1 hour')").get(String(targetJid || '')).n; } catch { return 0; } },
  recordPub: (targetJid) => { try { open().prepare('INSERT INTO target_publish_log(target_jid) VALUES(?)').run(String(targetJid || '')); } catch { } }
};

/* ---- AI chat + bulk history (v6.1) ---- */
const AICHAT = {
  add: (role, content) => { try { open().prepare('INSERT INTO ai_chat(role,content) VALUES(?,?)').run(String(role).slice(0, 12), String(content || '').slice(0, 4000)); } catch { } },
  history: (limit = 30) => open().prepare('SELECT * FROM ai_chat ORDER BY id DESC LIMIT ?').all(limit).reverse(),
  clear: () => open().prepare('DELETE FROM ai_chat').run()
};
const BULKH = {
  record: (total, sent, failed, text, listId = 0, listName = '') => {
    try { open().prepare('INSERT INTO bulk_history(total,sent,failed,text,list_id,list_name) VALUES(?,?,?,?,?,?)').run(total, sent, failed, String(text || '').slice(0, 300), Number(listId) || 0, String(listName || '').slice(0, 120)); }
    catch { try { open().prepare('INSERT INTO bulk_history(total,sent,failed,text) VALUES(?,?,?,?)').run(total, sent, failed, String(text || '').slice(0, 300)); } catch { } }
  },
  list: (limit = 20) => open().prepare('SELECT * FROM bulk_history ORDER BY id DESC LIMIT ?').all(limit)
};

/* ---- 5I (I1): subscriber snapshots (best-effort, daily, per source) ---- */
const pktDay = () => new Date(Date.now() + 5 * 3600e3).toISOString().slice(0, 10); // PKT (UTC+5) day
const SUBS = {
  upsertDay: (jid, day, count) => { try { open().prepare(`INSERT INTO subs_snapshots(source_jid,day,count) VALUES(?,?,?)
    ON CONFLICT(source_jid,day) DO UPDATE SET count=excluded.count, at=datetime('now')`).run(String(jid), String(day), Number(count) | 0); } catch { } },
  todayFor: (jid) => open().prepare('SELECT count FROM subs_snapshots WHERE source_jid=? AND day=?').get(String(jid), pktDay()) || null,
  history: (jid, days = 14) => open().prepare('SELECT day, count FROM subs_snapshots WHERE source_jid=? AND day >= date(\'now\', ?) ORDER BY day ASC').all(String(jid), '-' + Math.max(2, Number(days) || 14) + ' days'),
  lastFor: (jid) => open().prepare('SELECT day, count FROM subs_snapshots WHERE source_jid=? ORDER BY day DESC LIMIT 1').get(String(jid)) || null,
  dayKey: pktDay
};

/* ---- 5H (R86/R87): evergreen recycling + auto-pilot logs ---- */
const EGR = {
  log: (postId, body, targets) => { try { open().prepare('INSERT INTO evergreen_log(post_id,body,targets) VALUES(?,?,?)').run(Number(postId) || 0, String(body || '').slice(0, 4096), Number(targets) || 0); } catch { } },
  list: (limit = 10) => open().prepare('SELECT * FROM evergreen_log ORDER BY id DESC LIMIT ?').all(limit),
  lastFor: (postId, withinDays) => open().prepare('SELECT id FROM evergreen_log WHERE post_id=? AND recycled_at >= datetime(\'now\', ?)').get(Number(postId) || 0, '-' + Math.max(1, Number(withinDays) || 21) + ' days')
};
const AP = {
  log: (action, detail) => { try { open().prepare('INSERT INTO autopilot_log(action,detail) VALUES(?,?)').run(String(action || '').slice(0, 40), String(detail || '').slice(0, 300)); } catch { } },
  list: (limit = 10) => open().prepare('SELECT * FROM autopilot_log ORDER BY id DESC LIMIT ?').all(limit),
  todayCount: () => (open().prepare("SELECT COUNT(*) c FROM autopilot_log WHERE action != 'pass' AND at >= date('now')").get().c || 0)
};

/* ---- 5F (R76): chat labels ---- */
const CL = {
  list: () => open().prepare('SELECT * FROM chat_labels ORDER BY name COLLATE NOCASE').all(),
  add: (name, color) => { try { const r = open().prepare('INSERT INTO chat_labels(name,color) VALUES(?,?)').run(String(name || '').trim().slice(0, 60), String(color || '#10B981').slice(0, 12)); return r.lastInsertRowid; } catch { return null; } },
  rename: (id, name, color) => { try { open().prepare('UPDATE chat_labels SET name=?, color=? WHERE id=?').run(String(name || '').trim().slice(0, 60), String(color || '#10B981').slice(0, 12), Number(id)); } catch { } },
  del: (id) => { try { open().prepare('DELETE FROM chat_label_map WHERE label_id=?').run(Number(id)); open().prepare('DELETE FROM chat_labels WHERE id=?').run(Number(id)); } catch { } },
  forChat: (session, jid) => open().prepare('SELECT l.id, l.name, l.color FROM chat_labels l JOIN chat_label_map m ON m.label_id=l.id WHERE m.session=? AND m.jid=? ORDER BY l.name COLLATE NOCASE').all(String(session || 'main'), String(jid || '')),
  setForChat: (session, jid, labelId, on) => {
    try {
      if (on) open().prepare('INSERT OR IGNORE INTO chat_label_map(session,jid,label_id) VALUES(?,?,?)').run(String(session || 'main'), String(jid), Number(labelId));
      else open().prepare('DELETE FROM chat_label_map WHERE session=? AND jid=? AND label_id=?').run(String(session || 'main'), String(jid), Number(labelId));
    } catch { }
  },
  counts: () => { const m = {}; for (const r of open().prepare('SELECT m.label_id, COUNT(*) n FROM chat_label_map m GROUP BY m.label_id').all()) m[r.label_id] = r.n; return m; }
};

/* ---- 5F (R76): quick replies ---- */
const QR = {
  list: () => open().prepare('SELECT * FROM quick_replies ORDER BY id DESC').all().map((r) => ({ id: r.id, text: r.text.slice(0, 500) })),
  add: (text) => { if (!String(text || '').trim()) return null; try { const r = open().prepare('INSERT INTO quick_replies(text) VALUES(?)').run(String(text || '').trim().slice(0, 500)); return r.lastInsertRowid; } catch { return null; } },
  del: (id) => { try { open().prepare('DELETE FROM quick_replies WHERE id=?').run(Number(id)); } catch { } }
};

/* ---- 5F (R76): scheduled WhatsApp sends ---- */
const WAS = {
  list: (session) => open().prepare('SELECT * FROM wa_scheduled WHERE session=? ORDER BY at ASC, id ASC').all(String(session || 'main')),
  get: (id) => open().prepare('SELECT * FROM wa_scheduled WHERE id=?').get(Number(id)) || null,
  add: (o) => { try { const r = open().prepare('INSERT INTO wa_scheduled(session,jid,text,at,repeat,enabled,weekdays,interval_min,tz) VALUES(?,?,?,?,?,?,?,?,?)').run(String(o.session || 'main'), String(o.jid || ''), String(o.text || '').slice(0, 4096), String(o.at || ''), String(o.repeat || 'once'), o.enabled === false ? 0 : 1, String(o.weekdays || '').slice(0, 20), Number(o.interval_min) || 0, String(o.tz || 'Asia/Karachi').slice(0, 40)); return r.lastInsertRowid; } catch { return null; } },
  setEnabled: (id, on) => { try { open().prepare('UPDATE wa_scheduled SET enabled=? WHERE id=?').run(on ? 1 : 0, Number(id)); } catch { } },
  markSent: (id, at) => { try { open().prepare("UPDATE wa_scheduled SET sent=sent+1, last_sent=? WHERE id=?").run(String(at || new Date().toISOString()), Number(id)); } catch { } },
  del: (id) => { try { open().prepare('DELETE FROM wa_scheduled WHERE id=?').run(Number(id)); } catch { } },
  due: (nowMs, session) => {
    const cutoff = new Date(nowMs).toISOString();
    const rows = open().prepare('SELECT * FROM wa_scheduled WHERE session=? AND enabled=1 AND at <= ? ORDER BY at ASC').all(String(session || 'main'), cutoff);
    return rows;
  }
};

/* ---- 5F (R77): contact notes + tags + events ---- */
const CN = {
  get: (session, jid) => { try { const r = open().prepare('SELECT note, updated_at FROM contact_notes WHERE session=? AND jid=?').get(String(session || 'main'), String(jid || '')); return r ? { note: r.note, updated_at: r.updated_at } : { note: '', updated_at: '' }; } catch { return { note: '', updated_at: '' }; } },
  set: (session, jid, note) => { try { open().prepare(`INSERT INTO contact_notes(session,jid,note,updated_at) VALUES(?,?,?,datetime('now')) ON CONFLICT(session,jid) DO UPDATE SET note=excluded.note, updated_at=datetime('now')`).run(String(session || 'main'), String(jid), String(note || '').slice(0, 2000)); } catch { } },
  tags: () => open().prepare('SELECT * FROM contact_tags ORDER BY name COLLATE NOCASE').all(),
  addTag: (name) => { try { const r = open().prepare('INSERT OR IGNORE INTO contact_tags(name) VALUES(?)').run(String(name || '').trim().slice(0, 40)); if (r.changes === 0) { const ex = open().prepare('SELECT id FROM contact_tags WHERE name=?').get(String(name).trim().slice(0, 40)); return ex ? ex.id : null; } return r.lastInsertRowid; } catch { return null; } },
  delTag: (id) => { try { open().prepare('DELETE FROM contact_tag_map WHERE tag_id=?').run(Number(id)); open().prepare('DELETE FROM contact_tags WHERE id=?').run(Number(id)); } catch { } },
  forContact: (session, jid) => open().prepare('SELECT t.id, t.name FROM contact_tags t JOIN contact_tag_map m ON m.tag_id=t.id WHERE m.session=? AND m.jid=? ORDER BY t.name COLLATE NOCASE').all(String(session || 'main'), String(jid || '')),
  setForContact: (session, jid, tagId, on) => {
    try {
      if (on) open().prepare('INSERT OR IGNORE INTO contact_tag_map(session,jid,tag_id) VALUES(?,?,?)').run(String(session || 'main'), String(jid), Number(tagId));
      else open().prepare('DELETE FROM contact_tag_map WHERE session=? AND jid=? AND tag_id=?').run(String(session || 'main'), String(jid), Number(tagId));
    } catch { }
  },
  event: (session, jid, kind, note) => { try { open().prepare('INSERT INTO contact_events(session,jid,kind,note) VALUES(?,?,?,?)').run(String(session || 'main'), String(jid), String(kind || 'note'), String(note || '').slice(0, 300)); } catch { } },
  timeline: (session, jid, limit = 50) => {
    try {
      const evs = open().prepare('SELECT kind, note, ts FROM contact_events WHERE session=? AND jid=? ORDER BY id DESC LIMIT ?').all(String(session || 'main'), String(jid), Number(limit) || 50).map((e) => ({ kind: e.kind, text: e.note, ts: e.ts }));
      const msgs = open().prepare('SELECT from_me, body, ts FROM inbox_msgs WHERE session=? AND chat_jid=? AND deleted=0 ORDER BY id DESC LIMIT ?').all(String(session || 'main'), String(jid), Number(limit) || 50).map((m) => ({ kind: m.from_me ? 'sent' : 'received', text: String(m.body || '').slice(0, 200), ts: m.ts }));
      return [...evs, ...msgs].sort((a, b) => (String(b.ts) < String(a.ts) ? -1 : 1)).slice(0, Number(limit) || 50);
    } catch { return []; }
  }
};

/* ---- 5F (R78): broadcast lists ---- */
const BCL = {
  list: () => open().prepare('SELECT * FROM broadcast_lists ORDER BY name COLLATE NOCASE').all(),
  get: (id) => open().prepare('SELECT * FROM broadcast_lists WHERE id=?').get(Number(id)) || null,
  add: (name, recipients) => { try { const r = open().prepare('INSERT INTO broadcast_lists(name,recipients) VALUES(?,?)').run(String(name || '').trim().slice(0, 80), String(recipients || '').slice(0, 50000)); return r.lastInsertRowid; } catch { return null; } },
  update: (id, name, recipients) => { try { open().prepare("UPDATE broadcast_lists SET name=?, recipients=?, updated_at=datetime('now') WHERE id=?").run(String(name || '').trim().slice(0, 80), String(recipients || '').slice(0, 50000), Number(id)); } catch { } },
  del: (id) => { try { open().prepare('DELETE FROM broadcast_lists WHERE id=?').run(Number(id)); } catch { } },
  countRecipients: (recipients) => String(recipients || '').split(/[\n;]+/).map((l) => l.trim()).filter(Boolean).length
};

/* ---- posts ---- */
const P = {
  seen: (jid, mid) => Boolean(open().prepare('SELECT 1 FROM posts WHERE source_jid=? AND source_msg_id=?').get(jid, mid)),
  mark: (jid, mid, status, reason, body, hasMedia) => { try { open().prepare('INSERT OR IGNORE INTO posts(source_jid,source_msg_id,status,reason,body,has_media) VALUES(?,?,?,?,?,?)').run(jid, mid, status, reason || '', body || '', hasMedia ? 1 : 0); } catch { } },
  keys: (postId) => open().prepare('SELECT target_jid, msg_id FROM post_keys WHERE post_id=?').all(postId),
  addKey: (postId, targetJid, msgId) => open().prepare('INSERT INTO post_keys(post_id,target_jid,msg_id) VALUES(?,?,?)').run(postId, targetJid, msgId),
  postId: (jid, mid) => { const r = open().prepare('SELECT id FROM posts WHERE source_jid=? AND source_msg_id=?').get(jid, mid); return r ? r.id : null; },
  /* 5B: optional 4th arg stores the full text (reason stays a short note) */
  setStatus: (postId, status, reason, body) => body !== undefined
    ? open().prepare('UPDATE posts SET status=?, reason=?, body=? WHERE id=?').run(status, reason || '', body || '', postId)
    : open().prepare('UPDATE posts SET status=?, reason=? WHERE id=?').run(status, reason || '', postId),
  /* 5D (R61): media flag — set on every publish pass (mark's INSERT OR IGNORE
     must not clobber it, and retry paths re-mark rows that already exist) */
  setMedia: (postId, hasMedia) => { try { open().prepare('UPDATE posts SET has_media=? WHERE id=?').run(hasMedia ? 1 : 0, postId); } catch { } }
};

/* ---- analytics helpers (v6 power feature) ---- */
const A = {
  day: (day) => open().prepare(`SELECT status, COUNT(*) n FROM posts WHERE created_at LIKE ?||'%' GROUP BY status`).all(day),
  since: (from) => open().prepare(`SELECT status, COUNT(*) n FROM posts WHERE created_at >= ? GROUP BY status`).all(from),
  perSource: (from) => open().prepare(`SELECT source_jid, COUNT(*) n FROM posts WHERE created_at >= ? AND status='published' GROUP BY source_jid ORDER BY n DESC LIMIT 20`).all(from),
  recent: (n = 50) => open().prepare('SELECT * FROM posts ORDER BY id DESC LIMIT ?').all(n),
  /* 5D (R61) — analytics v2 primitives */
  perSourceFull: (from) => open().prepare(`
    SELECT source_jid,
      SUM(status='published') pub, SUM(status='edited') edited, SUM(status='failed') failed,
      SUM(status IN ('published','edited') AND has_media=1) media
    FROM posts WHERE created_at >= ? GROUP BY source_jid ORDER BY pub DESC LIMIT 50`).all(from),
  perTarget: (from) => open().prepare(`
    SELECT k.target_jid,
      SUM(p.status='published') pub, SUM(p.status='edited') edited, SUM(p.status='failed') failed
    FROM post_keys k JOIN posts p ON p.id = k.post_id
    WHERE p.created_at >= ? GROUP BY k.target_jid ORDER BY pub DESC LIMIT 50`).all(from),
  skipReasons: (from) => open().prepare(`
    SELECT reason, COUNT(*) n FROM posts WHERE created_at >= ? AND status='skipped' GROUP BY reason ORDER BY n DESC LIMIT 50`).all(from),
  mediaSplit: (from) => {
    const r = open().prepare(`SELECT SUM(has_media=1) m, SUM(has_media=0) t FROM posts WHERE created_at >= ? AND status IN ('published','edited')`).get(from);
    return { withMedia: r.m || 0, text: r.t || 0 };
  },
  /* R61 heatmap: PKT-day × PKT-hour buckets. SQLite stores created_at as
     UTC 'YYYY-MM-DD HH:MM:SS'; PKT = UTC+5, so both the day and the hour
     come from created_at + 300 minutes (a 23:30 UTC post is 04:30 PKT the
     NEXT day — the day label must move with it). */
  hourBuckets: (from) => open().prepare(`
    SELECT substr(datetime(created_at, '+300 minutes'),1,10) day,
      CAST(strftime('%H', created_at, '+300 minutes') AS INTEGER) hr,
      COUNT(*) n
    FROM posts WHERE created_at >= ? AND status IN ('published','edited','skipped','failed')
    GROUP BY day, hr`).all(from),
  /* R62 leaderboard: published+edited per source per PKT day (7-day sparklines) */
  sourceDays: (from) => open().prepare(`
    SELECT source_jid, substr(datetime(created_at, '+300 minutes'),1,10) day, COUNT(*) n
    FROM posts WHERE created_at >= ? AND status IN ('published','edited')
    GROUP BY source_jid, day`).all(from),
  rows: (from, limit = 5000) => open().prepare(`
    SELECT p.id, p.source_jid, p.status, p.reason, p.body, p.has_media, p.created_at, p.part, p.via,
      COALESCE((SELECT GROUP_CONCAT(k.target_jid, ' | ' ORDER BY k.target_jid) FROM post_keys k WHERE k.post_id = p.id), '') targets
    FROM posts p WHERE p.created_at >= ? ORDER BY p.id DESC LIMIT ?`).all(from, limit)
};

/* 5D (R67) — FTS5 full-text with a LIKE fallback so a build without FTS5
   still searches (slower, coarser — the UI says which engine answered). */
const F = {
  fts5: () => { try { return !!open().prepare("SELECT count(*) FROM pragma_compile_options() WHERE name LIKE 'FTS%'").all().length; } catch { return false; } },
  q: (q) => String(q || '').trim().slice(0, 120),
  posts(q, limit = 12) {
    const s = F.q(q); if (!s) return { list: [], engine: 'none' };
    const d = open();
    try {
      const safe = s.replace(/["']/g, ' ').split(/\s+/).filter(Boolean).map((w) => `"${w}"`).join(' AND ');
      const list = d.prepare(`
        SELECT p.id, p.source_jid, p.status, p.created_at,
           substr(p.body, 1, 140) snippet
        FROM posts_fts f JOIN posts p ON p.id = f.rowid
        WHERE posts_fts MATCH ?
        ORDER BY bm25(posts_fts) LIMIT ?`).all(safe, limit).map((r) => ({ ...r, title: r.snippet }));
      return { list, engine: 'fts5' };
    } catch {
      const like = `%${s.replace(/[%_]/g, '')}%`;
      const list = d.prepare(`
        SELECT id, source_jid, status, created_at, substr(body, 1, 140) snippet
        FROM posts WHERE body LIKE ? ORDER BY id DESC LIMIT ?`).all(like, limit).map((r) => ({ ...r, title: r.snippet }));
      return { list, engine: 'like' };
    }
  },
  logs(q, limit = 12) {
    const s = F.q(q); if (!s) return { list: [], engine: 'none' };
    const d = open();
    try {
      const safe = s.replace(/["']/g, ' ').split(/\s+/).filter(Boolean).map((w) => `"${w}"`).join(' AND ');
      const list = d.prepare(`
        SELECT l.ts, l.level, l.code, l.msg, substr(l.msg, 1, 140) snippet
        FROM logs_fts f JOIN logs l ON l.rowid = f.rowid
        WHERE logs_fts MATCH ? ORDER BY l.ts DESC LIMIT ?`).all(safe, limit);
      return { list, engine: 'fts5' };
    } catch {
      const like = `%${s.replace(/[%_]/g, '')}%`;
      const list = d.prepare(`SELECT ts, level, code, msg, substr(msg,1,140) snippet FROM logs WHERE msg LIKE ? ORDER BY ts DESC LIMIT ?`).all(like, limit);
      return { list, engine: 'like' };
    }
  },
  chats(q, limit = 12) {
    const s = F.q(q); if (!s) return { list: [], engine: 'none' };
    const d = open();
    try {
      const safe = s.replace(/["']/g, ' ').split(/\s+/).filter(Boolean).map((w) => `"${w}"`).join(' AND ');
      const list = d.prepare(`
        SELECT m.id, m.chat_jid, c.name, m.ts, substr(m.body, 1, 140) snippet
        FROM inbox_fts f JOIN inbox_msgs m ON m.id = f.rowid
        LEFT JOIN inbox_chats c ON c.session = m.session AND c.jid = m.chat_jid
        WHERE inbox_fts MATCH ? ORDER BY m.ts DESC LIMIT ?`).all(safe, limit);
      return { list, engine: 'fts5' };
    } catch {
      const like = `%${s.replace(/[%_]/g, '')}%`;
      const list = d.prepare(`
        SELECT m.id, m.chat_jid, c.name, m.ts, substr(m.body, 1, 140) snippet
        FROM inbox_msgs m LEFT JOIN inbox_chats c ON c.session = m.session AND c.jid = m.chat_jid
        WHERE m.body LIKE ? ORDER BY m.ts DESC LIMIT ?`).all(like, limit);
      return { list, engine: 'like' };
    }
  }
};

/* 5A: cheap word-overlap similarity (same measure as the pipeline's near-dedupe) */
function sim(a, b) {
  const A = new Set(String(a || '').split(' ').filter(Boolean));
  const B = new Set(String(b || '').split(' ').filter(Boolean));
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const w of A) if (B.has(w)) inter += 1;
  return inter / Math.max(1, Math.min(A.size, B.size));
}

/* 5A: per-source counters + cross-source duplicate search (R38/R40) */
const P5A = {
  countFor: (jid, sinceIso) => { try { return open().prepare("SELECT COUNT(*) n FROM posts WHERE source_jid=? AND created_at >= ? AND status IN ('published','queued')").get(String(jid), sinceIso).n; } catch { return 0; } },
  crossRecent: (norm, exceptJid, windowMin) => {
    try {
      const rows = open().prepare("SELECT id, source_jid, reason, created_at FROM posts WHERE status IN ('published','edited','queued') AND source_jid != ? AND created_at >= datetime('now', ?) ORDER BY id DESC LIMIT 40").all(String(exceptJid), `-${windowMin} minutes`);
      const norm2 = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9\u0600-\u06FF ]/g, ' ').replace(/\s+/g, ' ').trim();
      return rows.filter((r) => norm2(r.reason).length >= 25 && sim(norm, norm2(r.reason)) > 0.8);
    } catch { return []; }
  }
};

/* ---- v7: connected numbers ---- */
const N = {
  all: () => open().prepare('SELECT * FROM numbers ORDER BY CASE id WHEN \'main\' THEN 0 ELSE 1 END, created_at').all(),
  get: (id) => open().prepare('SELECT * FROM numbers WHERE id=?').get(String(id || '')) || null,
  add: (id, label, note) => { try { open().prepare('INSERT INTO numbers(id,label,note) VALUES(?,?,?)').run(id, label || '', note || ''); return true; } catch { return false; } },
  setStatus: (id, status, phone) => { try { open().prepare("UPDATE numbers SET status=?, phone=COALESCE(NULLIF(?,''), phone), last_seen=datetime('now') WHERE id=?").run(String(status || ''), String(phone || ''), String(id)); } catch { } },
  setLabel: (id, label) => { try { open().prepare('UPDATE numbers SET label=? WHERE id=?').run(String(label || '').slice(0, 60), String(id)); } catch { } },
  setPhone: (id, phone) => { try { open().prepare('UPDATE numbers SET phone=? WHERE id=?').run(String(phone || ''), String(id)); } catch { } },
  remove: (id) => { try { open().prepare('DELETE FROM numbers WHERE id=?').run(String(id)); } catch { } }
};

/* ---- v7: synced contacts ---- */
const CT = {
  upsert: (session, jid, name, notify) => {
    if (!jid) return;
    try {
      open().prepare(`INSERT INTO contacts(session,jid,name,notify,updated_at) VALUES(?,?,?,?,datetime('now'))
        ON CONFLICT(session,jid) DO UPDATE SET name=COALESCE(NULLIF(excluded.name,''), name),
          notify=COALESCE(NULLIF(excluded.notify,''), notify), updated_at=datetime('now')`)
        .run(String(session || 'main'), String(jid), String(name || '').slice(0, 120), String(notify || '').slice(0, 120));
    } catch { }
  },
  nameOf: (session, jid) => { try { const r = open().prepare('SELECT name, notify FROM contacts WHERE session=? AND jid=?').get(String(session || 'main'), String(jid)); if (!r) return ''; const n = String(r.name || '').trim(); if (n && !/^\d{6,}$/.test(n)) return n; const nn = String(r.notify || '').trim(); return (nn && !/^\d{6,}$/.test(nn)) ? nn : ''; } catch { return ''; } },
  one: (session, jid) => { try { return open().prepare('SELECT * FROM contacts WHERE session=? AND jid=?').get(String(session || 'main'), String(jid || '')) || null; } catch { return null; } },
  list: (session, limit = 2000) => open().prepare('SELECT * FROM contacts WHERE session=? ORDER BY COALESCE(NULLIF(name,\'\'), jid) COLLATE NOCASE LIMIT ?').all(String(session || 'main'), limit),
  count: (session) => { try { return open().prepare('SELECT COUNT(*) n FROM contacts WHERE session=?').get(String(session || 'main')).n; } catch { return 0; } },
  search: (session, q, limit = 100) => open().prepare(`SELECT * FROM contacts WHERE session=? AND (name LIKE ? OR jid LIKE ?)
    ORDER BY COALESCE(NULLIF(name,''), jid) COLLATE NOCASE LIMIT ?`).all(String(session || 'main'), `%${q}%`, `%${q}%`, limit)
};

/* ---- v7.3: LID ↔ phone-number map (WhatsApp's 15-digit @lid ids) ---- */
const LM = {
  set: (session, lid, pn) => {
    const l = String(lid || '').trim(); const p = String(pn || '').trim();
    if (!l || !p || l === p) return false;
    try {
      open().prepare(`INSERT INTO jid_map(session,lid,pn,updated_at) VALUES(?,?,?,datetime('now'))
        ON CONFLICT(session,lid) DO UPDATE SET pn=excluded.pn, updated_at=datetime('now')`).run(String(session || 'main'), l, p);
      return true;
    } catch { return false; }
  },
  pnFor: (session, lid) => { try { const r = open().prepare('SELECT pn FROM jid_map WHERE session=? AND lid=?').get(String(session || 'main'), String(lid)); return r ? String(r.pn || '') : ''; } catch { return ''; } },
  lidFor: (session, pn) => { try { const r = open().prepare('SELECT lid FROM jid_map WHERE session=? AND pn=?').get(String(session || 'main'), String(pn)); return r ? String(r.lid || '') : ''; } catch { return ''; } },
  count: (session) => { try { return open().prepare('SELECT COUNT(*) n FROM jid_map WHERE session=?').get(String(session || 'main')).n; } catch { return 0; } }
};

/* ---- v7: session-scoped inbox queries ---- */
const IB = {
  chats: (session, limit = 300) => open().prepare(`SELECT c.*, (SELECT COUNT(*) FROM inbox_msgs m WHERE m.session=c.session AND m.chat_jid=c.jid) n_msgs,
    (SELECT m.from_me FROM inbox_msgs m WHERE m.session=c.session AND m.chat_jid=c.jid ORDER BY m.id DESC LIMIT 1) last_from_me
    FROM inbox_chats c WHERE c.session=? ORDER BY c.pinned DESC, c.last_at DESC LIMIT ?`).all(String(session || 'main'), limit),
  ensureChat: (session, jid, name) => {
    try {
      open().prepare(`INSERT INTO inbox_chats(session,jid,name,last_at,last_text,unread) VALUES(?,?,?,datetime('now'),'',0)
        ON CONFLICT(session,jid) DO UPDATE SET name=COALESCE(NULLIF(excluded.name,''), name)`).run(String(session || 'main'), String(jid), String(name || ''));
    } catch { }
  },
  messages: (session, jid, limit = 500) => open().prepare(`SELECT id, session, chat_jid, from_me, ts, sender_name, COALESCE(sender_jid,'') sender_jid, body, msg_id, kind, deleted, edited, orig_body,
    CASE WHEN media_data IS NULL THEN 0 ELSE 1 END has_media,
    CASE WHEN kind='call' THEN 1 ELSE 0 END is_call
    FROM inbox_msgs WHERE session=? AND chat_jid=? ORDER BY id ASC LIMIT ?`).all(String(session || 'main'), String(jid), limit),
  mediaOf: (session, id) => open().prepare('SELECT media_mime, media_name, media_data, COALESCE(media_file,\'\') media_file FROM inbox_msgs WHERE session=? AND id=?').get(String(session || 'main'), Number(id)),
  add: (row) => {
    try {
      const r = open().prepare(`INSERT INTO inbox_msgs(session, chat_jid, from_me, ts, sender_name, sender_jid, body, msg_id, kind, media_mime, media_name, media_data)
        VALUES(@session,@chat_jid,@from_me,@ts,@sender_name,COALESCE(@sender_jid,''),@body,@msg_id,@kind,@media_mime,@media_name,@media_data)`).run(row);
      return r.lastInsertRowid;
    } catch { return null; }
  },
  markDeleted: (session, jid, msgId) => open().prepare('UPDATE inbox_msgs SET deleted=1 WHERE session=? AND chat_jid=? AND msg_id=?').run(String(session || 'main'), String(jid), String(msgId)),
  findByMsgId: (session, jid, msgId) => open().prepare('SELECT * FROM inbox_msgs WHERE session=? AND chat_jid=? AND msg_id=? ORDER BY id DESC LIMIT 1').get(String(session || 'main'), String(jid), String(msgId)) || null,
  applyEdit: (session, jid, msgId, newBody) => open().prepare(`UPDATE inbox_msgs SET orig_body=CASE WHEN orig_body='' THEN body ELSE orig_body END, body=?, edited=1
    WHERE session=? AND chat_jid=? AND msg_id=?`).run(String(newBody || '').slice(0, 2000), String(session || 'main'), String(jid), String(msgId)),
  setMedia: (id, mime, name, data) => open().prepare('UPDATE inbox_msgs SET media_mime=?, media_name=?, media_data=? WHERE id=?').run(String(mime || ''), String(name || '').slice(0, 120), data || null, Number(id)),
  /* v9.0.0 (repo-slim): the file variant — the bytes live in media/<rel>, only the
     relative path goes into the (cloud-synced) database. */
  setMediaRef: (id, mime, name, rel) => { try { open().prepare('UPDATE inbox_msgs SET media_mime=?, media_name=?, media_file=? WHERE id=?').run(String(mime || ''), String(name || '').slice(0, 120), String(rel || ''), Number(id)); } catch { } },
  trimMedia: (keep = 300) => { try { open().prepare(`UPDATE inbox_msgs SET media_data=NULL WHERE media_data IS NOT NULL AND id NOT IN
      (SELECT id FROM inbox_msgs WHERE media_data IS NOT NULL ORDER BY id DESC LIMIT ?)`).run(keep); } catch { } },
  /* v9.0.0 (repo-slim): retention janitor for inbox media.
     - files (media/inbox/*): older than `days` OR beyond the newest 1000 → deleted from disk, ref cleared
     - BLOBs (pre-build rows + embedded thumbs): older than `days` OR beyond the newest 300 → nulled
     Returns { files, blobs } counts. */
  pruneMedia: (days = 30) => {
    try {
      const d = open();
      const cutoff = new Date(Date.now() - Math.max(1, Number(days) || 30) * 86400e3).toISOString();
      const delFile = (rel) => { try { if (rel) fs.unlinkSync(path.join(cfg.config.paths.media, rel)); } catch { } };
      let files = 0;
      for (const r of d.prepare("SELECT id, media_file FROM inbox_msgs WHERE media_file != '' AND ts < ?").all(cutoff)) { delFile(r.media_file); d.prepare("UPDATE inbox_msgs SET media_file='' WHERE id=?").run(r.id); files += 1; }
      for (const r of d.prepare("SELECT id, media_file FROM inbox_msgs WHERE media_file != '' AND id NOT IN (SELECT id FROM inbox_msgs WHERE media_file != '' ORDER BY id DESC LIMIT 1000)").all()) { delFile(r.media_file); d.prepare("UPDATE inbox_msgs SET media_file='' WHERE id=?").run(r.id); files += 1; }
      const b1 = d.prepare('UPDATE inbox_msgs SET media_data=NULL WHERE media_data IS NOT NULL AND ts < ?').run(cutoff);
      const b2 = d.prepare('UPDATE inbox_msgs SET media_data=NULL WHERE media_data IS NOT NULL AND id NOT IN (SELECT id FROM inbox_msgs WHERE media_data IS NOT NULL ORDER BY id DESC LIMIT 300)').run();
      return { files, blobs: (b1.changes || 0) + (b2.changes || 0) };
    } catch { return { files: 0, blobs: 0 }; }
  },
  /* size of the on-disk inbox media cache (media/inbox/) */
  inboxMediaBytes: () => { try { const dir = path.join(cfg.config.paths.media, 'inbox'); let n = 0; for (const f of fs.readdirSync(dir)) { try { n += fs.statSync(path.join(dir, f)).size; } catch { } } return n; } catch { return 0; } },
  /* v9.0.0 (owner policy) — the core rule: once a post's media is in the target
     channel, the local copy is deleted. Removes the on-disk file AND any legacy
     BLOB for that message, then flags the row so a late async capture cannot
     recreate it. The text of the message stays (history is never touched).
     Returns 1 when media was deleted for the message, 0 otherwise. */
  clearMediaForMsg: (session, chatJid, msgId) => {
    try {
      const d = open();
      const row = d.prepare("SELECT id, media_file FROM inbox_msgs WHERE session=? AND chat_jid=? AND msg_id=?").get(String(session || 'main'), String(chatJid || ''), String(msgId || ''));
      if (!row) return 0;
      if (row.media_file) { try { fs.unlinkSync(path.join(cfg.config.paths.media, row.media_file)); } catch { } }
      d.prepare("UPDATE inbox_msgs SET media_file='', media_data=NULL, media_cleared=1 WHERE id=?").run(row.id);
      return 1;
    } catch { return 0; }
  },
  mediaBytes: () => { try { return open().prepare('SELECT COALESCE(SUM(LENGTH(media_data)),0) n FROM inbox_msgs').get().n; } catch { return 0; } },
  wipeSession: (session) => {
    try {
      open().prepare('DELETE FROM inbox_msgs WHERE session=?').run(String(session));
      open().prepare('DELETE FROM inbox_chats WHERE session=?').run(String(session));
      open().prepare('DELETE FROM contacts WHERE session=?').run(String(session));
    } catch { }
  }
};

/* ---- 5A: approval/hold queue ---- */
const Q = {
  add: (row) => { try { const r = open().prepare(`INSERT INTO approvals(source_jid,source_msg_id,text,media_kind,media_path,hold_until,msg_ts,targets) VALUES(?,?,?,?,?,?,?,?)`).run(String(row.source_jid || ''), String(row.source_msg_id || ''), String(row.text || ''), String(row.media_kind || ''), String(row.media_path || ''), String(row.hold_until || ''), Number(row.msg_ts) || 0, String(row.targets || '')); return r.lastInsertRowid; } catch { return null; } },
  pending: (limit = 100) => open().prepare(`SELECT * FROM approvals WHERE status IN ('pending','approved') ORDER BY created_at ASC LIMIT ?`).all(limit),
  one: (id) => open().prepare('SELECT * FROM approvals WHERE id=?').get(Number(id)) || null,
  setStatus: (id, status, note) => open().prepare("UPDATE approvals SET status=?, note=?, decided_at=CASE WHEN ? IN ('approved','rejected') THEN datetime('now') ELSE decided_at END WHERE id=?").run(status, String(note || '').slice(0, 300), status, Number(id)),
  edit: (id, text) => open().prepare('UPDATE approvals SET text=? WHERE id=?').run(String(text || '').slice(0, 20000), Number(id)),
  count: (status) => { try { return open().prepare('SELECT COUNT(*) n FROM approvals WHERE status=?').get(status).n; } catch { return 0; } },
  trimOld: (days = 7) => { try { open().prepare(`DELETE FROM approvals WHERE status IN ('published','rejected','failed') AND decided_at < datetime('now', ?)`).run(`-${days} days`); } catch { } }
};

/* ---- 5A: per-source rule cards ---- */
const SR = {
  get: (jid) => { const r = open().prepare('SELECT * FROM source_rules WHERE source_jid=?').get(String(jid)) || null; return r || { source_jid: jid, approve_first: 0, active_from: '', active_to: '', max_per_day: 0, include: '', exclude: '', auto_pause: 0, priority: 3 }; },
  all: () => open().prepare('SELECT * FROM source_rules').all(),
  save: (jid, f) => { try { open().prepare(`INSERT INTO source_rules(source_jid,approve_first,active_from,active_to,max_per_day,include,exclude,auto_pause,priority) VALUES(?,?,?,?,?,?,?,?,?)
    ON CONFLICT(source_jid) DO UPDATE SET approve_first=excluded.approve_first, active_from=excluded.active_from, active_to=excluded.active_to,
    max_per_day=excluded.max_per_day, include=excluded.include, exclude=excluded.exclude, auto_pause=excluded.auto_pause, priority=excluded.priority`).run(
    String(jid), f.approve_first ? 1 : 0, String(f.active_from || '').slice(0, 5), String(f.active_to || '').slice(0, 5),
    Math.max(0, Math.min(500, parseInt(f.max_per_day, 10) || 0)), String(f.include || '').slice(0, 500), String(f.exclude || '').slice(0, 500),
    f.auto_pause ? 1 : 0, Math.max(1, Math.min(5, parseInt(f.priority, 10) || 3))); } catch { } }
};

/* ---- 5A: routing matrix (source × target on/off) ---- */
const RC = {
  cells: () => open().prepare('SELECT * FROM routing_cells').all(),
  set: (sourceJid, targetJid, enabled) => { try { open().prepare('INSERT INTO routing_cells(source_jid,target_jid,enabled) VALUES(?,?,?) ON CONFLICT(source_jid,target_jid) DO UPDATE SET enabled=excluded.enabled').run(String(sourceJid), String(targetJid), enabled ? 1 : 0); } catch { } },
  del: (sourceJid, targetJid) => { try { open().prepare('DELETE FROM routing_cells WHERE source_jid=? AND target_jid=?').run(String(sourceJid), String(targetJid)); } catch { } },
  enabledMap: () => { const m = {}; for (const c of open().prepare('SELECT * FROM routing_cells').all()) m[`${c.source_jid}|${c.target_jid}`] = Boolean(c.enabled); return m; }
};

/* ---- 5A: audit log (extended by 5E's Audit view) ---- */
const AUD = {
  log: (actor, action, detail) => { try { open().prepare('INSERT INTO audit(actor,action,detail) VALUES(?,?,?)').run(String(actor || 'owner').slice(0, 40), String(action || '').slice(0, 120), String(detail || '').slice(0, 1000)); } catch { } },
  recent: (n = 200) => open().prepare('SELECT * FROM audit ORDER BY id DESC LIMIT ?').all(n)
};

/* ---- 5B (R51): snippets with {placeholders} ---- */
const SN = {
  list: () => { try { return open().prepare('SELECT * FROM snippets ORDER BY name COLLATE NOCASE').all(); } catch { return []; } },
  add: (name, body) => { try { const r = open().prepare('INSERT INTO snippets(name, body) VALUES(?,?)').run(String(name || 'Untitled').slice(0, 80), String(body || '').slice(0, 20000)); return r.lastInsertRowid; } catch { return null; } },
  update: (id, name, body) => { try { open().prepare("UPDATE snippets SET name=?, body=?, updated_at=datetime('now') WHERE id=?").run(String(name || 'Untitled').slice(0, 80), String(body || '').slice(0, 20000), Number(id)); } catch { } },
  remove: (id) => { try { open().prepare('DELETE FROM snippets WHERE id=?').run(Number(id)); } catch { } }
};

/* ---- 5B (R49): composer drafts (text + optional uploaded image) ---- */
const DR = {
  list: () => { try { return open().prepare('SELECT * FROM drafts ORDER BY updated_at DESC, id DESC LIMIT 50').all(); } catch { return []; } },
  add: (name, text, imagePath) => { try { const r = open().prepare("INSERT INTO drafts(name, text, image_path) VALUES(?,?,?)").run(String(name || 'Untitled draft').slice(0, 80), String(text || '').slice(0, 60000), String(imagePath || '')); return r.lastInsertRowid; } catch { return null; } },
  update: (id, name, text, imagePath) => { try { open().prepare("UPDATE drafts SET name=?, text=?, image_path=?, updated_at=datetime('now') WHERE id=?").run(String(name || 'Untitled draft').slice(0, 80), String(text || '').slice(0, 60000), imagePath === undefined ? '' : String(imagePath || ''), Number(id)); } catch { } },
  remove: (id) => { try { open().prepare('DELETE FROM drafts WHERE id=?').run(Number(id)); } catch { } }
};

/* ---- 5C (R54): AI usage meter — calls + tokens per feature/provider/model ---- */
const AIU = {
  add: (feature, provider, model, tokens, ms) => {
    try {
      open().prepare(`INSERT INTO ai_usage(feature, provider, model, calls, tokens, ms, last_at)
        VALUES(?, ?, ?, 1, ?, ?, datetime('now'))
        ON CONFLICT(feature, provider, model) DO UPDATE SET
          calls = calls + 1, tokens = tokens + excluded.tokens, ms = ms + excluded.ms, last_at = datetime('now')`)
        .run(String(feature || 'unknown').slice(0, 40), String(provider || '').slice(0, 40), String(model || '').slice(0, 80), Math.max(0, Number(tokens) || 0), Math.max(0, Number(ms) || 0));
    } catch { }
  },
  list: () => { try { return open().prepare('SELECT * FROM ai_usage ORDER BY last_at DESC, feature ASC').all(); } catch { return []; } },
  totals: () => { try { const r = open().prepare('SELECT COALESCE(SUM(calls),0) c, COALESCE(SUM(tokens),0) t FROM ai_usage').get(); return { calls: r.c, tokens: r.t }; } catch { return { calls: 0, tokens: 0 }; } }
};

/* ---- 5C (R55): prompt library — 10 ready prompts, owner can edit/add ---- */
const SEED_PROMPTS = [
  ['Clean up', 'Fix typos, grammar and spacing in this WhatsApp channel post. Keep the tone, language, facts and links exactly. Return ONLY the cleaned text.'],
  ['Hook first', 'Rewrite this WhatsApp channel post so it starts with ONE strong hook line (max 80 chars), then the rest of the content. Keep every fact. Return ONLY the final text.'],
  ['Listify', 'Turn this WhatsApp channel post into short bullet lines (one fact per line, max 10 lines). Keep the language. Return ONLY the bullets.'],
  ['Urdu flavor', 'Rewrite this WhatsApp channel post in the same language but with light, natural Urdu words/phrases where they fit a Pakistani audience. Keep all facts. Return ONLY the final text.'],
  ['CTA closer', 'Rewrite this WhatsApp channel post and end it with ONE clear call-to-action line (what the reader should do next). Keep the language. Return ONLY the final text.'],
  ['News brief', 'Rewrite this WhatsApp channel post as a neutral, factual news brief in the same language. No opinion, no hype. Return ONLY the text.'],
  ['Formal announcement', 'Rewrite this as a formal announcement in the same language: subject line first, then 2-4 sentences. Return ONLY the text.'],
  ['Casual chat', 'Rewrite this in a friendly, casual tone in the same language — like a friend telling you good news. Keep the facts. Return ONLY the text.'],
  ['Urgent but honest', 'Rewrite this with a clear sense of urgency or limited time, WITHOUT inventing facts or deadlines. Return ONLY the text.'],
  ['One-liner', 'Compress this into ONE punchy line (max 120 characters) in the same language. Return ONLY that line.']
];
const PL = {
  list: () => { try { return open().prepare('SELECT * FROM prompts_lib ORDER BY builtin DESC, name COLLATE NOCASE').all(); } catch { return []; } },
  seed: () => {
    try {
      const d = open();
      const n = d.prepare('SELECT COUNT(*) n FROM prompts_lib').get().n;
      if (n > 0) return 0;
      const ins = d.prepare('INSERT INTO prompts_lib(name, body, builtin) VALUES(?,?,1)');
      for (const [name, body] of SEED_PROMPTS) ins.run(name, body);
      return SEED_PROMPTS.length;
    } catch { return 0; }
  },
  add: (name, body) => { try { const r = open().prepare('INSERT INTO prompts_lib(name, body) VALUES(?,?)').run(String(name || 'Untitled').slice(0, 80), String(body || '').slice(0, 4000)); return r.lastInsertRowid; } catch { return null; } },
  update: (id, name, body) => { try { open().prepare('UPDATE prompts_lib SET name=?, body=? WHERE id=?').run(String(name || 'Untitled').slice(0, 80), String(body || '').slice(0, 4000), Number(id)); } catch { } },
  remove: (id) => { try { open().prepare('DELETE FROM prompts_lib WHERE id=? AND builtin=0').run(Number(id)); } catch { } } // built-ins stay (edit instead)
};

/* ---- 5C (R57): glossary — owner terms ENFORCED in translate + templates ---- */
const GL = {
  list: () => { try { return open().prepare('SELECT * FROM glossary ORDER BY id ASC').all(); } catch { return []; } },
  add: (fromTerm, toTerm, note) => {
    try {
      const f = String(fromTerm || '').trim(), t = String(toTerm || '').trim();
      if (!f || !t) return null;
      const dup = open().prepare('SELECT id FROM glossary WHERE from_term=? COLLATE NOCASE').get(f);
      if (dup) { open().prepare('UPDATE glossary SET to_term=?, note=? WHERE id=?').run(t, String(note || '').slice(0, 200), dup.id); return dup.id; }
      const r = open().prepare('INSERT INTO glossary(from_term, to_term, note) VALUES(?,?,?)').run(f.slice(0, 200), t.slice(0, 200), String(note || '').slice(0, 200));
      return r.lastInsertRowid;
    } catch { return null; }
  },
  remove: (id) => { try { open().prepare('DELETE FROM glossary WHERE id=?').run(Number(id)); } catch { } },
  /** Case-insensitive whole-phrase replacement; longest terms first.
      Idempotent for well-formed terms (applied after translate AND templates). */
  apply: (text) => {
    const t = String(text == null ? '' : text);
    if (!t) return t;
    const rows = GL.list().filter((g) => g.from_term && g.to_term);
    if (!rows.length) return t;
    rows.sort((a, b) => String(b.from_term).length - String(a.from_term).length);
    let out = t;
    for (const g of rows) {
      try {
        const re = new RegExp(String(g.from_term).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
        out = out.replace(re, g.to_term);
      } catch { }
    }
    return out;
  }
};

/* ---- 5C (R59): knowledge-base auto-reply — exact stored answers, no AI ---- */
const RB = {
  list: () => { try { return open().prepare('SELECT * FROM reply_kb WHERE enabled=1 ORDER BY id ASC').all(); } catch { return []; } },
  listAll: () => { try { return open().prepare('SELECT * FROM reply_kb ORDER BY id ASC').all(); } catch { return []; } },
  add: (q, a) => {
    try {
      const qq = String(q || '').trim(), aa = String(a || '').trim();
      if (!qq || !aa) return null;
      const r = open().prepare('INSERT INTO reply_kb(q, a) VALUES(?,?)').run(qq.slice(0, 500), aa.slice(0, 2000));
      return r.lastInsertRowid;
    } catch { return null; }
  },
  update: (id, q, a, enabled) => { try { open().prepare('UPDATE reply_kb SET q=?, a=?, enabled=? WHERE id=?').run(String(q || '').trim().slice(0, 500), String(a || '').trim().slice(0, 2000), enabled === undefined ? 1 : (enabled ? 1 : 0), Number(id)); } catch { } },
  remove: (id) => { try { open().prepare('DELETE FROM reply_kb WHERE id=?').run(Number(id)); } catch { } },
  /** Best KB question the incoming message covers (70%+ of the shorter side's
      content words). Returns {q, a, score} or null. */
  match: (body) => {
    const msg = String(body || '').toLowerCase();
    if (!msg.trim()) return null;
    const words = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9\u0600-\u06FF\uFB50-\uFDFF\s]/gi, ' ').split(/\s+/).filter((w) => w.length > 1 && !/^(the|a|an|is|are|what|when|where|who|how|please|pls|for|of|to|in|on|and|or)$/i.test(w));
    const mw = words(msg);
    if (!mw.length) return null;
    const mset = new Set(mw);
    let best = null;
    for (const row of RB.list()) {
      const qw = words(row.q);
      if (!qw.length) continue;
      const qset = new Set(qw);
      const inter = [...qset].filter((w) => mset.has(w)).length;
      const score = inter / Math.max(1, Math.min(qset.size, mset.size));
      if (score >= 0.7 && (!best || score > best.score)) best = { q: row.q, a: row.a, score };
    }
    return best;
  }
};

/* ---- 5A: latency stats (R46) ---- */
const LAT = {
  record: (postId, ms) => { try { open().prepare('UPDATE posts SET pub_ms=? WHERE id=?').run(Number(ms), postId); } catch { } },
  stats: (days = 7) => {
    try {
      const rows = open().prepare('SELECT pub_ms FROM posts WHERE status IN (\'published\',\'edited\') AND pub_ms IS NOT NULL AND created_at >= datetime(\'now\', ?)').all(`-${days} days`).map((r) => r.pub_ms).sort((a, b) => a - b);
      if (!rows.length) return { n: 0, median: null, p95: null };
      const q = (p) => rows[Math.min(rows.length - 1, Math.floor(rows.length * p))];
      return { n: rows.length, median: Math.round(q(0.5) / 1000), p95: Math.round(q(0.95) / 1000) };
    } catch { return { n: 0, median: null, p95: null }; }
  }
};

/* ---- 5D (R62/R64/R66) — goals · self-tests · notification center ---- */
const GO = {
  all: () => open().prepare('SELECT * FROM goals ORDER BY daily_n DESC').all(),
  set: (jid, n, note) => open().prepare('INSERT INTO goals(source_jid, daily_n, note) VALUES(?,?,?) ON CONFLICT(source_jid) DO UPDATE SET daily_n=excluded.daily_n, note=excluded.note').run(String(jid), Number(n) || 0, String(note || '').slice(0, 120)),
  remove: (jid) => open().prepare('DELETE FROM goals WHERE source_jid=?').run(String(jid))
};
const ST = {
  add: (ok, total, detail) => { try { open().prepare('INSERT INTO selftests(ok, total, detail) VALUES(?,?,?)').run(Number(ok), Number(total), String(detail || '')); } catch { } },
  recent: (n = 10) => open().prepare('SELECT * FROM selftests ORDER BY id DESC LIMIT ?').all(n)
};
const NTF = {
  add: (kind, text) => { try { open().prepare('INSERT INTO notifications(kind, text) VALUES(?,?)').run(String(kind || 'info'), String(text || '').slice(0, 300)); } catch { } },
  list: (limit = 30) => { const d = open().prepare('SELECT id, ts, kind, text, read FROM notifications ORDER BY id DESC LIMIT ?').all(limit); return { list: d, unread: open().prepare('SELECT COUNT(*) c FROM notifications WHERE read=0').get().c }; },
  readOne: (id) => { try { open().prepare('UPDATE notifications SET read=1 WHERE id=?').run(Number(id)); } catch { } },
  readAll: () => { try { open().prepare('UPDATE notifications SET read=1 WHERE read=0').run(); } catch { } }
};

/* v7.8.0: Browse — resolved-metadata cache (code → jid/name/followers) */
const BM = {
  get: (code) => { try { return open().prepare('SELECT * FROM browse_meta WHERE code=?').get(String(code || '')) || null; } catch { return null; } },
  set: (code, o) => { try { open().prepare(`INSERT INTO browse_meta(code,name,jid,followers,src) VALUES(?,?,?,?,?) ON CONFLICT(code) DO UPDATE SET name=COALESCE(excluded.name,name), jid=COALESCE(excluded.jid,jid), followers=COALESCE(excluded.followers,followers), src=COALESCE(excluded.src,src), updated_at=datetime('now')`).run(String(code || ''), (o && o.name) || '', (o && o.jid) || '', (o && String(o.followers || '')) || '', (o && o.src) || ''); } catch { } },
  byJid: (jid) => { try { return open().prepare('SELECT * FROM browse_meta WHERE jid=?').get(String(jid || '')) || null; } catch { return null; } }
};
module.exports = { open, S, CH, P, A, AICHAT, BULKH, EGR, AP, SUBS, CL, QR, WAS, CN, BCL, N, CT, IB, LM, Q, SR, RC, AUD, LAT, P5A, SN, DR, AIU, PL, GL, RB, GO, ST, NTF, F, BM, pruneForMemory };
