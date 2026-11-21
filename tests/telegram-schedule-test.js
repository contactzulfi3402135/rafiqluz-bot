'use strict';
// One-instance schedule tests using a fake Bot API, never a real account.
const fs=require('fs'),path=require('path'),os=require('os'),crypto=require('crypto'),assert=require('assert');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'raq-tg-schedule-'));const cfg=require('../src/config');cfg.config.paths.database=path.join(root,'bot.sqlite');cfg.config.paths.sessions=path.join(root,'sessions');
const db=require('../src/db');db.open();process.env.TELEGRAM_BOT_TOKEN='123456:abcdefghijklmnopqrstuvwxyzABCDEFG';const tg=require('../src/telegram-publish'),q=require('../src/telegram-schedules');
let checks=0,sends=0,fail=false,gate=null,started=null;
function ok(v,s){assert.ok(v,s);checks++;console.log('✓ '+s)}
const payload=()=>({requestId:crypto.randomUUID(),target:'@examplechannel',text:'Scheduled text',sendAt:new Date(Date.now()+120000).toISOString(),confirmed:true});
async function bot(method){if(method==='getMe')return {id:123456};if(method==='getChat')return {id:-1001234567890,type:'channel',title:'Example'};if(method==='getChatMember')return {status:'administrator',can_post_messages:true};if(method==='sendMessage'){sends++;if(started)started();if(gate)await gate;if(fail)throw Error('response lost');return {message_id:99};}throw Error('unexpected')}
(async()=>{
 tg._setTransportForTests(bot);
 assert.throws(()=>q.create({...payload(),confirmed:false}),/Confirm/);ok(true,'scheduling requires explicit review confirmation');
 assert.throws(()=>q.create({...payload(),sendAt:new Date().toISOString()}),/at least one minute/);ok(true,'schedules cannot be created immediately or in the past');
 const one=payload();let r=q.create(one);ok(r.record.state==='waiting','one-time schedule is recorded');
 r=q.create(one);ok(r.replayed&&q.list().length===1,'repeated creation request does not create a second schedule');
 ok(q.create({...one,text:'different'}).conflict,'schedule request IDs cannot be reused for changed content');
 assert.throws(()=>q.cancel(one.requestId,false),/Confirm/);ok(q.get(one.requestId).state==='waiting','cancellation needs confirmation');
 q.cancel(one.requestId,true);await q.tick(Date.now()+180000);ok(q.get(one.requestId).state==='cancelled'&&sends===0,'cancelled schedule is never sent');
 const two=payload();q.create(two);db.S.set('panic.on','1');await q.tick(Date.now()+180000);ok(q.get(two.requestId).state==='waiting'&&sends===0,'panic leaves scheduled posts waiting');db.S.set('panic.on','0');
 let release,resolveStarted;gate=new Promise(r=>release=r);const startPromise=new Promise(r=>resolveStarted=r);started=resolveStarted;
 const a=q.tick(Date.now()+180000);await startPromise;const b=q.tick(Date.now()+180000);await b;
 ok(sends===1&&q.get(two.requestId).state==='processing','overlapping schedule ticks start only one provider call');
 assert.throws(()=>q.cancel(two.requestId,true),/no longer waiting/);release();await a;gate=null;started=null;
 ok(q.get(two.requestId).state==='accepted'&&tg.status(two.requestId).providerId==='99','accepted schedule retains its provider receipt');
 const three=payload();q.create(three);fail=true;await q.tick(Date.now()+180000);const count=sends;await q.tick(Date.now()+180000);
 ok(q.get(three.requestId).state==='uncertain'&&sends===count,'ambiguous scheduled send is never automatically repeated');fail=false;
 const four=payload();q.create(four);db.open().prepare("UPDATE telegram_schedules SET state='processing' WHERE id=?").run(four.requestId);q.recover();
 ok(q.get(four.requestId).state==='needs_review','interrupted claimed schedule without a receipt requires review');
 const five=payload();q.create(five);db.open().prepare("UPDATE telegram_schedules SET state='processing' WHERE id=?").run(five.requestId);await tg.publish({requestId:five.requestId,target:five.target,text:five.text,confirmed:true});q.recover();
 ok(q.get(five.requestId).state==='accepted','restart reconciles a completed send receipt without replay');
 console.log(`PASS: ${checks} Telegram schedule checks`);
})().catch(e=>{console.error(e);process.exitCode=1}).finally(()=>{tg._setTransportForTests(null);delete process.env.TELEGRAM_BOT_TOKEN;try{db.open().close()}catch{}fs.rmSync(root,{recursive:true,force:true})});
