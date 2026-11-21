'use strict';
// Bounded public-only GET for feeds. Every redirect is re-resolved and the
// checked address is pinned to the TCP connection to prevent DNS rebinding.
const dns=require('node:dns').promises,net=require('node:net'),http=require('node:http'),https=require('node:https');
const {publicAddress}=require('./safe-image-fetch');
async function fetchPublic(input,opts={}) {
  const maxBytes=opts.maxBytes || 2*1024*1024, ctrl=new AbortController();
  const method=opts.method || 'GET';if (!['GET','POST'].includes(method)) throw new Error('Unsupported outbound request method.');
  const timer=setTimeout(()=>ctrl.abort(),opts.timeoutMs || 20000);
  const lookup=opts.lookup || (host=>dns.lookup(host,{all:true,verbatim:true}));
  const request=opts.request || ((url,o,cb)=>(url.protocol==='https:'?https:http).request(url,o,cb));
  const deadline=p=>new Promise((resolve,reject)=>{
    const stop=()=>reject(new Error('Feed request timed out.'));
    if(ctrl.signal.aborted) return stop();
    ctrl.signal.addEventListener('abort',stop,{once:true});
    Promise.resolve(p).then(x=>{ctrl.signal.removeEventListener('abort',stop);resolve(x)},e=>{ctrl.signal.removeEventListener('abort',stop);reject(e)});
  });
  try {
    let url;try{url=new URL(input)}catch{throw new Error('Feed URL must be a valid HTTP or HTTPS URL.')}
    for(let redirects=0;redirects<=3;redirects++) {
      if(!['http:','https:'].includes(url.protocol)||url.username||url.password||!url.hostname) throw new Error('Feed URL must be HTTP or HTTPS without credentials.');
      const host=url.hostname.replace(/^\[|\]$/g,'');let addresses;
      try { addresses=net.isIP(host)?[{address:host,family:net.isIP(host)}]:await deadline(lookup(host)); }
      catch(e){if(ctrl.signal.aborted)throw e;throw new Error('Feed host could not be resolved.')}
      if(!Array.isArray(addresses)||!addresses.length||addresses.some(x=>!publicAddress(x.address)))throw new Error('Feed URL resolves to a private or restricted network address.');
      const selected=addresses[0];
      const r=await new Promise((resolve,reject)=>{
        let req;
        try {
          req=request(url,{method,signal:ctrl.signal,family:selected.family,autoSelectFamily:false,headers:opts.headers || {accept:'application/atom+xml, application/rss+xml, application/xml, text/xml, text/plain;q=0.8, */*;q=0.1','user-agent':'RaqifluzBot-feed/1.0'},lookup:(_h,_o,cb)=>cb(null,selected.address,selected.family)},res=>{
            const status=res.statusCode||0;
            if([301,302,303,307,308].includes(status)){const to=res.headers.location;res.resume();if(method!=='GET')return reject(new Error('Webhook redirects are not followed.'));return to?resolve({redirect:to}):reject(new Error('Feed redirect has no destination.'));}
            if(status<200||status>=300){res.resume();return reject(new Error(`Feed request failed (HTTP ${status}).`));}
            const declared=Number(res.headers['content-length']);if(Number.isFinite(declared)&&declared>maxBytes){res.destroy();return reject(new Error('Feed exceeds the size limit.'));}
            let n=0;const chunks=[];
            res.on('data',b=>{n+=b.length;if(n>maxBytes){res.destroy();reject(new Error('Feed exceeds the size limit.'));}else chunks.push(b)});
            res.on('end',()=>n || opts.allowEmpty ? resolve({buffer:Buffer.concat(chunks,n),status}) : reject(new Error('Feed is empty.')));
            res.on('error',()=>reject(new Error('Feed response could not be read.')));
            res.on('aborted',()=>reject(new Error('Feed response was interrupted.')));
          });
          req.on('error',e=>reject(new Error(ctrl.signal.aborted?'Feed request timed out.':'Feed request failed: '+e.message)));req.end(opts.body);
        }catch(e){reject(e)}
      });
      if(!r.redirect)return opts.returnStatus ? {buffer:r.buffer,status:r.status} : r.buffer;
      if(redirects===3)throw new Error('Feed redirected too many times.');
      try{url=new URL(r.redirect,url)}catch{throw new Error('Feed redirect is invalid.')}
    }
    throw new Error('Feed request failed.');
  } finally {clearTimeout(timer)}
}
module.exports={fetchPublic};
