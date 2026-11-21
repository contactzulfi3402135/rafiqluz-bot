'use strict';
// Single-process synthetic subscription probes. No WhatsApp connection is used.
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'raq-sub-pass-'));process.env.RAQ_STATE_DIR=root;
const cfg=require('../src/config');cfg.ensureDirs();const db=require('../src/db'),d=db.open(),wa=require('../src/wa'),ch=require('../src/channels');
let n=0;const ok=(v,s)=>{assert.ok(v,s);n++;console.log('✓ '+s)};
let sock={},status='open',calls=[],gate,started;wa.getSocket=()=>sock;wa.getStatus=()=>({status});
wa.subscribeChannel=async(_s,jid)=>{calls.push(jid);if(gate)await gate;return {duration:3600}};
for(const j of ['a@newsletter','b@newsletter','c@newsletter','feed@rss'])db.CH.addSource(j,j,'test');
d.prepare("UPDATE sources SET kind='rss' WHERE jid='feed@rss'").run();
(async()=>{try{
 let release;gate=new Promise(r=>release=r);const first=ch.runSubscriptionPass({paceMs:0,wait:async()=>{}});while(!calls.length)await new Promise(r=>setImmediate(r));
 const second=await ch.runSubscriptionPass({onlyDue:true,paceMs:0,wait:async()=>{}});ok(second.busy&&calls.length===1,'overlapping subscription timers do not start another pass');
 release();gate=null;let r=await first;ok(r.attempted===3&&r.confirmed===3&&!calls.includes('feed@rss'),'single pass attempts WhatsApp sources only and reports confirmations');
 calls=[];r=await ch.runSubscriptionPass({onlyDue:true,paceMs:0,wait:async()=>{}});ok(r.attempted===0&&calls.length===0,'not-yet-due subscriptions are skipped');
 calls=[];let old=sock;gate=new Promise(resolve=>release=resolve);const interrupted=ch.runSubscriptionPass({paceMs:0,wait:async()=>{}});while(!calls.length)await new Promise(r=>setImmediate(r));sock={};release();gate=null;r=await interrupted;
 ok(r.aborted&&r.confirmed===0&&calls.length===1,'a replaced socket aborts the stale pass and does not confirm its response');
 calls=[];r=await ch.runSubscriptionPass({paceMs:0,wait:async()=>{}});ok(!r.busy&&r.attempted===3,'a fresh pass can start after an interrupted pass');
 db.CH.pauseSource('b@newsletter',true);calls=[];r=await ch.runSubscriptionPass({paceMs:0,wait:async()=>{}});ok(r.attempted===2&&!calls.includes('b@newsletter'),'paused sources are excluded');
 status='closed';r=await ch.runSubscriptionPass({paceMs:0,wait:async()=>{}});ok(r.aborted&&!r.attempted,'closed connection does not start provider calls');
 status='open';db.CH.pauseSource('b@newsletter',false);
 const oldInterval=global.setInterval,oldTimeout=global.setTimeout,oldFetch=wa.fetchChannelPosts,oldReconnect=wa.forceReconnect;let poll,sequence=[],reconnects=0;
 global.setInterval=fn=>{poll=fn;return {unref(){}}};global.setTimeout=(fn,ms)=>{if(ms===2000){sequence.push('pace');queueMicrotask(fn)}return {unref(){}}};
 wa.fetchChannelPosts=async(_socket,j)=>{sequence.push(j);throw Error('synthetic fetch failure')};wa.forceReconnect=()=>{reconnects++};
 try {ch.startPullPoll();await poll();ok(sequence.join(',')==='a@newsletter,pace,b@newsletter,pace,c@newsletter,pace','failed pull fetches are paced and RSS is excluded');
   sequence=[];wa.fetchChannelPosts=async(_socket,j)=>{sequence.push(j);sock={};throw Error('stale connection')};await poll();ok(sequence.join(',')==='a@newsletter,pace'&&reconnects===0,'pull pass stops when socket changes and does not reconnect the replacement');
 } finally {global.setInterval=oldInterval;global.setTimeout=oldTimeout;wa.fetchChannelPosts=oldFetch;wa.forceReconnect=oldReconnect;}
 for(const j of ['a@newsletter','b@newsletter','c@newsletter'])db.CH.pauseSource(j,true);let fetches=0;wa.fetchChannelPosts=async()=>{fetches++;throw Error('unexpected provider call')};
 r=await ch.catchUp({dryRun:false});ok(fetches===0&&r.fed===0&&/sampled history/.test(r.note)&&r.failed===0,'catch-up excludes RSS and avoids claiming complete recovery');
 db.CH.pauseSource('a@newsletter',false);const timeout=global.setTimeout;global.setTimeout=(fn,ms)=>{if(ms===2500)queueMicrotask(fn);return {unref(){}}};try{r=await ch.missedList({hours:1});ok(r.attempted===1&&r.failed===1&&r.totalMissed===0&&/fetch errors/i.test(r.note),'catch-up reports failed provider reads instead of implying no missed posts');}finally{global.setTimeout=timeout;db.CH.pauseSource('a@newsletter',true)}
 await ch.recoverMissed();const summary=JSON.parse(db.S.get('recovery.last'));ok(summary.fed===0&&summary.outcomesKnown===false&&!('recovered' in summary),'recovery records submitted candidates without attributing unrelated history outcomes');
 console.log('PASS: '+n+' subscription-pass safety checks');
 }finally{d.close();fs.rmSync(root,{recursive:true,force:true})}})().catch(e=>{console.error(e);process.exitCode=1});
