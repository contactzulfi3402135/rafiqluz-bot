'use strict';
// Optional durable browser sessions for ONE guarded bot instance. This is not
// tenant isolation or a distributed session store. Raw cookie IDs are not stored.
const crypto = require('node:crypto');
const session = require('express-session');
const MAX_SESSION_BYTES = 65536;
const MAX_AGE_MS = 24 * 60 * 60 * 1000;
const DEFAULT_AGE_MS = 2 * 60 * 60 * 1000;
function digest(sid) {
  if (typeof sid !== 'string' || sid.length < 16 || sid.length > 256) throw new Error('Invalid session ID');
  return crypto.createHash('sha256').update(sid).digest('hex');
}
function expiry(value, now) {
  const cookie = value && value.cookie;
  if (!cookie || cookie.expires == null) return now + DEFAULT_AGE_MS;
  const ms = new Date(cookie.expires).getTime();
  if (!Number.isFinite(ms)) throw new Error('Invalid session expiry');
  return Math.min(ms, now + MAX_AGE_MS);
}
function complete(callback, err, value) {
  if (typeof callback === 'function') queueMicrotask(() => callback(err, value));
}
class SQLiteSessionStore extends session.Store {
  constructor(db) {
    super();
    if (!db || typeof db.prepare !== 'function') throw new Error('SQLite session database required');
    this.db = db;
    db.exec(`CREATE TABLE IF NOT EXISTS dashboard_sessions (
      sid_hash TEXT PRIMARY KEY, expires_ms INTEGER NOT NULL, payload TEXT NOT NULL
    ); CREATE INDEX IF NOT EXISTS dashboard_sessions_expiry_idx ON dashboard_sessions(expires_ms);
    CREATE TABLE IF NOT EXISTS dashboard_session_revocations (sid_hash TEXT PRIMARY KEY, revoked_ms INTEGER NOT NULL);`);
    this.read = db.prepare('SELECT expires_ms,payload FROM dashboard_sessions WHERE sid_hash=?');
    this.write = db.prepare(`INSERT INTO dashboard_sessions(sid_hash,expires_ms,payload)
      SELECT ?,?,? WHERE NOT EXISTS (SELECT 1 FROM dashboard_session_revocations WHERE sid_hash=?)
      ON CONFLICT(sid_hash) DO UPDATE SET expires_ms=excluded.expires_ms,payload=excluded.payload
      WHERE dashboard_sessions.expires_ms>?`);
    this.revoke = db.prepare('INSERT OR IGNORE INTO dashboard_session_revocations(sid_hash,revoked_ms) VALUES(?,?)');
    this.remove = db.prepare('DELETE FROM dashboard_sessions WHERE sid_hash=?');
    this.removeExpired = db.prepare('DELETE FROM dashboard_sessions WHERE sid_hash=? AND expires_ms<=?');
    this.expireOne = db.transaction((key, now) => { if (this.removeExpired.run(key, now).changes) this.revoke.run(key, now); });
    this.touchExpiry = db.prepare("UPDATE dashboard_sessions SET expires_ms=?, payload=json_set(payload,'$.cookie.expires',?) WHERE sid_hash=? AND expires_ms>?");
    this.expiredKeys = db.prepare('SELECT sid_hash FROM dashboard_sessions WHERE expires_ms<=? LIMIT 1000');
    this.sweep = db.transaction(now => { let count=0; for (const row of this.expiredKeys.all(now)) { if (this.removeExpired.run(row.sid_hash, now).changes) { this.revoke.run(row.sid_hash, now); count++; } } return count; });
    this.destroySession = db.transaction((key, now) => { this.remove.run(key); this.revoke.run(key, now); });
  }
  get(sid, callback) {
    try {
      const key = digest(sid), now = Date.now(), row = this.read.get(key);
      if (!row) return complete(callback, null, null);
      if (row.expires_ms <= now) { this.expireOne(key, now); return complete(callback, null, null); }
      const value = JSON.parse(row.payload);
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid stored session');
      complete(callback, null, value);
    } catch (err) { complete(callback, err); }
  }
  set(sid, value, callback) {
    try {
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid session');
      const key = digest(sid), now = Date.now(), expires = expiry(value, now), payload = JSON.stringify(value);
      if (typeof payload !== 'string' || Buffer.byteLength(payload) > MAX_SESSION_BYTES) throw new Error('Session exceeds size limit');
      if (expires <= now || !this.write.run(key, expires, payload, key, now).changes) throw new Error('Session expired or revoked');
      complete(callback, null);
    } catch (err) { complete(callback, err); }
  }
  touch(sid, value, callback) {
    try {
      const key = digest(sid), now = Date.now(), expires = expiry(value, now);
      // Do not re-create a session that was logged out concurrently, nor
      // overwrite unrelated data with a stale concurrent request.
      this.touchExpiry.run(expires, new Date(expires).toISOString(), key, now);
      complete(callback, null);
    } catch (err) { complete(callback, err); }
  }
  destroy(sid, callback) {
    try { this.destroySession(digest(sid), Date.now()); complete(callback, null); }
    catch (err) { complete(callback, err); }
  }
  pruneExpired(callback) {
    try { complete(callback, null, this.sweep(Date.now())); }
    catch (err) { complete(callback, err); }
  }
}
module.exports = { SQLiteSessionStore };
