'use strict';
// Real PostgreSQL, disposable database only. This tests isolated control-plane
// primitives and a specimen RLS table, NOT the current SQLite product routes.
const assert=require('node:assert/strict'),{Pool}=require('pg');
const name=process.env.RAQ_TEST_PG_DATABASE,host=process.env.RAQ_TEST_PG_HOST,port=Number(process.env.RAQ_TEST_PG_PORT),admin=process.env.RAQ_TEST_PG_ADMIN,app=process.env.RAQ_TEST_PG_RUNTIME,tenant=process.env.RAQ_TEST_PG_TENANT;
if(process.env.RAQ_TEST_PG_ALLOW_DROP!=='1'||!/^raq_test_[a-z0-9_]+$/.test(name||'')||!host?.startsWith('/')||!port||!admin||!/^raq_test_[a-z0-9_]+$/.test(app||'')||!/^raq_test_[a-z0-9_]+$/.test(tenant||'')||tenant===app)throw Error('Refusing test: require explicitly disposable raq_test_* database, runtime role, local Unix socket and RAQ_TEST_PG_ALLOW_DROP=1.');
const superPool=new Pool({database:name,host,port,user:admin,max:2}),runtime=new Pool({database:name,host,port,user:app,max:2}),tenantPool=new Pool({database:name,host,port,user:tenant,max:2}),{migrate}=require('../src/saas-control/schema'),{control,tokenHash}=require('../src/saas-control');let n=0;
function ok(v,s){assert.ok(v,s);n++;console.log('✓ '+s)}
(async()=>{try{
 await superPool.query('DROP SCHEMA IF EXISTS raq_tenant CASCADE; DROP SCHEMA IF EXISTS raq_control CASCADE');
 await superPool.query("CREATE SCHEMA raq_tenant; CREATE TABLE raq_tenant.existing(value text); INSERT INTO raq_tenant.existing VALUES ('preserve')");
 await assert.rejects(()=>migrate(superPool),/existing control-plane objects/);const existing=await superPool.query('SELECT value FROM raq_tenant.existing');ok(existing.rows[0].value==='preserve','migration refuses existing objects without altering them');await superPool.query('DROP SCHEMA raq_tenant CASCADE');
 const [a,b]=await Promise.all([migrate(superPool),migrate(superPool)]);ok(a.version===1&&a.checksum===b.checksum,'concurrent migrations serialize and are idempotent');
 await superPool.query(`GRANT USAGE ON SCHEMA raq_control TO ${app}; GRANT SELECT,INSERT,UPDATE,DELETE ON raq_control.users,raq_control.workspaces,raq_control.memberships,raq_control.sessions,raq_control.login_attempts TO ${app}; GRANT USAGE ON SCHEMA raq_control,raq_tenant TO ${tenant}; GRANT SELECT,INSERT,UPDATE,DELETE ON raq_tenant.workspace_kv TO ${tenant}; GRANT EXECUTE ON FUNCTION raq_control.open_context(text,uuid,text),raq_control.active_workspace(),raq_control.can_write(),raq_control.close_context() TO ${tenant}`);
 const api=control(runtime,tenantPool),ownerA=await api.createUser('OwnerA@example.test','Synthetic-password-A'),ownerB=await api.createUser('ownerb@example.test','Synthetic-password-B'),viewer=await api.createUser('view@example.test','Synthetic-password-view');
 ok(ownerA.email==='ownera@example.test'&&ownerA.id!==ownerB.id,'user identities are normalized and unique');
 await assert.rejects(()=>api.createUser('OWNERA@example.test','Synthetic-password-duplicate'));ok(true,'duplicate normalized email is rejected');
 await assert.rejects(()=>api.login('OwnerA@example.test','incorrect-password'));await assert.rejects(()=>api.login('missing@example.test','Synthetic-password-unknown'));ok(true,'bad credentials and unknown accounts fail authentication');
 for(let i=0;i<9;i++)await assert.rejects(()=>api.login('missing@example.test','Synthetic-password-unknown'));await assert.rejects(()=>api.login('missing@example.test','Synthetic-password-unknown'));const throttled=await superPool.query('SELECT attempts FROM raq_control.login_attempts WHERE subject_hash=$1',[require('node:crypto').createHash('sha256').update('missing@example.test').digest('hex')]);ok(throttled.rows[0].attempts===11,'database-backed per-identity throttle applies across requests');
 // Hold verification at a deterministic point while another transaction
 // changes the account; no stale-password or disabled session may be minted.
 const race=await api.createUser('race@example.test','Synthetic-race-password'),passwordModule=require('../src/saas-control/password'),verify=passwordModule.verify;
 for(const mutation of ['password','disabled']){
  let ready,release;const enteredVerify=new Promise(r=>ready=r),gate=new Promise(r=>release=r);
  const original=(await superPool.query('SELECT password_hash FROM raq_control.users WHERE id=$1',[race.id])).rows[0].password_hash;
  passwordModule.verify=async(...args)=>{const result=await verify(...args);ready();await gate;return result};
  const pending=api.login('race@example.test','Synthetic-race-password');
  try{await enteredVerify;
   if(mutation==='password')await superPool.query('UPDATE raq_control.users SET password_hash=$2 WHERE id=$1',[race.id,'synthetic-replaced-hash']);
   else await superPool.query('UPDATE raq_control.users SET disabled=true WHERE id=$1',[race.id]);
   release();await assert.rejects(pending,/Invalid credentials/);
   ok((await superPool.query('SELECT count(*)::int n FROM raq_control.sessions WHERE user_id=$1',[race.id])).rows[0].n===0,`${mutation} change during verification cannot create a stale session`);
  }finally{release();passwordModule.verify=verify;await superPool.query('UPDATE raq_control.users SET password_hash=$2,disabled=false WHERE id=$1',[race.id,original]);}
 }
 const sa=await api.login('OwnerA@example.test','Synthetic-password-A'),sb=await api.login('ownerb@example.test','Synthetic-password-B'),sv=await api.login('view@example.test','Synthetic-password-view');
 let stored=await superPool.query('SELECT token_hash FROM raq_control.sessions WHERE user_id=$1',[ownerA.id]);ok(stored.rows[0].token_hash===tokenHash(sa.token)&&!JSON.stringify(stored.rows).includes(sa.token),'session token is random and stored only as a SHA-256 digest');
 const wa=await api.createWorkspace(sa.token,'A'),wb=await api.createWorkspace(sb.token,'B');ok(wa.id!==wb.id&&(await api.listWorkspaces(sa.token)).length===1,'workspace creation atomically assigns its authenticated owner');
 await api.withWorkspace(sa.token,wa.id,'write',c=>c.query('INSERT INTO raq_tenant.workspace_kv(workspace_id,key,value) VALUES($1,$2,$3)',[wa.id,'secret',JSON.stringify({v:'A'})]));
 await api.withWorkspace(sb.token,wb.id,'write',c=>c.query('INSERT INTO raq_tenant.workspace_kv(workspace_id,key,value) VALUES($1,$2,$3)',[wb.id,'secret',JSON.stringify({v:'B'})]));
 const read=await api.withWorkspace(sa.token,wa.id,'read',c=>c.query('SELECT workspace_id,value FROM raq_tenant.workspace_kv'));ok(read.rowCount===1&&read.rows[0].workspace_id===wa.id&&read.rows[0].value.v==='A','row security isolates two real PostgreSQL workspace rows');
 await assert.rejects(()=>api.withWorkspace(sa.token,wb.id,'read',()=>{}),/Permission denied/);ok(true,'a user cannot select an unowned workspace');
 await assert.rejects(()=>api.withWorkspace(sa.token,wa.id,'write',c=>c.query('INSERT INTO raq_tenant.workspace_kv(workspace_id,key,value) VALUES($1,$2,$3)',[wb.id,'forged',JSON.stringify({})])),/row-level security/);ok(true,'row-security WITH CHECK rejects a forged workspace ID');
 const bare=await tenantPool.query('SELECT * FROM raq_tenant.workspace_kv');ok(bare.rowCount===0,'no tenant context is default-deny, including after pooled transactions');
 const spoof=await tenantPool.connect();try{await spoof.query('BEGIN');await spoof.query("SELECT set_config('raq.workspace_id',$1,true),set_config('raq.role','owner',true),set_config('raq.mode','write',true)",[wb.id]);const attempt=await spoof.query('SELECT * FROM raq_tenant.workspace_kv');ok(attempt.rowCount===0,'forged PostgreSQL session variables cannot select a workspace');await spoof.query('ROLLBACK')}finally{spoof.release()}
 await assert.rejects(()=>runtime.query('SELECT * FROM raq_control.transaction_context'),/permission denied/);await assert.rejects(()=>tenantPool.query('SELECT * FROM raq_control.sessions'),/permission denied/);await assert.rejects(()=>tenantPool.query("INSERT INTO raq_control.transaction_context(backend_pid,tx,workspace_id,user_id,role,mode) VALUES(1,1,$1,$2,'owner','write')",[wb.id,ownerB.id]),/permission denied/);ok(true,'tenant database role cannot read credentials or forge transaction context');
 const ctx=await tenantPool.connect();try{await ctx.query('BEGIN');await assert.rejects(()=>ctx.query('SELECT raq_control.open_context($1,$2,$3)',[sa.token,wb.id,'read']),/Permission denied/);await ctx.query('ROLLBACK');ok(true,'database context function rejects a valid user token for another workspace')}finally{ctx.release()}
 await assert.rejects(()=>control(superPool).withWorkspace(sa.token,wa.id,'read',()=>{}),/Unsafe PostgreSQL runtime role/);ok(true,'superuser and bypass-capable runtime roles are refused');
 await superPool.query('ALTER TABLE raq_tenant.workspace_kv DISABLE ROW LEVEL SECURITY');await assert.rejects(()=>api.withWorkspace(sa.token,wa.id,'read',()=>{}),/row security configuration/);await superPool.query('ALTER TABLE raq_tenant.workspace_kv ENABLE ROW LEVEL SECURITY');ok(true,'disabled row-level security causes a fail-closed refusal');
 await superPool.query(`GRANT SELECT ON raq_control.workspaces TO ${tenant}`);await assert.rejects(()=>api.withWorkspace(sa.token,wa.id,'read',()=>{}),/row security configuration/);await superPool.query(`REVOKE SELECT ON raq_control.workspaces FROM ${tenant}`);ok(true,'tenant role with access to any control-plane table fails closed');
 await assert.rejects(()=>tenantPool.query('TRUNCATE raq_tenant.workspace_kv'),/permission denied/);await superPool.query(`GRANT TRUNCATE ON raq_tenant.workspace_kv TO ${tenant}`);await assert.rejects(()=>api.withWorkspace(sa.token,wa.id,'read',()=>{}),/row security configuration/);await superPool.query(`REVOKE TRUNCATE ON raq_tenant.workspace_kv FROM ${tenant}`);ok(true,'TRUNCATE, which bypasses RLS, is not granted and its accidental grant is rejected');
 await api.setMember(sa.token,wa.id,viewer.id,'admin');await assert.rejects(()=>api.setMember(sv.token,wa.id,viewer.id,'owner'),/Permission denied/);ok(true,'an admin cannot promote itself to owner');await api.setMember(sa.token,wa.id,viewer.id,'viewer');const vrows=await api.withWorkspace(sv.token,wa.id,'read',c=>c.query('SELECT * FROM raq_tenant.workspace_kv'));ok(vrows.rowCount===1,'explicit viewer membership can read the assigned workspace');
 await assert.rejects(()=>api.withWorkspace(sv.token,wa.id,'write',()=>{}),/Permission denied/);await assert.rejects(()=>api.setMember(sv.token,wa.id,viewer.id,'admin'),/Permission denied/);ok(true,'viewer cannot write or promote itself');
 await assert.rejects(()=>api.withWorkspace(sv.token,wa.id,'read',c=>c.query('INSERT INTO raq_tenant.workspace_kv(workspace_id,key,value) VALUES($1,$2,$3)',[wa.id,'viewer-forged',JSON.stringify({})])),/row-level security/);const unchanged=await api.withWorkspace(sv.token,wa.id,'read',c=>c.query("UPDATE raq_tenant.workspace_kv SET value='{}' WHERE key='secret'"));ok(unchanged.rowCount===0,'database policies reject viewer writes even inside a read callback');
 await assert.rejects(()=>api.setMember(sa.token,wa.id,ownerA.id,null),/last owner/);ok(true,'last workspace owner cannot be removed');
 let release,entered;const gate=new Promise(r=>release=r),inside=new Promise(r=>entered=r);
 const inFlight=api.withWorkspace(sv.token,wa.id,'read',async c=>{entered();await gate;return c.query('SELECT * FROM raq_tenant.workspace_kv')});await inside;
 let revoked=false;const removing=api.setMember(sa.token,wa.id,viewer.id,null).then(v=>{revoked=true;return v});await new Promise(r=>setTimeout(r,60));ok(!revoked,'membership revocation waits for an already-started authorized transaction');release();await inFlight;await removing;
 await assert.rejects(()=>api.withWorkspace(sv.token,wa.id,'read',()=>{}),/Permission denied/);ok(true,'revoked membership is rejected on the next operation');
 await assert.rejects(()=>api.withWorkspace(sa.token,wa.id,'write',async c=>{await c.query('INSERT INTO raq_tenant.workspace_kv(workspace_id,key,value) VALUES($1,$2,$3)',[wa.id,'rolled-back',JSON.stringify(true)]);throw Error('synthetic failure')}),/synthetic failure/);
 const after=await api.withWorkspace(sa.token,wa.id,'read',c=>c.query("SELECT key FROM raq_tenant.workspace_kv WHERE key='rolled-back'"));ok(after.rowCount===0,'workspace transaction rolls back on failure');
 await api.logout(sa.token);await assert.rejects(()=>api.listWorkspaces(sa.token),/Authentication required/);ok(true,'revoked session cannot access workspaces');
 await superPool.query("UPDATE raq_control.sessions SET expires_at=now()-interval '1 second' WHERE token_hash=$1",[tokenHash(sb.token)]);await assert.rejects(()=>api.withWorkspace(sb.token,wb.id,'read',()=>{}),/Authentication required/);ok(true,'expired sessions cannot open workspace context');
 const pwUser=await api.createUser('password-change@example.test','Old-synthetic-password'),pw1=await api.login(pwUser.email,'Old-synthetic-password'),pw2=await api.login(pwUser.email,'Old-synthetic-password');
 await assert.rejects(()=>api.changePassword(pw1.token,'wrong-password','New-synthetic-password'),/Invalid credentials/);
 ok((await api.listWorkspaces(pw2.token)).length===0,'wrong current password does not revoke existing sessions');
 await api.changePassword(pw1.token,'Old-synthetic-password','New-synthetic-password');
 await assert.rejects(()=>api.listWorkspaces(pw1.token),/Authentication required/);await assert.rejects(()=>api.listWorkspaces(pw2.token),/Authentication required/);
 await assert.rejects(()=>api.login(pwUser.email,'Old-synthetic-password'),/Invalid credentials/);const newLogin=await api.login(pwUser.email,'New-synthetic-password');ok(!!newLogin.token,'password change revokes every previous session and accepts only the new password');
 await superPool.query("UPDATE raq_control.schema_migrations SET checksum='wrong' WHERE version=1");await assert.rejects(()=>migrate(superPool),/checksum mismatch/);ok(true,'migration checksum drift fails closed');
 console.log(`PASS: ${n} real PostgreSQL control-plane checks`);
}finally{await tenantPool.end();await runtime.end();await superPool.end()}})().catch(e=>{console.error(e);process.exitCode=1});
