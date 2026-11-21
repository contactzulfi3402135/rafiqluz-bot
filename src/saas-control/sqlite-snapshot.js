'use strict';
// Experimental tenant-scoped archival transfer of an SQLite image into PG.
// Not a relational PostgreSQL migration and not used by the bot.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),Database=require('better-sqlite3');
const CHUNK=1024*1024,MAX=4*1024*1024*1024;
const SQL=`
CREATE TABLE raq_tenant.sqlite_snapshots(
 workspace_id uuid NOT NULL REFERENCES raq_control.workspaces(id),id uuid NOT NULL,
 byte_length bigint NOT NULL CHECK(byte_length>0),chunk_count integer NOT NULL CHECK(chunk_count>0),
 sha256 text NOT NULL CHECK(sha256 ~ '^[a-f0-9]{64}$'), created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(workspace_id,id)
);
CREATE TABLE raq_tenant.sqlite_snapshot_chunks(
 workspace_id uuid NOT NULL,snapshot_id uuid NOT NULL,part integer NOT NULL CHECK(part>=0),data bytea NOT NULL,
 PRIMARY KEY(workspace_id,snapshot_id,part),
 FOREIGN KEY(workspace_id,snapshot_id) REFERENCES raq_tenant.sqlite_snapshots(workspace_id,id) ON DELETE CASCADE
);
ALTER TABLE raq_tenant.sqlite_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE raq_tenant.sqlite_snapshots FORCE ROW LEVEL SECURITY;
ALTER TABLE raq_tenant.sqlite_snapshot_chunks ENABLE ROW LEVEL SECURITY;
ALTER TABLE raq_tenant.sqlite_snapshot_chunks FORCE ROW LEVEL SECURITY;
CREATE POLICY snapshot_read ON raq_tenant.sqlite_snapshots FOR SELECT USING(workspace_id=raq_control.active_workspace());
CREATE POLICY snapshot_insert ON raq_tenant.sqlite_snapshots FOR INSERT WITH CHECK(workspace_id=raq_control.active_workspace() AND raq_control.can_write());
CREATE POLICY snapshot_update ON raq_tenant.sqlite_snapshots FOR UPDATE USING(workspace_id=raq_control.active_workspace() AND raq_control.can_write()) WITH CHECK(workspace_id=raq_control.active_workspace() AND raq_control.can_write());
CREATE POLICY snapshot_delete ON raq_tenant.sqlite_snapshots FOR DELETE USING(workspace_id=raq_control.active_workspace() AND raq_control.can_write());
CREATE POLICY chunk_read ON raq_tenant.sqlite_snapshot_chunks FOR SELECT USING(workspace_id=raq_control.active_workspace());
CREATE POLICY chunk_insert ON raq_tenant.sqlite_snapshot_chunks FOR INSERT WITH CHECK(workspace_id=raq_control.active_workspace() AND raq_control.can_write());
CREATE POLICY chunk_update ON raq_tenant.sqlite_snapshot_chunks FOR UPDATE USING(workspace_id=raq_control.active_workspace() AND raq_control.can_write()) WITH CHECK(workspace_id=raq_control.active_workspace() AND raq_control.can_write());
CREATE POLICY chunk_delete ON raq_tenant.sqlite_snapshot_chunks FOR DELETE USING(workspace_id=raq_control.active_workspace() AND raq_control.can_write());
`;
const CHECKSUM=crypto.createHash('sha256').update(SQL).digest('hex');
// Must be executed by migration owner, before granting tenant runtime access.
// Refuses existing tables, policies, or marker rather than adopting unknown data.
async function install(pool){const c=await pool.connect();try{await c.query('BEGIN');await c.query("SELECT pg_advisory_xact_lock(hashtext('raq-sqlite-snapshot-install'))");
 const existing=await c.query("SELECT to_regclass('raq_tenant.sqlite_snapshots') a,to_regclass('raq_tenant.sqlite_snapshot_chunks') b");
 if(existing.rows[0].a||existing.rows[0].b)throw Error('Snapshot objects already exist; refusing to modify them');
 await c.query(SQL);await c.query('COMMIT');return{checksum:CHECKSUM};
 }catch(e){try{await c.query('ROLLBACK')}catch{}throw e}finally{c.release()}}
function privateDirectory(dir){
 if(!path.isAbsolute(dir))throw Error('Scratch directory must be absolute');const stat=fs.lstatSync(dir);
 if(!stat.isDirectory()||stat.isSymbolicLink()||stat.uid!==process.getuid()||(stat.mode&0o077))throw Error('Scratch directory must be private and owned by the current user');
}
function sourceFile(file){if(!path.isAbsolute(file))throw Error('Source path must be absolute');const stat=fs.lstatSync(file);if(!stat.isFile()||stat.isSymbolicLink())throw Error('Source must be a regular file, not a symlink');}
async function security(c){
 const r=await c.query(`SELECT t.relname,t.relrowsecurity,t.relforcerowsecurity,pg_has_role(current_user,t.relowner,'MEMBER') AS owner,
   has_table_privilege(current_user,t.oid,'TRUNCATE,REFERENCES,TRIGGER') AS bypass,
   (SELECT count(*)::int FROM pg_policy p WHERE p.polrelid=t.oid) AS policies
   FROM pg_class t JOIN pg_namespace n ON n.oid=t.relnamespace WHERE n.nspname='raq_tenant' AND t.relname IN ('sqlite_snapshots','sqlite_snapshot_chunks') AND t.relkind='r'`);
 if(r.rowCount!==2||r.rows.some(x=>!x.relrowsecurity||!x.relforcerowsecurity||x.owner||x.bypass||x.policies!==4))throw Error('Unsafe snapshot table security');
}
function validateSnapshotFile(file){let db;try{db=new Database(file,{readonly:true,fileMustExist:true});const result=db.pragma('quick_check',{simple:true});if(result!=='ok')throw Error('SQLite quick_check failed');}finally{if(db)db.close()}}
function digestFile(file){const fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);let size=0,h=crypto.createHash('sha256');try{const b=Buffer.allocUnsafe(CHUNK);for(;;){const n=fs.readSync(fd,b,0,b.length,null);if(!n)break;size+=n;if(size>MAX)throw Error('Snapshot exceeds size limit');h.update(b.subarray(0,n));}return {size,sha256:h.digest('hex')};}finally{fs.closeSync(fd)}}
function snapshots(control){return {
 // Requires workspace owner/admin/editor. A consistent SQLite backup is made
 // first; the live source and its journals are never intentionally overwritten.
 async importSQLite(token,workspaceId,source,scratch){
  await control.withWorkspace(token,workspaceId,'write',async c=>security(c));
  sourceFile(source);privateDirectory(scratch);const dir=fs.mkdtempSync(path.join(scratch,'raq-sqlite-'));fs.chmodSync(dir,0o700);const file=path.join(dir,'snapshot.sqlite');let db,primaryError,committed;
  try{
   const pre=fs.openSync(file,fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_WRONLY,0o600);fs.closeSync(pre);
   db=new Database(source,{readonly:true,fileMustExist:true});const pageSize=db.pragma('page_size',{simple:true}),pageCount=db.pragma('page_count',{simple:true});
   if(!Number.isSafeInteger(pageSize)||!Number.isSafeInteger(pageCount)||pageSize<=0||pageCount<=0||pageCount>MAX/pageSize)throw Error('Source exceeds snapshot size limit or has invalid pages');
   await db.backup(file,{progress:info=>{if(!Number.isSafeInteger(info.totalPages)||info.totalPages>MAX/pageSize)throw Error('Source exceeds snapshot size limit');}});db.close();db=null;
   validateSnapshotFile(file);const meta=digestFile(file);if(meta.size===0)throw Error('Empty snapshot');const count=Math.ceil(meta.size/CHUNK),snapshotId=crypto.randomUUID();
   committed=await control.withWorkspace(token,workspaceId,'write',async c=>{
    await security(c);await c.query('INSERT INTO raq_tenant.sqlite_snapshots(workspace_id,id,byte_length,chunk_count,sha256) VALUES($1,$2,$3,$4,$5)',[workspaceId,snapshotId,meta.size,count,meta.sha256]);
    const fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW),hash=crypto.createHash('sha256');let actual=0,parts=0;
    try{const b=Buffer.allocUnsafe(CHUNK);for(;;){const n=fs.readSync(fd,b,0,b.length,null);if(!n)break;const piece=b.subarray(0,n);actual+=n;hash.update(piece);await c.query('INSERT INTO raq_tenant.sqlite_snapshot_chunks(workspace_id,snapshot_id,part,data) VALUES($1,$2,$3,$4)',[workspaceId,snapshotId,parts++,piece]);}}
    finally{fs.closeSync(fd)}
    if(actual!==meta.size||parts!==count||hash.digest('hex')!==meta.sha256)throw Error('Snapshot changed during transfer');return {id:snapshotId,byteLength:meta.size,sha256:meta.sha256,chunkCount:count};
   });
   return committed;
  }catch(e){primaryError=e;throw e}
  finally{
   try{
    if(db)db.close();
    // Opening a WAL-mode image may create SQLite -wal/-shm sidecars. This
    // directory was exclusively created under the private scratch root; remove
    // the entire directory rather than only the main snapshot file.
    fs.rmSync(dir,{recursive:true,force:true});
   }catch(cleanupError){
    // Preserve the original failure. If upload committed, expose its ID so
    // operators can reconcile instead of accidentally importing it twice.
    if(primaryError)primaryError.cleanupError=cleanupError;
    else{const err=Error('SQLite snapshot cleanup failed; inspect the private scratch directory');err.cause=cleanupError;if(committed)err.committedSnapshot=committed;throw err;}
   }
  }
 },
 async list(token,workspaceId){return control.withWorkspace(token,workspaceId,'read',async c=>{await security(c);const r=await c.query('SELECT id,byte_length,chunk_count,sha256,created_at FROM raq_tenant.sqlite_snapshots WHERE workspace_id=$1 ORDER BY created_at DESC',[workspaceId]);return r.rows;});},
 // Restore to a new filename only; never overwrite existing state. A private
 // file beside the target may remain after an abrupt process/machine crash.
 async restoreSQLite(token,workspaceId,snapshotId,destination){
  if(!path.isAbsolute(destination)||!path.basename(destination)||['.','..'].includes(path.basename(destination)))throw Error('Destination must be an absolute filename');
  const dir=path.dirname(destination),st=fs.lstatSync(dir);if(!st.isDirectory()||st.isSymbolicLink())throw Error('Destination directory must be a real directory');
  const tmp=path.join(dir,'.raq-restore-'+crypto.randomUUID()+'.tmp');let fd;
  try{
   fd=fs.openSync(tmp,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600);
   const meta=await control.withWorkspace(token,workspaceId,'read',async c=>{
    await security(c);const found=await c.query('SELECT byte_length,chunk_count,sha256 FROM raq_tenant.sqlite_snapshots WHERE workspace_id=$1 AND id=$2',[workspaceId,snapshotId]);if(!found.rowCount)throw Error('Snapshot unavailable');
    const x=found.rows[0],expected=Number(x.byte_length);if(!Number.isSafeInteger(expected)||expected<=0||expected>MAX||x.chunk_count!==Math.ceil(expected/CHUNK))throw Error('Invalid snapshot metadata');
    const hash=crypto.createHash('sha256');let size=0;
    for(let part=0;part<x.chunk_count;part++){
     const r=await c.query('SELECT data FROM raq_tenant.sqlite_snapshot_chunks WHERE workspace_id=$1 AND snapshot_id=$2 AND part=$3',[workspaceId,snapshotId,part]);
     const data=r.rows[0]?.data;if(!Buffer.isBuffer(data)||data.length!==Math.min(CHUNK,expected-size))throw Error('Missing or invalid snapshot chunk');
     let offset=0;while(offset<data.length){const written=fs.writeSync(fd,data,offset,data.length-offset);if(written<=0)throw Error('Short restore write');offset+=written;}hash.update(data);size+=data.length;
    }
    if(size!==expected||hash.digest('hex')!==x.sha256)throw Error('Snapshot digest mismatch');return {byteLength:size,sha256:x.sha256};
   });
   fs.fsyncSync(fd);fs.closeSync(fd);fd=null;validateSnapshotFile(tmp);
   fs.linkSync(tmp,destination);fs.unlinkSync(tmp);
   const d=fs.openSync(dir,fs.constants.O_RDONLY);try{fs.fsyncSync(d)}finally{fs.closeSync(d)}
   return meta;
  }finally{if(fd!==undefined&&fd!==null)fs.closeSync(fd);try{fs.unlinkSync(tmp)}catch(e){if(e.code!=='ENOENT')throw e}}
 }
};}
module.exports={install,snapshots,CHECKSUM};
