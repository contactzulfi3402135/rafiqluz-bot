'use strict';
// Synthetic SQLite and loopback HTTP only; all outbound workers are stopped.
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),express=require('express');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'raq-queue-decisions-'));process.env.RAQ_STATE_DIR=root;process.env.SESSION_SECRET='synthetic-test-session-secret-at-least-32';require('../src/config').ensureDirs();
const db=require('../src/db'),d=db.open(),queue=require('../src/queue5a');require('../src/lifecycle').begin();let n=0,server;
const ok=(x,s)=>{assert.ok(x,s);n++;console.log('✓ '+s)};
const make=(key,text='original')=>queue.enqueue({sourceJid:'synthetic@newsletter',sourceMsgId:key,text,requireApproval:true,targetJids:['target@newsletter']});
(async()=>{try{
 db.P.mark('source@newsletter','failed-no-queue','failed','original reason','original body',false);const failedPost=d.prepare("SELECT id FROM posts WHERE source_msg_id='failed-no-queue'").get();await assert.rejects(()=>queue.retryOneFailed(failedPost.id),/disabled to preserve/);ok(d.prepare('SELECT status,reason,body FROM posts WHERE id=?').get(failedPost.id).reason==='original reason','retry without durable queue preserves failed history');
 const first=make('first');queue.approve(first);assert.throws(()=>queue.reject(first),/decided/);assert.throws(()=>queue.editText(first,'unexpected'),/decided/);ok(db.Q.one(first).status==='approved'&&db.Q.one(first).text==='original','decided items cannot be rejected or edited by a stale request');
 const second=make('second');queue.approveEdited(second,'updated');ok(db.Q.one(second).status==='approved'&&db.Q.one(second).text==='updated','edited text and approval are committed together');
 const rollback=make('rollback');d.exec("CREATE TRIGGER synthetic_approval_failure BEFORE UPDATE OF status ON approvals WHEN NEW.id="+Number(rollback)+" AND NEW.status='approved' BEGIN SELECT RAISE(ABORT,'synthetic failure'); END");
 assert.throws(()=>queue.approveEdited(rollback,'must roll back'));d.exec('DROP TRIGGER synthetic_approval_failure');ok(db.Q.one(rollback).status==='pending'&&db.Q.one(rollback).text==='original','failed edit-approve retains both original text and pending status');
 const reject=make('reject');d.exec("CREATE TRIGGER synthetic_post_failure BEFORE UPDATE OF status ON posts WHEN OLD.source_msg_id='reject' BEGIN SELECT RAISE(ABORT,'synthetic failure'); END");
 assert.throws(()=>queue.reject(reject));d.exec('DROP TRIGGER synthetic_post_failure');ok(db.Q.one(reject).status==='pending'&&d.prepare("SELECT status FROM posts WHERE source_msg_id='reject'").get().status==='queued','failed rejection rolls back both queue and post changes');
 queue.reject(reject);ok(db.Q.one(reject).status==='rejected'&&d.prepare("SELECT status FROM posts WHERE source_msg_id='reject'").get().status==='skipped','successful rejection updates both records');
 const processing=make('processing');d.prepare("UPDATE approvals SET status='processing' WHERE id=?").run(processing);assert.throws(()=>queue.dismiss(processing),/Only failed/);assert.throws(()=>queue.retry(processing),/Only failed/);ok(db.Q.one(processing).status==='processing','dismiss and retry cannot overwrite a processing item');
 const failed=make('failed');d.prepare("UPDATE approvals SET status='failed' WHERE id=?").run(failed);d.prepare("UPDATE posts SET status='failed' WHERE source_msg_id='failed'").run();queue.dismiss(failed);ok(db.Q.one(failed).note==='dismissed by owner'&&d.prepare("SELECT dismissed FROM posts WHERE source_msg_id='failed'").get().dismissed===1,'failed item and failed-post dismissal are committed together');
 const bulkA=make('bulk-a'),bulkB=make('bulk-b');const count=queue.approveAll();ok(count>=2&&db.Q.one(bulkA).status==='approved'&&db.Q.one(bulkB).status==='approved','bulk approval only conditionally approves pending items');
 db.S.set('api.key','synthetic-owner-api-key-123456789');const app=express();require('../src/web/server').build(app);server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s))});
 const http=make('http');const url='http://127.0.0.1:'+server.address().port+'/api/queue/'+http;let response=await fetch(url,{method:'POST',headers:{'content-type':'application/json','x-api-key':'synthetic-owner-api-key-123456789'},body:JSON.stringify({action:'edit-approve',text:'edited through HTTP'})});
 ok(response.status===200&&db.Q.one(http).status==='approved'&&db.Q.one(http).text==='edited through HTTP','real dashboard route uses the atomic edit-and-approve operation');
 response=await fetch(url,{method:'POST',headers:{'content-type':'application/json','x-api-key':'synthetic-owner-api-key-123456789'},body:JSON.stringify({action:'edit-approve',text:'stale'})});ok(response.status===400&&db.Q.one(http).text==='edited through HTTP','stale HTTP edit cannot change an approved item');
 console.log(`PASS: ${n} synthetic queue decision atomicity checks`);
 }finally{if(server)await new Promise(r=>server.close(r));d.close();fs.rmSync(root,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1});
