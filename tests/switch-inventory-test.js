'use strict';
// Inventories switch defaults, homes and API persistence using isolated SQLite.
// Does not claim every feature's downstream provider behavior has been tested.
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert'),{spawnSync}=require('node:child_process');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'raq-switches-'));
process.env.DASHBOARD_USERNAME='admin';process.env.DASHBOARD_PASSWORD='test-only';process.env.SESSION_SECRET='test-only-switch-secret';
delete process.env.PERSIST_GITHUB_REPO;delete process.env.PERSIST_GITHUB_TOKEN;
const cfg=require('../src/config');cfg.config.paths.database=path.join(root,'bot.sqlite');cfg.config.paths.sessions=path.join(root,'sessions');cfg.config.paths.media=path.join(root,'media');
const db=require('../src/db'),d=db.open();db.S.set('api.key','synthetic-switch-key');
const pipeline=require('../src/pipeline');
let n=0;function ok(v,label){assert.ok(v,label);n++;console.log('✓ '+label)}
const defaults=pipeline.switches(), keys=Object.keys(defaults).sort();
ok(keys.length===33 && keys.every(k=>defaults[k]===false),'all 33 fresh automation switches default off');
const channels=require('../src/channels');
ok(!channels.autoMonitorFlag()&&!channels.autoTargetFlag(),'fresh database disables automatic channel monitoring and target selection');
const legacyPath=path.join(root,'legacy.sqlite');const Legacy=require('better-sqlite3');let legacy=new Legacy(legacyPath);legacy.exec('CREATE TABLE settings(key TEXT PRIMARY KEY,value TEXT)');legacy.close();
const legacyScript="const c=require('./src/config');c.config.paths.database=process.env.CHECK_DB;const ch=require('./src/channels');console.log('FLAGS='+JSON.stringify([ch.autoMonitorFlag(),ch.autoTargetFlag()]));require('./src/db').open().close()";
const legacyProc=spawnSync(process.execPath,['-e',legacyScript],{cwd:path.join(__dirname,'..'),env:{...process.env,CHECK_DB:legacyPath},encoding:'utf8',timeout:15000});assert.strictEqual(legacyProc.status,0,legacyProc.stderr);ok(legacyProc.stdout.includes('FLAGS=[true,true]'),'legacy database missing channel settings retains historical implicit defaults');
const appJs=fs.readFileSync(path.join(__dirname,'../src/web/assets/app.js'),'utf8');
function readObject(name){const match=appJs.match(new RegExp('const '+name+' = (\\{[\\s\\S]*?\\n\\});'));assert.ok(match,name+' declaration');return vm.runInNewContext('('+match[1]+')');}
const ui=readObject('SWITCHES'),homes=readObject('SWITCH_HOME');
ok(JSON.stringify(Object.keys(ui).sort())===JSON.stringify(keys),'dashboard and backend expose exactly the same 33 switch keys');
ok(JSON.stringify(Object.keys(homes).sort())===JSON.stringify(keys),'all 33 switches have an assigned dashboard home');
const view=fs.readFileSync(path.join(__dirname,'../src/web/views/dashboard.ejs'),'utf8');
for(const k of keys){const sel=homes[k];const id=String(sel).replace(/^#/,'');const matches=[...view.matchAll(new RegExp('\\bid=["\']'+id+'["\']','g'))];ok(/^#[A-Za-z0-9]+$/.test(sel)&&matches.length===1,k+' has one existing interactive home container');}
const app=require('express')();require('../src/web/server').build(app);
(async()=>{
 const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});const base='http://127.0.0.1:'+server.address().port;
 const req=(p,body)=>fetch(base+p,{method:body===undefined?'GET':'POST',headers:{'x-api-key':'synthetic-switch-key','content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
 try {
  let r=await req('/api/settings',{automonitor:'false',autoTarget:true,botName:'SHOULD NOT SAVE'});ok(r.status===400&&db.S.get('bot_name')!=='SHOULD NOT SAVE'&&!channels.autoTargetFlag(),'invalid channel boolean is rejected before any setting changes');
  d.exec("CREATE TRIGGER deny_autotarget BEFORE INSERT ON settings WHEN NEW.key='channels.autotarget' BEGIN SELECT RAISE(ABORT,'synthetic denied'); END");
  r=await req('/api/settings',{automonitor:true,autoTarget:true});ok(r.status===500&&!channels.autoMonitorFlag()&&!channels.autoTargetFlag(),'channel automation update rolls back both settings on database failure');d.exec('DROP TRIGGER deny_autotarget');
  r=await req('/api/settings',{automonitor:true,autoTarget:true});ok(r.status===200&&channels.autoMonitorFlag()&&channels.autoTargetFlag(),'explicit channel automation opt-ins persist');
  channels.autoMonitor([{jid:'new-follow@newsletter',name:'New follow'}]);ok(db.CH.hasSource('new-follow@newsletter'),'enabled auto-monitor adds a new followed source');
  db.CH.recordDir('owner@newsletter','Owned channel','OWNER');await channels.autoTarget();ok(db.CH.hasTarget('owner@newsletter'),'enabled auto-target selects sole owned channel');
  r=await req('/api/settings',{automonitor:false,autoTarget:false});db.CH.removeTarget('owner@newsletter');channels.autoMonitor([{jid:'disabled-follow@newsletter',name:'Disabled follow'}]);await channels.autoTarget();
  ok(r.status===200&&!db.CH.hasSource('disabled-follow@newsletter')&&!db.CH.hasTarget('owner@newsletter'),'disabled channel automations do not add sources or targets');
  r=await req('/api/power');let power=await r.json();ok(power.automonitor===false&&power.autoTarget===false,'power endpoint reports current channel automation state');
  for(const k of keys){let r=await req('/api/power/toggle',{key:k,on:true});let j=await r.json();ok(r.status===200 && j.switches[k]===true && db.S.get('power.'+k+'.on')==='1',k+' enables and persists');}
  const script="const c=require('./src/config');c.config.paths.database=process.env.CHECK_DB;const p=require('./src/pipeline');console.log('SWITCHES='+JSON.stringify(p.switches()));require('./src/db').open().close()";
  const child=spawnSync(process.execPath,['-e',script],{cwd:path.join(__dirname,'..'),env:{...process.env,CHECK_DB:cfg.config.paths.database},encoding:'utf8',timeout:15000});
  assert.strictEqual(child.status,0,child.stderr);const line=child.stdout.split('\n').find(x=>x.startsWith('SWITCHES='));const restored=JSON.parse(line.slice(9));ok(keys.every(k=>restored[k]===true),'all saved switch states survive a separate-process database reopen');
  for(const bad of ['false','true',1,0,null,{},[]]){const before=db.S.get('power.scheduler.on');const r=await req('/api/power/toggle',{key:'scheduler',on:bad});ok(r.status===400 && db.S.get('power.scheduler.on')===before,'ambiguous switch value '+JSON.stringify(bad)+' is rejected without changing state');}
  for(const k of ['constructor','toString','__proto__','not-a-switch']){const r=await req('/api/power/toggle',{key:k,on:true});ok(r.status===400 && db.S.get('power.'+k+'.on','MISSING')==='MISSING','invalid switch '+k+' is rejected');}
  for(const k of keys){let r=await req('/api/power/toggle',{key:k,on:false});let j=await r.json();ok(r.status===200 && j.switches[k]===false && db.S.get('power.'+k+'.on')==='0',k+' disables and persists');}
  console.log('PASS: '+n+' switch inventory checks');
 }finally{await new Promise(resolve=>server.close(resolve));d.close();fs.rmSync(root,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1});
