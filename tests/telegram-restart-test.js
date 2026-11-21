'use strict';
// Two independent Node processes share only a synthetic SQLite state directory.
const fs=require('fs'),os=require('os'),path=require('path'),cp=require('child_process'),assert=require('assert');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'raq-telegram-restart-'));
const id=require('crypto').randomUUID(),env={...process.env,RAQ_STATE_DIR:root,TELEGRAM_BOT_TOKEN:'123456:abcdefghijklmnopqrstuvwxyzABCDEFG',TEST_ID:id};
function run(code){const p=cp.spawnSync(process.execPath,['-e',"require('./src/config').ensureDirs();"+code],{cwd:path.join(__dirname,'..'),env,encoding:'utf8'});if(p.status!==0)throw Error(p.stderr||p.stdout);return p.stdout.trim();}
try{
 run("const q=require('./src/telegram-schedules');q.create({requestId:process.env.TEST_ID,target:'@examplechannel',text:'Restart state',sendAt:new Date(Date.now()+3600000).toISOString(),confirmed:true});require('./src/db').open().close()");
 const result=JSON.parse(run("const q=require('./src/telegram-schedules');const r=q.get(process.env.TEST_ID);console.log(JSON.stringify(r));require('./src/db').open().close()"));
 assert.equal(result.text,'Restart state');assert.equal(result.state,'waiting');console.log('✓ waiting schedule survives independent process restart with persistent state');
 run("const d=require('./src/db').open();d.prepare(\"UPDATE telegram_schedules SET state='processing' WHERE id=?\").run(process.env.TEST_ID);d.close()");
 const recovered=JSON.parse(run("const q=require('./src/telegram-schedules');q.recover();console.log(JSON.stringify(q.get(process.env.TEST_ID)));require('./src/db').open().close()"));
 assert.equal(recovered.state,'needs_review');console.log('✓ interrupted schedule needs review after independent process restart');
 console.log('PASS: 2 Telegram restart checks');
}finally{fs.rmSync(root,{recursive:true,force:true})}
