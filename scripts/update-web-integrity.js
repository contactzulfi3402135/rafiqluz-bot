'use strict';
// Developer-only: run after reviewing all six web files and before packaging.
// The local manifest detects accidental mixed trees; it is not an authenticity signature.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
if(process.argv.length!==3||process.argv[2]!=='--acknowledge-source-review'){
  console.error('Review all dashboard source changes first; then run node scripts/update-web-integrity.js --acknowledge-source-review');process.exit(2);
}
const root=path.resolve(__dirname,'..'),guard=require('../src/web-baseline-guard'),baseline=guard.check(root);
if(!baseline.ok){console.error('Refusing to record missing or known-stale dashboard files: '+[...baseline.missing,...baseline.stale].join(', '));process.exit(1);}
const files={};for(const name of Object.keys(guard.KNOWN_OLD).sort()){
  const full=path.join(root,name),st=fs.lstatSync(full);if(!st.isFile()||st.isSymbolicLink())throw Error('Unsafe dashboard source: '+name);
  files[name]=crypto.createHash('sha256').update(fs.readFileSync(full)).digest('hex');
}
const dest=path.join(root,'src','web-integrity.json'),tmp=dest+'.'+process.pid+'.tmp';
try{fs.writeFileSync(tmp,JSON.stringify({version:1,files},null,2)+'\n',{flag:'wx',mode:0o644});fs.renameSync(tmp,dest);}finally{try{fs.unlinkSync(tmp)}catch{}}
console.log('Reviewed dashboard integrity manifest updated. It is not a cryptographic signature.');
