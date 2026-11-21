'use strict';
// Durable request-level deduplication for manually composed posts. It prevents
// the same request key being executed twice while this database survives; it
// does not prove delivery or make independent requests/provider sends atomic.
const {open}=require('./db');
const crypto=require('node:crypto');
function table() {
  const d=open();
  d.exec(`CREATE TABLE IF NOT EXISTS compose_requests (
    request_id TEXT PRIMARY KEY, digest TEXT NOT NULL,
    state TEXT NOT NULL, result_json TEXT DEFAULT '',
    started_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
  return d;
}
function validId(id){return typeof id==='string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id);}
function digest(input){
  const h=crypto.createHash('sha256');
  const fields=[input.text,input.imageUrl,input.imageB64,input.imageMime,input.beautify?'1':'0',JSON.stringify(input.targets)];
  for(const value of fields){const s=String(value ?? '');h.update(String(Buffer.byteLength(s))+':');h.update(s);}
  return h.digest('hex');
}
function get(id){
  const row=table().prepare('SELECT request_id,digest,state,result_json,started_at,updated_at FROM compose_requests WHERE request_id=?').get(id);
  if(!row)return null;
  let result=null;try {if(row.result_json)result=JSON.parse(row.result_json);} catch {}
  return {id:row.request_id,digest:row.digest,state:row.state,result,startedAt:row.started_at,updatedAt:row.updated_at};
}
function begin(id,hash){
  if(!validId(id))throw new Error('Invalid request ID.');
  const d=table();
  const inserted=d.prepare("INSERT OR IGNORE INTO compose_requests(request_id,digest,state) VALUES(?,?,'running')").run(id,hash).changes;
  if(inserted){try{require('./persist').syncSoon('compose-request',5000)}catch{};return {started:true};}
  const existing=get(id);
  if(existing.digest!==hash)return {started:false,conflict:true};
  return {started:false,record:existing};
}
function complete(id,result){
  table().prepare("UPDATE compose_requests SET state='completed',result_json=?,updated_at=datetime('now') WHERE request_id=? AND state='running'").run(JSON.stringify(result),id);
  try{require('./persist').syncSoon('compose-result',5000)}catch{}
}
function review(id,reason){
  table().prepare("UPDATE compose_requests SET state='needs_review',result_json=?,updated_at=datetime('now') WHERE request_id=? AND state='running'").run(JSON.stringify({error:String(reason || 'Outcome not confirmed').slice(0,300)}),id);
  try{require('./persist').syncSoon('compose-review',5000)}catch{}
}
module.exports={validId,digest,get,begin,complete,review};
