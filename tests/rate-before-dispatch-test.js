'use strict';
// Synthetic SQLite and a mocked WhatsApp adapter; no external network.
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'raq-rate-before-send-'));process.env.RAQ_STATE_DIR=dir;require('../src/config').ensureDirs();const db=require('../src/db'),d=db.open(),wa=require('../src/wa'),pub=require('../src/publish'),pace=require('../src/pace');let n=0;
const ok=(x,s)=>{assert.ok(x,s);n++;console.log('✓ '+s)};const originals={getSocket:wa.getSocket,getStatus:wa.getStatus,channelMeta:wa.channelMeta,sendToChannel:wa.sendToChannel,recordPub:db.CH.recordPub,gapMin:pace.gapMin};
(async()=>{try{
 db.CH.addTarget('synthetic@newsletter','Synthetic','test');wa.getSocket=()=>({});wa.getStatus=()=>({status:'open'});wa.channelMeta=async()=>({role:'OWNER'});pace.gapMin=()=>0;let calls=0,seen=0;
 wa.sendToChannel=async()=>{calls++;seen=db.CH.pubCountLastHour('synthetic@newsletter');return 'synthetic-provider-id'};
 db.CH.recordPub=()=>{throw Error('synthetic rate journal failure')};const failure=await pub.publish({text:'test'},{sourceJid:'source',sourceMsgId:'first',only:['synthetic@newsletter']});
 ok(!failure.complete&&calls===0,'a rate-journal failure prevents the external send');
 ok(require('../src/delivery-ledger').hasUnresolved('source','first'),'a failed pre-dispatch journal remains conservatively reviewable');
 db.CH.recordPub=originals.recordPub;const success=await pub.publish({text:'test'},{sourceJid:'source',sourceMsgId:'second',only:['synthetic@newsletter']});
 ok(success.complete&&calls===1&&seen===1,'the rate slot is visible before the provider is called');
 console.log(`PASS: ${n} synthetic pre-dispatch rate-journal checks`);
 }finally{wa.getSocket=originals.getSocket;wa.getStatus=originals.getStatus;wa.channelMeta=originals.channelMeta;wa.sendToChannel=originals.sendToChannel;db.CH.recordPub=originals.recordPub;pace.gapMin=originals.gapMin;d.close();fs.rmSync(dir,{recursive:true,force:true})}
})().catch(e=>{console.error(e);process.exitCode=1});
