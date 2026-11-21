'use strict';
// Synthetic 7,100-source database; no WhatsApp socket or real user data.
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'raq-scale-'));
process.env.DASHBOARD_USERNAME='admin';process.env.DASHBOARD_PASSWORD='test-only';process.env.SESSION_SECRET='test-only-scale-secret';
delete process.env.PERSIST_GITHUB_REPO;delete process.env.PERSIST_GITHUB_TOKEN;
const cfg=require('../src/config');cfg.config.paths.database=path.join(root,'bot.sqlite');cfg.config.paths.sessions=path.join(root,'sessions');cfg.config.paths.media=path.join(root,'media');
const db=require('../src/db'),d=db.open();db.S.set('api.key','synthetic-scale-key');
const jid=i=>String(120363000000000+i)+'@newsletter';
const src=d.prepare('INSERT INTO sources(jid,name) VALUES(?,?)'),dir=d.prepare('INSERT INTO directory(jid,name,role) VALUES(?,?,?)'),rule=d.prepare('INSERT INTO source_rules(source_jid) VALUES(?)');
d.transaction(()=>{for(let i=0;i<7100;i++){src.run(jid(i),i<3?String(120363000000000+i):'Source '+i);dir.run(jid(i),i===0?'Directory name':i<3?String(120363000000000+i):'Directory '+i,'VIEWER');rule.run(jid(i));}dir.run('followed@newsletter','Extra followed','VIEWER');dir.run('target@newsletter','Target directory','ADMIN');d.prepare("INSERT INTO targets(jid,name) VALUES('target@newsletter','Target')").run();})();
db.CT.upsert('main',jid(1),'Contact name','');
const wa=require('../src/wa');wa.getStatus=()=>({status:'closed'});
const calls={};for(const key of ['listSources','listTargets','dirList']){const orig=db.CH[key];db.CH[key]=(...args)=>{calls[key]=(calls[key]||0)+1;return orig(...args)}}
const app=require('express')();require('../src/web/server').build(app);let n=0;
function ok(x,label){assert.ok(x,label);n++;console.log('✓ '+label)}
(async()=>{
 const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});const base='http://127.0.0.1:'+server.address().port;
 const get=async url=>{for(const k of Object.keys(calls))delete calls[k];const t=performance.now(),r=await fetch(base+url,{headers:{'x-api-key':'synthetic-scale-key'}}),data=await r.json();return {r,data,ms:Math.round(performance.now()-t),calls:{...calls}}};
 try{
  let x=await get('/api/sources');ok(x.r.status===200&&x.data.list.length===7100,'all 7,100 source records returned without truncation');
  const lookup=new Map(x.data.list.map(r=>[r.jid,r]));ok(lookup.get(jid(0)).name==='Directory name'&&lookup.get(jid(1)).name==='Contact name'&&lookup.get(jid(2)).name==='Channel •0002','name priority and masked fallback remain unchanged');
  ok(lookup.get(jid(10)).role==='VIEWER'&&x.data.followedMissing.length===1&&x.data.followedMissing[0].jid==='followed@newsletter','roles and followed-missing results preserve existing semantics');
  ok(x.calls.listSources===1&&x.calls.listTargets===1&&x.calls.dirList===1,'source listing performs one snapshot read per table, not one per row');console.log('  sources elapsed '+x.ms+'ms');
  x=await get('/api/directory');ok(x.r.status===200&&x.data.list.length===7102&&x.calls.listSources===1&&x.calls.dirList===1,'directory listing handles 7,102 rows with bounded table reads');console.log('  directory elapsed '+x.ms+'ms');
  x=await get('/api/source-rules');ok(x.r.status===200&&x.data.list.length===7100&&x.calls.listSources===1&&x.calls.dirList===1,'7,100 source rules use bounded name lookups');console.log('  source rules elapsed '+x.ms+'ms');
  x=await get('/api/routing-matrix');ok(x.r.status===200&&x.data.sources.length===7100&&x.data.targets.length===1&&x.data.targets[0].name==='Target'&&x.calls.listSources===1&&x.calls.dirList===1,'routing matrix returns all source names with bounded table reads');console.log('  matrix elapsed '+x.ms+'ms');
  x=await get('/api/source-rules?jid='+encodeURIComponent(jid(7099)));ok(x.r.status===200&&x.data.source.jid===jid(7099)&&x.data.rule.source_jid===jid(7099)&&!x.calls.listSources&&!x.calls.dirList,'rule detail uses indexed single-source lookups');
  x=await get('/api/source-rules?jid=absent%40newsletter');ok(x.r.status===404,'rule detail reports a removed source');
  const post=async body=>fetch(base+'/api/source-rules',{method:'POST',headers:{'x-api-key':'synthetic-scale-key','content-type':'application/json'},body:JSON.stringify(body)});
  let rr=await post({jid:jid(7099),approve_first:'false'});ok(rr.status===400&&db.SR.get(jid(7099)).approve_first===0,'rule save rejects a misleading string boolean');
  rr=await post({jid:jid(7099),active_from:'25:99'});ok(rr.status===400,'rule save rejects an invalid time');
  rr=await post({jid:jid(7099),approve_first:true,active_from:'09:00',active_to:'17:30',max_per_day:5,priority:4,include:'news',exclude:'spam',auto_pause:false});ok(rr.status===200&&db.SR.get(jid(7099)).approve_first===1,'valid rule save persists exact intended controls');
  const save=db.SR.save;db.SR.save=()=>{throw Error('synthetic database failure')};rr=await post({jid:jid(7099)});db.SR.save=save;ok(rr.status===500&&!(await rr.json()).ok,'rule database failure is never reported as success');
  db.CH.addSource('feed@rss','Synthetic RSS','test');rr=await post({jid:'feed@rss',approve_first:false,priority:3});ok(rr.status===200,'rule cards also save for an existing RSS source');
  db.SUBS.upsertDay(jid(7099),'2025-01-01',42);
  x=await get('/api/subs?jid='+encodeURIComponent(jid(7099))+'&jid='+encodeURIComponent(jid(10))+'&jid='+encodeURIComponent(jid(7099)));ok(x.r.status===200&&x.data.list.length===2&&x.data.list.find(v=>v.jid===jid(7099)).subs===42&&!x.calls.listSources,'subset subscribers returns only requested unique source IDs without full source scan');
  x=await get('/api/subs?'+Array.from({length:51},(_,i)=>'jid='+encodeURIComponent(jid(i))).join('&'));ok(x.r.status===400,'subscriber subset rejects more than 50 IDs');
  for(const k of Object.keys(calls))delete calls[k];wa.getSocket=()=>null;const t=performance.now();const added=require('../src/channels').syncFollowed();
  ok(added.length===1&&added[0]==='Extra followed'&&db.CH.hasSource('followed@newsletter')&&!db.CH.hasSource('target@newsletter'),'sync-followed adds only missing non-target channels');
  ok(!calls.listSources&&!calls.listTargets&&calls.dirList===1,'sync-followed uses indexed membership rather than rescanning lists per channel');console.log('  sync followed elapsed '+Math.round(performance.now()-t)+'ms');
  ok(db.CH.hasSource(jid(10))&&db.CH.hasTarget('target@newsletter')&&db.CH.hasDirectory(jid(10))&&!db.CH.hasSource('absent@newsletter'),'indexed membership checks reflect actual current rows');
  const pipeline=require('../src/pipeline'),beforeActive=db.CH.listActiveSources;db.CH.listActiveSources=()=>{throw Error('unexpected active sources scan')};const probe=pipeline.inspectText('hello',{sourceJid:jid(10)});ok(probe&&db.CH.getActiveSource(jid(10))&&!db.CH.getActiveSource('absent@newsletter'),'pipeline inspector performs indexed active source lookup');db.CH.pauseSource(jid(10),true);ok(!db.CH.getActiveSource(jid(10)),'indexed active source excludes paused rows');db.CH.pauseSource(jid(10),false);db.CH.listActiveSources=beforeActive;
  console.log('PASS: '+n+' 7100-source scale checks');
 }finally{await new Promise(resolve=>server.close(resolve));d.close();fs.rmSync(root,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1});
