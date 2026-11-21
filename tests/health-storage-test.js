'use strict';
// No network; isolated synthetic state, before the test phase.
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'raq-health-synthetic-'));process.env.RAQ_STATE_DIR=dir;require('../src/config').ensureDirs();const d=require('../src/db').open();
const wa=require('../src/wa'),persist=require('../src/persist'),ai=require('../src/ai'),power=require('../src/power');wa.getStatus=()=>({status:'closed'});persist.publicStatus=()=>({enabled:false});ai.usable=()=>false;power.jobs=()=>[];
const health=require('../src/health'),old=fs.statfsSync;let n=0;const ok=(x,s)=>{assert.ok(x,s);n++;console.log('✓ '+s)};
try{
 fs.statfsSync=()=>({bavail:200000,bsize:4096,blocks:1000000});let score=health.score(),storage=score.parts.find(x=>x.id==='storage'),cloud=score.parts.find(x=>x.id==='cloud');ok(storage.score===55&&/filesystem free/.test(storage.note),'health uses actual filesystem free-space data rather than a fixed database size budget');ok(/persistent storage/.test(cloud.note)&&!/every deploy/.test(cloud.note),'cloud-off warning does not falsely promise a QR relink on every deploy');
 persist.publicStatus=()=>({enabled:true,lastSyncAt:'',lastError:'',writeBlocked:false});cloud=health.score().parts.find(x=>x.id==='cloud');ok(cloud.score===50&&/no confirmed sync/.test(cloud.note),'enabled cloud without a successful sync is not reported as synced');
 persist.publicStatus=()=>({enabled:true,lastSyncAt:'2026-01-01',writeBlocked:true});cloud=health.score().parts.find(x=>x.id==='cloud');ok(cloud.score===30&&/blocked/.test(cloud.note),'blocked cloud writes are visible despite an older sync');
 fs.statfsSync=()=>{throw Error('synthetic filesystem failure')};score=health.score();storage=score.parts.find(x=>x.id==='storage');ok(storage.score===50&&/unknown/.test(storage.note),'unavailable free-space information is reported as unknown');
 console.log('PASS: '+n+' synthetic health storage checks');
}finally{fs.statfsSync=old;d.close();fs.rmSync(dir,{recursive:true,force:true});}
