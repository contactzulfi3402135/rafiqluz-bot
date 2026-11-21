'use strict';
// Synthetic SQLite only; no network or provider calls.
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'raq-panic-synthetic-'));process.env.RAQ_STATE_DIR=dir;require('../src/config').ensureDirs();const db=require('../src/db'),d=db.open(),panic=require('../src/panic');let n=0;
const ok=(x,s)=>{assert.ok(x,s);n++;console.log('✓ '+s)};
try{
 db.S.setMany([['mirror.paused','0'],['panic.on','0'],['panic.state','']]);
 d.exec("CREATE TRIGGER synthetic_panic_fail BEFORE INSERT ON settings WHEN NEW.key='panic.on' BEGIN SELECT RAISE(ABORT,'synthetic failure'); END");assert.throws(()=>panic.stop());ok(!db.S.getBool('panic.on')&&!db.S.getBool('mirror.paused')&&db.S.get('panic.state')==='','failed panic stop does not partially commit settings');
 d.exec('DROP TRIGGER synthetic_panic_fail');panic.stop();ok(panic.active()&&db.S.getBool('mirror.paused'),'successful panic atomically enables both gates');
 d.exec("CREATE TRIGGER synthetic_panic_fail BEFORE INSERT ON settings WHEN NEW.key='panic.on' BEGIN SELECT RAISE(ABORT,'synthetic failure'); END");assert.throws(()=>panic.restore());ok(panic.active()&&db.S.getBool('mirror.paused')&&db.S.get('panic.state')!=='','failed panic restore keeps the panic gate and saved state');
 d.exec('DROP TRIGGER synthetic_panic_fail');panic.restore();ok(!panic.active()&&!db.S.getBool('mirror.paused'),'successful restore returns to the previous running state');
 console.log('PASS: '+n+' synthetic panic transaction checks');
}finally{d.close();fs.rmSync(dir,{recursive:true,force:true});}
