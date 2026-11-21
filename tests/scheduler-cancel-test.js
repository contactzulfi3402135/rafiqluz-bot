'use strict';
// Regression tests for cancellation/panic between sequential scheduled sends.
const fs=require('fs'),path=require('path'),os=require('os'),assert=require('assert');const root=fs.mkdtempSync(path.join(os.tmpdir(),'raq-sched-cancel-'));
process.env.RAQ_STATE_DIR=root;require('../src/config').ensureDirs();const db=require('../src/db'),d=db.open(),numbers=require('../src/numbers'),pipeline=require('../src/pipeline'),pub=require('../src/publish'),waSched=require('../src/wasched'),power=require('../src/power'),panic=require('../src/panic');
const originals={get:numbers.getSocket,status:numbers.statusOf,switches:pipeline.switches,publish:pub.publish};let calls=[],n=0;const ok=(v,s)=>{assert.ok(v,s);n++;console.log('✓ '+s)};const at=new Date(Date.now()-60000).toISOString();
(async()=>{
 numbers.statusOf=()=> 'open';let second;
 numbers.getSocket=()=>({sendMessage:async jid=>{calls.push(jid);if(second)db.WAS.setEnabled(second,false);return {key:{id:'synthetic'}}}});
 const one=db.WAS.add({session:'main',jid:'923001234561@s.whatsapp.net',text:'a',at});second=db.WAS.add({session:'main',jid:'923001234562@s.whatsapp.net',text:'b',at});
 await waSched.tick();ok(calls.length===1&&!db.WAS.get(second).enabled,'cancelling the next personal schedule during a send prevents its send');
 second=null;const missing=db.WAS.add({session:'main',jid:'923001234563@s.whatsapp.net',text:'c',at});numbers.getSocket=()=>({sendMessage:async jid=>{calls.push(jid);return {}}});await waSched.tick();const count=calls.length;await waSched.tick();const occurrence=`${missing}:${at}`;
 ok(calls.length===count&&d.prepare('SELECT state FROM delivery_attempts WHERE source_jid=? AND source_msg_id=?').get('wasched:main',occurrence)?.state==='uncertain','missing personal-send receipt remains uncertain and is not replayed');
 const left=db.WAS.add({session:'main',jid:'923001234564@s.whatsapp.net',text:'d',at});const right=db.WAS.add({session:'main',jid:'923001234565@s.whatsapp.net',text:'e',at});numbers.getSocket=()=>({sendMessage:async jid=>{calls.push(jid);panic.stop();return {key:{id:'accepted'}}}});const old=calls.length;await waSched.tick();ok(calls.length===old+1&&db.WAS.get(right).enabled,'panic raised during a personal send stops the next due message');panic.restore();
 assert.throws(()=>waSched.add({session:'main',jid:'923001234567@s.whatsapp.net',text:'x'.repeat(4097),localAt:'2030-01-01T12:00'}),/4,096/);ok(true,'personal scheduled text is not silently truncated');
 pipeline.switches=()=>({scheduler:true});const j1=power.addJob({jid:'one@newsletter',text:'one',at}),j2=power.addJob({jid:'two@newsletter',text:'two',at});let channelCalls=[];pub.publish=async(_content,opts)=>{channelCalls.push(opts.only[0]);power.setJobEnabled(j2.id,false);return {complete:true,errors:[]}};
 await power.tick();ok(channelCalls.length===1&&channelCalls[0]==='one@newsletter'&&!power.jobs().find(x=>x.id===j2.id).enabled,'cancelling the next channel schedule during a send prevents its send');
 console.log(`PASS: ${n} scheduled cancellation checks`);
})().catch(e=>{console.error(e);process.exitCode=1}).finally(()=>{numbers.getSocket=originals.get;numbers.statusOf=originals.status;pipeline.switches=originals.switches;pub.publish=originals.publish;d.close();fs.rmSync(root,{recursive:true,force:true})});
