'use strict';
// Cooperative local-filesystem guard, not a distributed lease. Every current
// instance holds SQLite reserved locks for all shared mutable roots. Do not
// delete or replace the lock files while a process is running.
const fs=require('node:fs'),path=require('node:path'),Database=require('better-sqlite3');
const NAME='.raqifluz-instance-lock.sqlite';
function isLockFile(name){return name===NAME || [NAME+'-journal',NAME+'-wal',NAME+'-shm'].includes(name);}
function acquire(paths){
  const roots=[path.dirname(paths.database),paths.sessions,paths.media].map(p=>fs.realpathSync(p));
  const unique=[...new Set(roots)].sort();const handles=[];
  try{
    for(const root of unique){
      const file=path.join(root,NAME);
      try{const fd=fs.openSync(file,'wx',0o600);fs.closeSync(fd)}catch(e){if(e.code!=='EEXIST')throw e}
      const stat=fs.lstatSync(file);if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1)throw Error('Unsafe instance lock file.');
      const db=new Database(file,{fileMustExist:true,timeout:0});handles.push(db);
      try{db.exec('BEGIN IMMEDIATE')}catch(e){
        if(e.code==='SQLITE_BUSY'||e.code==='SQLITE_LOCKED')throw Error('Another Raqifluz process is using a configured state directory. Stop the other process before starting or migrating.');
        throw e;
      }
    }
    let done=false;return {release(){if(done)return;done=true;let failure;for(const db of handles.reverse()){try{db.exec('ROLLBACK')}catch(e){failure ||= e}try{db.close()}catch(e){failure ||= e}}if(failure)throw failure;}};
  }catch(e){for(const db of handles.reverse()){try{if(db.inTransaction)db.exec('ROLLBACK')}catch{}try{db.close()}catch{}}throw e;}
}
module.exports={acquire,isLockFile,NAME};
