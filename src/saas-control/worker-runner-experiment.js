'use strict';
// Experimental trusted adapter runner. Not connected to app jobs or providers.
// External side effects can complete after cancellation or lease loss.
function pause(ms,signal){return new Promise(resolve=>{if(signal?.aborted)return resolve();const done=()=>{clearTimeout(timer);signal?.removeEventListener('abort',done);resolve()};const timer=setTimeout(done,ms);signal?.addEventListener('abort',done,{once:true});});}
function runner({queue,workerId,handlers,leaseSeconds=30,pollMs=1000,onError=()=>{}}){
 if(!queue||typeof workerId!=='string'||!workerId||!handlers||!Number.isInteger(leaseSeconds)||leaseSeconds<6||leaseSeconds>300||!Number.isInteger(pollMs)||pollMs<100||pollMs>60000)throw Error('Invalid worker configuration');
 async function runOnce(stopSignal){
  if(stopSignal?.aborted)return false;const job=await queue.claim(workerId,leaseSeconds);if(!job)return false;
  const {id,lease_token:token,fence}=job,handler=Object.hasOwn(handlers,job.kind)&&typeof handlers[job.kind]==='function'?handlers[job.kind]:null;
  if(!handler){await queue.failLeased(id,token,fence,'No trusted handler for this job kind');return true;}
  if(stopSignal?.aborted){await queue.release(id,token,fence);return true;}
  const signal=new AbortController();let lost=false,renewing=false;
  const abort=()=>signal.abort();stopSignal?.addEventListener('abort',abort,{once:true});if(stopSignal?.aborted)signal.abort();
  const heartbeat=setInterval(async()=>{
   if(renewing||lost)return;renewing=true;
   try{if(!await queue.heartbeat(id,token,fence,leaseSeconds)){lost=true;signal.abort()}}
   catch(e){lost=true;signal.abort();try{onError(e)}catch{}}
   finally{renewing=false}
  },Math.max(2000,Math.floor(leaseSeconds*1000/3)));heartbeat.unref?.();
  try{
   if(signal.signal.aborted){await queue.release(id,token,fence);return true;}
   const begun=await queue.beginDispatch(id,token,fence);if(!begun){lost=true;return true;}
   if(signal.signal.aborted){await queue.finish(id,token,fence,'uncertain','Stopped before provider execution could be confirmed');return true;}
   try{
    const result=await handler({workspaceId:job.workspace_id,jobId:id,idempotencyKey:job.idempotency_key,payload:job.payload,fence,signal:signal.signal});
    if(!lost&&!signal.signal.aborted)await queue.complete(id,token,fence,result===undefined?null:result);
    else if(!lost)await queue.finish(id,token,fence,'uncertain','Stopped after external dispatch began');
   }catch(e){
    if(!lost){const definitive=e?.definitive===true&&!signal.signal.aborted;await queue.finish(id,token,fence,definitive?'failed':'uncertain',definitive?'Provider definitively rejected the action':'Provider outcome is unknown');}
    try{onError(e)}catch{}
   }
   return true;
  }finally{clearInterval(heartbeat);stopSignal?.removeEventListener('abort',abort);}
 }
 async function run(stopSignal){if(!stopSignal||typeof stopSignal.addEventListener!=='function')throw Error('AbortSignal required');while(!stopSignal.aborted){try{const handled=await runOnce(stopSignal);if(!handled)await pause(pollMs,stopSignal)}catch(e){try{onError(e)}catch{}await pause(pollMs,stopSignal)}}}
 return {runOnce,run};
}
module.exports={runner};
