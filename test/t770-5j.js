'use strict';
/*
 * 5J (J1–J10) — unit tests:
 *  1. J1 Pipeline Inspector — inspectText purity (no state change, no publish),
 *     stage order, changed flags, gates, split, routing
 *  2. J1 counters — today's (PKT) tallies + rate guard now
 *  3. J7 AI safety screen — switch default OFF, criteria persist, fail-open skip logic
 *  4. J6 calendar data — published/edited, drafts, plan, 5A jobs, 5F personal sends, evergreen
 *  5. J8 pacing — 24-hour buckets vs cap
 *  6. J4 Branding — normalize/brandColors + SVG/PNG render with saved brand
 *  7. J2/J5/J10 — UI persistence keys round-trip through settings (validated, safe)
 */
const fs = require('fs');
const path = require('path');

process.env.DATABASE_PATH = 'data/t770-test/bot.sqlite';
process.env.SESSION_DIR = 'data/t770-test/sessions';
const DBFILE = path.resolve(__dirname, '..', 'data', 't770-test', 'bot.sqlite');
fs.rmSync(path.dirname(DBFILE), { recursive: true, force: true });
fs.mkdirSync(path.dirname(DBFILE), { recursive: true });

let passed = 0, failed = 0;
let __apiRouter = null; // 5J: cached api router for route-level assertions
const ok = (cond, label) => { if (cond) { passed += 1; console.log('  ok  ' + label); } else { failed += 1; console.error('  FAIL ' + label); } };

/* ---------- clean module load with the temp DB ---------- */
for (const k of Object.keys(require.cache)) if (k.includes('/src/')) delete require.cache[k];
const { S, CH, P, WAS, AUD } = require('../src/db');
const pipeline = require('../src/pipeline');
const templates = require('../src/templates');
const cardgen = require('../src/cardgen');

/* ================= J1 · Pipeline Inspector ================= */
console.log('\n[J1] Pipeline Inspector');
S.set('power.linktools.on', '1');           // linktools ON → a stage that actually changes text
S.set('power.hashtags.on', '1');
S.set('blocklist.words', 'lottery');
const beforePosts = S.get('posts.count', '');
const insp = pipeline.inspectText('Big jobs update in Lahore https://x.co/a?utm_source=tw&fbclid=xyz', { sourceJid: '' });
ok(Array.isArray(insp.stages) && insp.stages.length >= 6, 'inspectText returns a stage list');
const names = insp.stages.map((s) => s.name);
ok(names.indexOf('Hashtags') < names.indexOf('Auto header') && names.indexOf('Auto header') < names.indexOf('Link tools (tracking cleanup)'), 'stages run in the pipeline order (hashtags → header → link tools)');
const ht = insp.stages.find((s) => s.name === 'Hashtags');
ok(ht.changed && ht.after.includes('#jobs') && ht.after.includes('#lahore'), 'hashtags stage marks changed=true and appends the tags');
const lk = insp.stages.find((s) => s.name === 'Link tools (tracking cleanup)');
ok(lk.changed && !lk.after.includes('utm_source') && !lk.after.includes('fbclid') && lk.after.includes('https://x.co/a'), 'link tools stage strips tracking params in the dry-run');
ok(!insp.finalText.includes('utm_') && !insp.finalText.includes('fbclid'), 'finalText is clean of tracking params');
ok(insp.gates.some((g) => g.name === 'Global blocklist' && g.fired === false), 'blocklist gate reports (no hit)');
ok(insp.gates.some((g) => g.name === 'Rate guard'), 'rate guard gate is reported');
ok(insp.partCount === 1 && insp.targetCount === 0, 'single part, no active targets → 0 targets');
ok(String(S.get('posts.count', '')) === beforePosts, 'inspectText has NO side effects on the DB');
/* rotate dry-run must not advance the persisted index */
templates.saveInfo({ mode: 'rotate', pick: 'Plain', pool: [] });
const rotIdx = S.get('tpl.rotate.idx', '0');
pipeline.inspectText('Rotate me please, a long enough line', { sourceJid: '' });
pipeline.inspectText('Rotate me again', { sourceJid: '' });
ok(S.get('tpl.rotate.idx', '0') === rotIdx, 'dry-run does NOT advance the rotate index (no state change)');
templates.saveInfo({ mode: 'off' });
/* blocklist gate fires */
const insp2 = pipeline.inspectText('Join the lottery tonight', { sourceJid: '' });
ok(insp2.gates.find((g) => g.name === 'Global blocklist').fired === true, 'blocklist gate FIRES for a blocked word');
/* split: >4096 chars → 2 parts */
const big = 'X'.repeat(4200);
const insp3 = pipeline.inspectText(big, { sourceJid: '' });
ok(insp3.partCount === 2 && insp3.partSizes.every((n) => n <= 4096), 'long text splits into ≤4096 parts');
/* source gates: hours window + keywords + daily cap */
S.set('power.dedupe.on', '0');
const SRCJ = '1203630000000009999@newsletter';
CH.addSource(SRCJ, 'Gate Source', 'test');
const SR = require('../src/db').SR;
SR.save(SRCJ, { include: 'jobs' });
const insp4 = pipeline.inspectText('Nothing relevant here', { sourceJid: SRCJ });
ok(insp4.gates.find((g) => g.name === 'Keyword include').fired === true, 'source keyword-include gate fires when the word is missing');
const insp5 = pipeline.inspectText('Jobs alert inside', { sourceJid: SRCJ });
ok(insp5.gates.find((g) => g.name === 'Keyword include').fired === false, 'keyword-include gate passes when the word is present');
SR.save(SRCJ, { max_per_day: 1 });
const d1 = require('../src/db').open().prepare("INSERT OR IGNORE INTO posts(source_jid, source_msg_id, status, created_at) VALUES(?,?, 'published', datetime('now'))").run(SRCJ, 'c1');
const insp6 = pipeline.inspectText('Jobs alert again', { sourceJid: SRCJ });
ok(insp6.gates.find((g) => g.name === 'Daily cap (source rule)').fired === true, 'daily cap gate fires when the source is at its cap');

console.log('\n[J1] counters');
const c0 = pipeline.counters();
ok(typeof c0.published === 'number' && typeof c0.cap === 'number' && c0.cap >= 3, 'counters returns today tallies + cap');
ok(Array.isArray(c0.byTarget), 'counters.byTarget is a list');

/* ================= J7 · AI safety screen ================= */
console.log('\n[J7] AI safety screen');
ok(pipeline.SWITCH_DEFAULTS.aisafety === false, 'aisafety is OFF by default (R8)');
ok(pipeline.switches().aisafety === false, 'aisafety reports off until enabled');
pipeline.setSwitch('aisafety', true);
ok(pipeline.switches().aisafety === true, 'aisafety toggles via the standard power API');
S.set('power.aisafety.criteria', 'must be safe and legal');
ok(S.get('power.aisafety.criteria') === 'must be safe and legal', 'safety criteria persist');
pipeline.setSwitch('aisafety', false);

/* ================= J6 · calendar data (route-level, via server build) ================= */
console.log('\n[J6] calendar aggregation');
const d = require('../src/db').open();
/* published post today (PKT) + one 3 days ago */
d.prepare("INSERT OR REPLACE INTO posts(id, source_jid, source_msg_id, status, body, created_at) VALUES(901, 'src@x', 'm901', 'published', 'Pub post body line one', datetime('now'))").run();
d.prepare("INSERT OR REPLACE INTO posts(id, source_jid, source_msg_id, status, body, created_at) VALUES(902, 'src@x', 'm902', 'published', 'Old pub post body', datetime('now','-3 days'))").run();
/* draft (pending approval) + plan draft */
d.prepare("INSERT OR REPLACE INTO approvals(id, source_jid, source_msg_id, text, status, created_at) VALUES(910, 'src@x', 'm910', 'Draft text body line', 'pending', datetime('now'))").run();
d.prepare("INSERT OR REPLACE INTO approvals(id, source_jid, source_msg_id, text, status, created_at) VALUES(911, 'plan@bot', 'plan-1-2', 'Plan item text body', 'pending', datetime('now'))").run();
/* 5A scheduler job (settings) for today + a disabled one that must NOT appear */
S.set('power.scheduler.jobs', JSON.stringify([
  { id: 'j1', jid: SRCJ, name: 'J', text: 'Scheduled post text', at: new Date().toISOString(), repeat: 'once', enabled: true },
  { id: 'j2', jid: SRCJ, name: 'J2', text: 'Disabled job text', at: new Date().toISOString(), repeat: 'once', enabled: false }
]));
/* 5F personal send today */
const wk = new Date(Date.now() + 5 * 3600e3).toISOString().slice(0, 10);
WAS.add({ session: 'main', jid: '92300xxxxxxx@s.whatsapp.net', text: 'Personal message text', at: wk + 'T18:30:00', repeat: 'once', enabled: true });
/* evergreen recycle today */
d.prepare("INSERT OR REPLACE INTO evergreen_log(id, post_id, body, recycled_at) VALUES(920, 901, 'Evergreen recycled body', datetime('now'))").run();

/* exercise the route handler directly through a minimal request object */
const ym = new Date(Date.now() + 5 * 3600e3).toISOString().slice(0, 7);
let calBody = null;
const calHandler = routeOf('GET', '/api/calendar');
calHandler({ query: { ym } }, { status: (c) => ({ json: (b) => { calBody = b; } }), json: (b) => { calBody = b; } });
ok(calBody && calBody.ok === true, 'calendar route answers ok');
const kinds = new Set(calBody.items.map((i) => i.kind));
ok(kinds.has('published'), 'calendar merges published posts');
ok(kinds.has('draft'), 'calendar merges drafts (pending approvals)');
ok(kinds.has('plan'), 'calendar merges weekly-plan items (plan@bot)');
ok(kinds.has('scheduled'), 'calendar merges scheduled sends (5A jobs + 5F personal)');
ok(kinds.has('evergreen'), 'calendar merges evergreen recycles');
ok(!calBody.items.some((i) => i.title.includes('Disabled job')), 'disabled scheduler jobs are excluded');
ok(calBody.items.every((i) => i.date.slice(0, 7) === ym), 'every item is dated inside the requested month (PKT)');
ok(calBody.items.length === calBody.count, 'count matches the item list');
/* other month → no items from today */
const otherYm = ym === '2026-01' ? '2026-02' : ym === '2026-02' ? '2026-01' : '2026-01';
let calBody2 = null;
calHandler({ query: { ym: otherYm } }, { status: (c) => ({ json: (b) => { calBody2 = b; } }), json: (b) => { calBody2 = b; } });
ok(calBody2.items.length === 0, 'a different month returns no same-day items');

/* ================= J8 · pacing ================= */
console.log('\n[J8] pacing');
let paceBody = null;
routeOf('GET', '/api/pacing')({}, { status: (c) => ({ json: (b) => { paceBody = b; } }), json: (b) => { paceBody = b; } });
ok(Array.isArray(paceBody.perHour) && paceBody.perHour.length === 24, 'pacing returns 24 hourly buckets');
ok(paceBody.perHour.reduce((a, b) => a + b, 0) >= 2, 'pacing counts the two published posts (today)');
ok(paceBody.cap >= 3 && typeof paceBody.lastHour === 'number', 'pacing carries the cap + last-hour usage');

/* ================= J4 · Branding ================= */
console.log('\n[J4] Branding');
const bad = cardgen.normalizeBrand({ accent: 'nothex', bg: '#0B1220', panel: '#xyz', ink: '#E7EEF6', muted: 'x', junk: 1 });
ok(bad.accent === '#10B981' && bad.bg === '#0b1220' && bad.ink === '#e7eef6' && !('junk' in bad), 'normalizeBrand validates hex per field + drops unknown keys');
S.set('brand.accent', '#f59e0b'); S.set('brand.bg', '#17100a');
const bc = cardgen.brandColors();
ok(bc.accent === '#f59e0b' && bc.bg === '#17100a' && bc.panel === '#111b2d', 'brandColors reads saved hexes with fallbacks');
const svg = cardgen.cardSVG({ title: 'T', body: 'B', source: 'S', date: '2026-09-16', footer: 'F' });
ok(svg.includes('#f59e0b') && svg.includes('#17100a') && !svg.includes('#10B981'), 'cardSVG renders the saved brand colors');
const png = cardgen.cardForPost({ title: 'T', body: 'B', source: 'S' });
ok(png.png.length > 8000 && png.png.slice(1, 4).toString() === 'PNG', 'cardForPost still yields a valid PNG with the saved brand');
ok(png.svg.includes('#f59e0b'), 'cardForPost SVG carries the saved brand too');
for (const k of ['accent', 'bg', 'panel', 'ink', 'muted']) require('../src/db').open().prepare('DELETE FROM settings WHERE key=?').run(`brand.${k}`);
ok(cardgen.brandColors().accent === '#10B981', 'clearing brand keys falls back to defaults');

/* ================= J2/J5/J10 · UI persistence keys (server-side validation) ================= */
console.log('\n[J2/J5/J10] UI persistence');
const req = { body: { setupDone: true, kpiOrder: 'latency,wa,bogus,published', lang: 'ur' }, params: {} };
let setBody = null;
const setHandler = routeOf('POST', '/api/settings');
setHandler(req, { json: (b) => { setBody = b; } });
ok(S.get('ui.setup.done') === '1', 'setup wizard completion persists (J2)');
const order = S.get('ui.kpi.order', '');
ok(order.startsWith('latency,wa') && order.split(',').includes('published') && !order.includes('bogus'), 'KPI order persists validated + never loses a KPI (J5)');
ok(S.get('ui.lang') === 'ur', 'language choice persists (J10)');
/* unknown lang rejected */
routeOf('POST', '/api/settings')({ body: { lang: 'fr' } }, { json: () => {} });
ok(S.get('ui.lang') === 'ur', 'an unknown language is rejected');
/* GET /settings exposes them */
let getBody = null;
routeOf('GET', '/api/settings')({}, { json: (b) => { getBody = b; } });
ok(getBody.setupDone === true && getBody.kpiOrder === order && getBody.lang === 'ur', 'GET /settings round-trips the 5J UI keys');

/* ================= J9 · About data ================= */
console.log('\n[J9] About');
d.prepare("INSERT OR IGNORE INTO uptime(booted_at, source) VALUES(datetime('now'), 'test')").run();
let ovBody = null;
routeOf('GET', '/api/overview')({}, { json: (b) => { ovBody = b; } });
ok(typeof ovBody.lastBoot === 'string' && ovBody.lastBoot.length >= 10, 'overview carries the last boot for the About page');

/* ---------- helpers (hoisted above via function decls) ---------- */
function apiRouter() {
  if (__apiRouter) return __apiRouter;
  const { build } = require('../src/web/server');
  const express = require('express');
  const a = express();
  build(a);
  /* app.use('/api', api) → a non-route layer whose handle is the api router */
  const layer = a._router.stack.find((l) => !l.route && l.name === 'router' && l.handle.stack && l.handle.stack.some((x) => x.route && x.route.path === '/calendar'));
  if (!layer) throw new Error('api router layer not found in built app');
  __apiRouter = layer.handle;
  return __apiRouter;
}
/* extract a route handler from the built api router without booting HTTP */
function routeOf(method, p) {
  const r = apiRouter();
  const local = p.startsWith('/api') ? p.slice(4) : p; // the api router sees paths without the /api prefix
  const layer = r.stack.find((l) => l.route && l.route.path === local && l.route.methods[method.toLowerCase()]);
  if (!layer) throw new Error('route not found: ' + method + ' ' + p);
  const handles = layer.route.stack.map((s) => s.handle).filter(Boolean);
  return handles[handles.length - 1];
}

console.log(`\nT770-5J: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
