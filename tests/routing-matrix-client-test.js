'use strict';
// Exercise the real matrix renderer and click handlers with a small fake DOM.
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert');
const text=fs.readFileSync(require.resolve('../src/web/assets/app.js'),'utf8');
const first=text.indexOf('let __mtx = {'),last=text.indexOf('/* ── 5A (R45)',first);assert.ok(first>=0&&last>first);
class Node {
 constructor(){this.value='';this.disabled=false;this.textContent='';this.innerHTML='';this.listeners={};this.isConnected=true;}
 addEventListener(type,fn){this.listeners[type]=fn;}
 setAttribute(k,v){this[k]=v;}
 fire(type){return this.listeners[type]();}
}
class Grid extends Node {
 constructor(){super();this.buttons=[];}
 set innerHTML(s){for(const b of this.buttons||[])b.isConnected=false;this.html=s;this.buttons=[];for(const m of s.matchAll(/<button class="mtx-c ([^"]*)" data-s="([^"]*)" data-t="([^"]*)" data-source-label="([^"]*)" data-target-label="([^"]*)" aria-label="([^"]*)" title="([^"]*)"([^>]*)>([^<]*)<\/button>/g)){const b=new Node();b.className='mtx-c '+m[1];b.dataset={s:m[2],t:m[3],sourceLabel:m[4],targetLabel:m[5]};b['aria-label']=m[6];b.title=m[7];b.disabled=/\bdisabled\b/.test(m[8]);b.textContent=m[9];this.buttons.push(b)}}
 get innerHTML(){return this.html||'';}
}
class Box extends Node {
 constructor(){super();this.children={};}
 set innerHTML(s){this.html=s;this.children={};if(s.includes('data-matrix-grid')){for(const key of ['source','target','sprev','snext','tprev','tnext','scount','tcount'])this.children['[data-matrix-'+key+']']=new Node();this.children['[data-matrix-grid]']=new Grid();}}
 get innerHTML(){return this.html||'';}
 querySelector(s){return this.children[s]}
}
const box=new Box(),notes=[];let writes=[],fail=false,gate=null;
const sources=Array.from({length:7100},(_,i)=>({jid:'s'+i+'@newsletter',name:'Source '+i}));
const targets=Array.from({length:100},(_,i)=>({jid:'t'+i+'@newsletter',name:'Target '+i}));
const context={console,$:()=>box,$$:(s,node)=>s==='.mtx-c'?node.buttons:[],esc:s=>String(s),chanLbl:(n,j)=>n||j,toast:(...args)=>notes.push(args),api:async(url,opts)=>{if(!opts)return {sources,targets,cells:[]};writes.push(opts.body.cells[0]);if(fail)throw Error('response lost');if(gate)await gate;return {ok:true}}};
vm.runInNewContext(text.slice(first,last),context);
let n=0;function ok(v,label){assert.ok(v,label);n++;console.log('✓ '+label)}
const get=k=>box.querySelector('[data-matrix-'+k+']');const tick=()=>new Promise(r=>setImmediate(r));
(async()=>{
 await context.renderMatrix();let grid=get('grid');
 ok(grid.buttons.length===625 && get('scount').textContent==='1–25 of 7100'&&get('tcount').textContent==='1–25 of 100','7,100 × 100 matrix renders at most 625 cells with accurate counts');
 get('snext').fire('click');ok(get('scount').textContent==='26–50 of 7100'&&grid.buttons[0].dataset.s==='s25@newsletter','source paging navigates correctly');
 get('tnext').fire('click');ok(get('tcount').textContent==='26–50 of 100'&&grid.buttons[0].dataset.t==='t25@newsletter','target paging navigates correctly');
 get('source').value='Source 7099';get('source').fire('input');get('target').value='Target 99';get('target').fire('input');
 ok(grid.buttons.length===1&&grid.buttons[0].dataset.s==='s7099@newsletter'&&grid.buttons[0].dataset.t==='t99@newsletter','search finds the last source and target');
 get('source').value='missing';get('source').fire('input');ok(grid.buttons.length===0&&/No matching/.test(grid.innerHTML),'no-match search renders an honest empty state');
 get('source').value='Source 7099';get('source').fire('input');let b=grid.buttons[0];b.fire('click');await tick();
 ok(writes.at(-1).enabled===true&&b.textContent==='ON'&&!b.disabled,'default cell saves and displays confirmed on state');
 ok(b['aria-label']==='Source 7099 to Target 99: forced ON','routing cell accessible name includes source, target and state');
 await notes.at(-1)[2].fn();ok(writes.at(-1).enabled===null&&b.textContent==='·','undo restores the exact previous default rather than cycling to off');
 b.fire('click');await tick();const undo=notes.at(-1)[2].fn;get('source').value='Source 1';get('source').fire('input');const count=writes.length;await undo();ok(writes.length===count&&/view changed/i.test(notes.at(-1)[0]),'undo from a discarded page does not mutate a stale cell');
 b=grid.buttons[0];fail=true;b.fire('click');await tick();ok(b.disabled&&b.textContent==='?'&&/unknown/i.test(notes.at(-1)[0]),'lost response leaves routing state unknown rather than claiming success');
 const failedSource=b.dataset.s;get('source').value='not found';get('source').fire('input');get('source').value='Source 1';get('source').fire('input');const afterPage=grid.buttons.find(x=>x.dataset.s===failedSource);ok(afterPage&&afterPage.disabled&&afterPage.textContent==='?','unknown result stays disabled after paging or filtering');
 fail=false;get('source').value='Source 7088';get('source').fire('input');get('target').value='Target 98';get('target').fire('input');
 let release;gate=new Promise(r=>release=r);b=grid.buttons[0];b.fire('click');get('source').value='not found';get('source').fire('input');get('source').value='Source 7088';get('source').fire('input');
 const pending=grid.buttons[0];ok(pending.disabled&&pending.textContent==='…','in-flight routing cell remains disabled across filter changes');
 release();await tick();ok(!pending.disabled&&pending.textContent==='ON','confirmed response updates a newly rendered cell after filter changes');gate=null;
 console.log('PASS: '+n+' routing matrix client checks');
})().catch(e=>{console.error(e);process.exitCode=1});
