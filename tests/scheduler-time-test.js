'use strict';
const fs=require('fs'),path=require('path'),os=require('os'),assert=require('assert');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'raq-clock-'));process.env.RAQ_STATE_DIR=root;require('../src/config').ensureDirs();const db=require('../src/db');db.open();const p=require('../src/power');let n=0;function ok(v,m){assert.ok(v,m);n++;console.log('✓ '+m)}
try {
 ok(p.localToUtc('2026-09-16T10:30','Asia/Karachi')==='2026-09-16T05:30:00.000Z','Pakistani wall time maps to UTC');
 for(const bad of ['2026-02-30T09:00','2026-01-01T25:00','nonsense','2026-01-01'])assert.throws(()=>p.localToUtc(bad,'Asia/Karachi'));
 ok(true,'invalid dates and wall times are rejected');assert.throws(()=>p.localToUtc('2026-03-01T12:00','No/Such_Zone'),/zone/);ok(true,'invalid timezone is rejected instead of silently treated as UTC');
 assert.throws(()=>p.localToUtc('2026-03-08T02:30','America/New_York'),/does not exist/);ok(true,'nonexistent daylight-saving wall time is rejected');
 ok(p.localToUtc('2026-11-01T01:30','America/New_York')==='2026-11-01T05:30:00.000Z','repeated daylight-saving wall time selects the earlier occurrence');
 assert.throws(()=>p.addJob({jid:'a@newsletter',text:'x',at:'tomorrow'}),/valid time/);assert.throws(()=>p.addJob({jid:'a@newsletter',text:'x'.repeat(4097),at:'2027-01-01T00:00:00Z'}),/4,096/);ok(true,'invalid UTC times and truncated scheduled text are rejected');
 const old=Date.now;Date.now=()=>Date.parse('2026-03-07T15:00:00Z');
 try{ok(p.advance({at:'2026-03-07T07:30:00.000Z',repeat:'daily',tz:'America/New_York'})==='2026-03-09T06:30:00.000Z','daily recurrence skips the daylight-saving gap');
 ok(p.advance({at:'2000-01-01T00:00:00.000Z',repeat:'interval',intervalMin:1})==='2026-03-07T15:01:00.000Z','old interval catches up in bounded time');}finally{Date.now=old;}
 const once=p.addJob({jid:'a@newsletter',text:'once',at:'2027-01-01T23:30:00.000Z',tz:'Asia/Karachi'});const daily=p.addJob({jid:'a@newsletter',text:'daily',at:'2027-01-03T00:00:00.000Z',repeat:'daily',tz:'Asia/Karachi'});
 const cal=p.calendar('2027-01').days;
 ok((cal['2027-01-02']||[]).some(x=>x.id===once.id)&&!(cal['2027-01-01']||[]).some(x=>x.id===once.id),'one-time calendar uses the job local date');
 ok(!(cal['2027-01-01']||[]).some(x=>x.id===daily.id)&&(cal['2027-01-03']||[]).some(x=>x.id===daily.id),'recurring calendar does not show runs before the first occurrence');
 console.log(`PASS: ${n} scheduler time checks`);
}finally{db.open().close();fs.rmSync(root,{recursive:true,force:true})}
