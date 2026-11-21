'use strict';
// Synthetic SQLite state only. Written before the requested test phase.
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'raq-settings-synthetic-'));process.env.RAQ_STATE_DIR=dir;
const {config,ensureDirs}=require('../src/config');ensureDirs();const {open,S}=require('../src/db');const d=open();let n=0;
function ok(x,s){assert.ok(x,s);n++;console.log('✓ '+s)}
try{
 ok(S.get('synthetic.missing','fallback')==='fallback','missing setting receives its explicit fallback');
 S.set('synthetic.key','saved');ok(S.get('synthetic.key')==='saved','successful settings write remains readable');
 let changes=0;S.onChange=()=>changes++;d.pragma('query_only=ON');assert.throws(()=>S.set('synthetic.key','not-saved'));ok(S.get('synthetic.key')==='saved'&&changes===0,'write failure propagates and does not notify a successful change');d.pragma('query_only=OFF');
 d.exec('ALTER TABLE settings RENAME TO settings_synthetic_saved');assert.throws(()=>S.get('synthetic.key','unsafe-default'));ok(true,'read failure is not mistaken for a missing setting');d.exec('ALTER TABLE settings_synthetic_saved RENAME TO settings');
 console.log('PASS: '+n+' synthetic settings failure checks');
}finally{S.onChange=null;d.close();fs.rmSync(dir,{recursive:true,force:true});}
