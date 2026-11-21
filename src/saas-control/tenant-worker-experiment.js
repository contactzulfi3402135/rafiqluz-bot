'use strict';
// Narrow authenticated adapter around the research-only worker. Not wired to
// the existing app and not suitable for direct SQL access by tenant users.
function view(row) {
  return {id:row.id,kind:row.kind,state:row.state,availableAt:row.available_at,
    attempts:row.attempts,createdAt:row.created_at,updatedAt:row.updated_at,
    failure:row.failure || null};
}
function tenantWorker({control,worker,pool,validators={}}) {
  if(!control || !worker || !pool) throw Error('Worker adapter dependencies required');
  return {
    async enqueue(token,workspaceId,input) {
      if(!input || typeof input!=='object' || Array.isArray(input)) throw Error('Invalid job');
      // Deny unknown jobs by default: trusted runner handlers may have side
      // effects that are not safe for an arbitrary tenant-provided payload.
      const validate=Object.hasOwn(validators,input.kind) && validators[input.kind];
      if(typeof validate!=='function' || await validate(input.payload)!==true) throw Error('Invalid job');
      return control.withWorkspace(token,workspaceId,'write',async()=>{
        const result=await worker.enqueue({workspaceId,kind:input.kind,key:input.key,payload:input.payload,availableAt:input.availableAt});
        return {created:result.created,job:view(result.job)};
      });
    },
    async list(token,workspaceId,limit=50) {
      if(!Number.isInteger(limit)||limit<1||limit>100) throw Error('Invalid job limit');
      return control.withWorkspace(token,workspaceId,'read',async()=>{
        const result=await pool.query(`SELECT id,kind,state,available_at,attempts,created_at,updated_at,failure
          FROM raq_worker_experiment.jobs WHERE workspace_id=$1 ORDER BY created_at DESC,id DESC LIMIT $2`,[workspaceId,limit]);
        return result.rows.map(view);
      });
    },
    async reconcile(token,workspaceId,id,outcome,note) {
      // Reconciliation is an explicit owner decision, not proof of provider
      // delivery; users must independently verify the side effect first.
      return control.withWorkspace(token,workspaceId,'owner',async()=>{
        const result=await worker.reconcile(id,workspaceId,outcome,note);
        if(!result) throw Error('Job unavailable for reconciliation');
        return view(result);
      });
    }
  };
}
module.exports={tenantWorker};
