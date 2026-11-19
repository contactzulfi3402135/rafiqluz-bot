'use strict';
// ONLY an isolated, disconnected server; these checks modify settings and data.
const assert=require('assert');
if(process.env.TEST_ALLOW_MUTATIONS!=='1') throw Error('Use an isolated server and TEST_ALLOW_MUTATIONS=1.');
const base=process.env.TEST_URL||'http://127.0.0.1:20252'; let n=0;
function ok(x,label){assert.ok(x,label);console.log('✓ '+label);n++;}
async function run(){
 const login=await fetch(base+'/login',{method:'POST',headers:{'content-type':'application/json','accept':'application/json'},body:JSON.stringify({username:'admin',password:process.env.TEST_PASSWORD||'owner-test-password'})});
 const token=(await login.json()).token; const h={authorization:'Bearer '+token,'content-type':'application/json'};
 async function req(p,method='GET',body){return fetch(base+p,{method,headers:h,body:body===undefined?undefined:JSON.stringify(body)});}
 let r=await req('/api/queue/delay','POST',{min:1});ok(r.status===200,'delay action is not shadowed by item route');
 r=await req('/api/queue/approve-all','POST',{});ok(r.status===200,'bulk approval route is reachable');
 r=await req('/api/queue/retry-all','POST',{});ok(r.status===200,'retry-all route is reachable');
 r=await req('/api/power/scheduler','POST',{jid:'test@newsletter',text:'test',at:new Date(Date.now()+3600000).toISOString(),repeat:'once'});let job=(await r.json()).job;ok(Boolean(job?.id),'schedule created');
 r=await req('/api/power/scheduler/'+job.id,'PATCH',{repeat:'daily',enabled:false});let j=(await r.json()).job;ok(r.status===200&&j.repeat==='daily'&&j.enabled===false,'schedule edits and pause persist together');
 r=await req('/api/power/scheduler/'+job.id,'PATCH',{enabled:true});j=(await r.json()).job;ok(j.enabled===true && j.repeat==='daily','schedule resume preserves repeat');
 await req('/api/power/scheduler/'+job.id,'DELETE');
 r=await req('/api/power/aisafety','POST',{criteria:'be accurate',unavailable:'review'}); r=await req('/api/power/aisafety');j=await r.json();ok(j.unavailable==='review','AI safety fallback setting persists');
 r=await req('/api/ai','POST',{contentSharing:false});r=await req('/api/ai');j=await r.json();ok(j.contentSharing===false,'AI external content sharing state is visible');
 r=await req('/api/delivery/review');j=await r.json();ok(r.status===200&&Array.isArray(j.items),'owner can load review list');
 r=await req('/api/delivery/review/999999','POST',{action:'retry'});j=await r.json();ok(r.status===400&&/confirm/i.test(j.error),'review requires explicit confirmation');
 r=await fetch(base+'/api/delivery/review');ok(r.status===401,'delivery review requires authentication');
 console.log(`PASS: ${n} operations API checks`);
}
run().catch(e=>{console.error(e);process.exitCode=1});
