'use strict';
// Branch decisions against synthetic GitHub responses; no network used.
const assert=require('node:assert/strict');process.env.PERSIST_GITHUB_REPO='example/private';process.env.PERSIST_GITHUB_TOKEN='synthetic';process.env.PERSIST_GITHUB_BRANCH='state';let n=0;
const fresh=()=>{delete require.cache[require.resolve('../src/persist')];return require('../src/persist')};function ok(v,s){assert.ok(v,s);n++;console.log('✓ '+s)}
(async()=>{let calls=[],mode='error',refReads=0;
 global.fetch=async(url,options)=>{calls.push([String(url),options.method||'GET']);if(String(url).endsWith('/git/ref/heads/state')){refReads++;return new Response('{}',{status:mode==='error'?503:(mode==='race'&&refReads>1?200:404)});}if(String(url).endsWith('/repos/example/private'))return new Response(JSON.stringify({default_branch:'main'}));if(String(url).endsWith('/git/ref/heads/main'))return new Response(JSON.stringify({object:{sha:'example-sha'}}));if(String(url).endsWith('/git/refs'))return new Response('{}',{status:mode==='created'?201:422});throw Error('Unexpected mock call');};
 let p=fresh();await assert.rejects(p._test.ensureBranch(),/could not be verified/);ok(calls.length===1,'503 on branch verification does not trigger creation or a fresh-state assumption');
 calls=[];refReads=0;mode='invalid';p=fresh();await assert.rejects(p._test.ensureBranch(),/not confirmed/);ok(calls.filter(x=>x[0].endsWith('/git/ref/heads/state')).length===2&&!p.publicStatus().branchReady,'ambiguous 422 without an existing branch is rejected');
 calls=[];refReads=0;mode='race';p=fresh();const raced=await p._test.ensureBranch();ok(raced&&refReads===2,'422 creation race is accepted only after checking the branch exists');
 calls=[];refReads=0;mode='created';p=fresh();const created=await p._test.ensureBranch();ok(created&&calls.some(x=>x[1]==='POST'),'a confirmed new branch is accepted');
 console.log(`PASS: ${n} cloud branch verification checks`);
})().catch(e=>{console.error(e);process.exit(1)});
