'use strict';
// State-free HTTP tests using an isolated SQLite database and mock AI.
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
process.env.DASHBOARD_USERNAME='admin';process.env.DASHBOARD_PASSWORD='test-pass';process.env.SESSION_SECRET='test-only-long-session-secret';
const root=fs.mkdtempSync(path.join(os.tmpdir(),'raq-editor-web-'));
const cfg=require('../src/config');cfg.config.paths.database=path.join(root,'db.sqlite');cfg.config.paths.sessions=path.join(root,'sessions');
const db=require('../src/db'),d=db.open(),ai=require('../src/ai');ai.callFor=async()=>JSON.stringify({decision:'publish',reason:'ok',text:'Original factual text',promotion:'Follow for more'});
const app=require('express')();require('../src/web/server').build(app);let n=0;const ok=(v,m)=>{assert.ok(v,m);n++;console.log('✓ '+m)};
(async()=>{const server=await new Promise(r=>{const s=app.listen(0,'127.0.0.1',()=>r(s))});const base='http://127.0.0.1:'+server.address().port;
 try {let r=await fetch(base+'/api/ai/editor');ok(r.status===401,'editor settings require authentication');
 r=await fetch(base+'/login',{method:'POST',headers:{'content-type':'application/json',accept:'application/json'},body:JSON.stringify({username:'admin',password:'test-pass'})});const headers={authorization:'Bearer '+(await r.json()).token,'content-type':'application/json'};
 const req=(p,body)=>fetch(base+p,body===undefined?{headers}:{method:'POST',headers,body:JSON.stringify(body)});
 r=await req('/api/ai/editor');let j=await r.json();ok(j.enabled===false && !j.semantic && !j.skipAds && !j.cleanContacts && j.footerMode==='adaptive' && j.timezone==='Asia/Karachi','default settings do not turn on automation');
 r=await req('/api/ai/editor',{enabled:true,semantic:false,skipAds:true,cleanContacts:true,instruction:'Keep original facts',footer:'My footer',footerMode:'fixed',domains:'official.edu.pk',timezone:'Asia/Karachi'});j=await r.json();ok(r.status===200&&j.enabled&&j.footer==='My footer','owner can save full policy');
 r=await req('/api/ai/editor',{timezone:'bad zone',enabled:false});ok(r.status===400,'invalid time zone is rejected');r=await req('/api/ai/editor');ok((await r.json()).enabled,'invalid save did not change configuration');
 const before=d.prepare('SELECT COUNT(*) n FROM posts').get().n;r=await req('/api/ai/editor/preview',{text:'Original factual text'});j=await r.json();ok(j.decision==='publish'&&j.footer.includes('My footer'),'preview uses saved policy and footer');ok(d.prepare('SELECT COUNT(*) n FROM posts').get().n===before && db.Q.pending().length===0,'preview neither publishes nor queues');
 r=await req('/api/ai/editor/preview',{text:''});ok(r.status===400,'empty preview is rejected');
 // Long assistant task must return immediately and remain idempotent if the
 // starting HTTP response is lost. No real provider or send is contacted.
 const control=require('../src/aicontrol'), originalChat=control.chat;
 let resolveChat, chatCalls=0;control.chat=async()=>{chatCalls++;return await new Promise(resolve=>{resolveChat=resolve})};
 const taskId='test_unique_request_id_0123456789';
 r=await req('/api/ai/tasks',{kind:'chat',text:'publish a real test post',requestId:taskId});ok(r.status===202,'long chat returns immediately with task ID');
 r=await req('/api/ai/tasks',{kind:'chat',text:'publish a real test post',requestId:taskId});ok(r.status===202 && chatCalls===1,'repeating a task identifier cannot repeat a send');
 r=await req('/api/ai/tasks/'+taskId);j=await r.json();ok(j.status==='running','task can be polled while processing');
 r=await req('/api/ai/tasks',{kind:'chat',text:'different text',requestId:taskId});ok(r.status===409 && chatCalls===1,'task ID cannot be reused with different content');
 const login2=await fetch(base+'/login',{method:'POST',headers:{'content-type':'application/json',accept:'application/json'},body:JSON.stringify({username:'admin',password:'test-pass'})}); const token2=(await login2.json()).token;
 r=await fetch(base+'/api/ai/tasks/'+taskId,{headers:{authorization:'Bearer '+token2}});ok(r.status===404,'another session cannot read the task');
 resolveChat({reply:'Provider accepted the post.',actions:[{tool:'post_text',ok:true,result:{published:true}}]});await new Promise(resolve=>setImmediate(resolve));
 r=await req('/api/ai/tasks/'+taskId);j=await r.json();ok(j.status==='done'&&j.result.actions[0].result.published,'completed background task returns truthful result');
 r=await req('/api/ai/tasks',{kind:'chat',text:'publish a real test post',requestId:taskId});ok(r.status===202&&chatCalls===1,'replay after completion does not execute again');control.chat=originalChat;
 r=await req('/api/ai/tasks',{kind:'preview',text:'Original factual text',requestId:'preview_task_0123456789012345'});ok(r.status===202,'preview also uses background task');await new Promise(resolve=>setImmediate(resolve));
 r=await req('/api/ai/tasks/preview_task_0123456789012345');j=await r.json();ok(j.status==='done'&&j.result.decision==='publish','background preview returns analysis');
 console.log(`PASS: ${n} AI editor HTTP checks`);
 } finally {await new Promise(r=>server.close(r));d.close();fs.rmSync(root,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1});
