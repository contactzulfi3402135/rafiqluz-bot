#!/usr/bin/env node
'use strict';
// Offline inspection/extraction only: never modifies a running installation.
const fs=require('node:fs'),path=require('node:path');
const {extract}=require('../src/safe-archive');
const Database=require('better-sqlite3');
const cfg=require('../src/config').config;
function under(child,parent){const rel=path.relative(parent,child);return rel==='' || (rel!=='..' && !rel.startsWith('..'+path.sep) && !path.isAbsolute(rel));}
// Resolve symlinks in the existing prefix even when the configured leaf has
// not been created yet. A purely lexical path.resolve on a missing directory
// could miss an alias into a protected state root.
function canonicalFuture(p){
  if(typeof p!=='string'||!p.trim()) throw Error('Invalid configured state directory; refusing extraction.');
  let prefix=path.resolve(p);const missing=[];
  for(;;){
    try { return path.join(fs.realpathSync(prefix),...missing.reverse()); }
    catch(e){
      if(e.code!=='ENOENT') throw e;
      // A dangling symlink must not be mistaken for an absent path.
      try { if(fs.lstatSync(prefix).isSymbolicLink()) throw Error('Dangling state-directory symlink; refusing extraction.'); }
      catch(statErr) { if(statErr.code!=='ENOENT') throw statErr; }
      const parent=path.dirname(prefix);
      if(parent===prefix) throw e;
      missing.push(path.basename(prefix));prefix=parent;
    }
  }
}
async function extractBackup(input,output) {
  const zip=fs.realpathSync(input);
  const target=path.resolve(output), parent=fs.realpathSync(path.dirname(target));
  const final=path.join(parent,path.basename(target));
  if(typeof cfg.paths.database!=='string'||!cfg.paths.database.trim()) throw Error('Invalid configured database path; refusing extraction.');
  const roots=[cfg.root,cfg.paths.sessions,path.dirname(cfg.paths.database),cfg.paths.media,cfg.paths.backups,cfg.paths.logs].map(canonicalFuture);
  if(roots.some(root=>under(final,root)||under(root,final))) throw Error('Choose a new directory outside the application and all configured state directories.');
  if(fs.existsSync(final)) throw Error('Destination already exists; nothing was overwritten. Choose a new directory.');
  const stage=fs.mkdtempSync(path.join(parent,'.raq-restore-'));
  try {
    await extract(zip,stage);
    const rootsFound=fs.readdirSync(stage);
    if(rootsFound.some(x=>!['bot.sqlite','manifest.json','sessions','media-hold','media'].includes(x))) throw Error('Backup contains an unexpected top-level entry.');
    const mf=path.join(stage,'manifest.json'),dbfile=path.join(stage,'bot.sqlite');
    if(!fs.existsSync(mf)||!fs.existsSync(dbfile)) throw Error('Backup lacks its manifest or database.');
    if(fs.statSync(mf).size>65536) throw Error('Backup manifest is too large.');
    const manifest=JSON.parse(fs.readFileSync(mf,'utf8'));
    if(manifest.app!=='raqifluz-channel-bot'||manifest.kind!=='complete-backup'||manifest.format!==1)throw Error('Not a supported complete Raqifluz backup.');
    if(fs.statSync(dbfile).size!==manifest.databaseBytes)throw Error('Database size does not match the manifest.');
    const d=new Database(dbfile,{readonly:true,fileMustExist:true});
    try {
      d.pragma('query_only = ON');d.pragma('trusted_schema = OFF');
      if(d.prepare('PRAGMA integrity_check').get().integrity_check!=='ok') throw Error('Database integrity check failed.');
      const names=new Set(d.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r=>r.name));
      if(!names.has('settings') || !names.has('posts'))throw Error('Backup database is not a Raqifluz database.');
    } finally { d.close(); }
    const filesIn=dir=>fs.existsSync(dir)?fs.readdirSync(dir,{withFileTypes:true}).reduce((n,e)=>n+(e.isDirectory()?filesIn(path.join(dir,e.name)):1),0):0;
    if(filesIn(path.join(stage,'sessions'))!==manifest.sessionFiles || filesIn(path.join(stage,'media-hold'))!==manifest.heldMediaFiles || filesIn(path.join(stage,'media'))!==manifest.mediaFiles) throw Error('Backup file counts do not match its manifest.');
    // mkdir is an atomic no-overwrite reservation; never rename over an existing directory.
    fs.mkdirSync(final,{mode:0o700});
    try { for(const name of fs.readdirSync(stage)) fs.cpSync(path.join(stage,name),path.join(final,name),{recursive:true,force:false,errorOnExist:true}); }
    catch(e) { throw Error('Could not finish extraction; inspect the new destination before retrying: '+e.message); }
    fs.rmSync(stage,{recursive:true,force:true});
    return {destination:final,manifest};
  } catch(e) { fs.rmSync(stage,{recursive:true,force:true});throw e; }
}
if(require.main===module){
  const [input,output]=process.argv.slice(2);
  if(!input||!output){console.error('Usage: node scripts/restore-full-backup.js BACKUP.zip /path/to/new-offline-directory');process.exitCode=2;}
  else extractBackup(input,output).then(r=>{
    console.log('Validated and extracted to '+r.destination+'. No running installation was changed.');
    console.log('This folder contains credentials. Stop the bot and follow the recovery guide before replacing anything.');
  }).catch(e=>{console.error('Restore inspection failed: '+e.message);process.exitCode=1;});
}
module.exports={extractBackup};
