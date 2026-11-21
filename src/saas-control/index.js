'use strict';
// Isolated control-plane primitives, NOT wired into the single-owner server.
// Calls to privileged methods require a trusted, already-authorized principal.
const crypto=require('node:crypto'),password=require('./password');
const ROLES=new Set(['owner','admin','editor','viewer']);
const PERMISSIONS=Object.freeze({read:['owner','admin','editor','viewer'],write:['owner','admin','editor'],manage:['owner','admin'],owner:['owner']});
function emailValue(x){const v=typeof x==='string'?x.trim().toLowerCase():'';if(v.length>254||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)||/[\x00-\x1f\x7f]/.test(v))throw Error('Invalid email');return v;}
function workspaceName(x){const v=typeof x==='string'?x.trim():'';if(!v||v.length>120||/[\x00-\x1f\x7f]/.test(v))throw Error('Invalid workspace name');return v;}
function tokenHash(token){if(typeof token!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(token))return null;return crypto.createHash('sha256').update(token).digest('hex');}
async function tx(pool,fn){const c=await pool.connect();try{await c.query('BEGIN');const value=await fn(c);await c.query('COMMIT');return value}catch(e){try{await c.query('ROLLBACK')}catch{}throw e}finally{c.release()}}
function control(pool,tenantPool=pool){
  return {
    async createUser(email,plainPassword){const normalized=emailValue(email),hash=await password.hash(plainPassword),id=crypto.randomUUID();await pool.query('INSERT INTO raq_control.users(id,email,password_hash) VALUES($1,$2,$3)',[id,normalized,hash]);return {id,email:normalized};},
    async login(email,plainPassword){
      let normalized;try{normalized=emailValue(email)}catch{normalized='invalid@example.invalid'}
      const subject=crypto.createHash('sha256').update(normalized).digest('hex');
      const attempt=await pool.query(`INSERT INTO raq_control.login_attempts(subject_hash,window_start,attempts) VALUES($1,now(),1)
        ON CONFLICT(subject_hash) DO UPDATE SET window_start=CASE WHEN raq_control.login_attempts.window_start < now()-interval '15 minutes' THEN now() ELSE raq_control.login_attempts.window_start END,
        attempts=CASE WHEN raq_control.login_attempts.window_start < now()-interval '15 minutes' THEN 1 ELSE raq_control.login_attempts.attempts+1 END RETURNING attempts`,[subject]);
      if(attempt.rows[0].attempts>10)throw Error('Invalid credentials');
      const result=await pool.query('SELECT id,password_hash,disabled FROM raq_control.users WHERE email=$1',[normalized]);const row=result.rows[0];
      // Spend comparable scrypt work even when the account does not exist.
      const dummy='scrypt$65536$8$1$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';
      const ok=await password.verify(plainPassword,row?.password_hash||dummy);if(!ok||!row||row.disabled)throw Error('Invalid credentials');
      const token=crypto.randomBytes(32).toString('base64url'),digest=tokenHash(token),expires=new Date(Date.now()+8*60*60*1000);
      await tx(pool,async c=>{
        // Verification is deliberately outside the transaction, but a password
        // change or disable during the expensive hash must invalidate this login.
        const current=await c.query('SELECT password_hash,disabled FROM raq_control.users WHERE id=$1 FOR SHARE',[row.id]);
        if(!current.rowCount||current.rows[0].disabled||current.rows[0].password_hash!==row.password_hash)throw Error('Invalid credentials');
        await c.query('INSERT INTO raq_control.sessions(token_hash,user_id,expires_at) VALUES($1,$2,$3)',[digest,row.id,expires]);
        await c.query('DELETE FROM raq_control.login_attempts WHERE subject_hash=$1',[subject]);
      });return {token,expiresAt:expires.toISOString()};
    },
    async logout(token){const hash=tokenHash(token);if(!hash)return;await pool.query('UPDATE raq_control.sessions SET revoked_at=now() WHERE token_hash=$1 AND revoked_at IS NULL',[hash]);},
    async changePassword(token,oldPassword,newPassword){
      const tokenDigest=tokenHash(token);if(!tokenDigest)throw Error('Authentication required');
      const snapshot=await pool.query(`SELECT u.id,u.password_hash FROM raq_control.sessions s JOIN raq_control.users u ON u.id=s.user_id
        WHERE s.token_hash=$1 AND s.revoked_at IS NULL AND s.expires_at>now() AND NOT u.disabled`,[tokenDigest]);
      const row=snapshot.rows[0];if(!row)throw Error('Authentication required');
      if(!await password.verify(oldPassword,row.password_hash))throw Error('Invalid credentials');
      const newHash=await password.hash(newPassword);
      return tx(pool,async c=>{
        // Expensive work happened outside the transaction. Recheck the account
        // and current session under locks before changing anything; a concurrent
        // disable/password change/logout cannot silently succeed in its wake.
        const current=await c.query('SELECT password_hash,disabled FROM raq_control.users WHERE id=$1 FOR UPDATE',[row.id]);
        if(!current.rowCount||current.rows[0].disabled||current.rows[0].password_hash!==row.password_hash)throw Error('Authentication required');
        const valid=await c.query('SELECT 1 FROM raq_control.sessions WHERE token_hash=$1 AND user_id=$2 AND revoked_at IS NULL AND expires_at>now() FOR UPDATE',[tokenDigest,row.id]);
        if(!valid.rowCount)throw Error('Authentication required');
        await c.query('UPDATE raq_control.users SET password_hash=$2 WHERE id=$1',[row.id,newHash]);
        await c.query('UPDATE raq_control.sessions SET revoked_at=now() WHERE user_id=$1 AND revoked_at IS NULL',[row.id]);
        return {changed:true};
      });
    },
    async createWorkspace(actorToken,name){const name2=workspaceName(name);return tx(pool,async c=>{const user=await principal(c,actorToken),id=crypto.randomUUID();await c.query('INSERT INTO raq_control.workspaces(id,name) VALUES($1,$2)',[id,name2]);await c.query("INSERT INTO raq_control.memberships(workspace_id,user_id,role) VALUES($1,$2,'owner')",[id,user]);return{id,name:name2,role:'owner'};});},
    async listWorkspaces(actorToken){return tx(pool,async c=>{const user=await principal(c,actorToken);const r=await c.query('SELECT w.id,w.name,m.role FROM raq_control.workspaces w JOIN raq_control.memberships m ON m.workspace_id=w.id WHERE m.user_id=$1 AND NOT w.suspended ORDER BY w.created_at,w.id',[user]);return r.rows;});},
    async setMember(actorToken,workspaceId,userId,role){
      if(role!==null&&!ROLES.has(role))throw Error('Invalid role');
      return tx(pool,async c=>{
        const actor=await principal(c,actorToken);const locked=await c.query('SELECT id FROM raq_control.workspaces WHERE id=$1 AND NOT suspended FOR UPDATE',[workspaceId]);if(!locked.rowCount)throw Error('Workspace unavailable');
        const a=await c.query('SELECT role FROM raq_control.memberships WHERE workspace_id=$1 AND user_id=$2',[workspaceId,actor]);const actorRole=a.rows[0]?.role;
        if(actorRole!=='owner'&&actorRole!=='admin')throw Error('Permission denied');
        const old=await c.query('SELECT role FROM raq_control.memberships WHERE workspace_id=$1 AND user_id=$2',[workspaceId,userId]);const oldRole=old.rows[0]?.role;
        if(actorRole!=='owner'&&(oldRole==='owner'||oldRole==='admin'||role==='owner'||role==='admin'))throw Error('Permission denied');
        if(oldRole==='owner'&&role!=='owner'){const owners=await c.query("SELECT count(*)::int AS n FROM raq_control.memberships WHERE workspace_id=$1 AND role='owner'",[workspaceId]);if(owners.rows[0].n<=1)throw Error('Cannot remove the last owner');}
        if(role===null)await c.query('DELETE FROM raq_control.memberships WHERE workspace_id=$1 AND user_id=$2',[workspaceId,userId]);
        else await c.query('INSERT INTO raq_control.memberships(workspace_id,user_id,role) VALUES($1,$2,$3) ON CONFLICT(workspace_id,user_id) DO UPDATE SET role=EXCLUDED.role',[workspaceId,userId,role]);
        return {workspaceId,userId,role};
      });
    },
    async withWorkspace(token,workspaceId,permission,fn){
      if(!Object.hasOwn(PERMISSIONS,permission)||typeof fn!=='function')throw Error('Invalid workspace operation');
      return tx(tenantPool,async c=>{
        const role=await c.query(`SELECT r.rolsuper,r.rolbypassrls,t.relrowsecurity,t.relforcerowsecurity,
          pg_has_role(current_user,t.relowner,'MEMBER') AS can_assume_owner,
          pg_has_role(current_user,n.nspowner,'MEMBER') AS can_assume_schema_owner,
          (SELECT pg_has_role(current_user,nc.nspowner,'MEMBER') FROM pg_namespace nc WHERE nc.nspname='raq_control') AS can_assume_control_owner,
          EXISTS(SELECT 1 FROM pg_proc fn JOIN pg_namespace ns ON ns.oid=fn.pronamespace WHERE ns.nspname='raq_control' AND fn.proname IN ('open_context','active_workspace','can_write','close_context') AND pg_has_role(current_user,fn.proowner,'MEMBER')) AS can_assume_function_owner,
          has_table_privilege(current_user,t.oid,'TRUNCATE,REFERENCES,TRIGGER') AS bypass_ops,
          EXISTS(SELECT 1 FROM pg_roles b WHERE (b.rolsuper OR b.rolbypassrls) AND pg_has_role(current_user,b.oid,'MEMBER')) AS can_assume_bypass,
          (SELECT count(*)::int FROM pg_policy p WHERE p.polrelid=t.oid) AS policies,
          EXISTS(SELECT 1 FROM pg_class sensitive JOIN pg_namespace sn ON sn.oid=sensitive.relnamespace
            WHERE sn.nspname='raq_control' AND sensitive.relkind IN ('r','p','v','m','f')
            AND has_table_privilege(current_user,sensitive.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')) AS control_access
          FROM pg_roles r JOIN pg_namespace n ON n.nspname='raq_tenant' JOIN pg_class t ON t.relnamespace=n.oid AND t.relname='workspace_kv' AND t.relkind='r' WHERE r.rolname=current_user`);
        const safety=role.rows[0];if(!safety||safety.rolsuper||safety.rolbypassrls||safety.can_assume_bypass||safety.can_assume_owner||safety.can_assume_schema_owner||safety.can_assume_control_owner!==false||safety.can_assume_function_owner||safety.bypass_ops||safety.control_access||!safety.relrowsecurity||!safety.relforcerowsecurity||safety.policies!==4)throw Error('Unsafe PostgreSQL runtime role or row security configuration');
        const result=await c.query('SELECT * FROM raq_control.open_context($1,$2,$3)',[token,workspaceId,permission]);
        const value=await fn(c,{workspaceId,userId:result.rows[0].user_id,role:result.rows[0].role});
        await c.query('SELECT raq_control.close_context()');return value;
      });
    }
  };
}
async function principal(c,token){const hash=tokenHash(token);if(!hash)throw Error('Authentication required');const r=await c.query('SELECT s.user_id FROM raq_control.sessions s JOIN raq_control.users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.revoked_at IS NULL AND s.expires_at>now() AND NOT u.disabled FOR SHARE OF s,u',[hash]);if(!r.rowCount)throw Error('Authentication required');return r.rows[0].user_id;}
module.exports={control,tokenHash};
