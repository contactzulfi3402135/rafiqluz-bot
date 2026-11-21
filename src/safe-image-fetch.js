'use strict';
// Fetch user-supplied images without allowing redirects or DNS rebinding to
// reach private services. The checked address is pinned into the connection.
const dns = require('node:dns').promises;
const net = require('node:net');
const http = require('node:http');
const https = require('node:https');
const blocked = new net.BlockList();
for (const [netw,bits] of [
  ['0.0.0.0',8],['10.0.0.0',8],['100.64.0.0',10],['127.0.0.0',8],['169.254.0.0',16],
  ['172.16.0.0',12],['192.0.0.0',24],['192.0.2.0',24],['192.168.0.0',16],
  ['198.18.0.0',15],['198.51.100.0',24],['203.0.113.0',24],['224.0.0.0',4],['240.0.0.0',4]
]) blocked.addSubnet(netw,bits,'ipv4');
for (const [netw,bits] of [
  ['::',128],['::1',128],['64:ff9b::',96],['64:ff9b:1::',48],['100::',64],['2001::',32],
  ['2001:10::',28],['2001:db8::',32],['2002::',16],['fc00::',7],['fe80::',10],['ff00::',8]
]) blocked.addSubnet(netw,bits,'ipv6');
function publicAddress(address) {
  const family=net.isIP(address);
  return !!family && !blocked.check(address,family===4?'ipv4':'ipv6');
}
function abortable(promise, signal) {
  if (signal.aborted) return Promise.reject(new Error('Image request timed out.'));
  return new Promise((resolve,reject)=>{
    const stop=()=>reject(new Error('Image request timed out.'));
    signal.addEventListener('abort',stop,{once:true});
    promise.then(v=>{signal.removeEventListener('abort',stop);resolve(v)},e=>{signal.removeEventListener('abort',stop);reject(e)});
  });
}
async function fetchImage(input, options={}) {
  const maxBytes=5*1024*1024, controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),options.timeoutMs || 20000);
  const lookup=options.lookup || ((host)=>dns.lookup(host,{all:true,verbatim:true}));
  const request=options.request || ((url,opts,cb)=>(url.protocol==='https:'?https:http).request(url,opts,cb));
  let url;
  try {
    try { url=new URL(input); } catch { throw new Error('Image URL must be a valid HTTP or HTTPS URL.'); }
    for (let redirects=0; redirects<=3; redirects++) {
      if (!['http:','https:'].includes(url.protocol) || url.username || url.password || !url.hostname) throw new Error('Image URL must be HTTP or HTTPS without credentials.');
      const host=url.hostname.replace(/^\[|\]$/g,'');
      let addresses;
      if (net.isIP(host)) addresses=[{address:host,family:net.isIP(host)}];
      else {
        try { addresses=await abortable(lookup(host),controller.signal); }
        catch(e) { if (controller.signal.aborted) throw e; throw new Error('Image host could not be resolved.'); }
      }
      if (!Array.isArray(addresses) || !addresses.length || addresses.some(x=>!publicAddress(x.address))) throw new Error('Image URL resolves to a private or restricted network address.');
      const chosen=addresses[0];
      const result=await new Promise((resolve,reject)=>{
        let req;
        try {
          req=request(url,{
            signal:controller.signal, family:chosen.family, autoSelectFamily:false,
            headers:{accept:'image/*'},
            lookup:(_hostname,_opts,cb)=>cb(null,chosen.address,chosen.family),
          },res=>{
            const status=res.statusCode || 0;
            if ([301,302,303,307,308].includes(status)) {
              const location=res.headers.location;res.resume();
              if (!location) return reject(new Error('Image redirect has no destination.'));
              return resolve({redirect:location});
            }
            if (status<200 || status>=300) { res.resume();return reject(new Error(`Image could not be fetched (HTTP ${status}).`)); }
            const mime=String(res.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
            if (!mime.startsWith('image/')) { res.resume();return reject(new Error('That URL is not an image.')); }
            const declared=Number(res.headers['content-length']);
            if (Number.isFinite(declared) && declared>maxBytes) { res.destroy();return reject(new Error('Image is larger than 5 MB.')); }
            const parts=[];let n=0;
            res.on('data',chunk=>{ n+=chunk.length; if(n>maxBytes){res.destroy();reject(new Error('Image is larger than 5 MB.'));}else parts.push(chunk); });
            res.on('end',()=>n?resolve({buffer:Buffer.concat(parts,n),mime}):reject(new Error('The image is empty.')));
            res.on('error',()=>reject(new Error('Could not read the image response.')));
            res.on('aborted',()=>reject(new Error('Image download was interrupted.')));
          });
          req.on('error',e=>reject(new Error(controller.signal.aborted?'Image request timed out.':'Could not fetch the image: '+e.message)));
          req.end();
        } catch(e) { reject(e); }
      });
      if (!result.redirect) return result;
      if (redirects===3) throw new Error('Image redirected too many times.');
      try { url=new URL(result.redirect,url); } catch { throw new Error('Invalid image redirect.'); }
    }
  } finally { clearTimeout(timer); }
  throw new Error('Image could not be fetched.');
}
module.exports={fetchImage,publicAddress};
