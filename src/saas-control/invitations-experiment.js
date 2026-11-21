'use strict';
// Prototype for explicitly provisioned users. Not connected to the bot.
const crypto=require('node:crypto'),{tokenHash}=require('./index');
const SQL=`CREATE TABLE raq_control.invitations (
 id uuid PRIMARY KEY, workspace_id uuid NOT NULL REFERENCES raq_control.workspaces(id),
 email text NOT NULL, role text NOT NULL CHECK(role IN ('admin','editor','viewer')),
 token_hash text NOT NULL UNIQUE, created_by uuid NOT NULL REFERENCES raq_control.users(id),
 expires_at timestamptz NOT NULL, used_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX invitations_workspace_idx ON raq_control.invitations(workspace_id,created_at);`;
async function tx(pool,fn){const c=await pool.connect();try{await c.query('BEGIN');const x=await fn(c);await c.query('COMMIT');return x}catch(e){try{await c.query('ROLLBACK')}catch{}throw e}finally{c.release()}}
async function install(pool){return tx(pool,async c=>{await c.query("SELECT pg_advisory_xact_lock(hashtext('raq-invitations-experiment-install'))");const r=await c.query("SELECT to_regclass('raq_control.invitations') AS existing");if(r.rows[0].existing)throw Error('Invitations table already exists; refusing to modify it');await c.query(SQL);return {installed:true}})}
async function principal(c,token){const h=tokenHash(token);if(!h)throw Error('Authentication required');const r=await c.query('SELECT u.id,u.email FROM raq_control.sessions s JOIN raq_control.users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.revoked_at IS NULL AND s.expires_at>now() AND NOT u.disabled FOR SHARE OF s,u',[h]);if(!r.rowCount)throw Error('Authentication required');return r.rows[0]}
function emailValue(email){const v=typeof email==='string'?email.trim().toLowerCase():'';if(v.length>254||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)||/[\x00-\x1f\x7f]/.test(v))throw Error('Invalid email');return v;}
function invitations(pool){return {
 async issue(actorToken,workspaceId,email,role){
  const target=emailValue(email);if(!['admin','editor','viewer'].includes(role))throw Error('Invalid role');
  return tx(pool,async c=>{
   const actor=await principal(c,actorToken),workspace=await c.query('SELECT id FROM raq_control.workspaces WHERE id=$1 AND NOT suspended FOR UPDATE',[workspaceId]);if(!workspace.rowCount)throw Error('Workspace unavailable');
   const membership=await c.query('SELECT role FROM raq_control.memberships WHERE workspace_id=$1 AND user_id=$2',[workspaceId,actor.id]);const actorRole=membership.rows[0]?.role;
   if(actorRole!=='owner'&&actorRole!=='admin'||actorRole==='admin'&&role==='admin')throw Error('Permission denied');
   const token=crypto.randomBytes(32).toString('base64url'),hash=tokenHash(token),id=crypto.randomUUID();
   const r=await c.query(`INSERT INTO raq_control.invitations(id,workspace_id,email,role,token_hash,created_by,expires_at) VALUES($1,$2,$3,$4,$5,$6,now()+interval '7 days') RETURNING expires_at`,[id,workspaceId,target,role,hash,actor.id]);
   return {id,token,expiresAt:r.rows[0].expires_at.toISOString()};
  });
 },
 async accept(actorToken,inviteToken){
  const hash=tokenHash(inviteToken);if(!hash)throw Error('Invitation unavailable');
  return tx(pool,async c=>{
   const actor=await principal(c,actorToken),initial=await c.query('SELECT workspace_id FROM raq_control.invitations WHERE token_hash=$1 AND email=$2 AND used_at IS NULL AND expires_at>now()',[hash,actor.email]);
   if(!initial.rowCount)throw Error('Invitation unavailable');
   // The workspace is always locked before the invitation, matching issue,
   // membership changes, and revocation to avoid inverted lock ordering.
   const workspace=await c.query('SELECT id FROM raq_control.workspaces WHERE id=$1 AND NOT suspended FOR UPDATE',[initial.rows[0].workspace_id]);if(!workspace.rowCount)throw Error('Invitation unavailable');
   const invite=await c.query('SELECT * FROM raq_control.invitations WHERE token_hash=$1 AND workspace_id=$2 AND email=$3 AND used_at IS NULL AND expires_at>now() FOR UPDATE',[hash,initial.rows[0].workspace_id,actor.email]);
   if(!invite.rowCount)throw Error('Invitation unavailable');const x=invite.rows[0];
   const issuer=await c.query('SELECT m.role FROM raq_control.memberships m JOIN raq_control.users u ON u.id=m.user_id WHERE m.workspace_id=$1 AND m.user_id=$2 AND NOT u.disabled FOR SHARE OF m,u',[x.workspace_id,x.created_by]);
   if(!issuer.rowCount||!['owner','admin'].includes(issuer.rows[0].role)||(x.role==='admin'&&issuer.rows[0].role!=='owner'))throw Error('Invitation unavailable');
   // An invitation cannot silently alter an existing member's privileges.
   await c.query('INSERT INTO raq_control.memberships(workspace_id,user_id,role) VALUES($1,$2,$3) ON CONFLICT(workspace_id,user_id) DO NOTHING',[x.workspace_id,actor.id,x.role]);
   const role=await c.query('SELECT role FROM raq_control.memberships WHERE workspace_id=$1 AND user_id=$2',[x.workspace_id,actor.id]);await c.query('UPDATE raq_control.invitations SET used_at=now() WHERE id=$1',[x.id]);
   return {workspaceId:x.workspace_id,role:role.rows[0].role};
  });
 },
 async revoke(actorToken,workspaceId,inviteId){
  return tx(pool,async c=>{
   const actor=await principal(c,actorToken);
   const workspace=await c.query('SELECT id FROM raq_control.workspaces WHERE id=$1 AND NOT suspended FOR UPDATE',[workspaceId]);if(!workspace.rowCount)throw Error('Workspace unavailable');
   const member=await c.query('SELECT role FROM raq_control.memberships WHERE workspace_id=$1 AND user_id=$2',[workspaceId,actor.id]);
   if(!['owner','admin'].includes(member.rows[0]?.role))throw Error('Permission denied');
   const existing=await c.query('SELECT role FROM raq_control.invitations WHERE id=$1 AND workspace_id=$2 AND used_at IS NULL FOR UPDATE',[inviteId,workspaceId]);
   if(!existing.rowCount)throw Error('Invitation unavailable');
   if(member.rows[0].role==='admin'&&existing.rows[0].role==='admin')throw Error('Permission denied');
   await c.query('UPDATE raq_control.invitations SET used_at=now() WHERE id=$1 AND workspace_id=$2 AND used_at IS NULL',[inviteId,workspaceId]);
   // The existing experimental schema does not distinguish revoke vs accept;
   // do not treat used_at as a complete audit trail.
   return {revoked:true};
  });
 }
};}
module.exports={install,invitations};
