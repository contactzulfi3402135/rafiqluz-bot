'use strict';
// Runs the real boot/shutdown path twice with all WhatsApp operations mocked.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict'),{spawn,spawnSync}=require('node:child_process');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'raq-guard-boot-')),app=path.resolve(__dirname,'..'),preload=path.join(root,'mock-provider.js');
fs.writeFileSync(preload,`const Module=require('node:module'),EventEmitter=require('node:events'),old=Module._load;const wa={events:new EventEmitter(),connect:async()=>{},close:async()=>{},getSocket:()=>null,getStatus:()=>({status:'idle',phone:'',qr:null}),forceReconnect:async()=>{}};Module._load=function(request,parent,isMain){let f;try{f=Module._resolveFilename(request,parent,isMain)}catch{}if(typeof f==='string'&&f.endsWith('/src/wa.js'))return wa;return old.apply(this,arguments)};global.fetch=async()=>{throw Error('Network disabled in boot test')};`);
const env={...process.env,RAQ_STATE_DIR:path.join(root,'state'),DASHBOARD_USERNAME:'admin',DASHBOARD_PASSWORD:'boot-test-password',SESSION_SECRET:'a-unique-synthetic-test-secret-long-enough',PORT:'0',RAQ_LISTEN_HOST:'127.0.0.1',PERSIST_GITHUB_REPO:'',PERSIST_GITHUB_TOKEN:'',NODE_OPTIONS:`--require ${preload}`};
const state=path.join(root,'state'),session=path.join(state,'sessions','main');fs.mkdirSync(session,{recursive:true});const creds=path.join(session,'creds.json'),bytes=Buffer.from('{"registered":true,"synthetic":"do-not-touch"}');fs.writeFileSync(creds,bytes);
let n=0;function ok(v,s){assert.ok(v,s);n++;console.log('✓ '+s)}
function boot(){return spawn(process.execPath,['src/index.js'],{cwd:app,env,stdio:['ignore','pipe','pipe']})}
function ready(c){return new Promise((resolve,reject)=>{let out='',timer=setTimeout(()=>reject(Error('boot timed out: '+out)),15000);const on=d=>{out+=d.toString();if(out.includes('Dashboard live on port')){clearTimeout(timer);resolve(out)}};c.stdout.on('data',on);c.stderr.on('data',on);c.once('exit',code=>{if(!out.includes('Dashboard live on port')){clearTimeout(timer);reject(Error('boot failed '+code+': '+out))}})})}
function stop(c){return new Promise((resolve,reject)=>{let timer=setTimeout(()=>{c.kill('SIGKILL');reject(Error('shutdown timed out'))},10000);c.once('exit',(code,signal)=>{clearTimeout(timer);if(code===0)resolve();else reject(Error('exit '+code+' '+signal))});c.kill('SIGTERM')})}
(async()=>{let child;try{
 child=boot();const output=await ready(child);ok(output.includes('bind 127.0.0.1'),'actual startup uses the configured local-only bind address');ok(fs.readFileSync(creds).equals(bytes),'guarded actual startup preserves preexisting synthetic session bytes');
 let clash=spawnSync(process.execPath,['src/index.js'],{cwd:app,env,encoding:'utf8',timeout:8000});ok(clash.status===1&&clash.stderr.includes('Another Raqifluz process'),'second actual startup refuses shared state before provider work');
 await stop(child);child=null;child=boot();await ready(child);ok(fs.readFileSync(creds).equals(bytes),'graceful shutdown releases guard and restart retains the same session bytes');await stop(child);child=null;
 console.log(`PASS: ${n} guarded boot/restart checks`);
 }finally{if(child){child.kill('SIGKILL');await new Promise(r=>child.once('exit',r))}fs.rmSync(root,{recursive:true,force:true})}})().catch(e=>{console.error(e);process.exit(1)});
