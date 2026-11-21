'use strict';
// Synthetic local tests. No account, GitHub access or messaging provider.
const fs=require('fs'), path=require('path'), os=require('os'), assert=require('assert');
const {spawnSync}=require('child_process');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'raq-persist-safe-'));
const project=path.resolve(__dirname,'..');
const run=(code,env={})=>spawnSync(process.execPath,['-e',code],{cwd:project,encoding:'utf8',env:{...process.env,...env}});
let n=0;const check=(ok,label)=>{assert.ok(ok,label);n++;console.log('✓ '+label);};
(async()=>{
  const env={RAQ_STATE_DIR:path.join(root,'mounted-state'),DATABASE_PATH:'',SESSION_DIR:'',MEDIA_DIR:'',BACKUP_DIR:'',LOG_DIR:''};
  let result=run(`const c=require('./src/config');c.ensureDirs();const d=require('./src/db').open();d.prepare("INSERT INTO settings(key,value) VALUES('restart.test','preserved')").run();require('fs').writeFileSync(require('path').join(c.config.paths.sessions,'synthetic-key'),'private');d.close();console.log(JSON.stringify(c.config.paths));`,env);
  assert.equal(result.status,0,result.stderr);
  const paths=JSON.parse(result.stdout.trim().split('\n').pop());
  check(Object.values(paths).every(p=>p.startsWith(path.join(root,'mounted-state')+path.sep)),'all mutable storage uses the configured mounted directory');
  result=run(`const c=require('./src/config');c.ensureDirs();const d=require('./src/db').open();console.log(JSON.stringify({setting:d.prepare("SELECT value FROM settings WHERE key='restart.test'").get().value,key:require('fs').readFileSync(require('path').join(c.config.paths.sessions,'synthetic-key'),'utf8')}));d.close();`,env);
  assert.equal(result.status,0,result.stderr);const restarted=JSON.parse(result.stdout.trim().split('\n').pop());
  check(restarted.setting==='preserved'&&restarted.key==='private','database and session bytes survive a separate process restart on mounted storage');
  const override=path.join(root,'separate.sqlite');result=run(`console.log(require('./src/config').config.paths.database)`,{...env,DATABASE_PATH:override});
  check(result.status===0&&result.stdout.trim()===override,'absolute database path override works');

  process.env.PERSIST_GITHUB_REPO='example/private';process.env.PERSIST_GITHUB_TOKEN='synthetic';process.env.PERSIST_GITHUB_BRANCH='bot-state';
  const cfg=require('../src/config');cfg.config.paths.database=path.join(root,'cloud','bot.sqlite');cfg.config.paths.sessions=path.join(root,'cloud','sessions');cfg.config.paths.media=path.join(root,'cloud','media');
  fs.mkdirSync(path.dirname(cfg.config.paths.database),{recursive:true});
  const db=require('better-sqlite3')(cfg.config.paths.database);db.pragma('journal_mode=WAL');db.exec("CREATE TABLE probe(value TEXT); INSERT INTO probe VALUES ('live WAL data')");
  const persist=require('../src/persist');
  global.fetch=async(url)=>String(url).includes('/git/ref/') ? new Response(JSON.stringify({object:{sha:'head'}}),{status:200}) : new Response('temporarily unavailable',{status:503});
  await assert.rejects(()=>persist.restoreEarly(),/startup stopped/i);
  check(persist.publicStatus().writeBlocked===true,'failed cloud read blocks future writes that could replace the backup');
  await assert.rejects(()=>persist.upload(),/writes are blocked/i);check(true,'manual cloud upload cannot bypass a failed restore');
  global.fetch=async(url)=>String(url).includes('/git/ref/') ? new Response(JSON.stringify({object:{sha:'head'}}),{status:200}) : new Response('{}',{status:404});
  await persist.restoreEarly();check(persist.publicStatus().writeBlocked===false,'a verified empty cloud branch permits a fresh backup');
  const snap=await persist._test.snapshot();
  const extraction=path.join(root,'extract');fs.mkdirSync(extraction);await require('../src/safe-archive').extract(snap.zipPath,extraction);
  const restored=require('better-sqlite3')(path.join(extraction,'bot.sqlite'),{readonly:true});check(restored.prepare('SELECT value FROM probe').get().value==='live WAL data','cloud archive includes committed SQLite WAL data in a standalone snapshot');restored.close();
  fs.rmSync(path.dirname(snap.zipPath),{recursive:true,force:true});db.close();
  console.log(`PASS: ${n} persistence safety checks`);
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>fs.rmSync(root,{recursive:true,force:true}));
