'use strict';
// Research-only: performs authorization and job mutations in the SAME
// PostgreSQL transaction. It does not connect the existing SQLite bot to SaaS.
const crypto=require('node:crypto');
const SQL=`
CREATE TABLE raq_worker_experiment.tenant_reconciliation_audit (
 id uuid PRIMARY KEY, workspace_id uuid NOT NULL, job_id uuid NOT NULL,
 actor_user_id uuid NOT NULL, outcome text NOT NULL CHECK(outcome IN ('succeeded','failed')),
 note text NOT NULL CHECK(length(note) BETWEEN 1 AND 1000), created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(job_id) REFERENCES raq_worker_experiment.jobs(id)
);
CREATE INDEX tenant_reconciliation_audit_workspace_idx ON raq_worker_experiment.tenant_reconciliation_audit(workspace_id,created_at,id);

CREATE FUNCTION raq_worker_experiment.tenant_enqueue(p_id uuid,p_workspace uuid,p_kind text,p_key text,p_payload text,p_available timestamptz)
RETURNS TABLE(created boolean,id uuid,kind text,state text,available_at timestamptz,attempts integer,created_at timestamptz,updated_at timestamptz,failure text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE v_context raq_control.transaction_context%ROWTYPE; v_hash text; v_existing raq_worker_experiment.jobs%ROWTYPE; v_count bigint;
BEGIN
 SELECT * INTO v_context FROM raq_control.transaction_context WHERE backend_pid=pg_backend_pid() AND tx=txid_current();
 IF NOT FOUND OR v_context.workspace_id<>p_workspace OR v_context.mode<>'write' OR v_context.role NOT IN ('owner','admin','editor') THEN RAISE EXCEPTION 'Permission denied'; END IF;
 IF p_id IS NULL OR p_kind IS NULL OR length(p_kind) NOT BETWEEN 1 AND 80 OR p_kind ~ '[[:cntrl:]]' OR p_key IS NULL OR length(p_key) NOT BETWEEN 1 AND 200 OR p_key ~ '[[:cntrl:]]' OR p_payload IS NULL OR octet_length(p_payload)>65536 OR p_available IS NULL OR NOT isfinite(p_available) THEN RAISE EXCEPTION 'Invalid job'; END IF;
 v_hash=encode(sha256(convert_to(p_payload,'UTF8')),'hex');
 INSERT INTO raq_worker_experiment.workspaces(workspace_id) VALUES(p_workspace) ON CONFLICT DO NOTHING;
 PERFORM 1 FROM raq_worker_experiment.workspaces WHERE workspace_id=p_workspace FOR UPDATE;
 SELECT * INTO v_existing FROM raq_worker_experiment.jobs j WHERE j.workspace_id=p_workspace AND j.kind=p_kind AND j.idempotency_key=p_key;
 IF FOUND THEN
   IF v_existing.payload_hash<>v_hash THEN RAISE EXCEPTION 'Idempotency key reused with different payload'; END IF;
   RETURN QUERY SELECT false,v_existing.id,v_existing.kind,v_existing.state,v_existing.available_at,v_existing.attempts,v_existing.created_at,v_existing.updated_at,v_existing.failure; RETURN;
 END IF;
 SELECT count(*) INTO v_count FROM raq_worker_experiment.jobs j WHERE j.workspace_id=p_workspace;
 IF v_count>=10000 THEN RAISE EXCEPTION 'Workspace retained job limit reached'; END IF;
 INSERT INTO raq_worker_experiment.jobs(id,workspace_id,kind,idempotency_key,payload,payload_hash,state,available_at)
 VALUES(p_id,p_workspace,p_kind,p_key,p_payload::jsonb,v_hash,'queued',p_available) RETURNING * INTO v_existing;
 RETURN QUERY SELECT true,v_existing.id,v_existing.kind,v_existing.state,v_existing.available_at,v_existing.attempts,v_existing.created_at,v_existing.updated_at,v_existing.failure;
END $$;

CREATE FUNCTION raq_worker_experiment.tenant_jobs(p_workspace uuid,p_limit integer)
RETURNS TABLE(id uuid,kind text,state text,available_at timestamptz,attempts integer,created_at timestamptz,updated_at timestamptz,failure text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE v_context raq_control.transaction_context%ROWTYPE;
BEGIN
 SELECT * INTO v_context FROM raq_control.transaction_context WHERE backend_pid=pg_backend_pid() AND tx=txid_current();
 IF NOT FOUND OR v_context.workspace_id<>p_workspace OR v_context.mode<>'read' THEN RAISE EXCEPTION 'Permission denied'; END IF;
 IF p_limit IS NULL OR p_limit<1 OR p_limit>100 THEN RAISE EXCEPTION 'Invalid job limit'; END IF;
 RETURN QUERY SELECT j.id,j.kind,j.state,j.available_at,j.attempts,j.created_at,j.updated_at,j.failure FROM raq_worker_experiment.jobs j WHERE j.workspace_id=p_workspace ORDER BY j.created_at DESC,j.id DESC LIMIT p_limit;
END $$;

CREATE FUNCTION raq_worker_experiment.tenant_reconcile(p_workspace uuid,p_job uuid,p_audit uuid,p_outcome text,p_note text)
RETURNS TABLE(id uuid,kind text,state text,available_at timestamptz,attempts integer,created_at timestamptz,updated_at timestamptz,failure text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE v_context raq_control.transaction_context%ROWTYPE; v_job raq_worker_experiment.jobs%ROWTYPE;
BEGIN
 SELECT * INTO v_context FROM raq_control.transaction_context WHERE backend_pid=pg_backend_pid() AND tx=txid_current();
 IF NOT FOUND OR v_context.workspace_id<>p_workspace OR v_context.mode<>'owner' OR v_context.role<>'owner' THEN RAISE EXCEPTION 'Permission denied'; END IF;
 IF p_job IS NULL OR p_audit IS NULL OR p_outcome IS NULL OR p_outcome NOT IN ('succeeded','failed') OR p_note IS NULL OR length(p_note) NOT BETWEEN 1 AND 1000 OR p_note ~ '[[:cntrl:]]' THEN RAISE EXCEPTION 'Invalid job'; END IF;
 UPDATE raq_worker_experiment.jobs j SET state=p_outcome,failure=p_note,updated_at=clock_timestamp()
 WHERE j.id=p_job AND j.workspace_id=p_workspace AND j.state='uncertain' RETURNING * INTO v_job;
 IF NOT FOUND THEN RAISE EXCEPTION 'Job unavailable for reconciliation'; END IF;
 INSERT INTO raq_worker_experiment.tenant_reconciliation_audit(id,workspace_id,job_id,actor_user_id,outcome,note)
 VALUES(p_audit,p_workspace,p_job,v_context.user_id,p_outcome,p_note);
 RETURN QUERY SELECT v_job.id,v_job.kind,v_job.state,v_job.available_at,v_job.attempts,v_job.created_at,v_job.updated_at,v_job.failure;
END $$;
REVOKE ALL ON TABLE raq_worker_experiment.tenant_reconciliation_audit FROM PUBLIC;
REVOKE ALL ON FUNCTION raq_worker_experiment.tenant_enqueue(uuid,uuid,text,text,text,timestamptz),raq_worker_experiment.tenant_jobs(uuid,integer),raq_worker_experiment.tenant_reconcile(uuid,uuid,uuid,text,text) FROM PUBLIC;
`;
const checksum=crypto.createHash('sha256').update(SQL).digest('hex');
async function install(pool){
 const c=await pool.connect();try{
  await c.query('BEGIN');await c.query("SELECT pg_advisory_xact_lock(hashtext('raq-atomic-worker-experiment-install'))");
  const exists=await c.query("SELECT to_regclass('raq_worker_experiment.jobs') jobs,to_regclass('raq_control.transaction_context') context,to_regclass('raq_worker_experiment.tenant_reconciliation_audit') audit, EXISTS(SELECT 1 FROM pg_proc f JOIN pg_namespace n ON n.oid=f.pronamespace WHERE n.nspname='raq_worker_experiment' AND f.proname IN ('tenant_enqueue','tenant_jobs','tenant_reconcile')) functions");
  if(!exists.rows[0].jobs||!exists.rows[0].context)throw Error('Worker and control experiments are required');
  if(exists.rows[0].audit||exists.rows[0].functions)throw Error('Atomic tenant worker experiment already exists');
  await c.query(SQL);await c.query('COMMIT');return {checksum};
 }catch(e){try{await c.query('ROLLBACK')}catch{}throw e}finally{c.release()}
}
function view(row){return {id:row.id,kind:row.kind,state:row.state,availableAt:row.available_at,attempts:row.attempts,createdAt:row.created_at,updatedAt:row.updated_at,failure:row.failure||null};}
function atomicTenantWorker({control,validators={}}){
 if(!control||typeof control.withWorkspace!=='function')throw Error('Control service required');
 return {
  async enqueue(token,workspaceId,input){
   if(!input||typeof input!=='object'||Array.isArray(input)||typeof input.kind!=='string'||typeof input.key!=='string'||!Object.hasOwn(input,'payload'))throw Error('Invalid job');
   const validate=Object.hasOwn(validators,input.kind)&&validators[input.kind];if(typeof validate!=='function'||await validate(input.payload)!==true)throw Error('Invalid job');
   const serialized=JSON.stringify(input.payload);if(serialized===undefined||Buffer.byteLength(serialized)>65536)throw Error('Invalid job');
   const when=input.availableAt===undefined?new Date():new Date(input.availableAt);if(!Number.isFinite(when.getTime()))throw Error('Invalid job');
   return control.withWorkspace(token,workspaceId,'write',async c=>{
    const r=await c.query('SELECT * FROM raq_worker_experiment.tenant_enqueue($1,$2,$3,$4,$5,$6)',[crypto.randomUUID(),workspaceId,input.kind,input.key,serialized,when]);
    return {created:r.rows[0].created,job:view(r.rows[0])};
   });
  },
  async list(token,workspaceId,limit=50){
   if(!Number.isInteger(limit)||limit<1||limit>100)throw Error('Invalid job limit');
   return control.withWorkspace(token,workspaceId,'read',async c=>{const r=await c.query('SELECT * FROM raq_worker_experiment.tenant_jobs($1,$2)',[workspaceId,limit]);return r.rows.map(view)});
  },
  async reconcile(token,workspaceId,id,outcome,note){
   if(!['succeeded','failed'].includes(outcome)||typeof note!=='string'||!note.trim()||note.length>1000||/[\x00-\x1f\x7f]/.test(note))throw Error('Invalid job');
   return control.withWorkspace(token,workspaceId,'owner',async c=>{const r=await c.query('SELECT * FROM raq_worker_experiment.tenant_reconcile($1,$2,$3,$4,$5)',[workspaceId,id,crypto.randomUUID(),outcome,note]);return view(r.rows[0]);});
  }
 };
}
module.exports={install,atomicTenantWorker,checksum};
