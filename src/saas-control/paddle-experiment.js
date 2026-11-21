'use strict';
// Sandbox-only prototype. No HTTP routes and no integration with the bot.
// All workspace operations require authorization by the trusted caller.
const crypto=require('node:crypto');
const SCHEMA=`
CREATE SCHEMA raq_billing_experiment;
CREATE TABLE raq_billing_experiment.plans (
 id text PRIMARY KEY, price_id text UNIQUE NOT NULL, label text NOT NULL,
 limits jsonb NOT NULL, enabled boolean NOT NULL DEFAULT false
);
CREATE TABLE raq_billing_experiment.checkouts (
 id uuid PRIMARY KEY, workspace_id uuid NOT NULL, plan_id text NOT NULL REFERENCES raq_billing_experiment.plans(id), price_id text NOT NULL,
 state text NOT NULL CHECK(state IN ('creating','ready','uncertain')), transaction_id text UNIQUE,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK((state='ready')=(transaction_id IS NOT NULL))
);
CREATE TABLE raq_billing_experiment.subscriptions (
 subscription_id text PRIMARY KEY, workspace_id uuid NOT NULL, transaction_id text UNIQUE NOT NULL REFERENCES raq_billing_experiment.checkouts(transaction_id),
 customer_id text NOT NULL, status text NOT NULL, price_id text NOT NULL, occurred_at timestamptz NOT NULL,
 scheduled_change jsonb, ordering_conflict boolean NOT NULL DEFAULT false
);
CREATE INDEX billing_workspace_idx ON raq_billing_experiment.subscriptions(workspace_id);
CREATE TABLE raq_billing_experiment.events (
 event_id text PRIMARY KEY, event_type text NOT NULL, occurred_at timestamptz NOT NULL,
 subscription_id text, transaction_id text, customer_id text, status text, price_id text, scheduled_change jsonb,
 event_digest text NOT NULL, state text NOT NULL CHECK(state IN ('pending','applied','ignored','conflict')),
 received_at timestamptz NOT NULL DEFAULT clock_timestamp(), next_attempt_at timestamptz NOT NULL DEFAULT clock_timestamp(), attempts integer NOT NULL DEFAULT 0
);
CREATE INDEX billing_pending_idx ON raq_billing_experiment.events(next_attempt_at,subscription_id,occurred_at) WHERE state='pending';
`;
const checksum=crypto.createHash('sha256').update(SCHEMA).digest('hex');
const idPattern={event:/^evt_[a-z0-9]{26}$/,transaction:/^txn_[a-z0-9]{26}$/,subscription:/^sub_[a-z0-9]{26}$/,customer:/^ctm_[a-z0-9]{26}$/,price:/^pri_[a-z0-9]{26}$/};
function id(value,type){if(typeof value!=='string'||!idPattern[type].test(value))throw Error('Invalid Paddle '+type+' ID');return value;}
function tx(pool,fn){return pool.connect().then(async c=>{try{await c.query('BEGIN');const r=await fn(c);await c.query('COMMIT');return r}catch(e){try{await c.query('ROLLBACK')}catch{}throw e}finally{c.release()}})}
async function install(pool){return tx(pool,async c=>{await c.query("SELECT pg_advisory_xact_lock(hashtext('raq-billing-experiment-install'))");const exists=await c.query("SELECT 1 FROM pg_namespace WHERE nspname='raq_billing_experiment'");if(exists.rowCount)throw Error('Billing experiment schema already exists; refusing to modify it');await c.query(SCHEMA);return {checksum};});}
function verifyWebhook(raw,header,secret,{toleranceSeconds=5,now=Date.now()}={}){
 if(!Buffer.isBuffer(raw)||raw.length===0||raw.length>1048576||typeof header!=='string'||header.length>4096||typeof secret!=='string'||secret.length<16||!Number.isInteger(toleranceSeconds)||toleranceSeconds<1||toleranceSeconds>300)return false;
 const parts=header.split(';').map(x=>x.trim().split('='));const times=parts.filter(x=>x.length===2&&x[0]==='ts').map(x=>x[1]);const signatures=parts.filter(x=>x.length===2&&x[0]==='h1').map(x=>x[1]);
 if(times.length!==1||!/^\d{10,11}$/.test(times[0])||!signatures.length||signatures.length>10||Math.abs(now/1000-Number(times[0]))>toleranceSeconds)return false;
 const h=crypto.createHmac('sha256',secret).update(times[0]+':').update(raw).digest();
 return signatures.some(s=>/^[a-f0-9]{64}$/i.test(s)&&crypto.timingSafeEqual(h,Buffer.from(s,'hex')));
}
function sandboxClient(apiKey){
 if(typeof apiKey!=='string'||!/^pdl_sdbx_apikey_[A-Za-z0-9_]{30,100}$/.test(apiKey))throw Error('A current Paddle sandbox API key is required');
 async function request(path,body,method='POST'){
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),15000);let response;
  try{response=await fetch('https://sandbox-api.paddle.com'+path,{method,headers:{Authorization:'Bearer '+apiKey,'Content-Type':'application/json','Paddle-Version':'1'},body:method==='GET'?undefined:JSON.stringify(body),signal:controller.signal,redirect:'error'});
   const parts=[];let size=0;for await(const chunk of response.body){size+=chunk.length;if(size>1048576){controller.abort();throw Error('response too large')}parts.push(chunk)}
   if(!response.ok)throw Error('Paddle HTTP '+response.status);let parsed;try{parsed=JSON.parse(Buffer.concat(parts).toString('utf8'))}catch{throw Error('Paddle invalid JSON')};return parsed.data;
  }catch(e){const err=Error('Paddle request failed or has an unknown outcome');err.cause=e;throw err}finally{clearTimeout(timer)}
 }
 return {
  async createTransaction(priceId,checkoutId){id(priceId,'price');if(typeof checkoutId!=='string'||!/^[0-9a-f-]{36}$/i.test(checkoutId))throw Error('Invalid checkout identifier');const data=await request('/transactions',{items:[{price_id:priceId,quantity:1}],collection_mode:'automatic',custom_data:{raq_checkout_id:checkoutId}});return{id:id(data?.id,'transaction')};},
  async verifyTransaction(transactionId,checkoutId,priceId){
   id(transactionId,'transaction');id(priceId,'price');const data=await request('/transactions/'+transactionId,undefined,'GET');
   return data?.id===transactionId&&data?.custom_data?.raq_checkout_id===checkoutId&&data?.collection_mode==='automatic'&&data?.status!=='canceled'&&Array.isArray(data?.items)&&data.items.length===1&&data.items[0]?.price?.id===priceId&&data.items[0]?.quantity===1;
  },
  async portal(customerId){id(customerId,'customer');const data=await request('/customers/'+customerId+'/portal-sessions',{}),url=data?.urls?.general?.overview;let parsed;try{parsed=new URL(url)}catch{throw Error('Invalid Paddle portal URL')};if(parsed.protocol!=='https:'||!(parsed.hostname==='paddle.com'||parsed.hostname.endsWith('.paddle.com'))||parsed.username||parsed.password)throw Error('Invalid Paddle portal URL');return parsed.href;}
 };
}
const subscriptionTypes=new Set(['subscription.created','subscription.updated','subscription.activated','subscription.canceled','subscription.paused','subscription.resumed','subscription.trialing','subscription.past_due']);
const validStatuses=new Set(['active','trialing','past_due','paused','canceled']);
function parseEvent(raw){
 let e;try{e=JSON.parse(raw.toString('utf8'))}catch{throw Error('Invalid webhook JSON')};
 id(e?.event_id,'event');if(typeof e.event_type!=='string'||e.event_type.length>100||typeof e.occurred_at!=='string'||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,9})?Z$/.test(e.occurred_at)||!Number.isFinite(Date.parse(e.occurred_at)))throw Error('Invalid webhook event');
 if(!subscriptionTypes.has(e.event_type))return {eventId:e.event_id,type:e.event_type,occurredAt:e.occurred_at,ignored:true};
 const d=e.data;if(!d||!validStatuses.has(d.status)||!Array.isArray(d.items)||d.items.length!==1||d.items[0]?.quantity!==1)throw Error('Unsupported subscription payload');
 const event={eventId:e.event_id,type:e.event_type,occurredAt:e.occurred_at,subscriptionId:id(d.id,'subscription'),customerId:id(d.customer_id,'customer'),status:d.status,priceId:id(d.items[0]?.price?.id,'price'),scheduledChange:d.scheduled_change||null};
 if(e.event_type==='subscription.created')event.transactionId=id(d.transaction_id,'transaction');
 if(event.scheduledChange!==null&&(typeof event.scheduledChange!=='object'||Array.isArray(event.scheduledChange)))throw Error('Invalid scheduled change');
 return event;
}
function billing(pool,client){return {
 // Operator-only configuration, never expose this method to customers.
 async configurePlan(planId,priceId,label,limits,enabled=false){
  if(typeof planId!=='string'||!/^[a-z0-9_-]{1,80}$/.test(planId))throw Error('Invalid plan');id(priceId,'price');
  if(typeof label!=='string'||!label.trim()||label.length>120||/[\x00-\x1f\x7f]/.test(label)||typeof enabled!=='boolean'||!limits||typeof limits!=='object'||Array.isArray(limits))throw Error('Invalid plan configuration');
  const json=JSON.stringify(limits);if(Buffer.byteLength(json)>16384)throw Error('Plan limits too large');
  await pool.query(`INSERT INTO raq_billing_experiment.plans(id,price_id,label,limits,enabled) VALUES($1,$2,$3,$4,$5)
   ON CONFLICT(id) DO UPDATE SET price_id=EXCLUDED.price_id,label=EXCLUDED.label,limits=EXCLUDED.limits,enabled=EXCLUDED.enabled`,[planId,priceId,label,json,enabled]);
 },
 // Workspace IDs must come from the server-side authenticated authorization layer.
 async beginCheckout(workspaceId,planId){
  if(typeof planId!=='string'||!/^[a-z0-9_-]{1,80}$/.test(planId))throw Error('Invalid plan');
  const checkoutId=crypto.randomUUID(),r=await pool.query(`INSERT INTO raq_billing_experiment.checkouts(id,workspace_id,plan_id,price_id,state)
   SELECT $1,$2,id,price_id,'creating' FROM raq_billing_experiment.plans WHERE id=$3 AND enabled RETURNING id,price_id`,[checkoutId,workspaceId,planId]);
  if(!r.rowCount)throw Error('Plan unavailable');
  try{const t=await client.createTransaction(r.rows[0].price_id,checkoutId);await pool.query("UPDATE raq_billing_experiment.checkouts SET state='ready',transaction_id=$2 WHERE id=$1 AND state='creating'",[checkoutId,t.id]);return {checkoutId,transactionId:t.id};}
  catch(e){await pool.query("UPDATE raq_billing_experiment.checkouts SET state='uncertain' WHERE id=$1 AND state='creating'",[checkoutId]);throw Error('Checkout creation requires reconciliation; do not retry automatically');}
 },
 // Operator-only reconciliation. Never expose this as a customer route.
 // A verified matching transaction still requires independent operator review.
 async reconcileCheckout(workspaceId,checkoutId,transactionId){
  id(transactionId,'transaction');const r=await pool.query(`SELECT co.id,co.price_id FROM raq_billing_experiment.checkouts co WHERE co.id=$1 AND co.workspace_id=$2 AND co.state IN ('creating','uncertain')`,[checkoutId,workspaceId]);
  if(!r.rowCount)throw Error('Checkout is not awaiting reconciliation');
  if(!await client.verifyTransaction(transactionId,checkoutId,r.rows[0].price_id))throw Error('Provider transaction does not match checkout');
  const updated=await pool.query(`UPDATE raq_billing_experiment.checkouts SET state='ready',transaction_id=$3 WHERE id=$1 AND workspace_id=$2 AND state IN ('creating','uncertain') RETURNING id`,[checkoutId,workspaceId,transactionId]);
  if(!updated.rowCount)throw Error('Checkout changed during reconciliation');return {checkoutId,transactionId};
 },
 // Store a verified event first; out-of-order events stay pending until a
 // transaction-matched subscription.created links the subscription.
 async receive(raw,signature,secret,options){
  if(!verifyWebhook(raw,signature,secret,options))throw Error('Invalid webhook signature');const e=parseEvent(raw),digest=crypto.createHash('sha256').update(raw).digest('hex');
  return tx(pool,async c=>{
   const inserted=await c.query(`INSERT INTO raq_billing_experiment.events(event_id,event_type,occurred_at,subscription_id,transaction_id,customer_id,status,price_id,scheduled_change,event_digest,state)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT(event_id) DO NOTHING RETURNING event_id`,[e.eventId,e.type,e.occurredAt,e.subscriptionId||null,e.transactionId||null,e.customerId||null,e.status||null,e.priceId||null,e.scheduledChange?JSON.stringify(e.scheduledChange):null,digest,e.ignored?'ignored':'pending']);
   if(!inserted.rowCount){const prior=await c.query('SELECT event_digest,state FROM raq_billing_experiment.events WHERE event_id=$1',[e.eventId]);if(prior.rows[0].event_digest!==digest)throw Error('Conflicting duplicate event');return {duplicate:true,state:prior.rows[0].state};}
   return {duplicate:false,state:e.ignored?'ignored':'pending'};
  });
 },
 // Trusted internal process. Serialized per subscription; unmatched events are
 // not dropped or granted access. Conflicting equal timestamps fail closed.
 async process(subscriptionId){
  id(subscriptionId,'subscription');return tx(pool,async c=>{
   await c.query('SELECT pg_advisory_xact_lock(hashtext($1))',['raq-billing:'+subscriptionId]);
   let current=await c.query('SELECT * FROM raq_billing_experiment.subscriptions WHERE subscription_id=$1 FOR UPDATE',[subscriptionId]);
   if(!current.rowCount){const created=await c.query(`SELECT e.*,e.occurred_at::text AS event_time,co.workspace_id FROM raq_billing_experiment.events e JOIN raq_billing_experiment.checkouts co ON co.transaction_id=e.transaction_id AND co.state='ready' WHERE e.subscription_id=$1 AND e.event_type='subscription.created' AND e.state='pending' ORDER BY e.occurred_at LIMIT 1`,[subscriptionId]);
    if(!created.rowCount){await c.query(`UPDATE raq_billing_experiment.events SET attempts=LEAST(attempts+1,1000000),next_attempt_at=clock_timestamp()+interval '60 seconds' WHERE subscription_id=$1 AND state='pending'`,[subscriptionId]);return {state:'unmatched'};}const x=created.rows[0];
    await c.query(`INSERT INTO raq_billing_experiment.subscriptions(subscription_id,workspace_id,transaction_id,customer_id,status,price_id,occurred_at,scheduled_change) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,[subscriptionId,x.workspace_id,x.transaction_id,x.customer_id,x.status,x.price_id,x.event_time,x.scheduled_change]);
    await c.query("UPDATE raq_billing_experiment.events SET state='applied' WHERE event_id=$1",[x.event_id]);
   }
   const pending=await c.query("SELECT *,occurred_at::text AS event_time FROM raq_billing_experiment.events WHERE subscription_id=$1 AND state='pending' ORDER BY occurred_at,event_id LIMIT 1000 FOR UPDATE",[subscriptionId]);
   for(const e of pending.rows){
    if(e.event_type==='subscription.created'){
     const match=await c.query('SELECT transaction_id=$2 AS matches FROM raq_billing_experiment.subscriptions WHERE subscription_id=$1',[subscriptionId,e.transaction_id]);
     if(!match.rows[0]?.matches){await c.query('UPDATE raq_billing_experiment.subscriptions SET ordering_conflict=true WHERE subscription_id=$1',[subscriptionId]);await c.query("UPDATE raq_billing_experiment.events SET state='conflict' WHERE event_id=$1",[e.event_id]);continue;}
    }
    const update=await c.query(`UPDATE raq_billing_experiment.subscriptions SET status=$2,price_id=$3,scheduled_change=$4,occurred_at=$5 WHERE subscription_id=$1 AND customer_id=$6 AND occurred_at<$5::timestamptz RETURNING subscription_id`,[subscriptionId,e.status,e.price_id,e.scheduled_change,e.event_time,e.customer_id]);
    if(update.rowCount){await c.query("UPDATE raq_billing_experiment.events SET state='applied' WHERE event_id=$1",[e.event_id]);continue;}
    const comparison=await c.query('SELECT customer_id=$2 AS customer_match,occurred_at>$3::timestamptz AS newer FROM raq_billing_experiment.subscriptions WHERE subscription_id=$1',[subscriptionId,e.customer_id,e.event_time]);
    if(comparison.rows[0]?.customer_match&&comparison.rows[0]?.newer){await c.query("UPDATE raq_billing_experiment.events SET state='ignored' WHERE event_id=$1",[e.event_id]);continue;}
    await c.query('UPDATE raq_billing_experiment.subscriptions SET ordering_conflict=true WHERE subscription_id=$1',[subscriptionId]);await c.query("UPDATE raq_billing_experiment.events SET state='conflict' WHERE event_id=$1",[e.event_id]);
   }
   return {state:'processed',count:pending.rowCount};
  });
 },
 async reconcilePending(limit=100){
  if(!Number.isInteger(limit)||limit<1||limit>1000)throw Error('Invalid batch limit');
  const rows=await pool.query(`SELECT subscription_id FROM raq_billing_experiment.events WHERE state='pending' AND subscription_id IS NOT NULL AND next_attempt_at<=clock_timestamp() GROUP BY subscription_id ORDER BY min(next_attempt_at),min(received_at) LIMIT $1`,[limit]);
  const results=[];for(const row of rows.rows){try{results.push({subscriptionId:row.subscription_id,...await this.process(row.subscription_id)})}catch{
   await pool.query(`UPDATE raq_billing_experiment.events SET attempts=LEAST(attempts+1,1000000),next_attempt_at=clock_timestamp()+interval '60 seconds' WHERE subscription_id=$1 AND state='pending'`,[row.subscription_id]);results.push({subscriptionId:row.subscription_id,state:'retry'});
  }}return results;
 },
 async entitlement(workspaceId){const r=await pool.query(`SELECT p.id,p.label,p.limits FROM raq_billing_experiment.subscriptions s JOIN raq_billing_experiment.plans p ON p.price_id=s.price_id AND p.enabled WHERE s.workspace_id=$1 AND s.status IN ('active','trialing') AND NOT s.ordering_conflict ORDER BY s.occurred_at DESC LIMIT 1`,[workspaceId]);return r.rows[0]||null;},
 async portal(workspaceId){const r=await pool.query("SELECT customer_id FROM raq_billing_experiment.subscriptions WHERE workspace_id=$1 ORDER BY occurred_at DESC LIMIT 1",[workspaceId]);if(!r.rowCount)throw Error('No billing customer');return client.portal(r.rows[0].customer_id);}
};}
module.exports={install,billing,sandboxClient,verifyWebhook,parseEvent,checksum};
