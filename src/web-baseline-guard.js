'use strict';
// Known workspace snapshot failure: six dashboard files were repeatedly reset
// byte-for-byte to an older git baseline while the surrounding source stayed
// upgraded. Starting that mixed tree can remove safety controls. This narrowly
// scoped guard rejects those known old bytes; it does not detect arbitrary
// corruption, repair files, replace backups, or provide a software signature.
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const KNOWN_OLD=Object.freeze({
  'src/web/assets/app.css':'4706d7310c0773663f093770bcbda0def3d055dd6f1454c328dc0395ac9ba713',
  'src/web/assets/app.js':'6c1549899dad58676020e70b460f185e110aa156e664f489eb32c2ebc71a5e57',
  'src/web/assets/sw.js':'cd53b1eafd3c528931090e3ad634b45466ae16a5e22051a248de1a165066f13b',
  'src/web/server.js':'3058c6e8484c9be4e49e6f86c116ef83e6afabfb86d282e373c0e7b2a64d6f7e',
  'src/web/views/dashboard.ejs':'dcc4b25aa8c12d4366b3fb06422ee901577e25a9716471ee8ba09b10bf2a8693',
  'src/web/views/login.ejs':'f1d5fffa9fa8e0bf958a741c15a8bb622bb3dcaebb41293ecd2ce73db3bf07fd'
});
// Checkpoint 36 was a coherent earlier build, but is unsafe when mixed with
// the later database/client contracts. These are exact byte signatures only.
const CHECKPOINT_36=Object.freeze({
  'src/web/assets/app.css':'15a1dc2c936d73f251e079a1a5b70e4e6c73f2432627bbdb8d31a7c753ee2b4a',
  'src/web/assets/app.js':'7127aadd58870670a42a56f93f9e3bae434eeacd2ce3f1019d75fb44b5b1e728',
  'src/web/assets/sw.js':'51ee7ec76894bbf4752318480c7685cd1c9a437dc2888ec964576e87dac12b88',
  'src/web/server.js':'75ba2b7f0b5dc831cc362e01bbd6858c6fd56671dde8850b751e0492c04328e4',
  'src/web/views/dashboard.ejs':'1411902287bc044fe696f3a286d5437b46676674deed8ae436e83617e2629aeb',
  'src/web/views/login.ejs':'66642bf5d9b03684db36fa27f499e67f4159008907cdf156d0b17f83aead2360'
});
const DEFAULT_SIGNATURES=Object.freeze(Object.fromEntries(Object.keys(KNOWN_OLD).map(k=>[k,[KNOWN_OLD[k],CHECKPOINT_36[k]]])));
function check(root, signatures=DEFAULT_SIGNATURES) {
  const stale=[],missing=[];
  for(const [relative,oldHashes] of Object.entries(signatures)){
    try {
      const digest=crypto.createHash('sha256').update(fs.readFileSync(path.join(root,relative))).digest('hex');
      if((Array.isArray(oldHashes)?oldHashes:[oldHashes]).includes(digest))stale.push(relative);
    } catch {missing.push(relative);}
  }
  return {ok:stale.length===0&&missing.length===0,stale,missing};
}
// A checked-in manifest detects arbitrary accidental changes to these files,
// unlike the exact historic signatures above. It is not a digital signature or
// protection against an attacker able to modify both code and manifest.
function checkIntegrity(root, expected) {
  const required=Object.keys(KNOWN_OLD).sort(),mismatched=[];
  if(!expected || typeof expected!=='object'||Array.isArray(expected)||Object.keys(expected).sort().join('\n')!==required.join('\n'))return {ok:false,mismatched:['invalid manifest']};
  for(const relative of required){
    try{
      if(typeof expected[relative]!=='string'||!/^[a-f0-9]{64}$/.test(expected[relative])){mismatched.push(relative);continue;}
      const file=path.join(root,relative),st=fs.lstatSync(file);
      if(!st.isFile()||st.isSymbolicLink()||crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')!==expected[relative])mismatched.push(relative);
    }catch{mismatched.push(relative);}
  }
  return {ok:mismatched.length===0,mismatched};
}
function assertCompatible(root){
  const r=check(root);
  if(!r.ok)throw new Error('Dashboard source is missing or matches a known stale workspace snapshot ('+[...r.stale,...r.missing].join(', ')+'). Stop and reconcile source files with a verified backup; do not replace database, sessions or uploads.');
  let manifest;try{manifest=JSON.parse(fs.readFileSync(path.join(root,'src/web-integrity.json'),'utf8'));}catch{throw new Error('Dashboard integrity manifest is missing or invalid. Stop and reconcile source files with a verified backup.');}
  const integrity=checkIntegrity(root,manifest.files);
  if(manifest.version!==1||!integrity.ok)throw new Error('Dashboard files differ from the reviewed integrity manifest ('+integrity.mismatched.join(', ')+'). Stop and reconcile source files with a verified backup; do not replace database, sessions or uploads.');
}
module.exports={check,checkIntegrity,assertCompatible,KNOWN_OLD,CHECKPOINT_36};
