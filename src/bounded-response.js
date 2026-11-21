'use strict';
// Read a fetch Response without first buffering an unbounded remote body.
async function text(response,maxBytes=2*1024*1024){
  const declared=response.headers?.get?.('content-length');
  if(declared!==null&&declared!==undefined&&/^\d+$/.test(declared)&&Number(declared)>maxBytes){try{await response.body?.cancel()}catch{}throw Error('AI provider response exceeds the size limit.');}
  if(!response.body)return '';
  const reader=response.body.getReader(),parts=[];let size=0;
  try{
    for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>maxBytes){try{await reader.cancel()}catch{}throw Error('AI provider response exceeds the size limit.');}parts.push(Buffer.from(value));}
  }finally{reader.releaseLock();}
  return Buffer.concat(parts,size).toString('utf8');
}
async function json(response,maxBytes){const body=await text(response,maxBytes);try{return JSON.parse(body)}catch{throw Error('AI provider returned an invalid response.');}}
module.exports={text,json};
