'use strict';
// Exercise real source pagination/search code with synthetic rows and a fake DOM.
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert');
const code=fs.readFileSync(require.resolve('../src/web/assets/app.js'),'utf8');
const first=code.indexOf('const sourcePage = {'),last=code.indexOf('loaders.sources = async',first);assert.ok(first>=0&&last>first);
class Element{constructor(){this.value='';this.disabled=false;this.hidden=false;this.textContent='';this.innerHTML='';this.listeners={}}addEventListener(k,f){this.listeners[k]=f}fire(k){return this.listeners[k]()}}
const nodes=Object.fromEntries(['#srcSearch','#srcPrev','#srcNext','#srcPageInfo','#srcTable tbody','#srcScaleNotice'].map(k=>[k,new Element()]));let draws=[];
const context={console,$:selector=>nodes[selector],channelRows:(rows)=>{draws.push(rows);return rows.map(x=>`<tr>${x.name}</tr>`).join('')},paintSubs:async()=>{}};
vm.runInNewContext(code.slice(first,last)+'\nthis.getPage=()=>sourcePage',context);
let n=0;const ok=(v,s)=>{assert.ok(v,s);n++;console.log('✓ '+s)};
const rows=Array.from({length:7100},(_,i)=>({jid:'s'+String(i).padStart(4,'0')+'@newsletter',name:'Source '+String(i).padStart(4,'0'),paused:0,kind:'wa'}));
context.sourcePageSet(rows);ok(draws.at(-1).length===50&&nodes['#srcPageInfo'].textContent==='Showing 1–50 of 7100 sources'&&nodes['#srcPrev'].disabled,'7,100 sources render a 50-row first page');
ok(!nodes['#srcScaleNotice'].hidden&&/237 minutes/.test(nodes['#srcScaleNotice'].textContent)&&/can be missed/.test(nodes['#srcScaleNotice'].textContent),'large-source warning describes minimum polling time and incompleteness');
nodes['#srcNext'].fire('click');ok(draws.at(-1).length===50&&nodes['#srcPageInfo'].textContent==='Showing 51–100 of 7100 sources','next page works');
nodes['#srcSearch'].value='Source 7099';nodes['#srcSearch'].fire('input');ok(draws.at(-1).length===1&&draws.at(-1)[0].jid==='s7099@newsletter'&&nodes['#srcNext'].disabled,'search reaches last row across all pages');
nodes['#srcSearch'].value='S0003@NEWSLETTER';nodes['#srcSearch'].fire('input');ok(draws.at(-1)[0].jid==='s0003@newsletter','channel ID search is case insensitive');
nodes['#srcSearch'].value='not found';nodes['#srcSearch'].fire('input');ok(/No matching sources/.test(nodes['#srcTable tbody'].innerHTML),'no matches are identified honestly');
nodes['#srcSearch'].value='';nodes['#srcSearch'].fire('input');context.sourcePageSet([]);ok(/No sources yet/.test(nodes['#srcTable tbody'].innerHTML)&&nodes['#srcScaleNotice'].hidden,'fresh empty list gives actionable guidance without a large-source warning');
console.log('PASS: '+n+' source pagination client checks');
