'use strict';
// Run against a freshly started, isolated server; never point this at production.
const assert = require('node:assert/strict');
if (process.env.TEST_ALLOW_MUTATIONS !== '1') throw new Error('This test changes settings. Use an isolated server and set TEST_ALLOW_MUTATIONS=1.');
const base = process.env.TEST_URL || 'http://127.0.0.1:20250';
const ownerPass = process.env.TEST_PASSWORD || 'owner-test-password';
let passed = 0;
function ok(condition, label) { assert.ok(condition, label); console.log('✓', label); passed++; }
async function req(path, options={}) { return fetch(base+path,{redirect:'manual',...options}); }
async function login(password) {
  let r=await req('/login',{method:'POST',headers:{'content-type':'application/json','accept':'application/json'},body:JSON.stringify({username:'admin',password})});
  ok(r.status===200,'login succeeds'); let j=await r.json();return {token:j.token,cookie:r.headers.get('set-cookie').split(';')[0],role:j.role};
}
(async()=>{
 let r=await req('/api/settings');ok(r.status===401,'unauthenticated API rejected');
 r=await req('/api/public/numbers');ok(r.status===401,'pairing list requires owner by default');
 r=await req('/api/public/connect',{method:'POST',headers:{'content-type':'application/json'},body:'{}'});ok(r.status===401,'pairing mutation requires owner by default');
 r=await req('/connect');ok(r.status===302&&r.headers.get('location')==='/login','pairing page requires login');
 r=await req('/media/avatars/test.png');ok(r.status===401,'avatars require login');
 const owner=await login(ownerPass);ok(owner.role==='full','owner role correct');
 let auth={authorization:`Bearer ${owner.token}`,'content-type':'application/json'};
 r=await req('/api/security',{method:'POST',headers:auth,body:JSON.stringify({ro:true,password:'readonly-test-password'})});ok(r.status===200,'owner enables read-only account');
 let own=await req('/api/settings',{headers:auth}).then(r=>r.json());ok(typeof own.apiKey==='string'&&own.apiKey.length>20,'owner can access API key');
 const ro=await login('readonly-test-password');ok(ro.role==='readonly','read-only role correct');
 const rh={authorization:`Bearer ${ro.token}`,'content-type':'application/json'};
 r=await req('/api/settings',{headers:rh});let rs=await r.json();ok(r.status===200&&rs.apiKey==='','read-only bearer cannot see owner API key');
 r=await req('/api/settings',{method:'POST',headers:rh,body:JSON.stringify({botName:'ILLEGAL'})});ok(r.status===403,'read-only bearer cannot mutate');
 r=await req('/api/settings',{method:'POST',headers:{...auth,cookie:ro.cookie},body:'{}'});ok(r.status===403,'read-only session is not elevated by bearer header');
 r=await req('/api/backup/download',{headers:rh});ok(r.status===403,'read-only cannot download secrets in backup');
 r=await req('/api/qr',{headers:rh});ok(r.status===403,'read-only cannot access pairing QR');
 r=await req('/api/status',{headers:rh});let status=await r.json();ok(status.qr===null,'read-only status redacts pairing QR');
 r=await req('/api/session',{headers:rh});let session=await r.json();ok(session.role==='readonly','session reports bearer role');
 r=await req('/api/settings',{method:'POST',headers:{...auth,origin:'https://evil.example'},body:'{}'});ok(r.status===403,'cross-origin mutation blocked');
 r=await req('/api/settings',{method:'POST',headers:{...auth,'sec-fetch-site':'cross-site'},body:'{}'});ok(r.status===403,'cross-site mutation blocked');
 r=await req('/api/settings',{method:'POST',headers:{...auth,origin:base},body:JSON.stringify({botName:'Test Workspace'})});ok(r.status===200,'same-origin mutation allowed');
 r=await req('/logout',{method:'POST',headers:{cookie:ro.cookie}});ok(r.status===302,'logout redirects');
 r=await req('/api/session',{headers:rh});ok(r.status===401,'logout revokes the associated bearer');
 r=await req('/api/settings',{headers:{'x-api-key':own.apiKey}});ok(r.status===200,'owner API key works');
 console.log(`PASS: ${passed} security checks`);
})().catch(e=>{console.error(e);process.exitCode=1});
