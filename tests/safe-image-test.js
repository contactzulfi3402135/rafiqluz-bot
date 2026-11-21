'use strict';
const assert=require('node:assert/strict');const {EventEmitter}=require('node:events');const {PassThrough}=require('node:stream');
const {fetchImage,publicAddress}=require('../src/safe-image-fetch');let n=0;const ok=(v,label)=>{assert.ok(v,label);n++;console.log('✓ '+label)};
function fake(responses,seen) { return (url,opts,cb)=>{const req=new EventEmitter();req.end=()=>setImmediate(()=>{const r=responses.shift();seen.push({url:String(url),lookup:opts.lookup});const res=new PassThrough();res.statusCode=r.status||200;res.headers=r.headers||{'content-type':'image/png'};cb(res);res.end(r.body||Buffer.from('image'));});return req;}; }
(async()=>{
  for(const ip of ['127.0.0.1','10.0.0.5','169.254.169.254','192.168.1.1','100.64.3.5','::1','fc00::1','::ffff:7f00:1','2001:db8::1'])ok(!publicAddress(ip),'reject restricted '+ip);
  ok(publicAddress('8.8.8.8')&&publicAddress('2606:4700:4700::1111'),'public IPv4 and IPv6 pass');
  await assert.rejects(()=>fetchImage('http://127.0.0.1/secret'),/restricted/);n++;console.log('✓ blocks literal localhost before request');
  let seen=[];let lookup=async()=>[{address:'8.8.8.8',family:4}];
  let image=await fetchImage('https://example.test/image',{lookup,request:fake([{body:Buffer.from('abc')}],seen)});
  ok(image.buffer.toString()==='abc'&&image.mime==='image/png','reads valid public image');
  await new Promise((resolve,reject)=>seen[0].lookup('other',{},(e,a,f)=>{try{assert.equal(a,'8.8.8.8');assert.equal(f,4);resolve()}catch(x){reject(x)}}));n++;console.log('✓ pins the checked DNS address');
  await assert.rejects(()=>fetchImage('https://example.test/',{lookup:async()=>[{address:'8.8.8.8',family:4},{address:'127.0.0.1',family:4}],request:fake([],[])}),/restricted/);n++;console.log('✓ rejects mixed public and private DNS results');
  seen=[];await assert.rejects(()=>fetchImage('https://example.test/',{lookup,request:fake([{status:302,headers:{location:'http://127.0.0.1/private'}}],seen)}),/restricted/);ok(seen.length===1,'checks redirect destination before connecting');
  await assert.rejects(()=>fetchImage('https://example.test/',{lookup,request:fake([{headers:{'content-type':'text/html'}}],[])}),/not an image/);n++;console.log('✓ rejects non-image content types');
  await assert.rejects(()=>fetchImage('https://example.test/',{lookup,request:fake([{headers:{'content-type':'image/png','content-length':String(5*1024*1024+1)}}],[])}),/larger/);n++;console.log('✓ rejects oversized declared images');
  await assert.rejects(()=>fetchImage('https://example.test/',{lookup,request:fake([{body:Buffer.alloc(5*1024*1024+1)}],[])}),/larger/);n++;console.log('✓ rejects oversized streamed images');
  await assert.rejects(()=>fetchImage('http://user:pass@example.test/',{lookup}),/without credentials/);n++;console.log('✓ rejects embedded URL credentials');
  await assert.rejects(()=>fetchImage('http://hang.test/',{lookup:()=>new Promise(()=>{}),timeoutMs:30}),/timed out/);n++;console.log('✓ bounds DNS resolution time');
  console.log(`PASS: ${n} safe-image checks`);
})().catch(e=>{console.error(e);process.exitCode=1});
