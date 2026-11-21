'use strict';
// Synthetic SQLite only. No provider or existing user state is accessed.
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'raq-rate-time-synthetic-'));process.env.RAQ_STATE_DIR=dir;require('../src/config').ensureDirs();const {open,CH,P}=require('../src/db'),d=open();let n=0;const ok=(v,s)=>{assert.ok(v,s);n++;console.log('✓ '+s)};
try{
 P.mark('delayed','1','queued','pending');const id=P.postId('delayed','1');d.prepare("UPDATE posts SET created_at=datetime('now','-2 hours') WHERE id=?").run(id);
 ok(CH.publishedLastHour()===0,'an old held post is not counted before a send attempt');
 P.setStatus(id,'published','synthetic accepted');ok(CH.publishedLastHour()===1,'an old queued post is counted from its actual publication time');
 P.setStatus(id,'edited','synthetic edit');ok(CH.publishedLastHour()===1,'editing a recently published post does not erase its rate history');
 P.mark('legacy','2','published','legacy');d.prepare("UPDATE posts SET published_at='' WHERE source_jid='legacy'").run();ok(CH.publishedLastHour()===2,'legacy published rows still use their creation timestamp when actual publish time is unknown');
 P.mark('partial','3','failed','partly delivered');d.prepare("UPDATE posts SET created_at=datetime('now','-2 hours') WHERE source_jid='partial'").run();
 d.prepare("INSERT INTO delivery_attempts(source_jid,source_msg_id,target_jid,part,digest,state) VALUES('partial','3','test@newsletter',0,'synthetic','accepted')").run();
 ok(CH.publishedLastHour()===3,'a partially delivered failed post still counts against the rate guard');
 d.prepare("UPDATE delivery_attempts SET state='uncertain' WHERE source_jid='partial'").run();ok(CH.publishedLastHour()===3,'an uncertain recent send conservatively counts once');
 d.prepare("UPDATE delivery_attempts SET updated_at=datetime('now','-2 hours') WHERE source_jid='partial'").run();ok(CH.publishedLastHour()===2,'old delivery attempts eventually leave the rolling window');
 // Upgrade an intentionally old-format synthetic DB in a separate process.
 const oldRoot=fs.mkdtempSync(path.join(os.tmpdir(),'raq-rate-old-synthetic-'));
 try{
  fs.mkdirSync(path.join(oldRoot,'data'));const old=new (require('better-sqlite3'))(path.join(oldRoot,'data','bot.sqlite'));
  old.exec("CREATE TABLE posts(id INTEGER PRIMARY KEY AUTOINCREMENT,source_jid TEXT,source_msg_id TEXT,status TEXT,reason TEXT,created_at TEXT);INSERT INTO posts(id,source_jid,source_msg_id,status,reason,created_at) VALUES(17,'legacy-source','legacy-message','published','original',datetime('now'));");old.close();
  const script=`const x=require('./src/config');x.ensureDirs();const db=require('./src/db'),d=db.open(),row=d.prepare('SELECT * FROM posts WHERE id=17').get();if(!row||row.source_jid!=='legacy-source'||row.source_msg_id!=='legacy-message'||row.reason!=='original'||row.published_at!==''||db.CH.publishedLastHour()!==1)throw Error('legacy post was not preserved');d.close();`;
  const child=require('node:child_process').spawnSync(process.execPath,['-e',script],{cwd:path.resolve(__dirname,'..'),env:{...process.env,RAQ_STATE_DIR:oldRoot},encoding:'utf8'});
  assert.equal(child.status,0,child.stderr);ok(true,'legacy database migration preserves the original ID and row while using the fallback rate window');
 }finally{fs.rmSync(oldRoot,{recursive:true,force:true});}
 console.log(`PASS: ${n} synthetic rate-publication-time checks`);
}finally{d.close();fs.rmSync(dir,{recursive:true,force:true})}
