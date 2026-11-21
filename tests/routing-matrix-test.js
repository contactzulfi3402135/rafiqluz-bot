'use strict';
// Synthetic HTTP tests for atomic routing writes. No provider is contacted.
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'raq-matrix-'));process.env.SESSION_SECRET='test-only';delete process.env.PERSIST_GITHUB_REPO;delete process.env.PERSIST_GITHUB_TOKEN;
const cfg=require('../src/config');cfg.config.paths.database=path.join(root,'bot.sqlite');cfg.config.paths.sessions=path.join(root,'sessions');cfg.config.paths.media=path.join(root,'media');
const db=require('../src/db'),d=db.open();db.S.set('api.key','test-matrix-key');const app=require('express')();require('../src/web/server').build(app);let n=0;
function ok(v,label){assert.ok(v,label);n++;console.log('✓ '+label)}
(async()=>{
 const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});const base='http://127.0.0.1:'+server.address().port;
 const cell=(s,t,e)=>({source_jid:s+'@newsletter',target_jid:t+'@newsletter',enabled:e});
 const row=(s,t)=>d.prepare('SELECT enabled FROM routing_cells WHERE source_jid=? AND target_jid=?').get(s+'@newsletter',t+'@newsletter');
 const post=(cells)=>fetch(base+'/api/routing-matrix',{method:'POST',headers:{'x-api-key':'test-matrix-key','content-type':'application/json'},body:JSON.stringify({cells})});
 try{
  let r=await post([cell('s1','t1',true)]);ok(r.status===200&&row('s1','t1').enabled===1,'explicit on is stored');
  r=await post([cell('s1','t1',false)]);ok(r.status===200&&row('s1','t1').enabled===0,'explicit off is stored');
  r=await post([cell('s1','t1',null)]);ok(r.status===200&&!row('s1','t1'),'null restores mapping default');
  r=await post([{source_jid:'s1@newsletter',target_jid:'t1@newsletter',reset:true}]);ok(r.status===200&&!row('s1','t1'),'legacy explicit reset remains supported');
  r=await post([cell('s1','t1','false')]);ok(r.status===400&&!row('s1','t1'),'string false is rejected rather than coerced to on');
  r=await post([cell('s1','t1',true),cell('bad','t1','false')]);ok(r.status===400&&!row('s1','t1'),'invalid cell rejects the entire batch before writes');
  r=await post([cell('s1','t1',true),{source_jid:'not-a-channel',target_jid:'t1@newsletter',enabled:true}]);ok(r.status===400&&!row('s1','t1'),'invalid destination rejects the entire batch');
  r=await post(Array(401).fill(cell('s1','t1',true)));ok(r.status===400&&!row('s1','t1'),'over-limit batch is rejected rather than silently truncated');
  d.exec("CREATE TRIGGER test_block_matrix BEFORE INSERT ON routing_cells WHEN NEW.source_jid='fail@newsletter' BEGIN SELECT RAISE(ABORT,'synthetic database failure'); END");
  r=await post([cell('s1','t1',true),cell('fail','t1',true)]);ok(r.status===400&&!row('s1','t1'),'database failure rolls back all cells rather than reporting success');
  d.exec('DROP TRIGGER test_block_matrix');
  r=await fetch(base+'/api/routing-matrix',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({cells:[cell('s1','t1',true)]})});ok(r.status===401&&!row('s1','t1'),'routing changes require authentication');
  console.log('PASS: '+n+' routing matrix HTTP checks');
 }finally{await new Promise(resolve=>server.close(resolve));d.close();fs.rmSync(root,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1});
