'use strict';
// Bounded GitHub response handling. Callers own timeout/abort of fetch bodies.
const fs=require('node:fs');
const META_LIMIT=2*1024*1024, ARCHIVE_LIMIT=100*1024*1024;
function checkLength(response,limit){const h=response.headers?.get?.('content-length');if(h!==null&&h!==undefined&&/^\d+$/.test(h)&&Number(h)>limit)throw Error('Cloud response exceeds the safe size limit.');}
async function read(response,limit,onChunk){
 try{checkLength(response,limit)}catch(e){try{await response.body?.cancel()}catch{}throw e}
 if(!response.body)throw Error('Cloud response is empty.');
 const reader=response.body.getReader();let n=0;
 try{for(;;){const {done,value}=await reader.read();if(done)break;n+=value.byteLength;if(n>limit)throw Error('Cloud response exceeds the safe size limit.');await onChunk(Buffer.from(value));}return n;}
 catch(e){try{await reader.cancel()}catch{}throw e;}
 finally{try{reader.releaseLock()}catch{}}
}
async function json(res){let chunks=[];const size=await read(res,META_LIMIT,chunk=>chunks.push(chunk));try{return JSON.parse(Buffer.concat(chunks,size).toString('utf8'))}catch{throw Error('Cloud metadata is invalid.');}}
async function file(res,destination){let handle;try{handle=await fs.promises.open(destination,'wx',0o600);const size=await read(res,ARCHIVE_LIMIT,async chunk=>{let off=0;while(off<chunk.length){const r=await handle.write(chunk,off,chunk.length-off);if(!r.bytesWritten)throw Error('Could not write cloud backup.');off+=r.bytesWritten;}});if(!size)throw Error('Cloud response is empty.');return size;}finally{if(handle)await handle.close();}}
module.exports={json,file,META_LIMIT,ARCHIVE_LIMIT};
