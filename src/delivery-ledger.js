'use strict';
// Local per-part journal. It reduces duplicates only while this SQLite state survives.
// A provider error or interrupted call may have been accepted: never retry it blindly.
const { open, AUD } = require('./db');
const active = new Set();
const key = (s,m,t,p) => JSON.stringify([s,m,t,p]);
function scheduleSnapshot() { try { require('./persist').syncSoon('delivery-journal', 5000); } catch {} }
function db() {
  const d = open();
  d.exec(`CREATE TABLE IF NOT EXISTS delivery_attempts (
    id INTEGER PRIMARY KEY AUTOINCREMENT, source_jid TEXT NOT NULL, source_msg_id TEXT NOT NULL,
    target_jid TEXT NOT NULL, part INTEGER NOT NULL, digest TEXT NOT NULL, state TEXT NOT NULL,
    provider_id TEXT DEFAULT '', detail TEXT DEFAULT '', updated_at TEXT DEFAULT (datetime('now')),
    UNIQUE(source_jid,source_msg_id,target_jid,part)
  ); CREATE INDEX IF NOT EXISTS idx_delivery_review ON delivery_attempts(state, updated_at);`);
  return d;
}
function get(s, m, t, p) { return db().prepare('SELECT * FROM delivery_attempts WHERE source_jid=? AND source_msg_id=? AND target_jid=? AND part=?').get(s,m,t,p); }
function claim(s, m, t, p, digest) {
  const d = db();
  const r = d.prepare("INSERT OR IGNORE INTO delivery_attempts(source_jid,source_msg_id,target_jid,part,digest,state) VALUES(?,?,?,?,?,'sending')").run(s,m,t,p,digest);
  if (r.changes) { active.add(key(s,m,t,p)); scheduleSnapshot(); return { claimed: true }; }
  const row = get(s,m,t,p);
  if (row.digest !== digest) return { claimed:false, state:'changed', row };
  return { claimed:false, state:row.state, row };
}
function finish(s,m,t,p,state,id,detail) {
  try { db().prepare("UPDATE delivery_attempts SET state=?,provider_id=?,detail=?,updated_at=datetime('now') WHERE source_jid=? AND source_msg_id=? AND target_jid=? AND part=?").run(state,String(id||''),String(detail||'').slice(0,500),s,m,t,p); }
  finally { active.delete(key(s,m,t,p)); }
  scheduleSnapshot();
}
function review() {
  return db().prepare("SELECT id,source_jid,source_msg_id,target_jid,part,state,provider_id,detail,updated_at FROM delivery_attempts WHERE state IN ('sending','uncertain','unverified') ORDER BY id DESC LIMIT 200").all();
}
function resolve(id, action) {
  const d = db(); const row = d.prepare('SELECT * FROM delivery_attempts WHERE id=?').get(Number(id));
  if (!row || !['sending','uncertain','unverified'].includes(row.state)) throw new Error('Review item is no longer unresolved.');
  if (active.has(key(row.source_jid,row.source_msg_id,row.target_jid,row.part))) throw new Error('The send is still in progress. Wait before reviewing.');
  if (!['accepted','retry'].includes(action)) throw new Error('Choose accepted or retry.');
  if (action === 'retry') d.prepare('DELETE FROM delivery_attempts WHERE id=?').run(row.id);
  else d.prepare("UPDATE delivery_attempts SET state='accepted',detail='Marked accepted after owner review',updated_at=datetime('now') WHERE id=?").run(row.id);
  scheduleSnapshot();
  AUD.log('owner','delivery.review',`Delivery ${row.id} on ${row.target_jid} part ${row.part + 1}: ${action} after manual review`);
  return { source_jid:row.source_jid, source_msg_id:row.source_msg_id, action };
}
function forSource(s,m) { return db().prepare("SELECT id,target_jid,part,state,provider_id,detail,updated_at FROM delivery_attempts WHERE source_jid=? AND source_msg_id=? ORDER BY target_jid,part").all(s,m); }
function hasUnresolved(s,m) { return Boolean(db().prepare("SELECT 1 FROM delivery_attempts WHERE source_jid=? AND source_msg_id=? AND state IN ('sending','uncertain','unverified') LIMIT 1").get(s,m)); }
function hasLegacyCopies(s,m) {
  return Boolean(db().prepare(`SELECT 1 FROM posts p JOIN post_keys k ON k.post_id=p.id
    WHERE p.source_jid=? AND p.source_msg_id=? AND k.msg_id <> 'undone'
      AND NOT EXISTS (SELECT 1 FROM delivery_attempts a WHERE a.target_jid=k.target_jid AND a.provider_id=k.msg_id) LIMIT 1`).get(s,m));
}
module.exports = { claim, finish, get, review, resolve, forSource, hasUnresolved, hasLegacyCopies };
