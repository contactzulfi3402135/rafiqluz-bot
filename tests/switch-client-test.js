'use strict';
// Exercise the real switch renderer/handler with a small fake DOM and mocked API.
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert');
const source=fs.readFileSync(require.resolve('../src/web/assets/app.js'),'utf8');
const first=source.indexOf('const SWITCHES = {'),last=source.indexOf('/* ── 5A (R39)',first);
assert.ok(first>=0&&last>first);const code=source.slice(first,last);
class Box {
  constructor(){this.inputs=[];this.hidden=false;this.html='';}
  set innerHTML(s){this.html=s;this.inputs=[];for(const m of s.matchAll(/<input type="checkbox" data-key="([^"]+)"([^>]*)>/g)){this.inputs.push({dataset:{key:m[1]},checked:/\bchecked\b/.test(m[2]),disabled:false,indeterminate:false,addEventListener(type,fn){this.handler=fn}});}}
  get innerHTML(){return this.html;}
}
const boxes=new Map();const notes=[];let handler;
const context={console,$:selector=>{if(!boxes.has(selector))boxes.set(selector,new Box());return boxes.get(selector)},$$:(selector,box)=>selector==='input[data-key]'?box.inputs:[],api:(...a)=>handler(...a),toast:(...a)=>notes.push(a),show:()=>{},esc:s=>String(s)};
vm.runInNewContext(code,context);
const all=vm.runInNewContext('Object.keys(SWITCHES)',context);const state=Object.fromEntries(all.map(k=>[k,false]));
function paint(s){context.payload={switches:{...s}};vm.runInNewContext('__powerCache=payload;paintSwitches(payload)',context);}
function control(key){for(const b of boxes.values()){const found=b.inputs.find(i=>i.dataset.key===key);if(found)return found;}throw Error('No switch '+key);}
let n=0;function ok(x,label){assert.ok(x,label);n++;console.log('✓ '+label)}
(async()=>{
 paint(state);
 handler=async(url,options)=>{assert.equal(url,'/api/power/toggle');return {switches:{...state,[options.body.key]:options.body.on}}};
 let c=control('scheduler');c.checked=true;await c.handler({target:c});
 ok(c.checked===true&&!c.disabled,'successful change shows confirmed state');
 ok(vm.runInNewContext('__powerCache.switches.scheduler',context)===true,'successful change updates cached switch state');
 ok(boxes.get('#homeSwitchChips').innerHTML.includes('Scheduler</span><span class="rosw-state">On'),'successful change updates read-only chips');
 vm.runInNewContext('paintSwitches(__powerCache)',context);ok(control('scheduler').checked===true,'repainting does not restore stale pre-toggle state');
 handler=async(url)=>{if(url==='/api/power/toggle')throw Error('connection lost');return {switches:{...state,scheduler:true}}};
 c=control('scheduler');c.checked=false;await c.handler({target:c});ok(control('scheduler').checked===true&&!control('scheduler').disabled,'lost response reloads actual server state rather than guessing');
 handler=async()=>{throw Error('offline')};c=control('scheduler');c.checked=false;await c.handler({target:c});
 ok(c.disabled&&c.indeterminate&&/unknown/i.test(notes.at(-1)[0]),'offline unknown outcome remains visibly indeterminate and cannot be changed until refreshed');
 console.log('PASS: '+n+' switch client checks');
})().catch(e=>{console.error(e);process.exitCode=1});
