'use strict';
// Isolated database and mocked WhatsApp metadata; no real account or network.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), assert = require('node:assert/strict');
process.env.DASHBOARD_USERNAME = 'admin'; process.env.DASHBOARD_PASSWORD = 'test-owner-password'; process.env.SESSION_SECRET = 'test-only-long-session-secret';
delete process.env.PERSIST_GITHUB_REPO; delete process.env.PERSIST_GITHUB_TOKEN;
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'raq-name-test-'));
const cfg = require('../src/config'); cfg.config.paths.database = path.join(root, 'db.sqlite'); cfg.config.paths.sessions = path.join(root, 'sessions');
const db = require('../src/db'), d = db.open(), wa = require('../src/wa');
let online = false, calls = [];
const sock = { newsletterMetadata: async (_type, jid) => { calls.push(jid); return { id: jid, name: { text: 'Recovered Name' }, viewer_metadata: { role: 'ADMIN' } }; } };
wa.getSocket = () => online ? sock : null; wa.getStatus = () => ({ status: online ? 'open' : 'close' });
db.CH.addTarget('101@newsletter', 'Target Name');
db.CH.addSource('101@newsletter', '101');
db.CH.addTarget('102@newsletter', 'Other Target');
db.CH.addTarget('103@newsletter', '103');
db.CH.recordDir('104@newsletter', 'Directory Name', 'VIEWER'); db.CH.addSource('104@newsletter', '104');
const app = require('express')(); require('../src/web/server').build(app);
let n = 0; const ok = (value, label) => { assert.ok(value, label); console.log('✓ ' + label); n++; };
(async () => {
 const metadata = await wa.channelMeta(sock, 'shape@newsletter');
 ok(metadata.name === 'Recovered Name' && metadata.role === 'ADMIN', 'object-shaped provider name is read as text');
 const nested = await wa.channelMeta({newsletterMetadata:async()=>({name:'',thread_metadata:{name:{text:'Nested Name'}}})},'nested@newsletter');
 ok(nested.name === 'Nested Name', 'nested name is used when the top-level name is empty');
 const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
 try {
   const base = 'http://127.0.0.1:' + server.address().port;
   let login = await fetch(base + '/login', {method:'POST', headers:{'content-type':'application/json',accept:'application/json'}, body:JSON.stringify({username:'admin',password:'test-owner-password'})});
   const headers = {authorization:'Bearer ' + (await login.json()).token};
   const get = async p => (await fetch(base + p, {headers})).json();
   let targets = (await get('/api/targets')).list, sources = (await get('/api/sources')).list;
   ok(targets.find(r=>r.jid==='102@newsletter').name === 'Other Target', 'target-only stored name is displayed');
   ok(sources.find(r=>r.jid==='101@newsletter').name === 'Target Name', 'a real name from the other list is reused');
   ok(sources.find(r=>r.jid==='104@newsletter').name === 'Directory Name', 'directory name is used when source name is numeric');
   ok(targets.find(r=>r.jid==='103@newsletter').name === 'Name unavailable', 'unknown name is honest, not a fabricated number');
   online = true; await get('/api/targets');
   const until = Date.now() + 6000; while (Date.now() < until && db.CH.listTargets().find(r=>r.jid==='103@newsletter').name !== 'Recovered Name') await new Promise(r=>setTimeout(r,100));
   targets = (await get('/api/targets')).list;
   ok(targets.find(r=>r.jid==='103@newsletter').name === 'Recovered Name', 'target-only visit triggers real WhatsApp name recovery');
   ok(calls.includes('103@newsletter'), 'missing target name was looked up');
   ok(db.CH.listSources().length===2 && db.CH.listTargets().length===3, 'name recovery does not remove channels');
   console.log(`PASS: ${n} channel name checks`);
 } finally { await new Promise(resolve => server.close(resolve)); d.close(); fs.rmSync(root,{recursive:true,force:true}); }
})().catch(e=>{console.error(e);process.exitCode=1});
