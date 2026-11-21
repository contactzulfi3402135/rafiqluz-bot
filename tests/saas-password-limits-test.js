'use strict';
// Synthetic process-local password work limit; does not test distributed DoS.
const assert=require('node:assert/strict'),password=require('../src/saas-control/password');
(async()=>{
 const attempts=await Promise.allSettled(Array.from({length:8},(_,i)=>password.hash('synthetic-password-'+i)));
 const success=attempts.filter(x=>x.status==='fulfilled'),busy=attempts.filter(x=>x.status==='rejected'&&x.reason.code==='AUTH_BUSY');
 assert.equal(success.length,2);assert.equal(busy.length,6);console.log('✓ bounded concurrent derivations fail fast without an unbounded queue');
 assert.equal(await password.verify('synthetic-password-0',success[0].value),true);assert.equal(await password.verify('wrong-password',success[0].value),false);console.log('✓ normal password verification works after slots are released');
 await assert.rejects(()=>password.hash('short'),/at least 12/);console.log('✓ password policy remains enforced');
 console.log('PASS: 3 process-local password limit checks');
})().catch(e=>{console.error(e);process.exitCode=1});
