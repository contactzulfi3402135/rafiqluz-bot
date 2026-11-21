'use strict';
// Research-only durable queue. Not connected to the existing bot or safe to
// expose to tenants. Uses a separate trusted service role; see documentation.
const crypto=require('node:crypto');
const MIGRATION=`
CREATE SCHEMA raq_worker_experiment;
CREATE TABLE raq_worker_experiment.workspaces (
 workspace_id uuid PRIMARY KEY, last_claim bigint NOT NULL DEFAULT 0
);
CREATE SEQUENCE raq_worker_experiment.claim_order;
CREATE SEQUENCE raq_worker_experiment.leadership_fence;
CREATE TABLE raq_worker_experiment.leadership (
 name text PRIMARY KEY, holder text NOT NULL, token uuid NOT NULL,
 fence bigint NOT NULL, expires_at timestamptz NOT NULL
);
CREATE TABLE raq_worker_experiment.jobs (
 id uuid PRIMARY KEY, workspace_id uuid NOT NULL REFERENCES raq_worker_experiment.workspaces(workspace_id),
 kind text NOT NULL, idempotency_key text NOT NULL, payload jsonb NOT NULL, payload_hash text NOT NULL,
 state text NOT NULL CHECK (state IN ('queued','leased','dispatching','succeeded','failed','uncertain')),
 available_at timestamptz NOT NULL DEFAULT clock_timestamp(), lease_owner text, lease_token uuid,
 lease_until timestamptz, fence bigint NOT NULL DEFAULT 0, attempts integer NOT NULL DEFAULT 0,
 result jsonb, failure text, created_at timestamptz NOT NULL DEFAULT clock_timestamp(), updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(workspace_id,kind,idempotency_key),
 CHECK ((state IN ('leased','dispatching')) = (lease_owner IS NOT NULL AND lease_token IS NOT NULL AND lease_until IS NOT NULL))
);
CREATE INDEX worker_ready_idx ON raq_worker_experiment.jobs(state,available_at,workspace_id,created_at,id);
CREATE INDEX worker_expiry_idx ON raq_worker_experiment.jobs(lease_until) WHERE state IN ('leased','dispatching');
CREATE INDEX worker_active_workspace_idx ON raq_worker_experiment.jobs(workspace_id) WHERE state IN ('leased','dispatching');
`;
const CHECKSUM=crypto.createHash('sha256').update(MIGRATION).digest('hex');
function bounded(x,name,max){if(typeof x!=='string'||!x.length||x.length>max||/[\x00-\x1f\x7f]/.test(x))throw Error('Invalid '+name);return x;}
function asJson(value,max=65536){let s;try{s=JSON.stringify(value)}catch{throw Error('Invalid JSON')};if(s===undefined||Buffer.byteLength(s)>max)throw Error('Invalid JSON');return s;}
function leaseSeconds(n){if(!Number.isInteger(n)||n<5||n>300)throw Error('Invalid lease duration');return n;}
async function transaction(pool,fn){const c=await pool.connect();try{await c.query('BEGIN');const result=await fn(c);await c.query('COMMIT');return result}catch(e){try{await c.query('ROLLBACK')}catch{}throw e}finally{c.release()}}
// Dedicated empty schema only. Never creates, drops or alters existing schemas.
async function install(pool){return transaction(pool,async c=>{
 await c.query("SELECT pg_advisory_xact_lock(hashtext('raq-worker-experiment-install'))");
 const exists=await c.query("SELECT 1 FROM pg_namespace WHERE nspname='raq_worker_experiment'");
 if(exists.rowCount)throw Error('Worker experiment schema already exists; refusing to modify it');
 await c.query(MIGRATION);return {checksum:CHECKSUM};
});}
function worker(pool){
 return {
  async acquireLeadership(name,holder,seconds=30){
   bounded(name,'leadership name',120);bounded(holder,'holder',120);leaseSeconds(seconds);
   const token=crypto.randomUUID();
   const r=await pool.query(`INSERT INTO raq_worker_experiment.leadership(name,holder,token,fence,expires_at)
     VALUES($1,$2,$3,nextval('raq_worker_experiment.leadership_fence'),clock_timestamp()+($4*interval '1 second'))
     ON CONFLICT(name) DO UPDATE SET holder=EXCLUDED.holder,token=EXCLUDED.token,fence=EXCLUDED.fence,expires_at=EXCLUDED.expires_at
     WHERE raq_worker_experiment.leadership.expires_at<=clock_timestamp() RETURNING *`,[name,holder,token,seconds]);return r.rows[0]||null;
  },
  async renewLeadership(name,token,fence,seconds=30){leaseSeconds(seconds);const r=await pool.query(`UPDATE raq_worker_experiment.leadership SET expires_at=clock_timestamp()+($4*interval '1 second') WHERE name=$1 AND token=$2 AND fence=$3 AND expires_at>clock_timestamp() RETURNING *`,[name,token,fence,seconds]);return r.rows[0]||null;},
  async releaseLeadership(name,token,fence){const r=await pool.query('DELETE FROM raq_worker_experiment.leadership WHERE name=$1 AND token=$2 AND fence=$3 RETURNING name',[name,token,fence]);return !!r.rowCount;},
  // Trusted caller must authenticate/authorize workspace and validate data before enqueueing.
  async enqueue({workspaceId,kind,key,payload,availableAt=new Date()}){
   bounded(kind,'kind',80);bounded(key,'idempotency key',200);
   const serialized=asJson(payload),digest=crypto.createHash('sha256').update(serialized).digest('hex');
   const when=new Date(availableAt);if(!Number.isFinite(when.getTime()))throw Error('Invalid available time');
   return transaction(pool,async c=>{
    await c.query('INSERT INTO raq_worker_experiment.workspaces(workspace_id) VALUES($1) ON CONFLICT DO NOTHING',[workspaceId]);
    // The workspace row serializes deduplication and a conservative retained-job
    // cap; completed jobs are not deleted automatically because they are audit data.
    await c.query('SELECT workspace_id FROM raq_worker_experiment.workspaces WHERE workspace_id=$1 FOR UPDATE',[workspaceId]);
    const existing=await c.query('SELECT * FROM raq_worker_experiment.jobs WHERE workspace_id=$1 AND kind=$2 AND idempotency_key=$3',[workspaceId,kind,key]);
    if(existing.rowCount){if(existing.rows[0].payload_hash!==digest)throw Error('Idempotency key reused with different payload');return {created:false,job:existing.rows[0]};}
    const count=await c.query('SELECT count(*)::int n FROM raq_worker_experiment.jobs WHERE workspace_id=$1',[workspaceId]);
    if(count.rows[0].n>=10000)throw Error('Workspace retained job limit reached');
    const r=await c.query(`INSERT INTO raq_worker_experiment.jobs(id,workspace_id,kind,idempotency_key,payload,payload_hash,state,available_at)
      VALUES($1,$2,$3,$4,$5,$6,'queued',$7) RETURNING *`,[crypto.randomUUID(),workspaceId,kind,key,serialized,digest,when]);return {created:true,job:r.rows[0]};
   });
  },
  // Serializing just the selection preserves round-robin ordering across workers.
  // One active job per workspace prevents a single tenant monopolizing capacity.
  async claim(owner,seconds=30){
   bounded(owner,'worker id',120);leaseSeconds(seconds);
   return transaction(pool,async c=>{
    await c.query("SELECT pg_advisory_xact_lock(hashtext('raq-worker-experiment-claim'))");
    await c.query(`UPDATE raq_worker_experiment.jobs SET state=CASE WHEN state='dispatching' THEN 'uncertain' ELSE 'queued' END,
      lease_owner=NULL,lease_token=NULL,lease_until=NULL,updated_at=clock_timestamp(),failure=CASE WHEN state='dispatching' THEN 'Lease expired after external dispatch began' ELSE failure END
      WHERE state IN ('leased','dispatching') AND lease_until<=clock_timestamp()`);
    const r=await c.query(`SELECT j.id,j.workspace_id FROM raq_worker_experiment.jobs j JOIN raq_worker_experiment.workspaces w ON w.workspace_id=j.workspace_id
      WHERE j.state='queued' AND j.available_at<=clock_timestamp() AND NOT EXISTS (SELECT 1 FROM raq_worker_experiment.jobs x WHERE x.workspace_id=j.workspace_id AND x.state IN ('leased','dispatching'))
      ORDER BY w.last_claim,j.created_at,j.id LIMIT 1 FOR UPDATE OF j SKIP LOCKED`);
    if(!r.rowCount)return null;const token=crypto.randomUUID(),selected=r.rows[0];
    await c.query("UPDATE raq_worker_experiment.workspaces SET last_claim=nextval('raq_worker_experiment.claim_order') WHERE workspace_id=$1",[selected.workspace_id]);
    const out=await c.query(`UPDATE raq_worker_experiment.jobs SET state='leased',lease_owner=$2,lease_token=$3,lease_until=clock_timestamp()+($4*interval '1 second'),fence=fence+1,attempts=attempts+1,updated_at=clock_timestamp() WHERE id=$1 RETURNING *`,[selected.id,owner,token,seconds]);return out.rows[0];
   });
  },
  async heartbeat(id,token,fence,seconds=30){leaseSeconds(seconds);const r=await pool.query(`UPDATE raq_worker_experiment.jobs SET lease_until=clock_timestamp()+($4*interval '1 second'),updated_at=clock_timestamp() WHERE id=$1 AND lease_token=$2 AND fence=$3 AND state IN ('leased','dispatching') AND lease_until>clock_timestamp() RETURNING lease_until`,[id,token,fence,seconds]);return r.rows[0]||null;},
  // Commit this BEFORE starting any non-idempotent provider request. A crash or
  // expired lease after this point is uncertain; it is never automatically retried.
  async beginDispatch(id,token,fence){const r=await pool.query(`UPDATE raq_worker_experiment.jobs SET state='dispatching',updated_at=clock_timestamp() WHERE id=$1 AND lease_token=$2 AND fence=$3 AND state='leased' AND lease_until>clock_timestamp() RETURNING *`,[id,token,fence]);return r.rows[0]||null;},
  async complete(id,token,fence,result){const data=asJson(result);const r=await pool.query(`UPDATE raq_worker_experiment.jobs SET state='succeeded',result=$4,lease_owner=NULL,lease_token=NULL,lease_until=NULL,updated_at=clock_timestamp() WHERE id=$1 AND lease_token=$2 AND fence=$3 AND state='dispatching' AND lease_until>clock_timestamp() RETURNING *`,[id,token,fence,data]);return r.rows[0]||null;},
  // The caller may use 'failed' only for a known definitive rejection. Unknown
  // or timeout outcomes must be marked uncertain and reviewed/reconciled.
  async finish(id,token,fence,outcome,reason){if(!['failed','uncertain'].includes(outcome))throw Error('Invalid outcome');bounded(reason,'reason',1000);const r=await pool.query(`UPDATE raq_worker_experiment.jobs SET state=$4,failure=$5,lease_owner=NULL,lease_token=NULL,lease_until=NULL,updated_at=clock_timestamp() WHERE id=$1 AND lease_token=$2 AND fence=$3 AND state='dispatching' AND lease_until>clock_timestamp() RETURNING *`,[id,token,fence,outcome,reason]);return r.rows[0]||null;},
  // A known configuration/validation error can fail before dispatch.
  async failLeased(id,token,fence,reason){bounded(reason,'reason',1000);const r=await pool.query(`UPDATE raq_worker_experiment.jobs SET state='failed',failure=$4,lease_owner=NULL,lease_token=NULL,lease_until=NULL,updated_at=clock_timestamp() WHERE id=$1 AND lease_token=$2 AND fence=$3 AND state='leased' AND lease_until>clock_timestamp() RETURNING *`,[id,token,fence,reason]);return r.rows[0]||null;},
  // Before external dispatch, release can be retried safely. Backoff is bounded.
  async release(id,token,fence,delaySeconds=0){if(!Number.isInteger(delaySeconds)||delaySeconds<0||delaySeconds>86400)throw Error('Invalid retry delay');const r=await pool.query(`UPDATE raq_worker_experiment.jobs SET state='queued',available_at=clock_timestamp()+($4*interval '1 second'),lease_owner=NULL,lease_token=NULL,lease_until=NULL,updated_at=clock_timestamp() WHERE id=$1 AND lease_token=$2 AND fence=$3 AND state='leased' AND lease_until>clock_timestamp() RETURNING *`,[id,token,fence,delaySeconds]);return r.rows[0]||null;},
  // This operation records a human/provider reconciliation decision. It never
  // silently requeues uncertain dispatches; explicit follow-up is a new job.
  async reconcile(id,workspaceId,outcome,note){if(!['succeeded','failed'].includes(outcome))throw Error('Invalid outcome');bounded(note,'note',1000);const r=await pool.query(`UPDATE raq_worker_experiment.jobs SET state=$3,failure=$4,updated_at=clock_timestamp() WHERE id=$1 AND workspace_id=$2 AND state='uncertain' RETURNING *`,[id,workspaceId,outcome,note]);return r.rows[0]||null;}
 };
}
module.exports={install,worker,CHECKSUM};
