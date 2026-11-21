'use strict';
// Synthetic adapter and lease tests; no provider requests.
const assert=require('node:assert/strict'),{runner}=require('../src/saas-control/worker-runner-experiment');let n=0;
const ok=(x,s)=>{assert.ok(x,s);n++;console.log('✓ '+s)};
function fixture(handler,opts={}){const calls=[],job={id:'job-1',workspace_id:'workspace-1',kind:'send',idempotency_key:'idempotency-1',payload:{example:true},lease_token:'token',fence:'1'};let served=false;const q={async claim(){calls.push('claim');if(served)return null;served=true;return job},async beginDispatch(){calls.push('begin');return job},async heartbeat(){calls.push('heartbeat');return true},async complete(...args){calls.push(['complete',args[3]]);return job},async finish(...args){calls.push(['finish',args[3]]);return job},async failLeased(){calls.push('failLeased');return job},async release(){calls.push('release');return job}};return {calls,job,worker:runner({queue:q,workerId:'test-worker',handlers:handler?{send:handler}:{},...opts})};}
(async()=>{
 const s=fixture(async j=>({id:j.idempotencyKey}));ok(await s.worker.runOnce(),'worker claims and runs one synthetic job');ok(s.calls[0]==='claim'&&s.calls[1]==='begin'&&s.calls[2][0]==='complete','dispatch is recorded before adapter invocation and success');
 const u=fixture(async()=>{throw Error('synthetic timeout')});await u.worker.runOnce();ok(u.calls[2][0]==='finish'&&u.calls[2][1]==='uncertain','unknown provider failure becomes uncertain');
 const d=fixture(async()=>{const e=Error('synthetic rejection');e.definitive=true;throw e});await d.worker.runOnce();ok(d.calls[2][1]==='failed','definitive rejection is recorded as failed');
 const absent=fixture(null);await absent.worker.runOnce();ok(absent.calls.includes('failLeased')&&!absent.calls.includes('begin'),'unknown kind fails before dispatch');
 const aborted=new AbortController();aborted.abort();const x=fixture(async()=>true);ok(!(await x.worker.runOnce(aborted.signal))&&x.calls.length===0,'already-stopped worker does not claim');
 const cancelled=new AbortController(),c=fixture(async()=>{cancelled.abort();return true});await c.worker.runOnce(cancelled.signal);ok(c.calls[2][1]==='uncertain','cancellation during adapter execution does not claim success');
 const idle=fixture(async()=>true);await idle.worker.runOnce();ok(!(await idle.worker.runOnce()),'empty queue returns without work');
 console.log('PASS: '+n+' synthetic worker runner checks');
})().catch(e=>{console.error(e);process.exitCode=1});
