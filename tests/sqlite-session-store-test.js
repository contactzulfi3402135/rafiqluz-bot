'use strict';
// Synthetic SQLite data and loopback HTTP only; never opens real state.
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'raq-session-synthetic-'));
process.env.RAQ_STATE_DIR=root;process.env.SESSION_SECRET='synthetic-only-session-secret-at-least-32-bytes';process.env.DASHBOARD_SESSION_STORE='sqlite';process.env.DASHBOARD_USERNAME='synthetic-admin';process.env.DASHBOARD_PASSWORD='synthetic-password';
require('../src/config').ensureDirs();const db=require('../src/db'),d=db.open(),{SQLiteSessionStore}=require('../src/sqlite-session-store');const express=require('express');let n=0,server;
const ok=(x,s)=>{assert.ok(x,s);n++;console.log('✓ '+s)};
const call=(store,method,...args)=>new Promise((resolve,reject)=>store[method](...args,(err,value)=>err?reject(err):resolve(value)));
const sid=()=>crypto.randomBytes(32).toString('base64url');
const val=(v,ms=60000)=>({cookie:{expires:new Date(Date.now()+ms),originalMaxAge:ms},authenticated:true,value:v});
async function close(){await new Promise(resolve=>server.close(resolve));server=null}
(async()=>{try{
 const store=new SQLiteSessionStore(d),a=sid(),b=sid();await call(store,'set',a,val('original'));const stored=d.prepare('SELECT sid_hash,payload FROM dashboard_sessions').get();ok(stored.sid_hash===crypto.createHash('sha256').update(a).digest('hex')&&!JSON.stringify(stored).includes(a),'stored session ID is hashed');
 const reopened=new SQLiteSessionStore(d);ok((await call(reopened,'get',a)).value==='original','new store instance reads saved session');
 await call(store,'set',a,val('newer'));await call(reopened,'touch',a,val('stale',120000));ok((await call(store,'get',a)).value==='newer','stale touch cannot overwrite session data');
 await call(store,'destroy',a);await assert.rejects(call(reopened,'set',a,val('resurrect')),/revoked/);ok(await call(store,'get',a)===null,'logout prevents an in-flight stale write from resurrecting the session');
 await call(store,'touch',a,val('no-revive'));ok(await call(store,'get',a)===null,'touch after logout does not recreate session');
 await call(store,'set',b,val('expired'));d.prepare('UPDATE dashboard_sessions SET expires_ms=? WHERE sid_hash=?').run(Date.now()-1000,crypto.createHash('sha256').update(b).digest('hex'));ok(await call(store,'get',b)===null,'expired session is unavailable');await assert.rejects(call(store,'set',b,val('resurrect')),/revoked/);ok(true,'a late write cannot resurrect a session after expiry');
 const c=sid();await call(store,'set',c,val('prune'));d.prepare('UPDATE dashboard_sessions SET expires_ms=0 WHERE sid_hash=?').run(crypto.createHash('sha256').update(c).digest('hex'));ok((await call(store,'pruneExpired'))===1,'sweep removes expired sessions in a bounded batch');await assert.rejects(call(store,'set',c,val('resurrect')),/revoked/);ok(true,'swept sessions cannot be recreated by stale requests');
 await assert.rejects(call(store,'set',sid(),val('x'.repeat(70000))),/size limit/);await assert.rejects(call(store,'set',sid(),{cookie:{expires:'invalid'}}),/expiry/);ok(true,'oversized sessions and invalid expiry fail closed');
 d.pragma('query_only=ON');await assert.rejects(call(store,'set',sid(),val('x')));d.pragma('query_only=OFF');ok(true,'database write failure propagates to the caller');
 async function start(){const app=express();require('../src/web/server').build(app);return new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s))})}
 server=await start();let base='http://127.0.0.1:'+server.address().port;
 let response=await fetch(base+'/login',{method:'POST',headers:{'content-type':'application/json','accept':'application/json'},body:JSON.stringify({username:'synthetic-admin',password:'synthetic-password'})});assert.equal(response.status,200);const cookie=response.headers.get('set-cookie').split(';')[0];ok(Boolean(cookie),'actual dashboard login creates a cookie');
 response=await fetch(base+'/api/security',{headers:{cookie}});ok(response.status===200,'cookie authenticates the actual dashboard');await close();server=await start();base='http://127.0.0.1:'+server.address().port;
 response=await fetch(base+'/api/security',{headers:{cookie}});ok(response.status===200,'cookie remains valid in a new dashboard instance using the same SQLite store and secret');
 d.pragma('query_only=ON');response=await fetch(base+'/logout',{method:'POST',headers:{cookie},redirect:'manual'});d.pragma('query_only=OFF');ok(response.status===503,'failed durable logout reports failure instead of claiming revocation');
 response=await fetch(base+'/api/security',{headers:{cookie}});ok(response.status===200,'failed logout leaves the session available for explicit retry');
 response=await fetch(base+'/logout',{method:'POST',headers:{cookie},redirect:'manual'});assert.equal(response.status,302);response=await fetch(base+'/api/security',{headers:{cookie}});ok(response.status===401,'successful logout revokes dashboard access');
 console.log(`PASS: ${n} synthetic durable session checks`);
 }finally{if(server)await close();d.close();fs.rmSync(root,{recursive:true,force:true})}
})().catch(e=>{console.error(e);process.exitCode=1});
