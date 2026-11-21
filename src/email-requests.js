'use strict';
// Email API idempotency is scoped to one UUID and survives while SQLite does.
// A stranded running claim is not replayed; SMTP/provider and disk failures can
// still produce unknown outcomes and new request IDs can create duplicates.
const {open}=require('./db'),crypto=require('node:crypto');
const {validId}=require('./compose-requests');
function table(){const d=open();d.exec(`CREATE TABLE IF NOT EXISTS email_requests(
 request_id TEXT PRIMARY KEY,digest TEXT NOT NULL,state TEXT NOT NULL,result_json TEXT NOT NULL DEFAULT '',
 started_at TEXT NOT NULL DEFAULT (datetime('now')),updated_at TEXT NOT NULL DEFAULT (datetime('now'))
)`);return d;}
function digest(o){return crypto.createHash('sha256').update(JSON.stringify([String(o.accountId||''),String(o.to||''),String(o.subject||''),String(o.body||''),String(o.scheduleAt||'')])).digest('hex')}
function get(id){if(!validId(id))throw Error('Invalid request ID.');const r=table().prepare('SELECT request_id,digest,state,result_json,started_at,updated_at FROM email_requests WHERE request_id=?').get(id);if(!r)return null;let result=null;try{if(r.result_json)result=JSON.parse(r.result_json)}catch{}return{id:r.request_id,digest:r.digest,state:r.state,result,startedAt:r.started_at,updatedAt:r.updated_at}}
function notify(){try{require('./persist').syncSoon('email-request',5000)}catch{}}
function begin(id,hash){if(!validId(id))throw Error('Invalid request ID.');const inserted=table().prepare("INSERT OR IGNORE INTO email_requests(request_id,digest,state) VALUES(?,?,'running')").run(id,hash).changes;if(inserted){notify();return{started:true}}const r=get(id);if(r.digest!==hash)return{conflict:true};return{record:r}}
function complete(id,result){table().prepare("UPDATE email_requests SET state='completed',result_json=?,updated_at=datetime('now') WHERE request_id=? AND state='running'").run(JSON.stringify(result),id);notify()}
function review(id){table().prepare("UPDATE email_requests SET state='needs_review',result_json=?,updated_at=datetime('now') WHERE request_id=? AND state='running'").run(JSON.stringify({error:'Request did not complete. Check email history and recipients before sending again.'}),id);notify()}
module.exports={validId,digest,get,begin,complete,review};
