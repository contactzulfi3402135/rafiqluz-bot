/* DOM TEST 7.6.1 PHASE R — the rebuilt Precision Console shell.
   Boots against the LIVE gate server (port 3131), loads /admin into jsdom,
   runs the real app.js with stubbed fetch/fixtures, and asserts:
   25 views, Signal Desk 8-group sidebar (v9.0.0 spec §1.3) + 5-item mobile bottom bar, router, theme, palette (Ctrl+K/fuzzy/Esc),
   N2 channel-picker (names + subs, not jid boxes, chips, search, JID toggle, persisted),
   N1 add-in-place (POST /api/sources/bulk → re-render, no reload), composer preselect,
   scheduled/routing from /api/power, posts show names not jids, confirm modal names the item,
   robot chat, logs filter, settings populated, 18 switches (13 + 5 from 5A), zero emoji in shell,
   5A: approval queue + live queue tabs, source Rules cards, routing matrix, scheduler weekdays/
   interval/template refs/month calendar, undo-last control, latency KPI, 5A settings fields,
   5B: composer toolbar/preview/AI buttons/snippets+placeholders/upload/test-send/drafts,
   history retry/edit-republish/filters/reuse,
   5C: 24 switches (6 new, all OFF), per-feature AI table + usage meter, prompt library,
   glossary, KB auto-reply card (pairs/hours/allowlist), morning recap time,
   5D: 26 switches, analytics v2 (heatmap SVG, per-target, media-vs-text, skip reasons,
   leaderboard + sparklines, goals, weekly card, exports, test alert), health v2 (score
   dial, 8 parts, weakest-two, self-test run + history), notification center (badge,
   panel, read, read-all), FTS5 palette wiring (post/log hits → views), posts text filter,
   5E: audit trail view (rows, search + actor filter, CSV control), panic stop (button,
   danger modal, global banner, exact restore), read-only chip + live readonly-session
   403 e2e, adaptive-pacing strip on the dashboard, backup download/pre-restore table +
   restore flow (pre-restore snapshot appears), security card (ro password, login alerts,
   timeout), storage manager (4 KPIs + age-based cleanup), public /status without auth,
   5F: guardrails regex toggle + per-rule replace rows + per-target caps, bulk saved lists
   (+ list name in history, send-from-list with confirm, new list), WA mirror chat action bar
   (pin+sort, labels, export, schedule w/ existing list, media gallery, quick replies into
   composer), contact details modal (note/tags/timeline) + dupe finder + CSV control.
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
/* 5J: relative PKT dates (sandbox clock-independent) */
const __PKT = () => new Date(Date.now() + 5 * 3600e3);
const __YM = __PKT().toISOString().slice(0, 7);
const __DM = (day) => __YM + '-' + String(day).padStart(2, '0');
const SWITCHES = { scheduler: false, routing: false, analytics: false, editposts: false, aipilot: false, dedupe: false, beautify: true, headers: false, hashtags: false, signature: false, translate: false, digest: false, aireply: false, queue: false, crossdedupe: false, dedsplit: false, polltext: false, matrix: false, tldr: false, autobold: false, emojibullets: false, transcribe: false, replykb: false, recap: false, weekly: false, instantalerts: false, waCommand: false, evergreen: false, autopilot: false, smartmedia: false, linktools: false, announcard: false, aisafety: false };
const FIX = {
  '/api/status': { ok: true, status: 'closed', detail: 'not connected', jid: null },
  '/api/overview': { ok: true, wa: { status: 'closed', detail: 'not connected' }, sources: 1, targets: 1, today: { published: 3, skipped: 1, failed: 0 }, cloud: false, cloudStatus: { enabled: false }, mirrorPaused: false, uptime: 2, latency: { n: 5, median: 12, p95: 40 }, queue: { pending: 1, delayMin: 0 }, panic: { on: false, since: null, state: 'running' }, pace: { active: false, gapMs: 0, reason: '', window: { failed: 0 } } },
  /* v11: 24 real hourly buckets — feeds the home Activity chart + KPI sparklines */
  '/api/overview/hourly': { ok: true, labels: Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0') + ':00'), buckets: Array.from({ length: 24 }, (_, i) => ({ published: [2, 3, 1, 0, 1, 4, 6, 5, 3, 2, 1, 2, 4, 5, 6, 4, 2, 1, 0, 1, 2, 3, 1, 0][i], skipped: [0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0][i], failed: [0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0][i] })) },
  '/api/directory': { ok: true, list: [
    { jid: NEWS, name: 'Alpha News', subs: 1200, role: 'OWNER' },
    { jid: NEWS2, name: 'Beta Updates', subs: 800, role: 'ADMIN' }
  ], wa: { status: 'open' }, scan: { at: '2026-01-01T00:00:00Z', wa: 'open', checked: 0, removed: [] } },
  '/api/sources': { ok: true, list: [{ jid: NEWS, name: 'Alpha News', paused: false, added_at: '2026-11-01T10:00:00Z', last_post_at: '2026-11-08T09:00:00Z', role: 'OWNER' }] },
  /* v7.8.0 — Browse: 26 curated channels (pages of 12 + 12 + 2 for the endless scroll) */
  '/api/browse/channels': { ok: true, list: [
    { id: 'bc01', name: 'Dawn News', category: 'News', country: 'Pakistan', blurb: 'News from Pakistan', following: true, inSources: false },
    { id: 'bc02', name: 'Geo News', category: 'News', country: 'Pakistan', blurb: 'Pakistan news', following: false, inSources: false },
    { id: 'bc03', name: 'BBC News', category: 'News', country: 'UK', blurb: 'World news', following: false, inSources: false },
    { id: 'bc04', name: 'Aaj Tak', category: 'News', country: 'India', blurb: 'Hindi news', following: false, inSources: false },
    { id: 'bc05', name: 'CNN', category: 'News', country: 'USA', blurb: 'US news', following: false, inSources: false },
    { id: 'bc06', name: 'PSL', category: 'Sports', country: 'Pakistan', blurb: 'Pakistan Super League cricket', following: false, inSources: false },
    { id: 'bc07', name: 'ICC Cricket', category: 'Sports', country: 'Global', blurb: 'Cricket world', following: false, inSources: false },
    { id: 'bc08', name: 'Real Madrid', category: 'Sports', country: 'Global', blurb: 'Football', following: false, inSources: false },
    { id: 'bc09', name: 'Manchester United', category: 'Sports', country: 'Global', blurb: 'Football', following: false, inSources: false },
    { id: 'bc10', name: 'Netflix', category: 'Entertainment', country: 'Global', blurb: 'Shows', following: false, inSources: false },
    { id: 'bc11', name: 'WSJ', category: 'Business', country: 'USA', blurb: 'Business news', following: false, inSources: false },
    { id: 'bc12', name: 'TED', category: 'Education', country: 'Global', blurb: 'Talks', following: false, inSources: false },
    { id: 'bc13', name: 'Samaa TV', category: 'News', country: 'Pakistan', blurb: 'News', following: false, inSources: false },
    { id: 'bc14', name: 'India Today', category: 'News', country: 'India', blurb: 'News', following: false, inSources: false },
    { id: 'bc15', name: 'Sky Sports', category: 'Sports', country: 'UK', blurb: 'Sports', following: false, inSources: false },
    { id: 'bc16', name: 'Forbes', category: 'Business', country: 'USA', blurb: 'Business', following: false, inSources: false },
    { id: 'bc17', name: 'Spotify', category: 'Music', country: 'Global', blurb: 'Music', following: false, inSources: false },
    { id: 'bc18', name: 'NASA', category: 'Science', country: 'USA', blurb: 'Space', following: false, inSources: false },
    { id: 'bc19', name: 'ARY News', category: 'News', country: 'Pakistan', blurb: 'News', following: false, inSources: false },
    { id: 'bc20', name: 'Manchester City', category: 'Sports', country: 'Global', blurb: 'Football', following: false, inSources: false },
    { id: 'bc21', name: 'Disney Hotstar', category: 'Entertainment', country: 'India', blurb: 'Shows', following: false, inSources: false },
    { id: 'bc22', name: 'Bloomberg', category: 'Business', country: 'USA', blurb: 'Markets', following: false, inSources: false },
    { id: 'bc23', name: 'Verge Tech', category: 'Technology', country: 'USA', blurb: 'Tech news', following: false, inSources: false },
    { id: 'bc24', name: 'Express News', category: 'News', country: 'Pakistan', blurb: 'News', following: false, inSources: false },
    { id: 'bc25', name: 'Liverpool FC', category: 'Sports', country: 'Global', blurb: 'Football', following: false, inSources: false },
    { id: 'bc26', name: 'Nat Geo', category: 'Science', country: 'Global', blurb: 'Nature', following: false, inSources: false }
  ] },
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
  '/api/settings': { ok: true, botName: 'GateBot', reportPhone: '923001234567', reportAt: '21:00', automonitor: false, blocklist: 'winner, lottery', maxPerHour: '30', replaceRules: '', blocklistRegex: false, translateLang: 'en', digestAt: '22:00', headerText: '', aiPrompt: 'Keep it short.', aireplyPrompt: '', apiKey: 'abc123', queueDelayMin: '0', crossDedupeWindowMin: '30', sourceEditPolicy: 'ignore', recapAt: '08:30', setupDone: false, kpiOrder: '', lang: 'en' },
  /* 5J fixtures */
  '/api/power/aisafety': { ok: true, criteria: 'no political content' },
  '/api/brand': { ok: true, brand: { accent: '#10B981', bg: '#0b1220', panel: '#111b2d', ink: '#e7eef6', muted: '#8ca0b8' }, presets: { midnight: { accent: '#10B981', bg: '#0b1220', panel: '#111b2d', ink: '#e7eef6', muted: '#8ca0b8' }, ember: { accent: '#F59E0B', bg: '#17100a', panel: '#241a10', ink: '#f6efe6', muted: '#b8a58c' }, royal: { accent: '#60A5FA', bg: '#0a101d', panel: '#101a2c', ink: '#e9effb', muted: '#93a4c0' }, rose: { accent: '#FB7185', bg: '#170d11', panel: '#241519', ink: '#f8eef1', muted: '#b893a0' } }, defaults: { accent: '#10B981', bg: '#0b1220', panel: '#111b2d', ink: '#e7eef6', muted: '#8ca0b8' } },
  '/api/pacing': { ok: true, perHour: [0, 0, 2, 5, 1, 0, 0, 3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], cap: 30, lastHour: 4, targets: [{ name: 'Alpha News', jid: NEWS2 }], nowPkt: '2026-11-08T14:00:00.000Z' },
  '/api/calendar': { ok: true, year: __YM.slice(0, 4), month: Number(__YM.slice(5, 7)), items: [
    { kind: 'published', date: __DM(1), time: '09:00', title: 'Jobs update', source: 'Alpha News', ref: { type: 'post', id: 1 } },
    { kind: 'scheduled', date: __DM(4), time: '18:30', title: 'Scheduled post', source: 'Scheduled (once)', ref: { type: 'job', id: 'j1' } },
    { kind: 'draft', date: __DM(2), time: '10:00', title: 'Queue draft', source: 'Approval queue', ref: { type: 'approval', id: 9 } },
    { kind: 'plan', date: __DM(5), time: '08:00', title: 'Plan item D2', source: 'Weekly plan', ref: { type: 'approval', id: 10 } },
    { kind: 'evergreen', date: __DM(3), time: '12:00', title: 'Recycled post', source: 'Evergreen recycle', ref: { type: 'post', id: 2 } }
  ], count: 5 },
  '/api/pipeline/inspect': { ok: true, stages: [
    { name: 'AI clean-up / beautify', before: 'T', after: 'T', changed: false, note: 'no AI key' },
    { name: 'Template (v7.5.0 zones)', before: 'T', after: 'T', changed: false, note: 'template mode OFF' },
    { name: 'Hashtags', before: 'T', after: 'T\n\n#jobs', changed: true, note: 'auto tags: #jobs' }
  ], gates: [
    { name: 'Global blocklist', fired: false, detail: '' },
    { name: 'Rate guard', fired: false, detail: '1/30/h used' }
  ], finalText: 'T\n\n#jobs', partCount: 1, partSizes: [12], targets: ['Alpha News'], targetCount: 1, targetNote: '',
  counters: { dayStartPkt: __DM(0), published: 3, skipped: 1, failed: 0, edited: 0, lastHour: 1, cap: 30, byTarget: [] } },
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
    totals: { published: 10, skipped: 2, failed: 1, edited: 1 },
    days: [
      { day: '2026-11-07', published: 2, skipped: 0, failed: 0 },
      { day: '2026-11-08', published: 5, skipped: 1, failed: 1 }
    ],
    sources: [{ jid: NEWS, n: 7 }],
    /* 5D (R61) */
    perTarget: [{ target_jid: NEWS2, pub: 7, edited: 1, failed: 1 }],
    sourcesFull: [{ source_jid: NEWS, pub: 7, media: 2, failed: 1 }],
    skipReasons: [{ reason: 'near-duplicate', n: 2 }],
    media: { withMedia: 2, text: 8 },
    heatmap: [
      { day: '2026-11-02', hours: Array(24).fill(0) },
      { day: '2026-11-03', hours: Array(24).fill(0) },
      { day: '2026-11-04', hours: Array(24).fill(0) },
      { day: '2026-11-05', hours: Array(24).fill(0) },
      { day: '2026-11-06', hours: Array(24).fill(0) },
      { day: '2026-11-07', hours: Array.from({ length: 24 }, (_, h) => (h === 14 ? 2 : 0)) },
      { day: '2026-11-08', hours: Array.from({ length: 24 }, (_, h) => (h === 20 ? 5 : 0)) }
    ],
    dayBySource: { [NEWS]: { '2026-11-07': 2, '2026-11-08': 5 } }
  },
  /* 5D (R62–R67) fixtures */
  '/api/goals': { ok: true, global: { daily: 10, today: 4 }, list: [{ source_jid: NEWS, daily_n: 5, today: 3, note: '' }] },
  '/api/weekly': { ok: true, on: false, at: 'Mon 09:00', lastweek: '', phone: '923001234567' },
  '/api/health': {
    ok: true, score: 84, at: '2026-11-08T10:30:00Z', weakest: ['AI key', 'Cloud memory'],
    parts: [
      { id: 'wa', name: 'WhatsApp connection', score: 100, note: 'connected' },
      { id: 'uptime', name: 'Uptime (24 h)', score: 100, note: '1 boots · 0 crashes in 24 h' },
      { id: 'cloud', name: 'Cloud memory', score: 15, note: 'OFF — every deploy asks for a QR scan' },
      { id: 'pipeline', name: 'Publish pipeline (7 d)', score: 100, note: '0 failures in 7 days' },
      { id: 'sources', name: 'Sources', score: 100, note: '1 source active' },
      { id: 'ai', name: 'AI key', score: 0, note: 'no key configured' },
      { id: 'report', name: 'Report phone', score: 100, note: 'set' },
      { id: 'storage', name: 'Storage', score: 100, note: '12 MB used' }
    ],
    selftests: [{ ts: '2026-11-08 09:00:00', ok: 10, total: 11, detail: 'AI key missing' }]
  },
  '/api/notifications': { ok: true, unread: 1, list: [
    { id: 1, ts: '2026-11-08 08:12:00', kind: 'alert', text: 'Post failed — WhatsApp is not connected', read: 0 },
    { id: 2, ts: '2026-11-07 21:05:00', kind: 'selftest', text: 'Full self-test: 11/11 checks passed', read: 1 }
  ] },
  '/api/search': {
    ok: true, engine: 'fts5',
    posts: [{ id: 1, source_name: 'Alpha News', snippet: 'Big promo this week', created_at: '2026-11-08T09:30:00Z' }],
    logs: [{ id: 9, code: 'publish', snippet: 'published promo to 1 target', ts: '2026-11-08T09:30:01Z' }],
    chats: []
  },
  '/api/posts': { ok: true, list: [
    { id: 1, created_at: '2026-11-08T09:30:00Z', source_jid: NEWS, source_msg_id: 'm1', keys: [{ target_jid: NEWS2, msg_id: 'MK1' }], canEdit: false, source_name: 'Alpha News', status: 'published', reason: '', via: NEWS2 + '~Beta Updates', part: 0, pub_ms: 12000, body: 'Big promo this week' },
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
  '/api/ai/models': { ok: true, provider: 'openrouter', models: ['openai/gpt-5.5'], source: 'static' },
  /* 5E fixtures */
  '/api/audit': { ok: true, list: [
    { ts: '2026-11-08 10:22:00', actor: 'owner', action: 'security.update', detail: 'Security settings updated (readonly off, login alerts off, timeout 120 min)' },
    { ts: '2026-11-08 10:15:00', actor: 'queue', action: 'post.queued', detail: 'Post from 1203630000000001234@newsletter entered the queue' },
    { ts: '2026-11-08 09:40:00', actor: 'pace', action: 'pace.backoff', detail: '4 failed sends in the last 15 min — waiting 60 s between sends' }
  ], total: 3 },
  '/api/backup/pre-restore': { ok: true, list: [
    { name: 'pre-restore-2026-11-07T09-00-00-000Z.sqlite', bytes: 5242880, at: '2026-11-07T09:00:00.000Z' }
  ] },
  '/api/backup/restore': { ok: true, preRestore: 'pre-restore-2026-11-08T10-30-00-000Z.sqlite', message: 'Restored. Pre-restore snapshot kept — the dashboard will reflect the restored state.' },
  '/api/security': { ok: true, roEnabled: false, roSet: false, loginAlerts: false, timeoutMin: 120 },
  '/api/storage': { ok: true, db: { bytes: 2097152 }, mediaHold: { files: 3, bytes: 5242880, oldest: '2026-11-01T00:00:00Z' }, avatars: { files: 2, bytes: 102400, oldest: null }, preRestore: { files: 1, bytes: 5242880 }, rows: { posts: 12, logs: 240, audit: 3, queue5a: 1, inbox_msgs: 0, settings: 40 }, github: { configured: true, reachable: true, repo: 'contactzulfi3402135/raqifluz-bot', branch: 'bot-state', sizeKb: 8500, defaultBranch: 'main', lastSyncAt: '2026-11-13T22:10:00.000Z', lastSyncBytes: 2097152, updatedAt: '2026-11-13T22:10:00.000Z' } },
  '/api/panic': { ok: true, on: false, since: null, state: 'running' },
  '/api/session': { ok: true, role: 'full', timeoutMin: 120 },
  /* 5F fixtures (R76–R79) */
  '/api/inbox/labels': { ok: true, list: [
    { id: 1, name: 'Promo', color: '#F59E0B', count: 2 },
    { id: 2, name: 'VIP', color: '#EF4444', count: 1 }
  ] },
  '/api/inbox/923001112223@s.whatsapp.net/labels': { ok: true, list: [] },
  '/api/inbox/quick-replies': { ok: true, list: [
    { id: 1, text: 'Thanks, get in touch!' },
    { id: 2, text: 'Prices are available on request.' }
  ] },
  '/api/inbox/scheduled': { ok: true, list: [
    { id: 91, jid: '923001112223@s.whatsapp.net', text: 'Daily report ready', at: '2026-11-09T04:00:00.000Z', repeat: 'daily', weekdays: '', intervalMin: 0, enabled: true, sent: 2, lastSent: '2026-11-08T04:00:00.000Z' }
  ] },
  '/api/inbox/923001112223@s.whatsapp.net/media-gallery': { ok: true, list: [
    { id: 901, ts: '2026-11-08T09:00:00', kind: 'image', mime: 'image/jpeg', name: 'photo.jpg', bytes: 204800 },
    { id: 902, ts: '2026-11-08T09:10:00', kind: 'audio', mime: 'audio/ogg', name: '', bytes: 81000 }
  ] },
  '/api/contacts/923001112223@s.whatsapp.net': { ok: true, jid: '923001112223@s.whatsapp.net', name: 'Ali Raza', note: 'Franchisee — follow up Friday', noteUpdatedAt: '2026-11-08 08:00:00', tags: [{ id: 1, name: 'vip' }], timeline: [
    { kind: 'received', text: 'hello there', ts: '2026-11-08 09:00:00' },
    { kind: 'note', text: 'Note updated — Franchisee', ts: '2026-11-08 08:00:00' }
  ] },
  '/api/contacts/dupes': { ok: true, byName: [
    [
      { jid: '923001111111@s.whatsapp.net', name: 'Ali Raza', phone: '923001111111' },
      { jid: '923002222222@s.whatsapp.net', name: 'ali raza', phone: '923002222222' }
    ]
  ], byPhone: [] },
  '/api/broadcast': { ok: true, lists: [
    { id: 5, name: 'Family', recipients: '923001111111,Ali\n923002222222', count: 2, updated_at: '2026-11-07T10:00:00Z' }
  ], history: [
    { id: 31, ts: '2026-11-07T10:05:00Z', sent: 2, total: 2, text: 'Friday sale is live', list_id: 5, list_name: 'Family' }
  ] },
  '/api/guardrates': { ok: true, global: 30, targets: [
    { jid: NEWS2, name: 'Beta Updates', max: 0, lastHour: 2 }
  ] },
  /* 5G fixtures (R80–R83) */
  '/api/webhooks': { ok: true, list: [
    { id: 3, name: 'Zapier', url: 'https://zapier.example/hooks/abc123', events: ['post.published', 'panic.on'], enabled: true, last_status: 'ok 200', last_at: '2026-11-08 08:15:00' },
    { id: 4, name: 'N8n', url: 'https://n8n.example/webhook/post', events: ['post.failed'], enabled: false, last_status: 'http 404 (attempt 3/3)', last_at: '2026-11-07 22:00:00' }
  ], events: [
    ['post.published', 'A post went out to at least one target'], ['post.failed', 'A post failed (with the reason)'],
    ['post.queued', 'A post entered the approval queue'], ['bulk.sent', 'A bulk / saved-list send finished'],
    ['wasched.sent', 'A scheduled personal WhatsApp send went out'], ['panic.on', 'Panic stop engaged — everything paused'],
    ['panic.off', 'Panic stop restored — exact states back'], ['alert', 'An instant alert fired']
  ] },
  '/api/rss/test': { ok: true, items: 2, jid: 'rss-0123456789ab@rss', sample: [{ title: 'Story A', link: 'https://x/a', ts: '2026-11-08 09:00' }] },
  /* 5H fixtures (R85–R88) */
  '/api/wacommand': { ok: true, on: false, pinSet: false, ownJid: '923001234567@s.whatsapp.net', commands: [
    ['status', 'Connection, queue and today’s numbers'], ['approve', 'Approve everything in the Approval Queue'],
    ['failed', 'What failed in the last 24 h'], ['undo last', '⚠ PIN — undo the most recent published post'],
    ['pause', '⚠ PIN — pause all mirroring (global pause)'], ['resume', '⚠ PIN — clear the global pause'],
    ['panic', '⚠ PIN — full panic stop (restores exact states)'], ['help', 'List the commands']
  ] },
  '/api/autopilot': { ok: true, on: false, maxDay: 10, usedToday: 2, last: { action: 'pass', detail: 'Auto-pilot pass complete (hourly) — 2/10 actions used today', at: '2026-11-08 08:00:00' }, log: [
    { id: 4, action: 'pass', detail: 'Auto-pilot pass complete (hourly) — 2/10 actions used today', at: '2026-11-08 08:00:00' },
    { id: 3, action: 'retry-queue', detail: 'Re-queued a failed queue item (7)', at: '2026-11-08 08:00:00' },
    { id: 2, action: 'retry-posts', detail: 'Re-fed 1 failed post(s) through the pipeline', at: '2026-11-08 07:00:00' }
  ] },
  '/api/evergreen': { ok: true, on: false, quota: 2, minAgeDays: 7, usedToday: 1, total: 12, last: { body: 'A proven post that did well and came back around', targets: 2, at: '2026-11-08 05:30:00' }, log: [
    { id: 12, body: 'A proven post that did well and came back around', targets: 2, at: '2026-11-08 05:30:00' },
    { id: 11, body: 'Five tips to grow a WhatsApp channel', targets: 2, at: '2026-11-07 05:30:00' }
  ] },
  '/api/plan-week/result': { ok: true, planned: 7, items: [
    { day: 1, text: 'Mon: a quick question for your followers about their biggest channel struggle' },
    { day: 2, text: 'Tue: 3 tools that save an hour a week' },
    { day: 3, text: 'Wed: announcement — new guide is live' },
    { day: 4, text: 'Thu: one tip per day series, part 4' },
    { day: 5, text: 'Fri: behind the scenes of how this channel is run' },
    { day: 6, text: 'Sat: recap of the best posts this week' },
    { day: 7, text: 'Sun: plan for next week + call for suggestions' }
  ] },
  /* 5I fixtures */
  '/api/subs': { ok: true, list: [
    { jid: NEWS, name: 'Alpha News', subs: 1250, subsDay: '2026-11-08', history: [
      { day: '2026-11-06', count: 1200 }, { day: '2026-11-07', count: 1225 }, { day: '2026-11-08', count: 1250 }
    ] }
  ] },
  '/api/hashtags/freq': { ok: true, days: 30, posts: 14, list: [
    { tag: '#jobs', n: 8 }, { tag: '#news', n: 4 }, { tag: '#lahore', n: 2 }
  ] },
  '/api/freshness': { ok: true, hours: 0 },
  '/api/media-lib': { ok: true, total: 3, list: [
    { src: 'chat', ref: 'inbox:42', jid: '1203630000000009999@whatsapp.net', ts: '2026-11-08 09:12:00', kind: 'image', mime: 'image/jpeg', name: 'promo-pic.jpg', bytes: 420000 },
    { src: 'chat', ref: 'inbox:41', jid: '1203630000000009999@whatsapp.net', ts: '2026-11-08 08:40:00', kind: 'video', mime: 'video/mp4', name: 'clip', bytes: 2400000 },
    { src: 'hold', ref: 'hold:77.mp4', jid: '', ts: '2026-11-08 07:55:00', kind: 'video', mime: '', name: '77', bytes: 1800000 }
  ] },
  '/api/media-lib/delete': { ok: true },
  '/api/posts/resend': { ok: true, sent: 1, failed: 0, errors: [] },
  '/api/card': { ok: true },
  '/api/card-svg': { ok: true }
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
  w.URL.createObjectURL = () => 'blob:domtest-card'; // 5I: jsdom has no real object URLs
  w.URL.revokeObjectURL = () => {};
  /* jsdom performs REAL navigation on anchor clicks (it would fetch + replace the
     document) — record the href and skip the default action instead. */
  w.__anchorClicks = [];
  w.HTMLAnchorElement.prototype.click = function () {
    if (this.href) w.__anchorClicks.push({ href: this.href, download: this.download || '' });
    this.dispatchEvent(new w.Event('click', { bubbles: true }));
  };
  w.fetch = async (url, opts) => {
    const u = String(url).replace(BASE, '');
    let p = u.split('?')[0];
    try { p = decodeURIComponent(p); } catch (e) { /* keep raw */ }
    const method = (opts && opts.method) || 'GET';
    calls.push({ method, path: p, body: opts && opts.body });
    /* dynamic fixture: 5J — calendar honours the requested month like the real server */
    if (p === '/api/calendar' && u.includes('ym=')) {
      const m2 = String(u).match(/ym=(\d{4})-(\d{2})/);
      if (m2 && FIX['/api/calendar']) FIX['/api/calendar'] = { ...FIX['/api/calendar'], year: Number(m2[1]), month: Number(m2[2]) };
    }
    /* dynamic fixture: logs honour the level filter like the real server */
    if (p === '/api/logs' && u.includes('level=')) {
      const lv = String(u.split('level=')[1].split('&')[0]);
      if (lv !== 'all' && FIX['/api/logs']) FIX['/api/logs'] = { ...FIX['/api/logs'], list: FIX['/api/logs'].list.filter((l) => l.level === lv) };
    }
      /* dynamic fixture: 5C KB pair toggle actually flips the row server-side */
    if (method === 'POST' && /^\/api\/reply-kb\/\d+$/.test(p)) {
      const id = Number(p.split('/')[3]);
      const row = ((FIX['/api/reply-kb'] || {}).list || []).find((x) => x.id === id);
      if (row) row.enabled = row.enabled ? 0 : 1;
    }
    /* dynamic fixture: 5D — a full self-test run returns 11 checks (one honest FAIL) */
    if (method === 'POST' && p === '/api/health/selftest') {
      const mk = (name, okv, ms, detail) => ({ name, ok: okv, ms, detail });
      FIX['/api/health/selftest'] = {
        ok: 10, total: 11, ms: 24, list: [
          mk('DB read/write', true, 1, 'ok'), mk('FTS5 full-text index', true, 2, 'ok'),
          mk('Templates (20)', true, 1, 'ok'), mk('Analytics (7 d)', true, 3, 'ok'),
          mk('Log write/read', true, 1, 'ok'), mk('WhatsApp socket', false, 0, 'status: closed'),
          mk('Cloud memory', true, 2, 'disabled (ok)'), mk('AI key', false, 0, 'no key configured'),
          mk('Report phone', true, 0, 'set'), mk('Storage', true, 1, '12 MB used'),
          mk('Settings store', true, 0, 'ok')
        ]
      };
    }
    /* dynamic fixture: 5D — notification read actually clears the row server-side */
    if (method === 'POST' && /^\/api\/notifications\/\d+\/read$/.test(p)) {
      const id = Number(p.split('/')[2]);
      const row = ((FIX['/api/notifications'] || {}).list || []).find((x) => x.id === id);
      if (row && !row.read) { row.read = 1; FIX['/api/notifications'].unread = Math.max(0, FIX['/api/notifications'].unread - 1); }
    }
    if (method === 'POST' && p === '/api/notifications/read') {
      for (const x of (FIX['/api/notifications'] || {}).list || []) x.read = 1;
      FIX['/api/notifications'].unread = 0;
    }
    if (method === 'POST' && p === '/api/alerts/test') {
      FIX['/api/alerts/test'] = { ok: true, sent: false, why: 'off' };
    }
    /* dynamic fixture: 5E — audit honours the q + actor filters like the real server */
    if (method === 'GET' && p === '/api/audit') {
      const qp = {};
      for (const kv of u.split('?')[1].split('&')) { if (kv) { const i = kv.indexOf('='); qp[decodeURIComponent(kv.slice(0, i))] = decodeURIComponent(kv.slice(i + 1)); } }
      const q = String(qp.q || '').toLowerCase();
      const actor = String(qp.actor || '').trim();
      let rows = FIX['/api/audit'].list.slice();
      if (actor) rows = rows.filter((r) => r.actor === actor);
      if (q) rows = rows.filter((r) => (r.action + ' ' + r.detail).toLowerCase().includes(q));
      FIX['/api/audit/filtered'] = { ok: true, list: rows, total: rows.length };
    }
    /* dynamic fixture: 5E — panic stop/restore flips the live state */
    if (method === 'POST' && p === '/api/panic/stop') {
      FIX['/api/panic'] = { ok: true, on: true, since: '2026-11-08T10:25:00.000Z', state: 'paused' };
      FIX['/api/panic/result'] = { ...FIX['/api/panic'], previous: { mirrorPaused: false, at: Date.now(), by: 'owner' } };
    }
    if (method === 'POST' && p === '/api/panic/restore') {
      FIX['/api/panic'] = { ok: true, on: false, since: null, state: 'running' };
      FIX['/api/panic/result'] = { ...FIX['/api/panic'], restored: { mirrorPaused: false, at: Date.now(), by: 'owner' } };
    }
    /* dynamic fixture: 5E — a restore adds its pre-restore snapshot to the list */
    if (method === 'POST' && p === '/api/backup/restore') {
      FIX['/api/backup/pre-restore'].list.unshift({ name: FIX['/api/backup/restore'].preRestore, bytes: 3145728, at: '2026-11-08T10:30:00.000Z' });
      FIX['/api/backup/restore/result'] = { ...FIX['/api/backup/restore'] };
    }
    /* dynamic fixture: 5E — storage cleanup reports what it removed */
    if (method === 'POST' && p === '/api/storage/cleanup') {
      const b = JSON.parse(opts.body || '{}');
      FIX['/api/storage/cleanup'] = { ok: true, detail: 'Cleaned ' + b.kind + ' older than ' + b.days + ' day(s) (published posts, settings and credentials are never touched)' };
    }
    /* dynamic fixture: 5E — security save persists the new values */
    if (method === 'POST' && p === '/api/security') {
      const b = JSON.parse(opts.body || '{}');
      FIX['/api/security'] = { ok: true, roEnabled: !!b.ro, roSet: b.roSet || Boolean(b.password), loginAlerts: !!b.loginAlerts, timeoutMin: b.timeoutMin || 120 };
      FIX['/api/security/result'] = { ok: true };
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
    /* dynamic fixtures: 5F — labels per chat reflect toggles */
    if (method === 'POST' && /^\/api\/inbox\/[^/]+\/labels$/.test(p)) {
      const b = JSON.parse(opts.body || '{}');
      const key = p;
      const list = (FIX[key] && FIX[key].list) ? FIX[key].list : (FIX[key] = { ok: true, list: [] }).list;
      const all = FIX['/api/inbox/labels'].list;
      const lab = all.find((x) => x.id === Number(b.labelId));
      if (lab && b.on && !list.some((x) => x.id === lab.id)) list.push({ id: lab.id, name: lab.name, color: lab.color });
      if (lab && !b.on) for (let i = 0; i < list.length; i++) if (list[i].id === lab.id) list.splice(i, 1);
    }
    if (method === 'POST' && p === '/api/inbox/labels') {
      const b = JSON.parse(opts.body || '{}');
      FIX['/api/inbox/labels'].list.push({ id: 99, name: b.name, color: '#10B981', count: 0 });
      FIX['/api/inbox/labels/result'] = { ok: true, id: 99 };
    }
    if (method === 'POST' && /^\/api\/inbox\/[^/]+\/pin$/.test(p)) {
      const jid = p.split('/')[3];
      const c = (FIX['/api/inbox'].list || []).find((x) => x.jid === jid);
      const next = !!(c && !c.pinned);
      if (c) c.pinned = next ? 1 : 0;
      FIX['/api/inbox/pinresult'] = { ok: true, pinned: next };
    }
    if (method === 'POST' && p === '/api/inbox/scheduled') {
      FIX['/api/inbox/scheduled/result'] = { ok: true, row: { id: 92 } };
    }
    if (method === 'POST' && p === '/api/inbox/quick-replies') {
      const b = JSON.parse(opts.body || '{}');
      FIX['/api/inbox/quick-replies'].list.push({ id: 98, text: b.text });
      FIX['/api/inbox/quick-replies/result'] = { ok: true, id: 98 };
    }
    if (method === 'POST' && p === '/api/contacts/tags') {
      FIX['/api/contacts/tags/result'] = { ok: true, id: 97 };
    }
    if (method === 'POST' && p === '/api/broadcast' ) {
      const b = JSON.parse(opts.body || '{}');
      const id = b.id ? Number(b.id) : 50;
      const ex = FIX['/api/broadcast'].lists.find((x) => x.id === id);
      if (ex) { ex.name = b.name; ex.recipients = b.recipients; } else { FIX['/api/broadcast'].lists.push({ id, name: b.name, recipients: b.recipients, count: String(b.recipients || '').split('\n').filter(Boolean).length, updated_at: new Date().toISOString() }); }
      FIX['/api/broadcast/result'] = { ok: true, id };
    }
    if (method === 'POST' && /^\/api\/broadcast\/\d+\/send$/.test(p)) {
      FIX['/api/broadcast/sendresult'] = { ok: true, sent: 2, total: 2, results: [] };
    }
    /* dynamic fixtures: 5F — per-target caps save echoes the rows back */
    if (method === 'POST' && p === '/api/guardrates') {
      const b = JSON.parse(opts.body || '{}');
      for (const t of FIX['/api/guardrates'].targets) { const v = b.targets && b.targets[t.jid]; if (v !== undefined) t.max = parseInt(v, 10) || 0; }
      FIX['/api/guardrates/result'] = { ok: true };
    }
    /* v7.7.3 — the Sources Refresh button asks WhatsApp (scan stat shape) */
    if (method === 'POST' && p === '/api/directory/rescan') {
      FIX['/api/directory/rescan'] = { ok: true, checked: 2, removed: [] };
    }
    /* dynamic fixtures: 5G — RSS source add lands in the sources list (kind=rss) */
    if (method === 'POST' && p === '/api/sources/rss') {
      const b = JSON.parse(opts.body || '{}');
      const jid = 'rss-0123456789ab@rss';
      if (!FIX['/api/sources'].list.some((c) => c.jid === jid)) {
        FIX['/api/sources'].list.push({ jid, name: b.name || 'RSS Feed', kind: 'rss', url: b.url || '', paused: false, added_at: new Date().toISOString(), last_post_at: '', role: null, targets: '' });
      }
      FIX['/api/sources/rss/result'] = { ok: true, jid, name: b.name };
    }
    /* dynamic fixtures: 5G — webhook CRUD + test update the live list like the server */
    if (method === 'POST' && p === '/api/webhooks') {
      const b = JSON.parse(opts.body || '{}');
      const id = 100 + FIX['/api/webhooks'].list.length;
      FIX['/api/webhooks'].list.push({ id, name: b.name, url: b.url, events: b.events || [], enabled: true, last_status: '', last_at: '' });
      FIX['/api/webhooks/result'] = { ok: true, id };
    }
    if (method === 'POST' && /^\/api\/webhooks\/\d+\/enable$/.test(p)) {
      const id = Number(p.split('/')[3]);
      const row = FIX['/api/webhooks'].list.find((x) => x.id === id);
      if (row) row.enabled = JSON.parse(opts.body || '{}').on ? 1 : 0;
      FIX['/api/webhooks/toggle'] = { ok: true };
    }
    if (method === 'POST' && /^\/api\/webhooks\/\d+\/test$/.test(p)) {
      const id = Number(p.split('/')[3]);
      const row = FIX['/api/webhooks'].list.find((x) => x.id === id);
      if (row) { row.last_status = 'ok 200'; row.last_at = '2026-11-08 11:00:00'; }
      FIX['/api/webhooks/testresult'] = { ok: true, result: { ok: true, status: 200 } };
    }
    if (method === 'POST' && /^\/api\/webhooks\/\d+\/delete$/.test(p)) {
      const id = Number(p.split('/')[3]);
      FIX['/api/webhooks'].list = FIX['/api/webhooks'].list.filter((x) => x.id !== id);
      FIX['/api/webhooks/delresult'] = { ok: true };
    }
    /* dynamic fixtures: 5H — automation settings persist like the server */
    if (method === 'POST' && p === '/api/wacommand') {
      const b = JSON.parse(opts.body || '{}');
      FIX['/api/wacommand'].pinSet = /^\d{4,8}$/.test(b.pin || '');
      FIX['/api/wacommand/result'] = { ok: true, pinSet: FIX['/api/wacommand'].pinSet };
    }
    if (method === 'POST' && p === '/api/autopilot') {
      const b = JSON.parse(opts.body || '{}');
      FIX['/api/autopilot'].maxDay = b.maxDay || 10;
      FIX['/api/autopilot/result'] = { ok: true, maxDay: FIX['/api/autopilot'].maxDay };
    }
    if (method === 'POST' && p === '/api/evergreen') {
      const b = JSON.parse(opts.body || '{}');
      FIX['/api/evergreen'].quota = b.quota || 2;
      FIX['/api/evergreen'].minAgeDays = b.minAge || 7;
      FIX['/api/evergreen/result'] = { ok: true, quota: b.quota, minAgeDays: b.minAge };
    }
    if (method === 'POST' && p === '/api/plan-week') {
      FIX['/api/plan-week/result'] = { ...FIX['/api/plan-week/result'] };
    }
    /* v7.8.0 — Browse honours category/country/search + paging like the real server */
    if (method === 'GET' && p === '/api/browse/channels') {
      const qp = u.split('?')[1] || '';
      const qg = (k) => { const m = qp.match(new RegExp(k + '=([^&]*)')); return m ? decodeURIComponent(m[1]) : ''; };
      let list = (FIX['/api/browse/channels'].list || []).slice();
      const caty = qg('category'), country = qg('country'), qq = qg('q');
      if (caty) list = list.filter((c) => c.category === caty);
      if (country) list = list.filter((c) => c.country === country);
      if (qq) list = list.filter((c) => (c.name + ' ' + c.blurb).toLowerCase().includes(qq.toLowerCase()));
      const size = Math.max(4, Math.min(50, parseInt(qg('size'), 10) || 12));
      const page = Math.max(1, parseInt(qg('page'), 10) || 1);
      const start = (page - 1) * size;
      FIX['/api/browse/channels/result'] = { ok: true, list: list.slice(start, start + size), page, size, total: list.length, hasMore: start + size < list.length, catalogTotal: list.length, categories: ['News', 'Sports', 'Entertainment', 'Business', 'Technology', 'Education', 'Science', 'Music'], countries: ['Global', 'Pakistan', 'India', 'USA', 'UK'], wa: 'closed', followingCount: 3 };
    }
    /* dynamic fixtures: 5I — media library honours the kind filter like the server */
    if (method === 'GET' && p === '/api/media-lib') {
      const qp = u.split('?')[1] || '';
      const kind = (qp.match(/kind=([^&]*)/) || [])[1] || '';
      const rows = kind ? FIX['/api/media-lib'].list.filter((r) => r.kind === kind) : FIX['/api/media-lib'].list;
      FIX['/api/media-lib/filtered'] = { ok: true, total: rows.length, list: rows };
    }
    /* dynamic fixtures: 5I — freshness save persists the hours */
    if (method === 'POST' && p === '/api/freshness') {
      const b = JSON.parse(opts.body || '{}');
      FIX['/api/freshness'] = { ok: true, hours: Math.max(0, Math.min(720, Number(b.hours) || 0)) };
    }
    let body;
    if (p.startsWith('/api/whatsapp/')) body = { list: [] };
    else if (p === '/api/aikey') body = { ok: true };
    else if (p.startsWith('/icons/')) return { ok: true, status: 200, text: async () => '<svg></svg>', json: async () => ({}) };
    else if (p.startsWith('/fonts/')) return { ok: true, status: 200, text: async () => '', json: async () => ({}) };
    else if (p === '/api/audit') body = FIX['/api/audit/filtered'] || FIX['/api/audit'];
    else if (p === '/api/panic/stop' || p === '/api/panic/restore') body = FIX['/api/panic/result'];
    else if (p === '/api/backup/restore') body = FIX['/api/backup/restore/result'];
    else if (p === '/api/storage/cleanup') body = FIX['/api/storage/cleanup'];
    else if (p === '/api/security' && method === 'POST') body = FIX['/api/security/result'];
    else if (method === 'POST' && p === '/api/inbox/labels') body = FIX['/api/inbox/labels/result'];
    else if (method === 'POST' && /^\/api\/inbox\/[^/]+\/pin$/.test(p)) body = FIX['/api/inbox/pinresult'];
    else if (method === 'POST' && p === '/api/inbox/scheduled') body = FIX['/api/inbox/scheduled/result'];
    else if (method === 'POST' && p === '/api/inbox/quick-replies') body = FIX['/api/inbox/quick-replies/result'];
    else if (method === 'POST' && p === '/api/contacts/tags') body = FIX['/api/contacts/tags/result'];
    else if (method === 'POST' && p === '/api/broadcast') body = FIX['/api/broadcast/result'];
    else if (method === 'POST' && /^\/api\/broadcast\/\d+\/send$/.test(p)) body = FIX['/api/broadcast/sendresult'];
    else if (method === 'POST' && p === '/api/guardrates') body = FIX['/api/guardrates/result'];
    else if (method === 'POST' && p === '/api/sources/rss') body = FIX['/api/sources/rss/result'];
    else if (method === 'POST' && p === '/api/webhooks') body = FIX['/api/webhooks/result'];
    else if (method === 'POST' && /^\/api\/webhooks\/\d+\/enable$/.test(p)) body = FIX['/api/webhooks/toggle'];
    else if (method === 'POST' && /^\/api\/webhooks\/\d+\/test$/.test(p)) body = FIX['/api/webhooks/testresult'];
    else if (method === 'POST' && /^\/api\/webhooks\/\d+\/delete$/.test(p)) body = FIX['/api/webhooks/delresult'];
    else if (method === 'POST' && p === '/api/wacommand') body = FIX['/api/wacommand/result'];
    else if (method === 'POST' && p === '/api/autopilot') body = FIX['/api/autopilot/result'];
    else if (method === 'POST' && p === '/api/evergreen') body = FIX['/api/evergreen/result'];
    else if (method === 'POST' && p === '/api/plan-week') body = FIX['/api/plan-week/result'];
    else if (p === '/api/media-lib' && method === 'GET') body = FIX['/api/media-lib/filtered'] || FIX['/api/media-lib'];
    else if (p === '/api/browse/channels' && method === 'GET') body = FIX['/api/browse/channels/result'] || FIX['/api/browse/channels'];
    else if (method === 'POST' && p === '/api/browse/follow') { FIX['/api/browse/follow'] = { ok: true, name: 'Followed Test', addedToSources: true, inSources: true, code: 'bc02', jid: '1203630000000000001@newsletter' }; body = FIX['/api/browse/follow']; }
    else if (method === 'POST' && p === '/api/sources/sync-followed') { FIX['/api/sources/sync-followed'] = { ok: true, added: ['Phone Followed Channel'], count: 1 }; body = FIX['/api/sources/sync-followed']; }
    else if (method === 'POST' && p === '/api/browse/unfollow') { FIX['/api/browse/unfollow'] = { ok: true, name: 'Unfollowed Test', removedFromSources: true }; body = FIX['/api/browse/unfollow']; }
    else if (method === 'POST' && p === '/api/browse/add-source') { FIX['/api/browse/add-source'] = { ok: true, name: 'Source Test' }; body = FIX['/api/browse/add-source']; }
    else if (p in FIX) body = FIX[p];
    else body = { ok: true };
    return { ok: true, status: 200, headers: { get: () => null }, json: async () => JSON.parse(JSON.stringify(body)), text: async () => JSON.stringify(body), blob: async () => new w.Blob([JSON.stringify(body)]) };
  };
  w.EventSource = class { constructor() {} close() {} addEventListener() {} removeEventListener() {} };
  /* Determinism: the app's 8s live-refresh ticks (WA tab + assistant history) are real
     timers that re-render views while the suite is mid-assertion; they are live-server
     behavior, not DOM contract, so the suite neutralizes only the 8000ms registrations. */
  const _si = w.setInterval.bind(w);
  w.setInterval = (fn, ms, ...a) => (Number(ms) === 8000 ? 0 : _si(fn, ms, ...a));
  w.eval(appJs);
  d.dispatchEvent(new w.Event('DOMContentLoaded', { bubbles: true }));
  await sleep(700);

  /* ---------- shell structure (Meridian 2 — 23 content screens + 5 settings sections) ---------- */
  const views = d.querySelectorAll('section.view');
  ok(views.length === 25, '25 view sections rendered (23 screens + settings + home) (got ' + views.length + ')');
  const have = new Set([...views].map((v) => v.dataset.view));
  const need = ['home', 'sources', 'browse', 'targets', 'routing', 'newpost', 'scheduled', 'media', 'branding', 'approvals', 'posts', 'aipilot', 'aireply', 'digest', 'guardrails', 'whatsapp', 'journal', 'bulk', 'email', 'analytics', 'health', 'logs', 'audit', 'settings', 'about'];
  const missing = need.filter((n) => !have.has(n));
  ok(missing.length === 0, 'all Meridian 2 contract views present (missing: ' + (missing.join(',') || 'none') + ')');
  ok(!have.has('calendar') && !have.has('templates') && !have.has('beautify'), 'old calendar/templates/beautify screens regrouped (gone)');
  /* Signal Desk (v9.0.0, product spec §1.3) — 8 groups, 25 screens, no inner-tab row */
  ok(d.querySelectorAll('#sidebar .sb-group').length === 8, 'sidebar has 8 IA groups (got ' + d.querySelectorAll('#sidebar .sb-group').length + ')');
  ok(d.querySelectorAll('#sidebar .sb-item').length === 25, 'sidebar has 25 screen items (got ' + d.querySelectorAll('#sidebar .sb-item').length + ')');
  /* v11: Signal Desk letter-square nav chips (mockup 00/01) */
  ok(d.querySelectorAll('#sidebar .sb-item .sb-glyph').length === 25, 'v11: letter-square chip on every sidebar item (got ' + d.querySelectorAll('#sidebar .sb-item .sb-glyph').length + ')');
  ok(d.querySelector('#sidebar .sb-item[data-view="home"] .sb-glyph').textContent === 'H', 'v11: Home chip = H');
  ok(d.querySelector('#sidebar .sb-item[data-view="aipilot"] .sb-glyph').textContent === 'AI', 'v11: AI Pilot chip = AI (two letters)');
  const grpItems = (g) => [...d.querySelectorAll('#' + g + 'Items .sb-item')].map((b) => b.dataset.view);
  ok(JSON.stringify(grpItems('gCommand')) === JSON.stringify(['home']), 'COMMAND = Home');
  ok(JSON.stringify(grpItems('gBroadcast')) === JSON.stringify(['newpost', 'approvals', 'scheduled', 'posts', 'bulk']), 'BROADCAST = Compose/Queue/Scheduled/History/Bulk Send');
  ok(JSON.stringify(grpItems('gChannels')) === JSON.stringify(['sources', 'targets', 'browse', 'routing']), 'CHANNELS = Sources/Targets/Discover/Routing');
  ok(JSON.stringify(grpItems('gPeople')) === JSON.stringify(['whatsapp', 'journal', 'aireply']), 'PEOPLE = WhatsApp Inbox/Contacts/Auto-replies');
  ok(JSON.stringify(grpItems('gStudio')) === JSON.stringify(['media', 'branding']), 'STUDIO = Library/Brand');
  ok(JSON.stringify(grpItems('gIntelligence')) === JSON.stringify(['aipilot', 'guardrails']), 'INTELLIGENCE = AI Pilot/Rules');
  ok(JSON.stringify(grpItems('gInsights')) === JSON.stringify(['analytics', 'digest', 'health', 'logs', 'audit']), 'INSIGHTS = Analytics/Reports & Digest/Health/Logs/Audit');
  ok(JSON.stringify(grpItems('gSystem')) === JSON.stringify(['email', 'settings', 'about']), 'SYSTEM = Email/Settings/About');
  ok(d.getElementById('inav') === null, 'no inner-tab row (every screen lives in the 8-group sidebar)');
  ok(d.querySelectorAll('.btabs .bt').length === 5, 'mobile bottom bar = Home/Queue/Compose(fab)/Channels/More (5 items)');
  ok(!!d.querySelector('.btabs .bt-fab[data-view="newpost"]'), 'raised center Compose FAB');
  ok(d.getElementById('recentStrip') !== null, 'Recent strip present (last 3)');
  ok(d.getElementById('sbPanicStatus') !== null, 'sidebar footer panic status present');
  ok(d.getElementById('viewTitle') && d.getElementById('viewTitle').textContent.length > 0, 'topbar title populated');

  /* Signal Desk §1.9/§7 — exactly 33 mutable switches, read-only chips elsewhere */
  await sleep(400);
  ok(d.querySelectorAll('.sw-card input[data-key]').length === 33, 'exactly 33 switch controls exist (no 34th) (got ' + d.querySelectorAll('.sw-card input[data-key]').length + ')');
  const homeChips = d.getElementById('homeSwitchChips');
  ok(homeChips && homeChips.querySelectorAll('.rosw[data-chipkey]').length >= 3, 'Home shows read-only automation chips');
  ok(homeChips && homeChips.querySelectorAll('.rosw input').length === 0, 'chips carry no controls (non-interactive)');
  const chipKey = homeChips && homeChips.querySelector('.rosw[data-chipkey]');
  if (chipKey) {
    const chipTargets = { queue: 'approvals', scheduler: 'scheduled', digest: 'digest' };
    const target = chipTargets[chipKey.dataset.chipkey];
    chipKey.click();
    await sleep(300);
    ok(d.querySelector('.view:not([hidden])').dataset.view === target, 'chip deep-links to its owner screen (' + chipKey.dataset.chipkey + ' → ' + target + ')');
    d.querySelector('#sidebar .sb-item[data-view="home"]').click();
    await sleep(250);
  }
  ok(d.querySelector('.sb-item[data-view="home"]').classList.contains('on'), 'active sidebar item carries the on state');
  ok(d.querySelector('#sidebar .sb-group[data-group="command"]').classList.contains('on'), 'active group is flagged');

  /* ---------- Meridian 2: first-run wizard (auto-opens, skippable, resumable) ---------- */
  await sleep(1500); // wait for the wizard state tick (settings + status + overview)
  const wizScrim = d.getElementById('wizScrim');
  ok(!wizScrim.hidden, 'M2: first-run wizard auto-opens on a fresh setup (setupDone=false)');
  ok(d.querySelectorAll('#wizDots .wiz-dot').length === 5, 'M2: wizard shows 5 steps (dots)');
  ok(d.getElementById('wizTitle').textContent === 'Welcome', 'M2: wizard opens on Welcome');
  d.getElementById('wizSkip').click();
  await sleep(200);
  ok(wizScrim.hidden, 'M2: wizard is skippable');
  ok(!!d.getElementById('wizPill') && !d.getElementById('wizPill').hidden, 'M2: skipped wizard stays resumable via the pill');
  d.getElementById('wizPill').click();
  await sleep(200);
  ok(!wizScrim.hidden, 'M2: the pill re-opens the wizard');
  d.getElementById('wizNext').click();
  await sleep(200);
  ok(d.getElementById('wizTitle').textContent === 'Link WhatsApp' && d.getElementById('wizStepLbl').textContent === '2 of 5', 'M2: Next advances to Link WhatsApp (2 of 5)');
  d.getElementById('wizSkip').click();
  await sleep(200);

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

  /* ---------- v7.7.3 · Refresh = a real WhatsApp follow-state check ---------- */
  const srcGetsBefore = calls.filter((c) => c.path === '/api/sources').length;
  d.getElementById('srcRefresh').click();
  await sleep(1100); // rescan + its in-flight list refresh fully settle before we mutate fixtures
  ok(calls.some((c) => c.method === 'POST' && c.path === '/api/directory/rescan'), 'v7.7.3: Refresh POSTs /api/directory/rescan (asks WhatsApp, not just the DB)');
  ok(calls.filter((c) => c.path === '/api/sources').length > srcGetsBefore, 'v7.7.3: after the check the list is re-fetched + re-rendered');
  const origSrc = FIX['/api/sources'].list.slice();
  FIX['/api/sources'].list = [];
  d.querySelector('.sb-item[data-view="sources"]').click();
  await sleep(600);
  const emptyTbody = d.querySelector('#srcTable tbody');
  ok(!!emptyTbody && (emptyTbody.textContent || '').includes('Refresh'), 'v7.7.3: sources empty state renders a real message (not "undefined") with the Refresh hint');
  const origTgt = FIX['/api/targets'].list.slice();
  FIX['/api/targets'].list = [];
  d.querySelector('.sb-item[data-view="targets"]').click();
  await sleep(600);
  ok((d.querySelector('#tgtTable tbody').textContent || '').includes('No targets yet'), 'v7.7.3: targets empty state renders a real message (not "undefined")');
  FIX['/api/sources'].list = origSrc;
  FIX['/api/targets'].list = origTgt;
  d.querySelector('.sb-item[data-view="sources"]').click();
  await sleep(600);

  /* ---------- v7.8.0 · Browse channels ---------- */
  d.querySelector('.sb-item[data-view="browse"]').click();
  await sleep(800);
  ok(!!d.querySelector('.view[data-view="browse"]') && !d.querySelector('.view[data-view="browse"]').hidden, 'v7.8.0: Browse view opens from the sidebar');
  ok(d.querySelectorAll('#brwList .brw-row').length === 12, 'v7.8.0: first page renders 12 channels');
  ok(!!d.querySelector('#brwCats .chip.on') && d.querySelector('#brwCats .chip.on').textContent === 'All', 'v7.8.0: "All" category active by default');
  const sportsChip = [...d.querySelectorAll('#brwCats .chip')].find((c) => c.textContent === 'Sports');
  sportsChip.click();
  await sleep(500);
  let brwRows = d.querySelectorAll('#brwList .brw-row');
  ok(brwRows.length > 0 && [...brwRows].every((r) => r.querySelector('.b').textContent === 'Sports'), 'v7.8.0: Sports chip filters to sports channels only');
  const cSel = d.getElementById('brwCountry');
  cSel.value = 'Pakistan';
  cSel.dispatchEvent(new d.defaultView.Event('change'));
  await sleep(500);
  brwRows = d.querySelectorAll('#brwList .brw-row');
  ok(brwRows.length > 0 && brwRows.length < 12, 'v7.8.0: Pakistan country filter narrows the list');
  [...d.querySelectorAll('#brwCats .chip')].find((c) => c.textContent === 'All').click();
  await sleep(400);
  cSel.value = '';
  cSel.dispatchEvent(new d.defaultView.Event('change'));
  await sleep(500);
  const sInp = d.getElementById('brwSearch');
  sInp.value = 'cricket';
  sInp.dispatchEvent(new d.defaultView.Event('input'));
  await sleep(800); // 300 ms debounce + fetch
  brwRows = d.querySelectorAll('#brwList .brw-row');
  ok(brwRows.length > 0 && brwRows.length < 12, 'v7.8.0: search narrows the list in place');
  sInp.value = '';
  sInp.dispatchEvent(new d.defaultView.Event('input'));
  await sleep(800);
  ok(d.querySelectorAll('#brwList .brw-row').length === 12, 'v7.8.0: full list restored (12 on page 1)');
  const content = d.getElementById('content');
  content.dispatchEvent(new d.defaultView.Event('scroll'));
  await sleep(500);
  ok(d.querySelectorAll('#brwList .brw-row').length === 24, 'v7.8.0: scrolling near the bottom loads page 2 (12 → 24)');
  content.dispatchEvent(new d.defaultView.Event('scroll'));
  await sleep(500);
  ok(d.querySelectorAll('#brwList .brw-row').length === 26, 'v7.8.0: next scroll finishes the list (24 → 26)');
  ok(!d.getElementById('brwEnd').hidden, 'v7.8.0: end card appears when the list is exhausted');
  /* v7.9: row 1 (bc01) is followed on the phone but not a Source yet → offers "Add to Sources" */
  const bc01row = d.querySelector('.brw-row[data-code="bc01"]');
  const addBtn = bc01row && bc01row.querySelector('[data-brw="addsource"]');
  ok(!!addBtn, 'v7.9: followed-but-not-source row offers "Add to Sources"');
  addBtn.click();
  await sleep(700);
  ok(calls.some((c) => c.method === 'POST' && c.path === '/api/browse/add-source'), 'v7.8.0: "Add to Sources" POSTs /api/browse/add-source');
  const bc01after = d.querySelector('.brw-row[data-code="bc01"]');
  ok(!!bc01after && bc01after.textContent.includes('in Sources'), 'v7.9: row shows "in Sources ✓" in place after add');
  /* v7.9: Follow = follow + Sources in ONE action (no second click needed) */
  const followBtn = d.querySelector('#brwList .brw-row [data-brw="follow"]');
  const brwCode = followBtn.closest('.brw-row').dataset.code;
  followBtn.click();
  await sleep(700);
  ok(calls.some((c) => c.method === 'POST' && c.path === '/api/browse/follow'), 'v7.8.0: Follow POSTs /api/browse/follow');
  const rowAfter = d.querySelector(`.brw-row[data-code="${brwCode}"]`);
  ok(!!rowAfter && rowAfter.textContent.includes('following'), 'v7.8.0: row flips to "following" in place (N1)');
  ok(!!rowAfter && rowAfter.textContent.includes('in Sources'), 'v7.9: Browse-Follow adds the channel to Sources at once');
  const unfBtn = rowAfter && rowAfter.querySelector('[data-brw="unfollow"]');
  unfBtn.click();
  await sleep(700);
  ok(calls.some((c) => c.method === 'POST' && c.path === '/api/browse/unfollow'), 'v7.8.0: Unfollow POSTs /api/browse/unfollow');
  const rowAfter3 = d.querySelector(`.brw-row[data-code="${brwCode}"]`);
  ok(!!rowAfter3 && !!rowAfter3.querySelector('[data-brw="follow"]'), 'v7.8.0: row flips back to Follow in place');
  const linkInp = d.getElementById('brwLink');
  linkInp.value = 'https://whatsapp.com/channel/0029VaSomePastedCode999';
  d.getElementById('brwLinkFollow').click();
  await sleep(700);
  const pastedCall = calls.filter((c) => c.method === 'POST' && c.path === '/api/browse/follow').pop();
  ok(pastedCall && JSON.parse(pastedCall.body).link.includes('whatsapp.com/channel/'), 'v7.8.0: paste-a-link Follow POSTs the full link');
  ok(d.getElementById('brwSyncTime').textContent.startsWith('Last synced'), 'v7.8.0: "Last synced" stamp updates (N1b)');
  ok(d.getElementById('brwFootCount').textContent.length > 0, 'v7.9: the honest footnote shows the live directory size');
  d.querySelector('.sb-item[data-view="sources"]').click();
  await sleep(500);

  /* ---------- v7.9 · Followed channels land in Sources in one click ---------- */
  FIX['/api/sources'].followedMissing = [{ jid: '1203630000000000077@newsletter', name: 'Phone Followed Channel' }];
  d.querySelector('.sb-item[data-view="sources"]').click();
  await sleep(700);
  const banner = d.getElementById('srcSyncBanner');
  ok(!!banner && !banner.hidden && (banner.textContent || '').includes('Phone Followed Channel'), 'v7.9: Sources shows a banner for followed channels not in Sources yet');
  d.getElementById('srcSyncAll').click();
  FIX['/api/sources'].followedMissing = []; // the post-sync re-fetch sees an empty list
  await sleep(700);
  ok(calls.some((c) => c.method === 'POST' && c.path === '/api/sources/sync-followed'), 'v7.9: "Add all" POSTs /api/sources/sync-followed');
  const bannerAfter = d.getElementById('srcSyncBanner');
  ok(!bannerAfter || bannerAfter.hidden, 'v7.9: banner hides once the followed channels are in Sources');

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
  /* v11: dark → light → glass → auto cycle; settings offers the Glass pill */
  ok(!!d.querySelector('#themeRadios [data-theme-choice="glass"]'), 'v11: settings offers the Glass theme');
  d.getElementById('themeBtn').click();
  await sleep(100);
  ok(d.documentElement.getAttribute('data-theme') === 'glass', 'v11: cycle reaches the glass theme (applied)');
  ok(w.localStorage.getItem('rc-theme') === 'glass', 'v11: glass theme persisted');
  d.getElementById('themeBtn').click();
  await sleep(100);
  ok(w.localStorage.getItem('rc-theme') === 'auto', 'v11: cycle wraps to System (auto)');
  w.localStorage.setItem('rc-theme', 'dark');
  d.documentElement.setAttribute('data-theme', 'dark');

  /* ---------- palette ---------- */
  d.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true, cancelable: true }));
  await sleep(150);
  ok(!d.getElementById('palScrim').hidden, 'Ctrl+K opens the command palette');
  const palIn = d.getElementById('palInput');
  palIn.value = 'que';
  palIn.dispatchEvent(new w.Event('input', { bubbles: true }));
  await sleep(150);
  const palItems = [...d.querySelectorAll('#palList .pal-i')];
  ok(palItems.length >= 1 && palItems[0].textContent.toLowerCase().includes('queue'), 'fuzzy filter (que → Queue first)');
  ok(palItems[0].classList.contains('on'), 'first palette item highlighted');
  d.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  await sleep(300);
  ok(d.getElementById('palScrim').hidden && !d.querySelector('section.view[data-view="approvals"]').hidden, 'Enter runs the palette item (jumps to Queue)');
  d.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true, cancelable: true }));
  await sleep(100);
  d.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  await sleep(100);
  ok(d.getElementById('palScrim').hidden, 'Esc closes palette');

  /* ---------- templates v2 (regrouped into Publish · Library) ---------- */
  d.querySelector('.sb-item[data-view="media"]').click();
  await sleep(600);
  ok(!d.querySelector('.view[data-view="media"]').hidden, 'Library (media) view reachable');
  ok(d.getElementById('swLibrary') !== null, 'Library hosts the announcement-cards switch box');
  ok(d.querySelectorAll('#tplGrid .tpl-row').length === 2, 'templates grid renders 2 templates (inside Library)');
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
  /* v11: Signal Desk queue card — letter-square source + real target chips + Discard label */
  ok(qi && !!qi.querySelector('.q-avatar') && qi.querySelector('.q-avatar').textContent === 'AN', 'v11: queue card shows the source letter-square (Alpha News → AN)');
  ok(qi && !!qi.querySelector('.q-tchip') && qi.querySelector('.q-tchip').textContent.trim() === '1 target' && qi.querySelector('.q-tchip').title.includes('Beta Updates'), 'v11: queue card shows the target count, real name in the hover title (not a jid)');
  ok(qi && qi.querySelector('[data-q="reject"]').textContent.trim() === 'Discard', 'v11: discard label on the queue row (action unchanged)');
  ok(d.querySelectorAll('#queueChips .qchip').length === 3, 'v11: queue filter chips (All / Pending / Held)');
  ok(d.getElementById('queueChips').textContent.includes('All · 01') && d.getElementById('queueChips').textContent.includes('Pending · 01'), 'v11: filter chips carry the real counts (fixture: 1 ready)');
  d.querySelector('#queueChips .qchip[data-qf="held"]').click();
  await sleep(80);
  ok(qi.hidden, 'v11: Held filter hides the ready row (client-side, nothing lost)');
  d.querySelector('#queueChips .qchip[data-qf="all"]').click();
  await sleep(80);
  ok(!qi.hidden, 'v11: All filter restores the row');
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

  /* ---------- 26 switches (distributed to their home views) ---------- */
  /* ---------- Meridian 2: the 33 switches, one home each (spec table) ---------- */
  const swCount = d.querySelectorAll('.sw-card input[data-key]').length;
  ok(swCount === 33, 'all 33 switches rendered (got ' + swCount + ')');
  const keyCounts = {};
  d.querySelectorAll('.sw-card input[data-key]').forEach((i) => { keyCounts[i.dataset.key] = (keyCounts[i.dataset.key] || 0) + 1; });
  const dupes = Object.entries(keyCounts).filter(([k, n]) => n !== 1).map(([k]) => k);
  ok(dupes.length === 0, 'one home per switch — no switch rendered twice (dupes: ' + (dupes.join(',') || 'none') + ')');
  const has = (box, key) => !!d.querySelector(box + ' input[data-key="' + key + '"]');
  ok(has('#swGeneral', 'dedupe') && has('#swGeneral', 'crossdedupe') && has('#swGeneral', 'dedsplit') && has('#swGeneral', 'polltext') && has('#swGeneral', 'smartmedia'), 'General (Settings) hosts the 5 post-shaping switches');
  ok(has('#swBrand', 'beautify') && has('#swBrand', 'headers') && has('#swBrand', 'hashtags') && has('#swBrand', 'signature') && has('#swBrand', 'translate') && has('#swBrand', 'tldr') && has('#swBrand', 'autobold') && has('#swBrand', 'emojibullets') && has('#swBrand', 'linktools'), 'Brand (Publish) hosts the 9 formatting switches');
  ok(has('#swAipilot', 'aipilot') && has('#swAipilot', 'scheduler') && has('#swAipilot', 'evergreen') && has('#swAipilot', 'autopilot'), 'Pilot (Automate) hosts aipilot/scheduler/evergreen/autopilot');
  ok(has('#swRules', 'aisafety'), 'Rules (Automate) hosts the AI safety screen');
  ok(has('#swDigest', 'digest') && has('#swRecap', 'recap') && has('#swWeekly', 'weekly') && has('#swInstantalerts', 'instantalerts'), 'Reports and Digest hosts digest/recap/weekly/instant alerts');
  ok(has('#swAireply', 'aireply') && has('#swAireply', 'transcribe') && has('#swReplyKb', 'replykb'), 'Replies (Inbox) hosts auto-reply/transcription/KB');
  ok(has('#swQueue', 'queue'), 'Queue header hosts the approval-queue switch');
  ok(has('#swPosts', 'editposts'), 'History header hosts Edit posts (experimental)');
  ok(has('#swRouting', 'routing') && has('#swRouting', 'matrix'), 'Routing hosts smart routing + matrix');
  ok(has('#swAnalytics', 'analytics'), 'Analytics hosts the analytics switch');
  ok(has('#swLibrary', 'announcard'), 'Library hosts announcement cards');
  ok(has('#swWaCommand', 'waCommand'), 'Settings · WhatsApp hosts the WA command channel');
  const swOn = d.querySelectorAll('.sw-card input[data-key]:checked').length;
  ok(swOn === 1 && !!d.querySelector('#swBrand input[data-key="beautify"]:checked'), 'switch states match /api/power (AI rewrite only, all else OFF by default)');
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
  /* v11: KPI sparklines come from the REAL hourly buckets (no fabricated history) */
  ok(!!d.querySelector('#kpiGrid .kpi-drag[data-kpi="published"] .k-spark'), 'v11: Published-today KPI carries the hourly sparkline');
  ok(!!d.querySelector('#kpiGrid .kpi-drag[data-kpi="failed"] .k-spark'), 'v11: Failed-today KPI carries the hourly sparkline');
  ok(!d.querySelector('#kpiGrid .kpi-drag[data-kpi="wa"] .k-spark'), 'v11: no sparkline where there is no real history (WA card)');
  ok(!!d.querySelector('#homeChartSvg svg'), 'v11: home Activity (last 24 h) chart renders from the hourly fixture');
  ok(!!d.querySelector('#homePaceBody .pace-chip'), 'v11: pacing panel shows the real Adaptive mode chip');
  ok(d.querySelectorAll('#homeHealth .hseg').length >= 4, 'v11: home health renders one segment per real check (got ' + d.querySelectorAll('#homeHealth .hseg').length + ')');
  ok(d.getElementById('homeQueue').textContent.includes('pending approval'), 'v11: queue glance paints from the live queue fixture');

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

  /* ---------- analytics (v2, 5D R61–R63) ---------- */
  d.querySelector('.sb-item[data-view="analytics"]').click();
  await sleep(800);
  ok(d.querySelectorAll('#anChart .bar-col').length === 2, 'analytics daily bars render (2 days)');
  ok(d.querySelectorAll('#anKpis .kpi').length === 4, '5D: four KPIs (published / skipped / failed / edited)');
  ok(!!d.querySelector('#anHeat svg'), '5D: hourly heatmap is inline SVG (no canvas, no CDN)');
  const tgtRow = d.querySelector('#anTargets tbody tr');
  ok(!!tgtRow && tgtRow.textContent.includes('Beta Updates'), '5D: per-target table names targets (not jids)');
  ok(d.querySelectorAll('#anMedia .kpi').length === 2, '5D: media-vs-text KPIs');
  const reasonRow = d.querySelector('#anReasons .reason-row');
  ok(!!reasonRow && reasonRow.textContent.includes('near-duplicate'), '5D: skip-reason bars render');
  const boardRow = d.querySelector('#anBoard tbody tr');
  ok(!!boardRow && boardRow.textContent.includes('Alpha News'), '5D: leaderboard names the source');
  ok(!!boardRow && !!boardRow.querySelector('svg'), '5D: leaderboard row has a 7-day sparkline (inline SVG)');
  ok(!!boardRow && !!boardRow.querySelector('.share-bar'), '5D: leaderboard share bar');
  ok(d.getElementById('goalGlobal').value === '10' && d.getElementById('goalGlobalNow').textContent.includes('4'), '5D: global daily goal + today counter');
  const goalRow = d.querySelector('#anGoals tbody tr[data-gjid]');
  ok(!!goalRow && goalRow.querySelector('.g-n').value === '5' && !!goalRow.querySelector('.g-del'), '5D: per-source goal row (editable + removable)');
  ok(d.getElementById('weeklyAt').value === 'Mon 09:00' && d.getElementById('weeklyLast').textContent.includes('never'), '5D: weekly card populated from /api/weekly');
  ok(d.getElementById('weeklyPreview').textContent.includes('+923001234567'), '5D: weekly preview names the report phone');
  ok(d.getElementById('anSources').textContent.includes('Alpha News'), 'by-source names (not jids)');
  ok(!!d.getElementById('anCsv') && !!d.getElementById('anPdf'), '5D: CSV + PDF export controls');
  ok(!!d.querySelector('#swWeekly .sw-card input[data-key="weekly"]'), '5D: Weekly report switch lives on this view');
  ok(!!d.querySelector('#swInstantalerts .sw-card input[data-key="instantalerts"]'), '5D: Instant alerts switch lives on this view');
  ok(d.querySelector('#swWeekly input[data-key="weekly"]').checked === false && d.querySelector('#swInstantalerts input[data-key="instantalerts"]').checked === false, '5D: both new switches OFF by default (R8)');
  d.getElementById('alertTest').click();
  await sleep(300);
  ok(d.getElementById('alertTestResult').textContent.includes('off'), '5D: test alert reports why it was not sent (switch off)');

  /* ---------- WhatsApp mirror smoke (official look, behavior 1:1) ---------- */
  d.querySelector('.sb-item[data-view="whatsapp"]').click();
  await sleep(600);
  const waView = d.querySelector('section.view[data-view="whatsapp"]');
  ok(waView && waView.querySelector('.ww'), 'WhatsApp mirror renders the official .ww shell');
  ok(d.getElementById('waNumBand') && d.getElementById('waNumBand').textContent.includes('+923001234567'), 'number band shows the linked number (+92…)');
  ok(!waView.textContent.includes('undefined'), 'mirror has no "undefined"');

  /* ---------- journal + health (v2, 5D R64–R65) ---------- */
  d.querySelector('.sb-item[data-view="journal"]').click();
  await sleep(400);
  ok(d.getElementById('watchTable').textContent.includes('Test contact'), 'journal (watched numbers) renders');
  d.querySelector('.sb-item[data-view="health"]').click();
  await sleep(600);
  ok(!!d.querySelector('#scoreDial svg'), '5D: health score dial is inline SVG');
  ok(d.getElementById('scoreWeakest').textContent.includes('AI key') && d.getElementById('scoreWeakest').textContent.includes('Cloud memory'), '5D: the two weakest parts are named');
  ok(d.querySelectorAll('#healthParts .part-row').length === 8, '5D: all 8 health parts rendered with bars');
  ok(d.querySelectorAll('#selftestHist tbody tr').length === 1, '5D: past self-test runs listed');
  ok(d.getElementById('upKpis').textContent.includes('2'), 'health KPIs render');
  d.getElementById('selftestRun').click();
  await sleep(500);
  ok(d.querySelectorAll('#selftestTable tbody tr').length === 11, '5D: full self-test lists all 11 checks');
  ok(d.querySelectorAll('#selftestTable .b-err').length === 2, '5D: honest FAILs shown (WA socket + AI key)');
  ok(d.getElementById('selftestMeta').textContent.includes('10/11'), '5D: run summary line (10/11 passed)');
  ok(d.querySelectorAll('#selftestHist tbody tr').length === 1, '5D: history refreshed after the run (fixture keeps 1 row)');

  /* ---------- 5D (R66) · notification center ---------- */
  d.getElementById('notifBtn').click();
  await sleep(400);
  ok(d.getElementById('notifPanel').hidden === false, '5D: bell opens the notification panel');
  ok(d.getElementById('notifBadge').hidden === false && d.getElementById('notifBadge').textContent === '1', '5D: bell badge shows the unread count');
  ok(d.querySelectorAll('#notifList .notif-item').length === 2, '5D: notifications listed newest-first');
  ok(d.querySelectorAll('#notifList .notif-item.unread').length === 1, '5D: unread styled distinctly');
  const unreadItem = d.querySelector('#notifList .notif-item.unread');
  unreadItem.click();
  await sleep(300);
  ok(d.querySelectorAll('#notifList .notif-item.unread').length === 0, '5D: clicking an unread item marks it read (server-side in the stub too)');
  d.getElementById('notifBtn').click();
  await sleep(150);
  ok(d.getElementById('notifPanel').hidden === true, '5D: bell toggles the panel closed');

  /* ---------- 5D (R67) · FTS5 palette wiring ---------- */
  d.getElementById('palBtn').click();
  await sleep(200);
  const palIn2 = d.getElementById('palInput');
  palIn2.value = 'promo';
  palIn2.dispatchEvent(new w.Event('input', { bubbles: true }));
  await sleep(600);
  const postHits = [...d.querySelectorAll('#palList .pal-i')].filter((i) => i.querySelector('.pal-k').textContent === 'post');
  ok(postHits.length >= 1 && postHits[0].textContent.includes('Big promo'), '5D: palette merges FTS post hits under local matches');
  const logHits = [...d.querySelectorAll('#palList .pal-i')].filter((i) => i.querySelector('.pal-k').textContent === 'log');
  ok(logHits.length >= 1, '5D: palette merges FTS log hits');
  postHits[0].click();
  await sleep(500);
  ok(!d.querySelector('section.view[data-view="posts"]').hidden, '5D: clicking a post hit jumps to History');
  ok(d.getElementById('palScrim').hidden === true, '5D: palette closes after the jump');
  ok(d.getElementById('pfText').value === 'promo', '5D: the full-text filter is preset from the palette query');
  await sleep(500);
  const postRows = d.querySelectorAll('#postsTable tr[data-pid]');
  ok(postRows.length === 1 && postRows[0].dataset.pid === '1', '5D: text filter narrows history to the matching post id=1 (got ' + postRows.length + ')');
  d.getElementById('pfText').value = '';
  d.getElementById('pfText').dispatchEvent(new w.Event('input', { bubbles: true }));
  await sleep(400);
  ok(d.querySelectorAll('#postsTable tr[data-pid]').length === 2, '5D: clearing the filter restores all posts');

  /* ---------- 5E (R69) · audit trail view ---------- */
  d.querySelector('.sb-item[data-view="audit"]').click();
  await sleep(500);
  ok(d.getElementById('viewTitle').textContent === 'Audit', '5E: Audit view opens from the sidebar');
  ok(d.querySelectorAll('#audTable tbody tr').length === 3, '5E: audit rows render (got ' + d.querySelectorAll('#audTable tbody tr').length + ')');
  ok(d.getElementById('audCount').textContent.includes('3 entries'), '5E: entry count line ("' + d.getElementById('audCount').textContent + '")');
  ok(d.querySelector('#audTable tbody tr .b-info') && d.getElementById('audTable').textContent.includes('security.update'), '5E: owner badge + action render');
  d.getElementById('audQ').value = 'queued';
  d.getElementById('audQ').dispatchEvent(new w.Event('input', { bubbles: true }));
  await sleep(300);
  const audFiltered = d.querySelectorAll('#audTable tbody tr');
  ok(audFiltered.length === 1 && audFiltered[0].textContent.includes('post.queued'), '5E: text search narrows the trail (queued → 1 row)');
  d.getElementById('audQ').value = '';
  d.getElementById('audQ').dispatchEvent(new w.Event('input', { bubbles: true }));
  d.getElementById('audActor').value = 'pace';
  d.getElementById('audActor').dispatchEvent(new w.Event('change', { bubbles: true }));
  await sleep(300);
  const audActor = d.querySelectorAll('#audTable tbody tr');
  ok(audActor.length === 1 && audActor[0].textContent.includes('pace.backoff'), '5E: actor filter narrows the trail (pace → 1 row)');
  d.getElementById('audActor').value = '';
  d.getElementById('audActor').dispatchEvent(new w.Event('change', { bubbles: true }));
  await sleep(300);
  ok(!!d.getElementById('audCsv'), '5E: CSV download control');
  const audCsvCall = calls.filter((c) => c.path === '/api/audit').length;
  ok(audCsvCall >= 5, '5E: audit re-queries on every filter change (in-place live sync)');

  /* ---------- 5E (R73) · panic stop ---------- */
  ok(!!d.getElementById('panicBtn') && !d.getElementById('panicBtn').classList.contains('is-panic'), '5E: red Panic button in the topbar (idle)');
  d.getElementById('panicBtn').click();
  await sleep(300);
  let mroot = d.querySelector('#mRoot .mb');
  ok(mroot && mroot.classList.contains('mb-danger') && mroot.textContent.includes('Pause everything'), '5E: panic opens a DANGER confirm modal');
  d.querySelector('#mRoot .mb [data-mprimary]').click();
  await sleep(400);
  const stopCall = calls.find((c) => c.method === 'POST' && c.path === '/api/panic/stop');
  ok(!!stopCall, '5E: "Pause everything" POSTs /api/panic/stop');
  ok(d.getElementById('panicBanner').hidden === false && d.getElementById('panicBanner').textContent.includes('Panic stop active'), '5E: the global banner appears on every view');
  ok(d.getElementById('panicSince').textContent.includes('since'), '5E: banner shows since when');
  ok(d.getElementById('panicBtn').classList.contains('is-panic'), '5E: the button turns solid red while active');
  ok(!!d.getElementById('panicRestore'), '5E: banner carries its own restore button');
  d.querySelector('.sb-item[data-view="sources"]').click();
  await sleep(300);
  ok(d.getElementById('panicBanner').hidden === false, '5E: banner persists across views (global, not per-view)');
  d.getElementById('panicBtn').click();
  await sleep(300);
  mroot = d.querySelector('#mRoot .mb');
  ok(mroot && mroot.textContent.includes('Restore previous state'), '5E: clicking while active offers the exact restore');
  d.querySelector('#mRoot .mb [data-mprimary]').click();
  await sleep(400);
  ok(!!calls.find((c) => c.method === 'POST' && c.path === '/api/panic/restore'), '5E: restore POSTs /api/panic/restore');
  ok(d.getElementById('panicBanner').hidden === true && !d.getElementById('panicBtn').classList.contains('is-panic'), '5E: banner gone + button back to idle after restore');

  /* ---------- 5E (R74) · adaptive-pacing strip ---------- */
  d.querySelector('.sb-item[data-view="home"]').click();
  await sleep(500);
  ok(d.getElementById('paceStrip').hidden === true, '5E: pacing strip hidden while pacing is normal');
  FIX['/api/overview'].pace = { active: true, gapMs: 60000, reason: '4 failed sends in the last 15 min', window: { failed: 4 } };
  d.querySelector('.sb-item[data-view="sources"]').click();
  await sleep(200);
  d.querySelector('.sb-item[data-view="home"]').click();
  await sleep(500);
  ok(d.getElementById('paceStrip').hidden === false && d.getElementById('paceStrip').textContent.includes('Adaptive pacing'), '5E: pacing strip appears on the dashboard when a backoff is active');
  ok(d.getElementById('paceStrip').textContent.includes('60 s') && d.getElementById('paceStrip').textContent.includes('4 failed sends'), '5E: strip names the current gap + the reason');
  FIX['/api/overview'].pace = { active: false, gapMs: 0, reason: '', window: { failed: 0 } };

  /* ---------- 5E (R70) · backup & restore (Settings) ---------- */
  d.querySelector('.sb-item[data-view="settings"]').click();
  await sleep(600);
  ok(!!d.getElementById('bkDownload'), '5E: backup download control');
  ok(!!d.getElementById('bkRestoreFile'), '5E: restore file input');
  ok(d.querySelectorAll('#bkPreTable tbody tr').length === 1 && d.getElementById('bkPreTable').textContent.includes('pre-restore-2026-11-07'), '5E: pre-restore snapshot table lists stored snapshots');
  ok(!!d.querySelector('#bkPreTable a[href*="/api/backup/pre-restore/"]'), '5E: each snapshot has its own download link');
  w.confirm = () => true; // accept the restore confirm (and the cleanup confirms below)
  const bkInput = d.getElementById('bkRestoreFile');
  const fakeZip = { name: 'raqifluz-backup-2026-11-08.zip', arrayBuffer: async () => new ArrayBuffer(64) };
  Object.defineProperty(bkInput, 'files', { value: [fakeZip], configurable: true });
  bkInput.dispatchEvent(new w.Event('change', { bubbles: true }));
  await sleep(500);
  const restoreCall = calls.find((c) => c.method === 'POST' && c.path === '/api/backup/restore');
  ok(!!restoreCall && restoreCall.body instanceof ArrayBuffer, '5E: restore POSTs the zip bytes (raw body)');
  ok(d.getElementById('bkRestoreMsg').textContent.includes('Restored') && d.getElementById('bkRestoreMsg').textContent.includes('pre-restore-2026-11-08'), '5E: success line names the pre-restore snapshot kept');
  ok(d.querySelectorAll('#bkPreTable tbody tr').length === 2, '5E: the new pre-restore snapshot appears in the table (in place)');

  /* ---------- 5E (R71) · security card ---------- */
  ok(d.getElementById('roEnable').checked === false && d.getElementById('loginAlerts').checked === false, '5E: security card reflects the stored state (both off)');
  ok(String(d.getElementById('timeoutMin').value) === '120', '5E: session timeout populated (120 min default)');
  ok(/min 6/.test(d.getElementById('roPass').placeholder), '5E: password field explains the 6-char minimum');
  d.getElementById('roEnable').checked = true;
  d.getElementById('timeoutMin').value = '30';
  d.getElementById('secSave').click();
  await sleep(400);
  const secCall = calls.find((c) => c.method === 'POST' && c.path === '/api/security');
  ok(!!secCall && JSON.parse(secCall.body).ro === true && JSON.parse(secCall.body).timeoutMin === 30, '5E: security save POSTs the new values');
  ok(String(d.getElementById('timeoutMin').value) === '30' && d.getElementById('roEnable').checked === true, '5E: card re-syncs after the save');

  /* ---------- 5E (R72) · storage manager ---------- */
  const stKpis = d.querySelectorAll('#stKpis .kpi');
  ok(stKpis.length === 4, '5E: storage KPI grid has 4 KPIs (db / media / avatars / snapshots)');
  ok(d.getElementById('stKpis').textContent.includes('Database') && d.getElementById('stKpis').textContent.includes('2.0 MB'), '5E: database KPI shows the size');
  ok(d.getElementById('stKpis').textContent.includes('Media (hold)') && d.getElementById('stKpis').textContent.includes('12 posts'), '5E: KPI subs carry row counts');
  ok(!!d.getElementById('clMedia') && !!d.getElementById('clLogs') && !!d.getElementById('clFailed') && !!d.getElementById('clVacuum'), '5E: all four cleanup controls present');
  d.getElementById('clDays').value = '45';
  d.getElementById('clLogs').click();
  await sleep(400);
  const clCall = calls.find((c) => c.method === 'POST' && c.path === '/api/storage/cleanup');
  ok(!!clCall && JSON.parse(clCall.body).kind === 'logs' && JSON.parse(clCall.body).days === 45, '5E: cleanup POSTs the kind + the chosen age');
  ok(d.querySelector('#toasts .toast') && d.getElementById('toasts').textContent.includes('Cleaned logs'), '5E: cleanup result toasts back');

  /* ---------- v8.3.0 · GitHub repo storage gauge (Settings → Storage) ---------- */
  ok(!!d.getElementById('ghGauge') && !!d.getElementById('ghGaugeSize') && !!d.getElementById('ghGaugeDetail') && !!d.getElementById('ghGaugeRefresh'), 'v8.3: GitHub storage gauge block present in the Storage card');
  ok(d.getElementById('ghGaugeSize').textContent.includes('≈') && d.getElementById('ghGaugeSize').textContent.includes('8.3 MB'), 'v8.3: gauge shows the human clone size (≈ 8.3 MB from sizeKb)');
  ok(d.getElementById('ghGaugeDetail').textContent.includes('contactzulfi3402135/raqifluz-bot') && d.getElementById('ghGaugeDetail').textContent.includes('bot-state'), 'v8.3: gauge names the repo + the cloud-memory branch');
  ok(!d.getElementById('ghGauge').textContent.includes('NaN') && !d.getElementById('ghGauge').textContent.includes('undefined'), 'v8.3: gauge renders clean (no NaN/undefined)');
  const ghBefore = calls.filter((c) => c.method === 'GET' && c.path === '/api/storage').length;
  d.getElementById('ghGaugeRefresh').click();
  await sleep(300);
  const ghAfter = calls.filter((c) => c.method === 'GET' && c.path === '/api/storage').length;
  ok(ghAfter > ghBefore, 'v8.3: Refresh re-fetches the storage endpoint (bypasses the 60 s cache)');

  /* ---------- 5E (R71/R75) · live HTTP: public /status + a real readonly session ---------- */
  const pub = await fetch(BASE + '/status');
  const pubJ = await pub.json().catch(() => ({}));
  ok(pub.status === 200 && pubJ.ok === true, '5E: public /status answers WITHOUT auth (' + pub.status + ')');
  const cj2 = (await (await fetch(BASE + '/login', { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ username: 'admin', password: 'test123' }) })).headers.get('set-cookie') || '').split(';')[0];
  await fetch(BASE + '/api/security', { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cj2 }, body: JSON.stringify({ ro: true, password: 'rotest123' }) });
  const lr2 = await fetch(BASE + '/login', { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ username: 'admin', password: 'rotest123' }) });
  const roJ = await lr2.json();
  ok(roJ.ok === true && roJ.role === 'readonly', '5E: the second password logs in as READONLY (JSON role)');
  const roCookie = (lr2.headers.get('set-cookie') || '').split(';')[0];
  const roGet = await fetch(BASE + '/api/overview', { headers: { Cookie: roCookie } });
  ok(roGet.status === 200, '5E: a readonly session can still READ (GET /api/overview → 200)');
  const roPost = await fetch(BASE + '/api/settings', { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: roCookie }, body: JSON.stringify({ botName: 'nope' }) });
  ok(roPost.status === 403, '5E: a readonly session cannot WRITE (POST /api/settings → 403)');
  await fetch(BASE + '/api/security', { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cj2 }, body: JSON.stringify({ ro: false }) }); // leave the gate as it was

  /* ---------- v9.0.0 (repo-slim) · keep-the-repo-small controls + endpoints ---------- */
  ok(!!d.getElementById('slimBox') && !!d.getElementById('slimCompact') && !!d.getElementById('slimKeepDays') && !!d.getElementById('slimKeepSave'), 'repo-slim: "Keep the repo small" box with compact + retention controls');
  const rsSt = await (await fetch(BASE + '/api/storage', { headers: { Cookie: cj2 } })).json();
  ok(typeof rsSt.keepDays === 'number' && rsSt.inboxMedia && typeof rsSt.inboxMedia.bytes === 'number' && typeof rsSt.cloud === 'object' && rsSt.cloud !== null, 'repo-slim: /api/storage carries keepDays + inboxMedia + cloud (no undefined)');
  const rsSet = await fetch(BASE + '/api/storage/keepdays', { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cj2 }, body: JSON.stringify({ days: 21 }) });
  const rsSetJ = await rsSet.json();
  ok(rsSet.status === 200 && rsSetJ.ok === true && /21/.test(rsSetJ.detail), 'repo-slim: retention save POSTs + prunes immediately');
  const rsSt2 = await (await fetch(BASE + '/api/storage', { headers: { Cookie: cj2 } })).json();
  ok(rsSt2.keepDays === 21, 'repo-slim: retention persists (21)');
  await fetch(BASE + '/api/storage/keepdays', { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cj2 }, body: JSON.stringify({ days: 30 }) }); // leave the gate as it was
  const rsCp = await fetch(BASE + '/api/persist/compact', { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cj2 } });
  const rsCpJ = await rsCp.json();
  ok(rsCp.status === 400 && /Cloud memory is not configured/.test(rsCpJ.error), 'repo-slim: compact without cloud config → clean 400 with the fix instruction');
  ok(!JSON.stringify(rsSt).includes('undefined'), 'repo-slim: storage payload contains no undefined values');

  /* ---------- 5F (R79) · Guardrails: regex toggle + per-rule replace + per-target caps ---------- */
  FIX['/api/settings'].blocklistRegex = true;
  FIX['/api/settings'].replaceRules = 'Old Brand=>New Brand\n- bye=>ciao';
  d.querySelector('.sb-item[data-view="guardrails"]').click();
  await sleep(500);
  ok(d.getElementById('setBlocklistRegex') && d.getElementById('setBlocklistRegex').checked === true, '5F: blocklist regex toggle present and mirrors settings');
  const rrRows = d.querySelectorAll('#replaceRulesBox .rr-row');
  ok(rrRows.length === 2, '5F: replace rules render as per-rule rows (got ' + rrRows.length + ')');
  ok(rrRows[0].querySelector('[data-rron]').checked === true && !rrRows[0].classList.contains('off'), '5F: active rule row is enabled');
  ok(rrRows[1].querySelector('[data-rron]').checked === false && rrRows[1].classList.contains('off'), '5F: dash-prefixed rule renders disabled');
  ok(rrRows[0].querySelector('.rr-old').value === 'Old Brand' && rrRows[0].querySelector('.rr-new').value === 'New Brand', '5F: rule rows split find → replace sides');
  rrRows[1].querySelector('[data-rron]').click();
  await sleep(200);
  ok(d.getElementById('setReplace').value.split('\n')[1] === 'bye=>ciao', '5F: enabling a rule strips the dash from the stored text');
  d.getElementById('rrAdd').click();
  await sleep(200);
  ok(d.querySelectorAll('#replaceRulesBox .rr-row').length === 3, '5F: “+ Add a rule” appends a row');
  const grRows = d.querySelectorAll('#grTargetsTable tbody tr');
  ok(grRows.length === 1 && grRows[0].textContent.includes('Beta Updates'), '5F: per-target caps table lists the targets');
  const grInput = d.querySelector('#grTargetsTable [data-gtr]');
  ok(!!grInput && String(grInput.value) === '0', '5F: cap input defaults to 0 (follow global guard)');
  grInput.value = '12';
  d.getElementById('grSave').click();
  await sleep(400);
  const grCall = calls.find((c) => c.method === 'POST' && c.path === '/api/guardrates');
  ok(!!grCall && JSON.parse(grCall.body).targets[NEWS2] === '12', '5F: cap save POSTs the per-target map');
  ok(d.getElementById('toasts').textContent.includes('Per-target rate caps saved'), '5F: cap save toasts back');
  d.getElementById('guardSave').click();
  await sleep(400);
  const gsCall = calls.filter((c) => c.method === 'POST' && c.path === '/api/settings').pop();
  ok(!!gsCall && JSON.parse(gsCall.body).blocklistRegex === true, '5F: guardrails save POSTs the regex flag');

  /* ---------- 5F (R78) · Bulk: saved lists + list name in history ---------- */
  d.querySelector('.sb-item[data-view="bulk"]').click();
  await sleep(500);
  ok(d.getElementById('bcListTable').textContent.includes('Family'), '5F: saved-lists card shows the list');
  ok(d.getElementById('bcListTable').textContent.includes('2'), '5F: list row shows the recipient count');
  ok(d.querySelector('#bulkHistTable tbody').textContent.includes('Family'), '5F: send history shows the list name');
  d.querySelector('#bcListTable [data-act="bc-send"]').click();
  await sleep(300);
  ok(!!d.querySelector('#bcText'), '5F: list-send modal opens with a message box');
  d.querySelector('#bcText').value = 'Salam {name}! Friday sale.';
  d.querySelector('#bcGo').click();
  await sleep(300);
  const cm = d.querySelector('#mRoot .mb [data-mprimary]');
  ok(!!cm && d.querySelector('#mRoot .mb').textContent.includes('Send to all'), '5F: list send asks for confirmation naming the action');
  cm.click();
  await sleep(500);
  const bcSendCall = calls.find((c) => c.method === 'POST' && c.path === '/api/broadcast/5/send');
  ok(!!bcSendCall && JSON.parse(bcSendCall.body).text.includes('Friday sale'), '5F: list send POSTs the message');
  ok(d.getElementById('toasts').textContent.includes('Sent 2/2'), '5F: list send result toasts (sent/total)');
  d.getElementById('bcNewList').click();
  await sleep(300);
  d.querySelector('#bcName').value = 'VIPs';
  d.querySelector('#bcRecips').value = '923001111111\n923002222222';
  d.querySelector('#bcOk').click();
  await sleep(500);
  const bcNewCall = calls.filter((c) => c.method === 'POST' && c.path === '/api/broadcast').pop();
  ok(!!bcNewCall && JSON.parse(bcNewCall.body).name === 'VIPs', '5F: new list POSTs name + recipients');
  ok(d.getElementById('bcListTable').textContent.includes('VIPs'), '5F: the new list appears in the table');

  /* ---------- 5F (R76) · WhatsApp mirror: chat tools ---------- */
  FIX['/api/inbox'].list = [
    { jid: '923009998887@s.whatsapp.net', name: 'Zoe Late', last_at: '2026-11-08T09:00:00', last_text: 'hi', unread: 0, pinned: 0, archived: 0, muted: 0 },
    { jid: '923001112223@s.whatsapp.net', name: 'Ali Raza', last_at: '2026-11-08T08:30:00', last_text: 'hello', unread: 1, pinned: 1, archived: 0, muted: 0 }
  ];
  d.querySelector('.sb-item[data-view="whatsapp"]').click();
  await sleep(600);
  const waRows = d.querySelectorAll('#waChatList .wa-chat');
  ok(waRows.length === 2, '5F: chat list renders both chats');
  ok(waRows[0].dataset.jid === '923001112223@s.whatsapp.net', '5F: the pinned chat floats to the top');
  ok(waRows[0].textContent.includes('📌'), '5F: the pinned chat shows the pin marker');
  waRows[0].click();
  await sleep(700);
  const hbar = d.getElementById('waHBar');
  ok(!hbar.hidden && hbar.querySelectorAll('.wa-hb').length === 5, '5F: chat action bar appears with 5 tools');
  d.querySelector('#waha-pin').click();
  await sleep(400);
  const pinCall = calls.find((c) => c.method === 'POST' && c.path === '/api/inbox/923001112223@s.whatsapp.net/pin');
  ok(!!pinCall, '5F: pin toggle POSTs to the chat');
  ok(d.getElementById('toasts').textContent.includes('unpinned'), '5F: pin toggle toasts the new state');
  d.querySelector('#waha-labels').click();
  await sleep(400);
  const lblRows = d.querySelectorAll('#waLblList .wa-lbl-row');
  ok(lblRows.length === 2 && d.querySelector('#mRoot .mb').textContent.includes('VIP'), '5F: labels modal lists every label with counts');
  lblRows[1].querySelector('input[type=checkbox]').click();
  await sleep(400);
  const lblCall = calls.find((c) => c.method === 'POST' && c.path === '/api/inbox/923001112223@s.whatsapp.net/labels');
  ok(!!lblCall && JSON.parse(lblCall.body).labelId === 2 && JSON.parse(lblCall.body).on === true, '5F: ticking a label POSTs the membership');
  d.querySelector('#mRoot .mb [data-mclose]').click();
  await sleep(200);
  d.querySelector('#waha-export').click();
  await sleep(300);
  const exTxt = d.querySelector('#mRoot .mb a[href*="format=txt"]');
  const exCsv = d.querySelector('#mRoot .mb a[href*="format=csv"]');
  ok(!!exTxt && !!exCsv && decodeURIComponent(exTxt.href).includes('/api/inbox/923001112223@s.whatsapp.net/export'), '5F: export modal offers txt + csv for this chat');
  d.querySelector('#mRoot .mb [data-mclose]').click();
  await sleep(200);
  d.querySelector('#waha-sched').click();
  await sleep(500);
  ok(!!d.querySelector('#wsText') && !!d.querySelector('#wsAt') && !!d.querySelector('#wsRepeat'), '5F: schedule modal has message / time / repeat');
  ok(d.querySelector('#mRoot .mb').textContent.includes('Already scheduled'), '5F: existing scheduled sends are listed in the modal');
  d.querySelector('#wsText').value = 'Good morning! The report is ready.';
  d.querySelector('#wsAt').value = '2026-11-09T09:00';
  d.querySelector('#wsAdd').click();
  await sleep(500);
  const schCall = calls.find((c) => c.method === 'POST' && c.path === '/api/inbox/scheduled');
  ok(!!schCall, '5F: scheduling POSTs the send');
  const schBody = schCall && JSON.parse(schCall.body);
  ok(schBody.jid === '923001112223@s.whatsapp.net' && schBody.localAt === '2026-11-09T09:00' && schBody.repeat === 'once', '5F: scheduled send carries the chat jid + PKT local time + repeat');
  ok(d.getElementById('toasts').textContent.includes('Scheduled'), '5F: schedule success toasts');
  d.querySelector('#waha-media').click();
  await sleep(400);
  const mcells = d.querySelectorAll('#mRoot .mb .wa-mcell');
  ok(mcells.length === 2 && d.querySelector('#mRoot .mb').textContent.includes('photo.jpg'), '5F: media gallery lists the chat media');
  ok(mcells[0].href.includes('/media/901'), '5F: media cells link to the download endpoint');
  d.querySelector('#mRoot .mb [data-mclose]').click();
  await sleep(200);
  d.querySelector('#waQuickBtn').click();
  await sleep(400);
  const qrs = d.querySelectorAll('#wqrList .wqr-use');
  ok(qrs.length === 2, '5F: quick-replies modal lists the saved replies');
  qrs[0].click();
  await sleep(300);
  ok(d.getElementById('waSendInput').value === 'Thanks, get in touch!', '5F: tapping a quick reply drops it into the composer');
  ok(!d.querySelector('#mRoot .mb'), '5F: the quick-reply modal closes on insert');

  /* ---------- 5F (R77) · Contacts: details (note/tags/timeline) + dupes + CSV ---------- */
  FIX['/api/contacts'].list = [{ jid: '923001112223@s.whatsapp.net', name: 'Ali Raza', notify: 'Ali', phone: '923001112223' }];
  if (d.getElementById('waContactsPanel').hidden) { d.querySelector('#waContactsBtn').click(); await sleep(500); }
  const cRows = d.querySelectorAll('#waContactsList .wa-contact');
  ok(cRows.length === 1, '5F: contacts panel lists the synced contact');
  d.querySelector('#waContactsList .wa-cinfo').click();
  await sleep(500);
  ok(!!d.querySelector('#cnote'), '5F: contact details modal opens');
  ok(d.querySelector('#cnote').value === 'Franchisee — follow up Friday', '5F: the saved note loads into the modal');
  ok(d.querySelector('#ctagBox').textContent.includes('vip'), '5F: contact tags render as chips');
  ok(d.querySelectorAll('#ctimeline .wqr-row').length === 2, '5F: the timeline lists recent activity');
  d.querySelector('#cnote').value = 'Updated note text';
  d.querySelector('#cnoteSave').click();
  await sleep(400);
  const noteCall = calls.find((c) => c.method === 'POST' && c.path === '/api/contacts/923001112223@s.whatsapp.net/note');
  ok(!!noteCall && JSON.parse(noteCall.body).note === 'Updated note text', '5F: note save POSTs the text');
  ok(d.getElementById('toasts').textContent.includes('Note saved'), '5F: note save toasts');
  d.querySelector('#mRoot .mb [data-mclose]').click();
  await sleep(200);
  d.querySelector('#waContactsDupes').click();
  await sleep(400);
  ok(d.querySelectorAll('#mRoot .mb .dup-g').length === 1 && d.querySelectorAll('#mRoot .mb .dup-row').length === 2, '5F: dupe finder groups same-name contacts');
  ok(d.querySelector('#mRoot .mb').textContent.includes('Ali Raza'), '5F: the dupe group names the people involved');
  d.querySelector('#mRoot .mb [data-mclose]').click();
  await sleep(200);
  ok(!!d.getElementById('waContactsCsv'), '5F: CSV export control present in the contacts panel');

  /* ---------- 5G (R82) · Sources: RSS/Atom feed card ---------- */
  d.querySelector('.sb-item[data-view="sources"]').click();
  await sleep(400);
  ok(!!d.getElementById('rssTest') && !!d.getElementById('rssAdd'), '5G: RSS card present in Sources view');
  ok(d.querySelector('.view[data-view="sources"]').textContent.includes('15 minutes'), '5G: RSS card states the 15-minute fetch cadence');
  d.getElementById('rssUrl').value = 'https://feeds.example/rss';
  d.getElementById('rssTest').click();
  await sleep(400);
  ok(d.getElementById('rssTestResult').textContent.includes('Feed OK — 2 item(s)'), '5G: feed test reports the item count');
  ok(d.getElementById('rssTestResult').textContent.includes('rss-0123456789ab@rss'), '5G: feed test shows the future source ID');
  d.getElementById('rssName').value = 'Example Feed';
  d.getElementById('rssAdd').click();
  await sleep(500);
  const rssAddCall = calls.find((c) => c.method === 'POST' && c.path === '/api/sources/rss');
  ok(!!rssAddCall && JSON.parse(rssAddCall.body).url === 'https://feeds.example/rss' && JSON.parse(rssAddCall.body).name === 'Example Feed', '5G: add-feed POSTs name + URL');
  ok(d.getElementById('toasts').textContent.includes('added'), '5G: add-feed toasts success');
  const rssRow = [...d.querySelectorAll('#srcTable tbody tr')].find((tr) => tr.dataset.jid === 'rss-0123456789ab@rss');
  ok(!!rssRow, '5G: the new RSS source appears in the sources table');
  ok(rssRow && rssRow.textContent.includes('RSS'), '5G: RSS rows are badged');
  ok(rssRow && rssRow.textContent.includes('https://feeds.example/rss'), '5G: the feed URL is shown under the name');

  /* ---------- 5G (R83) · PWA wiring in the shell ---------- */
  const manifest = d.querySelector('link[rel="manifest"]');
  ok(!!manifest && manifest.getAttribute('href') === '/manifest.webmanifest', '5G: manifest link in the head');
  ok(d.querySelector('meta[name="theme-color"]') && d.querySelector('meta[name="theme-color"]').content === '#0b1220', '5G: theme-color meta for PWA');
  ok(!!d.querySelector('link[rel="apple-touch-icon"]'), '5G: apple-touch-icon linked');

  /* ---------- 5G (R80) · Routing: outgoing webhooks card ---------- */
  d.querySelector('.sb-item[data-view="routing"]').click();
  await sleep(500);
  ok(d.querySelectorAll('#hookList tbody tr').length === 2, '5G: existing webhooks listed (2)');
  ok(d.getElementById('hookList').textContent.includes('Zapier') && d.getElementById('hookList').textContent.includes('ok 200'), '5G: webhook rows show name + last result');
  ok(d.getElementById('hookList').textContent.includes('N8n') && d.getElementById('hookList').textContent.includes('disabled'), '5G: disabled webhook is flagged');
  ok(d.querySelectorAll('#hookEventPick .hook-ev').length === 8, '5G: the 8-event catalog renders in the picker');
  /* add */
  d.getElementById('hookName').value = 'New Hook';
  d.getElementById('hookUrl').value = 'https://hook.example/new';
  const evPick = [...d.querySelectorAll('#hookEventPick .hook-ev')].filter((c) => ['post.published', 'alert'].includes(c.value));
  evPick.forEach((c) => { c.checked = true; });
  d.getElementById('hookAdd').click();
  await sleep(500);
  const hookAddCall = calls.find((c) => c.method === 'POST' && c.path === '/api/webhooks');
  ok(!!hookAddCall && JSON.parse(hookAddCall.body).events.length === 2 && JSON.parse(hookAddCall.body).url === 'https://hook.example/new', '5G: add-webhook POSTs the selected events');
  ok(d.querySelectorAll('#hookList tbody tr').length === 3, '5G: the new webhook appears in the list');
  /* test */
  const testBtn = d.querySelector('#hookList [data-hact="test"][data-id="3"]');
  testBtn.click();
  await sleep(400);
  ok(d.getElementById('toasts').textContent.includes('Test delivered (HTTP 200)'), '5G: test button reports delivery');
  ok(calls.some((c) => c.method === 'POST' && c.path === '/api/webhooks/3/test'), '5G: test hit the per-webhook test route');
  /* enable the disabled one */
  const enBtn = d.querySelector('#hookList [data-hact="toggle"][data-id="4"]');
  ok(enBtn && enBtn.textContent === 'Enable', '5G: disabled webhook offers Enable');
  enBtn.click();
  await sleep(400);
  ok(!d.getElementById('hookList').textContent.includes('disabled'), '5G: after enable, no webhook is flagged disabled');
  /* delete */
  const hookDelBtn = d.querySelector('#hookList [data-hact="del"][data-id="4"]');
  hookDelBtn.click();
  await sleep(400);
  ok(calls.some((c) => c.method === 'POST' && c.path === '/api/webhooks/4/delete'), '5G: delete hit the per-webhook delete route');
  ok(d.querySelectorAll('#hookList tbody tr').length === 2, '5G: list drops the deleted webhook');

  /* ---------- 5G (R81) · About: API explorer ---------- */
  d.querySelector('.sb-item[data-view="about"]').click();
  await sleep(300);
  const exRows = d.querySelectorAll('#apiExList .apiex-row');
  ok(exRows.length >= 25, '5G: API explorer lists the endpoint catalog (' + exRows.length + ' rows)');
  ok(d.getElementById('apiExList').textContent.includes('/api/panic/stop'), '5G: destructive endpoints are listed, labelled as-is');
  /* Try it (GET) */
  const ovRow = [...exRows].find((r) => r.textContent.includes('/api/overview'));
  ovRow.querySelector('[data-apiex]').click();
  await sleep(300);
  ok(!!d.getElementById('apiExResult') && d.getElementById('apiExResult').textContent.includes('published'), '5G: Try it shows the raw JSON response');
  /* Show body (POST with params — must NOT fire a NEW call; 5E already exercised the real panic flow) */
  const panicRow = [...d.querySelectorAll('#apiExList .apiex-row')].find((r) => r.textContent.includes('/api/panic/stop'));
  const callsBeforePanic = calls.length;
  panicRow.querySelector('[data-apiex]').click();
  await sleep(200);
  ok(d.getElementById('apiExResult').textContent.includes('NOT called with a guessed one'), '5G: body-requiring endpoints show the template instead of firing');
  ok(!calls.slice(callsBeforePanic).some((c) => c.method === 'POST' && c.path === '/api/panic/stop'), '5G: the POST was not fired from the explorer');
  /* filter */
  d.getElementById('apiExSearch').value = 'webhook';
  d.getElementById('apiExSearch').dispatchEvent(new w.Event('input', { bubbles: true }));
  await sleep(200);
  const exFiltered = d.querySelectorAll('#apiExList .apiex-row');
  ok(exFiltered.length > 0 && exFiltered.length < exRows.length && [...exFiltered].every((r) => r.textContent.toLowerCase().includes('webhook')), '5G: endpoint filter narrows the list');
  d.getElementById('apiExSearch').value = '';
  d.getElementById('apiExSearch').dispatchEvent(new w.Event('input', { bubbles: true }));
  await sleep(200);
  /* binary endpoint */
  d.getElementById('apiExSearch').value = 'backup';
  d.getElementById('apiExSearch').dispatchEvent(new w.Event('input', { bubbles: true }));
  await sleep(200);
  const bkRow = [...d.querySelectorAll('#apiExList .apiex-row')].find((r) => r.textContent.includes('/api/backup/download'));
  bkRow.querySelector('[data-apiex]').click();
  await sleep(300);
  ok(d.getElementById('apiExResult').textContent.includes('Binary response'), '5G: the backup zip endpoint reports as binary, not broken JSON');
  ok(!!d.getElementById('apiExClose'), '5G: result panel has a close control');

  /* ---------- 5H (R85/R87) · Settings: Automation card ---------- */
  d.querySelector('.sb-item[data-view="settings"]').click();
  await sleep(500);
  ok(!!d.getElementById('apLog'), '5H: Automation card present in Settings (AI and Automation)');
  ok(d.querySelectorAll('#swWaCommand .sw-card').length === 1, '5H: WA command switch lives in Settings · WhatsApp (one home)');
  ok(d.querySelector('#swAipilot .sw-card[data-key="autopilot"]') !== null, '5H: auto-pilot switch lives in Automate · Pilot (one home)');
  ok(d.getElementById('waPin').length > 0 || !!d.getElementById('waPin'), '5H: PIN input present');
  const cmdRows = d.querySelectorAll('#waCmdTable tbody tr');
  ok(cmdRows.length >= 7, '5H: the command catalog renders (' + cmdRows.length + ' rows)');
  ok(d.getElementById('waCmdTable').textContent.includes('PIN'), '5H: destructive commands are flagged with PIN');
  d.getElementById('waPin').value = '4321';
  d.getElementById('waPinSave').click();
  await sleep(300);
  const h5PinCall = calls.find((c) => c.method === 'POST' && c.path === '/api/wacommand');
  ok(!!h5PinCall && JSON.parse(h5PinCall.body).pin === '4321', '5H: PIN save POSTs the digits');
  ok(d.getElementById('waPinState').textContent.includes('PIN is set'), '5H: PIN state updates in place');
  d.getElementById('apMax').value = '25';
  d.getElementById('apSave').click();
  await sleep(300);
  const h5ApCall = calls.find((c) => c.method === 'POST' && c.path === '/api/autopilot');
  ok(!!h5ApCall && JSON.parse(h5ApCall.body).maxDay === 25, '5H: auto-pilot cap save POSTs the number');
  ok(d.querySelectorAll('#apLog tbody tr').length >= 3, '5H: auto-pilot log renders its history');
  ok(d.getElementById('apState').textContent.includes('pass'), '5H: last pass summary shown');
  /* the new switches POST through the standard toggle */
  const wcSw = d.querySelector('#swWaCommand .sw-card[data-key="waCommand"] input[data-key]');
  wcSw.checked = true; wcSw.dispatchEvent(new w.Event('change', { bubbles: true }));
  await sleep(300);
  ok(calls.some((c) => c.method === 'POST' && c.path === '/api/power/toggle' && JSON.parse(c.body).key === 'waCommand'), '5H: waCommand switch toggles via the standard power API');
  wcSw.checked = false; wcSw.dispatchEvent(new w.Event('change', { bubbles: true }));
  await sleep(200);

  /* ---------- 5H (R86) · Posts: evergreen recycling card ---------- */
  d.querySelector('.sb-item[data-view="posts"]').click();
  await sleep(500);
  ok(!!d.getElementById('egrQuota') && !!d.getElementById('egrLog'), '5H: evergreen card present in Posts view');
  ok(d.querySelector('#swAipilot .sw-card[data-key="evergreen"]') !== null, '5H: evergreen switch lives in Pilot (one home); the card stays in History');
  ok(d.getElementById('egrQuota').value === '2' && d.getElementById('egrMinAge').value === '7', '5H: evergreen settings load into the inputs');
  ok(d.getElementById('egrState').textContent.includes('Today: 1/2'), '5H: today usage shown against the quota');
  ok(d.querySelectorAll('#egrLog tbody tr').length === 2, '5H: recycling log renders');
  d.getElementById('egrQuota').value = '3';
  d.getElementById('egrSave').click();
  await sleep(300);
  const egrCall = calls.find((c) => c.method === 'POST' && c.path === '/api/evergreen');
  ok(!!egrCall && JSON.parse(egrCall.body).quota === 3, '5H: evergreen save POSTs the new quota');

  /* ---------- 5H (R88) · Composer: Plan my week ---------- */
  d.querySelector('.sb-item[data-view="newpost"]').click();
  await sleep(300);
  ok(!!d.getElementById('planWeekBtn'), '5H: “Plan my week” control present in Composer');
  d.getElementById('planWeekBtn').click();
  await sleep(500);
  ok(calls.some((c) => c.method === 'POST' && c.path === '/api/plan-week'), '5H: plan request POSTed');
  ok(!!d.querySelector('#mRoot .mb'), '5H: plan result opens a modal');
  ok(d.querySelector('#mRoot .mb').textContent.includes('Day 7'), '5H: the modal lists the drafted days');
  ok(d.querySelector('#mRoot .mb').textContent.includes('Approval Queue'), '5H: the modal states the drafts wait in the Approval Queue');
  ok(d.getElementById('toasts').textContent.includes('7 week drafts'), '5H: success toast names the draft count');
  d.querySelector('#mRoot .mb [data-mclose]').click();
  await sleep(200);

  /* ---------- 5I (I1) · Sources: subscriber counts + growth sparkline ---------- */
  d.querySelector('.sb-item[data-view="sources"]').click();
  await sleep(600);
  const subCell = d.querySelector('#srcTable [data-subcell]');
  ok(!!subCell, '5I: Subscribers column present in the sources table');
  ok(subCell && subCell.textContent.includes('1,250'), '5I: subscriber count rendered (1,250)');
  ok(subCell && subCell.querySelector('svg.spark') !== null, '5I: 14-day growth sparkline SVG rendered');
  ok(subCell && subCell.textContent.includes('+50'), '5I: growth delta shown since the window start');
  ok(calls.some((c) => c.path === '/api/subs'), '5I: subscriber data fetched from /api/subs');

  /* ---------- 5I (I2) · Media Library view ---------- */
  d.querySelector('.sb-item[data-view="media"]').click();
  await sleep(600);
  ok(d.querySelectorAll('#mlGrid .ml-tile').length === 3, '5I: media grid renders all 3 stored items');
  ok(d.getElementById('mlCount').textContent.includes('3 item'), '5I: item count shown');
  ok(d.querySelector('#mlGrid .ml-thumb img') !== null, '5I: image tiles use real thumbnails from the download endpoint');
  ok(d.querySelector('#mlGrid a[href*="/api/media-lib/download"]') !== null, '5I: every tile has a download link');
  const mlKind = d.getElementById('mlKind');
  mlKind.value = 'video'; mlKind.dispatchEvent(new w.Event('change', { bubbles: true }));
  await sleep(400);
  ok(d.querySelectorAll('#mlGrid .ml-tile').length === 2, '5I: kind filter narrows to the 2 videos');
  mlKind.value = ''; mlKind.dispatchEvent(new w.Event('change', { bubbles: true }));
  await sleep(400);
  const delBtn5i = d.querySelector('#mlGrid .ml-del');
  delBtn5i.click();
  await sleep(300);
  ok(!!d.querySelector('#mRoot .mb'), '5I: delete asks for confirmation (manual-only removal)');
  d.querySelector('#mRoot .mb [data-mprimary]').click();
  await sleep(300);
  const mlDelCall = calls.find((c) => c.method === 'POST' && c.path === '/api/media-lib/delete');
  ok(!!mlDelCall && String(JSON.parse(mlDelCall.body).ref).startsWith('inbox:'), '5I: delete POSTs the media reference');

  /* ---------- 5I (I9/I10/I4) · Posts: row quick menu, resend, card ---------- */
  d.querySelector('.sb-item[data-view="posts"]').click();
  await sleep(600);
  const qaBtn = d.querySelector('#postsTable .qa-btn');
  ok(!!qaBtn, '5I: every post row has the ⋯ quick-action cluster');
  qaBtn.click();
  await sleep(200);
  const qaMenu = d.querySelector('#postsTable [data-qamenu].open');
  ok(!!qaMenu, '5I: quick menu opens in place');
  const qaItems = qaMenu.textContent;
  ok(qaItems.includes('Resend') && qaItems.includes('Copy text') && qaItems.includes('Make announcement card'), '5I: menu consolidates copy/resend/card (existing actions intact)');
  ok(qaItems.includes('Undo on'), '5I: per-target undo offered for published targets');
  const resendItem = qaMenu.querySelector('[data-act="resend"]');
  resendItem.click();
  await sleep(300);
  ok(!!d.querySelector('#mRoot .mb') && d.querySelector('#mRoot .mb').textContent.includes('rate guard'), '5I: resend asks for confirmation and names the rate guard');
  d.querySelector('#mRoot .mb [data-mprimary]').click();
  await sleep(400);
  const resendCall = calls.find((c) => c.method === 'POST' && c.path === '/api/posts/resend');
  ok(!!resendCall && JSON.parse(resendCall.body).id === 1, '5I: resend POSTed with the post id');
  ok(d.getElementById('toasts').textContent.includes('Resent to 1 target'), '5I: resend success toast');
  /* card modal from the quick menu */
  d.querySelector('#postsTable .qa-btn').click();
  await sleep(200);
  d.querySelector('#postsTable [data-qamenu].open [data-act="card"]').click();
  await sleep(300);
  ok(!!d.getElementById('cardTitle') && d.getElementById('cardTitle').value.length > 5, '5I: card modal opens with the post title pre-filled');
  d.getElementById('cardSvg').click();
  await sleep(300);
  ok(w.__anchorClicks.some((x) => x.href.includes('/api/card-svg?') && x.href.includes('Big+promo')), '5I: SVG download requested with the card params');
  d.getElementById('cardPng').click();
  await sleep(500);
  const cardCall = calls.find((c) => c.method === 'POST' && c.path === '/api/card');
  ok(!!cardCall && JSON.parse(cardCall.body).body.includes('Big promo'), '5I: PNG render POSTed with the card text');
  ok(d.getElementById('toasts').textContent.includes('Card rendered'), '5I: card success toast');
  d.querySelector('#mRoot .mscrim').dispatchEvent(new w.Event('click', { bubbles: true })); // card modal has no footer (actions:false)
  await sleep(200);

  /* ---------- 5I (I6) · Brand (ex-Beautify): local hashtag frequency ---------- */
  d.querySelector('.sb-item[data-view="branding"]').click();
  await sleep(600);
  ok(calls.some((c) => c.path === '/api/hashtags/freq'), '5I: hashtag frequency fetched on Brand (one home for the formatting switches)');
  const hfList = d.getElementById('hasFreqList');
  ok(hfList && hfList.textContent.includes('#jobs') && hfList.textContent.includes('8'), '5I: top hashtag chips show tag + count');
  ok(d.getElementById('hasFreqMeta').textContent.includes('14 own post'), '5I: window meta shows how many own posts were counted');

  /* ---------- 5I (I7) · Guardrails: freshness guard ---------- */
  d.querySelector('.sb-item[data-view="guardrails"]').click();
  await sleep(600);
  ok(!!d.getElementById('freshHours'), '5I: freshness guard card present in Guardrails');
  ok(d.getElementById('freshHours').value === '0' && d.getElementById('freshState').textContent.includes('OFF'), '5I: freshness loads (0 = OFF) with the plain description');
  d.getElementById('freshHours').value = '6';
  d.getElementById('freshSave').click();
  await sleep(300);
  const freshCall = calls.find((c) => c.method === 'POST' && c.path === '/api/freshness');
  ok(!!freshCall && JSON.parse(freshCall.body).hours === 6, '5I: freshness hours saved via POST');

  /* ---------- 5I (I3/I8) · new switches live in their cards ---------- */
  ok(d.querySelector('#swGeneral .sw-card[data-key="smartmedia"]') !== null, '5I: smart media switch lives in Settings · General (one home)');
  ok(d.querySelector('#swBrand .sw-card[data-key="linktools"]') !== null, '5I: link tools switch lives in Publish · Brand (one home)');
  ok(d.querySelector('#swLibrary .sw-card[data-key="announcard"]') !== null, '5I: announcement card switch lives in Publish · Library (one home)');
  const lmSw = d.querySelector('#swBrand .sw-card[data-key="linktools"] input[data-key]');
  lmSw.checked = true; lmSw.dispatchEvent(new w.Event('change', { bubbles: true }));
  await sleep(300);
  ok(calls.some((c) => c.method === 'POST' && c.path === '/api/power/toggle' && JSON.parse(c.body).key === 'linktools'), '5I: linktools toggles via the standard power API');

  /* ---------- 5I (I4) · composer → card button ---------- */
  d.querySelector('.sb-item[data-view="newpost"]').click();
  await sleep(600);
  const ccBtn = d.getElementById('composeCardBtn');
  ok(!!ccBtn, '5I: composer has a "Make a card" button');
  d.getElementById('composeText').value = '';
  ccBtn.click();
  await sleep(200);
  ok(d.getElementById('toasts').textContent.includes('Write the card text first'), '5I: card with an empty composer asks for text');
  d.getElementById('composeText').value = 'Composer card test — a longer line for the title.';
  ccBtn.click();
  await sleep(300);
  ok(!!d.getElementById('cardTitle') && d.getElementById('cardBody').value.includes('Composer card test'), '5I: composer card modal opens with the composer text');
  d.querySelector('#mRoot .mscrim').dispatchEvent(new w.Event('click', { bubbles: true }));
  await sleep(200);

  /* ---------- 5J (J1) · Pipeline Inspector ---------- */
  d.querySelector('.sb-item[data-view="routing"]').click();
  await sleep(600);
  ok(!!d.getElementById('piRun') && !!d.getElementById('piText'), '5J: Pipeline Inspector card is on the Routing view');
  const piSrcOpts = [...d.querySelectorAll('#piSource option')];
  ok(piSrcOpts.length >= 2 && piSrcOpts.some((o) => o.value === NEWS), '5J: inspector source picker lists the sources');
  d.getElementById('piText').value = 'Fresh jobs in Lahore — apply now';
  d.getElementById('piRun').click();
  await sleep(400);
  ok(!d.getElementById('piOut').hidden, '5J: dry-run renders its output');
  ok(d.getElementById('piCounters').textContent.includes('3') && d.getElementById('piCounters').textContent.includes('skipped'), '5J: counter strip shows today\'s tallies');
  ok(d.querySelectorAll('#piGates .pi-gate').length >= 2, '5J: safety gates are listed (checked, nothing marked)');
  const piStageChanged = [...d.querySelectorAll('#piStages .pi-stage')].find((s) => s.querySelector('.pi-chip'));
  ok(!!piStageChanged && !!piStageChanged.querySelector('.pi-before') && !!piStageChanged.querySelector('.pi-after'), '5J: a changed stage shows before/after');
  ok(d.getElementById('piRouting').textContent.includes('Would publish to 1 target'), '5J: routing match is reported');
  ok(calls.some((c) => c.method === 'POST' && c.path === '/api/pipeline/inspect' && JSON.parse(c.body).text.includes('Fresh jobs')), '5J: dry-run POSTed the text');

  /* ---------- 5J (J3) · “?” one-line guide ---------- */
  ok(d.getElementById('helpScrim').hidden, 'v7.7.2: the guide starts CLOSED (it used to sit over the dashboard on load)');
  /* regression: author display rules used to beat the `hidden` attribute — the
     stylesheet must carry the [hidden] guard or the bug returns */
  let cssGuard = false;
  try {
    const css = await (await fetch(BASE + '/app.css?v=pc1')).text();
    cssGuard = /\[hidden\]\s*\{[^}]*display:\s*none/.test(css);
  } catch { }
  ok(cssGuard, 'v7.7.2: stylesheet carries the [hidden]{display:none} guard (display:flex/grid no longer defeats closed overlays)');
  d.getElementById('helpBtn').click();
  await sleep(200);
  ok(!d.getElementById('helpScrim').hidden, '5J: “?” opens the one-line guide');
  ok(d.querySelectorAll('#helpList .help-row').length === 33, '5J: the guide lists all 33 switches in one line each');
  d.getElementById('helpSearch').value = 'dedupe';
  d.getElementById('helpSearch').dispatchEvent(new w.Event('input', { bubbles: true }));
  await sleep(150);
  const dedupeRows = d.querySelectorAll('#helpList .help-row').length;
  ok(dedupeRows >= 2 && dedupeRows < 10, '5J: the guide filters by search');
  /* v7.7.2: rows are actionable — clicking one jumps to the view hosting the switch */
  d.getElementById('helpSearch').value = 'scheduler';
  d.getElementById('helpSearch').dispatchEvent(new w.Event('input', { bubbles: true }));
  await sleep(150);
  const schedRow = d.querySelector('#helpList .help-row[data-key="scheduler"]');
  ok(!!schedRow, 'v7.7.2: the guide rows carry their switch key');
  schedRow.click();
  await sleep(250);
  ok(d.getElementById('helpScrim').hidden, 'v7.7.2: clicking a guide row closes the guide');
  ok(!d.querySelector('.view[data-view="aipilot"]').hidden, 'v7.7.2: clicking a guide row jumps to the switch home view (Pilot — scheduler\'s one home)');
  d.getElementById('helpBtn').click();
  await sleep(150);
  d.getElementById('helpClose').click();
  await sleep(150);
  ok(d.getElementById('helpScrim').hidden, 'v7.7.2: the X button closes the guide');
  d.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await sleep(150);
  ok(d.getElementById('helpScrim').hidden, '5J: Esc closes the guide');

  /* ---------- 5J (J4) · Branding Studio ---------- */
  d.querySelector('.sb-item[data-view="branding"]').click();
  await sleep(500);
  ok(d.querySelectorAll('#brandPresets .bp-btn').length === 4, '5J: Branding Studio offers 4 presets');
  ok(d.querySelectorAll('#brandFields .bp-color').length === 5, '5J: all 5 brand colors are editable');
  d.querySelector('#brandFields .bp-hex[data-bk="accent"]').value = '#ff0000';
  d.querySelector('#brandFields .bp-hex[data-bk="accent"]').dispatchEvent(new w.Event('input', { bubbles: true }));
  await sleep(200);
  ok(d.getElementById('brandPreview').src.includes('accent=%23ff0000'), '5J: live preview reflects the new accent color');
  d.getElementById('brandSave').click();
  await sleep(400);
  const brandCall = calls.find((c) => c.method === 'POST' && c.path === '/api/brand');
  ok(!!brandCall && JSON.parse(brandCall.body).accent === '#ff0000', '5J: brand save POSTs the hex values');

  /* ---------- 5J (J5) · Overview KPIs are drag-reorderable (persisted) ---------- */
  d.querySelector('.sb-item[data-view="home"]').click();
  await sleep(700);
  const kpiWa = d.querySelector('#kpiGrid .kpi-drag[data-kpi="wa"]');
  const kpiPub = d.querySelector('#kpiGrid .kpi-drag[data-kpi="published"]');
  ok(!!kpiWa && !!kpiPub, '5J: Overview KPI cards are draggable');
  kpiWa.dispatchEvent(new w.Event('dragstart'));
  kpiPub.dispatchEvent(new w.Event('dragover'));
  kpiWa.dispatchEvent(new w.Event('dragend'));
  await sleep(900);
  const kpiCall = calls.filter((c) => c.method === 'POST' && c.path === '/api/settings' && c.body && c.body.includes('kpiOrder')).pop();
  ok(!!kpiCall && JSON.parse(kpiCall.body).kpiOrder.startsWith('published,wa'), '5J: the new KPI order is persisted (published before wa)');
  ok(d.querySelector('#kpiGrid .kpi-drag').dataset.kpi === 'published', '5J: the grid physically re-ordered');

  /* ---------- 5J (J6) · Calendar (Meridian 2: inside Scheduled, List/Calendar toggle) ---------- */
  d.querySelector('.sb-item[data-view="scheduled"]').click();
  await sleep(600);
  ok(d.querySelectorAll('#schedModeTabs .tab').length === 2, 'M2: Scheduled has the List / Calendar toggle');
  d.querySelector('#schedModeTabs [data-schedmode="cal"]').click();
  await sleep(400);
  const calMonth = [0,1,2,3,4,5,6,7,8,9,10,11].map((x) => ['January','February','March','April','May','June','July','August','September','October','November','December'][x])[Number(__YM.slice(5, 7)) - 1];
  ok(d.getElementById('fcalTitle').textContent.includes(calMonth), '5J: calendar titles the current month (PKT)');
  ok(d.querySelectorAll('#fcalGrid .cal-chip').length === 5, '5J: month grid shows all 5 fixture items');
  ok(!!d.querySelector('#fcalGrid .cal-c.today'), '5J: today\'s cell is highlighted');
  ok(!!d.querySelector('#fcalGrid .cal-chip.cal-evergreen') && !!d.querySelector('#fcalGrid .cal-chip.cal-plan'), '5J: evergreen + plan items are merged in');
  d.querySelector('#fcalGrid .cal-chip.cal-published').click();
  await sleep(400);
  ok(d.querySelector('section.view[data-view="posts"]').hidden === false, '5J: a published chip jumps to History');
  d.querySelector('.sb-item[data-view="scheduled"]').click();
  await sleep(500);
  d.querySelector('#schedModeTabs [data-schedmode="cal"]').click();
  await sleep(300);
  d.querySelector('#fcalTabs [data-cal="week"]').click();
  await sleep(200);
  ok(d.querySelectorAll('#fcalWeek .cw-col').length === 7 && !d.getElementById('fcalWeek').hidden, '5J: week view shows 7 day columns');
  d.querySelector('#fcalTabs [data-cal="month"]').click();
  await sleep(200);
  d.getElementById('fcalNext').click();
  await sleep(400);
  ok(!d.getElementById('fcalTitle').textContent.includes(calMonth), '5J: next-month navigation works');
  d.getElementById('fcalToday').click();
  await sleep(400);

  /* ---------- 5J (J2) · setup wizard — saved + auto-hiding ---------- */
  d.querySelector('.sb-item[data-view="home"]').click();
  await sleep(700);
  ok(!d.getElementById('setupCard').hidden, '5J: setup wizard shows while steps remain');
  ok(d.querySelectorAll('#setupList .setup-i').length === 5, '5J: the wizard lists all 5 steps');
  ok(d.getElementById('setupList').textContent.includes('Link WhatsApp') && !!d.querySelector('#setupList [data-go]'), '5J: unfinished steps carry an Open button');
  ok(d.getElementById('setupFinish').hidden, '5J: “Mark complete” stays hidden until every step is done');

  /* ---------- 5J (J7) · AI safety screen (OFF by default) — Meridian 2 home = Rules ---------- */
  d.querySelector('.sb-item[data-view="guardrails"]').click();
  await sleep(600);
  const aiSw = d.querySelector('#swRules input[data-key="aisafety"]');
  ok(!!aiSw && aiSw.checked === false, '5J: AI safety screen switch lives on the Rules view, OFF by default (R8)');
  ok(d.getElementById('aisafetyInput').value === 'no political content', '5J: safety criteria load from the API');
  d.getElementById('aisafetyInput').value = 'must be safe and legal';
  d.getElementById('aisafetySave').click();
  await sleep(400);
  const safeCall = calls.find((c) => c.method === 'POST' && c.path === '/api/power/aisafety');
  ok(!!safeCall && JSON.parse(safeCall.body).criteria === 'must be safe and legal', '5J: safety criteria save POSTs');

  /* ---------- 5J (J8) · Pacing visualizer ---------- */
  d.querySelector('.sb-item[data-view="guardrails"]').click();
  await sleep(600);
  ok(d.querySelectorAll('#paceChart .pc-cell').length === 24, '5J: pacing chart has 24 hourly cells');
  ok(d.getElementById('paceNow').textContent.includes('4/30'), '5J: current-hour usage vs cap is shown');
  ok(d.getElementById('paceFoot').textContent.includes('11 post(s)'), '5J: 24 h total + peak + cap in the footer');

  /* ---------- 5J (J9) · About + changelog ---------- */
  d.querySelector('.sb-item[data-view="about"]').click();
  await sleep(500);
  ok(d.querySelectorAll('#abChangelog .chg').length === 20, '5J: changelog lists every build (got ' + d.querySelectorAll('#abChangelog .chg').length + ')');
  ok(d.getElementById('abChangelog').textContent.includes('Meridian 2') && d.getElementById('abChangelog').textContent.includes('Phase R'), 'M2: changelog covers Meridian 2 back to Phase R, no banned phase labels on current builds');
  ok(d.getElementById('abUptime').textContent.includes('booted'), '5J: About shows boot/uptime state');

  /* ---------- 5J (J10) · Urdu RTL (optional, best effort) ---------- */
  d.querySelector('.sb-item[data-view="settings"]').click();
  await sleep(600);
  d.getElementById('setLang').value = 'ur';
  d.getElementById('setLang').dispatchEvent(new w.Event('change', { bubbles: true }));
  await sleep(400);
  ok(d.documentElement.dir === 'rtl' && d.body.classList.contains('ur'), '5J: Urdu flips the console to RTL');
  ok(d.querySelector('.sb-item[data-view="home"] .lbl').textContent === 'ہوم', '5J: sidebar labels switch to Urdu');
  ok(calls.some((c) => c.method === 'POST' && c.path === '/api/settings' && c.body && c.body.includes('"ur"')), '5J: language choice is persisted');
  d.getElementById('setLang').value = 'en';
  d.getElementById('setLang').dispatchEvent(new w.Event('change', { bubbles: true }));
  await sleep(400);
  ok(d.documentElement.dir === 'ltr' && d.querySelector('.sb-item[data-view="home"] .lbl').textContent === 'Home', '5J: switching back to English restores LTR + labels');

  console.log('\nDOM TEST 7.6.1 (Phase R shell + 5A–5J): ' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('HARNESS ERROR:', e); process.exit(2); });
