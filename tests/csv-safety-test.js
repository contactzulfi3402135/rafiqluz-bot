'use strict';
// Isolated synthetic data and HTTP requests. No real provider is contacted.
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { csvCell } = require('../src/csv-safe');
let n = 0;
function ok(value, label) { assert.ok(value, label); n++; console.log('✓ ' + label); }
function parseRow(row) {
  // RFC-style CSV parser for the unit cases, including escaped quotes/newlines.
  const out=[]; let field='', quote=false;
  for(let i=0;i<row.length;i++) {
    const c=row[i];
    if(c==='"' && quote && row[i+1]==='"'){field+='"';i++;}
    else if(c==='"')quote=!quote;
    else if(c===',' && !quote){out.push(field);field='';}
    else field+=c;
  }
  assert.strictEqual(quote,false);out.push(field);return out;
}
for(const input of ['=SUM(1,2)','+cmd','-1+2','@SUM(1)','  =1+1','\tcmd',' \rvalue','\nvalue','\uFEFF=1','\u0000payload','＝1+1','＋cmd','－1','＠cmd']) {
  const decoded=parseRow(csvCell(input));
  ok(decoded.length===1 && decoded[0]==="'"+input, 'dangerous field neutralized: '+JSON.stringify(input));
}
for(const input of ['ordinary','text,comma','quote "here"','inside\nnewline','normal @ name','اردو','']) {
  const decoded=parseRow(csvCell(input));
  ok(decoded.length===1 && decoded[0]===input, 'safe field remains intact: '+JSON.stringify(input));
}
ok(parseRow([csvCell('bad,=1'),csvCell('=2'),csvCell('"\r\n,=3')].join(',')).length===3,'embedded delimiters and quotes cannot create a new cell');

const root=fs.mkdtempSync(path.join(os.tmpdir(),'raq-csv-test-'));
process.env.DASHBOARD_USERNAME='admin';process.env.DASHBOARD_PASSWORD='test-only';process.env.SESSION_SECRET='csv-test-only-secret';
delete process.env.PERSIST_GITHUB_REPO;delete process.env.PERSIST_GITHUB_TOKEN;
const cfg=require('../src/config');cfg.config.paths.database=path.join(root,'bot.sqlite');cfg.config.paths.sessions=path.join(root,'sessions');cfg.config.paths.media=path.join(root,'media');
const db=require('../src/db');const d=db.open();db.S.set('api.key','synthetic-csv-key');
const danger='=SUM(1,2)';
db.CT.upsert('main','923001234567@s.whatsapp.net',danger,'');
d.prepare('INSERT INTO contact_notes(session,jid,note) VALUES(?,?,?)').run('main','923001234567@s.whatsapp.net','+note');
d.prepare('INSERT INTO inbox_msgs(session,chat_jid,ts,msg_id,sender_name,body,kind) VALUES(?,?,?,?,?,?,?)').run('main','chat@s.whatsapp.net','2026-01-01 12:00:00','msg',danger,'@command','text');
d.prepare('INSERT INTO posts(source_jid,source_msg_id,status,reason,body) VALUES(?,?,?,?,?)').run('csv-source','csv-post','failed','-danger',danger);
d.prepare('INSERT INTO audit(actor,action,detail) VALUES(?,?,?)').run('csv-actor','csv-action','  =audit');
d.prepare('INSERT INTO logs(ts,level,code,msg) VALUES(?,?,?,?)').run('2026-01-01','info','csv-test','\tlog');
const app=require('express')();require('../src/web/server').build(app);
(async()=>{
 const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
 const base='http://127.0.0.1:'+server.address().port;
 const routes=[
  ['/api/inbox/'+encodeURIComponent('chat@s.whatsapp.net')+'/export?format=csv',"\"'=SUM(1,2)\"",'chat'],
  ['/api/contacts.csv',"\"'=SUM(1,2)\"",'contacts'],
  ['/api/analytics/export.csv',"\"'=SUM(1,2)\"",'analytics'],
  ['/api/audit.csv',"\"'  =audit\"",'audit'],
  ['/api/export/posts.csv',"\"'-danger\"",'posts'],
  ['/api/export/logs.csv',"\"'\tlog\"",'logs']
 ];
 try {
  for(const [url,expected,label] of routes){
   let r=await fetch(base+url);ok(r.status===401,label+' CSV requires authentication');
   r=await fetch(base+url,{headers:{'x-api-key':'synthetic-csv-key'}});const text=await r.text();
   ok(r.status===200 && text.includes(expected),label+' CSV neutralizes its untrusted fixture');
   ok(/no-store/.test(r.headers.get('cache-control')||''),label+' CSV is not cached');
  }
  ok(d.prepare("SELECT body FROM inbox_msgs WHERE msg_id='msg'").get().body==='@command' && d.prepare("SELECT body FROM posts WHERE source_msg_id='csv-post'").get().body===danger,'CSV hardening never changes stored source data');
  console.log('PASS: '+n+' CSV safety checks');
 } finally {await new Promise(resolve=>server.close(resolve));d.close();fs.rmSync(root,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1});
