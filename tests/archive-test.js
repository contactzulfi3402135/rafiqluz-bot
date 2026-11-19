'use strict';
const assert=require('node:assert/strict'), fs=require('fs'), path=require('path'), os=require('os');
const {extract}=require('../src/safe-archive');const {buildZip}=require('../src/backup');
(async()=>{
 const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'raq-archive-test-'));
 try {
  const normal=path.join(tmp,'normal.zip');
  fs.writeFileSync(normal,buildZip([{name:'sessions/main/creds.json',data:Buffer.from('{"registered":true}')},{name:'bot.sqlite',data:Buffer.from('fake-db')}]));
  const root=path.join(tmp,'normal');fs.mkdirSync(root);await extract(normal,root);
  assert.equal(fs.readFileSync(path.join(root,'sessions/main/creds.json'),'utf8'),'{"registered":true}');console.log('✓ normal cloud backup extracted');
  let zip=buildZip([{name:'sessions/link',data:Buffer.from('../../outside')}]);
  const central=zip.indexOf(Buffer.from([0x50,0x4b,0x01,0x02]));
  zip.writeUInt16LE((3<<8)|20,central+4);zip.writeUInt32LE((0o120777 << 16)>>>0,central+38);
  const bad=path.join(tmp,'symlink.zip');fs.writeFileSync(bad,zip);const target=path.join(tmp,'bad');fs.mkdirSync(target);
  await assert.rejects(extract(bad,target),/link|unsupported/i);console.log('✓ symlink archive rejected');
  let corrupted=buildZip([{name:'sessions/main/data.json',data:Buffer.from('example')}]);
  const start=30+Buffer.byteLength('sessions/main/data.json'); corrupted[start]^=1;
  const corruptPath=path.join(tmp,'corrupt.zip');fs.writeFileSync(corruptPath,corrupted);const cdir=path.join(tmp,'corrupt');fs.mkdirSync(cdir);
  await assert.rejects(extract(corruptPath,cdir),/integrity/i);console.log('✓ corrupt cloud archive rejected');
  const {ZipArchive}=await import('archiver');const zipped=path.join(tmp,'archiver.zip');
  await new Promise((resolve,reject)=>{ const out=fs.createWriteStream(zipped),zip=new ZipArchive({zlib:{level:6}});out.on('close',resolve);out.on('error',reject);zip.on('error',reject);zip.pipe(out);zip.append('payload',{name:'sessions/main/creds.json'});zip.append('db',{name:'bot.sqlite'});zip.finalize(); });
  const target2=path.join(tmp,'archiver');fs.mkdirSync(target2);await extract(zipped,target2);
  assert.equal(fs.readFileSync(path.join(target2,'sessions/main/creds.json'),'utf8'),'payload');console.log('✓ compressed production-format snapshot extracted');
  console.log('PASS: 4 cloud archive checks');
 } finally {fs.rmSync(tmp,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1});
