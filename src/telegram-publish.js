'use strict';
// Optional, manual Telegram channel text publishing using the official Bot API.
// The token stays in the deployment environment, never in SQLite or the UI.
// Each send is journalled before contacting Telegram; ambiguous results are
// held for review and are never automatically retried.
const crypto=require('node:crypto');
const {open,S,AUD}=require('./db');
const {validId}=require('./compose-requests');
const token=()=>String(process.env.TELEGRAM_BOT_TOKEN || '').trim();
const validToken=t=>/^\d{5,16}:[A-Za-z0-9_-]{20,100}$/.test(t);
const configured=()=>validToken(token());
function table(){
 const d=open();d.exec(`CREATE TABLE IF NOT EXISTS telegram_sends(
   request_id TEXT PRIMARY KEY, digest TEXT NOT NULL, target TEXT NOT NULL,
   text TEXT NOT NULL, state TEXT NOT NULL, detail TEXT NOT NULL DEFAULT '',
   channel_id TEXT NOT NULL DEFAULT '', channel_title TEXT NOT NULL DEFAULT '',
   provider_id TEXT NOT NULL DEFAULT '', started_at TEXT NOT NULL DEFAULT (datetime('now')),
   updated_at TEXT NOT NULL DEFAULT (datetime('now'))
 )`);return d;
}
function row(id){return table().prepare('SELECT request_id AS requestId,target,text,state,detail,channel_id AS channelId,channel_title AS channelTitle,provider_id AS providerId,started_at AS startedAt,updated_at AS updatedAt FROM telegram_sends WHERE request_id=?').get(id)||null;}
function status(id){if(!validId(id))throw Error('Invalid request ID.');return row(id);}
function recent(){return table().prepare('SELECT request_id AS requestId,target,state,detail,channel_title AS channelTitle,provider_id AS providerId,started_at AS startedAt FROM telegram_sends ORDER BY rowid DESC LIMIT 20').all();}
function digest(target,text){return crypto.createHash('sha256').update(JSON.stringify([target,text])).digest('hex');}
function update(id,state,detail='',chat='',title='',provider=''){
 table().prepare("UPDATE telegram_sends SET state=?,detail=?,channel_id=?,channel_title=?,provider_id=?,updated_at=datetime('now') WHERE request_id=? AND state='running'").run(state,detail,chat,title,provider,id);
 try{require('./persist').syncSoon('telegram-send',5000)}catch{}
}
async function liveTransport(method,data,t){
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),15000);
 try {
  const r=await fetch(`https://api.telegram.org/bot${t}/${method}`,{method:'POST',redirect:'error',signal:controller.signal,headers:{'content-type':'application/json'},body:JSON.stringify(data)});
  const size=Number(r.headers.get('content-length'));if(Number.isFinite(size)&&size>65536)throw Error('Telegram response too large');
  const chunks=[];let n=0;const reader=r.body?.getReader();if(!reader)throw Error('Telegram response unavailable');
  while(true){const x=await reader.read();if(x.done)break;n+=x.value.length;if(n>65536){await reader.cancel();throw Error('Telegram response too large')}chunks.push(Buffer.from(x.value));}
  let j;try{j=JSON.parse(Buffer.concat(chunks,n).toString('utf8'))}catch{throw Error('Telegram response invalid')}
  if(!r.ok||j.ok!==true)throw Error('Telegram request rejected');return j.result;
 } finally {clearTimeout(timer)}
}
let transport=liveTransport;
function _setTransportForTests(fn){transport=fn||liveTransport;}
const isStopped=()=>require('./panic').active()||require('./lifecycle').isStopping();
function validate(target,text,id,confirmed){
 if(!confirmed)throw Error('Confirm the exact channel and message before sending.');
 if(!validId(id))throw Error('A valid request ID is required.');
 if(!configured())throw Error('Telegram is not configured. Set TELEGRAM_BOT_TOKEN in the server environment.');
 if(!/^@[A-Za-z][A-Za-z0-9_]{4,31}$/.test(target)&&!/^\-100\d{5,15}$/.test(target))throw Error('Use a channel username like @channelname or a channel ID beginning -100.');
 if(!text.trim()||[...text].length>4096)throw Error('Telegram text must contain 1–4096 characters.');
 if(isStopped())throw Error('Panic stop or shutdown is active. No send was started.');
}
async function publish(input){
 const target=String(input?.target||'').trim(),text=String(input?.text||''),id=input?.requestId;
 validate(target,text,id,input?.confirmed===true);
 const d=table(),hash=digest(target,text);
 const inserted=d.prepare("INSERT OR IGNORE INTO telegram_sends(request_id,digest,target,text,state) VALUES(?,?,?,?,'running')").run(id,hash,target,text).changes;
 if(!inserted){const current=d.prepare('SELECT digest,state FROM telegram_sends WHERE request_id=?').get(id);if(current.digest!==hash)return {conflict:true};return {replayed:true,record:row(id)};}
 try{require('./persist').syncSoon('telegram-claim',5000)}catch{}
 let chatId='',title='';
 try {
   const me=await transport('getMe',{},token());
   if(!Number.isSafeInteger(me?.id))throw Error('Bot identity not verified');
   const chat=await transport('getChat',{chat_id:target},token());
   if(chat?.type!=='channel'||!Number.isSafeInteger(chat.id))throw Error('Destination is not a channel');
   chatId=String(chat.id);title=String(chat.title||target).slice(0,150);
   const member=await transport('getChatMember',{chat_id:chatId,user_id:me.id},token());
   if(!(member?.status==='creator'||(member?.status==='administrator'&&member.can_post_messages===true)))throw Error('Bot lacks channel posting permission');
   if(isStopped())throw Error('Panic stop or shutdown is active');
 } catch(e) {
   const detail='Channel or bot posting permission could not be verified. No Telegram send was started.';
   update(id,'rejected',detail,chatId,title);try{AUD.log('owner','telegram.rejected',detail)}catch{};
   return {record:row(id)};
 }
 try {
   const result=await transport('sendMessage',{chat_id:chatId,text},token());
   if(!Number.isSafeInteger(result?.message_id)||result.message_id<1)throw Error('Telegram returned no message ID');
   update(id,'accepted','Telegram accepted the message; recipient delivery is not independently verified.',chatId,title,String(result.message_id));
   try{AUD.log('owner','telegram.accepted',`Telegram accepted a channel post: ${title}`)}catch{};
 } catch(e) {
   update(id,'uncertain','Telegram send outcome is unknown. Check the channel before starting another send.',chatId,title);
   try{AUD.log('owner','telegram.uncertain','Telegram send outcome requires review')}catch{};
 }
 return {record:row(id)};
}
module.exports={configured,status,recent,publish,_setTransportForTests};
