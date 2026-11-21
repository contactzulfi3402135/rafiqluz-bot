'use strict';
// Synthetic SQLite and held-media folder only; no provider network calls.
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'raq-held-media-synthetic-'));process.env.RAQ_STATE_DIR=dir;require('../src/config').ensureDirs();const db=require('../src/db'),d=db.open(),queue=require('../src/queue5a');let n=0;const ok=(x,s)=>{assert.ok(x,s);n++;console.log('✓ '+s)};
try{
 const hold=path.join(dir,'data','media-hold');fs.mkdirSync(hold,{recursive:true});fs.writeFileSync(path.join(hold,'1.jpg'),'existing-recovery-bytes');
 assert.throws(()=>queue.enqueue({sourceJid:'collision@newsletter',sourceMsgId:'m1',text:'x',mediaBuf:Buffer.from('new'),mediaKind:'image',requireApproval:true}),/existing attachment was not overwritten/);
 ok(fs.readFileSync(path.join(hold,'1.jpg'),'utf8')==='existing-recovery-bytes','queue never overwrites an existing held attachment');ok(d.prepare("SELECT count(*) n FROM approvals WHERE source_jid='collision@newsletter'").get().n===0,'failed attachment insertion rolls back the approval row');
 fs.unlinkSync(path.join(hold,'1.jpg'));d.exec("CREATE TRIGGER synthetic_hold_failure BEFORE UPDATE OF media_path ON approvals BEGIN SELECT RAISE(ABORT,'synthetic failure'); END");
 assert.throws(()=>queue.enqueue({sourceJid:'rollback@newsletter',sourceMsgId:'m2',text:'x',mediaBuf:Buffer.from('recoverable'),mediaKind:'image',requireApproval:true}));
 ok(d.prepare("SELECT count(*) n FROM approvals WHERE source_jid='rollback@newsletter'").get().n===0&&d.prepare("SELECT count(*) n FROM posts WHERE source_jid='rollback@newsletter'").get().n===0,'failed association rolls back both database rows');ok(fs.readFileSync(path.join(hold,'1.jpg'),'utf8')==='recoverable','orphaned attachment is retained for manual recovery after database rollback');
 d.exec('DROP TRIGGER synthetic_hold_failure');assert.throws(()=>queue.enqueue({sourceJid:'retry@newsletter',sourceMsgId:'m3',text:'x',mediaBuf:Buffer.from('other'),mediaKind:'image',requireApproval:true}));ok(fs.readFileSync(path.join(hold,'1.jpg'),'utf8')==='recoverable','a later attempt cannot overwrite the retained orphan');
 fs.unlinkSync(path.join(hold,'1.jpg'));const id=queue.enqueue({sourceJid:'ok@newsletter',sourceMsgId:'m4',text:'x',mediaBuf:Buffer.from('ok'),mediaKind:'image',requireApproval:true});const row=db.Q.one(id);ok(Boolean(row.media_path)&&fs.readFileSync(row.media_path,'utf8')==='ok'&&!!db.P.postId('ok@newsletter','m4'),'normal queue insertion commits the attachment reference and post row');
 console.log('PASS: '+n+' synthetic queued-media atomicity checks');
}finally{d.close();fs.rmSync(dir,{recursive:true,force:true});}
