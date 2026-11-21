/* DOM TEST 7.6.1 PHASE R — the rebuilt Precision Console shell.
   Boots against the LIVE gate server (port 3131), loads /admin into jsdom,
   runs the real app.js with stubbed fetch/fixtures, and asserts:
   25 views, 8 sidebar groups, 5 bottom tabs, router, theme, palette (Ctrl+K/fuzzy/Esc),
   N2 channel-picker (names + subs, not jid boxes, chips, search, JID toggle, persisted),
   N1 add-in-place (POST /api/sources/bulk → re-render, no reload), composer preselect,
   scheduled/routing from /api/power, posts show names not jids, confirm modal names the item,
   robot chat, logs filter, settings populated, 18 switches (13 + 5 from 5A), zero emoji in shell,
   5A: approval queue + live queue tabs, source Rules cards, routing matrix, scheduler weekdays/
   interval/template refs/month calendar, undo-last control, latency KPI, 5A settings fields,
   5B: composer toolbar/preview/AI buttons/snippets+placeholders/upload/test-send/drafts,
   history retry/edit-republish/filters/reuse,
   5C: 24 switches (6 new, all OFF), per-feature AI table + usage meter, prompt library,
   glossary, KB auto-reply card (pairs/hours/allowlist), morning recap time.
   Usage: node test/domtest-761.js   Exits 0 when all pass. */
'use strict';
const { JSDOM, VirtualConsole } = require('jsdom');
const fs = require('fs');
const path = require('path');

const BASE = 'http://127.0.0.1:3131';
const appJs = fs.readFileSync(path.join(__dirname, '..', 'src', 'web', 'assets', 'app.js'), 'utf8');

const EMOJI_RE = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}]/u;

let passed = 0, failed = 0;
function ok(cond, label) {
  if (cond) { passed++; console.log('  ✓ ' + label); }
  else { failed++; console.log('  ✗ FAIL: ' + label); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------- fixtures (exact backend shapes) ---------- */
const NEWS = '1203630000000001234@newsletter';
const NEWS2 = '1203630000000005678@newsletter';
const SWITCHES = { scheduler: false, routing: false, analytics: false, editposts: false, aipilot: false, dedupe: false, beautify: true, headers: false, hashtags: false, signature: false, translate: false, digest: false, aireply: false, queue: false, crossdedupe: false, dedsplit: false, polltext: false, matrix: false };
const FIX = {
  '/api/status': { ok: true, status: 'closed', detail: 'not connected', jid: null },
  '/api/overview': { ok: true, wa: { status: 'closed', detail: 'not connected' }, sources: 1, targets: 1, today: { published: 3, skipped: 1, failed: 0 }, cloud: false, cloudStatus: { enabled: false }, mirrorPaused: false, uptime: 2, latency: { n: 5, median: 12, p95: 40 }, queue: { pending: 1, delayMin: 0 } },
  '/api/directory': { ok: true, list: [
    { jid: NEWS, name: 'Alpha News', subs: 1200, role: 'OWNER' },
    { jid: NEWS2, name: 'Beta Updates', subs: 800, role: 'ADMIN' }
  ] },
  '/api/sources': { ok: true, list: [{ jid: NEWS, name: 'Alpha News', paused: false, added_at: '2026-11-01T10:00:00Z', last_post_at: '2026-11-08T09:00:00Z', role: 'OWNER' }] },
  '/api/targets': { ok: true, list: [{ jid: NEWS2, name: 'Beta Updates', paused: false, added_at: '2026-11-01T10:00:00Z', role: 'ADMIN' }] },
  '/api/power': {
    ok: true, switches: SWITCHES,
    scheduler: [{ id: 'j1', jid: NEWS2, name: 'Weekly promo', text: 'Big promo this week', at: '2026-11-09T21:00:00.000Z', repeat: 'weekly', enabled: true, sent: 2 }],
    routing: [{ jid: NEWS2, include: 'offer', exclude: '', type: 'all' }],
    aipilot: 'only jobs and results',
    signatureText: '— via Raqifluz', headerText: '',
    template: {
      mode: 'off', pick: 'plain', custom: '', pool: [], styles: {}, history: [],
      zones: { header: '', body: '', footer: '' },
      list: [
        { id: 'clean', name: 'Clean', body: '{text}', sampleBefore: 'Raw noisy text.', sampleAfter: 'Cleaned text.', builtIn: true },
        { id: 'promo', name: 'Promo', body: 'DEAL: {text}', sampleBefore: 'Raw noisy text.', sampleAfter: 'DEAL: cleaned', builtIn: true }
      ],
      preview: { example: '…', used: 'off' }
    },
    automonitor: false
  },
  '/api/settings': { ok: true, botName: 'GateBot', reportPhone: '923001234567', reportAt: '21:00', automonitor: false, blocklist: 'winner, lottery', maxPerHour: '30', replaceRules: '', translateLang: 'en', digestAt: '22:00', headerText: '', aiPrompt: 'Keep it short.', aireplyPrompt: '', apiKey: 'abc123', queueDelayMin: '0', crossDedupeWindowMin: '30', sourceEditPolicy: 'ignore', recapAt: '08:30' },
  '/api/queue': {
    ok: true,
    pending: [{ id: 11, source_jid: NEWS, source_msg_id: 'q1', text: 'Held post — admission result is out now', media_kind: 'image', media_path: '', status: 'pending', hold_until: '', msg_ts: 0, targets: NEWS2, created_at: '2026-11-08T10:15:00Z', decided_at: '', note: '' }],
    approved: [],
    processing: 0, queued: 1,
    failed: [{ id: 7, when: '2026-11-08T08:00:00Z', source_jid: NEWS, source_msg_id: 'f1', reason: 'WhatsApp is not connected' }],
    failedGrouped: { 'WhatsApp is not connected': { n: 1, items: [{ id: 7, when: '2026-11-08T08:00:00Z', source: NEWS, reason: 'WhatsApp is not connected', snippet: 'WhatsApp is not connected' }] } },
    delayMin: 0,
    recovery: JSON.stringify({ fed: 2, recovered: 1, queued: 1, failed: 0, skipped: 0, at: '2026-11-08T09:00:00Z' }),
    latency: { n: 5, median: 12, p95: 40 }
  },
  '/api/source-rules': { ok: true, list: [{ source_jid: NEWS, approve_first: 1, active_from: '09:00', active_to: '17:00', max_per_day: 5, include: 'jobs', exclude: 'lottery', auto_pause: 1, priority: 4, name: 'Alpha News' }] },
  '/api/routing-matrix': { ok: true, sources: [{ jid: NEWS, name: 'Alpha News' }], targets: [{ jid: NEWS2, name: 'Beta Updates' }], cells: [], on: false },
  '/api/scheduler/calendar': { ok: true, month: '2026-11', days: { '2026-11-09': [{ id: 'j1', name: 'Weekly promo', time: '21:00', repeat: 'weekly' }] } },
  '/api/ai': {
    ok: true, provider: 'openrouter', model: 'openai/gpt-5.5', hasKey: true, paused: false,
    keyStatus: { openrouter: true, gemini: false },
    pauseInfo: { until: 0, label: '' },
    providers: [
      { id: 'openrouter', name: 'OpenRouter', keyUrl: 'https://openrouter.ai/keys', free: true, models: ['openai/gpt-5.5'] },
      { id: 'gemini', name: 'Google Gemini', keyUrl: 'https://aistudio.google.com/apikey', free: true, models: ['gemini-3-pro'] }
    ],
    controlOn: false
  },
  '/api/ai/chat': { ok: true, list: [{ role: 'user', content: 'hello', ts: '2026-11-08 10:00:00' }, { role: 'assistant', content: 'hi!', ts: '2026-11-08 10:00:05' }] },
  '/api/analytics': {
    ok: true,
    totals: { published: 10, skipped: 2, failed: 1, edited: 0 },
    days: [
      { day: '2026-11-07', published: 2, skipped: 0, failed: 0 },
      { day: '2026-11-08', published: 5, skipped: 1, failed: 1 }
    ],
    sources: [{ jid: NEWS, n: 7 }]
  },
  '/api/posts': { ok: true, list: [
    { id: 1, created_at: '2026-11-08T09:30:00Z', source_jid: NEWS, source_msg_id: 'm1', keys: [], canEdit: false, source_name: 'Alpha News', status: 'published', reason: '', via: NEWS2 + '~Beta Updates', part: 0, pub_ms: 12000, body: 'Big promo this week' },
    { id: 2, created_at: '2026-11-08T08:10:00Z', source_jid: NEWS, source_msg_id: 'm2', keys: [], canEdit: false, source_name: 'Alpha News', status: 'failed', reason: 'WhatsApp is not connected', via: '', part: 0, pub_ms: 0, body: 'failed text here' }
  ] },
  '/api/snippets': { ok: true, list: [{ id: 1, name: 'Promo', body: 'Hi {name}, {deal} is live today!', created_at: '2026-11-08 06:00:13', updated_at: '2026-11-08 06:00:13' }] },
  '/api/drafts': { ok: true, list: [{ id: 1, name: 'd1', text: 'hello draft', image_path: '', created_at: '2026-11-08 06:00:13', updated_at: '2026-11-08 06:00:13' }] },
  /* 5C fixtures */
  '/api/ai/features': {
    ok: true, global: { provider: 'openrouter', model: 'openai/gpt-5.5' },
    providers: [{ id: 'openrouter', name: 'OpenRouter' }, { id: 'gemini', name: 'Google Gemini' }],
    features: [
      { key: 'beautify', label: 'Clean & beautify', provider: '', model: '', usage: { calls: 12, tokens: 98000 } },
      { key: 'translate', label: 'Translate', provider: 'gemini', model: 'gemini-3-flash', usage: { calls: 3, tokens: 4100 } },
      { key: 'autoReply', label: 'AI auto-reply', provider: '', model: '', usage: { calls: 0, tokens: 0 } },
      { key: 'composer', label: 'Composer AI', provider: '', model: '', usage: { calls: 1, tokens: 640 } },
      { key: 'tldr', label: 'TL;DR', provider: '', model: '', usage: { calls: 0, tokens: 0 } },
      { key: 'autobold', label: 'Auto-bold', provider: '', model: '', usage: { calls: 0, tokens: 0 } },
      { key: 'match', label: 'AI pilot (picking)', provider: '', model: '', usage: { calls: 0, tokens: 0 } },
      { key: 'digest', label: 'Daily digest', provider: '', model: '', usage: { calls: 0, tokens: 0 } },
      { key: 'assistant', label: 'Assistant / robot', provider: '', model: '', usage: { calls: 2, tokens: 5200 } },
      { key: 'transcribe', label: 'Voice transcription', provider: '', model: '', usage: { calls: 0, tokens: 0 } }
    ],
    total: { calls: 18, tokens: 107940 }
  },
  '/api/prompts': { ok: true, list: [
    { id: 1, name: 'Clean up', body: 'Fix typos and grammar. Return ONLY the cleaned text.', builtin: 1, created_at: '2026-11-08 06:00:00' },
    { id: 2, name: 'One-liner', body: 'Compress into ONE punchy line. Return ONLY that line.', builtin: 1, created_at: '2026-11-08 06:00:00' }
  ] },
  '/api/glossary': { ok: true, list: [{ id: 1, from_term: 'App', to_term: 'the app', note: 'house style' }] },
  '/api/reply-kb': { ok: true, list: [{ id: 1, q: 'What are your business hours?', a: '9am to 9pm, every day.', enabled: 1 }] },
  '/api/reply-kb/settings': { ok: true, from: '09:00', to: '21:00', allowlist: '923001112223' },
  '/api/watched': { ok: true, list: [{ phone: '3001112223', name: 'Test contact', last: { ts: '2026-11-08T08:00:00Z', body: 'hello there' } }] },
  '/api/uptime': { ok: true, boots: 2, last: { booted_at: '2026-11-07T00:00:00Z', source: 'start' }, recent: [{ id: 2, booted_at: '2026-11-07T00:00:00Z', source: 'start' }, { id: 1, booted_at: '2026-11-05T00:00:00Z', source: 'start' }] },
  '/api/logs': { ok: true, list: [
    { ts: '2026-11-08T10:00:00Z', level: 'info', code: 'boot', msg: 'boot complete' },
    { ts: '2026-11-08T10:01:00Z', level: 'info', code: 'publish', msg: 'published to 1 target' },
    { ts: '2026-11-08T10:02:00Z', level: 'warn', code: 'retry', msg: 'retry source pull' }
  ], maxEntries: 1000, maxAgeDays: 14 },
  '/api/features': { ok: true, antidelete: true, antiviewonce: true, antiedit: false, rejectcalls: true },
  '/api/contacts': { ok: true, list: [] },
  '/api/inbox': { ok: true, list: [] },
  '/api/numbers': { ok: true, list: [{ id: 'main', label: 'Main', phone: '923001234567', status: 'closed' }] },
  '/api/qr': { ok: true, qr: null, status: 'closed', detail: 'not connected' },
  '/api/persist/status': { ok: true, enabled: false },
  '/api/uptime2': { ok: true },
  '/api/bulk/history': { ok: true, list: [] },
  '/api/email/accounts': { ok: true, list: [] },
  '/api/email/history': { ok: true, list: [] },
  '/api/ai/models': { ok: true, provider: 'openrouter', models: ['openai/gpt-5.5'], source: 'static' }
};
const calls = [];

(async () => {
  /* login → cookie session (pages require the cookie; APIs also accept bearer) */
  const lr = await fetch(BASE + '/login', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' }, body: JSON.stringify({ username: 'admin', password: 'test123' }) });
  const cookie = (lr.headers.get('set-cookie') || '').split(';')[0];
  if (!cookie) throw new Error('no session cookie from login');
  const html = await (await fetch(BASE + '/admin', { headers: { Cookie: cookie } })).text();
  ok(html.length > 50000, 'admin dashboard HTML served (' + html.length + ' chars)');

  /* ---------- jsdom ---------- */
  const vc = new VirtualConsole();
  vc.on('jsdomError', () => {});
  const dom = new JSDOM(html, { url: BASE + '/admin', runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole: vc });
  const w = dom.window;
  const d = w.document;

  w.scrollTo = () => {};
  w.HTMLElement.prototype.scrollIntoView = () => {};
  w.fetch = async (url, opts) => {
    const u = String(url).replace(BASE, '');
    const p = u.split('?')[0];
    const method = (opts && opts.method) || 'GET';
    calls.push({ method, path: p, body: opts && opts.body });
    /* dynamic fixture: logs honour the level filter like the real server */
    if (p === '/api/logs' && u.includes('level=')) {
      const lv = String(u.split('level=')[1].split('&')[0]);
      if (lv !== 'all' && FIX['/api/logs']) FIX['/api/logs'] = { ...FIX['/api/logs'], list: FIX['/api/logs'].list.filter((l) => l.level === lv) };
    }
    /* dynamic fixture: a bulk add actually adds the channels server-side */
    if (method === 'POST' && p === '/api/sources/bulk') {
      const jids = (JSON.parse(opts.body || '{}').jids || []);
      const have = new Set(FIX['/api/sources'].list.map((c) => c.jid));
      for (const jid of jids) {
        if (!have.has(jid)) {
          const d = (FIX['/api/directory'].list.find((c) => c.jid === jid) || {});
          FIX['/api/sources'].list.push({ jid, name: d.name || jid, paused: false, added_at: new Date().toISOString(), role: d.role || 'OWNER' });
        }
      }
    }
    if (method === 'POST' && p === '/api/targets/bulk') {
      const jids = (JSON.parse(opts.body || '{}').jids || []);
      const have = new Set(FIX['/api/targets'].list.map((c) => c.jid));
      for (const jid of jids) {
        if (!have.has(jid)) {
          const d = (FIX['/api/directory'].list.find((c) => c.jid === jid) || {});
          FIX['/api/targets'].list.push({ jid, name: d.name || jid, paused: false, added_at: new Date().toISOString(), role: d.role || 'ADMIN' });
        }
      }
    }
    let body;
    if (p.startsWith('/api/whatsapp/')) body = { list: [] };
    else if (p === '/api/aikey') body = { ok: true };
    else if (p.startsWith('/icons/')) return { ok: true, status: 200, text: async () => '<svg></svg>', json: async () => ({}) };
    else if (p.startsWith('/fonts/')) return { ok: true, status: 200, text: async () => '', json: async () => ({}) };
    else if (p in FIX) body = FIX[p];
    else body = { ok: true };
    return { ok: true, status: 200, json: async () => JSON.parse(JSON.stringify(body)), text: async () => JSON.stringify(body) };
  };
  w.EventSource = class { constructor() {} close() {} addEventListener() {} removeEventListener() {} };
  w.eval(appJs);
  const _idl = Object.getOwnPropertyDescriptor(w.Element.prototype, 'innerHTML');
  Object.defineProperty(w.Element.prototype, 'innerHTML', {
    get: _idl.get,
    set(v) {
      if (this.id === 'robotLog') {
        const st = new Error().stack.split('\n').slice(1, 4).map((x) => x.trim().slice(0, 60));
        console.log('RLOG-WRITE bl=', String(v).match(/bubble/g) ? String(v).match(/bubble/g).length : 0, JSON.stringify(st));
      }
      return _idl.set.call(this, v);
    }
  });
  d.dispatchEvent(new w.Event('DOMContentLoaded', { bubbles: true }));
  await sleep(700);

  /* ---------- shell structure ---------- */
  const views = d.querySelectorAll('section.view');
  ok(views.length === 25, '25 views rendered (got ' + views.length + ')');
  const have = new Set([...views].map((v) => v.dataset.view));
  const need = ['home', 'sources', 'targets', 'routing', 'newpost', 'scheduled', 'calendar', 'media', 'approvals', 'posts', 'templates', 'beautify', 'aipilot', 'aireply', 'digest', 'guardrails', 'whatsapp', 'journal', 'bulk', 'email', 'analytics', 'health', 'logs', 'settings', 'about'];
  const missing = need.filter((n) => !have.has(n));
  ok(missing.length === 0, 'all 25 contract views present (missing: ' + (missing.join(',') || 'none') + ')');
  ok(d.querySelectorAll('#sidebar .sb-group').length === 8, 'sidebar has 8 groups');
  ok(d.querySelectorAll('#sidebar .sb-item').length === 25, 'sidebar has 25 nav items');
  ok(d.querySelectorAll('.btabs .bt').length === 5, 'mobile bottom tabs = 5');
  ok(d.getElementById('viewTitle') && d.getElementById('viewTitle').textContent.length > 0, 'topbar title populated');

  /* ---------- no-emoji shell ---------- */
  const shellText = d.getElementById('sidebar').textContent + d.querySelector('.topbar').textContent +
    [...d.querySelectorAll('.card-h, .btn, .sb-item, .bt')].map((e) => e.textContent).join('');
  ok(!EMOJI_RE.test(shellText), 'zero emoji in shell (sidebar/topbar/cards/buttons)');
  ok(!d.body.textContent.includes('undefined') && !d.body.textContent.includes('NaN'), 'no "undefined"/"NaN" in DOM');

  /* ---------- router ---------- */
  ok(!d.querySelector('section.view[data-view="home"]').hidden, 'home shown by default');
  d.querySelector('.sb-item[data-view="sources"]').click();
  await sleep(400);
  ok(!d.querySelector('section.view[data-view="sources"]').hidden && d.querySelector('section.view[data-view="home"]').hidden, 'nav click routes to Sources');
  ok(d.getElementById('viewTitle').textContent === 'Sources', 'topbar title follows view ("' + d.getElementById('viewTitle').textContent + '")');
  ok(d.querySelector('.sb-item[data-view="sources"]').classList.contains('on'), 'active nav item highlighted');

  /* ---------- N2 channel picker (names, not boxes) ---------- */
  const cp = d.querySelector('#srcPicker .cp');
  ok(cp, 'channel-picker mounted on Sources (N2 one component)');
  cp.querySelector('[data-cpbtn]').click();
  await sleep(100);
  const panel = cp.querySelector('.cp-panel');
  ok(!panel.hidden, 'picker opens on click');
  const rows = d.querySelectorAll('#srcPicker .cp-row');
  ok(rows.length === 2, 'picker lists 2 directory channels (got ' + rows.length + ')');
  ok(rows[0].querySelector('.cp-name').textContent === 'Alpha News', 'row shows channel NAME (no ugly jid box)');
  ok(rows[0].textContent.includes('1,200') || rows[0].textContent.includes('1200'), 'row shows subscriber count');
  const preChecked = [...d.querySelectorAll('#srcPicker .cp-list input')].filter((i) => i.checked).length;
  ok(preChecked === 1, 'already-followed source pre-ticked & disabled (1 of 2)');
  ok(cp.querySelector('[data-cpcnt]').textContent === '0 selected', 'count chip accurate ("' + cp.querySelector('[data-cpcnt]').textContent + '")');
  /* search */
  const searchIn = cp.querySelector('.cp-search .in');
  searchIn.value = 'beta';
  searchIn.dispatchEvent(new w.Event('input', { bubbles: true }));
  await sleep(100);
  const filtered = d.querySelectorAll('#srcPicker .cp-row');
  ok(filtered.length === 1 && filtered[0].textContent.includes('Beta Updates'), 'picker search filters live');
  searchIn.value = '';
  searchIn.dispatchEvent(new w.Event('input', { bubbles: true }));
  await sleep(100);
  /* JID visibility toggle + persistence */
  const jidToggle = d.getElementById('showJidSw');
  ok(jidToggle, 'Settings has the show-channel-ID switch');
  jidToggle.checked = true;
  jidToggle.dispatchEvent(new w.Event('change', { bubbles: true }));
  await sleep(100);
  ok(w.localStorage.getItem('rc-jid') === '1', 'JID visibility persisted (rc-jid=1)');
  /* row click selects */
  const row2 = [...d.querySelectorAll('#srcPicker .cp-row')].find((r) => r.dataset.jid === NEWS2);
  row2.click();
  await sleep(50);
  ok(cp.querySelector('[data-cpcnt]').textContent === '1 selected', 'row click selects (count → "1 selected")');
  ok(cp.querySelectorAll('.cp-chips .chip').length === 1, 'selected channels render as chips in the button');

  /* ---------- N1: add in place (no reload) ---------- */
  cp.querySelector('[data-cpadd]').click();
  await sleep(500);
  const added = calls.find((c) => c.method === 'POST' && c.path === '/api/sources/bulk');
  ok(added, 'N1a: "Add selected" POSTs /api/sources/bulk in place');
  ok(added && JSON.parse(added.body).jids.includes(NEWS2), 'bulk payload carries the picked jid');
  ok(!added || added.path !== '/api', 'no full-page reload (same document)');
  const rowsAfter = d.querySelectorAll('#srcPicker .cp-row');
  const betaAfter = [...rowsAfter].find((r) => r.dataset.jid === NEWS2);
  ok(betaAfter && betaAfter.querySelector('input').disabled, 'picker re-rendered in place — new source now pre-ticked');
  const srcRows = d.querySelectorAll('#srcTable tbody tr[data-jid]');
  ok(srcRows.length === 2, 'sources table re-synced in place (1 → 2 rows, N1)');

  /* ---------- composer preselect ---------- */
  d.querySelector('.sb-item[data-view="newpost"]').click();
  await sleep(600);
  const compCp = d.querySelector('#composePicker .cp');
  ok(compCp, 'composer has the same picker component (N2)');
  compCp.querySelector('[data-cpbtn]').click();
  await sleep(100);
  const compChecked = [...compCp.querySelectorAll('.cp-list input')].filter((i) => i.checked && !i.disabled).length;
  ok(compChecked === 1, 'composer preselects all active targets (untick to narrow)');
  d.getElementById('composeText').value = 'Hello from the gate test';
  d.getElementById('composeSend').click();
  await sleep(500);
  const compCall = calls.find((c) => c.method === 'POST' && c.path === '/api/compose');
  const compBody = compCall ? JSON.parse(compCall.body) : {};
  ok(compCall, 'composer POSTs /api/compose');
  ok(Array.isArray(compBody.targets) && compBody.targets.includes(NEWS2), 'publish targets = ticked picker rows');

  /* ---------- 5B composer (R49–R52) ---------- */
  ok(d.querySelectorAll('.cb[data-fmt]').length === 5, '5B: formatting toolbar (bold/italic/strike/mono/clear)');
  const ct = d.getElementById('composeText');
  ct.value = '*hello* world _x_';
  ct.dispatchEvent(new w.Event('input', { bubbles: true }));
  await sleep(100);
  ok(d.querySelector('#composePreview b') && d.querySelector('#composePreview i'), '5B: live preview renders *bold* and _italic_');
  ok(/chars/.test(d.getElementById('composeCount').textContent), '5B: character counter under the toolbar');
  ct.value = 'abc'; ct.setSelectionRange(0, 3);
  d.querySelector('.cb[data-fmt="bold"]').click();
  await sleep(50);
  ok(ct.value === '*abc*', '5B: toolbar wraps the selection in *bold*');
  ok(d.querySelectorAll('[data-aiact]').length === 5, '5B: five AI buttons (Improve/Shorten/Formal/Translate/Emojify)');
  const sp = d.getElementById('snippetPick');
  ok(sp.options.length === 2, '5B: snippet picker populated from /api/snippets');
  sp.value = '1';
  d.getElementById('snippetInsert').click();
  await sleep(250);
  const phFields = d.querySelectorAll('#mRoot .snip-ph');
  ok(phFields.length === 2, '5B: {name} and {deal} open as fill-in fields');
  if (phFields.length === 2) {
    phFields[0].value = 'Ali'; phFields[1].value = 'the big sale';
    d.getElementById('snipPhOk').click();
    await sleep(250);
  }
  ok(ct.value.includes('Hi Ali, the big sale is live today!'), '5B: snippet inserted with the filled placeholders');
  ok(!d.querySelector('#mRoot .mb'), '5B: placeholder modal closes after insert');
  ok(!!d.getElementById('composeUpload') && !!d.getElementById('composeTestSend') && !!d.getElementById('composeTestPhone'), '5B: upload + test-send-to-me controls');
  ok(d.querySelectorAll('#draftList .draft-row').length === 1 && d.getElementById('draftList').textContent.includes('d1'), '5B: draft row renders with name + preview');
  d.querySelector('#draftList [data-dl]').click();
  await sleep(350);
  ok(ct.value === 'hello draft', '5B: Load puts the draft text into the composer');
  /* 5C (R55): prompt library in the composer */
  ok(d.querySelectorAll('#libPromptPick option').length === 3, '5C: composer offers the prompt library (2 fixture prompts)');
  ok(d.getElementById('libPromptPick').textContent.includes('Clean up'), '5C: library prompt names render in the composer');

  /* ---------- theme ---------- */
  const t1 = d.documentElement.getAttribute('data-theme');
  d.getElementById('themeBtn').click();
  await sleep(100);
  const t2 = d.documentElement.getAttribute('data-theme');
  ok(t1 !== t2, 'theme button cycles (' + t1 + ' → ' + t2 + ')');
  ok(w.localStorage.getItem('rc-theme') === t2, 'theme persisted');

  /* ---------- palette ---------- */
  d.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true, cancelable: true }));
  await sleep(150);
  ok(!d.getElementById('palScrim').hidden, 'Ctrl+K opens the command palette');
  const palIn = d.getElementById('palInput');
  palIn.value = 'tem';
  palIn.dispatchEvent(new w.Event('input', { bubbles: true }));
  await sleep(150);
  const palItems = [...d.querySelectorAll('#palList .pal-i')];
  ok(palItems.length >= 1 && palItems[0].textContent.toLowerCase().includes('templates'), 'fuzzy filter (tem → Templates first)');
  ok(palItems[0].classList.contains('on'), 'first palette item highlighted');
  d.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  await sleep(300);
  ok(d.getElementById('palScrim').hidden && !d.querySelector('section.view[data-view="templates"]').hidden, 'Enter runs the palette item (jumps to Templates)');
  d.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true, cancelable: true }));
  await sleep(100);
  d.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  await sleep(100);
  ok(d.getElementById('palScrim').hidden, 'Esc closes palette');

  /* ---------- templates v2 ---------- */
  await sleep(300);
  ok(d.querySelectorAll('#tplGrid .tpl-row').length === 2, 'templates grid renders 2 templates');
  ok(d.querySelectorAll('#tplGrid .tpl-row [data-act="use"]').length === 2, 'per-template Use fixed action');
  ok(d.getElementById('tplModeStatus').textContent === 'OFF', 'template mode status shown');

  /* ---------- posts: names not jids ---------- */
  d.querySelector('.sb-item[data-view="posts"]').click();
  await sleep(500);
  ok(d.getElementById('postsTable').textContent.includes('Alpha News'), 'posts table shows source NAME');
  ok(!d.getElementById('postsTable').textContent.includes('1203630000000001234'), 'posts table never shows raw jid');
  ok(d.getElementById('postsTable').textContent.includes('via Beta Updates'), '5A: cross-source "via" credit chip in history');
  ok(d.getElementById('postsTable').textContent.includes('+12 s'), '5A: per-post latency shown in history');
  /* ---------- 5B posts (R53) ---------- */
  const failedRow = d.querySelector('#postsTable tbody tr[data-pid="2"]');
  ok(!!failedRow && !!failedRow.querySelector('[data-act="retry"]'), '5B: failed post gets a Retry action');
  const pubRow = d.querySelector('#postsTable tbody tr[data-pid="1"]');
  ok(pubRow && !!pubRow.querySelector('[data-act="republish"]') && !!pubRow.querySelector('[data-act="copy"]') && !!pubRow.querySelector('[data-act="reuse"]'), '5B: published post gets Edit&republish / Copy / Reuse');
  ok(pubRow && !pubRow.querySelector('[data-act="edit"]'), '5B: channel edit hidden while the Edit posts switch is off');
  d.getElementById('pfStatus').value = 'failed';
  d.getElementById('pfStatus').dispatchEvent(new w.Event('change', { bubbles: true }));
  await sleep(150);
  ok(d.querySelectorAll('#postsTable tbody tr[data-pid]').length === 1, '5B: status filter narrows the table');
  ok(d.getElementById('pfCount').textContent.includes('1 of 2'), '5B: filter reports n of total');
  d.getElementById('pfStatus').value = '';
  d.getElementById('pfStatus').dispatchEvent(new w.Event('change', { bubbles: true }));
  await sleep(150);
  d.querySelector('#postsTable tbody tr[data-pid="1"] [data-act="reuse"]').click();
  await sleep(400);
  ok(!d.querySelector('.view[data-view="newpost"]').hidden, '5B: Reuse opens the Composer');
  ok(d.getElementById('composeText').value.includes('Big promo this week'), '5B: Reuse loads the post text into the composer');
  ok(!!d.querySelector('#undoTarget option[value="' + NEWS2 + '"]') && !!d.getElementById('undoBtn'), '5A: undo-last-post control with target select');

  /* ---------- scheduled + routing (from /api/power) ---------- */
  d.querySelector('.sb-item[data-view="scheduled"]').click();
  await sleep(500);
  const schedRows = d.querySelectorAll('#schedTable tbody tr[data-id]');
  ok(schedRows.length === 1 && d.getElementById('schedTable').textContent.includes('Weekly promo'), 'scheduled posts table renders from /api/power');
  ok(d.getElementById('schedTable').textContent.includes('weekly'), 'repeat + sent count shown');
  ok(!!d.querySelector('#schedTarget option[value="' + NEWS2 + '"]'), 'schedule target select filled with targets');
  d.querySelector('.sb-item[data-view="routing"]').click();
  await sleep(500);
  const routeRows = d.querySelectorAll('#routingList .route-row');
  ok(routeRows.length >= 1, 'routing rules rows render per channel');
  const betaRow = [...routeRows].find((r) => r.dataset.jid === NEWS2);
  const incInput = betaRow ? betaRow.querySelector('[data-f="include"]') : null;
  ok(incInput && incInput.value === 'offer', 'existing routing rule pre-filled on the right row');
  /* 5A (R39): routing matrix grid */
  const mtxCells = d.querySelectorAll('#matrixBox .mtx-c');
  ok(mtxCells.length === 1, '5A: routing matrix renders 1 source × 1 target (got ' + mtxCells.length + ')');
  ok(mtxCells[0] && mtxCells[0].textContent.trim() === '·', '5A: unconfigured cell shows the default state');
  ok(mtxCells[0] && /default/.test(mtxCells[0].title || ''), '5A: cell tooltip names the state');

  /* ---------- 5A · Approval Queue + Live Queue (R37/R43) ---------- */
  d.querySelector('.sb-item[data-view="approvals"]').click();
  await sleep(500);
  ok(!!d.querySelector('#swQueue .sw-card input[data-key="queue"]'), '5A: the Approval-queue switch lives on this view');
  ok(d.querySelectorAll('#queueTabs .tab').length === 2, '5A: Approvals | Live Queue tabs');
  ok(d.getElementById('queueBadge').textContent === '1' && !d.getElementById('queueBadge').hidden, '5A: pending badge counts the queue');
  const qi = d.querySelector('#queueList .q-item');
  ok(!!qi, '5A: pending item renders in the list');
  ok(qi && qi.textContent.includes('Held post'), '5A: item shows the post text');
  ok(qi && qi.textContent.includes('image'), '5A: item carries its media kind');
  ok(qi && !!qi.querySelector('[data-q="approve"]') && !!qi.querySelector('[data-q="edit"]') && !!qi.querySelector('[data-q="reject"]'), '5A: Approve / Edit / Reject actions');
  ok(d.getElementById('queueDelay').value === '0', '5A: delay buffer field reflects the setting');
  d.querySelector('#queueTabs .tab[data-qt="live"]').click();
  await sleep(300);
  ok(d.querySelectorAll('#liveKpis .kpi').length === 5, '5A: Live Queue KPI strip (5 KPIs)');
  ok(d.querySelector('#liveKpis').textContent.includes('12 s'), '5A: latency KPI shows the median');
  ok(d.querySelectorAll('#liveFailed .lg').length === 1, '5A: failed posts grouped by reason');
  ok(!!d.querySelector('#liveFailed [data-fr]') && !!d.querySelector('#liveFailed [data-fd]'), '5A: per-failed-post Retry + Dismiss');
  ok(d.getElementById('queueRetryAll').textContent.includes('Retry all'), '5A: Retry-all-failed control');
  ok(d.getElementById('recoveryNote').textContent.includes('2 missed'), '5A: boot recovery pass result is visible');
  ok(d.querySelectorAll('#liveFailed .lg-i').length === 1, '5A: one failed item in the group');

  /* ---------- 5A · scheduler upgrades (R45) ---------- */
  d.querySelector('.sb-item[data-view="scheduled"]').click();
  await sleep(500);
  ok(d.querySelectorAll('#schedRepeat option').length === 5, '5A: repeat options = once/daily/weekly/weekdays/interval');
  const wdBox = d.getElementById('schedWeekdayBox');
  ok(wdBox.hidden === true, '5A: weekday chips hidden until selected');
  d.getElementById('schedRepeat').value = 'weekdays';
  d.getElementById('schedRepeat').dispatchEvent(new w.Event('change', { bubbles: true }));
  ok(wdBox.hidden === false, '5A: weekday chips appear on "Specific weekdays"');
  ok(d.querySelectorAll('#schedWeekdays input[type="checkbox"]').length === 7, '5A: Mon–Sun chips');
  ok(d.querySelectorAll('#schedTemplate option').length === 3, '5A: template refs offered (none + 2 fixture templates)');
  ok(d.getElementById('schedTzNote').textContent.includes('Pakistan'), '5A: PKT timezone note');
  const calCells = d.querySelectorAll('#calGrid .cal-c:not(.empty)');
  ok(calCells.length >= 28 && calCells.length <= 31, '5A: month calendar renders the days (got ' + calCells.length + ')');
  ok(/November|Dec|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct/i.test(d.getElementById('calMonth').textContent), '5A: calendar month label');
  ok(!!d.getElementById('calPrev') && !!d.getElementById('calNext'), '5A: calendar prev/next controls');

  /* ---------- 24 switches (distributed to their home views) ---------- */
  d.querySelector('.sb-item[data-view="beautify"]').click();
  await sleep(500);
  const swCount = d.querySelectorAll('.sw-card input[data-key]').length;
  ok(swCount === 24, 'all 24 switches rendered exactly once (13 + 5 from 5A + 6 from 5C; got ' + swCount + ')');
  ok(!!d.querySelector('#swGuardrails .sw-card input[data-key="crossdedupe"]'), '5A: cross-source dedupe switch lives in Guardrails');
  ok(!!d.querySelector('#swGuardrails .sw-card input[data-key="dedsplit"]') && !!d.querySelector('#swGuardrails .sw-card input[data-key="polltext"]'), '5A: split + polls-to-text live in Guardrails');
  ok(!!d.querySelector('#swGuardrails .sw-card input[data-key="tldr"]') && !!d.querySelector('#swGuardrails .sw-card input[data-key="autobold"]') && !!d.querySelector('#swGuardrails .sw-card input[data-key="emojibullets"]') && !!d.querySelector('#swGuardrails .sw-card input[data-key="transcribe"]'), '5C: TL;DR / auto-bold / emoji bullets / voice transcription live in Guardrails');
  ok(d.querySelectorAll('#swGuardrails input[data-key]:checked').length === 0, '5C: every new 5C switch is OFF by default (R8)');
  const swOn = d.querySelectorAll('.sw-card input[data-key]:checked').length;
  ok(swOn === 1, 'switch states match /api/power (beautify only)');
  ok(!!d.getElementById('automonitor'), 'automonitor switch lives in Sources');

  /* ---------- settings populated ---------- */
  d.querySelector('.sb-item[data-view="settings"]').click();
  await sleep(500);
  ok(d.getElementById('setBotName').value === 'GateBot', 'bot name populated');
  ok(d.getElementById('setBlocklist').value === 'winner, lottery', 'blocklist populated');
  ok(d.getElementById('aiStateLine').textContent.includes('openrouter'), 'AI state line (provider · model · key)');
  ok(d.querySelectorAll('#aiProvider option').length >= 2, 'AI provider list rendered from /api/ai');
  ok(d.getElementById('apiKeyBox').value === 'abc123', 'owner API key shown');
  /* 5A: pipeline behavior settings */
  ok(d.getElementById('setXdedupeWin').value === '30', '5A: cross-dedupe window populated');
  ok(d.getElementById('setSourceEdit').value === 'ignore', '5A: source-edit policy populated (default ignore)');
  ok(d.querySelectorAll('#setSourceEdit option').length === 3, '5A: ignore / mark / update choices');
  ok(!!d.getElementById('set5aSave'), '5A: save control for pipeline behavior');
  /* 5C (R54): per-feature AI provider/model + usage meter */
  await sleep(400);
  const aiRows = d.querySelectorAll('#aiFeatTable tbody tr[data-fk]');
  ok(aiRows.length === 10, '5C: per-feature AI table lists all 10 features (got ' + aiRows.length + ')');
  const trTrans = d.querySelector('#aiFeatTable tbody tr[data-fk="translate"]');
  ok(trTrans && trTrans.querySelector('.ai-fp').value === 'gemini', '5C: saved feature override (translate → Gemini) pre-selected');
  ok(trTrans && trTrans.querySelector('.ai-fm').value === 'gemini-3-flash', '5C: saved feature model pre-filled');
  ok(trTrans && trTrans.textContent.includes('98,000') || d.querySelector('#aiFeatTable').textContent.includes('98,000'), '5C: usage meter shows tokens per feature');
  ok(d.getElementById('aiFeatTotal').textContent.includes('18 calls'), '5C: total call/tokens line on the card');
  const anyGlobal = [...d.querySelectorAll('#aiFeatTable tbody .ai-fp')].some((s) => /^\(global/.test(s.options[0] ? s.options[0].textContent : ''));
  ok(anyGlobal, '5C: unset features default to "(global — <provider>)"');
  /* 5C (R55): prompt library management */
  await sleep(300);
  ok(d.getElementById('promptLibList').textContent.includes('Clean up') && d.getElementById('promptLibList').textContent.includes('built-in'), '5C: prompt library lists seeded prompts with built-in marker');
  ok(d.querySelectorAll('#promptLibList [data-pdel]').length === 0, '5C: built-in prompts cannot be deleted (Edit only)');
  /* 5C (R57): glossary */
  await sleep(300);
  ok(d.getElementById('glossaryList').textContent.includes('App') && d.getElementById('glossaryList').textContent.includes('the app'), '5C: glossary terms render term → replacement');
  /* 5C: home KPI strip now includes mirror latency */
  ok(d.querySelectorAll('#kpiGrid .kpi').length === 6, '5A: home KPI grid = 6 KPIs (latency added)');
  ok(d.getElementById('kpiGrid').textContent.includes('Mirror latency'), '5A: Mirror latency KPI on the dashboard');
  ok(d.getElementById('kpiGrid').textContent.includes('p95 40 s'), '5A: latency KPI shows p95');

  /* ---------- confirm modal names the item ---------- */
  d.querySelector('.sb-item[data-view="sources"]').click();
  await sleep(500);
  const delBtn = d.querySelector('#srcTable tbody tr [data-act="del"]');
  delBtn.click();
  await sleep(300);
  const mb = d.querySelector('#mRoot .mb');
  ok(mb, 'destructive action opens a confirm modal');
  ok(mb && mb.querySelector('.mb-b').textContent.includes('Alpha News'), 'confirm modal NAMES the item');
  ok(mb && mb.classList.contains('mb-danger') && mb.querySelector('[data-mprimary]').classList.contains('btn-d'), 'danger styling on destructive confirm');
  d.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  await sleep(200);
  ok(!d.querySelector('#mRoot .mb'), 'Esc dismisses modal');
  /* 5A (R38): per-source rule card */
  const rulesBtn = d.querySelector('#srcTable tbody tr [data-act="rules"]');
  ok(!!rulesBtn, '5A: Rules button on every source row');
  rulesBtn.click();
  await sleep(400);
  const ruleModal = d.querySelector('#mRoot .mb');
  ok(ruleModal && /Rule card/.test(ruleModal.textContent), '5A: rule card modal opens');
  ok(ruleModal && ruleModal.querySelector('#ruleApprove').checked === true, '5A: saved rule (approve first) pre-checked');
  ok(ruleModal && ruleModal.querySelector('#ruleFrom').value === '09:00', '5A: active-hours window pre-filled');
  ok(ruleModal && ruleModal.querySelector('#ruleMax').value === '5', '5A: daily cap pre-filled');
  d.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  await sleep(200);

  /* ---------- 5C (R59) · knowledge-base auto-reply ---------- */
  d.querySelector('.sb-item[data-view="aireply"]').click();
  await sleep(600);
  ok(!!d.querySelector('#swReplyKb .sw-card input[data-key="replykb"]'), '5C: KB switch lives on its own card in Auto-Reply');
  ok(d.querySelector('#swReplyKb input[data-key="replykb"]').checked === false, '5C: KB replies OFF by default (R8)');
  ok(d.getElementById('kbList').textContent.includes('What are your business hours?'), '5C: stored pairs render in the KB list');
  ok(d.getElementById('kbList').textContent.includes('9am to 9pm'), '5C: stored answer preview shown');
  ok(d.getElementById('kbFrom').value === '09:00' && d.getElementById('kbTo').value === '21:00', '5C: active-hours window populated');
  ok(d.getElementById('kbAllow').value === '923001112223', '5C: allowlist populated (owner-locked)');
  d.querySelector('#kbList [data-kbt]').click();
  await sleep(300);
  ok(d.getElementById('kbList').textContent.includes('off'), '5C: disabling a pair marks it (and hides it from matching)');
  d.querySelector('#kbList [data-kbt]').click();
  await sleep(300);

  /* ---------- 5C (R60) · morning recap ---------- */
  d.querySelector('.sb-item[data-view="digest"]').click();
  await sleep(600);
  ok(!!d.querySelector('#swRecap .sw-card input[data-key="recap"]'), '5C: Morning recap switch lives in Digest & Translate');
  ok(d.querySelector('#swRecap input[data-key="recap"]').checked === false, '5C: recap OFF by default (R8)');
  ok(d.getElementById('recapAt').value === '08:30', '5C: recap time populated (PKT)');
  ok(d.getElementById('recapAtSave'), '5C: recap time save control');

  /* ---------- robot ---------- */
  d.getElementById('robotFab').click();
  await sleep(400);
  ok(!d.getElementById('robotPanel').hidden, 'robot panel opens');
  ok(d.querySelectorAll('#robotLog .bubble').length >= 2, 'assistant history rendered');
  ok(d.getElementById('aiControlToggle') && d.getElementById('aiControlToggle').checked === false, 'bot control toggle reflects /api/ai');
  d.getElementById('robotInput').value = 'hi bot';
  d.getElementById('robotSend').click();
  await sleep(500);
  const bubbles = d.querySelectorAll('#robotLog .bubble');
  ok(bubbles.length >= 4, 'send appends user + bot bubbles (' + bubbles.length + ')');

  /* ---------- logs ---------- */
  d.querySelector('.sb-item[data-view="logs"]').click();
  await sleep(500);
  const ll = d.querySelectorAll('#logList .ll');
  ok(ll.length === 3, 'logs render 3 lines (got ' + ll.length + ')');
  ok(d.getElementById('logList').textContent.includes('retry source pull'), 'log text content correct');
  const warnChip = [...d.querySelectorAll('#logChips .chip')].find((c) => c.dataset.level === 'warn');
  warnChip.click();
  await sleep(300);
  ok(d.querySelectorAll('#logList .ll').length === 1, 'log level filter works (warn → 1)');
  ok(d.querySelectorAll('#logChips .chip.on').length === 1 && warnChip.classList.contains('on'), 'active log chip highlighted');

  /* ---------- analytics ---------- */
  d.querySelector('.sb-item[data-view="analytics"]').click();
  await sleep(500);
  ok(d.querySelectorAll('#anChart .bar-col').length === 2, 'analytics daily bars render (2 days)');
  ok(d.getElementById('anSources').textContent.includes('Alpha News'), 'by-source names (not jids)');
  ok(d.querySelectorAll('#anKpis .kpi').length >= 3, 'analytics KPIs render');

  /* ---------- WhatsApp mirror smoke (official look, behavior 1:1) ---------- */
  d.querySelector('.sb-item[data-view="whatsapp"]').click();
  await sleep(600);
  const waView = d.querySelector('section.view[data-view="whatsapp"]');
  ok(waView && waView.querySelector('.ww'), 'WhatsApp mirror renders the official .ww shell');
  ok(d.getElementById('waNumBand') && d.getElementById('waNumBand').textContent.includes('+923001234567'), 'number band shows the linked number (+92…)');
  ok(!waView.textContent.includes('undefined'), 'mirror has no "undefined"');

  /* ---------- journal + health ---------- */
  d.querySelector('.sb-item[data-view="journal"]').click();
  await sleep(400);
  ok(d.getElementById('watchTable').textContent.includes('Test contact'), 'journal (watched numbers) renders');
  d.querySelector('.sb-item[data-view="health"]').click();
  await sleep(400);
  ok(d.getElementById('upKpis').textContent.includes('2'), 'health KPIs render');

  console.log('\nDOM TEST 7.6.1 (Phase R shell): ' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('HARNESS ERROR:', e); process.exit(2); });
