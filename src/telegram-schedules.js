'use strict';
// Single-instance durable one-time Telegram schedules. A claimed occurrence is
// never automatically replayed after an interruption or uncertain outcome.
const {open}=require('./db'),tg=require('./telegram-publish'),crypto=require('crypto');
const {validId}=require('./compose-requests');
function table(){const d=open();d.exec(`CREATE TABLE IF NOT EXISTS telegram_schedules(
 id TEXT PRIMARY KEY, digest TEXT NOT NULL, target TEXT NOT NULL, text TEXT NOT NULL,
 send_at TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'waiting', detail TEXT NOT NULL DEFAULT '',
 created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now'))
)`);return d;}
function list(){return table().prepare('SELECT id,target,text,send_at AS sendAt,state,detail,created_at AS createdAt FROM telegram_schedules ORDER BY created_at DESC,rowid DESC LIMIT 100').all();}
function get(id){if(!validId(id))throw Error('Invalid schedule ID.');return table().prepare('SELECT id,target,text,send_at AS sendAt,state,detail,created_at AS createdAt FROM telegram_schedules WHERE id=?').get(id)||null;}
function notify(){try{require('./persist').syncSoon('telegram-schedule',5000)}catch{}}
function create(input){
 const id=input?.requestId,target=String(input?.target||'').trim(),text=String(input?.text||''),at=String(input?.sendAt||'');
 if(input?.confirmed!==true)throw Error('Confirm the channel, text and scheduled time.');
 if(!validId(id))throw Error('A valid schedule request ID is required.');
 if(!tg.configured())throw Error('Telegram bot token is not configured.');
 if(!/^@[A-Za-z][A-Za-z0-9_]{4,31}$/.test(target)&&!/^\-100\d{5,15}$/.test(target))throw Error('Use a channel username or channel ID beginning -100.');
 if(!text.trim()||[...text].length>4096)throw Error('Telegram text must contain 1–4096 characters.');
 if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(at)||!Number.isFinite(Date.parse(at))||new Date(at).toISOString()!==at)throw Error('Scheduled time must be a valid UTC timestamp.');
 const hash=crypto.createHash('sha256').update(JSON.stringify([target,text,at])).digest('hex');
 const d=table(),existing=d.prepare('SELECT digest FROM telegram_schedules WHERE id=?').get(id);
 if(existing){if(existing.digest!==hash)return {conflict:true};return {replayed:true,record:get(id)};}
 if(Date.parse(at)<Date.now()+60000 || Date.parse(at)>Date.now()+5*366*86400e3)throw Error('Choose a time at least one minute and at most five years from now.');
 const inserted=d.prepare("INSERT OR IGNORE INTO telegram_schedules(id,digest,target,text,send_at) VALUES(?,?,?,?,?)").run(id,hash,target,text,at).changes;
 if(!inserted){const again=d.prepare('SELECT digest FROM telegram_schedules WHERE id=?').get(id);if(again.digest!==hash)return {conflict:true};return {replayed:true,record:get(id)};}
 notify();return {record:get(id)};
}
function cancel(id,confirmed){
 if(confirmed!==true)throw Error('Confirm cancellation first.');if(!validId(id))throw Error('Invalid schedule ID.');
 const n=table().prepare("UPDATE telegram_schedules SET state='cancelled',detail='Cancelled by owner',updated_at=datetime('now') WHERE id=? AND state='waiting'").run(id).changes;
 if(!n)throw Error('The schedule is no longer waiting and cannot be cancelled. Check its status.');
 notify();return get(id);
}
function recover(){
 const d=table();let recovered=0;
 for(const x of d.prepare("SELECT id FROM telegram_schedules WHERE state='processing'").all()){
   const send=tg.status(x.id);const state=send&&['accepted','rejected','uncertain'].includes(send.state)?send.state:'needs_review';
   const detail=send?.detail || 'Process stopped during this schedule. Check the channel before creating another send.';
   recovered+=d.prepare("UPDATE telegram_schedules SET state=?,detail=?,updated_at=datetime('now') WHERE id=? AND state='processing'").run(state,detail,x.id).changes;
 }
 if(recovered)notify();
}
let ticking=false;
async function tick(now=Date.now()){
 if(ticking||!tg.configured()||require('./panic').active()||require('./lifecycle').isStopping())return;
 ticking=true;
 try {
  const d=table(),due=d.prepare("SELECT id,target,text FROM telegram_schedules WHERE state='waiting' AND send_at<=? ORDER BY send_at ASC LIMIT 10").all(new Date(now).toISOString());
  for(const s of due){
    if(require('./panic').active()||require('./lifecycle').isStopping())break;
    const claimed=d.prepare("UPDATE telegram_schedules SET state='processing',updated_at=datetime('now') WHERE id=? AND state='waiting'").run(s.id).changes;if(!claimed)continue;
    try {
      const result=await tg.publish({requestId:s.id,target:s.target,text:s.text,confirmed:true});
      const r=result.record;const state=r&&['accepted','rejected','uncertain'].includes(r.state)?r.state:'needs_review';
      const detail=r?.detail || 'The outcome could not be confirmed. Check the channel before sending again.';
      d.prepare("UPDATE telegram_schedules SET state=?,detail=?,updated_at=datetime('now') WHERE id=? AND state='processing'").run(state,detail,s.id);
    } catch(e) {
      // Validation may fail before a provider request; do not silently retry a
      // claimed occurrence because another path could have started it.
      d.prepare("UPDATE telegram_schedules SET state='needs_review',detail=?,updated_at=datetime('now') WHERE id=? AND state='processing'").run('The schedule did not complete. Check the channel and configuration before creating another send.',s.id);
    }
    notify();
  }
 } finally {ticking=false;}
}
function start(){recover();const timer=setInterval(()=>tick().catch(err=>{try{require('./logger').ring.warn('telegram.scheduler','Telegram scheduler failed; inspect scheduled posts and server logs.')}catch{}}),30000);timer.unref?.();return timer;}
module.exports={create,get,list,cancel,recover,tick,start};
