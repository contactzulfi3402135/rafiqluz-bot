#!/usr/bin/env node
'use strict';
// Run only with the app and every worker stopped. Keeps no copy of the key in
// SQLite. A database backup and each older key must be retained independently.
const Database=require('better-sqlite3');
const fs=require('node:fs');
const config=require('../src/config'),cfg=config.config;
const vault=require('../src/email-vault');
function migrate(database,newRaw,oldRaw){
  let next,old,d,guard;
  try{
    next=vault.keyFrom(newRaw);old=oldRaw?vault.keyFrom(oldRaw):Buffer.from(next);
    if(!fs.existsSync(database))throw Error('Database does not exist; no changes were made.');
    config.ensureDirs();guard=require('../src/instance-lock').acquire({...cfg.paths,database});
    d=new Database(database,{fileMustExist:true});d.pragma('busy_timeout = 5000');d.pragma('secure_delete = ON');
    const run=d.transaction(()=>{
      const settings=d.prepare('SELECT value FROM settings WHERE key=?');
      const row=settings.get('email.accounts');if(!row)return {accounts:0,changed:false};
      let list;try{list=JSON.parse(row.value)}catch{throw Error('Email account data is invalid; no changes were made.');}
      if(!Array.isArray(list)||list.length>10)throw Error('Email account data is invalid; no changes were made.');
      const marker=settings.get('email.secret_key_check')?.value||'';vault.validateEntries(list,old,marker);
      const ids=new Set();const result=list.map(a=>{
        if(!a||typeof a.id!=='string'||!a.id||ids.has(a.id)||typeof a.user!=='string'||(a.pass_enc&&a.pass))throw Error('Email account data is invalid; no changes were made.');
        ids.add(a.id);const password=a.pass_enc?vault.open(old,a.pass_enc,vault.aad(a.id)):a.pass;
        if(typeof password!=='string'||!password||password.length>4096)throw Error('Email credential data is invalid; no changes were made.');
        const copy={...a,pass_enc:vault.seal(next,password,vault.aad(a.id))};delete copy.pass;return copy;
      });
      const put=d.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value');
      put.run('email.accounts',JSON.stringify(result));put.run('email.secret_key_check',vault.createMarker(next));
      return {accounts:result.length,changed:true};
    });return run.immediate();
  } finally {try{if(d)d.close()}finally{try{if(guard)guard.release()}finally{if(next)next.fill(0);if(old)old.fill(0)}}}
}
if(require.main===module){
  const args=process.argv.slice(2);
  if(args.length!==2||!args.includes('--confirm-stopped')||!args.includes('--confirm-backup')){
    console.error('Usage: node scripts/protect-email-credentials.js --confirm-stopped --confirm-backup');
    console.error('Stop the app and workers; verify an independent backup and key recovery before running.');process.exitCode=2;
  }else try{
    const result=migrate(cfg.paths.database,process.env.RAQ_SECRETS_KEY,process.env.RAQ_PREVIOUS_SECRETS_KEY);
    console.log(result.changed?`Protected ${result.accounts} SMTP credential(s) in one database transaction.`:'No email account setting was found; nothing was changed.');
    console.log('Old database pages, WAL files, backups and snapshots may still contain plaintext. Keep earlier keys for older backups.');
  }catch(e){console.error('Credential protection failed: '+e.message);process.exitCode=1;}
}
module.exports={migrate};
