'use strict';
// Synthetic GitHub responses. No network or account is contacted.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'raq-cloud-http-'));process.env.RAQ_STATE_DIR=root;process.env.PERSIST_GITHUB_REPO='example/private';process.env.PERSIST_GITHUB_TOKEN='synthetic-token';
const persist=require('../src/persist'),http=require('../src/cloud-http');let mode='small',requests=[],n=0;function ok(v,s){assert.ok(v,s);n++;console.log('✓ '+s)}
const sample=Buffer.from('synthetic zip bytes');
const largeStream=(size,chunkSize)=>new ReadableStream({start(){this.pos=0},pull(c){if(this.pos>=size)return c.close();const n=Math.min(chunkSize,size-this.pos);this.pos+=n;c.enqueue(new Uint8Array(n))}});
global.fetch=async(url,opts)=>{url=String(url);requests.push({url,opts});if(url.includes('/git/ref/'))return new Response('{}',{status:200});
 if(opts.headers.Accept==='application/vnd.github.raw+json'){
  if(mode==='rawsize')return new Response('x',{headers:{'content-length':String(http.ARCHIVE_LIMIT+1)}});
  if(mode==='streamlarge')return new Response(largeStream(http.ARCHIVE_LIMIT+1,4*1024*1024));
  return new Response(sample);
 }
 if(mode==='metadata-large')return new Response(largeStream(http.META_LIMIT+1,65536));
 if(mode==='invalid')return new Response(JSON.stringify({sha:'fake',size:7,content:'!bad*'}));
 if(mode==='declared')return new Response(JSON.stringify({sha:'fake',size:http.ARCHIVE_LIMIT+1,content:''}));
 if(mode==='mismatch')return new Response(JSON.stringify({sha:'fake',size:sample.length+1,content:''}));
 return new Response(JSON.stringify({sha:'fake',size:sample.length,content:mode==='small'?sample.toString('base64').replace(/(.{4})/g,'$1\n'):''}));
};
(async()=>{try{
 let p=await persist._test.download();ok(fs.readFileSync(p).equals(sample)&&!(fs.statSync(p).mode&0o077),'inline legacy base64 snapshot is bounded and staged privately');fs.rmSync(path.dirname(p),{recursive:true,force:true});
 mode='raw';p=await persist._test.download();ok(fs.readFileSync(p).equals(sample),'raw snapshot streams to a private staging file');fs.rmSync(path.dirname(p),{recursive:true,force:true});
 ok(requests.every(x=>x.opts.redirect==='error'&&x.opts.signal instanceof AbortSignal),'all GitHub requests reject redirects and use an abort deadline');
 mode='invalid';await assert.rejects(persist._test.download(),/content is invalid/);ok(true,'malformed base64 is refused instead of silently decoded');
 mode='declared';await assert.rejects(persist._test.download(),/safe download size/);ok(true,'oversized metadata aborts before a raw download');
 mode='rawsize';await assert.rejects(persist._test.download(),/size limit/);ok(true,'oversized declared raw response is refused');
 mode='mismatch';await assert.rejects(persist._test.download(),/does not match metadata/);ok(true,'truncated or inconsistent raw response is refused');
 mode='metadata-large';await assert.rejects(persist._test.download(),/incomplete/);ok(true,'unbounded metadata is rejected before parsing');
 mode='streamlarge';const before=new Set(fs.readdirSync(os.tmpdir()).filter(x=>x.startsWith('raq7-dl-')));await assert.rejects(persist._test.download(),/size limit/);const after=fs.readdirSync(os.tmpdir()).filter(x=>x.startsWith('raq7-dl-')&&!before.has(x));ok(after.length===0,'stream beyond the archive cap fails and removes private staging');
 mode='metadata-large';await assert.rejects(persist.restoreEarly(),/startup stopped/i);ok(persist.publicStatus().writeBlocked===true,'unverifiable cloud response blocks startup and future writes when local state is absent');
 console.log(`PASS: ${n} bounded cloud transport checks`);
 }finally{fs.rmSync(root,{recursive:true,force:true})}})().catch(e=>{console.error(e);process.exit(1)});
