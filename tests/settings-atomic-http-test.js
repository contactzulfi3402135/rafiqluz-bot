'use strict';
// Synthetic state and loopback HTTP only; written before the test phase.
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),express=require('express');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'raq-settings-http-synthetic-'));process.env.RAQ_STATE_DIR=root;process.env.SESSION_SECRET='synthetic-session-secret-long-enough';require('../src/config').ensureDirs();const db=require('../src/db'),d=db.open();db.S.set('api.key','synthetic-api-key-at-least-32-characters');db.S.set('bot_name','before');db.S.set('blocklist.words','before');db.S.set('channels.automonitor','0');let n=0;
const ok=(x,s)=>{assert.ok(x,s);n++;console.log('✓ '+s)};
(async()=>{let server;try{
 const app=express();require('../src/web/server').build(app);server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s))});const url='http://127.0.0.1:'+server.address().port+'/api/settings';
 async function post(body){return fetch(url,{method:'POST',headers:{'x-api-key':'synthetic-api-key-at-least-32-characters','content-type':'application/json'},body:JSON.stringify(body)})}
 let callbacks=0;db.S.onChange=()=>callbacks++;
 d.exec("CREATE TRIGGER synthetic_settings_failure BEFORE INSERT ON settings WHEN NEW.key='blocklist.words' BEGIN SELECT RAISE(ABORT,'synthetic failure'); END;");
 let r=await post({automonitor:true,botName:'after',blocklist:'after'});ok(r.status===500,'failed settings batch returns an error');ok(db.S.get('bot_name')==='before'&&db.S.get('blocklist.words')==='before'&&db.S.get('channels.automonitor')==='0','failed batch rolls back every settings change');ok(callbacks===0,'failed batch does not notify persistence hooks');
 d.exec('DROP TRIGGER synthetic_settings_failure');r=await post({automonitor:'false',botName:'invalid'});ok(r.status===400&&db.S.get('bot_name')==='before','invalid automation flag rejects the whole request');
 r=await post({blocklistRegex:'false',botName:'invalid'});ok(r.status===400&&db.S.get('bot_name')==='before','string false is rejected for other boolean settings');
 r=await post({automonitor:true,botName:'after',blocklist:'after'});ok(r.status===200&&db.S.get('bot_name')==='after'&&db.S.get('blocklist.words')==='after'&&db.S.get('channels.automonitor')==='1','valid batch commits together');ok(callbacks===3,'successful batch notifies hooks after commit');
 console.log('PASS: '+n+' synthetic atomic settings HTTP checks');
 }finally{db.S.onChange=null;if(server)await new Promise(r=>server.close(r));d.close();fs.rmSync(root,{recursive:true,force:true})}
})().catch(e=>{console.error(e);process.exitCode=1});
