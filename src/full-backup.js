'use strict';
// Sensitive portable snapshot: database + linked sessions + held queue media.
// A database snapshot is consistent; independently changing session files are
// not a transactional snapshot and should be verified by an offline drill.
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const db=require('./db');
const cfg=require('./config');
const MAX_FILES=10000, MAX_FILE=100*1024*1024, MAX_TOTAL=250*1024*1024;
function enumerate(root,prefix,limits={}) {
  const {maxFiles=MAX_FILES,maxFile=MAX_FILE,maxTotal=MAX_TOTAL}=limits;
  const out=[];let total=0;
  if(!fs.existsSync(root)) return {files:out,total};
  const rootStat=fs.lstatSync(root);
  if(!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw Error('Backup source is not a regular directory.');
  function walk(dir,rel) {
    for(const name of fs.readdirSync(dir).sort()) {
      // Guard artefacts are runtime coordination, not recovery data.
      if(!rel && ['sessions','media'].includes(prefix) && require('./instance-lock').isLockFile(name)) {const st=fs.lstatSync(path.join(dir,name));if(!st.isFile()||st.isSymbolicLink())throw Error('Backup lock artefact is not a regular file.');continue;}
      if(name.includes('\\') || name==='.' || name==='..') throw Error('Backup source contains an unsupported filename.');
      const disk=path.join(dir,name), virtual=rel?`${rel}/${name}`:name;
      const st=fs.lstatSync(disk);
      if(st.isSymbolicLink()) throw Error('Backup cannot include symbolic links.');
      if(st.isDirectory()) walk(disk,virtual);
      else if(st.isFile()) {
        if(st.size>maxFile || out.length>=maxFiles || (total+=st.size)>maxTotal) throw Error('Backup exceeds safe size or file limits.');
        out.push({disk,name:`${prefix}/${virtual}`,bytes:st.size,dev:st.dev,ino:st.ino,mtimeMs:st.mtimeMs,ctimeMs:st.ctimeMs});
      } else throw Error('Backup contains an unsupported file type.');
    }
  }
  walk(root,'');return {files:out,total};
}
// Freeze each enumerated regular file into a private staging directory before
// archiving. This prevents a later path replacement from changing what the ZIP
// reader opens and bounds bytes even if a source grows while it is being read.
// It is not a transaction across files; external writers can still change files
// between individual copies, so a restore drill remains essential.
async function stageFile(item, dir, index) {
  const flags=fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0);
  let source, destination;
  const target=path.join(dir,String(index));
  const matches=st=>st.isFile() && st.dev===item.dev && st.ino===item.ino && st.size===item.bytes && st.mtimeMs===item.mtimeMs && st.ctimeMs===item.ctimeMs;
  try {
    // lstat also rejects symlinks on platforms without O_NOFOLLOW.
    if(!matches(fs.lstatSync(item.disk))) throw Error('Backup source changed while preparing the snapshot. Try again.');
    source=await fs.promises.open(item.disk,flags);
    if(!matches(await source.stat())) throw Error('Backup source changed while preparing the snapshot. Try again.');
    destination=await fs.promises.open(target,'wx',0o600);
    const buffer=Buffer.allocUnsafe(256*1024);let copied=0;
    while(copied<item.bytes) {
      const {bytesRead}=await source.read(buffer,0,Math.min(buffer.length,item.bytes-copied),copied);
      if(!bytesRead) throw Error('Backup source changed during the snapshot. Try again.');
      let written=0;
      while(written<bytesRead) {
        const result=await destination.write(buffer,written,bytesRead-written,copied+written);
        if(!result.bytesWritten) throw Error('Could not write backup staging file.');
        written+=result.bytesWritten;
      }
      copied+=bytesRead;
    }
    if(!matches(await source.stat())) throw Error('Backup source changed during the snapshot. Try again.');
    return {disk:target,name:item.name,bytes:copied};
  } catch(e) {
    try { await fs.promises.unlink(target); } catch {}
    throw e;
  } finally {
    if(source) await source.close();
    if(destination) await destination.close();
  }
}
async function create() {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'raq-full-backup-'));
  const dbPath=path.join(dir,'bot.sqlite'),zipPath=path.join(dir,'raqifluz-complete-backup.zip');
  try {
    db.open().exec(`VACUUM INTO '${dbPath.replace(/'/g,"''")}'`);
    const dbSize=fs.statSync(dbPath).size;
    if(dbSize>MAX_FILE) throw Error('Database is larger than the 100 MB portable backup limit.');
    const sessions=enumerate(cfg.config.paths.sessions,'sessions');
    const media=enumerate(path.join(path.dirname(cfg.config.paths.database),'media-hold'),'media-hold');
    const inboxMedia=enumerate(cfg.config.paths.media,'media');
    const sourceFiles=[...sessions.files,...media.files,...inboxMedia.files];
    if(sourceFiles.length>MAX_FILES || dbSize+sessions.total+media.total+inboxMedia.total>MAX_TOTAL) throw Error('Backup exceeds safe size or file limits.');
    const staging=path.join(dir,'files');fs.mkdirSync(staging,{mode:0o700});
    const files=[];for(let i=0;i<sourceFiles.length;i++) files.push(await stageFile(sourceFiles[i],staging,i));
    const manifest={app:'raqifluz-channel-bot',kind:'complete-backup',format:1,madeAt:new Date().toISOString(),databaseBytes:dbSize,sessionFiles:sessions.files.length,heldMediaFiles:media.files.length,mediaFiles:inboxMedia.files.length,
      warning:'Contains private keys and linked-device sessions. Database, session files and media are not captured as one transaction. Store securely and test restoration.'};
    const {ZipArchive}=await import('archiver');
    await new Promise((resolve,reject)=>{
      const output=fs.createWriteStream(zipPath,{mode:0o600,flags:'wx'}),archive=new ZipArchive({zlib:{level:6}});
      const fail=e=>{archive.abort();output.destroy();reject(e)};
      output.on('close',resolve);output.on('error',fail);archive.on('error',fail);archive.on('warning',fail);
      archive.pipe(output);
      archive.file(dbPath,{name:'bot.sqlite'});
      archive.append(JSON.stringify(manifest,null,2),{name:'manifest.json'});
      for(const f of files) archive.file(f.disk,{name:f.name});
      archive.finalize().catch(fail);
    });
    return {dir,zipPath,manifest};
  } catch(e) { fs.rmSync(dir,{recursive:true,force:true});throw e; }
}
module.exports={create,enumerate,_stageFile:stageFile};
