'use strict';
// Local HTTP integration with mocked WhatsApp only. Never uses a real account.
const fs=require('fs'),path=require('path'),os=require('os'),assert=require('assert');
process.env.DASHBOARD_USERNAME='admin';process.env.DASHBOARD_PASSWORD='test-owner-password';process.env.SESSION_SECRET='test-only-long-session-secret';
delete process.env.PERSIST_GITHUB_REPO;delete process.env.PERSIST_GITHUB_TOKEN;
const root=fs.mkdtempSync(path.join(os.tmpdir(),'raq-web-test-'));
const cfg=require('../src/config');cfg.config.paths.database=path.join(root,'bot.sqlite');cfg.config.paths.sessions=path.join(root,'sessions');
const db=require('../src/db');const d=db.open();db.S.set('api.key','test-only-key');
const wa=require('../src/wa');const pace=require('../src/pace');pace.gapMin=()=>0;
wa.getSocket=()=>({});wa.getStatus=()=>({status:'open'});let sends=[];
wa.sendToChannel=async(_s,jid)=>{sends.push(jid);if(jid==='b@newsletter') throw Error('response lost');return 'returned-a';};
db.CH.addTarget('a@newsletter','A');db.CH.addTarget('b@newsletter','B');
const app=require('express')();require('../src/web/server').build(app);
let n=0;function ok(v,label){assert.ok(v,label);n++;console.log('✓ '+label);}
(async()=>{
 const server=await new Promise(r=>{const s=app.listen(0,'127.0.0.1',()=>r(s));});const base='http://127.0.0.1:'+server.address().port;
 try {
  let r=await fetch(base+'/login',{method:'POST',headers:{'content-type':'application/json',accept:'application/json'},body:JSON.stringify({username:'admin',password:'test-owner-password'})});
  const auth={authorization:'Bearer '+(await r.json()).token,'content-type':'application/json'};
  const req=(p,method='GET',body)=>fetch(base+p,{method,headers:auth,body:body===undefined?undefined:JSON.stringify(body)});
  r=await req('/api/compose','POST',{text:'hello',targets:['a@newsletter','missing@newsletter']});let j=await r.json();
  ok(r.status===400 && /missing or paused/i.test(j.error) && sends.length===0,'compose rejects missing targets instead of broadcasting elsewhere');
  r=await req('/api/compose','POST',{text:'hello',targets:['a@newsletter','b@newsletter']});j=await r.json();
  ok(r.status===200 && !j.complete && j.sent===1 && j.failed===1,'compose reports a partial send without claiming full success');
  r=await req('/api/posts');const post=(await r.json()).list.find(x=>x.source_jid==='system:compose');
  r=await req('/api/posts/'+post.id+'/delivery');j=await r.json();
  ok(j.items.length===2 && j.items.some(x=>x.state==='accepted') && j.items.some(x=>x.state==='uncertain'),'post detail lists per-target results');
  r=await req('/api/delivery/review');const item=(await r.json()).items.find(x=>x.source_jid==='system:compose');
  ok(item && item.target_jid==='b@newsletter','uncertain composer send appears in review');
  r=await req('/api/delivery/review/'+item.id,'POST',{action:'retry'});ok(r.status===400,'review action needs confirmation');
  r=await req('/api/delivery/review/'+item.id,'POST',{action:'accepted',confirmed:true});ok(r.status===200,'owner can reconcile after confirmation');
  r=await req('/api/power/scheduler','POST',{jid:'a@newsletter',text:'scheduled',at:new Date(Date.now()+3600000).toISOString()});const job=(await r.json()).job;
  r=await req('/api/power/scheduler/'+job.id,'PATCH',{repeat:'daily',enabled:false});j=await r.json();ok(j.job.repeat==='daily'&&!j.job.enabled,'schedule patch updates repeat and enabled together');
  r=await req('/api/queue/delay','POST',{min:1});ok(r.status===200,'queue delay route is reachable');
  console.log(`PASS: ${n} web delivery checks`);
 } finally { await new Promise(r=>server.close(r));d.close();fs.rmSync(root,{recursive:true,force:true}); }
})().catch(e=>{console.error(e);process.exitCode=1});
