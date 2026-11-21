'use strict';
// Offline encryption for an already-created portable backup. This does NOT
// encrypt the live database, cloud snapshots, or the original plaintext ZIP.
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {promisify}=require('node:util');
const scrypt=promisify(crypto.scrypt);
const MAGIC=Buffer.from('RAQENC01','ascii');
const SALT_BYTES=16, IV_BYTES=12, TAG_BYTES=16;
const HEADER_BYTES=MAGIC.length+SALT_BYTES+IV_BYTES;
const MAX_INPUT=512*1024*1024;
// Fixed v1 parameters. Never accept KDF costs from an untrusted file.
const SCRYPT={N:1<<17,r:8,p:1,maxmem:192*1024*1024};

function checkPassword(password,encrypting) {
  if(!Buffer.isBuffer(password)||!password.length||password.length>1024)throw Error('Passphrase must be 1–1024 UTF-8 bytes.');
  if(encrypting && password.length<16)throw Error('Choose a passphrase of at least 16 UTF-8 bytes; a randomly generated passphrase is recommended.');
}
function unchanged(a,b){return b.isFile()&&a.dev===b.dev&&a.ino===b.ino&&a.size===b.size&&a.mtimeMs===b.mtimeMs&&a.ctimeMs===b.ctimeMs;}
async function readExact(file,buffer,position){let used=0;while(used<buffer.length){const r=await file.read(buffer,used,buffer.length-used,position+used);if(!r.bytesRead)throw Error('Input was truncated or changed.');used+=r.bytesRead;}}
async function writeAll(file,buffer,position){let used=0;while(used<buffer.length){const r=await file.write(buffer,used,buffer.length-used,position+used);if(!r.bytesWritten)throw Error('Output could not be written.');used+=r.bytesWritten;}}

async function transform(mode,input,output,password) {
  if(mode!=='encrypt'&&mode!=='decrypt')throw Error('Invalid operation.');
  checkPassword(password,mode==='encrypt');
  const final=path.resolve(output),parent=await fs.promises.realpath(path.dirname(final));
  const target=path.join(parent,path.basename(final));
  let source,out,key,tmpdir;
  try {
    const initial=await fs.promises.lstat(input);
    if(!initial.isFile()||initial.isSymbolicLink())throw Error('Input must be a regular file, not a symbolic link.');
    if(initial.size>MAX_INPUT+(mode==='decrypt'?HEADER_BYTES+TAG_BYTES:0))throw Error('Input exceeds the 512 MB limit.');
    if(mode==='encrypt'&&!initial.size)throw Error('Input is empty.');
    if(mode==='decrypt'&&initial.size<=HEADER_BYTES+TAG_BYTES)throw Error('Encrypted input is incomplete or empty.');
    source=await fs.promises.open(input,fs.constants.O_RDONLY|(fs.constants.O_NOFOLLOW||0));
    if(!unchanged(initial,await source.stat()))throw Error('Input changed before reading.');
    // Private staging ensures unauthenticated decrypted bytes never appear at
    // the destination. A process crash can leave private staging on disk.
    tmpdir=await fs.promises.mkdtemp(path.join(parent,'.raq-crypt-'));
    const temporary=path.join(tmpdir,'payload');
    out=await fs.promises.open(temporary,'wx',0o600);
    let header,tag,cipher,offset,length;
    if(mode==='encrypt'){
      header=Buffer.concat([MAGIC,crypto.randomBytes(SALT_BYTES),crypto.randomBytes(IV_BYTES)]);
      offset=0;length=initial.size;
    } else {
      header=Buffer.alloc(HEADER_BYTES);await readExact(source,header,0);
      if(!header.subarray(0,MAGIC.length).equals(MAGIC))throw Error('Unsupported encrypted backup format.');
      tag=Buffer.alloc(TAG_BYTES);await readExact(source,tag,initial.size-TAG_BYTES);
      offset=HEADER_BYTES;length=initial.size-HEADER_BYTES-TAG_BYTES;
    }
    key=await scrypt(password,header.subarray(MAGIC.length,MAGIC.length+SALT_BYTES),32,SCRYPT);
    const iv=header.subarray(MAGIC.length+SALT_BYTES);
    if(mode==='encrypt')cipher=crypto.createCipheriv('aes-256-gcm',key,iv,{authTagLength:TAG_BYTES});
    else {cipher=crypto.createDecipheriv('aes-256-gcm',key,iv,{authTagLength:TAG_BYTES});cipher.setAuthTag(tag);}
    cipher.setAAD(header);
    let written=0;
    if(mode==='encrypt'){await writeAll(out,header,written);written+=header.length;}
    const buffer=Buffer.allocUnsafe(256*1024);let processed=0;
    while(processed<length){
      const size=Math.min(buffer.length,length-processed);const r=await source.read(buffer,0,size,offset+processed);
      if(!r.bytesRead)throw Error('Input was truncated or changed.');
      const part=cipher.update(buffer.subarray(0,r.bytesRead));await writeAll(out,part,written);written+=part.length;processed+=r.bytesRead;
    }
    let last;try{last=cipher.final();}catch{throw Error('Authentication failed: wrong passphrase or damaged encrypted backup.');}
    await writeAll(out,last,written);written+=last.length;
    if(mode==='encrypt'){const end=cipher.getAuthTag();await writeAll(out,end,written);}
    if(!unchanged(initial,await source.stat()))throw Error('Input changed while reading; no output was installed.');
    await out.sync();await out.close();out=null;
    // Hard-link creation is an atomic no-overwrite publication on the same
    // filesystem. No path is published until authentication has succeeded.
    try{await fs.promises.link(temporary,target);}catch(e){if(e.code==='EEXIST')throw Error('Destination already exists; nothing was overwritten.');throw e;}
    return {destination:target};
  } finally {
    if(key)key.fill(0);
    if(source)await source.close().catch(()=>{});
    if(out)await out.close().catch(()=>{});
    if(tmpdir)await fs.promises.rm(tmpdir,{recursive:true,force:true}).catch(()=>{});
  }
}
module.exports={encrypt:(input,output,password)=>transform('encrypt',input,output,password),decrypt:(input,output,password)=>transform('decrypt',input,output,password),MAX_INPUT};
