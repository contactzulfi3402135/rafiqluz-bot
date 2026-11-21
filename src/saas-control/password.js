'use strict';
const crypto=require('node:crypto'),{promisify}=require('node:util'),scrypt=promisify(crypto.scrypt);
const N=65536,r=8,p=1,maxmem=128*1024*1024;
// Each derivation uses approximately 64 MiB. Refuse rather than enqueue an
// unbounded number of expensive jobs; this is per process, not a global limit.
const MAX_CONCURRENT=2;let running=0;
async function derive(password,salt){
  if(running>=MAX_CONCURRENT){const e=Error('Authentication temporarily busy');e.code='AUTH_BUSY';throw e;}
  running++;try{return await scrypt(password,salt,32,{N,r,p,maxmem});}finally{running--;}
}
async function hash(password){
  if(typeof password!=='string'||password.length<12||Buffer.byteLength(password)>1024)throw Error('Password must contain at least 12 characters and at most 1024 UTF-8 bytes.');
  const salt=crypto.randomBytes(16),key=await derive(password,salt);return `scrypt$${N}$${r}$${p}$${salt.toString('base64')}$${key.toString('base64')}`;
}
async function verify(password,encoded){
  if(typeof password!=='string'||Buffer.byteLength(password)>1024||typeof encoded!=='string')return false;
  const a=encoded.split('$');if(a.length!==6||a[0]!=='scrypt'||Number(a[1])!==N||Number(a[2])!==r||Number(a[3])!==p)return false;
  const salt=Buffer.from(a[4],'base64'),expected=Buffer.from(a[5],'base64');if(salt.length!==16||expected.length!==32||salt.toString('base64')!==a[4]||expected.toString('base64')!==a[5])return false;
  const actual=await derive(password,salt);return crypto.timingSafeEqual(actual,expected);
}
module.exports={hash,verify};
