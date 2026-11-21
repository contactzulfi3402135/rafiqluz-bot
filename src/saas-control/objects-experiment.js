'use strict';
// Experimental PostgreSQL-backed objects, not the existing app's media storage.
const crypto=require('node:crypto');
const SQL=`CREATE TABLE raq_tenant.objects (
 workspace_id uuid NOT NULL REFERENCES raq_control.workspaces(id), id uuid NOT NULL,
 name text NOT NULL, bytes integer NOT NULL CHECK(bytes BETWEEN 0 AND 1048576),
 sha256 text NOT NULL CHECK(sha256 ~ '^[a-f0-9]{64}$'), data bytea NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(workspace_id,id), CHECK(octet_length(data)=bytes)
);
CREATE INDEX objects_created_idx ON raq_tenant.objects(workspace_id,created_at,id);
ALTER TABLE raq_tenant.objects ENABLE ROW LEVEL SECURITY;
ALTER TABLE raq_tenant.objects FORCE ROW LEVEL SECURITY;
CREATE POLICY objects_read ON raq_tenant.objects FOR SELECT USING(workspace_id=raq_control.active_workspace());
CREATE POLICY objects_insert ON raq_tenant.objects FOR INSERT WITH CHECK(workspace_id=raq_control.active_workspace() AND raq_control.can_write());
CREATE POLICY objects_update ON raq_tenant.objects FOR UPDATE USING(workspace_id=raq_control.active_workspace() AND raq_control.can_write()) WITH CHECK(workspace_id=raq_control.active_workspace() AND raq_control.can_write());
CREATE POLICY objects_delete ON raq_tenant.objects FOR DELETE USING(workspace_id=raq_control.active_workspace() AND raq_control.can_write());`;
const checksum=crypto.createHash('sha256').update(SQL).digest('hex');
async function install(pool){const c=await pool.connect();try{await c.query('BEGIN');await c.query("SELECT pg_advisory_xact_lock(hashtext('raq-object-experiment-install'))");const r=await c.query("SELECT to_regclass('raq_tenant.objects') existing");if(r.rows[0].existing)throw Error('Object table already exists; refusing to modify it');await c.query(SQL);await c.query('COMMIT');return {checksum}}catch(e){try{await c.query('ROLLBACK')}catch{}throw e}finally{c.release()}}
async function safety(c){const r=await c.query(`SELECT t.relrowsecurity,t.relforcerowsecurity,pg_has_role(current_user,t.relowner,'MEMBER') owner,
 has_table_privilege(current_user,t.oid,'TRUNCATE,REFERENCES,TRIGGER') bypass,(SELECT count(*)::int FROM pg_policy p WHERE p.polrelid=t.oid) policies
 FROM pg_class t JOIN pg_namespace n ON n.oid=t.relnamespace WHERE n.nspname='raq_tenant' AND t.relname='objects' AND t.relkind='r'`);const x=r.rows[0];if(!x||!x.relrowsecurity||!x.relforcerowsecurity||x.owner||x.bypass||x.policies!==4)throw Error('Unsafe object table security');}
function nameValue(name){if(typeof name!=='string'||!name.trim()||Buffer.byteLength(name)>240||/[\x00-\x1f\x7f\\/]/.test(name))throw Error('Invalid object name');return name.trim();}
function objects(control){return {
 async put(token,workspaceId,name,data){
  const safeName=nameValue(name);if(!Buffer.isBuffer(data)||data.length>1048576)throw Error('Invalid object content');const bytes=data.length,digest=crypto.createHash('sha256').update(data).digest('hex'),id=crypto.randomUUID();
  return control.withWorkspace(token,workspaceId,'write',async c=>{
   await safety(c);await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',['raq-object-quota:'+workspaceId]);
   const r=await c.query('SELECT count(*)::int AS n,coalesce(sum(bytes),0)::bigint AS bytes FROM raq_tenant.objects WHERE workspace_id=$1',[workspaceId]);
   if(r.rows[0].n>=5000||BigInt(r.rows[0].bytes)+BigInt(bytes)>100n*1024n*1024n)throw Error('Workspace object quota reached');
   const result=await c.query('INSERT INTO raq_tenant.objects(workspace_id,id,name,bytes,sha256,data) VALUES($1,$2,$3,$4,$5,$6) RETURNING id,name,bytes,sha256,created_at',[workspaceId,id,safeName,bytes,digest,data]);return result.rows[0];
  });
 },
 async list(token,workspaceId,offset=0){if(!Number.isInteger(offset)||offset<0||offset>5000)throw Error('Invalid offset');return control.withWorkspace(token,workspaceId,'read',async c=>{await safety(c);const r=await c.query('SELECT id,name,bytes,sha256,created_at FROM raq_tenant.objects WHERE workspace_id=$1 ORDER BY created_at,id LIMIT 100 OFFSET $2',[workspaceId,offset]);return r.rows;});},
 async get(token,workspaceId,id){return control.withWorkspace(token,workspaceId,'read',async c=>{await safety(c);const r=await c.query('SELECT name,bytes,sha256,data FROM raq_tenant.objects WHERE workspace_id=$1 AND id=$2',[workspaceId,id]);if(!r.rowCount)return null;const x=r.rows[0];if(!Buffer.isBuffer(x.data)||x.bytes!==x.data.length||crypto.createHash('sha256').update(x.data).digest('hex')!==x.sha256)throw Error('Object integrity check failed');return x;});},
 async delete(token,workspaceId,id){return control.withWorkspace(token,workspaceId,'write',async c=>{await safety(c);const r=await c.query('DELETE FROM raq_tenant.objects WHERE workspace_id=$1 AND id=$2 RETURNING id',[workspaceId,id]);return !!r.rowCount;});}
};}
module.exports={install,objects,checksum};
