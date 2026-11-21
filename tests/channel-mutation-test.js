'use strict';
// Local mock-only channel mutation safety checks. No provider is contacted.
const fs=require('fs'),path=require('path'),os=require('os'),assert=require('assert');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'raq-channel-mutate-'));
const cfg=require('../src/config');cfg.config.paths.database=path.join(root,'bot.sqlite');cfg.config.paths.sessions=path.join(root,'sessions');
const db=require('../src/db'),d=db.open(),wa=require('../src/wa'),pub=require('../src/publish'),queue=require('../src/queue5a');
require('../src/pace').gapMin=()=>0;let role='OWNER',calls=[],n=0,panicDuring=false,networkError=false;
const sock={newsletterMetadata:async()=>{if(panicDuring)db.S.set('panic.on','1');if(role==='ERROR')throw Error('unavailable');return {name:'Synthetic',viewer_metadata:{role}};},query:async req=>{calls.push(req.node);if(networkError)throw Error('lost response');return {}}};
wa.getSocket=()=>sock;wa.getStatus=()=>({status:'open'});const ok=(v,label)=>{assert.ok(v,label);n++;console.log('✓ '+label)};
(async()=>{
 await assert.rejects(()=>wa.deleteChannelPost(sock,'12345@g.us','id'),/channel is required/);ok(calls.length===0,'group target is rejected before deletion');
 role='SUBSCRIBER';await assert.rejects(()=>wa.deleteChannelPost(sock,'a@newsletter','id'),/owner\/admin/);ok(calls.length===0,'subscriber cannot delete from a channel');
 role='ERROR';await assert.rejects(()=>wa.editChannelPost(sock,'a@newsletter','id','new'),/owner\/admin/);ok(calls.length===0,'unavailable permission lookup blocks an edit');
 role='ADMIN';panicDuring=true;await assert.rejects(()=>wa.deleteChannelPost(sock,'a@newsletter','id'),/Panic/);ok(calls.length===0,'panic activated during permission lookup stops mutation');panicDuring=false;db.S.set('panic.on','0');
 await wa.editChannelPost(sock,'a@newsletter','edit-id','new');await wa.deleteChannelPost(sock,'a@newsletter','delete-id');ok(calls.length===2&&calls[0].attrs.edit==='1'&&calls[1].attrs.edit==='8','verified admin can request edits and deletes using the correct mock stanzas');
 networkError=true;await assert.rejects(()=>wa.deleteChannelPost(sock,'a@newsletter','delete-id'),/not confirmed/);networkError=false;ok(true,'a lost provider response is described as uncertain');
 let before=calls.length;const rejected=await pub.deletePublished([{target:'a@newsletter',msgId:'not-a-bot-copy'}]);ok(rejected.done===0&&rejected.errors.length===1&&calls.length===before,'unrecorded channel posts cannot be deleted via the bot history API');
 db.P.mark('synthetic-source','synthetic-msg','published','original');let post=db.P.postId('synthetic-source','synthetic-msg');db.P.addKey(post,'a@newsletter','bot-copy');
 const deleted=await pub.deletePublished([{target:'a@newsletter',msgId:'bot-copy'}]);ok(deleted.done===1&&calls.at(-1).attrs.id==='bot-copy','recorded bot copy can receive a deletion request');
 before=calls.length;const duplicate=await pub.deletePublished([{target:'a@newsletter',msgId:'bot-copy'},{target:'a@newsletter',msgId:'bot-copy'}]);ok(duplicate.done===1&&calls.length===before+1,'duplicate selected copies produce only one deletion request');
 before=calls.length;await assert.rejects(()=>pub.editPublished('synthetic-source','synthetic-msg',' '),/1 and 4,096/);await assert.rejects(()=>pub.editPublished('synthetic-source','synthetic-msg','x'.repeat(4097)),/1 and 4,096/);ok(calls.length===before,'blank or oversized edits are refused before provider calls');
 db.P.mark('partial-source','partial-msg','published','fixture','Original text');let partial=db.P.postId('partial-source','partial-msg');db.P.addKey(partial,'c@newsletter','partial-one');db.P.addKey(partial,'d@newsletter','partial-two');const query=sock.query;sock.query=async o=>{if(o.node.attrs.id==='partial-two')throw Error('response lost');return query(o)};
 const partly=await pub.editPublished('partial-source','partial-msg','New text');const retained=d.prepare('SELECT body,reason FROM posts WHERE id=?').get(partial);sock.query=query;ok(partly.ok===1&&partly.errors.length===1&&retained.body==='Original text'&&/not confirmed/.test(retained.reason),'partial edits preserve original history text and request review');

 await assert.rejects(()=>pub.deletePublished(Array(301).fill({target:'a@newsletter',msgId:'bot-copy'})),/at most 300/);ok(true,'an oversized deletion request is rejected instead of truncated');
 wa.fetchChannelPosts=async()=>[{key:{id:'someone-elses-post'},messageTimestamp:Math.floor(Date.now()/1000)}];
 const range={iso:'2000-01-01 00:00:00',ts:0},end={iso:'9999-12-31 23:59:59',ts:253402300799};before=calls.length;
 const result=await pub.purgeByDate('a@newsletter',range,end);ok(result.attempted===1&&result.deleted===1&&calls.length===before+1&&calls.at(-1).attrs.id==='bot-copy'&&result.remaining===null&&/not fully verified/.test(result.note),'date-range purge only requests recorded bot copies and never claims full verification');
 wa.fetchChannelPosts=async()=>{throw Error('unavailable')};const noRows=await pub.purgeByDate('b@newsletter',range,end);ok(noRows.attempted===0&&noRows.remaining===null&&/does not prove/.test(noRows.note),'an empty local range does not claim the channel is clean');
 d.transaction(()=>{for(let i=0;i<301;i++){const id=d.prepare("INSERT INTO posts(source_jid,source_msg_id,status,created_at) VALUES('range',?,'published','2020-01-01 00:00:00')").run(String(i)).lastInsertRowid;d.prepare("INSERT INTO post_keys(post_id,target_jid,msg_id) VALUES(?,'bulk@newsletter',?)").run(id,'copy-'+i)}})();
 before=calls.length;await assert.rejects(()=>pub.purgeByDate('bulk@newsletter',range,end),/narrower date range/);ok(calls.length===before,'a range above 300 copies is refused before any deletion');
 const undo=await queue.undoLast('a@newsletter');ok(undo.verified===false&&/check the channel/i.test(undo.note)&&db.P.keys(post).some(k=>k.msg_id==='bot-copy'),'undo keeps the recorded message ID until owner verification');
 console.log(`PASS: ${n} channel mutation safety checks`);
})().catch(e=>{console.error(e);process.exitCode=1}).finally(()=>{d.close();fs.rmSync(root,{recursive:true,force:true})});
