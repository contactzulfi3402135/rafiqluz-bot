'use strict';
// DESTRUCTIVE to experiment schemas: disposable PostgreSQL database only.
const assert=require('node:assert/strict'),{Pool}=require('pg');
const name=process.env.RAQ_TEST_PG_DATABASE,host=process.env.RAQ_TEST_PG_HOST,port=Number(process.env.RAQ_TEST_PG_PORT),admin=process.env.RAQ_TEST_PG_ADMIN,app=process.env.RAQ_TEST_PG_RUNTIME,tenant=process.env.RAQ_TEST_PG_TENANT;
if(process.env.RAQ_TEST_PG_ALLOW_DROP!=='1'||!/^raq_test_[a-z0-9_]+$/.test(name||'')||!host?.startsWith('/')||!port||!admin||!/^raq_test_[a-z0-9_]+$/.test(app||'')||!/^raq_test_[a-z0-9_]+$/.test(tenant||'')||tenant===app)throw Error('Refusing test: disposable database, roles, Unix socket and explicit drop permission required');
const root=new Pool({database:name,host,port,user:admin,max:4}),runtime=new Pool({database:name,host,port,user:app,max:3}),tenantPool=new Pool({database:name,host,port,user:tenant,max:3});
const {migrate}=require('../src/saas-control/schema'),{control}=require('../src/saas-control'),work=require('../src/saas-control/worker-experiment'),{tenantWorker}=require('../src/saas-control/tenant-worker-experiment');let n=0;const ok=(v,s)=>{assert.ok(v,s);n++;console.log('✓ '+s)};
(async()=>{try{
 await root.query('DROP SCHEMA IF EXISTS raq_worker_experiment CASCADE; DROP SCHEMA IF EXISTS raq_tenant CASCADE; DROP SCHEMA IF EXISTS raq_control CASCADE');await migrate(root);await work.install(root);
 await root.query(`GRANT USAGE ON SCHEMA raq_control TO ${app}; GRANT SELECT,INSERT,UPDATE,DELETE ON raq_control.users,raq_control.workspaces,raq_control.memberships,raq_control.sessions,raq_control.login_attempts TO ${app}; GRANT USAGE ON SCHEMA raq_control,raq_tenant TO ${tenant}; GRANT SELECT,INSERT,UPDATE,DELETE ON raq_tenant.workspace_kv TO ${tenant}; GRANT EXECUTE ON FUNCTION raq_control.open_context(text,uuid,text),raq_control.active_workspace(),raq_control.can_write(),raq_control.close_context() TO ${tenant}`);
 const ctl=control(runtime,tenantPool),worker=work.worker(root),api=tenantWorker({control:ctl,worker,pool:root,validators:{synthetic:p=>p && typeof p==='object' && !Array.isArray(p)}});
 const ua=await ctl.createUser('a@worker.test','synthetic-password-aaa'),ub=await ctl.createUser('b@worker.test','synthetic-password-bbb'),uv=await ctl.createUser('v@worker.test','synthetic-password-vvv');
 const a=await ctl.login(ua.email,'synthetic-password-aaa'),b=await ctl.login(ub.email,'synthetic-password-bbb'),v=await ctl.login(uv.email,'synthetic-password-vvv'),wa=await ctl.createWorkspace(a.token,'A'),wb=await ctl.createWorkspace(b.token,'B');await ctl.setMember(a.token,wa.id,uv.id,'viewer');
 await assert.rejects(()=>api.enqueue(a.token,wa.id,{kind:'unapproved',key:'blocked',payload:{}}),/Invalid job/);ok(true,'unknown tenant-submitted job kinds are denied by default');
 const x=await api.enqueue(a.token,wa.id,{kind:'synthetic',key:'once',payload:{secret:'do-not-return'}});ok(x.created&&x.job.state==='queued'&&!JSON.stringify(x).includes('do-not-return')&&!('lease_token' in x.job),'owner enqueues a scoped job without exposing worker secrets or payload');
 const again=await api.enqueue(a.token,wa.id,{kind:'synthetic',key:'once',payload:{secret:'do-not-return'}});ok(!again.created&&again.job.id===x.job.id,'idempotent workspace key returns the existing job');
 await assert.rejects(()=>api.enqueue(v.token,wa.id,{kind:'synthetic',key:'viewer',payload:{}}),/Permission denied/);ok(true,'viewer cannot enqueue');
 await assert.rejects(()=>api.list(b.token,wa.id),/Permission denied/);ok((await api.list(b.token,wb.id)).length===0&&(await api.list(v.token,wa.id)).length===1,'another owner cannot select the first workspace and viewers see only authorized jobs');
 const claim=await worker.claim('synthetic-worker',30);await worker.beginDispatch(claim.id,claim.lease_token,claim.fence);await worker.finish(claim.id,claim.lease_token,claim.fence,'uncertain','synthetic unknown');
 await assert.rejects(()=>api.reconcile(v.token,wa.id,x.job.id,'succeeded','reviewed'),/Permission denied/);await assert.rejects(()=>api.reconcile(b.token,wa.id,x.job.id,'succeeded','reviewed'),/Permission denied/);
 const done=await api.reconcile(a.token,wa.id,x.job.id,'succeeded','reviewed synthetic provider result');ok(done.state==='succeeded','only the authorized workspace owner can reconcile an uncertain job');
 await ctl.logout(a.token);await assert.rejects(()=>api.enqueue(a.token,wa.id,{kind:'synthetic',key:'after-logout',payload:{}}),/Authentication required/);ok(true,'revoked session cannot enqueue');
 console.log(`PASS: ${n} synthetic tenant worker PostgreSQL checks`);
}finally{await tenantPool.end();await runtime.end();await root.end()}})().catch(e=>{console.error(e);process.exitCode=1});
