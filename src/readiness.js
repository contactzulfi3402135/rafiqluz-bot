'use strict';
// Narrow process readiness: startup wiring, shutdown gate and SQLite read.
// Does not prove provider connectivity, write access, disk durability or
// delivery correctness. Keep the public response free of state and secrets.
function handler({lifecycle,open}){
 if(!lifecycle||typeof open!=='function')throw Error('Readiness dependencies required');
 return (req,res)=>{
  res.set('Cache-Control','no-store');res.set('X-Content-Type-Options','nosniff');
  if(!lifecycle.isReady())return res.status(503).json({status:'not-ready'});
  try{open().prepare('SELECT key FROM settings LIMIT 1').get();return res.status(200).json({status:'ready'})}
  catch{return res.status(503).json({status:'not-ready'})}
 };
}
module.exports={handler};
