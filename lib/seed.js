import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { store, DATA_DIR, DB_FILE } from './store.js';

const M = 60_000, H = 3600_000, D = 86_400_000;
const NOW = Date.now();
const H3 = (h, m = 0) => new Date(NOW + h * H + m * M).toISOString().slice(11, 16);

/* ── sources: exactly §5 (12 = 11 active + 1 paused) ─────────── */
const SRC = (name, handle, subs, status = 'active') => ({
  name, handle, subs, status,
  last: NOW - (3 + (name.length * 7) % 50) * M,
  rules: { approval: 'inherit', include: [], exclude: [], mediaOnly: false, maxPerHour: 20, routes: [], translate: 'none', footer: false, stripLinks: false, trusted: false },
});
const sources = [
  SRC('Tech News', '@technews', '12.5K'),
  SRC('AI Daily', '@aidaily', '8.2K'),
  SRC('Programming', '@programming', '24.1K'),
  SRC('Design Digest', '@designdigest', '6.7K', 'paused'),
  SRC('Product Hunt', '@producthunt', '19.3K'),
  SRC('Business Daily', '@businessdaily', '15.8K'),
  SRC('AI Updates', '@aiupdates', '9.4K'),
  SRC('Startup Stories', '@startupstories', '11.2K'),
  SRC('Crypto Pulse', '@cryptopulse', '21.6K'),
  SRC('Science Weekly', '@scienceweekly', '5.9K'),
  SRC('Marketing News', '@marketingnews', '7.8K'),
  SRC('Dev Tips', '@devtips', '13.1K'),
];

/* ── targets: 48 = 44 active / 3 paused / 1 error ────────────── */
const TBASE = ['Tech Hub', 'Growth Lab', 'Startup Circle', 'Dev Corner', 'Design Loft', 'Biz Desk', 'AI Frontier', 'Code Yard', 'Product Room', 'Media Bay', 'Signal Desk', 'Loop Weekly'];
const TKS = ['channel', 'group', 'user'];
const targets = [];
for (let i = 0; i < 48; i++) {
  const kind = i % 4 === 3 ? 'user' : i % 2 === 0 ? 'channel' : 'group';
  const base = TBASE[i % TBASE.length];
  const status = i === 40 ? 'error' : (i === 41 || i === 42 || i === 43 ? 'paused' : 'active');
  targets.push({
    id: 0,
    name: kind === 'user' ? `${base} · ${['M. Khan', 'S. Ali', 'R. Butt', 'A. Raza', 'H. Sheikh', 'Z. Iqbal', 'N. Malik', 'F. Aslam'][i % 8]}` : `${base} ${i + 1}`,
    handle: kind === 'user' ? `+92 30${(10 + i)} 1${10000 + i * 137 % 89999}` : `@${base.toLowerCase().replace(/[^a-z]/g, '')}${i + 1}`,
    kind, status,
    members: kind === 'user' ? 1 : 1000 + ((i * 763) % 39000),
    last: NOW - (5 + (i * 11) % 480) * M,
    rules: { types: 'all', lang: 'auto', maxPerDay: 50, footer: false },
    error: i === 40 ? 'Flood wait exceeded 3× — tap Reconnect' : null,
  });
}

/* ── queue: 3 pending / 1 delayed / 12 approved / 5 waiting ──── */
const q = (title, text, tags, source, n, minAgo, media, status, note = '') => ({
  id: 0, title, text, tags, source, targets: n, at: NOW - minAgo * M, media, status, note,
});
const queue = [
  q('Tech Updates', 'Latest breakthroughs in AI are changing how teams ship products — here is what it means for you this week.', ['#AI', '#Tech'], 'Tech News', 3, 2, 'city', 'pending'),
  /* item 2 = Text-only so type counts read Text (1), Media (2) — spec §5 */
  q('Marketing News', 'Our new campaign is live! 🚀', ['#Marketing', '#Growth'], 'Marketing News', 2, 3, 'text', 'pending'),
  q('AI Tools', 'Top 5 productivity tools for 2025 that actually save time…', ['#Productivity', '#Tools'], 'AI Daily', 1, 5, 'plant', 'pending'),
  q('Weekly design trends…', 'Weekly design trends: what is shaping interfaces this season.', [], 'Design Digest', 1, 38, 'chart', 'delayed', 'Held: quiet hours 23:00–06:00'),
];
const qT = ['Morning digest · Tech', 'Edge computing deep dive', 'Fintech weekly numbers', 'Open source picks #142', 'Design systems at scale', 'Why edge wins in 2026', 'Mobile payments in Asia', 'WebGPU for normal devs', 'Crypto market wrap', 'Product teardown: Notion', 'CI is slow — fix it', 'Local LLM field notes', 'Quarterly numbers preview', 'Dev tools roundup #88', 'Startup exits · July', 'Weekend reading list', 'Network failures — postmortem'];
qT.forEach((title, i) => queue.push({
  id: 0, title, text: `${title} — full summary prepared by the Raqifluz pipeline.`, tags: [],
  source: sources[(i + 2) % sources.length].name,
  targets: 3 + ((i * 5) % 24), at: NOW - (40 + i * 22) * M,
  media: ['city', 'laptop', 'plant', 'chart', 'chat'][i % 5],
  status: i < 12 ? 'approved' : 'waiting', note: '',
}));

/* ── history: 80 rows with per-target results ────────────────── */
const history = [];
const hT = ['AI agents go mainstream', 'Design tokens 101', 'Series B funding wave', 'Rust in production', 'The 4-day work week', 'Web auth patterns', 'GPU cloud pricing', 'Designing for dark mode', 'API versioning done right', 'Q3 growth review', 'State of edge computing', 'Brand refresh stories', 'Database choices 2026', 'Mobile app retention', 'Search in the AI era', 'Team rituals that scale', 'Payment rails in Pakistan', 'Content ops playbook', 'Observability basics', 'Why we moved to EJS'];
for (let i = 0; i < 80; i++) {
  const at = NOW - (i * 47 + 13) * M;
  const status = i % 23 === 5 ? 'failed' : i % 11 === 3 ? 'skipped' : 'published';
  const nT = 2 + (i % 9);
  const tResults = [];
  for (let t = 0; t < Math.min(nT, 6); t++) {
    tResults.push({ target: targets[(i + t) % targets.length].name, at: at + t * 12_000, ok: status === 'failed' && t === 0 ? false : true });
  }
  history.push({
    id: i + 1, at, title: hT[i % hT.length],
    source: sources[i % sources.length].name,
    targets: nT, status, latency: 1.2 + (i % 9) * 0.15,
    targetsResults: tResults,
  });
}

/* ── scheduled (5) / reports (4) ─────────────────────────────── */
const scheduled = [
  { id: 1, title: 'Morning digest · Tech', at: NOW + 55 * M, targets: 12 },
  { id: 2, title: 'Weekend roundup (held)', at: NOW + 6 * H, targets: 18 },
  { id: 3, title: 'Weekly report blast', at: NOW + 26 * H, targets: 40 },
  { id: 4, title: 'AI Weekly re-broadcast', at: NOW + 2 * D, targets: 9 },
  { id: 5, title: 'Monthly archive push', at: NOW + 6 * D, targets: 6 },
];
const reports = [
  { id: 1, type: 'daily', date: new Date(NOW - 1 * D).toISOString().slice(0, 10), at: NOW - 1 * D + 8 * H, meta: '742 published · 118 skipped · 49 failed', size: '18 KB' },
  { id: 2, type: 'daily', date: new Date(NOW - 2 * D).toISOString().slice(0, 10), at: NOW - 2 * D + 8 * H, meta: '710 published · 122 skipped · 51 failed', size: '17 KB' },
  { id: 3, type: 'weekly', date: 'W46', at: NOW - 3 * D, meta: '5,152 published · 812 skipped · 260 failed', size: '64 KB' },
  { id: 4, type: 'monthly', date: 'Oct 2026', at: NOW - 9 * D, meta: '28,560 published · 4,204 skipped · 2,104 failed', size: '212 KB' },
];

/* ── library: 6 templates / 6 media / 5 snippets ─────────────── */
const tints = ['emerald', 'cyan', 'violet', 'amber', 'rose', 'blue'];
const library = [];
const tN = ['Weekly digest', 'Launch announcement', 'Quick update', 'Deep dive intro', 'Weekend recap', 'Newsletter opener'];
for (let i = 0; i < 6; i++) library.push({ id: 0, kind: 'template', name: tN[i], content: `{{headline}}\n\n{{summary}}\n\n#{{tag}} — via Raqifluz`, tags: ['digest', 'weekly'].slice(0, 1 + i % 2), tint: tints[i], motif: ['chart', 'city', 'laptop', 'plant', 'chat', 'skyline'][i], created: NOW - (i + 1) * D });
const mN = ['City skyline', 'Laptop setup', 'Plant corner', 'Chart frame', 'Chat bubble', 'Skyline night'];
for (let i = 0; i < 6; i++) library.push({ id: 0, kind: 'media', name: mN[i], content: '', tags: ['media'], tint: tints[(i + 2) % 6], motif: mN[i].split(' ')[0].toLowerCase(), created: NOW - (i + 2) * D });
const sN = ['Short intro', 'Call to action', 'Product hook', 'Stat opener', 'Closing line'];
const sC = ['Quick one — ', 'Worth a look: ', 'The big shift this week: ', 'A number worth knowing: ', 'That is all for today.'];
for (let i = 0; i < 5; i++) library.push({ id: 0, kind: 'snippet', name: sN[i], content: sC[i], tags: ['snippet'], tint: tints[(i + 4) % 6], motif: 'text', created: NOW - (i + 4) * D });

/* ── contacts (8, Owner/Admin/Viewer) · auto-replies (4) · routes (6) · rules (5) ── */
const contacts = [
  { id: 0, name: 'A. Raza (Owner)', phone: '+92 300 1234567', role: 'owner', tag: 'vip', last: NOW - 4 * M },
  { id: 0, name: 'M. Khan', phone: '+92 301 2222222', role: 'admin', tag: 'team', last: NOW - 12 * M },
  { id: 0, name: 'S. Ali', phone: '+92 302 3333333', role: 'admin', tag: 'team', last: NOW - 1 * H },
  { id: 0, name: 'R. Butt', phone: '+92 303 4444444', role: 'viewer', tag: 'customer', last: NOW - 3 * H },
  { id: 0, name: 'H. Sheikh', phone: '+92 304 5555555', role: 'viewer', tag: 'customer', last: NOW - 5 * H },
  { id: 0, name: 'Z. Iqbal', phone: '+92 305 6666666', role: 'admin', tag: 'support', last: NOW - 2 * D },
  { id: 0, name: 'N. Malik', phone: '+92 306 7777777', role: 'viewer', tag: 'team', last: NOW - 4 * D },
  { id: 0, name: 'F. Aslam', phone: '+92 307 8888888', role: 'viewer', tag: 'customer', last: NOW - 6 * D },
];
const autoReplies = [
  { id: 0, trigger: 'hello', match: 'contains', reply: 'Hi! You are talking to the Raqifluz control channel. Try: status, pause, resume, report, health.', scope: 'all', active: true },
  { id: 0, trigger: 'pause', match: 'exact', reply: 'Pausing the bot — queued posts are on hold. Send “resume” to continue.', scope: 'owner', active: true },
  { id: 0, trigger: 'report', match: 'exact', reply: 'Sending your daily report now.', scope: 'all', active: true },
  { id: 0, trigger: 'help', match: 'exact', reply: 'Commands: status · pause · resume · approve all · report · health.', scope: 'all', active: false },
];
const routes = [
  { id: 0, source: 'Tech News', targets: ['Tech Hub 1', 'Dev Corner 3'], when: { keywords: 'AI, ML', media: true, lang: 'any' }, delay: 0, approval: 'inherit', on: true },
  { id: 0, source: 'AI Daily', targets: ['AI Frontier 5', 'Code Yard 7'], when: { keywords: 'LLM', media: false, lang: 'en' }, delay: 5, approval: 'auto', on: true },
  { id: 0, source: 'Business Daily', targets: ['Biz Desk 6', 'Growth Lab 2'], when: { keywords: '', media: false, lang: 'any' }, delay: 0, approval: 'inherit', on: true },
  { id: 0, source: 'Design Digest', targets: ['Design Loft 4'], when: { keywords: '', media: true, lang: 'any' }, delay: 10, approval: 'manual', on: true },
  { id: 0, source: 'Marketing News', targets: ['Growth Lab 2', 'Product Room 9'], when: { keywords: 'campaign', media: false, lang: 'any' }, delay: 0, approval: 'inherit', on: false },
  { id: 0, source: 'Crypto Pulse', targets: ['Signal Desk 11'], when: { keywords: 'market', media: false, lang: 'any' }, delay: 15, approval: 'manual', on: true },
];
const rules = [
  { id: 0, name: 'Block giveaway spam', cond: { type: 'keyword', value: 'giveaway, airdrop, promo' }, act: { type: 'skip' }, priority: 1, on: true },
  { id: 0, name: 'Hold flagged keywords', cond: { type: 'keyword', value: 'invest now, limited time' }, act: { type: 'flag' }, priority: 2, on: true },
  { id: 0, name: 'Delay media-heavy posts', cond: { type: 'media', value: '3+ items' }, act: { type: 'delay', value: '15 min' }, priority: 3, on: true },
  { id: 0, name: 'Route AI posts to frontier', cond: { type: 'source', value: 'AI Daily, AI Updates' }, act: { type: 'route', value: 'AI Frontier 5' }, priority: 4, on: true },
  { id: 0, name: 'Skip very short posts', cond: { type: 'length', value: '< 40 chars' }, act: { type: 'skip' }, priority: 5, on: false },
];

/* ── analytics ───────────────────────────────────────────────── */
function seriesFor(n, step, shift) {
  const labels = [], published = [], skipped = [], failed = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(NOW - i * step);
    labels.push(n === 24 ? `${String(d.getHours()).padStart(2, '0')}:00` : d.toISOString().slice(5, 10));
    const base = 240 + Math.round(140 * Math.sin(i / 2.2)) + ((i * 37) % 90) + shift;
    published.push(Math.max(40, base + 260));
    skipped.push(Math.round(base * 0.45));
    failed.push(4 + ((i * 7) % 11));
  }
  return { labels, published, skipped, failed };
}
const series = {
  '7d': {
    labels: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
    published: [520, 610, 560, 690, 640, 710, 742],
    skipped: [260, 300, 280, 340, 310, 360, 330],
    failed: [6, 9, 5, 11, 7, 8, 4],
    ticks: [0, 250, 500, 750],
  },
  '1h': (() => {
    const lab = [], pub = [], skp = [], fail = [];
    const now = new Date();
    for (let m = 55; m >= 0; m -= 5) {
      const d = new Date(now.getTime() - m * M);
      lab.push(`${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`);
      pub.push(8 + ((55 - m) % 9) + Math.round(4 * Math.sin((55 - m) / 9)));
      skp.push(4 + ((55 - m * 3) % 5));
      fail.push((55 - m) % 7 === 0 ? 1 : 0);
    }
    return { labels: lab, published: pub, skipped: skp, failed: fail, ticks: [0, 10, 20, 30] };
  })(),
  '24h': seriesFor(24, H, 0),
  '30d': seriesFor(30, D, 120),
  '90d': seriesFor(90, D, 60),
};
const topSources = [
  { name: 'Tech News', pct: 28.4, published: 1935, success: 99.1, skipped: 12, latency: 1.6 },
  { name: 'Business Daily', pct: 24.7, published: 1683, success: 98.4, skipped: 21, latency: 1.9 },
  { name: 'AI Updates', pct: 19.1, published: 1301, success: 99.5, skipped: 8, latency: 1.4 },
  { name: 'Programming', pct: 12.3, published: 838, success: 98.1, skipped: 34, latency: 2.2 },
  { name: 'Product Hunt', pct: 8.9, published: 606, success: 98.8, skipped: 15, latency: 1.7 },
];
const stats = {
  '7d': { total: 6812, success: 98.7, skipped: 118, failed: 49, dTotal: '+6%', dSuccess: '+0.1%', dSkipped: '-4%', dFailed: '-9%', latency: 1.8, dLatency: '-0.3s', reach: '296K', dReach: '+5%' },
  '30d': { total: 28560, success: 98.6, skipped: 420, failed: 128, dTotal: '+14%', dSuccess: '+0.1%', dSkipped: '-7%', dFailed: '-12%', latency: 1.8, dLatency: '-0.3s', reach: '320K', dReach: '+8%' },
  '90d': { total: 84930, success: 98.5, skipped: 1260, failed: 402, dTotal: '+9%', dSuccess: '+0.2%', dSkipped: '-11%', dFailed: '-18%', latency: 1.9, dLatency: '-0.4s', reach: '940K', dReach: '+11%' },
};

/* ── recent activity (initial 5, per §5) · logs 60 · audit 30 ── */
const recentActivity = [
  { id: 1, kind: 'published', status: 'Published', text: 'Tech News Today → 5 channels', at: NOW - 2 * M, ok: true },
  { id: 2, kind: 'skipped', status: 'Skipped', text: 'Keyword not found', at: NOW - 3 * M, ok: true },
  { id: 3, kind: 'published', status: 'Published', text: 'Business Updates → 8 channels', at: NOW - 4 * M, ok: true },
  { id: 4, kind: 'failed', status: 'Failed', text: 'Media check failed', at: NOW - 5 * M, ok: false },
  { id: 5, kind: 'published', status: 'Published', text: 'Daily Digest → 6 channels', at: NOW - 6 * M, ok: true },
];
const LOGM = [
  ['info', 'Broadcast: 12 posts across 44 targets'],
  ['info', 'Source “Tech News” synced — 3 new posts detected'],
  ['warn', 'Target “Biz Desk 6” hit flood wait (2.1s)'],
  ['info', 'Queue flushed: 12 approved posts published'],
  ['error', 'Target “Dev Corner 3” failed: flood wait exceeded'],
  ['info', 'AI rewrite applied to post #4021'],
  ['info', 'Daily report sent to owner at 08:00 (KHI)'],
  ['warn', '2 posts held by rule “Delay media-heavy posts”'],
  ['info', 'Pacing: batch of 12 spread over 21s'],
  ['error', 'Telegram API 502 on source sync — retried OK'],
  ['warn', 'Storage at 62% — no action needed'],
  ['info', 'WhatsApp mirror synced 8 lines'],
];
const logs = [];
for (let i = 0; i < 60; i++) {
  const [level, msg] = LOGM[i % LOGM.length];
  logs.push({ id: i + 1, level, msg, at: NOW - i * 7 * M - (i % 5) * M });
}
const AUDA = ['settings:quiet_hours → off', 'queue:approved 12 posts', 'rules:created “Block giveaway spam”', 'sources:paused Design Digest', 'pacing:delay 12s', 'settings:accent → emerald', 'targets:paused Biz Desk 7', 'ai:rewrite ON for AI Daily', 'reports:exported CSV 30d', 'security:pin updated'];
const audit = [];
for (let i = 0; i < 30; i++) {
  const [action, target] = AUDA[i % AUDA.length].split(':');
  audit.push({ id: i + 1, action, target: target.trim(), actor: i % 9 === 8 ? 'WhatsApp cmd' : 'Admin', at: NOW - (i + 1) * 41 * M });
}
const notifications = {
  unread: 3,
  items: [
    { id: 1, text: 'Target “Dev Corner 3” is in error — reconnect required', at: NOW - 22 * M, read: false, icon: 'alertCircle' },
    { id: 2, text: 'Daily report ready — 742 posts published', at: NOW - 8 * H, read: false, icon: 'send' },
    { id: 3, text: '3 new posts waiting in the queue', at: NOW - 11 * H, read: false, icon: 'inbox' },
    { id: 4, text: 'Setup 2/5 complete — WhatsApp link is next', at: NOW - 2 * D, read: true, icon: 'check' },
    { id: 5, text: 'Storage at 62% — consider a backup', at: NOW - 3 * D, read: true, icon: 'hardDrive' },
  ],
};
const mirror = [
  { at: NOW - 9 * M, text: 'Raqifluz · online — 742 posts published today · queue 3 pending' },
  { at: NOW - 41 * M, text: 'Owner → status' },
  { at: NOW - 42 * M, text: 'Raqifluz is online · 12 sources · 48 targets · queue 3 pending' },
  { at: NOW - 3 * H, text: 'Published 12 posts to 44 targets (spread over 21s)' },
  { at: NOW - 5 * H, text: 'Owner → approve all · done' },
  { at: NOW - 8 * H, text: 'Daily report: 742 posts · 98.7% success · 1.8s avg latency' },
  { at: NOW - 26 * H, text: 'Paused by owner (Panic Stop)' },
  { at: NOW - 25 * H, text: 'Resumed by owner' },
];
const discover = [
  { id: 1, name: 'AI News Wire', handle: '@ainewswire', tag: 'AI', subs: '48.2K', match: 94, desc: 'Fast-moving AI releases and papers. Clean formatting, English-first.' },
  { id: 2, name: 'DevOps Daily', handle: '@devopsdaily', tag: 'Tech', subs: '31K', match: 88, desc: 'Ops culture and tooling notes. High signal-to-noise ratio.' },
  { id: 3, name: 'Design Daily', handle: '@designdaily', tag: 'Design', subs: '62.4K', match: 81, desc: 'Curated UI shots and case studies. Image-heavy feed.' },
  { id: 4, name: 'Fintech Pulse', handle: '@fintechpulse', tag: 'Business', subs: '27.8K', match: 77, desc: 'Banking and payments news. Occasional sponsored posts.' },
  { id: 5, name: 'Science Brief', handle: '@sciencebrief', tag: 'Science', subs: '19.5K', match: 74, desc: 'Weekly science explainers, well sourced, medium length.' },
  { id: 6, name: 'Product Roundup', handle: '@prodrnd', tag: 'Product', subs: '14.1K', match: 71, desc: 'Product teardowns and launch recaps. Screenshot-driven.' },
  { id: 7, name: 'Tech World News', handle: '@techworldnews', tag: 'News', subs: '88K', match: 66, desc: 'Broad tech news wire. Large audience, mixed depth.' },
  { id: 8, name: 'Quantum Notes', handle: '@quantumnotes', tag: 'Science', subs: '8.7K', match: 62, desc: 'Niche deep dives on quantum computing. Expert audience.' },
  { id: 9, name: 'Startup Digest', handle: '@startupdigest', tag: 'Business', subs: '22.3K', match: 58, desc: 'Daily startup funding and launches. Short posts.' },
];
const pilotEvents = [
  { id: 1, at: NOW - 30 * M, msg: 'Auto-approved 4 posts (score 8.1–9.3)', ok: true },
  { id: 2, at: NOW - 2 * H, msg: 'Suggestion applied: “Route AI posts to frontier”', ok: true },
  { id: 3, at: NOW - 7 * H, msg: 'Held 2 posts — quiet hours', ok: true },
  { id: 4, at: NOW - 26 * H, msg: 'Auto-rejected 1 post (spam pattern)', ok: true },
];
const pilotSuggestions = [
  { id: 1, icon: 'route', title: 'Route AI posts to AI Frontier 5', reason: 'Topic overlap 92% — recipients usually engage with this pairing.' },
  { id: 2, icon: 'clock', title: 'Hold weekend posts until Monday 09:00', reason: 'Weekend success rate is 11% lower than weekday average.' },
  { id: 3, icon: 'hash', title: 'Add “#AI” to posts from AI Daily', reason: 'Posts with a consistent tag get 18% more reads in your targets.' },
  { id: 4, icon: 'scissors', title: 'Split long posts from Programming into 2', reason: 'Posts over 400 words have a 3× skip rate in your targets.' },
];
const waMessages = [
  { id: 1, dir: 'in', from: '+92 300 1234567', text: 'status', at: NOW - 41 * M },
  { id: 2, dir: 'out', text: 'Raqifluz is online · 12 sources · 48 targets · queue 3 pending', at: NOW - 42 * M },
  { id: 3, dir: 'in', from: '+92 300 1234567', text: 'approve all', at: NOW - 5 * H },
  { id: 4, dir: 'out', text: 'Approved 3 pending posts. Scheduling with smart pacing.', at: NOW - 5 * H + 4000 },
  { id: 5, dir: 'out', text: 'Published 12 posts to 44 targets (spread over 21s)', at: NOW - 3 * H },
  { id: 6, dir: 'in', from: '+92 300 1234567', text: 'report', at: NOW - 8 * H },
  { id: 7, dir: 'out', text: 'Daily report: 742 posts · 98.7% success · 1.8s avg latency', at: NOW - 8 * H + 4000 },
];
/* brand */
const brand = {
  name: 'Raqifluz', tagline: 'Elegant. Powerful. Yours.',
  tone: 'professional',
  footer: '— via {brand} · {date}', footerEnabled: false,
  hashtags: [{ name: 'Default', tags: ['#raqifluz', '#updates'] }, { name: 'AI', tags: ['#AI', '#Tech'] }, { name: 'Business', tags: ['#Business', '#Growth'] }],
  watermark: { pos: 'bottom-end', opacity: 45 },
  accent: 'emerald',
};
/* health (8 checks for page + topbar; 5 short for home) */
const health = {
  score: 98,
  checks: [
    { id: 1, name: 'Bot Connection', ok: true, metric: '12 sources · 2 active now', icon: 'radio' },
    { id: 2, name: 'Queues', ok: true, metric: 'running · 0 stuck', icon: 'inbox' },
    { id: 3, name: 'Errors', ok: true, metric: '0 in last 24h', icon: 'alertCircle' },
    { id: 4, name: 'Storage', ok: true, metric: '62% used (3.1 / 5 GB)', icon: 'hardDrive' },
    { id: 5, name: 'Latency', ok: true, metric: '1.8s avg', icon: 'zap' },
    { id: 6, name: 'Scheduler', ok: true, metric: 'next slot in 55m', icon: 'calendar' },
    { id: 7, name: 'WhatsApp Mirror', ok: true, metric: '88ms · in sync', icon: 'message' },
    { id: 8, name: 'Backups', ok: true, metric: 'last 6h ago · daily', icon: 'cloud' },
  ],
  home: [
    { name: 'Bot Connected', ok: true },
    { name: 'Queues Healthy', ok: true },
    { name: 'No Errors', ok: true },
    { name: 'Storage 62%', ok: true },
    { name: 'Latency OK', ok: true },
  ],
};

/* assign stable sequential ids to every collection that seeds id:0 / no id */
for (const list of [sources, targets, queue, library, contacts, autoReplies, routes, rules]) {
  list.forEach((row, i) => { row.id = i + 1; });
}

const db = {
  meta: {
    product: 'Raqifluz', version: '1.0.0', tagline: 'Elegant. Powerful. Yours.',
    timezone: 'Asia/Karachi', mode: 'simulation',
    nodeVersion: process.version,
    uptimeSince: NOW - 34 * D - 6 * H,
  },
  paused: false,
  sources, targets, queue, history, scheduled, reports, library,
  contacts, autoReplies, routes, rules,
  analytics: { series, topSources, stats, kpis: {
    today: { value: 742, delta: '+12%', spark: [520, 610, 560, 690, 640, 710, 742] },
    success: { value: '98.7%', delta: '+0.1%', spark: [98.1, 98.4, 98.2, 98.5, 98.4, 98.6, 98.7] },
    net: { value: '12 / 48', delta: '+0.1%', spark: [10, 11, 11, 12, 12, 12, 12] },
    latency: { value: '1.8s', delta: '-0.3s', spark: [2.4, 2.2, 2.1, 2.0, 1.9, 1.9, 1.8] },
  } },
  pacing: { enabled: true, delay: 12, rate: 1.8, spread: 21 },
  recentActivity, notifications, mirror, discover, pilotEvents, pilotSuggestions, waMessages, logs, audit, brand, health,
  setup: {
    steps: [
      { name: 'Connect first source channel', done: true },
      { name: 'Add targets', done: true },
      { name: 'Set report time', done: false },
      { name: 'Link WhatsApp', done: false },
      { name: 'Run self-test', done: false },
    ],
  },
  settings: {
    name: 'Admin', botName: 'Raqifluz',
    reportTime: '08:00', language: 'en', timezone: 'Asia/Karachi',
    theme: 'dark', accent: 'emerald',
    waOwner: '+92 300 1234567', channelName: 'Raqifluz Control',
    pinHash: 'sha256:salt:9f86d081884c7d659ab234ef76cd12aa', pinChanged: NOW - 20 * D,
    allowedCommands: ['status', 'pause', 'resume', 'approve all', 'report', 'health'],
    pacing: { speed: 'Normal', adaptive: true, minDelay: 8, maxDelay: 45, maxPerMin: 2, dailyCap: 1500, quietFrom: '23:00', quietTo: '06:00', bestTime: ['09:00–11:00', '14:00–16:00', '19:00–21:00'], jitter: 20, burst: 3, weekendSat: true, weekendSun: true },
    automation: { approval: 'manual', bulkDelay: 5, retries: 3, backoff: '2m', maxPostAge: 24, translateTo: 'none', shortenerDomain: '' },
    ai: { pilotMode: 'off', blocklist: ['@spamwire'], allowlist: [], flagKeywords: ['invest now', 'limited time'], minTextLength: 0 },
    notifications: { pendingThreshold: 5, healthThreshold: 85, digestDay: 'monday' },
    storage: { logRetention: 30, auditRetention: 365, backupFreq: 'daily', cloudProvider: 'none' },
    switches: {
      auto_approve_trusted: false, dedupe_posts: false, strip_links: false, brand_footer: false,
      auto_translate: false, ai_rewrite: false, auto_hashtags: false, link_shortener: false,
      blocklist: false, allowlist_only: false, skip_no_media: false, max_post_age: false, flag_keywords: false, profanity_filter: false,
      quiet_hours: false, best_time: false, random_jitter: false, weekend_pause: false, burst_guard: false,
      daily_report: false, notify_failure: false, notify_pending: false, health_alert: false, weekly_digest: false,
      ai_pilot_suggest: false, auto_replies: false, smart_discover: false, auto_route: false,
      auto_backup: false, cloud_sync: false, extended_audit: false, pin_for_changes: false, confirm_bulk: false,
    },
  },
};

export function ensureSeed() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  store.reset(db);
}
if (import.meta.url === `file://${process.argv[1]}`) {
  ensureSeed();
  console.log('seed written to', DB_FILE);
}
