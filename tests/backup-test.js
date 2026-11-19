'use strict';
const assert=require('node:assert/strict');
const fs=require('fs'),path=require('path'),os=require('os');
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'raq-backup-test-'));
const config=require('../src/config');config.config.paths.database=path.join(tmp,'backup-unit.sqlite');config.config.paths.sessions=path.join(tmp,'sessions');config.ensureDirs();
const db=require('../src/db'); const backup=require('../src/backup');const d=db.open();
let count=0;function check(fn,label){fn();console.log('✓',label);count++}
const archive=backup.buildZip([{name:'bot.sqlite',data:Buffer.from('sqlite placeholder')},{name:'manifest.json',data:Buffer.from('{}')}]);
check(()=>assert.equal(backup.readZip(archive)[0].data.toString(),'sqlite placeholder'),'normal zip roundtrip');
check(()=>{const corrupt=Buffer.from(archive);corrupt[40]^=1;assert.throws(()=>backup.readZip(corrupt))},'corruption rejected');
check(()=>assert.throws(()=>backup.readZip(backup.buildZip([{name:'../bad',data:Buffer.from('x')}]))) ,'unsafe archive paths rejected');
check(()=>assert.throws(()=>backup.readZip(backup.buildZip(Array.from({length:65},(_,i)=>({name:'f'+i,data:Buffer.from('x')}))))),'excessive zip entries rejected');
d.exec('CREATE TABLE IF NOT EXISTS test_future_feature(id INTEGER PRIMARY KEY, value TEXT)');d.exec("DELETE FROM test_future_feature; INSERT INTO test_future_feature(value) VALUES ('keep-new-data')");
let old=path.join(path.dirname(config.config.paths.database),'old-snapshot.sqlite');try{fs.unlinkSync(old)}catch{};
d.exec(`VACUUM INTO '${old.replace(/'/g,"''")}'`);
const Database=require('better-sqlite3');const other=new Database(old);other.exec('DROP TABLE test_future_feature');other.close();
check(()=>{backup.restoreFromBuffer(fs.readFileSync(old));assert.equal(d.prepare('SELECT value FROM test_future_feature').get().value,'keep-new-data')},'older backup preserves tables it does not contain');
check(()=>assert.throws(()=>backup.restoreFromBuffer(Buffer.from('not sqlite'))),'invalid restore rejected');
console.log(`PASS: ${count} backup checks`);d.close();fs.rmSync(tmp,{recursive:true,force:true});
