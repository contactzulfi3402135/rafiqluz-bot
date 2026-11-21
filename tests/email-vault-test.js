'use strict';
// Synthetic key/credential migration and mocked SMTP. No provider connection.
const fs=require('fs'),path=require('path'),os=require('os'),assert=require('assert'),crypto=require('crypto'),{spawnSync}=require('child_process');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'raq-vault-test-'));process.env.RAQ_STATE_DIR=root;delete process.env.RAQ_SECRETS_KEY;delete process.env.RAQ_PREVIOUS_SECRETS_KEY;
const cfg=require('../src/config');cfg.ensureDirs();const Database=require('better-sqlite3');let old=new Database(cfg.config.paths.database);
old.exec("CREATE TABLE settings(key TEXT PRIMARY KEY,value TEXT NOT NULL)");
const legacy=[{id:'old-account',label:'Old',provider:'gmail',user:'old@example.com',pass:'synthetic-legacy-secret',host:'',port:0}];old.prepare('INSERT INTO settings(key,value) VALUES(?,?)').run('email.accounts',JSON.stringify(legacy));old.close();
const key1=crypto.randomBytes(32).toString('base64'),key2=crypto.randomBytes(32).toString('base64'),script=path.resolve(__dirname,'../scripts/protect-email-credentials.js');
const run=(args,extra={})=>spawnSync(process.execPath,[script,...args],{encoding:'utf8',env:{...process.env,...extra}});let n=0;const ok=(x,label)=>{assert.ok(x,label);n++;console.log('✓ '+label)};
(async()=>{
 let result=run([],{RAQ_SECRETS_KEY:key1});ok(result.status===2&&!result.stdout.includes(key1),'offline migration requires explicit stop and backup acknowledgements');
 result=run(['--confirm-stopped','--confirm-backup'],{RAQ_SECRETS_KEY:'invalid'});ok(result.status===1,'invalid encryption key prevents migration');
 result=run(['--confirm-stopped','--confirm-backup'],{RAQ_SECRETS_KEY:key1});assert.equal(result.status,0,result.stderr);ok(!result.stdout.includes('synthetic-legacy-secret')&&!result.stdout.includes(key1),'offline migration completes without printing keys or passwords');
 process.env.RAQ_SECRETS_KEY=key1;const db=require('../src/db'),d=db.open(),email=require('../src/email'),vault=require('../src/email-vault'),nm=require('nodemailer'),orig=nm.createTransport;let sends=[],credentials=[];
 nm.createTransport=options=>{credentials.push(options.auth.pass);return {sendMail:async msg=>{sends.push(msg.to);return {accepted:[msg.to],messageId:'synthetic'}}}};
 try{
  let raw=db.S.get('email.accounts'),items=JSON.parse(raw);ok(!raw.includes('synthetic-legacy-secret')&&!!items[0].pass_enc&&!items[0].pass&&!!db.S.get('email.secret_key_check'),'live settings use authenticated ciphertext after migration');
  ok(email.securityStatus().mode==='protected'&&email.publicAccounts()[0].user==='old@example.com','owner can list protected accounts without seeing their credentials');
  const complete=await require('../src/full-backup').create(),recovery=path.join(root,'offline-copy');await require('../scripts/restore-full-backup').extractBackup(complete.zipPath,recovery);
  const restored=new Database(path.join(recovery,'bot.sqlite'),{readonly:true});const restoredRaw=restored.prepare("SELECT value FROM settings WHERE key='email.accounts'").get().value,restoredMarker=restored.prepare("SELECT value FROM settings WHERE key='email.secret_key_check'").get().value;restored.close();fs.rmSync(complete.dir,{recursive:true,force:true});
  const recoveredKey=vault.keyFrom(key1);vault.verifyMarker(recoveredKey,restoredMarker);const recoveredPassword=vault.open(recoveredKey,JSON.parse(restoredRaw)[0].pass_enc,vault.aad('old-account'));recoveredKey.fill(0);ok(!restoredRaw.includes('synthetic-legacy-secret')&&recoveredPassword==='synthetic-legacy-secret','complete backup preserves encrypted settings recoverable with the separate key');

  let r=await email.sendOrQueue({accountId:'old-account',to:'recipient@example.com',subject:'test'});ok(r.complete&&credentials[0]==='synthetic-legacy-secret','correct key decrypts the migrated credential for mocked SMTP');
  let added=email.addAccount({label:'New',provider:'gmail',user:'new@example.com',pass:'synthetic-new-secret'});raw=db.S.get('email.accounts');items=JSON.parse(raw);ok(!raw.includes('synthetic-new-secret')&&items.find(x=>x.id===added.id).pass_enc,'new credentials are encrypted when a valid key is configured');
  assert.throws(()=>vault.open(vault.keyFrom(key1),items[0].pass_enc,vault.aad(added.id)),/missing, incorrect or damaged/);ok(true,'ciphertext cannot be moved between account identities');
  const when=new Date(Date.now()-60000).toISOString();await email.sendOrQueue({accountId:added.id,to:'queue@example.com',subject:'pending while locked',scheduleAt:when});
  const previousCount=sends.length,unchanged=db.S.get('email.accounts');process.env.RAQ_SECRETS_KEY=key2;
  await assert.rejects(()=>email.sendOrQueue({accountId:added.id,to:'recipient@example.com',subject:'wrong key'}),/credential key/);assert.throws(()=>email.addAccount({provider:'gmail',user:'bad@example.com',pass:'synthetic'}),/credential key/);
  await email.processQueue();ok(sends.length===previousCount&&db.S.get('email.accounts')===unchanged&&d.prepare("SELECT status FROM email_queue WHERE subject='pending while locked'").get().status==='pending'&&email.securityStatus().mode==='locked','wrong key fails closed without altering accounts or claiming queued mail');
  delete process.env.RAQ_SECRETS_KEY;await assert.rejects(()=>email.sendOrQueue({accountId:added.id,to:'recipient@example.com',subject:'missing key'}),/credential key/);ok(sends.length===previousCount,'missing key blocks SMTP before any provider call');
  process.env.RAQ_SECRETS_KEY=key1;await email.processQueue();ok(sends.includes('queue@example.com'),'restoring the key allows a previously waiting job to run');
  const beforeRotate=db.S.get('email.accounts');assert.throws(()=>require('../scripts/protect-email-credentials').migrate(cfg.config.paths.database,key2,key2),/credential key/);ok(db.S.get('email.accounts')===beforeRotate,'failed key rotation leaves every stored credential unchanged');
  const rotated=require('../scripts/protect-email-credentials').migrate(cfg.config.paths.database,key2,key1);process.env.RAQ_SECRETS_KEY=key2;
  r=await email.sendOrQueue({accountId:'old-account',to:'rotate@example.com',subject:'rotated'});ok(rotated.accounts===2&&r.complete&&credentials.at(-1)==='synthetic-legacy-secret','successful atomic key rotation preserves SMTP access');
  process.env.RAQ_SECRETS_KEY=key1;await assert.rejects(()=>email.sendOrQueue({accountId:'old-account',to:'wrong@example.com',subject:'old key'}),/credential key/);ok(true,'old key cannot unlock records after rotation');
  process.env.RAQ_SECRETS_KEY=key2;const encrypted=db.S.get('email.accounts');db.S.set('email.accounts','{broken');assert.throws(()=>email.addAccount({provider:'gmail',user:'new2@example.com',pass:'x'}),/damaged/);ok(db.S.get('email.accounts')==='{broken','damaged account data is never silently overwritten by an empty list');db.S.set('email.accounts',encrypted);
  console.log(`PASS: ${n} email credential protection checks`);
 }finally{nm.createTransport=orig;d.close();}
})().catch(e=>{console.error(e);process.exitCode=1}).finally(()=>{delete process.env.RAQ_SECRETS_KEY;delete process.env.RAQ_PREVIOUS_SECRETS_KEY;fs.rmSync(root,{recursive:true,force:true})});
