'use strict';
/**
 * v6.0.0 — scheduler engine + analytics. Switches live in pipeline.js
 * (power.*.on, ALL OFF by default). The scheduler publishes queued posts at
 * their time — once / daily / weekly, drift-free; a missed time publishes on
 * the next tick after the bot returns.
 */
const { ring } = require('./logger');
const { S, A } = require('./db');
const pipeline = require('./pipeline');
const publishMod = require('./publish');

const jobs = () => { try { return JSON.parse(S.get('power.scheduler.jobs', '[]')); } catch { return []; } };
const saveJobs = (j) => S.set('power.scheduler.jobs', JSON.stringify(j.slice(0, 200)));

/* 5A (R45): timezone helpers — schedule times are entered as wall-clock in the
   owner's timezone (default Asia/Karachi) and stored as UTC ISO. */
const DEFAULT_TZ = 'Asia/Karachi';
function tzOffset(ts, tz) {
  try {
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).formatToParts(new Date(ts)).map((x) => [x.type, x.value]));
    const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour === 24 ? 0 : +p.hour, +p.minute, +p.second);
    return asUtc - Math.round(ts);
  } catch { return 0; }
}
function wallParts(iso, tz) {
  try {
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date(iso)).map((x) => [x.type, x.value]));
    return { y: +p.year, mo: +p.month, d: +p.day, hm: `${p.hour === '24' ? '00' : p.hour}:${p.minute}` };
  } catch { return null; }
}
/** Wall-clock → UTC. Reject invalid dates, zones and DST gaps; when clocks
 * repeat, select the earlier occurrence deterministically. */
function localToUtc(localStr, tz = DEFAULT_TZ) {
  const m=/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(String(localStr));
  if(!m) throw new Error('Enter a valid local date and time.');
  const [y,mo,da,h,mi]=m.slice(1).map(Number);
  const base=Date.UTC(y,mo-1,da,h,mi); const check=new Date(base);
  if(y<1970 || y>9999 || check.getUTCFullYear()!==y || check.getUTCMonth()+1!==mo || check.getUTCDate()!==da || h>23 || mi>59) throw new Error('Enter a valid local date and time.');
  try {new Intl.DateTimeFormat('en-GB',{timeZone:tz}).format(check);} catch {throw new Error('Invalid time zone.');}
  const offsets=new Set();for(let delta=-36;delta<=36;delta+=6)offsets.add(tzOffset(base+delta*3600e3,tz));
  const candidates=[...offsets].map(off=>base-off).filter(ts=>{const p=wallParts(new Date(ts).toISOString(),tz);return p && p.y===y && p.mo===mo && p.d===da && p.hm===`${m[4]}:${m[5]}`;}).sort((x,z)=>x-z);
  if(!candidates.length)throw new Error('That local time does not exist because the clock changes. Choose another time.');
  return new Date(candidates[0]).toISOString();
}

function addJob({ jid, name, text, at, repeat = 'once', weekdays = '', intervalMin = 0, tz = DEFAULT_TZ, templateId = '', localAt = '' }) {
  if (!jid || !String(text || '').trim()) throw new Error('Target and text are required.');
  if (String(text).length>4096) throw new Error('Scheduled text must be 4,096 characters or less.');
  let atIso = String(at || '');
  if (localAt && !/Z$/.test(atIso)) atIso = localToUtc(localAt, tz || DEFAULT_TZ);
  if (!atIso) throw new Error('Target, text and time are required.');
  if (!/(?:Z|[+-]\d{2}:\d{2})$/i.test(atIso) || !Number.isFinite(Date.parse(atIso))) throw new Error('Enter a valid time with a timezone.');
  atIso=new Date(atIso).toISOString();
  try {new Intl.DateTimeFormat('en-GB',{timeZone:tz||DEFAULT_TZ}).format(new Date());} catch {throw new Error('Invalid time zone.');}
  const rep = ['once', 'daily', 'weekly', 'weekdays', 'interval'].includes(repeat) ? repeat : 'once';
  const job = {
    id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    jid, name: String(name || '').slice(0, 80), text: String(text).slice(0, 4096),
    at: atIso, repeat: rep,
    weekdays: rep === 'weekdays' ? String(weekdays || '1,2,3,4,5').slice(0, 20) : '',
    intervalMin: rep === 'interval' ? Math.max(1, Math.min(10080, parseInt(intervalMin, 10) || 30)) : 0,
    tz: String(tz || DEFAULT_TZ).slice(0, 40), templateId: String(templateId || '').slice(0, 120),
    enabled: true, sent: 0, lastRun: null
  };
  const list = jobs(); if(list.length>=200)throw new Error('The schedule limit of 200 has been reached; remove an old schedule first.'); list.push(job); saveJobs(list);
  return job;
}
function removeJob(id) { saveJobs(jobs().filter((j) => j.id !== id)); }
function setJobEnabled(id, v) { const l = jobs(); const j = l.find((x) => x.id === id); if (j) j.enabled = Boolean(v); saveJobs(l); }

/** Advance a job's next run time (drift-free). */
function advance(job) {
  const t = new Date(job.at);
  if (job.repeat === 'once') return null;
  if (job.repeat === 'interval') { const step = Math.max(60e3, (job.intervalMin || 30) * 60e3); const start=t.getTime();if(!Number.isFinite(start))return null; const count=Math.max(1,Math.floor((Date.now()-start)/step)+1);return new Date(start+count*step).toISOString(); }
  if (['daily','weekly','weekdays'].includes(job.repeat)) {
    const tz = job.tz || DEFAULT_TZ;
    const original = wallParts(job.at,tz), today = wallParts(new Date(Date.now()).toISOString(),tz);
    if (!original || !today) return null;
    const originalDay = Date.UTC(original.y,original.mo-1,original.d);
    const todayDay = Date.UTC(today.y,today.mo-1,today.d);
    const weekdays = String(job.weekdays || '1,2,3,4,5').split(',').map(Number).filter(w=>w>=1&&w<=7);
    if (job.repeat === 'weekdays' && !weekdays.length) return null;
    // Search from today in local calendar days, preserving the original wall time.
    for (let i=0;i<=16;i++) {
      const day = todayDay + i*86400e3, date = new Date(day);
      const offset = Math.round((day-originalDay)/86400e3);
      if (offset < 0) continue;
      if (job.repeat === 'weekly' && offset%7!==0) continue;
      const wd=(date.getUTCDay()+6)%7+1;
      if (job.repeat === 'weekdays' && !weekdays.includes(wd)) continue;
      const local=`${date.getUTCFullYear()}-${String(date.getUTCMonth()+1).padStart(2,'0')}-${String(date.getUTCDate()).padStart(2,'0')}T${original.hm}`;
      let candidate;try{candidate=localToUtc(local,tz);}catch{continue;}
      if (Date.parse(candidate)>Date.now() && Date.parse(candidate)>Date.parse(job.at)) return candidate;
    }
    return null;
  }
  return null;
}

/* 5A (R45): month calendar — expand every job into the days it runs on. */
function calendar(monthStr) {
  const [y, mo] = String(monthStr || '').split('-').map(Number);
  const now = new Date();
  const yy = y || now.getFullYear();
  const mm = mo || now.getMonth() + 1;
  const dim = new Date(Date.UTC(yy, mm, 0)).getUTCDate();
  const days = {};
  const boundsCache=new Map();
  const dayBoundary=(day,tz)=>{
    const cacheKey=day+'|'+tz;if(boundsCache.has(cacheKey))return boundsCache.get(cacheKey);
    let value=null;
    // Midnight can be skipped by a timezone transition. Find the first valid
    // minute of the same day; a wholly skipped civil date has no boundary.
    for(let minute=0;minute<1440;minute++){const date=new Date(day+minute*60000);const local=date.toISOString().slice(0,16);try{value=Date.parse(localToUtc(local,tz));break}catch(e){if(!/does not exist/.test(e.message))break;}}
    boundsCache.set(cacheKey,value);return value;
  };
  for (let d = 1; d <= dim; d++) {
    const key = `${yy}-${String(mm).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const dayStart = Date.UTC(yy, mm - 1, d);
    const dayEnd = Date.UTC(yy, mm - 1, d + 1) - 1;
    const list = [];
    for (const job of jobs()) {
      if (!job.enabled) continue;
      const start = Date.parse(job.at);
      if (!Number.isFinite(start)) continue;
      let runs = false;
      const dayIsoWd = (new Date(dayStart).getUTCDay() + 6) % 7 + 1; // weekday of this calendar day (tz-independent)
      const localStart=wallParts(job.at,job.tz || DEFAULT_TZ);
      const startDay=localStart ? Date.UTC(localStart.y,localStart.mo-1,localStart.d) : Infinity;
      if (job.repeat === 'once') runs = startDay === dayStart;
      else if (job.repeat === 'daily') runs = startDay <= dayStart;
      else if (job.repeat === 'weekly') {
        const ap = wallParts(job.at, job.tz || DEFAULT_TZ);
        runs = Boolean(ap) && (new Date(Date.UTC(ap.y, ap.mo - 1, ap.d)).getUTCDay() + 6) % 7 + 1 === dayIsoWd && startDay <= dayStart;
      }
      else if (job.repeat === 'weekdays') {
        const wdays = String(job.weekdays || '1,2,3,4,5').split(',').map((w) => parseInt(w, 10)).filter((w) => w >= 1 && w <= 7);
        runs = startDay <= dayStart && wdays.includes(dayIsoWd);
      } else if (job.repeat === 'interval') {
        const step = Math.max(60e3, (job.intervalMin || 30) * 60e3),tz=job.tz||DEFAULT_TZ;
        const low=dayBoundary(dayStart,tz); let high=dayBoundary(dayStart+86400e3,tz);
        // If the next civil date is skipped, the following boundary still ends
        // the current date (rare historical timezone changes).
        if(high===null)high=dayBoundary(dayStart+2*86400e3,tz);
        if(low!==null && high!==null && high>low){let t=start;if(t<low)t+=Math.ceil((low-t)/step)*step;runs=t<high;}
      }
      if (runs) list.push({ id: job.id, name: job.name, time: wallParts(job.at, job.tz || DEFAULT_TZ)?.hm || '', repeat: job.repeat });
    }
    if (list.length) days[key] = list;
  }
  return { month: `${yy}-${String(mm).padStart(2, '0')}`, days };
}

let ticking = false;
async function tick() {
  if (ticking || require('./lifecycle').isStopping() || !pipeline.switches().scheduler || require('./panic').active()) return;
  ticking = true;
  try {
    for (const job of jobs()) {
      try {
        if (require('./lifecycle').isStopping() || require('./panic').active()) break;
        if (!job.enabled || !Number.isFinite(Date.parse(job.at)) || Date.parse(job.at) > Date.now()) continue;
        const latest=jobs().find(x=>x.id===job.id);
        if(!latest || !latest.enabled || latest.at!==job.at || latest.jid!==job.jid || latest.text!==job.text || latest.templateId!==job.templateId)continue;
        let text = job.text;
        if (job.templateId) { try { text = String(require('./templates').apply(job.text, {}).text || job.text); } catch {} }
        const runId = `${job.id}:${job.at}`;
        const res = await publishMod.publish({text}, {only:[job.jid], sourceJid:'scheduler@bot', sourceMsgId:runId});
        // Re-read before saving so changes made through the UI while the send was
        // in flight are not overwritten. The same occurrence has one journal key.
        const list = jobs(); const current = list.find(x => x.id === job.id);
        if (!current || current.at !== job.at) continue;
        current.lastRun = new Date().toISOString();
        current.lastError = (res.errors || []).join(' | ').slice(0,300);
        if (res.complete) {
          current.sent = (Number(current.sent) || 0) + 1;
          const next = advance(job);
          if (!next) { current.enabled = false; current.done = true; } else current.at = next;
        }
        saveJobs(list);
      } catch (err) { ring.warn('scheduler.fail', `Scheduled post requires attention: ${err.message}`); }
    }
  } finally { ticking = false; }
}

function start() { setInterval(() => tick().catch(() => { }), 30000).unref?.(); }

/* ---------------- analytics ---------------- */
function analytics(days = 14) {
  const out = { totals: { published: 0, skipped: 0, failed: 0, edited: 0 }, days: [], sources: [] };
  for (const r of A.since(new Date(Date.now() - days * 86400e3).toISOString().slice(0, 19).replace('T', ' '))) {
    out.totals[r.status] = (out.totals[r.status] || 0) + r.n;
  }
  for (let d = days - 1; d >= 0; d--) {
    const day = new Date(Date.now() - d * 86400e3).toISOString().slice(0, 10);
    const rows = Object.fromEntries(A.day(day).map((r) => [r.status, r.n]));
    out.days.push({ day, published: rows.published || 0, skipped: rows.skipped || 0, failed: rows.failed || 0 });
  }
  for (const r of A.perSource(new Date(Date.now() - days * 86400e3).toISOString().slice(0, 19).replace('T', ' '))) {
    out.sources.push({ jid: r.source_jid, n: r.n });
  }
  return out;
}

module.exports = { addJob, removeJob, setJobEnabled, jobs, start, tick, analytics, calendar, advance, localToUtc, resave: saveJobs, DEFAULT_TZ };
