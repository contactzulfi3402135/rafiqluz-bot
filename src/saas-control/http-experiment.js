'use strict';
// Experimental, separately mounted API. Not connected to the existing bot.
// Do not expose publicly: its authentication, tenant boundaries, billing and
// operational controls have not been reviewed or tested as a complete system.
const express=require('express'),rateLimit=require('express-rate-limit');
const {parseEvent}=require('./paddle-experiment');
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const keyPattern=/^[a-zA-Z0-9_.-]{1,100}$/;
function workspace(req){const x=req.params.workspaceId;if(!UUID.test(x||''))throw Error('Invalid request');return x;}
function bearer(req){const m=/^Bearer ([A-Za-z0-9_-]{43})$/.exec(req.get('authorization')||'');if(!m)throw Error('Authentication required');return m[1];}
function handler(fn){return (req,res)=>Promise.resolve().then(()=>fn(req,res)).catch(e=>{
 if(res.headersSent)return;
 if(e.message==='Authentication required')return res.status(401).json({ok:false,error:'Authentication required'});
 if(e.message==='Permission denied'||e.message==='Workspace unavailable')return res.status(403).json({ok:false,error:'Permission denied'});
 if(e.message==='Invalid request'||e.message==='Invalid plan'||e.message==='Plan unavailable'||e.message==='Invalid role'||e.message==='Invalid email'||e.message==='Invitation unavailable'||e.message==='Invalid object name'||e.message==='Invalid object content'||e.message==='Invalid offset'||e.message==='Invalid job'||e.message==='Invalid job limit'||e.message==='Job unavailable for reconciliation'||e.message==='Invalid outcome'||e.message==='Invalid reason'||e.message?.startsWith('Password must contain'))return res.status(400).json({ok:false,error:'Invalid request'});
 if(e.code==='AUTH_BUSY')return res.status(503).json({ok:false,error:'Service temporarily busy'});
 return res.status(503).json({ok:false,error:'Operation unavailable; do not retry an uncertain action automatically'});
});}
function createRouter({control,billing,invitations,objects,jobs,webhookSecret}={}){
 if(!control)throw Error('Control service required');const router=express.Router();
 router.use((req,res,next)=>{res.set('Cache-Control','no-store');res.set('X-Content-Type-Options','nosniff');next()});
 // This route must be mounted before JSON middleware to preserve raw bytes.
 router.post('/paddle/webhook',express.raw({type:'application/json',limit:'1mb'}),handler(async(req,res)=>{
  if(!billing||!webhookSecret)return res.sendStatus(503);
  try{await billing.receive(req.body,req.get('paddle-signature'),webhookSecret)}catch(e){if(e.message==='Invalid webhook signature'||e.message==='Invalid webhook JSON'||e.message==='Invalid webhook event')return res.sendStatus(400);throw e;}
  const event=parseEvent(req.body);if(event.subscriptionId)await billing.process(event.subscriptionId);return res.sendStatus(200);
 }));
 // Raw binary upload is kept before the general JSON parser.
 router.post('/workspaces/:workspaceId/files',express.raw({type:'application/octet-stream',limit:'1mb'}),handler(async(req,res)=>{
  if(!objects)return res.status(503).json({ok:false,error:'Files disabled'});if(!Buffer.isBuffer(req.body))throw Error('Invalid request');
  const result=await objects.put(bearer(req),workspace(req),req.get('x-object-name'),req.body);return res.status(201).json({ok:true,file:result});
 }));
 router.use(express.json({limit:'32kb',strict:true}));
 const limiter=rateLimit({windowMs:15*60*1000,max:12,standardHeaders:true,legacyHeaders:false,handler:(req,res)=>res.status(429).json({ok:false,error:'Too many attempts'})});
 router.post('/auth/login',limiter,handler(async(req,res)=>{
  if(typeof req.body?.email!=='string'||typeof req.body?.password!=='string')throw Error('Invalid request');
  try{const session=await control.login(req.body.email,req.body.password);return res.json({ok:true,...session})}catch(e){if(e.code==='AUTH_BUSY')throw e;if(e.message==='Invalid credentials')return res.status(401).json({ok:false,error:'Invalid credentials'});throw e;}
 }));
 router.post('/auth/logout',handler(async(req,res)=>{await control.logout(bearer(req));return res.json({ok:true})}));
 router.post('/auth/password',limiter,handler(async(req,res)=>{
  if(typeof req.body?.currentPassword!=='string'||typeof req.body?.newPassword!=='string')throw Error('Invalid request');
  try{await control.changePassword(bearer(req),req.body.currentPassword,req.body.newPassword);return res.json({ok:true,reauthenticate:true})}
  catch(e){if(e.message==='Invalid credentials')return res.status(401).json({ok:false,error:'Invalid credentials'});throw e;}
 }));
 router.get('/workspaces',handler(async(req,res)=>res.json({ok:true,workspaces:await control.listWorkspaces(bearer(req))})));
 router.post('/workspaces',handler(async(req,res)=>{
  if(typeof req.body?.name!=='string')throw Error('Invalid request');const result=await control.createWorkspace(bearer(req),req.body.name);return res.status(201).json({ok:true,workspace:result});
 }));
 router.put('/workspaces/:workspaceId/members/:userId',handler(async(req,res)=>{
  const wid=workspace(req),uid=req.params.userId;if(!UUID.test(uid||'')||!['owner','admin','editor','viewer',null].includes(req.body?.role))throw Error('Invalid request');
  const member=await control.setMember(bearer(req),wid,uid,req.body.role);return res.json({ok:true,member});
 }));
 router.post('/workspaces/:workspaceId/invitations',handler(async(req,res)=>{
  if(!invitations)return res.status(503).json({ok:false,error:'Invitations disabled'});
  const invite=await invitations.issue(bearer(req),workspace(req),req.body?.email,req.body?.role);return res.status(201).json({ok:true,invitation:invite});
 }));
 router.delete('/workspaces/:workspaceId/invitations/:invitationId',handler(async(req,res)=>{
  if(!invitations)return res.status(503).json({ok:false,error:'Invitations disabled'});if(!UUID.test(req.params.invitationId||''))throw Error('Invalid request');
  const result=await invitations.revoke(bearer(req),workspace(req),req.params.invitationId);return res.json({ok:true,...result});
 }));
 router.post('/invitations/accept',limiter,handler(async(req,res)=>{
  if(!invitations)return res.status(503).json({ok:false,error:'Invitations disabled'});
  const membership=await invitations.accept(bearer(req),req.body?.token);return res.json({ok:true,membership});
 }));
 router.get('/workspaces/:workspaceId/values/:key',handler(async(req,res)=>{
  const wid=workspace(req),key=req.params.key;if(!keyPattern.test(key||''))throw Error('Invalid request');
  const value=await control.withWorkspace(bearer(req),wid,'read',async c=>{const r=await c.query('SELECT value FROM raq_tenant.workspace_kv WHERE workspace_id=$1 AND key=$2',[wid,key]);return r.rows[0]});
  return value?res.json({ok:true,value:value.value}):res.status(404).json({ok:false,error:'Not found'});
 }));
 router.put('/workspaces/:workspaceId/values/:key',handler(async(req,res)=>{
  const wid=workspace(req),key=req.params.key;if(!keyPattern.test(key||'')||!Object.hasOwn(req.body||{},'value'))throw Error('Invalid request');
  const value=JSON.stringify(req.body.value);if(value===undefined||Buffer.byteLength(value)>16384)throw Error('Invalid request');
  await control.withWorkspace(bearer(req),wid,'write',c=>c.query(`INSERT INTO raq_tenant.workspace_kv(workspace_id,key,value) VALUES($1,$2,$3)
   ON CONFLICT(workspace_id,key) DO UPDATE SET value=EXCLUDED.value,updated_at=now()`,[wid,key,value]));return res.json({ok:true});
 }));
 router.get('/workspaces/:workspaceId/files',handler(async(req,res)=>{
  if(!objects)return res.status(503).json({ok:false,error:'Files disabled'});const s=String(req.query.offset||'0');if(!/^\d{1,4}$/.test(s))throw Error('Invalid request');
  const files=await objects.list(bearer(req),workspace(req),Number(s));return res.json({ok:true,files});
 }));
 router.get('/workspaces/:workspaceId/files/:fileId',handler(async(req,res)=>{
  if(!objects)return res.status(503).json({ok:false,error:'Files disabled'});if(!UUID.test(req.params.fileId||''))throw Error('Invalid request');
  const result=await objects.get(bearer(req),workspace(req),req.params.fileId);if(!result)return res.status(404).json({ok:false,error:'Not found'});
  res.set('Content-Disposition','attachment; filename="download.bin"');res.type('application/octet-stream');return res.send(result.data);
 }));
 router.delete('/workspaces/:workspaceId/files/:fileId',handler(async(req,res)=>{
  if(!objects)return res.status(503).json({ok:false,error:'Files disabled'});if(!UUID.test(req.params.fileId||''))throw Error('Invalid request');
  const removed=await objects.delete(bearer(req),workspace(req),req.params.fileId);return removed?res.json({ok:true}):res.status(404).json({ok:false,error:'Not found'});
 }));
 router.get('/workspaces/:workspaceId/jobs',handler(async(req,res)=>{
  if(!jobs)return res.status(503).json({ok:false,error:'Jobs disabled'});
  const text=String(req.query.limit||'50');if(!/^\d{1,3}$/.test(text))throw Error('Invalid request');
  return res.json({ok:true,jobs:await jobs.list(bearer(req),workspace(req),Number(text))});
 }));
 router.post('/workspaces/:workspaceId/jobs',handler(async(req,res)=>{
  if(!jobs)return res.status(503).json({ok:false,error:'Jobs disabled'});
  const result=await jobs.enqueue(bearer(req),workspace(req),req.body);return res.status(result.created?201:200).json({ok:true,...result});
 }));
 router.post('/workspaces/:workspaceId/jobs/:jobId/reconcile',handler(async(req,res)=>{
  if(!jobs)return res.status(503).json({ok:false,error:'Jobs disabled'});
  if(!UUID.test(req.params.jobId||'')||req.body?.confirmed!==true)throw Error('Invalid request');
  const job=await jobs.reconcile(bearer(req),workspace(req),req.params.jobId,req.body?.outcome,req.body?.note);return res.json({ok:true,job});
 }));
 router.post('/workspaces/:workspaceId/billing/checkout',handler(async(req,res)=>{
  if(!billing)return res.status(503).json({ok:false,error:'Billing disabled'});const wid=workspace(req),plan=req.body?.plan;
  const result=await control.withWorkspace(bearer(req),wid,'owner',()=>billing.beginCheckout(wid,plan));return res.json({ok:true,...result});
 }));
 router.post('/workspaces/:workspaceId/billing/portal',handler(async(req,res)=>{
  if(!billing)return res.status(503).json({ok:false,error:'Billing disabled'});const wid=workspace(req);
  const url=await control.withWorkspace(bearer(req),wid,'owner',()=>billing.portal(wid));return res.json({ok:true,url});
 }));
 router.get('/workspaces/:workspaceId/billing/status',handler(async(req,res)=>{
  if(!billing)return res.status(503).json({ok:false,error:'Billing disabled'});const wid=workspace(req);
  const entitlement=await control.withWorkspace(bearer(req),wid,'owner',()=>billing.entitlement(wid));return res.json({ok:true,entitlement});
 }));
 router.use((err,req,res,next)=>{if(res.headersSent)return next(err);if(err.type==='entity.too.large')return res.status(413).json({ok:false,error:'Request too large'});if(err.type==='entity.parse.failed')return res.status(400).json({ok:false,error:'Invalid JSON'});return res.status(503).json({ok:false,error:'Service unavailable'});});
 return router;
}
module.exports={createRouter};
