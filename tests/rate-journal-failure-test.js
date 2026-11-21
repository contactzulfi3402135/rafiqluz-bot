'use strict';
// Only synthetic SQLite data is touched. No provider connection is opened.
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'raq-rate-synthetic-'));process.env.RAQ_STATE_DIR=dir;require('../src/config').ensureDirs();const {open,CH}=require('../src/db'),d=open();let n=0;
function ok(x,s){assert.ok(x,s);n++;console.log('✓ '+s)}
try{
 CH.recordPub('synthetic@newsletter');ok(CH.pubCountLastHour('synthetic@newsletter')===1,'successfully recorded target is counted');
 ok(CH.reservePub('synthetic@newsletter',1)===false&&CH.pubCountLastHour('synthetic@newsletter')===1,'atomic reservation refuses an exhausted rate budget');
 ok(CH.reservePub('synthetic@newsletter',2)===true&&CH.pubCountLastHour('synthetic@newsletter')===2,'atomic reservation records the next available slot');
 d.pragma('query_only=ON');assert.throws(()=>CH.recordPub('synthetic@newsletter'));d.pragma('query_only=OFF');ok(CH.pubCountLastHour('synthetic@newsletter')===2,'failed rate-journal write propagates without pretending to record a send');
 d.exec('ALTER TABLE target_publish_log RENAME TO target_publish_log_synthetic');assert.throws(()=>CH.pubCountLastHour('synthetic@newsletter'));d.exec('ALTER TABLE target_publish_log_synthetic RENAME TO target_publish_log');ok(true,'failed target rate read does not become an empty history');
 d.exec('ALTER TABLE posts RENAME TO posts_synthetic');assert.throws(()=>CH.publishedLastHour());d.exec('ALTER TABLE posts_synthetic RENAME TO posts');ok(true,'failed global rate read does not become an empty history');
 console.log('PASS: '+n+' synthetic rate journal failure checks');
}finally{d.close();fs.rmSync(dir,{recursive:true,force:true});}
