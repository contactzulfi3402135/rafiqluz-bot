#!/usr/bin/env node
'use strict';
// Offline tool: the passphrase is never accepted as a command-line argument.
const fs=require('node:fs');
const readline=require('node:readline');
const {Writable}=require('node:stream');
const crypto=require('node:crypto');
const backup=require('../src/encrypted-backup');
function fdPass(fd){
  const b=Buffer.alloc(1027);let n=0;
  while(n<b.length){const count=fs.readSync(fd,b,n,b.length-n,null);if(!count)break;n+=count;}
  if(n>=b.length)throw Error('Passphrase input is too long.');
  if(n&&b[n-1]===10)n--;if(n&&b[n-1]===13)n--;
  const result=Buffer.from(b.subarray(0,n));b.fill(0);return result;
}
function promptPass(prompt){
  return new Promise((resolve,reject)=>{
    process.stderr.write(prompt);
    const silent=new Writable({write(_chunk,_enc,done){done();}});
    const rl=readline.createInterface({input:process.stdin,output:silent,terminal:true});
    rl.once('SIGINT',()=>{rl.close();reject(Error('Interrupted.'));});
    rl.question('',answer=>{rl.close();process.stderr.write('\n');resolve(Buffer.from(answer,'utf8'));});
  });
}
async function main(){
  const args=process.argv.slice(2);const [mode,input,output]=args;
  if(!['encrypt','decrypt'].includes(mode)||!input||!output||(args.length!==3&&!(args.length===5&&args[3]==='--passphrase-fd'&&/^(?:[3-9]|[1-9][0-9]{1,2})$/.test(args[4])))){
    console.error('Usage: node scripts/encrypt-backup.js encrypt|decrypt INPUT OUTPUT [--passphrase-fd N]');
    console.error('Use an interactive terminal for a hidden passphrase prompt, or supply a separately opened file descriptor (3–999).');process.exitCode=2;return;
  }
  let pass,confirm;
  try{
    if(args.length===5)pass=fdPass(Number(args[4]));
    else {
      if(!process.stdin.isTTY)throw Error('A terminal is required unless --passphrase-fd is supplied.');
      pass=await promptPass('Backup passphrase (input hidden): ');
      if(mode==='encrypt'){
        confirm=await promptPass('Repeat passphrase: ');
        if(pass.length!==confirm.length||!crypto.timingSafeEqual(pass,confirm))throw Error('Passphrases do not match; no output was created.');
      }
    }
    const result=await backup[mode](input,output,pass);
    console.log((mode==='encrypt'?'Encrypted file created: ':'Authenticated plaintext file created: ')+result.destination);
    console.log(mode==='encrypt'?'The original input is still unencrypted. Protect or securely dispose of it separately.':'The output is unencrypted and sensitive; validate it using the offline restore tool.');
  } finally {if(pass)pass.fill(0);if(confirm)confirm.fill(0);}
}
main().catch(err=>{console.error('Backup operation failed: '+err.message);process.exitCode=1;});
