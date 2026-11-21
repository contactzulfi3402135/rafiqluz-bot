'use strict';
// Exercise the service-worker routing contract without a browser or network.
const fs=require('fs'),vm=require('vm'),assert=require('assert');
const handlers={},writes=[],deleted=[];let skipped=false,claimed=false,network=0;
const cache={addAll:async()=>{},put:async req=>writes.push(req.url)};
const context={URL,Promise,self:{location:{origin:'https://example.test'},addEventListener:(name,fn)=>{handlers[name]=fn},skipWaiting:async()=>{skipped=true},clients:{claim:async()=>{claimed=true}}},caches:{open:async()=>cache,keys:async()=>['raqifluz-craft-v34','raqifluz-craft-v35'],delete:async k=>{deleted.push(k)},match:async()=>({offline:true})},fetch:async()=>{network++;return {ok:true,clone:()=>({})}}};
vm.runInNewContext(fs.readFileSync(require.resolve('../src/web/assets/sw.js'),'utf8'),context);
(async()=>{
 let n=0;const ok=(v,s)=>{assert.ok(v,s);n++;console.log('✓ '+s)};
 let promise;handlers.install({waitUntil:p=>{promise=p}});await promise;ok(skipped,'worker install completes and calls skipWaiting');
 handlers.activate({waitUntil:p=>{promise=p}});await promise;ok(claimed&&deleted.includes('raqifluz-craft-v34')&&!deleted.includes('raqifluz-craft-v35'),'worker activation replaces old cache');
 function event(url,method='GET'){let response;handlers.fetch({request:{url,method},respondWith:p=>{response=p}});return response;}
 ok(!event('https://example.test/api/telegram/schedules')&&!event('https://example.test/admin')&&!event('https://example.test/private-report'),'private and unlisted URLs are not cached');
 ok(!event('https://elsewhere.test/app.js')&&!event('https://example.test/app.js','POST'),'other origins and mutations are not intercepted');
 await event('https://example.test/app.js');await new Promise(r=>setImmediate(r));ok(network===1&&writes[0]==='https://example.test/app.js','public shell uses network first and caches a successful response');
 context.fetch=async()=>{throw Error('offline')};const offline=await event('https://example.test/app.js');ok(offline.offline,'public shell can fall back to cache offline');
 console.log(`PASS: ${n} service-worker checks`);
})().catch(e=>{console.error(e);process.exitCode=1});
