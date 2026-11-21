'use strict';
// Invalid and healthy synthetic SQLite databases only.
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{spawnSync}=require('node:child_process'),Database=require('better-sqlite3');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'raq-schema-synthetic-'));
function boot(file){return spawnSync(process.execPath,['-e',`const c=require('./src/config');c.config.paths.database=process.argv[1];try{require('./src/db').open();process.exit(0)}catch(e){console.error(e.message);process.exit(42)}`,file],{cwd:path.resolve(__dirname,'..'),encoding:'utf8',env:{...process.env,RAQ_STATE_DIR:path.dirname(file)}})}
try{
 const bad=path.join(root,'partial.sqlite');let d=new Database(bad);d.exec("CREATE TABLE settings(key TEXT PRIMARY KEY,value TEXT);INSERT INTO settings VALUES('synthetic','preserve');CREATE TABLE sources(name TEXT);");d.close();let r=boot(bad);assert.equal(r.status,42);assert.match(r.stderr,/Core SQLite schema is incomplete/);console.log('✓ incomplete core schema fails closed at startup');
 d=new Database(bad,{readonly:true});assert.equal(d.prepare("SELECT value FROM settings WHERE key='synthetic'").get().value,'preserve');d.close();console.log('✓ partial schema failure preserves existing synthetic settings');
 const fresh=path.join(root,'fresh.sqlite');r=boot(fresh);assert.equal(r.status,0);console.log('✓ fresh synthetic schema passes core validation');
 console.log('PASS: 3 synthetic schema guard checks');
}finally{fs.rmSync(root,{recursive:true,force:true});}
