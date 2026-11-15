/* ═══════════════════════════════════════════════════════════════════
   RAQIFLUZ CHANNEL BOT — PRECISION CONSOLE SPA · MINIMAL SHELL (v8.0.0)
   v8.0.0: the 26-item/8-group sidebar is rebuilt as six job-areas
   (Home · Inbox · Channels · Content · Automate · Insights) + Settings,
   each with a contextual inner-tab row; every screen is still one
   click away (inner tab) or one ⌘K away (palette). No feature removed.
   Rebuilt from blank per contract v3 (legacy-free zone). Zero shared
   code with the deleted 7.6.0 app.js — every behavior re-implemented
   against the same API surface (see PARITY.md).
   Sections: 1 core · 2 theme · 3 shell · 4 router · 5 status+SSE ·
   6 N1 sync · 7 modal · 8 picker (N2) · 9 states · 10 home ·
   11 channels · 12 power · 13 templates · 14 composer · 15 posts ·
   16 analytics · 17 whatsapp · 18 outreach · 19 journal/health/logs ·
   20 settings · 21 robot · 22 cards · 23 palette+keys · 24 boot
   ═══════════════════════════════════════════════════════════════════ */
'use strict';

/* ── 1 · CORE ───────────────────────────────────────────────────── */
const $ = (s, r) => (r || document).querySelector(s);
const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
/* v1.1: display-only fix for the library's "QR refs" typo (internal matching in wa.js untouched) */
const fixDetail = (s) => String(s == null ? '' : s).replace(/QR refs/gi, 'QR refresh');
/* a channel name must never render as a raw number */
const jidPrettify = (name, jid) => {
  const j = String(jid || '');
  const digits = j.split('@')[0].split(':')[0].replace(/\D/g, '');
  let n = String(name || '').trim();
  if (!n || /^\d{6,}$/.test(n)) {
    n = j.endsWith('@g.us') ? (digits ? `Group •${digits.slice(-6)}` : j)
      : (digits ? (j.endsWith('@s.whatsapp.net') ? `+${digits}` : `Contact •${digits.slice(-4)}`) : j);
  }
  return n;
};
const chanName = (c) => {
  const n = String(c.name || '').trim();
  if (n && n !== c.jid && !/^\d+(@[a-z.]+)?$/i.test(n)) return n;
  return 'Channel •' + String(c.jid).split('@')[0].slice(-4);
};
const shortJid = (j) => esc(String(j || '').replace('@newsletter', ''));
const fmtNum = (n) => {
  n = Number(n) || 0;
  if (n >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
  if (n >= 1e5) return (n / 1e3).toFixed(1).replace(/\.0$/, '') + 'k';
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
};
const when = (ts) => {
  try {
    let v = String(ts == null ? '' : ts).trim();
    if (!v) return '';
    if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(v)) v = v.replace(' ', 'T') + 'Z'; // sqlite UTC
    const d = new Date(v);
    if (isNaN(d.getTime())) return esc(String(ts));
    return d.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  } catch (e) { return esc(String(ts)); }
};
const agoLabel = (ts) => {
  if (!ts) return '<span class="muted">never</span>';
  const mins = Math.floor((Date.now() - new Date(String(ts).replace(' ', 'T') + 'Z').getTime()) / 60000);
  if (Number.isNaN(mins)) return esc(ts);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago${hrs >= 24 * 7 ? ' (stale)' : ''}`;
};

let TOKEN = '';
try { TOKEN = localStorage.getItem('rq6-token') || ''; } catch (e) {}
async function api(path, opts = {}) {
  const headers = { ...(opts.headers || {}) };
  if (opts.body && typeof opts.body === 'object' && Object.prototype.toString.call(opts.body) !== '[object ArrayBuffer]') { headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(opts.body); }
  // (ArrayBuffer bodies — e.g. the backup-restore upload — are sent raw with the caller's Content-Type)
  if (TOKEN) headers.Authorization = 'Bearer ' + TOKEN;
  const res = await fetch(path, { ...opts, headers });
  if (res.status === 401) { location.href = '/login'; throw new Error('logged out'); }
  const data = await res.json().catch(() => ({ ok: false, error: 'Bad response' }));
  if (!res.ok || data.ok === false) throw new Error(data.error || ('HTTP ' + res.status));
  return data;
}

/* toasts — bottom-right stack, 4 s, optional action (Undo) */
function toast(msg, tone = '', action = null) {
  const t = document.createElement('div');
  t.className = 'toast ' + tone;
  t.innerHTML = `<span style="flex:1;min-width:0">${esc(msg)}</span>`;
  if (action) {
    const b = document.createElement('button');
    b.className = 'btn btn-sm btn-g t-undo';
    b.textContent = action.label;
    b.addEventListener('click', () => { try { action.fn(); } finally { t.remove(); } });
    t.appendChild(b);
  }
  /* spec §3.6 — errors persist until dismissed; everything else self-clears */
  if (tone === 'err') {
    const x = document.createElement('button');
    x.className = 'btn btn-sm btn-g t-undo';
    x.textContent = 'Dismiss';
    x.addEventListener('click', () => t.remove());
    t.appendChild(x);
  } else {
    setTimeout(() => t.remove(), 4000);
  }
  $('#toasts').appendChild(t);
}

/* icons — vendored local /icons/*.svg (no CDN), cached */
const _icoCache = new Map();
async function ico(name) {
  if (_icoCache.has(name)) return _icoCache.get(name);
  const svg = await fetch('/icons/' + name + '.svg').then((r) => r.text()).then((t) => t.replace(/width="\d+"\s*height="\d+"\s*/, '')).catch(() => '');
  _icoCache.set(name, svg);
  return svg;
}

/* ── 2 · THEME (dark / light / auto, persisted) ─────────────────── */
function themeCurrent() {
  let t = 'dark';
  try { t = localStorage.getItem('rc-theme') || localStorage.getItem('rq6-theme') || 'dark'; } catch (e) {}
  return t;
}
function themeApplied(t) { return t === 'auto' ? (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark') : t; }
/* v11 · theme order: dark → light → glass → auto (glass = frosted third theme) */
const THEME_ORDER = ['dark', 'light', 'glass', 'auto'];
function setThemeIcon(t) {
  const b = $('#themeBtn');
  if (!b) return;
  const name = t === 'dark' ? 'sun' : (t === 'light' ? 'moon' : t === 'glass' ? 'sparkles' : 'gauge');
  const next = THEME_ORDER[(THEME_ORDER.indexOf(t) + 1) % THEME_ORDER.length];
  b.setAttribute('data-tip', `Theme: ${t} — click for ${next}`);
  b.title = `Theme: ${t} — click for ${next}`;
  ico(name).then((s) => { if (b.isConnected) b.innerHTML = s; });
}
(function themeInit() {
  const t = themeCurrent();
  document.documentElement.dataset.theme = themeApplied(t);
  setThemeIcon(t);
  if (t === 'auto') matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => { document.documentElement.dataset.theme = themeApplied('auto'); });
})();
$('#themeBtn').addEventListener('click', () => {
  const cur = themeCurrent();
  const next = THEME_ORDER[(THEME_ORDER.indexOf(cur) + 1) % THEME_ORDER.length];
  try { localStorage.setItem('rc-theme', next); } catch (e) {}
  document.documentElement.dataset.theme = themeApplied(next);
  setThemeIcon(next);
});

/* ── 2b · 5D (R66) NOTIFICATION CENTER ──────────────────────────── */
let notifOpen = false;
async function notifBadge() {
  try {
    const d = await api('/api/notifications?limit=1');
    const b = $('#notifBadge');
    if (!b) return;
    if (d.unread > 0) { b.hidden = false; b.textContent = d.unread > 99 ? '99+' : String(d.unread); }
    else b.hidden = true;
  } catch (e) {}
}
async function notifOpenPanel() {
  notifOpen = true;
  $('#notifPanel').hidden = false;
  $('#notifList').innerHTML = '<div class="muted tiny" style="padding:12px">Loading…</div>';
  try {
    const d = await api('/api/notifications');
    $('#notifList').innerHTML = (d.list || []).length
      ? d.list.map((n) => `<div class="notif-item${n.read ? '' : ' unread'}" data-nid="${n.id}">
          <span class="notif-kind">${esc(n.kind)}</span>
          <span class="notif-text">${esc(n.text)}</span>
          <span class="notif-time num">${when(n.ts)}</span></div>`).join('')
      : '<div class="muted tiny" style="padding:12px">Nothing yet — alerts, reports and self-tests land here.</div>';
    notifBadge();
  } catch (e) { $('#notifList').innerHTML = '<div class="muted tiny" style="padding:12px">Could not load notifications.</div>'; }
}
$('#notifBtn').addEventListener('click', async (ev) => {
  ev.stopPropagation();
  if (notifOpen) { notifOpen = false; $('#notifPanel').hidden = true; }
  else await notifOpenPanel();
});
document.addEventListener('click', (ev) => {
  if (!notifOpen) return;
  const p = $('#notifPanel');
  if (p && !p.hidden && !p.contains(ev.target) && ev.target.id !== 'notifBtn') { notifOpen = false; p.hidden = true; }
});
document.addEventListener('click', (ev) => {
  const item = ev.target.closest && ev.target.closest('.notif-item.unread');
  if (!item) return;
  item.classList.remove('unread');
  api('/api/notifications/' + item.dataset.nid + '/read', { method: 'POST' }).then(notifBadge).catch(() => {});
}, true);
$('#notifReadAll').addEventListener('click', async (ev) => {
  ev.stopPropagation();
  try { await api('/api/notifications/read', { method: 'POST' }); $('#notifList').querySelectorAll('.notif-item').forEach((x) => x.classList.remove('unread')); notifBadge(); } catch (e) {}
});
setInterval(notifBadge, 60000);

/* ── 3 · SHELL (6-area rail, inner-tab row, drawer, bottom tabs) ───── */
(function shell() {
  const app = $('#app');
  const collapse = $('#sbCollapse') || $('#sideCollapse');
  if (collapse) collapse.addEventListener('click', () => {
    app.classList.toggle('side-min');
    try { localStorage.setItem('rc-side', app.classList.contains('side-min') ? 'min' : 'full'); } catch (e) {}
  });
  /* restore the persisted rail state (reference: the collapse control is in the brand lockup) */
  try { if (localStorage.getItem('rc-side') === 'min') app.classList.add('side-min'); } catch (e) {}
  const menu = $('#menuBtn');
  if (menu) menu.addEventListener('click', () => app.classList.toggle('side-open'));
  const scrim = $('#sideScrim');
  if (scrim) scrim.addEventListener('click', () => app.classList.remove('side-open'));
  /* settings mini-nav: one section at a time, remembered */
  const setNav = $('#setNav');
  let savedG = null; try { savedG = localStorage.getItem('rc-setgroup'); } catch (e) {}
  if (setNav) {
    /* Signal Desk §1.4: a tab may cover several set-groups (data-sets="whatsapp,ai").
       The tab shows EVERY group it covers — the primary setgroup is only the
       identity that gets remembered in localStorage. */
    const tabSets = (t) => (t.dataset.sets || t.dataset.setgroup || '').split(',').map((x) => x.trim()).filter(Boolean);
    const activate = (tab, click) => {
      const sets = tabSets(tab);
      $$('.set-tab', setNav).forEach((x) => x.classList.toggle('on', x === tab));
      $$('.set-group').forEach((x) => x.classList.toggle('on', sets.includes(x.dataset.setgroup)));
      if (click) { try { localStorage.setItem('rc-setgroup', tab.dataset.setgroup); } catch (e) {} }
    };
    if (savedG) {
      const t0 = $$('.set-tab', setNav).find((x) => tabSets(x).includes(savedG));
      if (t0) activate(t0, false);
    }
    setNav.addEventListener('click', (ev) => { const tab = ev.target.closest('.set-tab'); if (tab) activate(tab, true); });
  }
})();

/* ── 4 · ROUTER (Meridian 2 — 6 areas → 23 content screens + 5 settings sections) ─
   One home per switch. Old view names still resolve through LEGACY_VIEWS so any
   deep link, button or saved view keeps working after the regrouping. */
const TITLES = {
  home: 'Home', sources: 'Sources', browse: 'Discover', targets: 'Targets', routing: 'Routing',
  newpost: 'Compose', scheduled: 'Scheduled', approvals: 'Queue',
  posts: 'History', media: 'Library', branding: 'Brand',
  aipilot: 'AI Pilot', guardrails: 'Rules', digest: 'Reports & Digest', aireply: 'Auto-replies',
  whatsapp: 'WhatsApp Inbox', journal: 'Contacts',
  bulk: 'Bulk Send', email: 'Email',
  analytics: 'Analytics', health: 'Health', logs: 'Logs',
  settings: 'Settings', audit: 'Audit', about: 'About'
};
/* pre-Meridian-2 names → their one home now (never dead links) */
const LEGACY_VIEWS = {
  dashboard: 'home', content: 'newpost', beautify: 'newpost',
  calendar: 'scheduled', templates: 'media', 'auto-reply': 'aireply'
};
/* every view maps to one of the eight Signal Desk groups (spec §1.3). Drives sidebar state. */
const AREA = {
  home: 'overview', analytics: 'overview', digest: 'overview',
  newpost: 'publish', approvals: 'publish', scheduled: 'publish', posts: 'publish', bulk: 'publish', media: 'publish',
  sources: 'channels', targets: 'channels', browse: 'channels', routing: 'channels', guardrails: 'channels',
  whatsapp: 'audience', journal: 'audience', aireply: 'audience', aipilot: 'audience',
  branding: 'system', health: 'system', logs: 'system', audit: 'system', email: 'system', settings: 'system', about: 'system'
};
/* Reference top-bar breadcrumb labels (one per group) */
const GROUP_LABEL = {
  overview: 'OVERVIEW', publish: 'PUBLISHING & CONTENT', channels: 'CHANNELS & ROUTING',
  audience: 'AUDIENCE & AUTOMATION', system: 'SYSTEM & WORKSPACE'
};
const loaders = {};
let currentView = 'home';
function show(view) {
  view = LEGACY_VIEWS[view] || view;
  if (!TITLES[view]) return;
  currentView = view;
  $$('.view').forEach((v) => { v.hidden = v.dataset.view !== view; });
  const area = AREA[view] || 'overview';
  /* v1.1: merged nav items (data-views family) stay lit across their tabs; in-view tab rows track too */
  $$('#sidebar .sb-item').forEach((a) => {
    const fam = a.dataset.views ? a.dataset.views.split(',') : null;
    a.classList.toggle('on', fam ? fam.includes(view) : a.dataset.view === view);
  });
  $$('#sidebar .sb-group').forEach((g) => g.classList.toggle('on', g.dataset.group === area));
  $$('.vtab').forEach((t) => t.classList.toggle('on', t.dataset.go === view));
  $$('.bt').forEach((a) => a.classList.toggle('on', a.dataset.view === view));
  $('#viewTitle').textContent = TITLES[view];
  /* Reference top bar: breadcrumb = GROUP / Screen */
  const cg = $('#crumbGroup');
  if (cg) cg.textContent = (GROUP_LABEL[area] || 'OVERVIEW');
  $('#app').classList.remove('side-open');
  const content = $('#content');
  if (content) content.scrollTop = 0;
  try { localStorage.setItem('rc-view', view); } catch (e) {}
  /* Meridian 2: deep links — the URL hash is the screen address (#view=posts) */
  try {
    const target = '#view=' + view;
    if (location.hash !== target && !location.hash.startsWith(target + '&')) history.replaceState(null, '', target);
  } catch (e) {}
  /* Meridian 2: page transition — 200 ms fade + 8 px rise (0 ms under reduced motion) */
  const sec = $(`.view[data-view="${view}"]`);
  if (sec) { sec.classList.remove('view-in'); void sec.offsetWidth; sec.classList.add('view-in'); }
  paintRecent(view);
  const ld = loaders[view];
  if (!ld) return;
  const oldErr = sec && sec.querySelector('.view-err');
  if (oldErr) oldErr.remove();
  ld().then(() => deepRowMaybe()).catch((e) => {
    toast(e.message, 'err');
    if (!sec) return;
    const box = document.createElement('div');
    box.className = 'card view-err';
    box.innerHTML = `<div class="es">${ico('alert').then((s) => { if (box.isConnected) box.querySelector('.es').insertAdjacentHTML('afterbegin', s); })}
      <div class="es-t">Couldn't load this view</div>
      <div class="es-s">${esc(e.message || e)}</div>
      <button class="btn" data-retry>Retry</button></div>`;
    sec.appendChild(box);
    box.querySelector('[data-retry]').addEventListener('click', () => show(view));
  });
}
/* rail area buttons (data-go = the area's primary view) + inner-tab leaves + mobile tabs */
$$('.sb-item').forEach((a) => {
  const go = () => show(a.dataset.go || a.dataset.view);
  a.addEventListener('click', go);
  a.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); go(); } });
});
/* v1.1: in-view tab rows on merged screens (reuse the same router) */
$$('.vtab').forEach((t) => {
  const go = () => show(t.dataset.go);
  t.addEventListener('click', go);
  t.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); go(); } });
});
$$('.bt').forEach((a) => a.addEventListener('click', () => {
  const v = a.dataset.view;
  if (v === '__publish') {
    /* Publish entry — land on the last-used Publish tab (Compose if none saved) */
    let last = 'newpost';
    try {
      const saved = localStorage.getItem('rc-view');
      if (saved && AREA[saved] === 'publish' && TITLES[saved]) last = saved;
    } catch (e) {}
    show(last);
    return;
  }
  show(v);
}));

/* ── 4b · RECENT (last 3 places, one tap back) + DEEP ROWS ──────── */
function __recentList() {
  try { return (localStorage.getItem('rc-recent') || '').split(',').filter(Boolean); } catch (e) { return []; }
}
function paintRecent(view) {
  let list = __recentList().filter((x) => x !== view && TITLES[x]);
  const cur = __recentList().find((x) => x === view);
  if (cur) list = [cur, ...list].slice(0, 3);
  try { localStorage.setItem('rc-recent', list.join(',')); } catch (e) {}
  const strip = $('#recentStrip');
  if (!strip) return;
  const items = list.slice(0, 3).filter((x) => x !== view);
  strip.hidden = items.length === 0;
  strip.innerHTML = '<span class="rc-lbl">Recent</span>' + items.map((x) =>
    `<button class="rc-chip" data-rv="${x}" title="Go back to ${TITLES[x]}">${TITLES[x]}</button>`).join('');
  $$('.rc-chip', strip).forEach((b) => b.addEventListener('click', () => show(b.dataset.rv)));
}
/* row-level deep links: #view=posts&row=123 — the row is highlighted once loaded */
window.__deepRow = null;
function deepRowMaybe() {
  const id = window.__deepRow;
  if (!id) return;
  window.__deepRow = null;
  const sec = $(`.view[data-view="${currentView}"]`);
  if (!sec) return;
  const row = sec.querySelector(`[data-row="${CSS.escape(id)}"]`);
  if (row) { row.scrollIntoView({ block: 'center' }); row.classList.add('row-flash'); setTimeout(() => row.classList.remove('row-flash'), 1600); }
}

/* ── 5 · STATUS + SSE ───────────────────────────────────────────── */
const STATUS_TEXT = { open: 'Connected', qr: 'Scan QR', close: 'Disconnected', connecting: 'Connecting…' };
async function pollStatus() {
  try {
    const st = await api('/api/status');
    window.__waStatus = st.status;
    if (window.__updateWaGates) window.__updateWaGates(st.status);
    /* v1.1: the duplicate badge was merged into the unified connection pill — keep the binding null-safe */
    const b = $('#waBadge');
    if (b) {
      b.dataset.s = st.status;
      const bt = $('#waBadgeText'); if (bt) bt.textContent = STATUS_TEXT[st.status] || st.status;
      b.hidden = st.status === 'open';
    }
    if (window.__sdConnState) window.__sdConnState(st.status);
    if (window.__sdSideHealth) window.__sdSideHealth(st.status);
    const qrCard = $('#qrCard');
    if (st.status === 'qr') {
      qrCard.hidden = false;
      $('#qrDetail').textContent = fixDetail(st.detail || 'Scan the QR with WhatsApp → Linked devices');
      const qr = await api('/api/qr');
      if (qr.qr) $('#qrImg').src = qr.qr;
    } else if (st.status === 'open') {
      qrCard.hidden = true;
    }
  } catch (e) { /* badge retries next tick */ }
}
setInterval(pollStatus, 30000);

/* ── 5b · SIGNAL DESK REFERENCE SHELL (presentation only — reuses live data) ──
   Connection pill, paired-identity card, one-line sidebar health, the Home
   greeting + activity chart + queue/health/pacing panels, theme radios,
   sidebar collapse, and the data-goview deep links. No business logic here;
   every value comes from the existing /api/* endpoints. */
(function sdShell() {
  const CONN_TXT = { open: 'Linked', qr: 'Scan QR', connecting: 'Connecting…', close: 'Offline' };
  window.__sdConnState = (status) => {
    const st = CONN_TXT[status] || status;
    const el = $('#connState'); if (el) el.textContent = st;
    const dot = $('#connDot'); if (dot) dot.dataset.s = status;
    const pill = $('#connPill'); if (pill) pill.dataset.s = status;
    /* sidebar paired-identity card mirrors the same state */
    const t = $('#pairedTitle'), s = $('#pairedSub'), pd = $('#pairedDot');
    if (t) t.textContent = status === 'open' ? 'WhatsApp linked' : 'WhatsApp';
    if (s) s.textContent = status === 'open' ? 'Owner identity · Linked once' : 'Link from Home — one scan, never again';
    if (pd) pd.dataset.s = status;
  };
  /* v1.1: unified connection pill — one control, not two. Click → the QR (or the inbox when linked) */
  const __pill = $('#connPill');
  if (__pill) __pill.addEventListener('click', () => {
    if (window.__waStatus === 'open') { show('whatsapp'); return; }
    show('home');
    const q = $('#qrCard');
    if (q) q.hidden = false;
    setTimeout(() => { if (q && q.isConnected) q.scrollIntoView({ behavior: 'smooth', block: 'center' }); }, 60);
    api('/api/qr').then((r) => { if (r && r.qr) { const im = $('#qrImg'); if (im) im.src = r.qr; } }).catch(() => {});
  });
  let __healthCache = null;
  window.__sdSideHealth = async (status) => {
    const dot = $('#sideHealthDot'); if (dot) dot.dataset.s = status;
    /* pull the real 8-part score at most once a minute for the one-line readout */
    if (Date.now() - (__healthCache && __healthCache.at || 0) < 60000 && __healthCache && __healthCache.val) { paint(__healthCache.val); return; }
    try {
      const h = await api('/api/health');
      __healthCache = { at: Date.now(), val: h };
      paint(h);
    } catch (e) { /* keep last good readout */ }
    function paint(h) {
      const parts = (h && h.parts) || [];
      const passed = parts.filter((p) => (p.score || 0) >= 80).length;
      const score = (h && typeof h.score === 'number') ? h.score : (parts.length ? Math.round(parts.reduce((a, p) => a + (p.score || 0), 0) / parts.length) : 0);
      const txt = $('#sideHealthTxt'), cnt = $('#sideHealthCount');
      /* v1.1: "healthy" only when ALL checks pass — 5/8 says "3 systems need attention" */
      const nBad = (parts.length || 8) - passed;
      if (txt) txt.textContent = nBad === 0 ? 'All systems healthy' : `${nBad} system${nBad === 1 ? '' : 's'} need${nBad === 1 ? 's' : ''} attention`;
      if (cnt) cnt.textContent = `${passed}/${parts.length || 8}`;
      const d2 = $('#sideHealthDot'); if (d2) d2.dataset.h = nBad === 0 ? 'ok' : (nBad <= Math.ceil((parts.length || 8) / 2) ? 'warn' : 'err');
    }
  };
  /* Home greeting by hour of day (owner name comes from the sidebar user row) */
  function greet() {
    const h = new Date().getHours();
    const part = h < 5 ? 'Good night' : (h < 12 ? 'Good morning' : (h < 17 ? 'Good afternoon' : 'Good evening'));
    const who = ($('#userName') && $('#userName').textContent) || 'Admin';
    const el = $('#homeGreeting'); if (el) el.textContent = `${part}, ${who}.`;
    const sub = $('#homeSub');
    if (sub) sub.textContent = (window.__waStatus && window.__waStatus !== 'open')
      ? 'Link WhatsApp to start mirroring — one scan, and it is never needed again.'
      : 'Your broadcast desk is operating normally. Here is the signal across your channels.';
  }
  /* Home reference panels — real data from /api/overview, /api/queue, /api/health */
  window.sdPaintHomePanels = async (ov) => {
    try {
      const [q, h] = await Promise.all([api('/api/queue').catch(() => null), api('/api/health').catch(() => null)]);
      /* queue status */
      const hq = $('#homeQueue');
      if (hq) {
        const pending = (q && q.pending && q.pending.length) || (ov && ov.queue && ov.queue.pending) || 0;
        const delayed = (q && q.queued) || 0;
        const approved = (q && q.approved && q.approved.length) || 0;
        hq.innerHTML = `
          <div class="queue-total"><strong>${pending}</strong><span>pending approval</span></div>
          <div class="queue-metrics">
            <div><i class="metric-dot amber-dot"></i><span>Pending</span><strong>${pending}</strong></div>
            <div><i class="metric-dot blue-dot"></i><span>Delayed</span><strong>${delayed}</strong></div>
            <div><i class="metric-dot green-dot"></i><span>Approved</span><strong>${approved}</strong></div>
          </div>
          <button class="btn btn-g full-width" data-goview="approvals">Review approvals →</button>`;
      }
      /* system health — v11: mockup 01 layout, one segment per real check (8 checks) */
      const hh = $('#homeHealth');
      if (hh && h) {
        const parts = (h.parts) || [];
        const passed = parts.filter((p) => (p.score || 0) >= 80).length;
        const score = (typeof h.score === 'number') ? h.score : 0;
        const segs = parts.map((p) => `<i class="hseg" data-s="${(p.score || 0) >= 80 ? 'ok' : 'warn'}" title="${esc(p.name)} — ${p.score || 0}/100"></i>`).join('');
        const nBad = parts.length - passed;
        hh.innerHTML = `
          <div class="health-score-line"><div class="health-score"><strong>${score}</strong><small>/100</small></div><span class="muted tiny">${parts.length || 8} checks</span></div>
          <div class="hsegs">${segs}</div>
          <div class="health-bottom"><span>${passed} healthy${nBad ? ` · ${nBad} needs attention` : ''}</span><a class="text-link" href="#view=health" data-goview="health">Run self-test →</a></div>`;
      }
      /* adaptive pacing — paint into #homePaceBody, never #homePace (which owns the pinned #paceStrip)
         v11: mode chip + real stats (fixed 1.5 s gap, live queue depth) — the controller is automatic, so no manual toggle */
      const hp = $('#homePaceBody');
      if (hp) {
        const pace = (ov && ov.pace) || {};
        const depth = (ov && ov.queue && ov.queue.pending) || 0;
        const chip = pace.active
          ? '<span class="pace-chip on"><i class="pc-dot"></i>Adaptive · Active</span>'
          : '<span class="pace-chip"><i class="pc-dot"></i>Adaptive · Stable</span>';
        const stats = `<div class="pace-stats"><div><strong>1.5 s</strong><span>fixed gap between sends</span></div><div><strong>${depth}</strong><span>item(s) in queue</span></div></div>`;
        if (pace.active) {
          const gap = Math.round((pace.gapMs || 0) / 1000);
          hp.innerHTML = `
            ${chip}
            <div class="pacing-rate" style="margin-top:10px"><strong>${gap}</strong><span>s added between sends right now</span></div>
            <p class="panel-copy">The adaptive controller is waiting longer against ${esc(pace.reason || 'a recent failure spike')} — it clears itself after 20 quiet minutes.</p>
            <div class="pacing-meter"><span style="width:${Math.min(100, 25 + gap)}%"></span></div>
            <div class="meter-labels"><span>Conservative</span><span>Current</span><span>Maximum</span></div>${stats}`;
        } else {
          hp.innerHTML = `
            ${chip}
            <p class="panel-copy">No failure spike right now — posts flow at the normal rate. The controller adds a gap automatically after repeated failures and never drops a post.</p>
            <div class="pacing-meter"><span style="width:0%"></span></div>
            <div class="meter-labels"><span>Conservative</span><span>Current</span><span>Maximum</span></div>${stats}`;
        }
      }
    } catch (e) { /* panels keep their last good state */ }
  };
  /* Home activity chart — real hourly outcome counts for the last 24 h */
  window.sdPaintHomeChart = async () => {
    const host = $('#homeChartSvg'); if (!host) return;
    let d; try { d = await api('/api/overview/hourly'); } catch (e) { return; }
    const B = (d && d.buckets) || [], L = (d && d.labels) || [];
    if (!B.length) return;
    const max = Math.max(1, ...B.flatMap((b) => [b.published, b.skipped, b.failed]));
    const W = 700, H = 210, TOP = 20, BOT = 188;
    const x = (i) => Math.round((i / (B.length - 1)) * W);
    const y = (v) => Math.round(BOT - (v / max) * (BOT - TOP));
    const line = (key) => B.map((b, i) => `${i ? 'L' : 'M'}${x(i)} ${y(b[key] || 0)}`).join(' ');
    const areaPub = `M0 ${BOT} ` + B.map((b, i) => `L${x(i)} ${y(b.published || 0)}`).join(' ') + ` L${W} ${BOT} Z`;
    const grid = `M0 ${y(max)}H${W} M0 ${y(max * 2 / 3)}H${W} M0 ${y(max / 3)}H${W} M0 ${BOT}H${W}`;
    host.innerHTML = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Post outcomes over the last 24 hours">
      <defs><linearGradient id="sdArea" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="var(--accent)" stop-opacity=".18"/><stop offset="1" stop-color="var(--accent)" stop-opacity="0"/></linearGradient></defs>
      <path class="gridline" d="${grid}"/>
      <path class="area-published" d="${areaPub}" fill="url(#sdArea)"/>
      <path class="line-published" d="${line('published')}"/>
      <path class="line-skipped" d="${line('skipped')}"/>
      <path class="line-failed" d="${line('failed')}"/>
    </svg>`;
    const cy = $('#homeChartY');
    if (cy) cy.innerHTML = `<span>${max}</span><span>${Math.round(max * 2 / 3)}</span><span>${Math.round(max / 3)}</span><span>0</span>`;
    const cx = $('#homeChartX');
    if (cx) { const picks = [0, 4, 8, 12, 16, 20, B.length - 1]; cx.innerHTML = picks.map((i) => `<span>${L[i] || ''}</span>`).join(''); }
    const tot = B.reduce((a, b) => a + (b.published || 0) + (b.skipped || 0) + (b.failed || 0), 0);
    const foot = $('#homeChartFoot');
    if (foot) foot.textContent = tot ? `${tot} post outcome(s) in the last 24 hours, Pakistan time.` : 'No post outcomes in the last 24 hours yet.';
  };
  /* deep links: any [data-goview] jumps to that screen (works on buttons + links) */
  document.addEventListener('click', (e) => {
    const g = e.target.closest('[data-goview]');
    if (!g) return;
    const view = g.dataset.goview;
    const item = $$('.sb-item').find((a) => a.dataset.view === view);
    if (item) item.click();
  });
  /* theme radios (Workspace & language) share the sidebar theme cycle */
  function syncThemeRadios() {
    const t = (function () { try { return localStorage.getItem('rc-theme') || 'dark'; } catch (e) { return 'dark'; } })();
    $$('#themeRadios [data-theme-choice]').forEach((b) => b.classList.toggle('selected', b.dataset.themeChoice === t));
  }
  const tr = $('#themeRadios');
  if (tr) {
    syncThemeRadios();
    tr.addEventListener('click', (e) => {
      const b = e.target.closest('[data-theme-choice]'); if (!b) return;
      const next = b.dataset.themeChoice;
      try { localStorage.setItem('rc-theme', next); } catch (err) {}
      const applied = next === 'auto' ? (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark') : next;
      document.documentElement.dataset.theme = applied;
      syncThemeRadios();
      setThemeIcon(next); /* refresh the sidebar glyph — same state the sidebar button uses */
    });
  }
  /* sidebar collapse lives in the shell IIFE above (reuses the persisted rail state) */
  /* greeting + first paint of the Home panels/chart (loaders.home refills on visit) */
  greet();
  setInterval(greet, 10 * 60 * 1000);
  const bootOv = api('/api/overview').then((ov) => { window.sdPaintHomePanels(ov); }).catch(() => { });
  bootOv.then(() => window.sdPaintHomeChart()).catch(() => { });
})();


/* SSE — live updates with auto-reconnect + backoff (R24) */
(function sse() {
  let es = null, backoff = 0, lastOpen = false;
  const quietViews = { newpost: 1, email: 1 }; // never yank a form out from under the user
  function connect() {
    if (es || !window.EventSource) return;
    es = new EventSource('/events');
    es.onmessage = (ev) => {
      let d = {}; try { d = JSON.parse(ev.data); } catch (e) {}
      if (d.type === 'status') {
        pollStatus().catch(() => {});
        /* N1b: on (re)connect, re-sync channel lists */
        if (d.status === 'open' && !lastOpen) resyncChannels(true);
        lastOpen = d.status === 'open';
        return;
      }
      if (d.type !== 'activity') return;
      const vEl = $('.view:not([hidden])');
      const v = vEl ? vEl.dataset.view : null;
      if (!v || quietViews[v] || !loaders[v]) return;
      const a = document.activeElement;
      if (a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.isContentEditable)) return;
      loaders[v]().catch(() => {});
    };
    es.onerror = () => { try { es.close(); } catch (e) {} es = null; backoff = Math.min(backoff + 1, 8); setTimeout(connect, 1500 * 2 ** backoff); };
    es.onopen = () => { backoff = 0; };
  }
  connect();
})();

/* ── 6 · N1 — LIVE CHANNEL SYNC ─────────────────────────────────── */
const chanSync = { sources: null, targets: null };
function stampSync(kind) {
  const el = $(kind === 'sources' ? '#srcSyncTime' : '#tgtSyncTime');
  if (el) el.textContent = 'Last synced ' + new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}
async function refreshChannels(kind, opts = {}) {
  const tbody = $(kind === 'sources' ? '#srcTable tbody' : '#tgtTable tbody');
  try {
    const d = await api('/api/' + kind);
    chanSync[kind] = Date.now();
    stampSync(kind);
    if (!tbody || $(`.view[data-view="${kind}"]`).hidden) return d;
    tbody.innerHTML = channelRows(d.list || [], kind);
    $(kind === 'sources' ? '#srcCount' : '#tgtCount').textContent = (d.list || []).length;
    if (kind === 'sources') refreshPicker('sources');
    if (kind === 'targets') { refreshPicker('targets'); fillSchedTargets(d.list || []); }
    return d;
  } catch (e) {
    if (opts.announce) toast('Could not re-sync channels: ' + e.message, 'err');
    return null;
  }
}
function resyncChannels(announce) { refreshChannels('sources', { announce }); refreshChannels('targets', { announce }); }
setInterval(() => resyncChannels(false), 10 * 60 * 1000); // N1b: every 10 minutes
/* v7.7.3: Refresh asks WhatsApp itself — live follow-state check (names, roles,
   unfollow removal) — then re-renders the list. */
$('#srcRefresh').addEventListener('click', async () => {
  const b = $('#srcRefresh'); if (b) b.disabled = true;
  toast('Checking your followed channels with WhatsApp…');
  try {
    const r = await api('/api/directory/rescan', { method: 'POST', body: {} });
    const parts = [`checked ${r.checked || 0} channel(s)`];
    if (r.removed && r.removed.length) parts.push(`removed ${r.removed.length} you no longer follow`);
    toast('Channel check done — ' + parts.join(' · '), r.removed && r.removed.length ? 'warn' : 'ok');
  } catch (e) { toast('Channel check failed: ' + e.message, 'err'); }
  try { if (b) b.disabled = false; } catch { }
  await refreshChannels('sources', { announce: true });
});
$('#tgtRefresh').addEventListener('click', () => { toast('Re-syncing targets…'); refreshChannels('targets', { announce: true }); });

/* ── 6b · v7.8.0 · BROWSE CHANNELS ───────────────────────────────
   Real WhatsApp browse experience in the dashboard: categories + country
   filters, endless "load more", Follow (real newsletterFollow), Add to
   Sources, Unfollow. Discovery is a curated catalog — WhatsApp's own
   recommendation engine is not exposed in this Baileys build (verified). */
const brw = { category: '', country: '', q: '', page: 1, total: 0, end: false, loading: false, booted: false, cats: [], countries: [] };
function brwStamp() {
  const el = $('#brwSyncTime');
  if (el) el.textContent = 'Last synced ' + new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}
function brwRow(c) {
  const av = esc((c.name || '?').trim().charAt(0).toUpperCase());
  const badges = ` <span class="b">${esc(c.category)}</span>${c.following ? ' <span class="b b-ok">following</span>' : ''}`;
  let actions;
  if (c.following && c.inSources) {
    actions = '<span class="b b-ok" title="This channel is mirrored as a source — its posts are published to your targets">in Sources ✓</span><button class="btn btn-sm btn-d" data-brw="unfollow" title="Stop following this channel">Unfollow</button>';
  } else if (c.following) {
    actions = '<button class="btn btn-sm btn-p" data-brw="addsource" title="Mirror this channel’s posts to your targets (it stays a source until you remove it)"><span class="plus-g">＋</span> Add to Sources</button><button class="btn btn-sm btn-d" data-brw="unfollow" title="Stop following this channel">Unfollow</button>';
  } else {
    actions = '<button class="btn btn-sm btn-p" data-brw="follow" title="Follow this channel with your WhatsApp number">Follow</button>';
  }
  return `<div class="brw-row" data-code="${esc(c.id)}" data-name="${esc(c.name)}">
    <div class="brw-av">${av}</div>
    <div class="brw-info">
      <div class="ch-row-name">${esc(c.name)}${badges}</div>
      <div class="ch-sub">${c.blurb ? esc(c.blurb) + ' · ' : ''}<b>${esc(c.country)}</b></div>
    </div>
    <div class="ra">${actions}</div>
  </div>`;
}
const brwCache = new Map(); // code → entry (for in-place row rebuilds)
function brwApplyRowState(code, { following, inSources }) {
  const entry = brwCache.get(code);
  const row = document.querySelector(`.brw-row[data-code="${code}"]`);
  if (entry && row) {
    entry.following = !!following;
    entry.inSources = !!inSources;
    row.outerHTML = brwRow(entry);
  }
}
async function brwLoad(reset) {
  if (brw.loading) return;
  brw.loading = true;
  if (reset) { brw.page = 1; brw.end = false; }
  try {
    const params = new URLSearchParams({ page: String(brw.page), size: '12' });
    if (brw.category) params.set('category', brw.category);
    if (brw.country) params.set('country', brw.country);
    if (brw.q) params.set('q', brw.q);
    const d = await api('/api/browse/channels?' + params.toString());
    const list = d.list || [];
    list.forEach((c) => brwCache.set(c.id, c));
    const box = $('#brwList');
    if (box) {
      if (brw.page === 1) box.innerHTML = list.length ? list.map(brwRow).join('') : '<p class="muted tiny" style="padding:8px 0">Nothing matches this filter — try another category, country or search term.</p>';
      else box.insertAdjacentHTML('beforeend', list.map(brwRow).join(''));
    }
    brw.total = d.total || 0;
    brw.end = !d.hasMore;
    if (list.length) brw.page += 1;
    const cnt = $('#brwCount'); if (cnt) cnt.textContent = brw.total;
    const fc = $('#brwFollowed'); if (fc) fc.textContent = `You follow ${d.followingCount || 0} channel(s) in total`;
    const ft = $('#brwFootCount'); if (ft && d.catalogTotal) ft.textContent = d.catalogTotal;
    const more = $('#brwMore'); if (more) more.hidden = brw.end;
    const endc = $('#brwEnd'); if (endc) endc.hidden = !brw.end || brw.total === 0;
    brwStamp();
    return d;
  } finally { brw.loading = false; }
}
loaders.browse = async () => {
  if (!brw.booted) {
    brw.booted = true;
    try {
      const d = await api('/api/browse/channels?page=1&size=1');
      brw.cats = d.categories || []; brw.countries = d.countries || [];
      const cats = $('#brwCats');
      if (cats) cats.innerHTML = ['All', ...brw.cats].map((c) => `<button class="chip${c === 'All' ? ' on' : ''}" data-cat="${esc(c)}">${esc(c)}</button>`).join('');
      const sel = $('#brwCountry');
      if (sel) sel.innerHTML = ['All countries', ...brw.countries].map((c) => `<option value="${c === 'All countries' ? '' : esc(c)}">${c === 'All countries' ? 'All countries' : esc(c)}</option>`).join('');
      cats && cats.addEventListener('click', (ev) => {
        const chip = ev.target.closest('button[data-cat]');
        if (!chip) return;
        $$('#brwCats .chip').forEach((x) => x.classList.toggle('on', x === chip));
        brw.category = chip.dataset.cat === 'All' ? '' : chip.dataset.cat;
        brwLoad(true);
      });
      sel && sel.addEventListener('change', () => { brw.country = sel.value; brwLoad(true); });
      let t = null;
      const si = $('#brwSearch');
      si && si.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => { brw.q = String(si.value || '').trim(); brwLoad(true); }, 300); });
      /* endless scroll — the content pane is the scroller */
      const content = $('#content');
      content && content.addEventListener('scroll', () => {
        if (!content || content.classList.contains('side-open')) return;
        const inBrowse = !document.querySelector('.view[data-view="browse"]').hidden;
        if (!inBrowse || brw.loading || brw.end) return;
        if (content.scrollHeight - content.scrollTop - content.clientHeight < 420) brwLoad(false);
      });
      $('#brwRefresh') && $('#brwRefresh').addEventListener('click', () => brwLoad(true));
      /* follow / unfollow / add-to-sources — in-place (N1) */
      $('#brwList').addEventListener('click', async (ev) => {
        const btn = ev.target.closest('button[data-brw]');
        if (!btn) return;
        const row = btn.closest('.brw-row');
        const code = row && row.dataset.code;
        const act = btn.dataset.brw;
        btn.disabled = true;
        try {
          if (act === 'follow') {
            const r = await api('/api/browse/follow', { method: 'POST', body: { link: code } });
            brwApplyRowState(code, { following: true, inSources: !!r.inSources });
            toast(`Following “${r.name}”${r.addedToSources ? ' — added to Sources' : ''}`, 'ok');
            if (r.inSources) loaders.sources().catch(() => { });
          } else if (act === 'addsource') {
            const r = await api('/api/browse/add-source', { method: 'POST', body: { code } });
            brwApplyRowState(code, { following: true, inSources: true });
            toast(`“${r.name}” is now a Source — its posts will be mirrored to your targets`, 'ok');
            loaders.sources().catch(() => { });
          } else if (act === 'unfollow') {
            const r = await api('/api/browse/unfollow', { method: 'POST', body: { code } });
            brwApplyRowState(code, { following: false, inSources: false });
            toast(`No longer following “${r.name}”${r.removedFromSources ? ' — removed from Sources' : ''}`, 'warn');
            loaders.sources().catch(() => { });
          }
        } catch (e) {
          toast(e.message, 'err');
          try { btn.disabled = false; } catch { }
        }
      });
      /* paste-a-link follow */
      $('#brwLinkFollow') && $('#brwLinkFollow').addEventListener('click', async () => {
        const inp = $('#brwLink');
        const link = String((inp && inp.value) || '').trim();
        if (!link) return toast('Paste a channel link first', 'warn');
        const b = $('#brwLinkFollow'); b.disabled = true;
        try {
          const r = await api('/api/browse/follow', { method: 'POST', body: { link } });
          toast(`Following “${r.name}”${r.addedToSources ? ' — added to Sources' : ''}`, 'ok');
          if (inp) inp.value = '';
          if (r.code && brwCache.has(r.code)) brwApplyRowState(r.code, { following: true, inSources: !!r.inSources });
          else brwLoad(true); // channel not in the curated list — refresh states
          if (r.inSources) loaders.sources().catch(() => { });
        } catch (e) { toast(e.message, 'err'); }
        finally { try { b.disabled = false; } catch { } }
      });
    } catch (e) { toast('Browse could not start: ' + e.message, 'err'); }
  }
  await brwLoad(true);
};

/* ── 7 · MODALS (R22 — confirmations name the item; focus trap) ── */
let _modalScrim = null, _lastFocus = null;
function openModal(opts) {
  closeModal();
  _lastFocus = document.activeElement;
  _modalScrim = document.createElement('div');
  _modalScrim.className = 'mscrim';
  const head = `<div class="mb-h"><span class="m-ic"></span>${esc(opts.title)}</div>`;
  _modalScrim.innerHTML = `<div class="mb${opts.danger ? ' mb-danger' : ''}" role="dialog" aria-modal="true" aria-label="${esc(opts.title)}">
    ${head}
    <div class="mb-b">${opts.html || ''}</div>
    ${opts.actions === false ? '' : `<div class="mb-f"><button class="btn" data-mclose>Close</button>${opts.primary ? `<button class="btn ${opts.danger ? 'btn-d' : 'btn-p'}" data-mprimary>${esc(opts.primaryLabel || 'Confirm')}</button>` : ''}</div>`}
  </div>`;
  if (opts.icon) _modalScrim.querySelector('.m-ic').innerHTML = opts.icon;
  _modalScrim._onClose = typeof opts.onClose === 'function' ? opts.onClose : null;
  if (opts.icon) Promise.resolve(opts.icon).then((s) => { const ic = _modalScrim && _modalScrim.querySelector('.m-ic'); if (s && ic && _modalScrim.isConnected) ic.innerHTML = s; });
  $('#mRoot').appendChild(_modalScrim);
  _modalScrim.addEventListener('click', (ev) => { if (ev.target === _modalScrim) closeModal(); });
  /* actions:false modals have no footer — the close button may not exist */
  const _mclose = _modalScrim.querySelector('[data-mclose]');
  if (_mclose) _mclose.addEventListener('click', closeModal);
  if (opts.primary) {
    const p = _modalScrim.querySelector('[data-mprimary]');
    p.addEventListener('click', () => { const ok = opts.primary(); if (ok !== false) closeModal(); });
  }
  const focusables = () => $$('button, [href], input, select, textarea', _modalScrim).filter((el) => !el.disabled && el.offsetParent !== null);
  setTimeout(() => { const f = focusables(); if (f.length) (opts.primary ? _modalScrim.querySelector('[data-mprimary]') : f[0]).focus(); }, 30);
  const onDocKey = (ev) => { if (ev.key === 'Escape') closeModal(); };
  document.addEventListener('keydown', onDocKey);
  _modalScrim._docKey = onDocKey;
  _modalScrim.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape') { ev.stopPropagation(); closeModal(); return; }
    if (ev.key !== 'Tab') return;
    const f = focusables();
    if (!f.length) return;
    const first = f[0], last = f[f.length - 1];
    if (ev.shiftKey && document.activeElement === first) { ev.preventDefault(); last.focus(); }
    else if (!ev.shiftKey && document.activeElement === last) { ev.preventDefault(); first.focus(); }
  });
  return _modalScrim;
}
function closeModal() {
  const cb = _modalScrim && _modalScrim._onClose;
  const dk = _modalScrim && _modalScrim._docKey;
  if (dk) document.removeEventListener('keydown', dk);
  if (_modalScrim && _modalScrim.isConnected) _modalScrim.remove();
  _modalScrim = null;
  if (_lastFocus && _lastFocus.isConnected) { try { _lastFocus.focus(); } catch (e) {} }
  if (cb) { try { cb(); } catch (e) {} }
}
/* promise-based confirmation naming the exact item */
function confirmModal(title, body, label, danger) {
  let done = false;
  return new Promise((resolve) => {
    const finish = (v) => { if (!done) { done = true; resolve(v); } };
    openModal({
      title, html: body, icon: ico(danger ? 'alert' : 'info'),
      danger: !!danger, primaryLabel: label || 'Confirm',
      primary: () => { finish(true); },
      onClose: () => finish(false)
    });
  });
}

/* ── 8 · CHANNEL PICKER (N2 — one component, everywhere) ────────── */
const pickers = {};
function jidVisible() { try { return localStorage.getItem('rc-jid') === '1'; } catch (e) { return false; } }
/* global "show channel IDs" preference — wired once (works from any view) */
(function wireJidPref() {
  const sw = $('#showJidSw');
  if (!sw) return;
  sw.checked = jidVisible();
  sw.addEventListener('change', () => {
    try { localStorage.setItem('rc-jid', sw.checked ? '1' : '0'); } catch (e) {}
    $$('.cp').forEach((c) => c.classList.toggle('show-jid', sw.checked));
    toast('Channel IDs ' + (sw.checked ? 'visible in pickers' : 'hidden from pickers'));
  });
})();
function mountPicker(mount, opts) {
  /* opts: { kind: 'sources'|'targets', mode: 'multi'|'single', placeholder, onPick(list) } */
  const el = document.createElement('div');
  el.className = 'cp' + (jidVisible() ? ' show-jid' : '');
  const isTgt = opts.kind === 'targets';
  el.innerHTML = `
    <button type="button" class="cp-btn" data-cpbtn aria-haspopup="listbox">
      <span class="cp-ph">${esc(opts.placeholder || 'Pick channels…')}</span>
      <span class="chips cp-chips"></span>
      <span class="chev">${_chev()}</span>
    </button>
    <div class="cp-panel" hidden>
      <div class="cp-search"><input class="in" placeholder="Search your channels…" autocomplete="off" aria-label="Search channels"></div>
      <div class="cp-list" role="listbox"></div>
      <div class="cp-foot"><span class="muted tiny" data-cpnote></span><span class="cnt" data-cpcnt></span>${opts.mode === 'multi' ? '<button class="btn btn-p btn-sm" data-cpadd>Add selected</button>' : ''}</div>
    </div>`;
  mount.appendChild(el);
  const btn = el.querySelector('[data-cpbtn]'), panel = el.querySelector('.cp-panel'),
        list = el.querySelector('.cp-list'), search = el.querySelector('.cp-search .in'),
        chips = el.querySelector('.cp-chips'), cnt = el.querySelector('[data-cpcnt]'),
        note = el.querySelector('[data-cpnote]');
  note.textContent = isTgt ? 'only owner / admin channels are listed' : 'channels followed by this number';
  let rows = [], kbIdx = -1;

  function _chev() { return '<svg class="icon icon-xs" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>'; }

  function render(q) {
    const nq = (q || '').toLowerCase();
    const hits = rows.filter((c) => !nq || String(c.name || '').toLowerCase().includes(nq) || c.jid.includes(nq));
    kbIdx = -1;
    list.innerHTML = hits.length ? hits.map((c, i) => `
      <div class="cp-row" data-jid="${esc(c.jid)}" data-i="${i}" role="option">
        <input type="${opts.mode === 'multi' ? 'checkbox' : 'radio'}" name="cp-${opts.kind}" value="${esc(c.jid)}" ${c.disabled ? 'checked disabled' : ''} aria-label="${esc(chanName(c))}">
        <span class="cp-name">${esc(chanName(c))}</span>
        ${c.role === 'OWNER' ? '<span class="b b-ok">owner</span>' : c.role === 'ADMIN' ? '<span class="b b-info">admin</span>' : ''}
        <span class="cp-sub">${fmtNum(c.subs)}</span>
        <span class="cp-jid">${shortJid(c.jid)}</span>
      </div>`).join('')
      : `<div class="cp-empty">${isTgt ? 'No postable channels found — follow channels on WhatsApp where you are admin, or paste an invite link.' : 'No channels in your synced list yet — connect the number, follow some channels on WhatsApp, and they appear here.'}</div>`;
      cnt.textContent = opts.mode === 'multi' ? selAll().length + ' selected' : '';
      $$('.cp-row', list).forEach((r) => r.addEventListener('click', () => {
        const cb = r.querySelector('input');
        if (cb.disabled) return;
        if (opts.mode === 'multi') { cb.checked = !cb.checked; }
        else {
          $$('input', list).forEach((x) => { x.checked = false; });
          cb.checked = true;
        }
        cnt.textContent = opts.mode === 'multi' ? selAll().length + ' selected' : (cb.checked ? '1 selected' : '');
        if (opts.mode === 'multi') paintChips();
      }));
  }
  function selected(includeDisabled = false) {
    return $$('input', list).filter((i) => i.checked && (includeDisabled || !i.disabled)).map((i) => i.value);
  }
  const selAll = () => selected(opts.showChecked === 'all');
  async function load() {
    try {
      let rows2;
      if (opts.listFrom === 'targets') {
        /* composer: the list IS the set of postable targets — all selectable */
        const t = await api('/api/targets');
        rows2 = (t.list || []).slice().sort((a, b) => String(a.name).localeCompare(String(b.name)))
          .map((c) => ({ ...c, disabled: false }));
      } else {
        const [dir, cur] = await Promise.all([api('/api/directory'), api('/api/' + opts.kind)]);
        window.__dirNames = Object.assign(window.__dirNames || {}, Object.fromEntries((dir.list || []).map((c) => [c.jid, c.name])));
        let list2 = (dir.list || []).slice();
        if (isTgt) list2 = list2.filter((c) => c.role === 'OWNER' || c.role === 'ADMIN');
        list2.sort((a, b) => String(a.name).localeCompare(String(b.name)));
        const have = new Set((cur.list || []).map((c) => c.jid));
        rows2 = list2.map((c) => ({ ...c, disabled: have.has(c.jid) }));
      }
      rows = rows2;
      render(search.value);
      if (opts.mode === 'multi') {
        if (opts.preselect === 'all') $$('input', list).forEach((i) => { if (!i.disabled) i.checked = true; });
        cnt.textContent = opts.mode === 'multi' ? selAll().length + ' selected' : '';
        paintChips();
      }
    } catch (e) {
      list.innerHTML = `<div class="cp-empty">Could not load the channel list.</div>`;
    }
  }
  function paintChips() {
    const names = Object.fromEntries(rows.map((c) => [c.jid, chanName(c)]));
    const ids = selAll();
    chips.innerHTML = ids.map((j) => `<span class="chip">${esc(names[j] || shortJid(j))}<button class="chip-x" data-x="${esc(j)}" aria-label="Remove ${esc(names[j] || '')}">${_x()}</button></span>`).join('');
    $$('.chip-x', chips).forEach((b) => b.addEventListener('click', () => {
      const row = $(`.cp-row[data-jid="${CSS.escape(b.dataset.x)}"] input`, list);
      if (row) row.checked = false;
      cnt.textContent = selAll().length + ' selected';
      paintChips();
    }));
  }
  function _x() { return '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>'; }

  btn.addEventListener('click', (ev) => {
    ev.stopPropagation();
    const open = panel.hidden;
    panel.hidden = !open;
    el.classList.toggle('open', open);
    if (open) { load(); setTimeout(() => search.focus(), 30); }
  });
  document.addEventListener('click', (ev) => { if (!panel.hidden && !el.contains(ev.target)) { panel.hidden = true; el.classList.remove('open'); } });
  search.addEventListener('input', () => render(search.value));
  search.addEventListener('keydown', (ev) => {
    const r = $$('.cp-row', list);
    if (!r.length) return;
    if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
      ev.preventDefault();
      kbIdx = (kbIdx + (ev.key === 'ArrowDown' ? 1 : r.length - 1)) % r.length;
      r.forEach((x, i) => x.classList.toggle('kb', i === kbIdx));
      r[kbIdx].scrollIntoView({ block: 'nearest' });
    } else if (ev.key === 'Enter' && kbIdx >= 0) {
      ev.preventDefault();
      r[kbIdx].click();
    }
  });
  const addBtn = el.querySelector('[data-cpadd]');
  if (addBtn) addBtn.addEventListener('click', () => {
    const jids = selected();
    if (!jids.length) return toast('Tick at least one channel first', 'err');
    addBtn.disabled = true;
    opts.onPick(jids).then((done) => {
      if (done === false) { addBtn.disabled = false; return; }
      panel.hidden = true; el.classList.remove('open');
      return load();
    }).catch(() => { addBtn.disabled = false; });
  });
  return {
    root: el,
    listEl: list,
    open: () => btn.click(),
    refresh: load,
    refreshPickerList: load,
    selected
  };
}
function refreshPicker(kind) { const p = pickers[kind]; if (p) p.refresh(); }
function fillSchedTargets(list) {
  const sel = $('#schedTarget');
  if (!sel) return;
  const cur = sel.value;
  sel.innerHTML = '<option value="">— target channel —</option>' + (list || []).map((t) => `<option value="${esc(t.jid)}">${esc(t.name || shortJid(t.jid))}</option>`).join('');
  if (cur) sel.value = cur;
}

/* ── 9 · ASYNC STATES (skeleton / empty / error) ────────────────── */
const skelRows = (nn, cols = 4) => Array.from({ length: nn }, () =>
  `<tr class="skel-row">${Array.from({ length: cols }, () => '<td><div class="skel"></div></td>').join('')}</tr>`).join('');
const skelLines = (nn) => Array.from({ length: nn }, () => '<div class="skel skel-line"></div>').join('');
async function emptyTCell(icon, title, sub, colspan = 6) {
  const s = await ico(icon).catch(() => '');
  return `<tr class="row-empty"><td colspan="${colspan}"><span class="es">${s}<b>${esc(title)}</b>${sub ? ` <span class="muted">— ${esc(sub)}</span>` : ''}</span></td></tr>`;
}
async function emptyRow(el, icon, title, sub, colspan = 6) { if (el) el.innerHTML = await emptyTCell(icon, title, sub, colspan); }
async function emptyBox(el, icon, title, sub) {
  if (!el) return;
  const s = await ico(icon).catch(() => '');
  el.innerHTML = `<div class="es">${s}<div class="es-t">${esc(title)}</div>${sub ? `<div class="es-s">${esc(sub)}</div>` : ''}</div>`;
}

/* ── 10 · HOME ──────────────────────────────────────────────────── */
/* v11: optional `spark` — array of real numeric samples (e.g. 24 hourly buckets);
   drawn as an inline SVG strip. Never fabricated: no data, no spark. */
function kpiSpark(vals) {
  const v = (vals || []).filter((x) => typeof x === 'number' && isFinite(x));
  if (v.length < 2) return '';
  const max = Math.max(...v), min = Math.min(...v);
  const W = 100, H = 26, PAD = 2, rng = (max - min) || 1;
  const pt = (i) => [(i / (v.length - 1)) * W, H - PAD - ((v[i] - min) / rng) * (H - 2 * PAD)];
  const line = v.map((_, i) => `${i ? 'L' : 'M'}${pt(i)[0].toFixed(1)} ${pt(i)[1].toFixed(1)}`).join(' ');
  const area = `M0 ${H} ` + v.map((_, i) => `L${pt(i)[0].toFixed(1)} ${pt(i)[1].toFixed(1)}`).join(' ') + ` L${W} ${H} Z`;
  return `<svg class="k-spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true"><path class="sp-area" d="${area}"/><path class="sp-line" d="${line}"/></svg>`;
}
function kpi(label, value, sub, tone, spark) {
  return `<div class="kpi" data-tone="${esc(tone || '')}"><span class="k-l">${esc(label)}</span><span class="k-v">${value}</span><span class="k-s">${esc(sub || '')}</span>${kpiSpark(spark)}</div>`;
}
/* v1.1: mutually exclusive, accurate states — a disconnected WhatsApp can never claim "running" */
function paintPauseBar(paused, waStatus) {
  const bar = $('#pauseBar');
  const unlinked = waStatus !== undefined && waStatus !== 'open';
  bar.classList.toggle('paused', Boolean(paused));
  bar.classList.toggle('wa-off', unlinked);
  const head = $('#pauseHead'), sub = $('#pauseSub'), btn = $('#pauseBtn');
  if (unlinked) {
    head.textContent = 'Mirroring paused — WhatsApp disconnected.';
    sub.textContent = 'Link WhatsApp to start mirroring — one scan, and it is never needed again.';
    btn.dataset.mode = 'link';
    btn.className = 'btn btn-p';
    ico('chat').then((svg) => { if (btn.isConnected) btn.innerHTML = svg + ' <span>Connect WhatsApp via QR</span>'; });
  } else if (paused) {
    head.textContent = 'Mirroring is PAUSED.';
    sub.textContent = 'No posts are published while paused. Nothing is lost — missed posts are recovered when you resume.';
    btn.dataset.mode = 'pause';
    btn.className = 'btn btn-p';
    ico('play').then((svg) => { if (btn.isConnected) btn.innerHTML = svg + ' <span>Resume mirroring</span>'; });
  } else {
    head.textContent = 'Mirroring is running.';
    sub.textContent = 'Every source → every target, automatically.';
    btn.dataset.mode = 'pause';
    btn.className = 'btn btn-d';
    ico('pause').then((svg) => { if (btn.isConnected) btn.innerHTML = svg + ' <span>Pause all mirroring</span>'; });
  }
}
$('#pauseBtn').addEventListener('click', async () => {
  const btn = $('#pauseBtn');
  if (btn.dataset.mode === 'link') {
    const q = $('#qrCard');
    if (q) { q.hidden = false; q.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
    api('/api/qr').then((r) => { if (r && r.qr) { const im = $('#qrImg'); if (im) im.src = r.qr; } }).catch(() => {});
    return;
  }
  const next = !$('#pauseBar').classList.contains('paused');
  if (next) {
    const ok = await confirmModal('Pause all mirroring?', 'Sources stay subscribed — nothing is published until you resume. Missed posts are recovered when you resume.', 'Pause', true);
    if (!ok) return;
  }
  try {
    const r = await api('/api/mirror/pause', { method: 'POST', body: { paused: next } });
    paintPauseBar(r.paused, window.__waStatus || 'open');
    toast(r.paused ? 'Mirroring paused' : 'Mirroring resumed — recovering missed posts', r.paused ? '' : 'ok');
  } catch (e) { toast(e.message, 'err'); }
});
function cloudTestWire(root) {
  const tbtn = root.querySelector('#cloudTest');
  if (!tbtn) return;
  tbtn.onclick = async () => {
    tbtn.disabled = true; tbtn.textContent = 'Testing…';
    try {
      const d = await api('/api/persist/test');
      const bad = d.tokenOk === false || d.repoOk === false || d.repoLooksValid === false;
      const head = `<div style="color:${bad ? 'var(--err)' : 'var(--ok)'}"><b>${esc(d.verdict)}</b></div>`;
      const list = (d.fixes || []).length ? `<ul>${d.fixes.map((f) => `<li>${esc(f)}</li>`).join('')}</ul>` : '';
      const info = d.repoUsed && d.repoUsed !== d.repo ? `<div class="muted tiny" style="margin-top:4px">Using cleaned repo name: <b>${esc(d.repoUsed)}</b> (was "${esc(d.repo)}")</div>` : '';
      root.querySelector('#cloudVerdict').innerHTML = head + info + list;
    } catch (e) { root.querySelector('#cloudVerdict').textContent = e.message; }
    tbtn.disabled = false; tbtn.textContent = 'Test cloud memory';
  };
}
function cloudBanner(cs) {
  const box = $('#cloudNote');
  if (!box) return;
  if (!cs) { box.innerHTML = ''; return; }
  if (!cs.enabled) {
    box.innerHTML = `<div class="card cloud-note bad">
      <b>Cloud memory is OFF — that is why every deploy asks for a QR scan again.</b>
      <p class="muted tiny" style="margin:6px 0 0">Cloud memory saves this bot's WhatsApp login to your GitHub repo and reloads it before connecting.
      Turn it on once: Heroku → Settings → Config Vars → add <code>PERSIST_GITHUB_REPO</code> (your-user/your-repo),
      <code>PERSIST_GITHUB_TOKEN</code> (GitHub token with repo access) and optionally <code>PERSIST_GITHUB_BRANCH</code>=bot-state.
      After one more deploy: scan a QR once, and from then on no deploy will ever ask again.</p>
      <div style="margin-top:8px"><button class="btn btn-sm" id="cloudTest">Test cloud memory</button></div>
      <div id="cloudVerdict" class="tiny" style="margin-top:6px"></div></div>`;
    cloudTestWire(box);
    return;
  }
  /* v1.1: clean badge in the banner — repo/branch/interval detail moves to the tooltip */
  const whenTxt = cs.lastSyncAt ? when(cs.lastSyncAt) : 'not synced yet';
  const tip = (cs.repoUsed || cs.repo) + ' · branch ' + cs.branch + ' · saves every ' + cs.intervalMin + ' min + right after pairing + on every deploy' +
    (cs.lastKB ? ' · last snapshot ' + cs.lastKB + ' KB' : '') +
    (cs.credsPresent ? ' · saved login detected' : ' · no saved login yet — scan one QR and it is stored automatically') +
    (cs.lastError ? ' · last sync error: ' + cs.lastError : '');
  const synced = cs.lastSyncAt ? 'Synced' : 'Armed';
  ico('cloud').then((svg) => {
    box.innerHTML = `<span class="cloud-badge-row"><span class="cloud-badge${cs.lastError ? ' cb-err' : ''}" title="${esc(tip)}">${svg}<b>Cloud Memory ${synced}</b><span class="cb-time">· Last saved ${esc(whenTxt)}</span>${cs.lastError ? '<i class="cb-err-dot"></i>' : ''}</span><button class="btn btn-sm btn-g" id="cloudTest">Test</button><span id="cloudVerdict" class="tiny"></span></span>`;
    cloudTestWire(box);
  });
}
loaders.home = async () => {
  api('/api/persist/status').then(cloudBanner).catch(() => {});
  const [ov, logs, pw, hourly] = await Promise.all([api('/api/overview'), api('/api/logs?limit=10'), api('/api/power').catch(() => null), api('/api/overview/hourly').catch(() => null)]);
  /* v11: KPI sparklines use the REAL hourly outcome buckets (no fabricated history) */
  const hB = (hourly && hourly.buckets) || [];
  const hPub = hB.map((b) => b.published || 0);
  const hFail = hB.map((b) => b.failed || 0);
  const wa = ov.wa || {};
  paintPauseBar(Boolean(ov.mirrorPaused), wa.status);
  const nextJob = ((pw && pw.scheduler) || []).filter((j) => j.enabled).sort((a, b) => String(a.at).localeCompare(String(b.at)))[0];
  /* 5J (J5): KPIs are draggable — the order is saved (ui.kpi.order) */
  const kpiDefs = [
    ['wa', kpi('WhatsApp', STATUS_TEXT[wa.status] || esc(wa.status), wa.phone ? '+' + esc(wa.phone) : fixDetail(wa.detail || ''), wa.status === 'open' ? 'ok' : wa.status === 'qr' ? 'err' : '')],
    ['published', kpi('Published today', ov.today.published, (ov.today.skipped || 0) + ' skipped', 'accent', hPub)],
    ['failed', kpi('Failed today', ov.today.failed, ov.today.failed ? 'needs attention' : 'all clean', ov.today.failed ? 'err' : 'ok', hFail)],
    ['sources', kpi('Sources', ov.sources, ov.targets + ' target(s)')],
    ['nextjob', kpi('Next scheduled post', nextJob ? when(nextJob.at) : '—', nextJob ? (nextJob.name || 'untitled') : 'none queued')],
    /* 5A (R46): mirror latency — how long a post takes from source publish to our publish */
    ['latency', kpi('Mirror latency', (ov.latency && ov.latency.n) ? (ov.latency.median + ' s') : '—', (ov.latency && ov.latency.n) ? `p95 ${ov.latency.p95} s · ${ov.latency.n} posts (7 d)` : 'measured per published post', (ov.latency && ov.latency.n) ? 'ok' : '')]
  ];
  const savedOrder = String(__kpiOrder || '').split(',').filter(Boolean);
  const orderIdx = (id) => { const i = savedOrder.indexOf(id); return i >= 0 ? i : 99; };
  $('#kpiGrid').innerHTML = kpiDefs.slice().sort((a, b) => orderIdx(a[0]) - orderIdx(b[0])).map(([id, html]) => html.replace('<div class="kpi"', `<div class="kpi kpi-drag" draggable="true" data-kpi="${id}" title="Drag to reorder — the order is saved"`)).join('');
  wireKpiDrag();
  /* v1.1: actionable empty states — a CTA inside the card instead of a dead-end zero (reuses the existing flows) */
  try {
    if (wa.status !== 'open') {
      const kEl = $('#kpiGrid .kpi[data-kpi="wa"]');
      if (kEl) {
        const b = document.createElement('button');
        b.type = 'button'; b.className = 'btn btn-p btn-sm kpi-cta';
        if (wa.status === 'connecting') { b.textContent = 'Connecting…'; b.disabled = true; }
        else {
          b.textContent = 'Connect WhatsApp via QR';
          b.addEventListener('click', () => {
            const q = $('#qrCard');
            if (q) { q.hidden = false; q.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
            api('/api/qr').then((r) => { if (r && r.qr) { const im = $('#qrImg'); if (im) im.src = r.qr; } }).catch(() => {});
          });
        }
        kEl.appendChild(b);
      }
    }
    if (!(ov.sources > 0)) {
      const kEl = $('#kpiGrid .kpi[data-kpi="sources"]');
      if (kEl) {
        const b = document.createElement('button');
        b.type = 'button'; b.className = 'btn btn-p btn-sm kpi-cta'; b.textContent = 'Add first source';
        b.addEventListener('click', () => show('sources'));
        kEl.appendChild(b);
      }
    }
  } catch (e) { /* CTAs are progressive enhancement */ }
  /* 5E (R74/R73): adaptive-pacing + panic status strip on the dashboard */
  paintPaceStrip(ov);
  /* 5J (J2): setup wizard — progress is SAVED (ui.setup.done); auto-hides once
     complete (or marked complete) and re-opens from this card's button */
  const sc = $('#setupCard');
  if (sc) {
    const steps = [
      { done: wa.status === 'open', label: 'Link WhatsApp (scan the QR)', view: 'home' },
      { done: (ov.sources || 0) > 0, label: 'Add a source channel', view: 'sources' },
      { done: (ov.targets || 0) > 0, label: 'Add a target channel', view: 'targets' },
      { done: Boolean(pw && pw.switches && (pw.switches.beautify || pw.switches.headers)), label: 'Enable AI rewrite or Auto headers', view: 'branding' },
      { done: Boolean(nextJob), label: 'Schedule a post', view: 'scheduled' }
    ];
    const allDone = steps.every((x) => x.done);
    const done = allDone || Boolean(__setupDone);
    sc.hidden = done;
    if (!done) {
      const cur = steps.findIndex((x) => !x.done);
      $('#setupStepLbl').textContent = `— step ${Math.min(cur + 1, steps.length)} of ${steps.length} · progress is saved automatically`;
      $('#setupFinish').hidden = !allDone;
      $('#setupReopen').hidden = true;
      const [iCheck, iClock] = await Promise.all([ico('check'), ico('clock')]);
      $('#setupList').innerHTML = steps.map((x, i) =>
        `<div class="setup-i ${x.done ? 'done' : ''} ${i === cur ? 'cur' : ''}"><span class="box">${x.done ? iCheck : (i + 1)}</span><span class="lbl">${esc(x.label)}</span>${x.done ? '' : `<button class="btn btn-sm" data-go="${x.view}">Open</button>`}</div>`).join('');
      $$('#setupList [data-go]').forEach((b) => b.addEventListener('click', () => show(b.dataset.go)));
    } else {
      $('#setupList').innerHTML = '';
      $('#setupFinish').hidden = true;
      $('#setupReopen').hidden = false;
    }
  }
  /* activity timeline */
  const [iInfo, iWarn, iErr] = await Promise.all([ico('info'), ico('alert'), ico('x')]);
  const icoMap = { info: iInfo, warn: iWarn, error: iErr };
  $('#activityFeed').innerHTML = (logs.list || []).map((l) =>
    `<div class="tl-i"><span class="tl-ic" data-lv="${esc(l.level)}">${icoMap[l.level] || ''}</span><span class="tl-b"><b>${esc(l.code)}</b> — ${esc(l.msg)}</span><span class="tl-t">${when(l.ts)}</span></div>`).join('')
    || `<div class="tl-i"><span class="tl-b muted">No activity yet.</span></div>`;
  /* Signal Desk reference panels — queue / health / pacing + 24 h activity chart */
  if (window.sdPaintHomePanels) { window.sdPaintHomePanels(ov).catch(() => { }); window.sdPaintHomeChart().catch(() => { }); }
};

/* ── 11 · CHANNELS (sources / targets) ──────────────────────────── */
function channelRows(list, kind) {
  return list.sort((a, b) => String(a.name).localeCompare(String(b.name))).map((c) => {
    const roleBadge = kind === 'targets'
      ? (c.role === 'OWNER' ? ' <span class="b b-ok">owner</span>'
        : c.role === 'ADMIN' ? ' <span class="b b-info">admin</span>'
          : c.role ? ' <span class="b b-err" data-tip="This account cannot post there — WhatsApp refuses posts from followers">follower</span>' : '')
      : (c.role === 'OWNER' ? ' <span class="b b-ok">owner</span>' : c.role === 'ADMIN' ? ' <span class="b b-info">admin</span>' : '');
    const rssBadge = kind === 'sources' && c.kind === 'rss' ? ' <span class="b b-info">RSS</span>' : '';
    const rssSub = kind === 'sources' && c.kind === 'rss' ? `<div class="ch-sub mono" style="max-width:320px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(c.url || '')}">${esc(c.url || '')}</div>` : '';
    return `
    <tr data-jid="${esc(c.jid)}">
      <td><span class="ch-row-name">${esc(chanName(c))}${rssBadge}${roleBadge}</span>${rssSub}${kind === 'sources' && String(c.targets || '').trim() ? `<div class="ch-sub">→ ${String(c.targets).split(',').filter(Boolean).length} mapped target(s)</div>` : ''}</td>
      <td class="ch-jid">${shortJid(c.jid)}</td>
      <td>${c.paused ? '<span class="b b-warn">paused</span>' : '<span class="b b-ok">active</span>'}${kind === 'sources' ? `<div class="ch-sub">last post: ${agoLabel(c.last_post_at)}</div>` : ''}</td>
      ${kind === 'sources' ? `<td class="subs-cell" data-subcell="${esc(c.jid)}">${c.kind === 'rss' ? '<span class="mut tiny">n/a (feed)</span>' : '<span class="mut tiny">—</span>'}</td>` : ''}
      <td class="muted tiny num">${when(c.added_at)}</td>
      <td><div class="ra">
        ${kind === 'sources' ? '<button class="btn btn-sm" data-act="rules" title="Rule card: approve first, active hours, daily cap, keywords, priority">Rules</button><button class="btn btn-sm" data-act="map">Map</button>' : ''}
        <button class="btn btn-sm" data-act="pause">${c.paused ? 'Resume' : 'Pause'}</button>
        <button class="btn btn-sm btn-d" data-act="del">Remove</button>
      </div></td>
    </tr>`;
  }).join('') || '<tr><td colspan="5" class="muted">Nothing yet — add one above.</td></tr>';
}
function wireChannelTable(tableSel, kind) {
  $(tableSel).addEventListener('click', async (ev) => {
    const btn = ev.target.closest('button[data-act]');
    if (!btn) return;
    const tr = btn.closest('tr');
    const jid = tr.dataset.jid;
    try {
      if (btn.dataset.act === 'rules') { openRulesModal(jid); return; }
      if (btn.dataset.act === 'map') { openMapModal(jid); return; }
      if (btn.dataset.act === 'pause') {
        const paused = btn.textContent.trim() === 'Pause';
        btn.disabled = true;
        await api('/api/' + kind + '/' + encodeURIComponent(jid), { method: 'PATCH', body: { paused } });
        /* N1a: optimistic in-place update, then re-sync */
        const cell = tr.children[2];
        if (cell) cell.innerHTML = paused ? '<span class="b b-warn">paused</span>' : '<span class="b b-ok">active</span>';
        btn.textContent = paused ? 'Resume' : 'Pause';
        btn.disabled = false;
        toast(paused ? 'Paused — no posts mirrored while paused' : 'Resumed');
        refreshChannels(kind);
      } else {
        const ok = await confirmModal('Remove channel?', `<b>${esc(chanName({ name: tr.children[0].textContent, jid }))}</b> will be removed from ${kind}. Posts already published stay where they are.`, 'Remove', true);
        if (!ok) return;
        await api('/api/' + kind + '/' + encodeURIComponent(jid), { method: 'DELETE' });
        tr.remove(); // N1a: in-place removal
        toast('Removed', 'ok', { label: 'Undo', fn: () => toast('Re-add it from the picker to undo', '') });
        refreshChannels(kind);
      }
    } catch (e) { toast(e.message, 'err'); btn.disabled = false; }
  });
}
/* per-source target mapping modal (uses the N2 picker pattern inline) */
async function openMapModal(jid) {
  const [srcRes, tgtRes] = await Promise.all([api('/api/sources'), api('/api/targets')]);
  const src = (srcRes.list || []).find((s) => s.jid === jid);
  const targets = tgtRes.list || [];
  if (!src) return toast('Source not found', 'err');
  const mapped = String(src.targets || '').split(',').map((x) => x.trim()).filter(Boolean);
  const m = openModal({
    title: 'Publish this source to…', icon: ico('route'),
    html: `<p class="muted tiny">${esc(src.name || shortJid(jid))} — tick the target(s) this source should publish to. Untick everything to publish to ALL active targets.</p>
      <div style="margin-top:12px;display:grid;gap:8px">
      ${targets.length ? targets.map((t) => `
        <label class="sw-card" style="cursor:pointer"><input type="checkbox" value="${esc(t.jid)}" style="accent-color:var(--accent)" ${mapped.includes(t.jid) ? 'checked' : ''}>
        <span class="s-txt"><span class="s-name">${esc(t.name || shortJid(t.jid))}</span>${t.paused ? ' <span class="b b-warn">paused</span>' : ''}</span></label>`).join('')
      : '<p class="muted">No targets yet — add them in the Targets tab.</p>'}
      </div>`,
    primaryLabel: 'Save mapping',
    primary: () => {
      const chosen = $$('input[type="checkbox"]:checked', m).map((i) => i.value);
      api('/api/sources/' + encodeURIComponent(jid), { method: 'PATCH', body: { targets: chosen.join(',') } })
        .then(() => { toast(chosen.length ? `Mapped to ${chosen.length} target(s)` : 'Publishes to ALL active targets', 'ok'); closeModal(); loaders.sources(); })
        .catch((e) => { toast(e.message, 'err'); return false; });
      return false; // stay open until the request settles
    }
  });
}
/* 5A (R38): the per-source rule card — approve first, active hours (PKT),
   daily cap + auto-pause, keyword include/exclude, priority. */
async function openRulesModal(jid) {
  const [srcRes, rules] = await Promise.all([api('/api/sources'), api('/api/source-rules')]);
  const src = (srcRes.list || []).find((s) => s.jid === jid);
  if (!src) return toast('Source not found', 'err');
  const r = (rules.list || []).find((x) => x.source_jid === jid) || {};
  const m = openModal({
    title: 'Rule card — ' + (src.name || shortJid(jid)), icon: ico('sliders'),
    html: `
      <label class="sw-card" style="cursor:pointer;margin-bottom:12px"><input type="checkbox" id="ruleApprove" ${r.approve_first ? 'checked' : ''} style="accent-color:var(--accent)">
        <span class="s-txt"><span class="s-name">Approve first</span><span class="s-desc">Every post from this source waits in the Approval Queue for your OK (needs the Approval queue switch ON)</span></span></label>
      <div class="row-form wrap">
        <label class="sw-inline"><span>Active from (PKT)</span><input class="in" id="ruleFrom" type="time" style="flex:none" value="${esc(r.active_from || '')}" title="Only mirror posts between these times, Pakistan time (empty = always)"></label>
        <label class="sw-inline"><span>until</span><input class="in" id="ruleTo" type="time" style="flex:none" value="${esc(r.active_to || '')}" title="End of the active window — wraps midnight if it is before the start"></label>
      </div>
      <div class="row-form wrap" style="margin-top:12px">
        <label class="sw-inline"><span>Max posts per day</span><input class="in" id="ruleMax" type="number" min="0" max="500" style="flex:none;width:90px" value="${r.max_per_day || 0}" title="0 = unlimited"></label>
        <label class="sw-inline"><span>Auto-pause at the cap</span><label class="sw"><input type="checkbox" id="ruleAutoPause" ${r.auto_pause ? 'checked' : ''}><i></i></label></label>
      </div>
      <div class="field" style="margin-top:12px"><label>Only publish if it contains (comma words)</label><input class="in" id="ruleInc" value="${esc(r.include || '')}" placeholder="e.g. jobs, admission"></div>
      <div class="field" style="margin-top:12px"><label>Never publish if it contains (comma words)</label><input class="in" id="ruleExc" value="${esc(r.exclude || '')}" placeholder="e.g. lottery, gambling"></div>
      <div class="row-form" style="margin-top:12px">
        <select class="in" id="rulePri" style="flex:none" title="Backlog recovery order — 5 is recovered first after an offline period">
          ${[1, 2, 3, 4, 5].map((p) => `<option value="${p}" ${(r.priority || 3) === p ? 'selected' : ''}>Priority ${p}${p === 5 ? ' (recovered first)' : ''}</option>`).join('')}
        </select>
      </div>
      <p class="muted tiny" style="margin-top:10px">Hours are 24 h Pakistan time. An empty active-hours window means the source is always active. Keyword filters apply to the post text — a media-only post is skipped when an "only if" list is set.</p>`,
    primaryLabel: 'Save rule card',
    primary: () => {
      const body = {
        jid,
        approve_first: $('#ruleApprove', m).checked,
        active_from: $('#ruleFrom', m).value, active_to: $('#ruleTo', m).value,
        max_per_day: parseInt($('#ruleMax', m).value, 10) || 0,
        include: $('#ruleInc', m).value, exclude: $('#ruleExc', m).value,
        auto_pause: $('#ruleAutoPause', m).checked,
        priority: parseInt($('#rulePri', m).value, 10) || 3
      };
      api('/api/source-rules', { method: 'POST', body })
        .then(() => { toast('Rule card saved', 'ok'); closeModal(); loaders.sources(); })
        .catch((e) => { toast(e.message, 'err'); return false; });
      return false;
    }
  });
}
loaders.sources = async () => {
  $('#srcTable tbody').innerHTML = skelRows(3, 6);
  const [d, p] = await Promise.all([api('/api/sources'), api('/api/power')]);
  if ((d.list || []).length) {
    $('#srcTable tbody').innerHTML = channelRows(d.list, 'sources');
  } else {
    /* v7.7.3: emptyRow() paints the cell itself — assigning its (undefined)
       return value used to render the literal string "undefined" in the table */
    await emptyRow($('#srcTable tbody'), 'radio', 'No sources yet', 'follow a channel on your phone and it appears here automatically (Auto-monitor) — usually within a few minutes of linking. Still empty? Press Refresh top-right to check with WhatsApp now, or re-link in the WhatsApp tab', 6);
  }
  $('#srcCount').textContent = (d.list || []).length;
  $('#automonitor').checked = !!p.automonitor;
  refreshPicker('sources');
  paintSubs(); // 5I (I1): subscriber counts + 14-day growth sparkline (best-effort)
  srcFollowedBanner(d.followedMissing || []); // v7.9: followed → one click into Sources
  srcAutoRescan();                            // v7.9: pick up recent phone-follows
};
/* v7.9: channels this account follows on WhatsApp that are not in Sources yet
   → a one-click banner above the table (works whether or not Auto-monitor is on). */
function srcFollowedBanner(missing) {
  let box = document.getElementById('srcSyncBanner');
  if (!missing.length) { if (box) box.hidden = true; return; }
  if (!box) {
    box = document.createElement('div');
    box.id = 'srcSyncBanner';
    box.className = 'src-sync-banner';
    const host = document.querySelector('#srcTable') && document.querySelector('#srcTable').closest('.card-b');
    if (host) host.prepend(box); else return;
  }
  const names = missing.slice(0, 4).map((m) => esc(m.name)).join(', ') + (missing.length > 4 ? ` +${missing.length - 4} more` : '');
  box.hidden = false;
  box.innerHTML = `<span>You follow <b>${missing.length}</b> WhatsApp channel(s) that aren't in Sources yet — ${names}</span><button class="btn btn-sm btn-p" id="srcSyncAll">Add all ${missing.length} to Sources</button>`;
  document.getElementById('srcSyncAll').addEventListener('click', async (ev) => {
    const b = ev.target; b.disabled = true;
    try {
      const r = await api('/api/sources/sync-followed', { method: 'POST' });
      toast(`Added ${r.count} followed channel(s) to Sources`, 'ok');
      box.hidden = true;
      loaders.sources().catch(() => { });
    } catch (e) { toast(e.message, 'err'); b.disabled = false; }
  });
}
/* v7.9: if WhatsApp is linked and the last directory scan is stale, run one in
   the background so channels followed on the phone reach Sources without the
   user having to press Refresh (5-minute client cooldown — no loops). */
let __srcRescanning = false, __lastAutoRescan = 0;
async function srcAutoRescan() {
  if (__srcRescanning || Date.now() - __lastAutoRescan < 5 * 60 * 1000) return;
  try {
    const dir = await api('/api/directory');
    const lastAt = dir.scan && dir.scan.at ? Date.parse(dir.scan.at) : 0;
    if (dir.wa && dir.wa.status === 'open' && Date.now() - lastAt > 2 * 60 * 1000) {
      __srcRescanning = true;
      __lastAutoRescan = Date.now();
      await api('/api/directory/rescan', { method: 'POST' });
      loaders.sources().catch(() => { });
    }
  } catch { /* best effort */ }
  finally { __srcRescanning = false; }
}
/* 5I (I1): fill the Subscribers column from /api/subs — count + tiny sparkline.
   Best-effort: WhatsApp may not return the number yet; the cell then says so. */
let __subsCache = null;
async function paintSubs() {
  const cells = $$('#srcTable [data-subcell]');
  if (!cells.length) return;
  try { __subsCache = await api('/api/subs'); } catch { return; }
  for (const c of cells) {
    const row = (__subsCache.list || []).find((x) => x.jid === c.dataset.subcell);
    if (!row || row.subs == null) {
      c.innerHTML = '<span class="mut tiny">no snapshot yet</span><div class="subs-day">updates daily, best-effort</div>';
      continue;
    }
    const hist = (row.history || []).filter((h) => h.count != null);
    const delta = hist.length >= 2 ? row.subs - hist[0].count : 0;
    const spark = hist.length >= 2 ? sparklineSVG(hist.map((h) => h.count)) : '';
    c.innerHTML = `<span class="subs-num num">${fmtNum(row.subs)}</span>${spark}<div class="subs-day">${row.subsDay || ''} · ${delta >= 0 ? '+' : ''}${delta} since ${hist[0] ? hist[0].day.slice(5) : ''}</div>`;
  }
}
function sparklineSVG(vals) {
  const w = 92, h = 22, pad = 2;
  const min = Math.min(...vals), max = Math.max(...vals), span = (max - min) || 1;
  const pts = vals.map((v, i) => {
    const x = pad + (i * (w - 2 * pad)) / Math.max(1, vals.length - 1);
    const y = h - pad - ((v - min) * (h - 2 * pad)) / span;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  const up = vals[vals.length - 1] >= vals[0];
  return `<svg class="spark" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" aria-label="subscriber growth, last ${vals.length} days"><polyline points="${pts}" fill="none" stroke="${up ? 'var(--ok, #10B981)' : 'var(--warn, #F59E0B)'}" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"/></svg>`;
}
loaders.targets = async () => {
  $('#tgtTable tbody').innerHTML = skelRows(3, 5);
  const d = await api('/api/targets');
  if ((d.list || []).length) {
    $('#tgtTable tbody').innerHTML = channelRows(d.list, 'targets');
  } else {
    /* v7.7.3: emptyRow() paints the cell itself — assigning its return value rendered "undefined" */
    await emptyRow($('#tgtTable tbody'), 'target', 'No targets yet', 'add a channel your account can post to', 5);
  }
  $('#tgtCount').textContent = (d.list || []).length;
  fillSchedTargets(d.list || []);
  refreshPicker('targets');
};
wireChannelTable('#srcTable', 'sources');
wireChannelTable('#tgtTable', 'targets');
$('#srcAdd').addEventListener('click', async () => {
  const v = $('#srcInput').value.trim();
  if (!v) return;
  const btn = $('#srcAdd'); btn.classList.add('is-loading');
  try {
    const r = await api('/api/sources', { method: 'POST', body: { input: v } });
    toast(r.message || 'Added', 'ok');
    $('#srcInput').value = '';
    refreshChannels('sources');
  } catch (e) { toast(e.message, 'err'); }
  btn.classList.remove('is-loading');
});
$('#tgtAdd').addEventListener('click', async () => {
  const v = $('#tgtInput').value.trim();
  if (!v) return;
  const btn = $('#tgtAdd'); btn.classList.add('is-loading');
  try {
    const r = await api('/api/targets', { method: 'POST', body: { input: v } });
    toast(r.message || 'Added', 'ok');
    $('#tgtInput').value = '';
    refreshChannels('targets');
  } catch (e) { toast(e.message, 'err'); }
  btn.classList.remove('is-loading');
});
pickers.sources = mountPicker($('#srcPicker'), {
  kind: 'sources', mode: 'multi', placeholder: '— pick channels from your followed list (tick several) —',
  onPick: async (jids) => {
    const r = await api('/api/sources/bulk', { method: 'POST', body: { jids } });
    let msg = 'Added ' + r.added + ' channel' + (r.added === 1 ? '' : 's');
    if ((r.skipped || []).length) msg += ' · ' + r.skipped.length + ' already in the list';
    toast(msg, (r.errors || []).length ? 'err' : 'ok');
    refreshChannels('sources');
  }
});
pickers.targets = mountPicker($('#tgtPicker'), {
  kind: 'targets', mode: 'multi', placeholder: '— pick a channel you can post in (tick several) —',
  onPick: async (jids) => {
    const r = await api('/api/targets/bulk', { method: 'POST', body: { jids } });
    let msg = 'Added ' + r.added + ' channel' + (r.added === 1 ? '' : 's');
    if ((r.skipped || []).length) msg += ' · ' + r.skipped.length + ' already in the list';
    toast(msg, (r.errors || []).length ? 'err' : 'ok');
    refreshChannels('targets');
  }
});
$('#automonitor').addEventListener('change', async (ev) => {
  try { await api('/api/settings', { method: 'POST', body: { automonitor: ev.target.checked } }); toast(ev.target.checked ? 'Auto-monitor ON — new follows become sources' : 'Auto-monitor OFF'); }
  catch (e) { toast(e.message, 'err'); ev.target.checked = !ev.target.checked; }
});

/* ── 12 · POWER (switches + scheduler + routing + prompts) ──────── */
const SWITCHES = {
  scheduler: { name: 'Scheduler', desc: 'Publish queued posts at their scheduled time' },
  routing: { name: 'Smart routing', desc: 'Per-target include / exclude / media rules' },
  analytics: { name: 'Analytics', desc: 'Per-day, per-source and failure counters' },
  editposts: { name: 'Edit posts', desc: 'Edit or delete already-published posts (experimental)' },
  aipilot: { name: 'AI pilot', desc: 'AI decides which posts are worth publishing' },
  dedupe: { name: 'Smart dedupe', desc: 'Skip near-duplicate posts within 12 hours' },
  beautify: { name: 'AI beautify', desc: 'AI cleans and titles every post (regex clean always on)' },
  headers: { name: 'Auto headers', desc: 'Add a category header line (JOBS, NEWS…)' },
  hashtags: { name: 'Auto hashtags', desc: 'Append #jobs #news style tags' },
  translate: { name: 'AI translate', desc: 'Translate every post to your chosen language first' },
  aireply: { name: 'AI auto-reply', desc: 'AI answers personal WhatsApp messages for you (10-min per-chat limit)' },
  digest: { name: 'AI daily digest', desc: 'Once a day, AI posts a summary of everything published' },
  signature: { name: 'Signature (footer)', desc: 'Append your signature/footer to every published post' },
  /* 5A (v7.7.0) */
  queue: { name: 'Approval queue', desc: 'Posts from "approve first" sources wait here for your OK; the delay buffer also waits here' },
  crossdedupe: { name: 'Cross-source dedupe', desc: 'Same story from 2+ sources in the window publishes once, with merged via-credits' },
  dedsplit: { name: 'Split long posts', desc: 'Posts over 4096 characters become numbered parts, media on part 1' },
  polltext: { name: 'Polls to text', desc: 'Publish channel polls as a text post (question + options) instead of skipping them' },
  matrix: { name: 'Routing matrix', desc: 'Apply the explicit source × target on/off grid (off = current mapping behavior)' },
  /* 5C (v7.7.0) */
  tldr: { name: 'TL;DR line', desc: 'Long posts get a 1-line summary on top (AI — skipped automatically if AI is unavailable)' },
  autobold: { name: 'Auto-bold key phrases', desc: 'AI bolds the 1–3 most important phrases of every post with *asterisks*' },
  emojibullets: { name: 'Emoji bullets', desc: 'Bullet lines get rotating emoji bullets (deterministic, no AI)' },
  transcribe: { name: 'Voice transcription', desc: 'Voice messages in your chats are turned into text (needs a Gemini key — Settings · AI)' },
  replykb: { name: 'Knowledge-base replies', desc: 'Stored question → answer pairs, sent exactly (no AI). Hours + allowlist below; empty allowlist = nobody' },
  recap: { name: 'Morning recap', desc: 'Daily plain-text recap of yesterday (published/skipped/failed + up next) sent to your own number' },
  /* 5D (v7.8.0) */
  weekly: { name: 'Weekly report', desc: 'A plain-text week summary to your own number + email (if connected) on the day and time below' },
  instantalerts: { name: 'Instant alerts', desc: 'The moment something fails (post, WhatsApp, crash) you get a WhatsApp alert — 30-min cooldown per type' },
  /* 5H (R85–R87) — every new automation OFF by default (R8) */
  waCommand: { name: 'WA command channel', desc: 'Run the bot from your own WhatsApp number — status, approve, undo… (destructive needs the PIN)' },
  evergreen: { name: 'Evergreen recycling', desc: 'Re-share proven older text posts within a daily quota (rotation + rate guard)' },
  autopilot: { name: 'Auto-pilot', desc: 'Hourly self-maintenance: retry failed items, never deletes, daily cap, panic stop kills it' },
  /* 5I (I3/I4/I8) — every new automation OFF by default (R8) */
  smartmedia: { name: 'Smart media checks', desc: 'Before publish: media must match its kind and stay under the size caps (image 10 MB · video 40 MB · document 20 MB) — otherwise an honest skip, no compression' },
  linktools: { name: 'Link cleanup', desc: 'Strip tracking params (utm_*, fbclid, gclid…) from URLs in the final post text — everything else stays untouched' },
  announcard: { name: 'Announcement cards', desc: 'Make a branded 1080×1080 PNG card (with SVG source) from any post — a manual tool, never auto-attached' },
  /* 5J (J7) — every new automation OFF by default (R8) */
  aisafety: { name: 'AI safety screen', desc: 'An AI criteria review of the FINAL text before routing — e.g. "no political content". Fail-open: if the AI is down the post publishes as usual' }
};
/* Meridian 2 — one home per switch (the 33-switch table, verbatim):
   General: dedupe family + smart media · Brand: the formatting switches · Pilot: aipilot/scheduler/evergreen/autopilot
   Rules: aisafety · Reports and Digest: digest/recap/weekly/instantalerts · Replies: aireply/transcribe/replykb
   Queue header: queue · History header: editposts · Routing: routing+matrix · Analytics: analytics
   Library: announcard · Settings>WhatsApp: waCommand */
const SWITCH_HOME = {
  dedupe: '#swGeneral', crossdedupe: '#swGeneral', dedsplit: '#swGeneral', polltext: '#swGeneral', smartmedia: '#swGeneral',
  beautify: '#swBrand', headers: '#swBrand', hashtags: '#swBrand', signature: '#swBrand',
  translate: '#swBrand', tldr: '#swBrand', autobold: '#swBrand', emojibullets: '#swBrand', linktools: '#swBrand',
  aipilot: '#swAipilot', scheduler: '#swAipilot', evergreen: '#swAipilot', autopilot: '#swAipilot',
  aisafety: '#swRules',
  digest: '#swDigest', recap: '#swRecap', weekly: '#swWeekly', instantalerts: '#swInstantalerts',
  aireply: '#swAireply', transcribe: '#swAireply', replykb: '#swReplyKb',
  queue: '#swQueue', editposts: '#swPosts', routing: '#swRouting', matrix: '#swRouting',
  analytics: '#swAnalytics', announcard: '#swLibrary', waCommand: '#swWaCommand'
};
let __powerCache = null;
async function ensureSwitches() {
  if (!__powerCache) { try { __powerCache = await api('/api/power'); } catch (e) { return; } }
  paintSwitches(__powerCache);
}
function paintSwitches(p) {
  /* several switches share one home card (e.g. Beautify hosts 4) — group, never clobber */
  const byBox = {};
  for (const [k, sw] of Object.entries(SWITCHES)) {
    (byBox[SWITCH_HOME[k]] = byBox[SWITCH_HOME[k]] || []).push([k, sw]);
  }
  for (const [sel, items] of Object.entries(byBox)) {
    const box = $(sel);
    if (!box) continue;
    box.innerHTML = items.map(([k, sw]) => `
      <div class="sw-card" data-key="${k}">
        <div class="s-txt"><div class="s-name">${sw.name}</div><div class="s-desc">${sw.desc}</div></div>
        <label class="sw" title="${sw.desc.replace(/"/g, '&quot;')}"><input type="checkbox" data-key="${k}" ${p.switches[k] ? 'checked' : ''} title="${sw.desc.replace(/"/g, '&quot;')}"><i></i></label>
      </div>`).join('');
    $$('input[data-key]', box).forEach((input) => input.addEventListener('change', async (ev) => {
      ev.target.disabled = true;
      try {
        await api('/api/power/toggle', { method: 'POST', body: { key: ev.target.dataset.key, on: ev.target.checked } });
        toast(`${SWITCHES[ev.target.dataset.key].name} ${ev.target.checked ? 'ON' : 'OFF'}`, 'ok');
      } catch (e) { toast(e.message, 'err'); ev.target.checked = !ev.target.checked; }
      ev.target.disabled = false;
    }));
  }
  paintSwitchChips(p); /* read-only chips elsewhere refresh with the same payload */
}
/* ── Signal Desk §1.9 · READ-ONLY SWITCH CHIPS ───────────────────
   Outside a switch's one home, its state shows as a non-interactive
   "Label · Off ↗" chip that deep-links to the owner screen. The chip
   can never mutate state. */
const CHIP_TARGET = {
  queue: 'approvals', scheduler: 'scheduled',
  beautify: 'branding', translate: 'branding', tldr: 'branding', autobold: 'branding',
  emojibullets: 'branding', signature: 'branding', headers: 'branding', hashtags: 'branding',
  linktools: 'branding', announcard: 'media',
  digest: 'digest', recap: 'digest', weekly: 'digest', instantalerts: 'digest',
  aipilot: 'aipilot', evergreen: 'aipilot', autopilot: 'aipilot',
  aisafety: 'guardrails', routing: 'routing', matrix: 'routing',
  aireply: 'aireply', transcribe: 'aireply', replykb: 'aireply',
  dedupe: 'guardrails', crossdedupe: 'guardrails', dedsplit: 'guardrails',
  polltext: 'guardrails', smartmedia: 'guardrails', editposts: 'posts',
  analytics: 'analytics', waCommand: 'settings'
};
function swChipHtml(key, p) {
  const sw = SWITCHES[key];
  if (!sw) return '';
  const on = !!(p.switches && p.switches[key]);
  return `<button type="button" class="rosw ${on ? 'on' : ''}" data-chipkey="${key}" title="${esc(sw.name)} — opens its home (${esc(CHIP_TARGET[key] || 'Settings')})"><span class="rosw-dot" aria-hidden="true"></span><span class="rosw-lbl">${esc(sw.name)}</span><span class="rosw-state">${on ? 'On' : 'Off'}</span><span class="rosw-arr" aria-hidden="true">↗</span></button>`;
}
function paintSwitchChips(p) {
  const zones = [
    ['#homeSwitchChips', ['queue', 'scheduler', 'digest']],
    ['#composeSwitchChips', ['beautify', 'translate', 'emojibullets', 'tldr', 'signature', 'headers', 'hashtags']],
    ['#historySwitchChips', ['dedupe', 'routing', 'instantalerts']]
  ];
  for (const [sel, keys] of zones) {
    const box = $(sel);
    if (!box) continue;
    box.innerHTML = keys.map((k) => swChipHtml(k, p)).join('');
    box.hidden = !box.innerHTML;
  }
  $$('.rosw[data-chipkey]').forEach((b) => {
    if (b.dataset.wired) return;
    b.dataset.wired = '1';
    b.addEventListener('click', () => { const v = CHIP_TARGET[b.dataset.chipkey]; if (v) show(v); });
  });
}
/* ── 5A (R39) · ROUTING MATRIX — tri-state cells, saved in place ─────
   · default (from mapping)  →  ● ON (forced)  →  ○ OFF (forced)  →  default  */
let __mtx = { sources: [], targets: [], cells: {} };
async function renderMatrix() {
  const box = $('#matrixBox');
  if (!box) return;
  try {
    const d = await api('/api/routing-matrix');
    __mtx = { sources: d.sources || [], targets: d.targets || [], cells: {} };
    for (const c of d.cells || []) __mtx.cells[c.source_jid + '|' + c.target_jid] = Boolean(c.enabled);
    if (!__mtx.sources.length || !__mtx.targets.length) {
      box.innerHTML = '<p class="muted tiny">Add source and target channels first — the grid appears here automatically.</p>';
      return;
    }
    box.innerHTML = `<div class="tw"><table class="t mtx">
      <thead><tr><th>Source ↓ / Target →</th>${__mtx.targets.map((t) => `<th class="mtx-h" title="${esc(t.jid)}">${esc((t.name || shortJid(t.jid)).slice(0, 10))}</th>`).join('')}</tr></thead>
      <tbody>${__mtx.sources.map((s) => `<tr>
        <td class="mtx-src" title="${esc(s.jid)}">${esc(s.name || shortJid(s.jid))}</td>
        ${__mtx.targets.map((t) => matrixCell(s.jid, t.jid, t.name)).join('')}
      </tr>`).join('')}</tbody></table></div>
      <p class="muted tiny" style="margin-top:10px">Click a cell to cycle: <b>· default</b> (mapping behavior) → <b class="b b-ok">ON</b> forced → <b class="b b-warn">OFF</b> forced → back to default. Every click saves immediately.</p>`;
    $$('.mtx-c', box).forEach((b) => b.addEventListener('click', () => {
      const key = b.dataset.s + '|' + b.dataset.t;
      const cur = __mtx.cells[key];
      const next = cur === undefined ? true : cur === true ? false : undefined; // def → ON → OFF → def
      if (next === undefined) delete __mtx.cells[key]; else __mtx.cells[key] = next;
      paintMatrixCell(b, next);
      api('/api/routing-matrix', { method: 'POST', body: { cells: [{ source_jid: b.dataset.s, target_jid: b.dataset.t, enabled: next === undefined ? null : next }] } })
        .then(() => toast(next === undefined ? 'Back to mapping default' : next ? 'Forced ON' : 'Forced OFF', 'ok', { label: 'Undo', fn: () => { b.click(); } }))
        .catch((e) => toast(e.message, 'err'));
    }));
  } catch (e) { box.innerHTML = `<p class="muted tiny">Matrix not loaded: ${esc(e.message)}</p>`; }
}
function matrixCell(s, t, tname) {
  const v = __mtx.cells[s + '|' + t];
  return `<td><button class="mtx-c ${v === true ? 'on' : v === false ? 'off' : 'def'}" data-s="${esc(s)}" data-t="${esc(t)}" title="${esc(tname || t)}: ${v === true ? 'forced ON' : v === false ? 'forced OFF' : 'default'}">${v === true ? 'ON' : v === false ? 'OFF' : '·'}</button></td>`;
}
function paintMatrixCell(b, v) {
  b.className = 'mtx-c ' + (v === true ? 'on' : v === false ? 'off' : 'def');
  b.textContent = v === true ? 'ON' : v === false ? 'OFF' : '·';
  b.title = (b.title || '').split(':')[0] + ': ' + (v === true ? 'forced ON' : v === false ? 'forced OFF' : 'default');
}

/* ── 5A (R45) · MONTH CALENDAR of scheduled runs ─────────────────── */
let __calY = new Date().getFullYear(), __calM = new Date().getMonth() + 1;
async function loadCalMonth() {
  const grid = $('#calGrid');
  if (!grid) return;
  const key = `${__calY}-${String(__calM).padStart(2, '0')}`;
  $('#calMonth').textContent = new Date(__calY, __calM - 1, 1).toLocaleString([], { month: 'long', year: 'numeric' });
  grid.innerHTML = '';
  try {
    const d = await api('/api/scheduler/calendar?month=' + key);
    const first = new Date(__calY, __calM - 1, 1);
    const lead = (first.getDay() + 6) % 7; // Monday-first
    const dim = new Date(__calY, __calM, 0).getDate();
    const today = new Date();
    let html = '<div class="cal-hd">' + ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'].map((x) => `<span>${x}</span>`).join('') + '</div><div class="cal-body">';
    for (let i = 0; i < lead; i++) html += '<span class="cal-c empty"></span>';
    for (let d0 = 1; d0 <= dim; d0++) {
      const dk = `${key}-${String(d0).padStart(2, '0')}`;
      const items = (d.days || {})[dk] || [];
      const isToday = today.getFullYear() === __calY && today.getMonth() + 1 === __calM && today.getDate() === d0;
      html += `<span class="cal-c ${isToday ? 'today' : ''}" title="${items.map((x) => (x.name || 'untitled') + ' ' + (x.time || '')).join(' · ')}"><b>${d0}</b>${items.length ? `<i class="cal-dots" style="--n:${items.length}"></i>` : ''}</span>`;
    }
    html += '</div>';
    grid.innerHTML = html;
  } catch (e) { grid.innerHTML = `<p class="muted tiny">Calendar not loaded: ${esc(e.message)}</p>`; }
}
$('#calPrev').addEventListener('click', () => { __calM -= 1; if (__calM < 1) { __calM = 12; __calY -= 1; } loadCalMonth(); });
$('#calNext').addEventListener('click', () => { __calM += 1; if (__calM > 12) { __calM = 1; __calY += 1; } loadCalMonth(); });
/* 5A (R45): repeat type toggles the weekday chips / interval field */
$('#schedRepeat').addEventListener('change', () => {
  const v = $('#schedRepeat').value;
  $('#schedWeekdayBox').hidden = v !== 'weekdays';
  $('#schedIntervalBox').hidden = v !== 'interval';
});

/* ── 5A · APPROVAL QUEUE + LIVE QUEUE (R37/R43/R46/R47) ─────────── */
let __queueTab = 'approvals';
(function wireQueue() {
  const tabs = $('#queueTabs');
  if (!tabs) return;
  tabs.addEventListener('click', (ev) => {
    const b = ev.target.closest('button[data-qt]');
    if (!b) return;
    __queueTab = b.dataset.qt;
    $$('#queueTabs .tab').forEach((x) => x.classList.toggle('on', x === b));
    $('#queueTabApprovals').hidden = __queueTab !== 'approvals';
    $('#queueTabLive').hidden = __queueTab !== 'live';
    loaders.approvals().catch(() => { });
  });
  $('#queueDelaySave').addEventListener('click', async () => {
    try {
      const r = await api('/api/queue/delay', { method: 'POST', body: { min: parseInt($('#queueDelay').value, 10) || 0 } });
      toast(r.min ? `Delay buffer set to ${r.min} minutes — posts wait that long before publishing` : 'Delay buffer off', 'ok');
      loaders.approvals().catch(() => { });
    } catch (e) { toast(e.message, 'err'); }
  });
  $('#queueApproveAll').addEventListener('click', async () => {
    const n = $('#pendingCount').textContent;
    if (!n || n === '0') return toast('Nothing is waiting', '');
    const ok = await confirmModal('Approve every queued post?', `All ${n} waiting post(s) will publish now (media verification still applies). This cannot be undone per-post — use Posts → Undo last if needed.`, 'Approve all', true);
    if (!ok) return;
    try { const r = await api('/api/queue/approve-all', { method: 'POST' }); toast(`Approved ${r.n} post(s) — publishing now`, 'ok'); loaders.approvals(); } catch (e) { toast(e.message, 'err'); }
  });
  $('#queueRetryAll').addEventListener('click', async () => {
    const ok = await confirmModal('Retry every failed post?', 'Each failed post is re-fed through the whole pipeline (dedupe, guardrails, rate guard included).', 'Retry all', true);
    if (!ok) return;
    const btn = $('#queueRetryAll'); btn.disabled = true;
    try { const r = await api('/api/queue/retry-all', { method: 'POST' }); toast(r.note || `Retried ${r.retried} post(s)`, 'ok'); loaders.approvals(); } catch (e) { toast(e.message, 'err'); }
    btn.disabled = false;
  });
})();
/* v11 · Signal Desk queue card — source letter-square + target chips (mockup 03).
   Behavior unchanged: same data-q actions, same edit/retry wiring below. */
function sourceName(jid) {
  return String((window.__dirNames && window.__dirNames[jid]) || (jid ? shortJid(jid) : '') || '—');
}
function initialsOf(name) {
  const words = String(name).trim().split(/\s+/).filter(Boolean);
  if (!words.length) return '?';
  return (words.length >= 2 ? words[0][0] + words[1][0] : String(name).slice(0, 2)).toUpperCase();
}
function queueItemRow(q, live) {
  const nm = q.source_jid ? sourceName(q.source_jid) : '—';
  const hold = q.hold_until ? ` · holds until ${when(q.hold_until)}` : '';
  const media = q.media_kind ? ` <span class="b b-info">${esc(q.media_kind)}</span>` : '';
  /* mockup 03: "N targets" chip — the real names live in the hover title */
  const tgs = String(q.targets || '').split(',').map((x) => x.trim()).filter(Boolean);
  const tNames = tgs.map(sourceName);
  const tChips = tgs.length
    ? `<div class="q-targets"><span class="q-tchip" title="${esc(tNames.join(', '))}">${tgs.length} target${tgs.length > 1 ? 's' : ''}</span></div>`
    : '';
  return `
  <div class="q-item" data-qid="${q.id}">
    <div class="q-card">
      <span class="q-avatar" aria-hidden="true">${esc(initialsOf(nm))}</span>
      <div style="min-width:0">
        <div class="q-top">
          <span class="q-src"><b>${esc(nm)}</b>${media}</span><span class="q-when muted tiny">${when(q.created_at)}${hold}</span>
          <span class="q-acts">
            ${live ? '' : `<button class="btn btn-sm btn-p" data-q="approve">Approve</button><button class="btn btn-sm" data-q="edit">Edit</button><button class="btn btn-sm btn-d" data-q="reject">Discard</button>`}
            ${q.status === 'failed' ? '<button class="btn btn-sm" data-q="retry">Retry</button><button class="btn btn-sm" data-q="dismiss">Dismiss</button>' : ''}
          </span>
        </div>
        ${tChips}
        <div class="q-text">${esc(String(q.text || '').slice(0, 400))}${String(q.text || '').length > 400 ? '…' : ''}${q.note ? `<div class="muted tiny q-note">${esc(q.note)}</div>` : ''}</div>
      </div>
    </div>
  </div>`;
}
function wireQueueRows(box) {
  $$('.q-item', box).forEach((el) => {
    const id = el.dataset.qid;
    $$('.q-acts button', el).forEach((b) => b.addEventListener('click', async () => {
      b.disabled = true;
      try {
        const act = b.dataset.q;
        if (act === 'edit') {
          const item = box.querySelector(`[data-qid="${id}"] .q-text`);
          const openEdit = openModal({
            title: 'Edit before approving', icon: ico('pencil'),
            html: `<div class="field"><textarea class="in" id="qEditText" rows="8">${esc(el.__text || item.textContent.split('\n')[0])}</textarea></div>
                   <p class="muted tiny">Save = approve + publish with the edited text.</p>`,
            primaryLabel: 'Save + publish',
            primary: () => {
              const t = $('#qEditText').value;
              if (!t.trim()) return toast('Text is required', 'err') || false;
              api('/api/queue/' + id, { method: 'POST', body: { action: 'edit-approve', text: t } })
                .then(() => { toast('Edited + published', 'ok'); closeModal(); loaders.approvals(); })
                .catch((e) => { toast(e.message, 'err'); return false; });
              return false;
            }
          });
          return;
        }
        const res = await api('/api/queue/' + id, { method: 'POST', body: { action: act } });
        const msg = act === 'approve' ? 'Approved — publishing now' : act === 'reject' ? 'Rejected — it will not publish' : act === 'retry' ? 'Retrying' : 'Dismissed';
        toast(res.ok ? msg : (res.error || msg), res.ok ? 'ok' : 'err');
        loaders.approvals().catch(() => { });
      } catch (e) { toast(e.message, 'err'); b.disabled = false; }
    }));
  });
}
loaders.approvals = async () => {
  await ensureSwitches();
  const d = await api('/api/queue');
  const pending = d.pending || [];
  const qBadge = $('#queueBadge'); qBadge.hidden = !pending.length; qBadge.textContent = pending.length;
  const lBadge = $('#liveBadge'); const ln = d.failed.length + d.processing;
  lBadge.hidden = !ln; lBadge.textContent = ln;
  $('#queueDelay').value = d.delayMin || 0;
  $('#pendingCount').textContent = pending.length;
  const list = $('#queueList');
  /* v11 · mockup 03: filter chips with REAL counts (pending = ready now, held = in delay buffer);
     filtering is client-side on the rendered rows — no re-fetch, nothing lost */
  const nowMs = Date.now();
  const isHeld = (q) => Boolean(q.hold_until) && new Date(q.hold_until).getTime() > nowMs;
  const nHeld = pending.filter(isHeld).length;
  const nReady = pending.length - nHeld;
  const chipsBox = $('#queueChips');
  if (chipsBox) {
    const pad2 = (n) => String(n).padStart(2, '0');
    chipsBox.innerHTML = [
      ['all', `All · ${pad2(pending.length)}`],
      ['ready', `Pending · ${pad2(nReady)}`],
      ['held', `Held · ${pad2(nHeld)}`]
    ].map(([k, l], i) => `<button class="qchip${i === 0 ? ' on' : ''}" data-qf="${k}" title="${k === 'held' ? 'Waiting in the delay buffer' : k === 'ready' ? 'Ready for your decision now' : 'Everything in the queue'}">${l}</button>`).join('');
    $$('#queueChips .qchip').forEach((b) => b.addEventListener('click', () => {
      $$('#queueChips .qchip').forEach((x) => x.classList.toggle('on', x === b));
      const f = b.dataset.qf;
      $$('#queueList .q-item').forEach((el) => {
        const q = pending.find((x) => String(x.id) === el.dataset.qid);
        const held = q ? isHeld(q) : false;
        el.hidden = f === 'held' ? !held : (f === 'ready' ? held : false);
      });
    }));
  }
  if (pending.length) {
    list.innerHTML = pending.map((q) => queueItemRow(q, false)).join('');
    pending.forEach((q) => { const el = list.querySelector(`[data-qid="${q.id}"]`); if (el) el.__text = q.text; });
    wireQueueRows(list);
  } else {
    const s = await ico('inbox').catch(() => '');
    list.innerHTML = `<div class="es">${s}<div class="es-t">Nothing is waiting</div><div class="es-s">Posts appear here when a source has “Approve first” on, or when the delay buffer is set. Switch OFF = everything publishes automatically.</div></div>`;
  }
  /* live tab */
  $('#liveKpis').innerHTML = [
    kpi('Waiting approval', pending.length, 'needs your OK', pending.length ? 'accent' : ''),
    kpi('Ready (buffer elapsed)', (d.approved || []).length, 'publishing at the next 15 s pass'),
    kpi('In flight', d.processing, 'publishing right now', d.processing ? 'accent' : ''),
    kpi('Failed (kept)', d.failed.length, d.failed.length ? 'retry or dismiss below' : 'none', d.failed.length ? 'err' : 'ok'),
    kpi('Latency 7 d', d.latency && d.latency.n ? d.latency.median + ' s' : '—', d.latency && d.latency.n ? `p95 ${d.latency.p95} s over ${d.latency.n} posts` : 'median of source→publish')
  ].join('');
  const failedBox = $('#liveFailed');
  if (d.failed.length) {
    failedBox.innerHTML = Object.entries(d.failedGrouped || {}).map(([reason, g]) => `
      <div class="lg" style="margin-top:8px"><div class="lg-h"><b>${esc(reason)}</b> <span class="pill num">${g.n}</span></div>
      ${g.items.map((it) => `<div class="lg-i"><span class="muted tiny num">${when(it.when)}</span><span class="tiny">${esc(it.source)}</span><span class="muted tiny">${esc(String(it.snippet).slice(0, 90))}</span>
        <span class="ra"><button class="btn btn-sm" data-fr="${it.id}">Retry</button><button class="btn btn-sm" data-fd="${it.id}">Dismiss</button></span></div>`).join('')}</div>`).join('');
    $$('[data-fr]', failedBox).forEach((b) => b.addEventListener('click', async () => {
      b.disabled = true;
      try {
        const qid = await queueIdForPost(b.dataset.fr);
        if (qid != null) { await api('/api/queue/' + qid, { method: 'POST', body: { action: 'retry' } }); toast('Retrying', 'ok'); }
        else toast('No queue copy for that post — use “Retry all failed” to re-feed it', '');
      } catch (e) { toast(e.message, 'err'); }
      b.disabled = false;
      loaders.approvals().catch(() => { });
    }));
    $$('[data-fd]', failedBox).forEach((b) => b.addEventListener('click', async () => {
      b.disabled = true;
      try {
        const qid = await queueIdForPost(b.dataset.fd);
        if (qid != null) await api('/api/queue/' + qid, { method: 'POST', body: { action: 'dismiss' } });
        await api('/api/posts/dismiss-failed', { method: 'POST', body: { id: b.dataset.fd } }).catch(() => { });
        toast('Dismissed', 'ok');
      } catch (e) { toast(e.message, 'err'); }
      b.disabled = false;
      loaders.approvals().catch(() => { });
    }));
  } else {
    const s = await ico('check').catch(() => '');
    failedBox.innerHTML = `<div class="es">${s}<div class="es-t">No failed posts</div><div class="es-s">Failures stay here until you retry or dismiss them — nothing is ever dropped silently.</div></div>`;
  }
  let rec = null; try { rec = JSON.parse(d.recovery || 'null'); } catch (e) { }
  $('#recoveryNote').textContent = rec ? `Last boot recovery pass (${when(rec.at)}): ${rec.fed || 0} missed post(s) re-fed → ${rec.recovered || 0} published, ${rec.queued || 0} queued, ${rec.failed || 0} failed, ${rec.skipped || 0} skipped.` : 'Recovery results appear here after the bot reconnects and runs its catch-up pass.';
};
async function queueIdForPost(postId) {
  try {
    const [d, posts] = await Promise.all([api('/api/queue'), api('/api/posts?limit=200')]);
    const row = (posts.list || []).find((p) => String(p.id) === String(postId));
    if (!row) return null;
    for (const list of [d.pending, d.approved]) {
      const q = (list || []).find((x) => x.source_jid === row.source_jid && x.source_msg_id === row.source_msg_id);
      if (q) return q.id;
    }
    return null;
  } catch { return null; }
}

loaders.power = async () => {
  const p = await api('/api/power');
  __powerCache = p;
  paintSwitches(p);
  $('#aipilotInput').value = p.aipilot || '';
  /* scheduler */
  const tg = await api('/api/targets');
  fillSchedTargets(tg.list || []);
  const st = await api('/api/settings');
  const WD_NAMES = { 1: 'Mon', 2: 'Tue', 3: 'Wed', 4: 'Thu', 5: 'Fri', 6: 'Sat', 7: 'Sun' };
  const repeatLabel = (j) => {
    if (j.repeat === 'weekdays') return 'Weekdays: ' + String(j.weekdays || '1,2,3,4,5').split(',').filter(Boolean).map((w) => WD_NAMES[parseInt(w, 10)] || w).join(' ');
    if (j.repeat === 'interval') return `Every ${j.intervalMin || 30} min`;
    return esc(j.repeat) + (j.templateId ? ` · ${esc(j.templateId)}` : '');
  };
  $('#schedTable tbody').innerHTML = (p.scheduler || []).map((j) => `
    <tr data-id="${esc(j.id)}">
      <td><b>${esc(j.name || j.text.slice(0, 40) + '…')}</b><div class="muted tiny">${esc(j.text.slice(0, 80))}…</div></td>
      <td class="ch-jid">${shortJid(j.jid)}</td>
      <td class="tiny num">${when(j.at)}</td>
      <td class="tiny">${repeatLabel(j)}</td>
      <td class="num">${j.sent}</td>
      <td><div class="ra">
        <button class="btn btn-sm" data-act="tgl">${j.enabled ? 'Pause' : 'Resume'}</button>
        <button class="btn btn-sm btn-d" data-act="del">Delete</button>
      </div></td>
    </tr>`).join('') || (await emptyTCell('calendar', 'No scheduled posts', 'add one above — one-off, daily or weekly', 6));
  /* routing rows */
  const srcs = await api('/api/sources');
  const all = [...(tg.list || []), ...(srcs.list || [])].filter((c, i, arr) => arr.findIndex((x) => x.jid === c.jid) === i).sort((a, b) => String(a.name).localeCompare(String(b.name)));
  $('#routingList').innerHTML = all.map((c) => {
    const r = (p.routing || []).find((x) => x.jid === c.jid) || {};
    return `<div class="route-row" data-jid="${esc(c.jid)}">
      <div class="r-name" title="${esc(c.jid)}">${esc(c.name || shortJid(c.jid))}</div>
      <input class="in" placeholder="only if it contains…" value="${esc(r.include || '')}" data-f="include">
      <input class="in" placeholder="never if it contains…" value="${esc(r.exclude || '')}" data-f="exclude">
      <select class="in" data-f="type" title="Post type filter">
        <option value="all" ${r.type !== 'text' && r.type !== 'media' ? 'selected' : ''}>All posts</option>
        <option value="text" ${r.type === 'text' ? 'selected' : ''}>Text only</option>
        <option value="media" ${r.type === 'media' ? 'selected' : ''}>Media only</option>
      </select>
    </div>`;
  }).join('') || '<p class="muted">Add target/source channels first.</p>';
  $('#translateLang').value = st.translateLang || '';
  $('#digestAt').value = st.digestAt || '22:00';
  $('#aireplyPrompt').value = st.aireplyPrompt || '';
  $('#signatureInput').value = p.signatureText || '';
  $('#headerInput').value = p.headerText || '';
  window.__tpl = { list: (p.template && p.template.list) || [], mode: (p.template && p.template.mode) || 'off', pick: (p.template && p.template.pick) || 'plain', custom: (p.template && p.template.custom) || '' };
  /* 5A (R45): template refs in the scheduler form */
  const tplSel = $('#schedTemplate');
  if (tplSel) {
    const cur = tplSel.value;
    const names = (p.template && p.template.list) || [];
    tplSel.innerHTML = '<option value="">No template — publish as written</option>' + names.map((t) => `<option value="${esc(t.id)}">${esc(t.name || t.id)}</option>`).join('');
    if (cur) tplSel.value = cur;
  }
  renderMatrix(p);
  loadCalMonth();
  /* 5C (R60): recap time */
  $('#recapAt').value = st.recapAt || '07:00';
  loadReplyKb(); // 5C (R59)
};
/* Meridian 2: scheduled = power state + the month calendar (List/Calendar toggle) */
for (const v of ['routing', 'aipilot', 'aireply', 'digest']) loaders[v] = () => loaders.power();
loaders.scheduled = async () => { await loaders.power(); if (!__calYM) __calYM = pktYM(new Date()); loadCalendar(); };
loaders.guardrails = async () => {
  ensureSwitches();
  const st = await api('/api/settings');
  $('#setBlocklist').value = st.blocklist || '';
  $('#setBlocklistRegex').checked = !!st.blocklistRegex;
  $('#setReplace').value = st.replaceRules || '';
  renderReplaceRules();
  loadGuardTargets();
  $('#setMaxPerHour').value = st.maxPerHour || '30';
};
$('#signatureSave').addEventListener('click', async () => {
  try { await api('/api/settings', { method: 'POST', body: { signatureText: $('#signatureInput').value } }); toast('Footer saved — turn the Signature (footer) switch ON to use it', 'ok'); }
  catch (e) { toast(e.message, 'err'); }
});
$('#headerSave').addEventListener('click', async () => {
  try { await api('/api/settings', { method: 'POST', body: { headerText: $('#headerInput').value } }); toast('Header saved — turn the Auto headers switch ON to use it (empty = automatic title line)', 'ok'); }
  catch (e) { toast(e.message, 'err'); }
});
$('#schedTable').addEventListener('click', async (ev) => {
  const btn = ev.target.closest('button[data-act]');
  if (!btn) return;
  const id = btn.closest('tr').dataset.id;
  try {
    if (btn.dataset.act === 'tgl') await api('/api/power/scheduler/' + id, { method: 'PATCH', body: { enabled: btn.textContent.trim() === 'Pause' ? false : true } });
    else {
      const ok = await confirmModal('Delete scheduled post?', 'It will no longer run. Posts it already sent are not affected.', 'Delete', true);
      if (!ok) return;
      await api('/api/power/scheduler/' + id, { method: 'DELETE' });
    }
    loaders.power();
  } catch (e) { toast(e.message, 'err'); }
});
$('#schedAdd').addEventListener('click', async () => {
  const btn = $('#schedAdd'); btn.classList.add('is-loading');
  try {
    const repeat = $('#schedRepeat').value;
    if (!$('#schedAt').value) throw new Error('Pick the date and time (24 h Pakistan time).');
    const body = {
      jid: $('#schedTarget').value, name: $('#schedName').value, text: $('#schedText').value,
      at: '', localAt: $('#schedAt').value, tz: 'Asia/Karachi', repeat
    };
    if (repeat === 'weekdays') {
      const wd = $$('#schedWeekdays input:checked').map((i) => i.value);
      if (!wd.length) throw new Error('Tick at least one weekday.');
      body.weekdays = wd.join(',');
    }
    if (repeat === 'interval') body.intervalMin = parseInt($('#schedIntervalMin').value, 10) || 30;
    if ($('#schedTemplate').value) body.templateId = $('#schedTemplate').value;
    await api('/api/power/scheduler', { method: 'POST', body });
    toast('Scheduled — the Scheduler switch must be ON (Scheduled tab) to run it', 'ok');
    $('#schedText').value = ''; $('#schedName').value = '';
    loaders.power();
  } catch (e) { toast(e.message, 'err'); }
  btn.classList.remove('is-loading');
});
$('#aipilotSave').addEventListener('click', async () => {
  try { await api('/api/power/aipilot', { method: 'POST', body: { criteria: $('#aipilotInput').value } }); toast('AI pilot rule saved', 'ok'); }
  catch (e) { toast(e.message, 'err'); }
});
$('#aiExtrasSave').addEventListener('click', async () => {
  try {
    await api('/api/settings', { method: 'POST', body: { translateLang: $('#translateLang').value.trim(), digestAt: $('#digestAt').value.trim() } });
    toast('Saved — turn the Translate / Digest switches ON (above) to use them', 'ok');
  } catch (e) { toast(e.message, 'err'); }
});
$('#aireplyPromptSave').addEventListener('click', async () => {
  try { await api('/api/settings', { method: 'POST', body: { aireplyPrompt: $('#aireplyPrompt').value } }); toast('Auto-reply instruction saved', 'ok'); }
  catch (e) { toast(e.message, 'err'); }
});

/* ── 5C (R59) · knowledge-base auto-reply ───────────────────────── */
async function loadReplyKb() {
  try {
    const [kb, cfg] = await Promise.all([api('/api/reply-kb'), api('/api/reply-kb/settings')]);
    $('#kbFrom').value = cfg.from || '09:00';
    $('#kbTo').value = cfg.to || '21:00';
    $('#kbAllow').value = cfg.allowlist || '';
    const box = $('#kbList');
    const list = kb.list || [];
    if (!list.length) { box.innerHTML = '<span class="muted tiny">No pairs yet — add your first question → answer below.</span>'; return; }
    box.innerHTML = list.map((r) => `<div class="row-form wrap" style="margin-bottom:6px">
      <span class="tiny" style="flex:none;width:38%"><b>${esc(r.q)}</b>${r.enabled ? '' : ' <span class="b b-warn">off</span>'}</span>
      <span class="muted tiny" style="flex:1">${esc(String(r.a).slice(0, 70))}</span>
      <button class="btn btn-sm btn-g" data-kbt="${r.id}" title="${r.enabled ? 'Disable this pair' : 'Enable this pair'}">${r.enabled ? 'Disable' : 'Enable'}</button>
      <button class="btn btn-sm btn-g" data-kbd="${r.id}">Delete</button>
    </div>`).join('');
    box.querySelectorAll('[data-kbt]').forEach((b) => b.addEventListener('click', async () => {
      const r = (kb.list || []).find((x) => x.id === Number(b.dataset.kbt));
      if (!r) return;
      await api('/api/reply-kb/' + r.id, { method: 'POST', body: { q: r.q, a: r.a, enabled: !r.enabled } });
      loadReplyKb(); toast(r.enabled ? 'Pair disabled' : 'Pair enabled', 'ok');
    }));
    box.querySelectorAll('[data-kbd]').forEach((b) => b.addEventListener('click', async () => {
      await api('/api/reply-kb/' + b.dataset.kbd, { method: 'DELETE' });
      loadReplyKb(); toast('Pair deleted', 'ok');
    }));
  } catch (e) { /* non-fatal */ }
}
$('#kbAdd').addEventListener('click', async () => {
  const q = $('#kbQ').value.trim(), a = $('#kbA').value.trim();
  if (!q || !a) return toast('Both the question and the answer are needed', 'err');
  try {
    await api('/api/reply-kb', { method: 'POST', body: { q, a } });
    $('#kbQ').value = ''; $('#kbA').value = '';
    loadReplyKb(); toast('Pair saved — turn the Knowledge-base switch ON to use it', 'ok');
  } catch (e) { toast(e.message, 'err'); }
});
$('#kbSave').addEventListener('click', async () => {
  try {
    await api('/api/reply-kb/settings', { method: 'POST', body: { from: $('#kbFrom').value.trim(), to: $('#kbTo').value.trim(), allowlist: $('#kbAllow').value.trim() } });
    toast('Hours & allowlist saved', 'ok');
  } catch (e) { toast(e.message, 'err'); }
});

/* ── 5C (R60) · morning recap time ──────────────────────────────── */
$('#recapAtSave').addEventListener('click', async () => {
  try {
    await api('/api/recap/at', { method: 'POST', body: { at: $('#recapAt').value.trim() } });
    toast('Recap time saved — turn the Morning recap switch ON to receive it', 'ok');
  } catch (e) { toast(e.message, 'err'); }
});

$('#routingSave').addEventListener('click', async () => {
  try {
    const rules = $$('#routingList .route-row').map((row) => ({
      jid: row.dataset.jid,
      include: $('[data-f="include"]', row).value,
      exclude: $('[data-f="exclude"]', row).value,
      type: $('[data-f="type"]', row).value
    })).filter((r) => r.include.trim() || r.exclude.trim() || r.type !== 'all');
    await api('/api/power/routing', { method: 'POST', body: { rules } });
    toast('Routing rules saved', 'ok');
  } catch (e) { toast(e.message, 'err'); }
});

/* ── 13 · TEMPLATES v2 ──────────────────────────────────────────── */
const TPL_PH = ['text', 'title', 'source', 'date', 'time', 'hashtags'];
function tplFillLocal(zone, sampleText) {
  const now = new Date();
  const date = now.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  const time = now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  const title = (sampleText.split('\n')[0] || '').slice(0, 60);
  const tags = (sampleText.match(/#[A-Za-z0-9_\p{L}]{2,}/gu) || []).slice(0, 8).join(' ');
  return String(zone || '')
    .replace(/\{\{POST\}\}/gi, sampleText).replace(/\{\{DATE\}\}/gi, date)
    .replace(/\{\{TITLE\}\}/gi, title).replace(/\{\{SOURCE\}\}/gi, 'Sample Channel')
    .replace(/\{\{TIME\}\}/gi, time).replace(/\{\{HASHTAGS\}\}/gi, tags)
    .replace(/\{text\}/gi, sampleText).replace(/\{title\}/gi, title)
    .replace(/\{source\}/gi, 'Sample Channel').replace(/\{date\}/gi, date)
    .replace(/\{time\}/gi, time).replace(/\{hashtags\}/gi, tags);
}
loaders.templates = async () => {
  const p = await api('/api/power');
  const t = p.template || {};
  const list = t.list || [];
  const pool = new Set(t.pool || []);
  const mode = t.mode || 'off';
  const pick = t.pick || 'plain';
  window.__tplv2 = { list, mode, pick, pool, styles: t.styles || {}, history: t.history || [], zones: t.zones || {} };
  $$('#tplModes input[name="tplMode"]').forEach((r) => { r.checked = r.value === mode; const l = r.closest('.tpl-mode'); if (l) l.classList.toggle('on', r.value === mode); });
  $('#tplPoolHint').hidden = mode === 'off';
  $('#tplModeStatus').textContent = mode === 'off' ? 'OFF' : mode + (pool.size ? ` · pool of ${pool.size}` : ' · full set');
  $('#tplGrid').innerHTML = list.map((x) => `
    <div class="tpl-row ${pick === x.id ? 'picked' : ''}" data-id="${esc(x.id)}">
      <label class="tpl-pool" title="Include in the Rotate / Shuffle pool"><input type="checkbox" data-pool="${esc(x.id)}" ${pool.has(x.id) ? 'checked' : ''}></label>
      <div class="tpl-main">
        <div class="tpl-name">${esc(x.name)}${x.builtIn ? '' : ' <span class="b b-acc">custom</span>'}</div>
        <div class="tpl-body muted tiny">${esc((x.body || '').replace(/\n/g, ' ⏎ '))}</div>
      </div>
      <div class="ra">
        <button class="btn btn-sm" data-act="style" title="Set the AI style instruction for this template">AI style</button>
        <button class="btn btn-sm" data-act="sample" title="Static before/after — no AI involved">Sample</button>
        <button class="btn btn-sm btn-p" data-act="use">Use fixed</button>
      </div>
      <div class="tpl-smp" hidden>
        <div><div class="tpl-smp-h muted tiny">BEFORE</div><div dir="auto" class="tpl-smp-t">${esc(x.sampleBefore || '')}</div></div>
        <div><div class="tpl-smp-h muted tiny">AFTER</div><div dir="auto" class="tpl-smp-t">${esc(x.sampleAfter || '')}</div></div>
      </div>
    </div>`).join('');
  const pv = t.preview || {};
  $('#tplBubble').textContent = (pv.example || '…');
  $('#tplPreviewUsed').textContent = mode === 'off' ? 'template off — post as-is' : `using: ${pv.used || pick}`;
  const z = t.zones || { header: '', body: '', footer: '' };
  $('#tplZoneHeader').value = z.header || '';
  $('#tplZoneBody').value = z.body || '';
  $('#tplZoneFooter').value = z.footer || '';
  try { const raw = JSON.parse(t.custom || 'null'); $('#tplRawBody').value = (raw && raw.zones) ? '' : (t.custom || ''); } catch { $('#tplRawBody').value = t.custom || ''; }
  const hist = t.history || [];
  $('#tplHistCount').textContent = hist.length ? `(${hist.length})` : '';
  $('#tplHistList').innerHTML = hist.length ? hist.map((h, i) => `
    <div class="hist-row" data-h="${i}"><span class="muted tiny num">${when(h.ts)}</span><span class="tiny" style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc((h.zones.body || '').slice(0, 70))}</span><button class="btn btn-sm" data-act="restore">Restore</button></div>`).join('')
    : '<p class="muted">No saved customs yet — save one and it appears here (last 5 kept).</p>';
  if (!window.__tplv2Wired) { window.__tplv2Wired = true; tplWire(); }
  tplPreviewLocal();
};
function tplPreviewLocal() {
  const b = $('#tplBubble');
  if (!b) return;
  const sample = 'Admission open — Punjab Public Service Commission. Last date 31 October. #jobs';
  const head = tplFillLocal($('#tplZoneHeader').value, sample);
  const main = tplFillLocal($('#tplZoneBody').value || '{text}', sample);
  const foot = tplFillLocal($('#tplZoneFooter').value, sample);
  b.textContent = [head, main, foot].filter((s) => s.trim() !== '').join('\n\n') || '…';
}
function tplWire() {
  const save = async (body, msg) => {
    try { await api('/api/power/template', { method: 'POST', body }); toast(msg, 'ok'); loaders.templates().catch(() => {}); }
    catch (e) { toast(e.message, 'err'); }
  };
  $$('#tplModes .tpl-mode').forEach((l) => l.addEventListener('click', () => {
    const r = l.querySelector('input');
    if (r.checked) save({ mode: r.value }, 'Post format: ' + r.value);
  }));
  $('#tplGrid').addEventListener('click', (ev) => {
    const btn = ev.target.closest('button[data-act]');
    if (!btn) return;
    const row = btn.closest('.tpl-row');
    const id = row.dataset.id;
    if (btn.dataset.act === 'use') save({ mode: 'single', pick: id }, 'Template fixed: ' + id);
    else if (btn.dataset.act === 'sample') { const s = row.querySelector('.tpl-smp'); s.hidden = !s.hidden; }
    else if (btn.dataset.act === 'style') {
      const cur = window.__tplv2 || { styles: {} };
      $('#tplStyleInput').value = cur.styles[id] || '';
      $('#tplStyleTarget').textContent = (cur.list.find((x) => x.id === id) || {}).name || id;
      window.__tplStyleId = id;
      $('#tplStyleInput').scrollIntoView({ block: 'center' });
    }
  });
  $('#tplGrid').addEventListener('change', (ev) => {
    const cb = ev.target.closest('input[data-pool]');
    if (!cb) return;
    const ids = $('#tplGrid input[data-pool]:checked').map((x) => x.dataset.pool);
    save({ pool: ids }, 'Pool updated — ' + ids.length + ' template(s) ticked');
  });
  $$('#tplZoneHeader, #tplZoneBody, #tplZoneFooter').forEach((el) => el.addEventListener('input', () => tplPreviewLocal()));
  $('#tplCustomSave').addEventListener('click', () => {
    const body = $('#tplZoneBody').value;
    if (!/\{text\}|\{\{POST\}\}/i.test(body)) return toast('The body zone must contain {text} (or {{POST}})', 'err');
    save({ zones: { header: $('#tplZoneHeader').value, body, footer: $('#tplZoneFooter').value } }, 'Custom template saved (zones)');
  });
  $('#tplRawSave').addEventListener('click', () => save({ raw: $('#tplRawBody').value }, 'Custom template saved (raw)'));
  $('#tplHistList').addEventListener('click', (ev) => {
    const btn = ev.target.closest('button[data-act="restore"]');
    if (!btn) return;
    const h = ((window.__tplv2 || {}).history || [])[Number(btn.closest('.hist-row').dataset.h)];
    if (!h) return;
    save({ zones: h.zones }, 'Saved template restored');
  });
  $('#tplStyleSave').addEventListener('click', async () => {
    const id = window.__tplStyleId || ((window.__tplv2 || {}).pick) || 'plain';
    try {
      await api('/api/power/tplstyle', { method: 'POST', body: { id, style: $('#tplStyleInput').value } });
      toast('AI style saved for ' + id, 'ok');
      window.__tplv2 = window.__tplv2 || {};
      window.__tplv2.styles = { ...(window.__tplv2.styles || {}), [id]: $('#tplStyleInput').value.trim() };
    } catch (e) { toast(e.message, 'err'); }
  });
  $('#phChips').innerHTML = TPL_PH.map((k) => `<button class="ph-chip" data-ph="{${k}}">{${k}}</button>`).join('');
  $('#phChips').addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-ph]');
    if (!b) return;
    const ta = document.activeElement;
    if (ta && ['tplZoneHeader', 'tplZoneBody', 'tplZoneFooter'].includes(ta.id)) {
      const s = ta.selectionStart || 0, epos = ta.selectionEnd || 0;
      ta.value = ta.value.slice(0, s) + b.dataset.ph + ta.value.slice(epos);
      ta.focus(); ta.selectionStart = ta.selectionEnd = s + b.dataset.ph.length;
      tplPreviewLocal();
    }
  });
  $$('#tplCustomTabs .tab').forEach((tb) => tb.addEventListener('click', () => {
    $$('#tplCustomTabs .tab').forEach((x) => x.classList.toggle('on', x === tb));
    $('#tplZones').hidden = tb.dataset.t !== 'zones';
    $('#tplRaw').hidden = tb.dataset.t !== 'raw';
    $('#tplHist').hidden = tb.dataset.t !== 'history';
  }));
}

/* ── 14 · COMPOSER ──────────────────────────────────────────────── */
/* ── 14.5 · 5B COMPOSER (R49–R52) ───────────────────────────────── */
let composeUpload = null;  // { b64, mime } — attached photo (max 5 MB)
let composeUndo = null;    // last text before an AI rewrite (one-step undo)
let __snipCache = [];      // snippet cache for placeholder modal

/* WhatsApp markdown → preview HTML (the four syntaxes WA renders) */
const waRender = (t) => {
  let h = esc(String(t || ''));
  h = h.replace(/\*([^*\n]+)\*/g, '<b>$1</b>');
  h = h.replace(/_([^_\n]+)_/g, '<i>$1</i>');
  h = h.replace(/~([^~\n]+)~/g, '<s>$1</s>');
  h = h.replace(/\|([^|\n]+)\|/g, '<code>$1</code>');
  h = h.replace(/\{(\w+)\}/g, '<span class="ph-slot">{$1}</span>');
  return h;
};
const composeRefresh = () => {
  const t = $('#composeText').value;
  $('#composePreview').innerHTML = waRender(t);
  const n = t.length;
  const c = $('#composeCount');
  c.textContent = n + ' chars' + (n > 4096 ? ' — will auto-split into ' + Math.ceil(n / 4096) + ' labeled parts' : '');
  c.style.color = n > 4096 ? 'var(--warn, #f0a020)' : '';
};
$('#composeText').addEventListener('input', composeRefresh);

/* R49: formatting toolbar — wrap the selection, like WhatsApp does by hand */
const wrapSel = (before, after) => {
  const el = $('#composeText');
  const s = el.selectionStart ?? el.value.length, e = el.selectionEnd ?? el.value.length;
  const sel = el.value.slice(s, e) || 'text';
  el.value = el.value.slice(0, s) + before + sel + after + el.value.slice(e);
  el.focus();
  el.setSelectionRange(s + before.length, s + before.length + sel.length);
  composeRefresh();
};
document.querySelectorAll('.cb[data-fmt]').forEach((b) => b.addEventListener('click', () => {
  const f = b.dataset.fmt;
  if (f === 'bold') wrapSel('*', '*');
  else if (f === 'italic') wrapSel('_', '_');
  else if (f === 'strike') wrapSel('~', '~');
  else if (f === 'mono') wrapSel('|', '|');
  else if (f === 'clear') { const el = $('#composeText'); el.value = el.value.replace(/[*_~|]/g, ''); composeRefresh(); }
}));

/* R50: AI buttons — Improve / Shorten / Formal / Translate / Emojify */
document.querySelectorAll('[data-aiact]').forEach((b) => b.addEventListener('click', async () => {
  const text = $('#composeText').value.trim();
  if (!text) return toast('Write some text first');
  const act = b.dataset.aiact;
  b.classList.add('is-loading');
  try {
    const r = await api('/api/compose/ai', { method: 'POST', body: { action: act, text } });
    composeUndo = $('#composeText').value;
    $('#composeText').value = r.text;
    composeRefresh();
    const label = { improve: 'Improved', shorten: 'Shortened', formal: 'Made formal', translate: 'Translated', emojify: 'Emoji added' }[act] || 'Updated';
    toast(label + ' — review it before publishing', 'ok', { label: 'Undo', fn: () => { if (composeUndo != null) { $('#composeText').value = composeUndo; composeUndo = null; composeRefresh(); } } });
  } catch (e) { toast(e.message, 'err'); }
  b.classList.remove('is-loading');
}));

/* R51: snippets with {placeholders} */
async function loadSnippets() {
  try {
    const d = await api('/api/snippets');
    __snipCache = d.list || [];
    const sel = $('#snippetPick');
    const cur = sel.value;
    sel.innerHTML = '<option value="">Insert a snippet…</option>' + __snipCache.map((s) => `<option value="${s.id}">${esc(s.name)} — ${esc(String(s.body || '').slice(0, 40).replace(/\n/g, ' '))}</option>`).join('');
    if (cur) sel.value = cur;
  } catch (e) { /* non-fatal */ }
}
function renderSnippetModal() {
  const rows = __snipCache.length
    ? __snipCache.map((s) => `<div class="row-form wrap" style="margin-bottom:8px"><b>${esc(s.name)}</b><span class="muted tiny" style="flex:1">${esc(String(s.body || '').slice(0, 50).replace(/\n/g, ' '))}</span><button class="btn btn-sm btn-g" data-se="${s.id}">Edit</button><button class="btn btn-sm btn-g" data-sd="${s.id}">Delete</button></div>`).join('')
    : '<div class="muted tiny">No snippets yet.</div>';
  openModal({
    title: 'Snippets',
    html: `<div class="muted tiny" style="margin-bottom:10px">Braces like <b>{name}</b> become fill-in fields when the snippet is inserted.</div>${rows}
    <div class="row-form" style="margin-top:10px"><input class="in" id="snipName" placeholder="Snippet name"></div>
    <div class="field" style="margin-top:8px"><textarea class="in" id="snipBody" rows="3" placeholder="Snippet text — {placeholders} welcome"></textarea></div>
    <div class="row-actions"><button class="btn btn-p" id="snipSave">Save snippet</button></div>`
  });
  const prefill = (id) => { const s = __snipCache.find((x) => x.id === Number(id)); if (s) { $('#snipName').value = s.name; $('#snipBody').value = s.body; } };
  $$('#mRoot [data-se]').forEach((b) => b.addEventListener('click', () => prefill(b.dataset.se)));
  $$('#mRoot [data-sd]').forEach((b) => b.addEventListener('click', async () => {
    await api('/api/snippets/' + b.dataset.sd, { method: 'DELETE' });
    toast('Snippet deleted', 'ok'); loadSnippets(); closeModal(); renderSnippetModal();
  }));
  $('#snipSave').addEventListener('click', async () => {
    const name = $('#snipName').value.trim(), body = $('#snipBody').value;
    if (!name || !body.trim()) return toast('Name and text are required', 'err');
    const r = await api('/api/snippets', { method: 'POST', body: { name, body } });
    if (!r.ok) return toast((r.error || 'Could not save'), 'err');
    toast('Snippet saved', 'ok'); loadSnippets(); closeModal(); renderSnippetModal();
  });
}
$('#snippetManage').addEventListener('click', renderSnippetModal);
/* 5I (I4): composer → announcement card (PNG/SVG download, nothing attached) */
$('#composeCardBtn').addEventListener('click', () => {
  const t = $('#composeText').value.trim();
  if (!t) return toast('Write the card text first', 'err');
  openCardModal({ body: t, source_name: '' });
});
$('#snippetInsert').addEventListener('click', () => {
  const id = $('#snippetPick').value;
  if (!id) return toast('Pick a snippet first');
  const s = __snipCache.find((x) => x.id === Number(id));
  if (!s) return toast('Snippet not found', 'err');
  const ph = [...new Set([...String(s.body).matchAll(/\{(\w+)\}/g)].map((m) => m[1]))];
  const el = $('#composeText');
  if (!ph.length) { el.value += (el.value && !el.value.endsWith('\n') ? '\n' : '') + s.body; composeRefresh(); toast('Snippet inserted', 'ok'); return; }
  const fields = ph.map((p) => `<div class="field"><label>{${esc(p)}}</label><input class="in snip-ph" data-ph="${esc(p)}" placeholder="Value for {${esc(p)}}"></div>`).join('');
  openModal({ title: 'Fill the placeholders', html: fields + '<div class="row-actions" style="margin-top:12px"><button class="btn btn-p" id="snipPhOk">Insert snippet</button></div>' });
  $('#snipPhOk').addEventListener('click', () => {
    let t = s.body;
    let missing = null;
    for (const p of ph) {
      const v = ($$('#mRoot .snip-ph').find((i) => i.dataset.ph === p) || {}).value || '';
      if (!v.trim()) { missing = p; break; }
      t = t.split('{' + p + '}').join(v.trim());
    }
    if (missing) return toast('Fill {' + missing + '} first', 'err');
    closeModal();
    el.value += (el.value && !el.value.endsWith('\n') ? '\n' : '') + t;
    composeRefresh(); toast('Snippet inserted', 'ok');
  });
});

/* R49: image upload (client-side base64, 5 MB cap) */
$('#composeUpload').addEventListener('change', (e) => {
  const f = e.target.files && e.target.files[0];
  if (!f) return;
  if (f.size > 5 * 1024 * 1024) { toast('Image is larger than 5 MB', 'err'); e.target.value = ''; return; }
  const r = new FileReader();
  r.onload = () => {
    composeUpload = { b64: String(r.result).split(',')[1] || '', mime: f.type || 'image/jpeg' };
    $('#composeUploadClear').hidden = false;
    toast('Photo attached — it goes with this post', 'ok');
  };
  r.readAsDataURL(f);
  e.target.value = '';
});
$('#composeUploadClear').addEventListener('click', () => { composeUpload = null; $('#composeUploadClear').hidden = true; });

/* R52: test send to your own number */
$('#composeTestSend').addEventListener('click', async () => {
  const text = $('#composeText').value.trim();
  if (!text) return toast('Write a post first');
  const btn = $('#composeTestSend');
  btn.classList.add('is-loading');
  try {
    await api('/api/compose/test-send', { method: 'POST', body: { phone: $('#composeTestPhone').value, text } });
    toast('Test sent to your number — open WhatsApp to check the formatting', 'ok');
  } catch (e) { toast(e.message, 'err'); }
  btn.classList.remove('is-loading');
});

/* R49: drafts */
async function renderDrafts() {
  try {
    const d = await api('/api/drafts');
    const box = $('#draftList');
    if (!(d.list || []).length) { box.innerHTML = '<div class="muted tiny">No drafts yet — write something and press "Save current text as draft".</div>'; return; }
    box.innerHTML = (d.list || []).map((x) => `<div class="draft-row"><span class="dname">${esc(x.name)}</span><span class="dmeta">${esc(String(x.text || '').slice(0, 60).replace(/\n/g, ' ')) || '(empty)'} · ${esc(String(x.updated_at || '').slice(0, 16).replace('T', ' '))}</span><button class="btn btn-sm btn-g" data-dl="${x.id}">Load</button><button class="btn btn-sm btn-g" data-dd="${x.id}">Delete</button></div>`).join('');
    $$('#draftList [data-dl]').forEach((b) => b.addEventListener('click', async () => {
      const d2 = await api('/api/drafts');
      const x = (d2.list || []).find((y) => y.id === Number(b.dataset.dl));
      if (x) { $('#composeText').value = x.text || ''; composeRefresh(); toast('Draft loaded — saving a new draft won\'t overwrite this one', 'ok'); }
    }));
    $$('#draftList [data-dd]').forEach((b) => b.addEventListener('click', async () => {
      await api('/api/drafts/' + b.dataset.dd, { method: 'DELETE' });
      renderDrafts(); toast('Draft deleted', 'ok');
    }));
  } catch (e) { /* non-fatal */ }
}
$('#draftSave').addEventListener('click', () => {
  const text = $('#composeText').value.trim();
  if (!text) return toast('Nothing to save yet');
  openModal({ title: 'Save draft', html: '<div class="field"><label>Draft name</label><input class="in" id="draftName" placeholder="e.g. Friday offer draft"></div><div class="row-actions" style="margin-top:12px"><button class="btn btn-p" id="draftNameOk">Save draft</button></div>' });
  $('#draftNameOk').addEventListener('click', async () => {
    const name = $('#draftName').value.trim() || 'Untitled draft';
    await api('/api/drafts', { method: 'POST', body: { name, text } });
    closeModal(); toast('Draft saved', 'ok'); renderDrafts();
  });
});

loaders.newpost = async () => {
  if (!pickers.compose) {
    pickers.compose = mountPicker($('#composePicker'), {
      kind: 'targets', mode: 'multi', listFrom: 'targets', preselect: 'all', showChecked: 'all',
      placeholder: 'All active targets (untick to narrow)',
      onPick: async () => { pickers.compose.refresh(); } // composer applies on publish, not on pick
    });
  }
  refreshPicker('compose');
  composeRefresh();
  loadSnippets();
  renderDrafts();
  loadLibPrompts(); // 5C (R55)
};
/* 5C (R55): prompt library in the composer */
async function loadLibPrompts() {
  try {
    const d = await api('/api/prompts');
    const sel = $('#libPromptPick');
    if (!sel) return;
    const cur = sel.value;
    sel.innerHTML = '<option value="">Run a library prompt…</option>' + (d.list || []).map((p) => `<option value="${p.id}">${esc(p.name)}${p.builtin ? '' : ' (yours)'}</option>`).join('');
    if (cur) sel.value = cur;
  } catch (e) { /* non-fatal */ }
}
$('#libPromptGo').addEventListener('click', async () => {
  const text = $('#composeText').value.trim();
  if (!text) return toast('Write some text first');
  const pid = Number($('#libPromptPick').value) || 0;
  if (!pid) return toast('Pick a library prompt first');
  const btn = $('#libPromptGo');
  btn.classList.add('is-loading');
  try {
    const r = await api('/api/compose/ai', { method: 'POST', body: { promptId: pid, text } });
    composeUndo = $('#composeText').value;
    $('#composeText').value = r.text;
    composeRefresh();
    const name = $('#libPromptPick').options[$('#libPromptPick').selectedIndex].textContent;
    toast(`Prompt “${name}” applied — review it before publishing`, 'ok', { label: 'Undo', fn: () => { if (composeUndo != null) { $('#composeText').value = composeUndo; composeUndo = null; composeRefresh(); } } });
  } catch (e) { toast(e.message, 'err'); }
  btn.classList.remove('is-loading');
});
$('#composeSend').addEventListener('click', async () => {
  const text = $('#composeText').value.trim();
  const imageUrl = $('#composeImage').value.trim();
  if (!text && !imageUrl && !composeUpload) return toast('Write a post, add an image URL or upload a photo');
  /* targets: what is ticked in the picker (incl. pre-checked existing targets);
     nothing ticked = all active */
  let targets = [];
  try {
    const tg = await api('/api/targets');
    const active = (tg.list || []).filter((t) => !t.paused).map((t) => t.jid);
    const picked = pickers.compose ? pickers.compose.selected(true) : null;
    targets = (picked && picked.length) ? picked : active;
  } catch (e) { targets = []; }
  const btn = $('#composeSend');
  btn.classList.add('is-loading');
  $('#composeResult').textContent = 'Publishing…';
  try {
    const r = await api('/api/compose', { method: 'POST', body: { text, imageUrl, beautify: $('#composeBeautify').checked, targets, imageB64: composeUpload ? composeUpload.b64 : '', imageMime: composeUpload ? composeUpload.mime : '' } });
    $('#composeResult').textContent = `Published to ${r.sent} target(s)`;
    toast('Post published', 'ok');
    $('#composeText').value = ''; $('#composeImage').value = ''; composeUpload = null; $('#composeUploadClear').hidden = true; composeRefresh();
  } catch (e) { $('#composeResult').textContent = ''; toast(e.message, 'err'); }
  btn.classList.remove('is-loading');
});

/* ── 15 · POSTS ─────────────────────────────────────────────────── */
let __postsCache = [];   // 5B: loaded list, filters re-render client-side
const postsRowHtml = (p, canEdit) => {
  /* 5A: cross-source "via" credits + split-part badge */
  const via = String(p.via || '');
  const viaChips = via ? via.split('|').map((v) => v.split('~').slice(1).join('~')).filter(Boolean).slice(0, 3).map((v) => ` <span class="b b-info" title="Also credited from another source">via ${esc(v)}</span>`).join('') : '';
  const split = Number(p.part) > 0 ? ` <span class="b" title="Auto-split into ${Number(p.part) + 1} numbered parts">split ×${Number(p.part) + 1}</span>` : '';
  /* 5B (R53): row actions — retry failed · edit-republish · copy · reuse in composer */
  const acts = [];
  if (p.status === 'failed') acts.push(`<button class="btn btn-sm" data-act="retry" title="Re-feed this post through the pipeline (works again when the original post is still on the source channel)">Retry</button>`);
  if (String(p.body || '').trim() && (p.status === 'published' || p.status === 'edited' || p.status === 'failed')) acts.push(`<button class="btn btn-sm" data-act="republish" title="Change the text, then publish it again to the targets this source is routed to right now">Edit &amp; republish</button>`);
  if (String(p.body || '').trim()) acts.push(`<button class="btn btn-sm" data-act="copy" title="Copy the post text to your clipboard">Copy</button>`);
  if (String(p.body || '').trim() && p.status !== 'queued' && p.status !== 'pending') acts.push(`<button class="btn btn-sm" data-act="reuse" title="Open this text in the Composer">Reuse</button>`);
  if (canEdit && (p.status === 'published' || p.status === 'edited') && (p.keys || []).length) acts.push(`<button class="btn btn-sm" data-act="edit" title="Edit the post as it appears on the channel (experimental)">Channel edit</button>`);
  /* 5I (I9): quick-action cluster — the ⋯ menu consolidates ALL of the above
     (plus resend / undo / card) into one place; the plain buttons stay. */
  acts.push(`<button class="btn btn-sm btn-g qa-btn" data-act="qa" title="More actions (resend, undo, card…)">⋯</button>`);
  return `
    <tr data-pid="${p.id}" data-sjid="${esc(p.source_jid)}" data-smid="${esc(p.source_msg_id)}" class="rowqa">
      <td><input type="checkbox" class="post-sel" data-targets="${esc((p.keys || []).map((k) => k.target_jid + '|' + k.msg_id).join(','))}" aria-label="Select post"></td>
      <td class="tiny num">${when(p.created_at)}</td>
      <td class="muted tiny">${p.source_name ? esc(p.source_name) : shortJid(p.source_jid)}${viaChips}${split}</td>
      <td><span class="b ${p.status === 'published' ? 'b-ok' : p.status === 'skipped' ? 'b-warn' : p.status === 'failed' ? 'b-err' : 'b-info'}">${esc(p.status)}</span>${p.pub_ms ? `<div class="muted tiny" title="Source publish → bot publish">+${Math.round(p.pub_ms / 1000)} s</div>` : ''}</td>
      <td class="muted tiny">${esc((p.reason || '').slice(0, 90))}</td>
      <td><div class="ra prow-acts">${acts.join('')}</div><div class="qa-menu" data-qamenu></div></td>
    </tr>`;
};
/* 5I (I9/I10/I4): the shared action handler for row buttons AND the ⋯ menu. */
async function handlePostAct(p, act, b) {
  if (act === 'qa') {
    openQuickMenu(p, b);
    return;
  }
  if (act === 'resend') {
    openModal({
      title: 'Resend this post?',
      danger: true,
      html: `<div class="muted tiny" style="margin-bottom:8px">Publishes the stored text of this post <b>again</b> to the targets the source is routed to right now. The rate guard is checked first — if the channel is near its hourly limit, the resend is refused and nothing is sent.</div>
        <div class="in" style="width:auto;background:var(--card2);padding:10px 12px;font-size:12.5px;white-space:pre-wrap;max-height:220px;overflow:auto">${esc(String(p.body || '').slice(0, 900))}</div>`,
      primaryLabel: 'Resend now',
      primary: async () => {
        try {
          const r = await api('/api/posts/resend', { method: 'POST', body: { id: p.id } });
          if (r.ok) { toast(`Resent to ${r.sent} target(s)${r.failed ? ', ' + r.failed + ' failed' : ''}`, r.failed ? '' : 'ok'); loaders.posts(); }
        } catch (e) { toast(e.message, 'err'); return false; }
      }
    });
    return;
  }
  if (act === 'card') {
    openCardModal(p);
    return;
  }
  if (act === 'undo-row') {
    const target = b.dataset.target;
    openModal({
      title: 'Undo on this target?',
      danger: true,
      html: `<div class="muted tiny">Deletes <b>this exact post</b> from <b>${esc(target)}</b>. It only works because it is the most recent post there — if anything newer landed, this button refuses instead of guessing.</div>`,
      primaryLabel: 'Delete from channel',
      primary: async () => {
        try {
          const r = await api('/api/posts/undo-row', { method: 'POST', body: { id: p.id, target } });
          if (r.ok) { toast('Post deleted from the channel', 'ok'); loaders.posts(); }
        } catch (e) { toast(e.message, 'err'); return false; }
      }
    });
    return;
  }
  if (act === 'retry') {
        b.classList.add('is-loading');
        api('/api/posts/retry-one', { method: 'POST', body: { id: p.id } })
          .then((r) => { if (r.ok) { toast('Re-fed through the pipeline — watch the Approvals/Live Queue', 'ok'); } })
          .catch((e) => toast(e.message, 'err'))
          .finally(() => b.classList.remove('is-loading'));
      } else if (act === 'copy') {
        const txt = String(p.body || '');
        const done = () => toast('Copied to clipboard', 'ok');
        if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(txt).then(done).catch(() => { const ta = document.createElement('textarea'); ta.value = txt; document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); done(); } catch (e) { toast('Copy failed — select and copy manually', 'err'); } ta.remove(); });
        else { const ta = document.createElement('textarea'); ta.value = txt; document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); done(); } catch (e) { toast('Copy failed', 'err'); } ta.remove(); }
      } else if (act === 'reuse') {
        $('#composeText').value = String(p.body || '');
        composeRefresh();
        show('newpost');
        toast('Text loaded into the Composer — tweak and publish', 'ok');
      } else if (act === 'edit') {
        return; /* handled by the table-level delegated handler (channel edit) */
      } else if (act === 'republish') {
        openModal({
          title: 'Edit & republish',
          html: `<div class="muted tiny" style="margin-bottom:8px">Publish this text again to the targets this source is routed to right now. The original post stays where it is.</div>
            <div class="field"><textarea class="in" id="repText" rows="8">${esc(String(p.body || ''))}</textarea></div>`
        });
        $('#repText').addEventListener('keydown', (ev) => { if ((ev.metaKey || ev.ctrlKey) && ev.key === 'Enter') $('#repGo').click(); });
        const go = () => {
          const t = $('#repText').value.trim();
          if (!t) return toast('Nothing to publish', 'err');
          go.disabled = true;
          api('/api/posts/edit-republish', { method: 'POST', body: { id: p.id, text: t } })
            .then((r) => { if (r.ok) { closeModal(); toast(`Republished to ${r.sent} target(s)${r.failed ? ', ' + r.failed + ' failed' : ''}`, r.failed ? '' : 'ok'); loaders.posts(); } })
            .catch((e) => { go.disabled = false; toast(e.message, 'err'); });
        };
        const goBtn = document.createElement('button');
        goBtn.className = 'btn btn-p'; goBtn.id = 'repGo'; goBtn.textContent = 'Publish again';
        const foot = $('#mRoot .mb-f'); if (foot) foot.appendChild(goBtn);
        goBtn.addEventListener('click', go);
      } else if (act === 'edit') {
        const key = (p.keys || [])[0];
        if (!key) return toast('No published message id stored', 'err');
        openModal({
          title: 'Channel edit',
          html: `<div class="muted tiny" style="margin-bottom:8px">Edits the post as it appears on ${esc(p.source_name || 'the channel')}. Experimental — check the channel afterwards.</div>
            <div class="field"><textarea class="in" id="edText" rows="8">${esc(String(p.body || ''))}</textarea></div>`
        });
        $('#edText').addEventListener('keydown', (ev) => { if ((ev.metaKey || ev.ctrlKey) && ev.key === 'Enter') $('#edGo').click(); });
        const go = () => {
          const t = $('#edText').value;
          if (!t.trim()) return toast('Text cannot be empty', 'err');
          go.disabled = true;
          api('/api/posts/edit', { method: 'POST', body: { id: p.id, target: key.target_jid, msg_id: key.msg_id, text: t } })
            .then((r) => { if (r.ok) { closeModal(); toast('Channel post edited', 'ok'); loaders.posts(); } })
            .catch((e) => { go.disabled = false; toast(e.message, 'err'); });
        };
        const goBtn = document.createElement('button');
        goBtn.className = 'btn btn-p'; goBtn.id = 'edGo'; goBtn.textContent = 'Apply edit';
        const foot = $('#mRoot .mb-f'); if (foot) foot.appendChild(goBtn);
        goBtn.addEventListener('click', go);
      }
}
const postsWireActions = (canEdit) => {
  $$('#postsTable tbody tr').forEach((tr) => {
    const p = __postsCache.find((x) => String(x.id) === tr.dataset.pid);
    if (!p) return;
    tr.querySelectorAll('[data-act]').forEach((b) => b.addEventListener('click', () => { handlePostAct(p, b.dataset.act, b); }));
  });
};
/* 5I (I9): the ⋯ quick-action menu — consolidates every row action in one place. */
function openQuickMenu(p, btn) {
  const tr = btn.closest('tr');
  const menu = tr && tr.querySelector('[data-qamenu]');
  if (!menu) return;
  const wasOpen = menu.classList.contains('open');
  $$('#postsTable [data-qamenu].open').forEach((m) => { m.classList.remove('open'); m.innerHTML = ''; });
  if (wasOpen) return;
  const items = [];
  const push = (act, label, title, danger, data) => items.push(`<button class="qa-item${danger ? ' danger' : ''}" data-act="${act}"${data ? ` data-target="${esc(data)}"` : ''} title="${esc(title)}">${esc(label)}</button>`);
  if (String(p.body || '').trim()) push('copy', 'Copy text', 'Copy the post text to your clipboard');
  if (p.status === 'failed') push('retry', 'Retry', 'Re-feed this post through the pipeline');
  if (String(p.body || '').trim() && (p.status === 'published' || p.status === 'edited' || p.status === 'failed')) push('republish', 'Edit & republish', 'Change the text, then publish it again');
  if (String(p.body || '').trim() && (p.status === 'published' || p.status === 'edited')) push('resend', 'Resend (rate guard + confirm)', 'Publish the stored text again — the rate guard decides first');
  if (String(p.body || '').trim() && p.status !== 'queued' && p.status !== 'pending') push('reuse', 'Reuse in Composer', 'Open this text in the Composer');
  if (p.status === 'published' || p.status === 'edited') {
    const targets = [...new Set((p.keys || []).map((k) => k.target_jid))].slice(0, 4);
    for (const t of targets) push('undo-row', 'Undo on ' + (chanName({ jid: t, name: '' }) || shortJid(t)), 'Delete this post from that channel (only allowed while it is the latest there)', true, t);
    if (targets.length > 4) items.push(`<div class="muted tiny" style="padding:4px 9px">+${targets.length - 4} more targets — use the global Undo card</div>`);
  }
  if (String(p.body || '').trim()) push('card', 'Make announcement card', 'Render a branded 1080×1080 PNG card from this post (Settings · Power: Announcement cards)');
  if (p.status === 'failed') push('dismiss', 'Dismiss', 'Hide this failed row from the list');
  menu.innerHTML = items.join('');
  menu.classList.add('open');
  menu.querySelectorAll('[data-act]').forEach((b) => {
    b.addEventListener('click', (ev) => {
      ev.stopPropagation();
      const act = b.dataset.act;
      menu.classList.remove('open'); menu.innerHTML = '';
      if (act === 'dismiss') {
        api('/api/posts/dismiss-failed', { method: 'POST', body: { id: p.id } }).then(() => { toast('Dismissed', 'ok'); loaders.posts(); }).catch((e) => toast(e.message, 'err'));
        return;
      }
      handlePostAct(p, act, b);
    });
  });
  setTimeout(() => { const close = (ev) => { if (!menu.contains(ev.target)) { menu.classList.remove('open'); menu.innerHTML = ''; document.removeEventListener('click', close, true); } }; document.addEventListener('click', close, true); }, 0);
}
const postsApplyFilters = () => {
  const st = $('#pfStatus').value;
  const sj = $('#pfSource').value;
  const q = ((($('#pfText') || {}).value || '').trim().toLowerCase()); // 5D (R67)
  const canEdit = (__postsCache[0] || {}).canEdit;
  const rows = __postsCache.filter((p) => (!st || p.status === st) && (!sj || p.source_jid === sj)
    && (!q || String(p.body || '').toLowerCase().includes(q) || String(p.reason || '').toLowerCase().includes(q)));
  $('#postsTable tbody').innerHTML = rows.map((p) => postsRowHtml(p, canEdit)).join('')
    || `<tr><td colspan="6">${rows.length === 0 && __postsCache.length ? '<div class="muted tiny">No posts match the current filters.</div>' : '<div class="muted tiny">No posts yet — published posts land here automatically.</div>'}</td></tr>`;
  const cnt = $('#pfCount');
  if (cnt) cnt.textContent = (st || sj || q) ? rows.length + ' of ' + __postsCache.length + ' shown' : '';
  postsWireActions(canEdit);
};
loaders.posts = async () => {
  ensureSwitches();
  $('#postsTable tbody').innerHTML = skelRows(5, 6);
  const d = await api('/api/posts?limit=100');
  __postsCache = d.list || [];
  const canEdit = (__postsCache[0] || {}).canEdit;
  $('#editpostsNote').textContent = canEdit
    ? 'Select posts to delete them, or use the row actions (retry, edit & republish, copy, reuse, channel edit). Purge by date is below. (experimental — always check the channel after big deletions)'
    : 'Channel editing needs the Edit posts switch — it is experimental. Row actions (retry / copy / reuse) always work.';
  /* 5B (R53): source filter options */
  const pf = $('#pfSource');
  const cur = pf.value;
  const srcs = [...new Map(__postsCache.map((p) => [p.source_jid, p.source_name || shortJid(p.source_jid)])).entries()];
  pf.innerHTML = '<option value="">All sources</option>' + srcs.map(([jid, name]) => `<option value="${esc(jid)}">${esc(name)}</option>`).join('');
  if (cur) pf.value = cur;
  postsApplyFilters();
  const tg = await api('/api/targets');
  fillPurgeTarget(tg.list || []);
  fillUndoTarget(tg.list || []); // 5A (R48)
  loadEgr(); // 5H (R86)
};
['pfStatus', 'pfSource'].forEach((id) => $('#' + id).addEventListener('change', postsApplyFilters));
$('#pfText').addEventListener('input', postsApplyFilters); // 5D (R67)
/* 5A (R48): undo the last published post on one target */
function fillUndoTarget(list) {
  const sel = $('#undoTarget');
  if (!sel) return;
  const cur = sel.value;
  sel.innerHTML = '<option value="">— target channel —</option>' + (list || []).map((t) => `<option value="${esc(t.jid)}">${esc(t.name || shortJid(t.jid))}</option>`).join('');
  if (cur) sel.value = cur;
}
$('#undoBtn').addEventListener('click', async () => {
  const sel = $('#undoTarget');
  if (!sel.value) return toast('Pick the target channel first', '');
  const name = sel.options[sel.selectedIndex].textContent;
  const ok = await confirmModal(`Delete the LAST post on ${name}?`, 'Only the most recent bot-published post on that target is deleted. Nothing else is touched.', 'Delete last post', true);
  if (!ok) return;
  try {
    await api('/api/undo-last', { method: 'POST', body: { target_jid: sel.value } });
    toast('Done — the last post is deleted from ' + name, 'ok');
  } catch (e) { toast(e.message, 'err'); }
});
function fillPurgeTarget(list) {
  const sel = $('#purgeTarget');
  const cur = sel.value;
  sel.innerHTML = '<option value="">— target channel —</option>' + (list || []).map((t) => `<option value="${esc(t.jid)}">${esc(t.name || shortJid(t.jid))}</option>`).join('');
  if (cur) sel.value = cur;
}
$('#postsRefresh').addEventListener('click', () => loaders.posts());
$('#postsTable').addEventListener('click', async (ev) => {
  const btn = ev.target.closest('button[data-act="edit"]');
  if (!btn) return;
  const tr = btn.closest('tr');
  /* 5B: pre-fill from the stored post body (the Detail column only holds a 90-char reason) */
  const pp = __postsCache.find((x) => String(x.id) === tr.dataset.pid);
  const current = pp && String(pp.body || '').trim() ? String(pp.body) : (tr.children[4].textContent || '');
  const m = openModal({
    title: 'Edit published post', icon: ico('pencil'),
    html: `<p class="muted tiny">The new text replaces the post on every target it was sent to (experimental — the WhatsApp edit may expire for very old posts).</p>
      <div class="field" style="margin-top:12px"><textarea class="in" id="postEditText" rows="6"></textarea></div>`,
    primaryLabel: 'Edit post',
    primary: () => {
      const text = $('#postEditText').value;
      api('/api/posts/edit', { method: 'POST', body: { sourceJid: tr.dataset.sjid, sourceMsgId: tr.dataset.smid, text } })
        .then((r) => toast(r.ok ? `Edited on ${r.ok} target(s)` : 'Edit failed', r.ok ? 'ok' : 'err'))
        .catch((e) => toast(e.message, 'err'));
      return false;
    }
  });
  setTimeout(() => { const ta = m.querySelector('#postEditText'); ta.value = current; ta.focus(); }, 40);
});
$('#postsDelete').addEventListener('click', async () => {
  const sels = $$('.post-sel:checked');
  if (!sels.length) return toast('Select posts first (checkboxes)');
  const ok = await confirmModal(`Delete ${sels.length} published post(s)?`, 'They will be deleted from the target channel(s). This cannot be undone.', 'Delete', true);
  if (!ok) return;
  const items = [];
  sels.forEach((s) => String(s.dataset.targets || '').split(',').filter(Boolean).forEach((pair) => { const [target, msgId] = pair.split('|'); if (target && msgId) items.push({ target, msgId }); }));
  try { const r = await api('/api/posts/delete', { method: 'POST', body: { items } }); toast(r.note || 'Deleted', 'ok'); loaders.posts(); }
  catch (e) { toast(e.message, 'err'); }
});
$('#purgeBtn').addEventListener('click', async () => {
  const jid = $('#purgeTarget').value;
  if (!jid) return toast('Pick a target channel');
  const tName = ($('#purgeTarget option:checked') || {}).textContent || '';
  const ok = await confirmModal(`Delete ALL bot posts in “${tName}” for that date range?`, 'Every matching published post is deleted. This cannot be undone.', 'Delete range', true);
  if (!ok) return;
  try {
    const r = await api('/api/posts/purge', { method: 'POST', body: { jid, from: $('#purgeFrom').value, to: $('#purgeTo').value } });
    $('#purgeResult').textContent = `${r.note} (attempted ${r.attempted}, deleted ${r.deleted})`;
  } catch (e) { toast(e.message, 'err'); }
});

/* ── 16 · ANALYTICS ─────────────────────────────────────────────── */
/* 5D (R61): inline-SVG helpers — no chart libraries (R6) */
function sparkSvg(vals, w = 84, h = 22) {
  const max = Math.max(1, ...vals);
  const pts = vals.map((v, i) => `${(i / Math.max(1, vals.length - 1)) * (w - 4) + 2},${h - 3 - (v / max) * (h - 6)}`).join(' ');
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" aria-hidden="true"><polyline points="${pts}" fill="none" stroke="var(--ok)" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"/></svg>`;
}
function heatSvg(heat) {
  /* 7 rows (days, old→new top→bottom) × 24 cols (00→23) */
  const cell = 13, gap = 2, left = 34, top = 16;
  const W = left + 24 * (cell + gap), H = top + 7 * (cell + gap) + 4;
  const max = Math.max(1, ...heat.map((c) => Math.max(...c.hours)));
  const dows = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  let rects = '', labels = '';
  heat.forEach((row, r) => {
    const day = new Date(row.day + 'T12:00:00Z');
    labels += `<text x="${left - 6}" y="${top + r * (cell + gap) + cell - 3}" text-anchor="end" font-size="9" fill="var(--muted)">${dows[(day.getUTCDay() + 6) % 7]}</text>`;
    for (let hr = 0; hr < 24; hr++) {
      const v = row.hours[hr] || 0;
      const op = v ? 0.25 + 0.75 * (v / max) : 0.06;
      rects += `<rect x="${left + hr * (cell + gap)}" y="${top + r * (cell + gap)}" width="${cell}" height="${cell}" rx="2.5" fill="var(--ok)" opacity="${op}" ${v ? `data-tip="${row.day} ${String(hr).padStart(2, '0')}:00 — ${v} post(s)"` : ''}></rect>`;
    }
  });
  let ticks = '';
  for (let hr = 0; hr < 24; hr += 6) ticks += `<text x="${left + hr * (cell + gap) + cell / 2}" y="${top - 5}" text-anchor="middle" font-size="9" fill="var(--muted)">${String(hr).padStart(2, '0')}</text>`;
  return `<svg class="heat-svg" viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Hourly activity, last 7 days">${ticks}${rects}${labels}</svg>`;
}
function normReason(r) { return String(r || '').split(':')[0].split('(')[0].trim() || 'other'; }

loaders.analytics = async () => {
  ensureSwitches();
  const days = $('#anDays').value || '14';
  $('#anSources tbody').innerHTML = skelRows(3, 2);
  const d = await api('/api/analytics?days=' + days);
  const t = d.totals || {};
  $('#anKpis').innerHTML = [kpi('Published', t.published || 0, 'in range', 'ok'), kpi('Skipped', t.skipped || 0, 'polls / dupes / filters', 'warn'), kpi('Failed', t.failed || 0, t.failed ? 'see Logs' : 'all clean', t.failed ? 'err' : 'ok'), kpi('Edited', t.edited || 0, 'edited posts')].join('');
  const max = Math.max(1, ...(d.days || []).map((x) => x.published + x.skipped + x.failed));
  $('#anChart').innerHTML = (d.days || []).map((x) => {
    const tot = x.published + x.skipped + x.failed;
    const h = Math.round((tot / max) * 150);
    const segs = [`<div class="bar-seg fai" style="height:${Math.round((x.failed / Math.max(tot, 1)) * h)}px"></div>`,
    `<div class="bar-seg ski" style="height:${Math.round((x.skipped / Math.max(tot, 1)) * h)}px"></div>`,
    `<div class="bar-seg pub" style="height:${Math.round((x.published / Math.max(tot, 1)) * h)}px"></div>`].join('');
    return `<div class="bar-col" title="${x.day}: ${x.published} published, ${x.skipped} skipped, ${x.failed} failed">
      <span class="bar-val num">${tot || ''}</span>
      <div class="bar-stack" style="height:${h}px">${segs}</div>
      <span class="bar-label">${x.day.slice(5)}</span></div>`;
  }).join('');
  /* 5D: hourly heatmap (inline SVG) */
  $('#anHeat').innerHTML = (d.heatmap || []).length ? heatSvg(d.heatmap) : '<span class="muted tiny">No posts in the last 7 days yet.</span>';
  /* 5D: per-target table */
  $('#anTargets tbody').innerHTML = (d.perTarget || []).map((s) =>
    `<tr><td>${esc((window.__dirNames && window.__dirNames[s.target_jid]) || shortJid(s.target_jid))}</td><td class="num"><b>${s.pub || 0}</b></td><td class="num">${s.edited || 0}</td><td class="num">${s.failed || 0}</td></tr>`).join('')
    || '<tr><td colspan="4" class="muted">Nothing landed in this range.</td></tr>';
  /* 5D: media vs text + skip reasons */
  const m = d.media || { withMedia: 0, text: 0 };
  $('#anMedia').innerHTML = kpi('Media posts', m.withMedia || 0, 'with an image / video / doc', 'accent') + kpi('Text posts', m.text || 0, 'plain text', '');
  const reasons = {};
  for (const r of (d.skipReasons || [])) reasons[normReason(r.reason)] = (reasons[normReason(r.reason)] || 0) + r.n;
  const rEntries = Object.entries(reasons).sort((a, b) => b[1] - a[1]);
  const rMax = Math.max(1, ...rEntries.map((e) => e[1]));
  $('#anReasons').innerHTML = rEntries.length
    ? rEntries.map(([r, n]) => `<div class="reason-row" title="${esc(r)}: ${n}"><span class="reason-name">${esc(r)}</span><span class="reason-bar"><span style="width:${Math.round((n / rMax) * 100)}%"></span></span><span class="num tiny">${n}</span></div>`).join('')
    : '<span class="muted tiny">Nothing was skipped in this range.</span>';
  /* 5D: leaderboard (sourcesFull + per-source 7-day spark + goal hit-rate) */
  const board = (d.sourcesFull || []).map((s) => ({ ...s, name: (window.__dirNames && window.__dirNames[s.source_jid]) || shortJid(s.source_jid) }));
  const totPub = board.reduce((a, b) => a + (b.pub || 0), 0) || 1;
  const heat7 = (d.heatmap || []).map((c) => c.day); // last 7 PKT days, old → new
  const sparkFor = (jid) => heat7.map((day) => ((d.dayBySource || {})[jid] || {})[day] || 0);
  let goals = { list: [] };
  try { goals = await api('/api/goals'); } catch (e) {}
  const goalMap = Object.fromEntries((goals.list || []).map((g) => [g.source_jid, g]));
  $('#anBoard tbody').innerHTML = board.map((s, i) => {
    const g = goalMap[s.source_jid];
    const goalCell = g ? `${g.today}/${g.daily_n} today` : '<span class="muted">—</span>';
    return `<tr>
      <td class="num muted">${i + 1}</td>
      <td><b>${esc(s.name)}</b></td>
      <td class="num"><b>${s.pub || 0}</b></td>
      <td class="share-cell"><span class="share-bar"><span style="width:${Math.round(((s.pub || 0) / totPub) * 100)}%"></span></span><span class="tiny muted">${Math.round(((s.pub || 0) / totPub) * 100)}%</span></td>
      <td class="num">${s.media || 0}</td>
      <td class="num">${s.failed || 0}</td>
      <td>${sparkSvg(sparkFor(s.source_jid))}</td>
      <td class="num tiny">${goalCell}</td>
    </tr>`;
  }).join('') || '<tr><td colspan="8" class="muted">Nothing published in this range.</td></tr>';
  /* 5D: goals */
  if (goals.global) {
    $('#goalGlobal').value = goals.global.daily || '';
    $('#goalGlobalNow').textContent = `today: ${goals.global.today}${goals.global.daily ? ' / ' + goals.global.daily : ''}`;
  }
  const allSources = await api('/api/sources').catch(() => ({ list: [] }));
  const goalRows = (goals.list || []).map((g) => {
    const name = (window.__dirNames && window.__dirNames[g.source_jid]) || (allSources.list || []).find((s) => s.jid === g.source_jid)?.name || shortJid(g.source_jid);
    const met = g.daily_n > 0 && g.today >= g.daily_n;
    return `<tr data-gjid="${esc(g.source_jid)}"><td>${esc(name)}</td>
      <td class="num"><input class="in num g-n" type="number" min="0" max="999" value="${g.daily_n}" style="width:64px;height:26px;font-size:var(--t13)"></td>
      <td class="num"><b>${g.today}</b> ${met ? '<span class="b b-ok">met</span>' : ''}</td>
      <td><button class="btn btn-sm btn-g g-del" title="Remove goal">Remove</button></td></tr>`;
  });
  const suggest = (allSources.list || []).filter((s) => !goalMap[s.jid]).slice(0, 3);
  if (suggest.length) goalRows.push(`<tr class="muted"><td colspan="3">Suggested: ${suggest.map((s) => esc(s.name)).join(', ')}</td><td></td></tr>`);
  $('#anGoals tbody').innerHTML = goalRows.join('') || '<tr><td colspan="4" class="muted">No per-source goals yet — set one from the list above or add sources first.</td></tr>';
  $$('#anGoals .g-n').forEach((inp) => inp.addEventListener('change', async () => {
    try { await api('/api/goals', { method: 'POST', body: { jid: inp.closest('tr').dataset.gjid, n: inp.value } }); loaders.analytics(); } catch (e) { toast(e.message, 'err'); }
  }));
  $$('#anGoals .g-del').forEach((b) => b.addEventListener('click', async () => {
    try { await api('/api/goals/' + encodeURIComponent(b.closest('tr').dataset.gjid), { method: 'DELETE' }); loaders.analytics(); } catch (e) { toast(e.message, 'err'); }
  }));
  /* 5D: weekly card */
  const w = await api('/api/weekly');
  $('#weeklyAt').value = w.at || 'Mon 09:00';
  $('#weeklyLast').textContent = w.lastweek ? `last sent: week of ${w.lastweek}` : 'never sent yet';
  $('#weeklyPreview').textContent = w.phone ? `Goes to +${w.phone} (and your default email, if connected).` : 'No report phone set — Uptime → report phone.';
  let dirNames = window.__dirNames;
  if (!dirNames) { try { const dir = await api('/api/directory'); window.__dirNames = dirNames = Object.fromEntries((dir.list || []).map((c) => [c.jid, c.name])); } catch (e) {} }
  $('#anSources tbody').innerHTML = (d.sources || []).map((s) => {
    const name = (dirNames && dirNames[s.jid]) || shortJid(s.jid);
    return `<tr><td>${esc(name)}</td><td class="num"><b>${s.n}</b></td></tr>`;
  }).join('') || (await emptyTCell('chart', 'Nothing published in this range', 'try a wider range', 2));
};
$('#anDays').addEventListener('change', () => loaders.analytics());
/* 5D (R63): exports download through the session cookie */
$('#anCsv').addEventListener('click', () => { location.href = '/api/analytics/export.csv?days=' + encodeURIComponent($('#anDays').value || '14'); toast('CSV download started', 'ok'); });
$('#anPdf').addEventListener('click', () => { location.href = '/api/analytics/export.pdf?days=' + encodeURIComponent($('#anDays').value || '14'); toast('PDF download started', 'ok'); });
/* 5D (R62): global goal */
$('#goalGlobalSave').addEventListener('click', async () => {
  try {
    const r = await api('/api/goals/global', { method: 'POST', body: { n: $('#goalGlobal').value } });
    toast(r.daily ? `Overall goal: ${r.daily} posts/day` : 'Overall goal cleared', 'ok');
    loaders.analytics();
  } catch (e) { toast(e.message, 'err'); }
});
/* 5D (R63): weekly report */
$('#weeklyAtSave').addEventListener('click', async () => {
  try { const r = await api('/api/weekly/at', { method: 'POST', body: { at: $('#weeklyAt').value } }); toast(`Weekly report: ${r.at} PKT`, 'ok'); loaders.analytics(); }
  catch (e) { toast(e.message, 'err'); }
});
$('#weeklySend').addEventListener('click', async () => {
  try {
    const r = await api('/api/weekly/send', { method: 'POST' });
    toast(r.sent.length ? `Weekly report sent: ${r.sent.join(', ')}` : `Sent nowhere — ${r.emailErr || 'no WhatsApp and no email'}`, r.sent.length ? 'ok' : 'warn');
    loaders.analytics();
  } catch (e) { toast(e.message, 'err'); }
});
/* 5D (R65): instant-alert test */
$('#alertTest').addEventListener('click', async () => {
  try {
    const r = await api('/api/alerts/test', { method: 'POST' });
    $('#alertTestResult').textContent = r.sent ? 'Test alert sent to your number — check WhatsApp.' : 'Not sent: ' + (r.why || 'unknown');
  } catch (e) { $('#alertTestResult').textContent = 'Not sent: ' + e.message; }
});

/* ── 16.5 · 5E (R69–R75): audit · adaptive pacing · panic stop · backup · security · storage ── */
/* R69: audit trail */
loaders.audit = async () => {
  const q = $('#audQ').value, actor = $('#audActor').value;
  $('#audTable tbody').innerHTML = skelRows(6, 4);
  const d = await api('/api/audit?limit=400&q=' + encodeURIComponent(q) + '&actor=' + encodeURIComponent(actor));
  $('#audCount').textContent = d.total + ' entr' + (d.total === 1 ? 'y' : 'ies') + ' (newest 400 shown)';
  $('#audTable tbody').innerHTML = d.list.map((r) =>
    `<tr><td class="tiny num">${when(r.ts)}</td><td><span class="b ${r.actor === 'owner' ? 'b-info' : 'b-ok'}">${esc(r.actor)}</span></td><td class="tiny"><b>${esc(r.action)}</b></td><td class="muted tiny">${esc(r.detail)}</td></tr>`
  ).join('') || '<tr><td colspan="4" class="muted">No audit entries yet.</td></tr>';
};
$('#audQ').addEventListener('input', loaders.audit);
$('#audActor').addEventListener('change', loaders.audit);
$('#audCsv').addEventListener('click', () => { location.href = '/api/audit.csv'; toast('CSV download started', 'ok'); });

/* R74: adaptive-pacing strip on the dashboard (panic shows in the global banner) */
function paintPaceStrip(ov) {
  const el = $('#paceStrip');
  if (!el) return;
  const pace = ov.pace || {};
  if (!pace.active) { el.hidden = true; el.innerHTML = ''; return; }
  el.innerHTML = `<span class="pace-chip" title="${esc(pace.reason || '')}">⏱ Adaptive pacing: waiting ${Math.round((pace.gapMs || 0) / 1000)} s between sends — ${esc(pace.reason || 'failure spike')} (clears itself after 20 quiet minutes)</span>`;
  el.hidden = false;
}

/* R73: panic stop — the red button + the banner on every view */
async function paintPanic() {
  const p = await api('/api/panic').catch(() => null);
  if (!p) return;
  const b = $('#panicBanner');
  b.hidden = !p.on;
  if (p.on && p.since) $('#panicSince').textContent = ' — since ' + when(p.since);
  const btn = $('#panicBtn');
  if (btn) btn.classList.toggle('is-panic', p.on);
  if (window.m2PaintPanicStatus) window.m2PaintPanicStatus(Boolean(p.on));
}
$('#panicBtn').addEventListener('click', () => {
  api('/api/panic').then((p) => {
    if (p.on) {
      openModal({
        title: 'Panic stop is active', icon: ico('shield'), danger: true, primary: true, primaryLabel: 'Restore previous state',
        html: '<p>Everything is paused right now (mirroring, queue, scheduler, auto-replies, reports). Restore the previous state?</p>'
      , primary: () => api('/api/panic/restore', { method: 'POST', body: {} }).then(() => { toast('Panic stop restored — normal operation resumed', 'ok'); paintPanic(); }).catch((e) => { toast(e.message, 'err'); return false; }) });
    } else {
      openModal({
        title: 'Panic stop', icon: ico('shield'), danger: true, primary: true, primaryLabel: 'Pause everything',
        html: '<p>Pause <b>everything</b> at once — mirroring, the approval queue, the scheduler, auto-replies and reports?</p><p>Nothing is lost: in-flight work stays queued, and the previous state (running or paused) is restored exactly when you restore.</p>'
      , primary: () => api('/api/panic/stop', { method: 'POST', body: {} }).then(() => { toast('Panic stop engaged — everything paused', 'warn'); paintPanic(); }).catch((e) => { toast(e.message, 'err'); return false; }) });
    }
  }).catch(() => { });
});
$('#panicRestore').addEventListener('click', () => {
  api('/api/panic/restore', { method: 'POST', body: {} })
    .then(() => { toast('Panic stop restored — normal operation resumed', 'ok'); })
    .catch((e) => toast(e.message, 'err'))
    .finally(() => paintPanic());
});
paintPanic();
setInterval(paintPanic, 30000);

/* R71: read-only session chip (topbar) */
api('/api/session').then((s) => {
  const chip = $('#roChip');
  if (s && s.role === 'readonly' && chip) chip.hidden = false;
}).catch(() => { });

/* R70: backup & restore (Settings) */
$('#bkDownload').addEventListener('click', () => { location.href = '/api/backup/download'; toast('Backup zip download started', 'ok'); });
async function refreshPreRestore() {
  try {
    const d = await api('/api/backup/pre-restore');
    $('#bkPreTable tbody').innerHTML = d.list.map((x) =>
      `<tr><td class="tiny">${esc(x.name)}</td><td class="num tiny">${(x.bytes / 1048576).toFixed(1)} MB</td><td><a class="btn btn-sm btn-g" href="/api/backup/pre-restore/${encodeURIComponent(x.name)}">Download</a></td></tr>`
    ).join('') || '<tr><td colspan="3" class="muted">None yet — a snapshot appears here automatically before every restore.</td></tr>';
  } catch { }
}
$('#bkRestoreFile').addEventListener('change', async (ev) => {
  const f = ev.target.files && ev.target.files[0];
  const msg = $('#bkRestoreMsg');
  ev.target.value = '';
  if (!f) return;
  if (!confirm(`Restore from "${f.name}"?\n\nThe current state is saved automatically as a pre-restore snapshot first, so you can always roll back. Your WhatsApp link and settings are replaced by the backup's.`)) return;
  msg.textContent = 'Restoring…';
  try {
    const buf = await f.arrayBuffer();
    const r = await api('/api/backup/restore', { method: 'POST', headers: { 'Content-Type': 'application/zip' }, body: buf });
    msg.textContent = 'Restored ✓ (snapshot: ' + r.preRestore + ')';
    toast('Backup restored — pre-restore snapshot kept', 'ok');
    refreshPreRestore();
    location.reload();
  } catch (e) { msg.textContent = ''; toast(e.message, 'err'); }
});
refreshPreRestore();

/* R71: security (Settings) */
async function loadSecurity() {
  try {
    const s = await api('/api/security');
    $('#roEnable').checked = s.roEnabled;
    $('#roPass').value = '';
    $('#roPass').placeholder = s.roSet ? 'Read-only password (set — leave empty to keep)' : 'New read-only password (min 6 chars)';
    $('#loginAlerts').checked = s.loginAlerts;
    $('#timeoutMin').value = s.timeoutMin;
  } catch { }
}
loadSecurity();
$('#secSave').addEventListener('click', async () => {
  const body = { ro: $('#roEnable').checked, loginAlerts: $('#loginAlerts').checked, timeoutMin: Number($('#timeoutMin').value) || 120 };
  const p = $('#roPass').value;
  if (p) body.password = p;
  try {
    await api('/api/security', { method: 'POST', body });
    $('#roPass').value = '';
    toast('Security settings saved', 'ok');
    loadSecurity();
  } catch (e) { toast(e.message, 'err'); }
});

/* R72: storage manager (Settings) */
function humanBytes(n) {
  const b = Number(n) || 0;
  if (b >= 1048576) return (b / 1048576 >= 1024 ? (b / 1073741824).toFixed(1) + ' GB' : (b / 1048576).toFixed(1) + ' MB');
  if (b >= 1024) return Math.round(b / 1024) + ' KB';
  return b + ' B';
}
/* v8.3.0 — GitHub repo storage gauge (Settings → Storage): the real size of the
   whole repo on GitHub, i.e. what a full clone would download. */
function renderGhGauge(g) {
  const size = $('#ghGaugeSize'), det = $('#ghGaugeDetail');
  if (!size || !det) return;
  if (!g || !g.configured) {
    size.textContent = '—';
    det.textContent = 'Only available while cloud memory is connected (Heroku Config Vars: PERSIST_GITHUB_REPO + PERSIST_GITHUB_TOKEN).';
    return;
  }
  if (!g.reachable) {
    size.textContent = 'not reachable';
    det.textContent = g.verdict || 'GitHub is not answering right now.';
    return;
  }
  size.textContent = '≈ ' + humanBytes((g.sizeKb || 0) * 1024);
  let det2 = 'repo ' + g.repo + ' · branch “' + g.branch + '”';
  if (g.lastSyncBytes) det2 += ' · last backup ' + humanBytes(g.lastSyncBytes) + (g.lastSyncAt ? ' at ' + when(g.lastSyncAt) : '');
  det.textContent = det2;
}
async function loadStorage(refresh) {
  try {
    const s = await api('/api/storage' + (refresh ? '?refresh=1' : ''));
    const mb = (n) => (n / 1048576).toFixed(1) + ' MB';
    $('#stKpis').innerHTML = [
      kpi('Database', mb(s.db.bytes || 0), (s.rows.posts || 0) + ' posts · ' + (s.rows.logs || 0) + ' log lines'),
      kpi('Media (hold)', mb(s.mediaHold.bytes || 0), s.mediaHold.files + ' file(s)' + (s.mediaHold.oldest ? ' · oldest ' + when(s.mediaHold.oldest) : '')),
      kpi('Avatars', mb(s.avatars.bytes || 0), s.avatars.files + ' file(s)'),
      kpi('Pre-restore snapshots', mb(s.preRestore.bytes || 0), s.preRestore.files + ' kept (last 5)')
    ].join('');
    renderGhGauge(s.github);
    /* v9.0.0 (repo-slim): the "keep the repo small" box */
    if ($('#slimKeepDays')) $('#slimKeepDays').value = s.keepDays || 30;
    if ($('#slimInboxNow')) $('#slimInboxNow').textContent = s.inboxMedia ? (s.inboxMedia.files + ' file(s) · ' + humanBytes(s.inboxMedia.bytes || 0) + ' on disk') : '';
    if (s.cloud && s.cloud.skips) {
      const det = $('#ghGaugeDetail');
      if (det && det.textContent) det.textContent += ' · ' + s.cloud.skips + ' unchanged sync(s) skipped';
    }
  } catch { }
}
loadStorage();
/* v9.0.0 (repo-slim): one-click repo compaction */
$('#slimCompact').addEventListener('click', async () => {
  const b = $('#slimCompact');
  b.disabled = true;
  try {
    const r = await api('/api/persist/compact', { method: 'POST' });
    toast(`Cloud memory compacted: branch now holds one ${r.kb} KB snapshot (was ${r.wasKb} KB). GitHub drops the older copies on its next cleanup — the repo size falls back to ≈ one snapshot.`, 'ok');
    loadStorage(true);
  } catch (e) { toast(e.message, 'err'); }
  finally { b.disabled = false; }
});
/* v9.0.0 (repo-slim): inbox-photo retention */
$('#slimKeepSave').addEventListener('click', async () => {
  const days = Math.max(1, Math.min(365, Number($('#slimKeepDays').value) || 30));
  $('#slimKeepDays').value = days;
  const b = $('#slimKeepSave');
  b.disabled = true;
  try {
    const r = await api('/api/storage/keepdays', { method: 'POST', body: { days } });
    toast(r.detail || 'Saved', 'ok');
    loadStorage();
  } catch (e) { toast(e.message, 'err'); }
  finally { b.disabled = false; }
});
$('#ghGaugeRefresh').addEventListener('click', () => {
  const b = $('#ghGaugeRefresh');
  b.disabled = true;
  loadStorage(true).finally(() => { b.disabled = false; });
});
function cleanup(kind, what) {
  const days = Math.max(1, Math.min(365, Number($('#clDays').value) || 30));
  if (!confirm(`Clean ${what} older than ${days} day(s)? Published posts, settings and credentials are never touched.`)) return;
  api('/api/storage/cleanup', { method: 'POST', body: { kind, days } })
    .then((r) => { toast(r.detail || 'Done', 'ok'); loadStorage(); })
    .catch((e) => toast(e.message, 'err'));
}
$('#clMedia').addEventListener('click', () => cleanup('media', 'media-hold files'));
$('#clLogs').addEventListener('click', () => cleanup('logs', 'log lines'));
$('#clFailed').addEventListener('click', () => cleanup('failed-posts', 'failed/skipped post records'));
$('#clVacuum').addEventListener('click', () => {
  if (!confirm('Vacuum the database? It reclaims free space (safe, no data loss).')) return;
  api('/api/storage/cleanup', { method: 'POST', body: { kind: 'vacuum' } })
    .then((r) => { toast(r.detail || 'Vacuumed', 'ok'); loadStorage(); })
    .catch((e) => toast(e.message, 'err'));
});

/* ── 17 · WHATSAPP MIRROR (official Web look — behavior 1:1) ───── */
const AVA_COLORS = ['#6a7175', '#7c3aed', '#b45309', '#0369a1', '#be185d', '#4d7c0f'];
const SENDER_COLORS = ['#53bdeb', '#ff9e9e', '#a5d6a7', '#ffe082', '#ce93d8', '#90caf9', '#ffab91', '#80cbc4'];
let waActive = null, waFilter = 'all', waSearch = '', waList = [], openedNow = null;
let waNums = [], waContactsOpen = false, waContactQ = '', waChatQ = '', waShowArchived = false, waChatSearchOpen = false;
let waSession = 'main';
try { const n = localStorage.getItem('rq7-num'); if (n) waSession = n; } catch (e) {}
const sessQ = (extra) => 'session=' + encodeURIComponent(waSession) + (extra ? '&' + extra : '');
const jidUrl = (j) => encodeURIComponent(j);
/* profile photos — every data-ava-jid node swaps its initial for the real photo */
const avaCache = new Map();
const avaGet = (jid) => {
  const key = waSession + '|' + jid;
  if (!avaCache.has(key)) {
    avaCache.set(key, fetch('/api/inbox/' + jidUrl(jid) + '/avatar?' + sessQ(), { credentials: 'include' })
      .then((r) => ((r.headers.get('content-type') || '').includes('image') ? r.url : ''))
      .catch(() => ''));
  }
  return avaCache.get(key);
};
const waHydrateAvatars = () => {
  document.querySelectorAll('[data-ava-jid]').forEach((el) => {
    const jid = el.dataset.avaJid;
    if (!jid || el.dataset.avaDone) return;
    avaGet(jid).then((url) => {
      if (!url || !el.isConnected) return;
      el.dataset.avaDone = '1';
      el.innerHTML = '<img src="' + url + '" alt="" loading="lazy">';
    });
  });
};
function localDate(ts) {
  if (!ts) return null;
  const d = new Date(String(ts).replace(' ', 'T') + 'Z');
  return isNaN(d) ? null : d;
}
function fmtTime(ts) { const d = localDate(ts); return d ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''; }
function fmtWhen(ts) {
  const d = localDate(ts); if (!d) return '';
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return fmtTime(ts);
  const y = new Date(now); y.setDate(now.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return 'Yesterday';
  return d.toLocaleDateString([], { day: '2-digit', month: '2-digit', year: 'numeric' });
}
function fmtDay(ts) {
  const d = localDate(ts); if (!d) return '';
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return 'Today';
  const y = new Date(now); y.setDate(now.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return 'Yesterday';
  return d.toLocaleDateString([], { day: '2-digit', month: 'long', year: 'numeric' });
}
function avaColor(seed) { let h = 0; for (const ch of String(seed)) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return AVA_COLORS[h % AVA_COLORS.length]; }
function senderColor(name) { let h = 0; for (const ch of String(name)) h = (h * 33 + ch.charCodeAt(0)) >>> 0; return SENDER_COLORS[h % SENDER_COLORS.length]; }
const EMOJIS = ['😀','😂','🥰','😍','😎','🤔','🙏','👍','👏','💪','❤️','🔥','✨','🎉','😅','😢','😡','🤝','✅','❌','⏰','📌','📎','📷','🎬','🎤','📊','💬','🌙','☀️','🇵🇰','🕌'];
const STATUS_DOT = { open: '#00a884', qr: '#f0b429', connecting: '#8696a0', close: '#f15c6d', logged_out: '#f15c6d', idle: '#8696a0', new: '#f0b429' };
const STATUS_TXT = { open: 'connected', qr: 'waiting for scan', connecting: 'starting…', close: 'reconnecting', logged_out: 'unlinked — scan again', idle: 'idle', new: 'waiting for scan' };
const curNum = () => waNums.find((n) => n.id === waSession) || { id: waSession, label: waSession, status: 'idle' };
const numName = (n) => (n.phone ? '+' + n.phone : (n.label || n.id));

/* number switcher (👤 chip) */
function renderNumBand() {
  const n = curNum();
  const name = numName(n);
  const dot = STATUS_DOT[n.status] || '#8696a0';
  $('#waNumBand').innerHTML = `<div class="ww-numband-in" id="waNumChip">
    <span class="ww-numava" style="background:${avaColor(name)}">${esc((name.replace(/[^0-9a-zA-Z]/g, '')[0] || '?').toUpperCase())}</span>
    <span class="ww-nummeta"><b>${esc(name)}</b><i><span style="background:${dot}"></span> ${esc(STATUS_TXT[n.status] || n.status)}${n.id === 'main' ? ' · main number' : ''}</i></span>
    <span class="ww-numcaret">⌄</span>
  </div>`;
  $('#waNumChip').addEventListener('click', (ev) => { ev.stopPropagation(); toggleNumDrop(); });
}
function toggleNumDrop() {
  const box = $('#waNumDrop');
  if (box && !box.hidden) { box.remove(); return; }
  openNumDrop();
}
function openNumDrop() {
  const rows = waNums.map((n) => {
    const name = numName(n);
    const dot = STATUS_DOT[n.status] || '#8696a0';
    return `<div class="ww-numrow ${n.id === waSession ? 'cur' : ''}" data-id="${esc(n.id)}">
      <span class="ww-numava" style="background:${avaColor(name)}">${esc((name.replace(/[^0-9a-zA-Z]/g, '')[0] || '?').toUpperCase())}</span>
      <span class="ww-nummeta"><b>${esc(name)}</b><i><span style="background:${dot}"></span> ${esc(STATUS_TXT[n.status] || n.status)}${n.id === 'main' ? ' · main' : ''}</i></span>
      ${n.id === 'main' ? '' : `<span class="ww-numx" data-x="${esc(n.id)}" title="Remove this number from the dashboard">🗑️</span>`}
    </div>`;
  }).join('');
  const wrapper = document.createElement('div');
  wrapper.className = 'ww-numdrop';
  wrapper.id = 'waNumDrop';
  wrapper.innerHTML = rows + `<div class="ww-numrow add" id="waNumAdd"><span class="ww-numava" style="background:#00a884">＋</span><span class="ww-nummeta"><b>Connect a number</b><i>scan a QR · chats + anti-delete features</i></span></div>
    <div class="ww-numrow foot"><a href="/connect" target="_blank" style="color:#00a884;text-decoration:none;font-size:12.5px">public pairing page ↗</a></div>`;
  $('#waNumBand').appendChild(wrapper);
  wrapper.querySelectorAll('.ww-numrow[data-id]').forEach((el) => el.addEventListener('click', () => switchNum(el.dataset.id)));
  wrapper.querySelectorAll('.ww-numx').forEach((el) => el.addEventListener('click', async (ev) => {
    ev.stopPropagation();
    const ok = await confirmModal('Remove this number?', 'Its chats, contacts and login file are deleted from the dashboard.', 'Remove', true);
    if (!ok) return;
    try { await api('/api/numbers/' + encodeURIComponent(el.dataset.x), { method: 'DELETE' }); toast('Number removed'); if (el.dataset.x === waSession) switchNum('main'); else reloadNums(); } catch (e) { toast(e.message, 'err'); }
  }));
  wrapper.querySelector('#waNumAdd').addEventListener('click', () => { wrapper.remove(); waConnectFlow(); });
  document.addEventListener('click', function closeDrop(ev) {
    const w = $('#waNumDrop');
    if (w && !w.contains(ev.target) && ev.target.id !== 'waNumChip') { w.remove(); document.removeEventListener('click', closeDrop); }
  });
}
function switchNum(id) {
  waSession = id;
  try { localStorage.setItem('rq7-num', id); } catch (e) {}
  const w = $('#waNumDrop'); if (w) w.remove();
  waActive = null; openedNow = null; waFilter = 'all'; waContactsOpen = false;
  const p = $('#waContactsPanel'); if (p) p.hidden = true;
  loaders.whatsapp().catch((e) => toast(e.message, 'err'));
}
async function reloadNums() { try { const d = await api('/api/numbers'); waNums = d.list || []; renderNumBand(); } catch (e) {} }
/* connect-a-number flow (QR from /api/numbers/:id/qr) */
async function waConnectFlow() {
  const r = await api('/api/numbers', { method: 'POST', body: { label: '' } }).catch((e) => { toast(e.message, 'err'); return null; });
  if (!r) return;
  let stop = false;
  const m = openModal({
    title: 'Connect a WhatsApp number', icon: ico('phone'),
    html: `<p class="muted tiny">On the phone: <b>WhatsApp → Settings → Linked devices → Link a device</b>, then scan below. Chats, groups and contacts sync into this dashboard; anti-delete, anti-view-once and anti-edit switch on for it automatically.</p>
      <div class="wa-qrwrap" id="waQrWrap"><div class="wa-qrph">Starting the pairing… the QR appears in a few seconds</div></div>
      <div class="muted tiny" id="waQrState" style="text-align:center;margin-top:8px">waiting for WhatsApp…</div>`,
    primary: false,
    actions: true
  });
  m.querySelector('[data-mclose]').textContent = 'Close';
  m.querySelector('[data-mclose]').addEventListener('click', () => { stop = true; reloadNums(); });
  const tick = async () => {
    if (stop || !m.isConnected) return;
    try {
      const d = await api('/api/numbers/' + encodeURIComponent(r.id) + '/qr');
      if (d.status === 'qr' && d.qr) {
        m.querySelector('#waQrWrap').innerHTML = `<img alt="QR" src="${d.qr}" style="width:260px;height:260px;image-rendering:pixelated">`;
        m.querySelector('#waQrState').textContent = 'Scan now — code refreshes by itself.';
      } else if (d.status === 'open') {
        stop = true;
        m.querySelector('#waQrWrap').innerHTML = `<div class="wa-qrok">✅ Connected${d.phone ? ' — +' + esc(d.phone) : ''}<br><span class="tiny">Chats, contacts and history are syncing now. Close this and pick the number from the 👤 chip.</span></div>`;
        m.querySelector('#waQrState').textContent = '';
        toast('Number connected — syncing chats', 'ok');
        reloadNums();
        return;
      } else if (d.status === 'logged_out') {
        stop = true;
        m.querySelector('#waQrWrap').innerHTML = '<div class="wa-qrph">The phone unlinked this device. Close this and press Connect again for a fresh QR.</div>';
        return;
      }
    } catch (e) { /* keep polling */ }
    setTimeout(tick, 2500);
  };
  setTimeout(tick, 1500);
}
/* contacts panel (📇) */
async function toggleContacts(force) {
  waContactsOpen = force != null ? force : !waContactsOpen;
  $('#waContactsPanel').hidden = !waContactsOpen;
  $('#waChatList').hidden = waContactsOpen;
  $('#waContactsBtn').style.background = waContactsOpen ? 'rgba(233,237,239,.12)' : 'transparent';
  if (waContactsOpen) await loadContacts();
}
async function loadContacts() {
  try {
    const d = await api('/api/contacts?' + sessQ(waContactQ ? 'q=' + encodeURIComponent(waContactQ) : ''));
    const list = d.list || [];
    $('#waContactsList').innerHTML = (list.length ? list.map((c) => {
      const name = c.name || c.notify || jidPrettify('', c.jid);
      return `<div class="wa-chat wa-contact" data-jid="${esc(c.jid)}" data-name="${esc(name)}">
        <div class="wa-avatar" data-ava-jid="${esc(c.jid)}" style="background:${avaColor(name)}">${esc((name.replace(/[^0-9a-zA-Z]/g, '')[0] || '?').toUpperCase())}</div>
        <div class="wa-col"><div class="wa-name">${esc(name)}</div><div class="wa-preview">${esc(String(c.jid).endsWith('@lid') ? 'WhatsApp contact' : '+' + String(c.jid).split('@')[0])}</div></div>
        <button class="wa-cinfo" data-cinfo="${esc(c.jid)}" title="Notes, tags & timeline" aria-label="Contact details">ℹ</button>
      </div>`;
    }).join('') : `<div class="wa-empty">No contacts synced yet<br><span class="tiny">They arrive with the phone's address book a few seconds after a number connects.</span></div>`)
      + `<div class="muted tiny" style="padding:10px 14px;color:#8696a0">${d.count || 0} contacts synced from this number's phone.</div>`;
    waHydrateAvatars();
    $$('#waContactsList .wa-contact').forEach((el) => el.addEventListener('click', (ev) => {
      const ci = ev.target.closest('[data-cinfo]');
      if (ci) { waContactDetails(ci.dataset.cinfo); return; }
      void openContactChat(el);
    }));
  } catch (e) { toast(e.message, 'err'); }
}
async function openContactChat(el) {
  const jid = el.dataset.jid;
  try { await api('/api/inbox/' + jidUrl(jid) + '/open?' + sessQ(), { method: 'POST', body: { name: el.dataset.name } }); } catch (e) {}
  toggleContacts(false);
  waActive = jid; openedNow = null;
  loaders.whatsapp().catch((e) => toast(e.message, 'err'));
}
/* chat list */
function waChatRow(c) {
  const name = jidPrettify(c.name, c.jid);
  const isGroup = String(c.jid).endsWith('@g.us');
  const prev = (c.last_from_me && isGroup ? 'You: ' : '') + (c.last_text || '');
  const un = Number(c.unread || 0);
  return `<div class="wa-chat ${c.jid === waActive ? 'active' : ''}" data-jid="${esc(c.jid)}">
    <div class="wa-avatar" data-ava-jid="${esc(c.jid)}" style="background:${avaColor(name)}">${esc((name.trim().charAt(0) || '?').toUpperCase())}</div>
    <div class="wa-col">
      <div class="wa-name">${esc(name)}${c.muted ? ' <span class="wa-mute" title="Muted on the phone">🔕</span>' : ''}${c.pinned ? ' <span class="wa-pin" title="Pinned">📌</span>' : ''}</div>
      <div class="wa-preview">${esc(prev.slice(0, 60))}</div>
    </div>
    <div class="wa-right">
      <span class="wa-when ${un ? 'unread' : ''}">${esc(fmtWhen(c.last_at))}</span>
      ${un ? `<span class="wa-badge-n">${un > 99 ? '99+' : un}</span>` : ''}
    </div>
  </div>`;
}
function waRenderList() {
  const q = waSearch.trim().toLowerCase();
  let list = waList.filter((c) => (waFilter === 'unread' ? Number(c.unread || 0) > 0 : true));
  if (waFilter === 'archived') list = list.filter((c) => c.archived);
  else if (!waShowArchived) list = list.filter((c) => !c.archived);
  if (q) list = list.filter((c) => String(c.name || '').toLowerCase().includes(q) || String(c.jid).includes(q));
  list = [...list].sort((a, b) => ((b.pinned ? 1 : 0) - (a.pinned ? 1 : 0))); // 5F (R76): pinned chats float to the top
  const archivedCount = waList.filter((c) => c.archived).length;
  const archRow = (waFilter === 'all' && archivedCount) ? `<div class="ww-archrow" id="waArchToggle">🗄️ Archived <b>${archivedCount}</b> <span class="muted tiny">${waShowArchived ? '▲ hide' : '▼ show'}</span></div>` : '';
  $('#waChatList').innerHTML = archRow + (list.map(waChatRow).join('')
    || `<div class="wa-empty">${q ? 'No chats found' : waFilter === 'unread' ? 'No unread chats' : waFilter === 'archived' ? 'No archived chats' : 'No chats yet'}<br><span class="tiny">Chats appear here as this number receives messages, and past chats import right after pairing.</span></div>`);
  const at = $('#waArchToggle'); if (at) at.addEventListener('click', () => { waShowArchived = !waShowArchived; waRenderList(); });
  $$('#waChatList .wa-chat').forEach((el) => el.addEventListener('click', () => waOpen(el.dataset.jid)));
  waHydrateAvatars();
}
async function waOpen(jid) {
  if (jid !== waActive) { openedNow = null; waChatQ = ''; waChatSearchOpen = false; }
  waActive = jid;
  const wwEl = document.querySelector('.ww'); if (wwEl) wwEl.classList.add('chat-open');
  try { await api('/api/inbox/' + jidUrl(jid) + '/read?' + sessQ(), { method: 'POST' }); } catch (e) {}
  try { await loaders.whatsapp(); } catch (e) { toast(e.message, 'err'); }
}
/* conversation */
function waBubbleInner(msg, isGroup, name) {
  const time = esc(fmtTime(msg.ts));
  const tick = msg.from_me ? '<span class="wa-tick" title="Sent to WhatsApp">✓</span>' : '';
  const vOnce = String(msg.kind || '').startsWith('viewonce');
  const vBadge = vOnce ? '<span class="wa-vonce" title="View once — saved before you opened it">1</span>' : '';
  if (msg.deleted) {
    const kept = msg.body && !/^\(media\)$/.test(msg.body) && !/^🚫/.test(msg.body) ? `<div class="wa-kept" title="Anti-delete kept this text">🛡️ ${esc(msg.body)}</div>` : '';
    return `<span class="wa-sender">${esc(name)}</span><div class="wa-del">🚫 This message was deleted</div>${kept}<span class="wa-meta">${time}${tick}</span>`;
  }
  let media = '';
  if (msg.has_media) {
    const src = '/api/inbox/' + jidUrl(waActive) + '/media/' + msg.id + '?' + sessQ();
    const k = String(msg.kind || '');
    const isVid = k === 'video' || k === 'viewonce-video';
    media = `<span class="wa-media-w"><img class="wa-img" loading="lazy" src="${src}" alt="${esc(k)}">${isVid ? '<span class="wa-play">▶</span>' : ''}</span>`;
  } else if (['voice', 'voiceonce-audio', 'viewonce-audio'].includes(msg.kind)) {
    /* 5C (R58): show the transcription under the voice chip when the switch produced one */
    const vt = String(msg.voice_text || '').trim();
    media = '<span class="wa-voice">🎤 Voice message</span>' + (vt ? `<div class="wa-vt" title="Transcribed by the bot (5C)">${esc(vt)}</div>` : '');
  } else if (msg.kind === 'doc') {
    media = `<span class="wa-doc">📄 ${esc(msg.media_name || 'Document')}</span>`;
  } else if (msg.kind === 'photo' || msg.kind === 'viewonce-photo') {
    media = '<span class="wa-noimg">📷 Photo <i>(preview not stored)</i></span>';
  }
  const edited = msg.edited ? '<span class="wa-edited" title="Edited later — the original is kept">✏️ edited</span>' : '';
  const sender = isGroup && !msg.from_me && msg.sender_name ? `<span class="wa-senderline"><span class="wa-senderava" data-ava-jid="${esc(msg.sender_jid || '')}" style="background:${senderColor(msg.sender_name)}">${esc((msg.sender_name.trim().charAt(0) || '?').toUpperCase())}</span><span class="wa-sender" style="color:${senderColor(msg.sender_name)}">${esc(msg.sender_name)}</span></span>` : '';
  const bodyTxt = msg.body && !/^\(media\)$/.test(msg.body) ? esc(msg.body) : '';
  return `${sender}${media}${bodyTxt}<span class="wa-meta">${edited}${time}${tick}</span>${vBadge}`;
}
loaders.whatsapp = async () => {
  const [nums, d] = await Promise.all([api('/api/numbers'), api('/api/inbox?' + sessQ())]);
  waNums = nums.list || [];
  renderNumBand();
  waList = d.list || [];
  waRenderList();
  if (waContactsOpen) loadContacts().catch(() => {});
  const n = curNum();
  const online = n.status === 'open';
  if (!waActive) {
    $('#waHeader').innerHTML = `<span class="muted" style="color:#8696a0">${online ? 'Pick a chat' : 'Number ' + esc(numName(n)) + ' is ' + esc(STATUS_TXT[n.status] || n.status)}</span>`;
    $('#waMsgs').innerHTML = `<div class="wa-empty">${online ? 'Tap a chat to open it' : 'Connect this number (👤 → Connect, or /connect on any device) to sync its chats'}<br><span class="tiny">This mirrors the WhatsApp account — you can reply right here.</span></div>`;
    return;
  }
  const chat = waList.find((c) => c.jid === waActive) || {};
  const name = chat.name || shortJid(waActive);
  $('#waHeader').innerHTML = `
    <div class="wa-hava" data-ava-jid="${esc(waActive)}" style="background:${avaColor(name)}">${esc((name.trim().charAt(0) || '?').toUpperCase())}</div>
    <div><div class="wa-hname">${esc(name)}</div><div class="wa-hsub">${online ? 'online' : 'offline'}</div></div>
    <span class="ww-head-icons" style="margin-left:auto"><button class="ww-ic" id="waChatSearchBtn" title="Search in chat" aria-label="Search in chat">🔍</button><span class="ww-ic" aria-hidden="true">⋮</span></span>`;
  const btn = $('#waChatSearchBtn');
  if (btn) btn.addEventListener('click', () => waToggleChatSearch());
  waFillHBar(); // 5F (R76): per-chat actions (pin / labels / schedule / export / media)
  const m = await api('/api/inbox/' + jidUrl(waActive) + '?' + sessQ());
  const msgs = m.list || [];
  const isGroup = String(waActive).endsWith('@g.us');
  const q = waChatQ.trim().toLowerCase();
  let lastDay = '', html = '', shown = 0;
  msgs.forEach((msg, i) => {
    if (q && !String(msg.body || '').toLowerCase().includes(q)) return;
    shown += 1;
    const day = fmtDay(msg.ts);
    let newDay = false;
    if (day !== lastDay) { html += `<div class="wa-day">${esc(day)}</div>`; lastDay = day; newDay = true; }
    const prev = msgs[i - 1];
    const sameSender = !newDay && prev && Boolean(prev.from_me) === Boolean(msg.from_me) && (prev.sender_name || '') === (msg.sender_name || '');
    const gap = prev ? (localDate(msg.ts) - localDate(prev.ts)) : Infinity;
    const tail = !(sameSender && gap < 300000);
    const isCall = msg.kind === 'call';
    html += `<div class="wa-msg ${msg.from_me ? 'out' : 'in'} ${tail ? 'tail' : ''} ${isCall ? 'call' : ''}" data-id="${msg.id}">
      ${waBubbleInner(msg, isGroup, name)}</div>`;
  });
  const box = $('#waMsgs');
  const wasNearBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 140 || openedNow !== waActive;
  box.innerHTML = (waChatSearchOpen ? `<div class="ww-chatsearch"><span>🔍</span><input id="waChatQ" placeholder="Search in this chat" value="${esc(waChatQ)}"><span class="muted tiny" style="color:#8696a0">${waChatQ ? shown + ' shown' : ''}</span></div>` : '')
    + `<div class="ww-older"><button class="btn btn-sm" id="waOlder">⏬ Load older messages</button></div>`
    + (html || `<div class="wa-empty">${q ? 'No messages match the search' : 'Nothing stored for this chat yet — press ⏬ above to ask your phone for its history (WhatsApp serves it for chats that already have a message here; new messages always arrive automatically).'}</div>`);
  waHydrateAvatars();
  const olderBtn = $('#waOlder');
  if (olderBtn) olderBtn.addEventListener('click', async () => {
    olderBtn.disabled = true; olderBtn.textContent = '⏬ Asking your phone…';
    try {
      await api('/api/inbox/' + jidUrl(waActive) + '/history?' + sessQ(), { method: 'POST', body: { count: 50 } });
      toast('History requested — older messages will appear here shortly');
      setTimeout(() => loaders.whatsapp().catch(() => {}), 6000);
    } catch (e) { toast(e.message, 'err'); }
    olderBtn.disabled = false; olderBtn.textContent = '⏬ Load older messages';
  });
  const qi = $('#waChatQ');
  if (qi) {
    qi.addEventListener('input', () => { waChatQ = qi.value; loaders.whatsapp().catch(() => {}); });
    qi.focus();
  }
  /* bubble detail modals — anti-edit original / anti-delete copy */
  $$('#waMsgs .wa-msg').forEach((el) => el.onclick = () => {
    const msg = msgs.find((x) => String(x.id) === el.dataset.id);
    if (!msg) return;
    if (msg.orig_body) {
      openModal({ title: 'Original text (anti-edit)', icon: ico('pencil'), html: `<p class="muted tiny">The sender edited this message. The text below is what they wrote first — WhatsApp only shows the new version.</p><div class="wa-orig">${esc(msg.orig_body)}</div>` });
    } else if (msg.deleted && !msg.has_media && !/^\(media\)$/.test(msg.body || '')) {
      openModal({ title: 'Anti-delete copy', icon: ico('shield'), html: `<p class="muted tiny">This message was deleted for everyone. The dashboard kept the copy it archived when it arrived.</p><div class="wa-orig">${esc(msg.body)}</div>` });
    }
  });
  if (wasNearBottom) box.scrollTop = box.scrollHeight;
  openedNow = waActive;
};
function waToggleChatSearch() {
  waChatSearchOpen = !waChatSearchOpen;
  if (!waChatSearchOpen) waChatQ = '';
  loaders.whatsapp().catch(() => {});
}
async function sendWaMessage() {
  if (!waActive) return toast('Pick a chat first');
  const text = $('#waSendInput').value.trim();
  if (!text) return;
  const btn = $('#waSendBtn');
  btn.disabled = true;
  try {
    await api('/api/inbox/' + jidUrl(waActive) + '/send?' + sessQ(), { method: 'POST', body: { text } });
    $('#waSendInput').value = '';
    setTimeout(() => loaders.whatsapp(), 800);
  } catch (e) { toast(e.message, 'err'); }
  btn.disabled = false;
}
$('#waSendBtn').addEventListener('click', sendWaMessage);
$('#waSendInput').addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); sendWaMessage(); } });
$('#waSearch').addEventListener('input', (ev) => { waSearch = ev.target.value; waRenderList(); });
$('#waContactsBtn').addEventListener('click', () => toggleContacts());
$('#waContactSearch').addEventListener('input', (ev) => { waContactQ = ev.target.value; loadContacts().catch(() => {}); });
$('#waNumBtn').addEventListener('click', () => toggleNumDrop());
$('#waBackBtn').addEventListener('click', () => { const wwEl = document.querySelector('.ww'); if (wwEl) wwEl.classList.remove('chat-open'); });
$$('.ww-pill').forEach((b) => b.addEventListener('click', () => {
  waFilter = b.dataset.f;
  if (waFilter !== 'archived') waShowArchived = false;
  $$('.ww-pill').forEach((x) => x.classList.toggle('active', x === b));
  if (waContactsOpen) toggleContacts(false);
  waRenderList();
}));
/* emoji picker (official composer has one — ours inserts into the input) */
function waEmojiInit() {
  const box = $('#waEmojiBox');
  if (box.dataset.done) return;
  box.innerHTML = EMOJIS.map((e) => `<span>${e}</span>`).join('');
  box.dataset.done = '1';
  $$('#waEmojiBox span').forEach((s) => s.addEventListener('click', () => {
    const inp = $('#waSendInput'); inp.value += s.textContent; inp.focus();
  }));
}
$('#waEmojiBtn').addEventListener('click', () => { waEmojiInit(); const box = $('#waEmojiBox'); box.hidden = !box.hidden; });
document.addEventListener('click', (ev) => {
  const box = $('#waEmojiBox');
  if (!box || box.hidden) return;
  if (!box.contains(ev.target) && ev.target.id !== 'waEmojiBtn') box.hidden = true;
});
$('#waAttachBtn').addEventListener('click', () => toast('Text replies are supported here. For files use Bulk Send.'));
/* live refresh while the tab is open */
setInterval(() => {
  if (currentView !== 'whatsapp') return;
  const ae = document.activeElement;
  if (ae && ['waSearch', 'waSendInput', 'waContactSearch', 'waChatQ'].includes(ae.id)) return; // never yank focus mid-typing
  if ($('#waSearch').value !== waSearch) return;
  loaders.whatsapp().catch(() => {});
}, 8000);

/* ── 18 · OUTREACH (bulk + email) ───────────────────────────────── */
loaders.bulk = async () => {
  $('#bulkHistTable tbody').innerHTML = skelRows(3, 5);
  $('#bcListTable tbody').innerHTML = skelRows(2, 4);
  try {
    const d = await api('/api/broadcast');
    renderBulkLists(d.lists || []);
    $('#bulkHistTable tbody').innerHTML = (d.history || []).map((h) => `
      <tr><td class="tiny num">${when(h.ts)}</td><td class="tiny">${esc(h.list_name || '—')}</td><td class="num"><b>${h.sent}</b></td><td class="num muted">${h.total}</td><td class="muted tiny">${esc((h.text || '').slice(0, 60))}</td></tr>`).join('')
      || (await emptyTCell('send', 'No bulk sends yet', 'sent bulk messages appear here', 5));
  } catch (e) { toast(e.message, 'err'); }
};
function renderBulkLists(lists) {
  const tb = $('#bcListTable tbody');
  if (!lists.length) { tb.innerHTML = `<tr><td colspan="4" class="muted tiny" style="padding:12px">No saved lists yet — press <b>New list</b> to name a group of recipients once and reuse it.</td></tr>`; return; }
  tb.innerHTML = lists.map((l) => `
    <tr>
      <td><b>${esc(l.name)}</b></td>
      <td class="num">${l.count}</td>
      <td class="tiny muted">${when(l.updated_at)}</td>
      <td class="num">
        <button class="btn btn-sm" data-act="bc-edit" data-id="${l.id}">Edit</button>
        <button class="btn btn-sm" data-act="bc-send" data-id="${l.id}">Send…</button>
        <button class="btn btn-sm" data-act="bc-del" data-id="${l.id}">Delete</button>
      </td>
    </tr>`).join('');
  tb.querySelectorAll('[data-act]').forEach((b) => b.addEventListener('click', async () => {
    const l = lists.find((x) => String(x.id) === b.dataset.id);
    if (!l) return;
    if (b.dataset.act === 'bc-edit') bcListModal(l);
    else if (b.dataset.act === 'bc-send') bcSendModal(l);
    else if (b.dataset.act === 'bc-del') {
      const ok = await confirmModal(`Delete list “${l.name}”?`, 'The recipients are removed from this dashboard. Nothing is deleted on WhatsApp.', 'Delete', true);
      if (!ok) return;
      try { await api('/api/broadcast/' + l.id + '/delete', { method: 'POST' }); toast('List deleted', 'ok'); loaders.bulk(); } catch (e) { toast(e.message, 'err'); }
    }
  }));
}
function bcListModal(l) {
  const m = openModal({
    title: l ? `Edit list — ${l.name}` : 'New saved list',
    icon: ico('megaphone'),
    html: `<div class="field"><label>List name</label><input class="in" id="bcName" value="${esc(l?.name || '')}" placeholder="e.g. Family, Franchisees, VIPs"></div>
      <div class="field" style="margin-top:12px"><label>Recipients <span class="muted tiny">— one per line: phone,name or just phone</span></label><textarea class="in" id="bcRecips" rows="7" placeholder="923001234567,Ali&#10;923009876543"></textarea></div>
      <div class="muted tiny" style="margin-top:8px" id="bcCount">${l ? l.count + ' recipients' : ''}</div>
      <div class="row-actions" style="margin-top:12px"><button class="btn btn-p" id="bcOk">${l ? 'Save list' : 'Create list'}</button></div>`,
    primary: null
  });
  $('#bcRecips').value = l?.recipients || '';
  const cnt = () => { $('#bcCount').textContent = ($('#bcRecips').value.match(/[^\n]+/g) || []).length + ' recipients'; };
  $('#bcRecips').addEventListener('input', cnt); cnt();
  $('#bcOk').addEventListener('click', async () => {
    const name = $('#bcName').value.trim();
    if (!name) { toast('Name the list first.', 'err'); return; }
    try {
      await api('/api/broadcast', { method: 'POST', body: { id: l?.id, name, recipients: $('#bcRecips').value } });
      closeModal(); toast(l ? 'List updated' : 'List saved', 'ok'); loaders.bulk();
    } catch (e) { toast(e.message, 'err'); }
  });
}
function bcSendModal(l) {
  const m = openModal({
    title: `Send to “${l.name}” (${l.count} recipients)`,
    icon: ico('megaphone'),
    html: `<p class="muted tiny f-help">Same pacing as the bulk sender — 1.5 s apart. <b>{name}</b> is replaced per recipient.</p>
      <div class="field" style="margin-top:12px"><textarea class="in" id="bcText" rows="6" placeholder="Salam {name}! …"></textarea></div>
      <div class="row-actions" style="margin-top:12px"><button class="btn btn-p" id="bcGo">Send to list</button></div>`,
    primary: null
  });
  $('#bcGo').addEventListener('click', async () => {
    const text = $('#bcText').value.trim();
    if (!text) { toast('Write the message first.', 'err'); return; }
    const ok = await confirmModal(`Send to all ${l.count} recipients?`, 'This posts the message to every person in the list, paced 1.5 s apart.', 'Send to all', true);
    if (!ok) return;
    try {
      const r = await api('/api/broadcast/' + l.id + '/send', { method: 'POST', body: { text } });
      closeModal(); toast(`Sent ${r.sent}/${r.total} from list “${l.name}”`, r.sent === r.total ? 'ok' : '');
      loaders.bulk();
    } catch (e) { toast(e.message, 'err'); }
  });
}
$('#bulkSendBtn').addEventListener('click', async () => {
  const ok = await confirmModal('Send this bulk message?', 'It goes to every recipient in the list, paced 1.5 s apart. WhatsApp can flag large fast sends — keep the list reasonable.', 'Send to all', true);
  if (!ok) return;
  const btn = $('#bulkSendBtn');
  btn.classList.add('is-loading');
  $('#bulkResult').textContent = 'Sending (paced 1.5 s per recipient)…';
  try {
    const r = await api('/api/bulk', { method: 'POST', body: { recipients: $('#bulkTo').value, text: $('#bulkText').value } });
    $('#bulkResult').innerHTML = `<b style="color:var(--ok)">Delivered ${r.sent}/${r.total}</b>` + (r.results || []).filter((x) => !x.ok).map((x) => `<br><span style="color:var(--err)">${esc(x.to)}: ${esc(x.error)}</span>`).join('');
    toast(`Bulk send: ${r.sent}/${r.total}`, r.sent === r.total ? 'ok' : '');
    loaders.bulk();
  } catch (e) { $('#bulkResult').textContent = ''; toast(e.message, 'err'); }
  btn.classList.remove('is-loading');
});
/* email */
const EM_PRESETS = { gmail: 'https://myaccount.google.com/apppasswords', icloud: 'https://appleid.apple.com/account/manage', custom: '' };
$('#emProvider').addEventListener('change', () => {
  const p = $('#emProvider').value;
  const link = $('#emPassLink');
  link.href = EM_PRESETS[p] || '#';
  link.style.display = p === 'custom' ? 'none' : '';
  $('#emCustomRow').hidden = p !== 'custom';
});
$('#emAdd').addEventListener('click', async () => {
  const btn = $('#emAdd'); btn.classList.add('is-loading');
  try {
    await api('/api/email/accounts', { method: 'POST', body: { provider: $('#emProvider').value, label: $('#emLabel').value, user: $('#emUser').value, pass: $('#emPass').value, host: $('#emHost').value, port: $('#emPort').value } });
    toast('Email account connected — press Test to verify it sends', 'ok');
    $('#emPass').value = ''; $('#emUser').value = ''; $('#emLabel').value = '';
    loaders.email();
  } catch (e) { toast(e.message, 'err'); }
  btn.classList.remove('is-loading');
});
loaders.email = async () => {
  $('#emAccTable tbody').innerHTML = skelRows(2, 3);
  $('#emQueueTable tbody').innerHTML = skelRows(2, 4);
  $('#emHistTable tbody').innerHTML = skelRows(2, 5);
  const [acc, hist] = await Promise.all([api('/api/email/accounts'), api('/api/email/history')]);
  $('#emFrom').innerHTML = (acc.list || []).length
    ? acc.list.map((a) => `<option value="${esc(a.id)}" ${a.isDefault ? 'selected' : ''}>${esc(a.label)} — ${esc(a.user)}</option>`).join('')
    : '<option value="">— connect an account above —</option>';
  $('#emAccTable tbody').innerHTML = (acc.list || []).map((a) => `
    <tr data-id="${esc(a.id)}">
      <td><b>${esc(a.label)}</b> ${a.isDefault ? '<span class="b b-acc">default</span>' : ''}<div class="muted tiny">${esc(a.user)}</div></td>
      <td>${esc(a.providerName)}</td>
      <td><div class="ra">
        <button class="btn btn-sm" data-act="test">Test</button>
        ${a.isDefault ? '' : '<button class="btn btn-sm" data-act="def">Make default</button>'}
        <button class="btn btn-sm btn-d" data-act="del">Remove</button>
      </div></td>
    </tr>`).join('') || (await emptyTCell('mail', 'No email accounts yet', 'connect one below to start emailing', 3));
  $('#emQueueTable tbody').innerHTML = (hist.queue || []).map((q) => `
    <tr data-qid="${esc(q.id)}">
      <td class="tiny num">${esc(q.at)}</td><td>${esc(q.subject || '(no subject)')}</td>
      <td><span class="b b-info">${esc(q.status)}</span></td>
      <td><div class="ra"><button class="btn btn-sm btn-d" data-act="cancel">Cancel</button></div></td>
    </tr>`).join('') || (await emptyTCell('calendar', 'Nothing scheduled', 'timed emails queue here', 4));
  $('#emHistTable tbody').innerHTML = (hist.list || []).map((h) => `
    <tr>
      <td class="tiny num">${when(h.ts)}</td><td class="muted tiny">${esc(h.account)}</td>
      <td class="tiny">${esc(h.to_addr)}</td><td class="tiny">${esc(h.subject)}</td>
      <td>${h.ok ? '<span class="b b-ok">sent</span>' : `<span class="b b-err" title="${esc(h.error || '')}">failed</span>`}</td>
    </tr>`).join('') || (await emptyTCell('mail-open', 'No emails sent yet', 'history of sent emails', 5));
};
$('#emAccTable').addEventListener('click', async (ev) => {
  const btn = ev.target.closest('button[data-act]');
  if (!btn) return;
  const id = btn.closest('tr').dataset.id;
  try {
    if (btn.dataset.act === 'test') {
      btn.disabled = true; btn.textContent = 'Testing…';
      const t = await api('/api/email/test', { method: 'POST', body: { id } });
      toast(t.result.ok ? t.result.message : t.result.error, t.result.ok ? 'ok' : 'err');
      loaders.email();
    } else if (btn.dataset.act === 'def') {
      await api(`/api/email/accounts/${id}/default`, { method: 'POST' });
      toast('Default sender set', 'ok');
      loaders.email();
    } else if (btn.dataset.act === 'del') {
      const ok = await confirmModal('Remove this email account?', 'Its stored app password is deleted. Sent history stays.', 'Remove', true);
      if (!ok) return;
      await api('/api/email/accounts/' + id, { method: 'DELETE' });
      loaders.email();
    }
  } catch (e) { toast(e.message, 'err'); }
});
async function emSend(scheduled) {
  const body = { accountId: $('#emFrom').value, to: $('#emTo').value, subject: $('#emSubject').value, body: $('#emBody').value };
  if (scheduled) {
    const v = $('#emWhen').value;
    if (!v) return toast('Pick a date & time first');
    body.scheduleAt = new Date(v).toISOString();
  }
  try {
    const r = await api('/api/email/send', { method: 'POST', body });
    toast(r.queued ? (r.note || 'Queued') : `Sent ${r.sent}/${r.total}`, 'ok');
    if (!scheduled) { $('#emTo').value = ''; $('#emSubject').value = ''; $('#emBody').value = ''; }
    $('#emWhen').value = '';
    loaders.email();
  } catch (e) { toast(e.message, 'err'); }
}
$('#emSendNow').addEventListener('click', () => emSend(false));
$('#emSchedule').addEventListener('click', () => emSend(true));
$('#emQueueTable').addEventListener('click', async (ev) => {
  const btn = ev.target.closest('button[data-act="cancel"]');
  if (!btn) return;
  try { await api(`/api/email/queue/${btn.closest('tr').dataset.qid}/cancel`, { method: 'POST' }); toast('Cancelled'); loaders.email(); }
  catch (e) { toast(e.message, 'err'); }
});

/* ── 19 · JOURNAL · HEALTH · LOGS ───────────────────────────────── */
loaders.journal = async () => {
  $('#watchTable tbody').innerHTML = skelRows(3, 4);
  const d = await api('/api/watched');
  $('#watchTable tbody').innerHTML = (d.list || []).map((w) => `
    <tr data-phone="${esc(w.phone)}">
      <td class="num">+${esc(w.phone)}</td>
      <td>${esc(w.name || '')}</td>
      <td class="tiny">${w.last ? when(w.last.ts) + ' — ' + esc((w.last.body || '').slice(0, 40)) : '<span class="muted">no activity yet</span>'}</td>
      <td><div class="ra"><button class="btn btn-sm btn-d" data-act="del">Remove</button></div></td>
    </tr>`).join('') || (await emptyTCell('eye', 'No watched numbers', 'add a number above to start its journal', 4));
};
$('#watchAdd').addEventListener('click', async () => {
  try { await api('/api/watched', { method: 'POST', body: { phone: $('#watchPhone').value, name: $('#watchName').value } }); toast('Watching +' + $('#watchPhone').value.replace(/\D/g, ''), 'ok'); $('#watchPhone').value = ''; $('#watchName').value = ''; loaders.journal(); }
  catch (e) { toast(e.message, 'err'); }
});
$('#watchTable').addEventListener('click', async (ev) => {
  const btn = ev.target.closest('button[data-act="del"]');
  if (!btn) return;
  const phone = btn.closest('tr').dataset.phone;
  const ok = await confirmModal('Stop watching +' + phone + '?', 'Its journal history stays stored; new messages from it are no longer recorded.', 'Remove', true);
  if (!ok) return;
  try { await api('/api/watched/' + phone, { method: 'DELETE' }); loaders.journal(); } catch (e) { toast(e.message, 'err'); }
});
/* 5D (R64): score dial — inline SVG arc, 0–100 */
function dialSvg(score) {
  const R = 54, C = 2 * Math.PI * R;
  const off = C * (1 - Math.max(0, Math.min(100, score)) / 100);
  const color = score >= 80 ? 'var(--ok)' : score >= 50 ? 'var(--warn)' : 'var(--err)';
  return `<svg viewBox="0 0 140 140" width="140" height="140" role="img" aria-label="Health score ${score} out of 100">
    <circle cx="70" cy="70" r="${R}" fill="none" stroke="var(--border)" stroke-width="12"/>
    <circle cx="70" cy="70" r="${R}" fill="none" stroke="${color}" stroke-width="12" stroke-linecap="round"
      stroke-dasharray="${C.toFixed(1)}" stroke-dashoffset="${off.toFixed(1)}" transform="rotate(-90 70 70)"/>
    <text x="70" y="66" text-anchor="middle" font-size="34" font-weight="700" fill="var(--text)">${score}</text>
    <text x="70" y="88" text-anchor="middle" font-size="10" fill="var(--muted)">of 100</text>
  </svg>`;
}
loaders.health = async () => {
  const [d, u] = await Promise.all([api('/api/health'), api('/api/uptime')]);
  $('#scoreDial').innerHTML = dialSvg(d.score || 0);
  $('#scoreWeakest').innerHTML = (d.weakest || []).length
    ? `Weakest parts: <b>${d.weakest.map(esc).join('</b> and <b>')}</b> — fix those first.`
    : 'All parts healthy.';
  $('#scoreAt').textContent = 'checked ' + when(new Date(d.at).toISOString().slice(0, 19).replace('T', ' '));
  $('#healthParts').innerHTML = (d.parts || []).map((p) => {
    const cls = p.score >= 80 ? 'ok' : p.score >= 50 ? 'warn' : 'err';
    return `<div class="part-row" title="${esc(p.note)}">
      <span class="part-name">${esc(p.name)}</span>
      <span class="part-bar"><span class="${cls}" style="width:${p.score}%"></span></span>
      <span class="num tiny part-val">${p.score}</span>
      <span class="muted tiny part-note">${esc(p.note)}</span>
    </div>`;
  }).join('');
  $('#selftestHist tbody').innerHTML = (d.selftests || []).map((s) =>
    `<tr><td class="tiny num">${when(s.ts)}</td><td class="num"><b>${s.ok}/${s.total}</b></td><td class="muted tiny">${esc(s.detail || '')}</td></tr>`).join('') || '<tr><td colspan="3" class="muted">No self-tests run yet.</td></tr>';
  $('#upKpis').innerHTML = [kpi('Total boots', u.boots, 'since first run', 'accent'), kpi('Last boot', u.last ? when(u.last.booted_at) : '—', u.last ? u.last.source : '')].join('');
  $('#upTable tbody').innerHTML = (u.recent || []).map((x) => `<tr><td class="num">${x.id}</td><td class="tiny num">${when(x.booted_at)}</td><td class="muted tiny">${esc(x.source || '')}</td></tr>`).join('') || '<tr><td colspan="3" class="muted">—</td></tr>';
};
$('#selftestRun').addEventListener('click', async () => {
  $('#selftestMeta').textContent = ' — running…';
  try {
    const r = await api('/api/health/selftest', { method: 'POST' });
    $('#selftestMeta').textContent = ` — last run: ${r.ok}/${r.total} passed in ${Math.round(r.ms)} ms (side-effect-free)`;
    $('#selftestTable tbody').innerHTML = (r.list || []).map((c) =>
      `<tr><td>${esc(c.name)}</td><td>${c.ok ? '<span class="b b-ok">PASS</span>' : '<span class="b b-err">FAIL</span>'}</td><td class="num tiny">${c.ms}</td><td class="muted tiny">${esc(c.detail || '')}</td></tr>`).join('');
    toast(`Self-test: ${r.ok}/${r.total} passed`, r.ok === r.total ? 'ok' : 'warn');
    loaders.health();
  } catch (e) { $('#selftestMeta').textContent = ' — run failed'; toast(e.message, 'err'); }
});
let logLevel = 'all';
loaders.logs = async () => {
  $('#logList').innerHTML = skelLines(5);
  const d = await api('/api/logs?level=' + logLevel + '&limit=150');
  $('#logList').innerHTML = (d.list || []).map((l) => `
    <div class="ll" data-lv="${esc(l.level)}">
      <span class="ll-time num">${when(l.ts)}</span>
      <span class="b ${l.level === 'warn' ? 'b-warn' : l.level === 'error' ? 'b-err' : l.level === 'info' ? 'b-info' : ''}" style="flex:none">${esc(l.level)}</span>
      <span class="ll-code">${esc(l.code)}</span>
      <span class="msg">${esc(l.msg)}</span>
    </div>`).join('') || (await emptyBox($('#logList'), 'history', 'No log lines', 'bot activity appears here in real time'));
};
$$('#logChips .chip').forEach((c) => c.addEventListener('click', () => {
  $$('#logChips .chip').forEach((x) => x.classList.remove('on'));
  c.classList.add('on');
  logLevel = c.dataset.level;
  loaders.logs().catch(() => {});
}));
$('#logWrap').addEventListener('click', () => {
  const l = $('#logList');
  l.classList.toggle('nowrap');
  toast('Line wrapping ' + (l.classList.contains('nowrap') ? 'off' : 'on'));
});
$('#logCopy').addEventListener('click', async () => {
  const txt = $$('#logList .ll').map((l) => l.textContent.replace(/\s+/g, ' ').trim()).join('\n');
  try { await navigator.clipboard.writeText(txt); toast('Copied ' + $$('#logList .ll').length + ' lines', 'ok'); }
  catch (e) { toast('Copy failed — select the text manually', 'err'); }
});

/* ── 20 · SETTINGS ──────────────────────────────────────────────── */
let AI_PROVIDERS = [];
function fillAiProviderUi(current, currentModel) {
  const sel = $('#aiProvider');
  const sorted = AI_PROVIDERS.slice().sort((a, b) => a.name.localeCompare(b.name));
  sel.innerHTML = sorted.map((p) => `<option value="${esc(p.id)}" ${p.id === current ? 'selected' : ''}>${esc(p.name)}${p.free ? ' · free tier' : ''}</option>`).join('');
  updateAiProviderUi(currentModel);
}
function fillModelSelect(list, current, note) {
  const sel = $('#aiModel');
  const opts = [...new Set([...(current ? [current] : []), ...(list || [])])];
  sel.innerHTML = opts.length
    ? opts.map((m) => `<option value="${esc(m)}" ${m === current ? 'selected' : ''}>${esc(m)}${m === current ? ' (saved)' : ''}</option>`).join('')
    : '<option value="">— no models listed —</option>';
  if (current && opts.includes(current)) sel.value = current;
  const extra = (list || []).length > 120 ? ` (showing first 120)` : '';
  $('#aiModelNote').textContent = note ? note + extra : '';
}
async function updateAiProviderUi(keepModel) {
  const id = $('#aiProvider').value;
  const p = AI_PROVIDERS.find((x) => x.id === id) || { keyUrl: '', models: [] };
  const link = $('#aiGetKey');
  link.href = p.keyUrl || '#';
  link.textContent = `Get ${p.name || 'API'} key →`;
  link.style.display = p.keyUrl ? '' : 'none';
  const wantKeep = keepModel !== undefined ? keepModel : (id === (window.__aiProviderShown) ? $('#aiModel').value : '');
  fillModelSelect(p.models || [], wantKeep || (p.models || [])[0] || '', `Loading ${(p.models || []).length} built-in starter model(s) (Oct 2026) — fetching ${p.name || 'provider'}'s live list…`);
  window.__aiProviderShown = id;
  try {
    const d = await api('/api/ai/models?provider=' + encodeURIComponent(id));
    if (id !== $('#aiProvider').value) return;
    const note = d.live
      ? `OK — ${d.list.length} live model(s) read straight from ${d.name} — this is the authoritative list.`
      : `Warning — live list from ${d.name} could not be read (${d.error || 'unknown reason'}) — showing ${d.list.length} built-in starter model(s) instead. Fix the key and press “Fetch live model list”.`;
    fillModelSelect(d.list, d.default || keepModel, note);
  } catch (e) { /* built-ins already shown */ }
}
function updateAiKeyLine(ai) {
  const line = $('#aiKeyLine');
  if (!line || !ai) return;
  const id = $('#aiProvider').value;
  const name = ((AI_PROVIDERS || []).find((p) => p.id === id) || {}).name || id;
  const has = ai.keyStatus ? Boolean(ai.keyStatus[id]) : (id === ai.provider ? ai.hasKey : false);
  $('#aiKey').placeholder = has ? '•••••••• ' + name + ' key saved — type a new key to replace it' : 'No ' + name + ' key saved yet — paste one here';
  line.textContent = has
    ? 'Saved — the ' + name + ' key is stored. Each AI keeps its OWN key — switch providers freely, no need to re-paste anything.'
    : 'Missing — no key saved for ' + name + ' yet. What you paste is stored only for ' + name + '.';
  line.style.color = has ? '' : 'var(--warn)';
}
$('#aiProvider').addEventListener('change', () => { updateAiProviderUi(undefined); updateAiKeyLine(window.__aiState); });
$('#aiModelRefresh').addEventListener('click', async () => {
  const btn = $('#aiModelRefresh'); btn.classList.add('is-loading');
  try {
    await api('/api/ai', { method: 'POST', body: { provider: $('#aiProvider').value, key: $('#aiKey').value.trim() || undefined } });
    $('#aiKey').value = '';
    const d = await api('/api/ai/models?provider=' + encodeURIComponent($('#aiProvider').value) + '&refresh=1');
    fillModelSelect(d.list, $('#aiModel').value || d.default, d.live
      ? `OK — ${d.list.length} live model(s) straight from ${d.name} — pick one and press Save AI settings.`
      : `Note — ${d.name} did not return a live list (${d.error || 'unknown reason'}). Showing ${d.list.length} built-in starter model(s) (Oct 2026) — these are a fallback. If the key is correct, ${d.name} may be temporarily unreachable; try again in a minute.`);
    toast(d.live ? `${d.list.length} models loaded` : 'Showing built-in models', d.live ? 'ok' : '');
  } catch (e) { toast(e.message, 'err'); }
  btn.classList.remove('is-loading');
});
async function setFeatsLoad() {
  try {
    const f = await api('/api/features');
    const rows = [
      ['antidelete', 'Anti-delete', 'Deleted-for-everyone messages stay readable here (the copy archived at arrival cannot be recalled by the phone).'],
      ['antiviewonce', 'Anti-view-once', 'View-once photos/videos are saved to the dashboard the moment they arrive — opening them on the phone changes nothing.'],
      ['antiedit', 'Anti-edit', 'Edited messages keep the text that was written first (tap the bubble to read it).'],
      ['rejectcalls', 'Auto-reject calls', 'Incoming calls are declined automatically and logged as missed calls (OFF by default — calls keep ringing while this is off).']
    ];
    $('#setFeats').innerHTML = rows.map(([k, name, desc]) => `
      <div class="feat-row"><input type="checkbox" data-k="${k}" ${f[k] ? 'checked' : ''}>
        <span><b>${name}</b><br><span class="muted tiny">${desc}</span></span></div>`).join('')
      + '<div class="muted tiny" style="margin-top:8px">WhatsApp cannot fake read receipts for the phone — blue ticks are not shown here, on purpose.</div>';
    $$('#setFeats input').forEach((cb) => cb.addEventListener('change', async () => {
      try { await api('/api/features', { method: 'POST', body: { [cb.dataset.k]: cb.checked } }); toast('Feature updated'); }
      catch (e) { toast(e.message, 'err'); cb.checked = !cb.checked; }
    }));
  } catch (e) { /* settings still work without this card */ }
}
loaders.settings = async () => {
  setFeatsLoad().catch(() => {});
  const [s, ai] = await Promise.all([api('/api/settings'), api('/api/ai')]);
  $('#setBotName').value = s.botName || '';
  $('#setReportPhone').value = s.reportPhone || '';
  $('#setBlocklist').value = s.blocklist || '';
  $('#setBlocklistRegex').checked = !!s.blocklistRegex;
  $('#setReplace').value = s.replaceRules || '';
  renderReplaceRules();
  $('#setMaxPerHour').value = s.maxPerHour || '30';
  $('#setAiPrompt').value = s.aiPrompt || '';
  $('#apiKeyBox').value = s.apiKey || '';
  AI_PROVIDERS = ai.providers || [];
  window.__aiState = ai;
  $('#aiProviderCount').textContent = `${AI_PROVIDERS.length} providers`;
  fillAiProviderUi(ai.provider, ai.model);
  $('#aiModelCustom').value = '';
  $('#aiKey').value = '';
  updateAiKeyLine(ai);
  const pi = ai.pauseInfo || {};
  const pausedTxt = ai.paused ? ` · PAUSED ~${Math.max(1, Math.ceil(((pi.until || 0) - Date.now()) / 60000))} min (${pi.label || 'circuit breaker'})` : '';
  $('#aiStateLine').textContent = `Provider: ${ai.provider} · model: ${ai.model || 'default'} · key: ${ai.hasKey ? 'saved' : 'missing'}${pausedTxt}`;
  /* 5A */
  $('#setXdedupeWin').value = s.crossDedupeWindowMin || '30';
  $('#setSourceEdit').value = s.sourceEditPolicy || 'ignore';
  /* 5C */
  renderAiFeatures();
  renderPromptLib();
  renderGlossary();
  loadAutomation(); // 5H (R85/R87)
};

/* ── 5C (R54) · per-feature AI provider/model + usage meter ─────── */
async function renderAiFeatures() {
  try {
    const d = await api('/api/ai/features');
    const provOpts = (cur) => `<option value="">(global — ${esc(d.global.provider || 'none')})</option>` +
      (d.providers || []).map((p) => `<option value="${esc(p.id)}" ${p.id === cur ? 'selected' : ''}>${esc(p.name)}</option>`).join('');
    const tbody = $('#aiFeatTable tbody');
    if (!tbody) return;
    tbody.innerHTML = (d.features || []).map((f) => `<tr data-fk="${esc(f.key)}">
      <td class="tiny"><b>${esc(f.label)}</b></td>
      <td><select class="in ai-fp" style="width:100%">${provOpts(f.provider)}</select></td>
      <td><input class="in ai-fm" placeholder="(global model)" value="${esc(f.model || '')}"></td>
      <td class="num tiny">${f.usage.calls}</td>
      <td class="num tiny">${f.usage.tokens ? f.usage.tokens.toLocaleString() : '—'}</td>
    </tr>`).join('');
    $('#aiFeatTotal').textContent = d.total && d.total.calls ? `· ${d.total.calls} calls, ${d.total.tokens.toLocaleString()} tokens total` : '';
    tbody.querySelectorAll('tr[data-fk]').forEach((tr) => {
      const save = async () => {
        try {
          await api('/api/ai/features', { method: 'POST', body: { feature: tr.dataset.fk, provider: tr.querySelector('.ai-fp').value, model: tr.querySelector('.ai-fm').value.trim() } });
          toast('Feature AI saved', 'ok');
        } catch (e) { toast(e.message, 'err'); }
      };
      tr.querySelector('.ai-fp').addEventListener('change', save);
      tr.querySelector('.ai-fm').addEventListener('change', save);
    });
  } catch (e) { /* non-fatal */ }
}

/* ── 5C (R55) · prompt library management ───────────────────────── */
let __plEditing = 0; // 0 = adding new
async function renderPromptLib() {
  try {
    const d = await api('/api/prompts');
    const box = $('#promptLibList');
    if (!box) return;
    box.innerHTML = (d.list || []).map((p) => `<div class="row-form wrap" style="margin-bottom:6px">
      <b class="tiny" style="flex:none;width:170px">${esc(p.name)}${p.builtin ? ' <span class="muted">(built-in)</span>' : ''}</b>
      <span class="muted tiny" style="flex:1">${esc(String(p.body).slice(0, 80))}</span>
      <button class="btn btn-sm btn-g" data-pid="${p.id}">Edit</button>
      ${p.builtin ? '' : `<button class="btn btn-sm btn-g" data-pdel="${p.id}">Delete</button>`}
    </div>`).join('');
    box.querySelectorAll('[data-pid]').forEach((b) => b.addEventListener('click', () => {
      const p = (d.list || []).find((x) => x.id === Number(b.dataset.pid));
      if (!p) return;
      __plEditing = p.id;
      $('#plName').value = p.name;
      $('#plBody').value = p.body;
      $('#plAdd').textContent = 'Save prompt';
    }));
    box.querySelectorAll('[data-pdel]').forEach((b) => b.addEventListener('click', async () => {
      await api('/api/prompts/' + b.dataset.pdel, { method: 'DELETE' });
      renderPromptLib(); toast('Prompt deleted', 'ok');
    }));
  } catch (e) { /* non-fatal */ }
}
$('#plAdd').addEventListener('click', async () => {
  const name = $('#plName').value.trim(), body = $('#plBody').value.trim();
  if (!name || !body) return toast('Give the prompt a name and some text', 'err');
  try {
    if (__plEditing) await api('/api/prompts/' + __plEditing, { method: 'POST', body: { name, body } });
    else await api('/api/prompts', { method: 'POST', body: { name, body } });
    __plEditing = 0;
    $('#plName').value = ''; $('#plBody').value = '';
    $('#plAdd').textContent = 'Add prompt';
    renderPromptLib(); loadLibPrompts(); toast('Prompt saved', 'ok');
  } catch (e) { toast(e.message, 'err'); }
});

/* ── 5C (R57) · glossary ────────────────────────────────────────── */
async function renderGlossary() {
  try {
    const d = await api('/api/glossary');
    const box = $('#glossaryList');
    if (!box) return;
    const list = d.list || [];
    box.innerHTML = list.length ? list.map((g) => `<div class="row-form wrap" style="margin-bottom:6px">
      <b class="tiny" style="flex:none;width:170px">${esc(g.from_term)} <span class="muted">→</span> ${esc(g.to_term)}</b>
      <span class="muted tiny" style="flex:1">${esc(g.note || '')}</span>
      <button class="btn btn-sm btn-g" data-gdel="${g.id}">Delete</button>
    </div>`).join('') : '<span class="muted tiny">No terms yet — the AI\'s word choices stand unless you add a term.</span>';
    box.querySelectorAll('[data-gdel]').forEach((b) => b.addEventListener('click', async () => {
      await api('/api/glossary/' + b.dataset.gdel, { method: 'DELETE' });
      renderGlossary(); toast('Term removed', 'ok');
    }));
  } catch (e) { /* non-fatal */ }
}
$('#glAdd').addEventListener('click', async () => {
  const from = $('#glFrom').value.trim(), to = $('#glTo').value.trim();
  if (!from || !to) return toast('Both the term and its replacement are needed', 'err');
  try {
    await api('/api/glossary', { method: 'POST', body: { from, to, note: $('#glNote').value.trim() } });
    $('#glFrom').value = ''; $('#glTo').value = ''; $('#glNote').value = '';
    renderGlossary(); toast('Term enforced in translate + templates', 'ok');
  } catch (e) { toast(e.message, 'err'); }
});
$('#set5aSave').addEventListener('click', async () => {
  try {
    await api('/api/settings', { method: 'POST', body: { crossDedupeWindowMin: parseInt($('#setXdedupeWin').value, 10) || 30, sourceEditPolicy: $('#setSourceEdit').value } });
    toast('Pipeline behavior saved', 'ok');
  } catch (e) { toast(e.message, 'err'); }
});
$('#aiSave').addEventListener('click', async () => {
  const btn = $('#aiSave'); btn.classList.add('is-loading');
  try {
    await api('/api/ai', { method: 'POST', body: { provider: $('#aiProvider').value, model: ($('#aiModelCustom').value.trim() || $('#aiModel').value || '').trim(), key: $('#aiKey').value.trim() || undefined } });
    toast('AI settings saved', 'ok');
    loaders.settings();
  } catch (e) { toast(e.message, 'err'); }
  btn.classList.remove('is-loading');
});
$('#aiTest').addEventListener('click', async () => {
  const r = $('#aiTestResult');
  try { await api('/api/ai', { method: 'POST', body: { provider: $('#aiProvider').value, model: ($('#aiModelCustom').value.trim() || $('#aiModel').value || '').trim(), key: $('#aiKey').value.trim() || undefined } }); } catch (e) { return toast(e.message, 'err'); }
  r.textContent = 'Testing…';
  const btn = $('#aiTest'); btn.classList.add('is-loading');
  try {
    const t = await api('/api/ai/test', { method: 'POST' });
    if (t.ok) { r.textContent = `OK — ${t.provider} works — replied "${t.sample}" in ${t.ms} ms (model: ${t.model}) · token verified`; toast('AI connection works', 'ok'); }
    else { r.textContent = `Failed — ${t.error}`; toast('AI test failed', 'err'); }
  } catch (e) { r.textContent = `Failed — ${e.message}`; }
  btn.classList.remove('is-loading');
});
$('#aiPromptSave').addEventListener('click', async () => {
  try { await api('/api/settings', { method: 'POST', body: { aiPrompt: $('#setAiPrompt').value } }); toast('Custom clean-up instruction saved', 'ok'); } catch (e) { toast(e.message, 'err'); }
});
$('#setSave').addEventListener('click', async () => {
  try { await api('/api/settings', { method: 'POST', body: { botName: $('#setBotName').value } }); $('#brandName').textContent = $('#setBotName').value || 'Raqifluz'; toast('Saved', 'ok'); } catch (e) { toast(e.message, 'err'); }
});
$('#setReportSave').addEventListener('click', async () => {
  try { await api('/api/settings', { method: 'POST', body: { reportPhone: $('#setReportPhone').value } }); toast('Report number saved — daily report at 21:00 PKT', 'ok'); } catch (e) { toast(e.message, 'err'); }
});
$('#guardSave').addEventListener('click', async () => {
  try { await api('/api/settings', { method: 'POST', body: { blocklist: $('#setBlocklist').value, maxPerHour: $('#setMaxPerHour').value, replaceRules: $('#setReplace').value, blocklistRegex: $('#setBlocklistRegex').checked } }); toast('Guardrails saved', 'ok'); } catch (e) { toast(e.message, 'err'); }
});
$('#apiKeyRegen').addEventListener('click', async () => {
  const ok = await confirmModal('Regenerate the owner API key?', 'Anything using the old key (scripts, webhooks) stops working immediately.', 'Regenerate', true);
  if (!ok) return;
  try { const r = await api('/api/apikey/regenerate', { method: 'POST' }); $('#apiKeyBox').value = r.apiKey; toast('New API key generated', 'ok'); } catch (e) { toast(e.message, 'err'); }
});
$('#backupNow').addEventListener('click', async () => {
  $('#backupResult').textContent = 'Backing up…';
  try { const r = await api('/api/persist/backup', { method: 'POST' }); $('#backupResult').textContent = r.message; toast('Backup done', 'ok'); }
  catch (e) { $('#backupResult').textContent = ''; toast(e.message, 'err'); }
});

/* ── 21 · FLOATING ASSISTANT ────────────────────────────────────── */
loaders.aichat = async () => {
  const d = await api('/api/ai/chat');
  const st = await api('/api/ai');
  const stateEl = $('#robotState');
  if (stateEl) {
    stateEl.textContent = st.hasKey
      ? st.provider + ' · ' + String(st.model).split('/').pop() + (st.paused ? ' · paused' : '') + ' · control ' + (st.controlOn ? 'ON' : 'OFF')
      : 'no AI key yet — Settings → AI provider';
  }
  const ctl = $('#aiControlToggle');
  if (ctl) ctl.checked = Boolean(st.controlOn);
  const log = $('#robotLog');
  if (!log) return;
  log.innerHTML = (d.list || []).map((m) => {
    const cls = m.role === 'user' ? 'user' : (String(m.content || '').startsWith('tool:') ? 'bot tool' : 'bot');
    return `<div class="bubble ${cls}">${esc(m.content)}<span class="c-time">${(m.ts || '').slice(11, 16)}</span></div>`;
  }).join('')
    || '<p class="muted" style="text-align:center;font-size:var(--t13)">Say hello — with Bot control ON I can act for you (post the missed posts, toggle features…).</p>';
  log.scrollTop = 999999;
};
$('#aiControlToggle').addEventListener('change', async (ev) => {
  try { await api('/api/ai/control', { method: 'POST', body: { on: ev.target.checked } }); toast(ev.target.checked ? 'Bot control ON — the AI can act for you' : 'Bot control OFF — the AI answers questions only', 'ok'); }
  catch (e) { ev.target.checked = !ev.target.checked; toast(e.message, 'err'); }
});
async function sendAiChat() {
  const log = $('#robotLog');
  const inp = $('#robotInput');
  if (!log || !inp) return;
  const msg = inp.value.trim();
  if (!msg) return;
  inp.value = '';
  log.insertAdjacentHTML('beforeend', `<div class="bubble user">${esc(msg)}</div>`);
  log.scrollTop = 999999;
  try {
    const r = await api('/api/ai/chat', { method: 'POST', body: { message: msg } });
    for (const a of (r.actions || [])) {
      log.insertAdjacentHTML('beforeend', `<div class="bubble tool">tool: ${esc(a.tool)} ${esc(JSON.stringify(a.args || {}))} → ${esc(a.ok ? JSON.stringify(a.result) : 'ERROR: ' + a.error)}</div>`);
    }
    log.insertAdjacentHTML('beforeend', `<div class="bubble bot">${esc(r.reply)}</div>`);
  } catch (e) { log.insertAdjacentHTML('beforeend', `<div class="bubble bot">Error: ${esc(e.message)}</div>`); }
  log.scrollTop = 999999;
}
$('#robotSend').addEventListener('click', sendAiChat);
$('#robotInput').addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); sendAiChat(); } });
$('#aiChatClear').addEventListener('click', async () => {
  const ok = await confirmModal('Clear assistant history?', 'The whole chat with the assistant is deleted. Logs keep their tool lines.', 'Clear', true);
  if (!ok) return;
  try { await api('/api/ai/chat', { method: 'DELETE' }); toast('History cleared', 'ok'); loaders.aichat(); } catch (e) { toast(e.message, 'err'); }
});
(function robot() {
  const fab = $('#robotFab');
  const panel = $('#robotPanel');
  const inp = $('#robotInput');
  if (!fab || !panel) return;
  let open = false, suppressClick = false;
  const toggle = async (force) => {
    open = typeof force === 'boolean' ? force : !open;
    panel.hidden = !open;
    if (open) { try { loaders.aichat(); } catch (e) {} inp.focus(); }
  };
  fab.addEventListener('click', () => { if (suppressClick) { suppressClick = false; return; } toggle(); });
  fab.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') toggle(); });
  $('#robotClose').addEventListener('click', (ev) => { ev.stopPropagation(); toggle(false); });
  setInterval(() => { if (open && !panel.hidden) loaders.aichat().catch(() => {}); }, 8000);
  const applyPos = (el, x, y) => {
    const w = el.offsetWidth || 100, h = el.offsetHeight || 100;
    el.style.left = Math.min(Math.max(4, x), Math.max(4, window.innerWidth - w - 4)) + 'px';
    el.style.top = Math.min(Math.max(4, y), Math.max(4, window.innerHeight - h - 4)) + 'px';
    el.style.right = 'auto';
    el.style.bottom = 'auto';
  };
  const makeDraggable = (handle, el, storeKey) => {
    let dragging = false, moved = false, sx = 0, sy = 0, ox = 0, oy = 0;
    handle.addEventListener('pointerdown', (ev) => {
      if (ev.target.closest('button, input, select, a, label')) return;
      dragging = true; moved = false;
      sx = ev.clientX; sy = ev.clientY;
      const r = el.getBoundingClientRect();
      ox = r.left; oy = r.top;
      try { handle.setPointerCapture(ev.pointerId); } catch (e) {}
      ev.preventDefault();
    });
    handle.addEventListener('pointermove', (ev) => {
      if (!dragging) return;
      const dx = ev.clientX - sx, dy = ev.clientY - sy;
      if (Math.abs(dx) + Math.abs(dy) > 4) moved = true;
      if (moved) applyPos(el, ox + dx, oy + dy);
    });
    handle.addEventListener('pointerup', (ev) => {
      if (!dragging) return;
      dragging = false;
      try { handle.releasePointerCapture(ev.pointerId); } catch (e) {}
      if (moved) {
        const r = el.getBoundingClientRect();
        try { localStorage.setItem(storeKey, JSON.stringify({ x: r.left, y: r.top })); } catch (e) {}
        suppressClick = true;
        setTimeout(() => { suppressClick = false; }, 60);
      }
    });
  };
  let pos = null, ppos = null;
  try { pos = JSON.parse(localStorage.getItem('rc-robot-pos') || 'null'); } catch (e) {}
  try { ppos = JSON.parse(localStorage.getItem('rc-panel-pos') || 'null'); } catch (e) {}
  if (pos) applyPos(fab, pos.x, pos.y);
  if (ppos) applyPos(panel, ppos.x, ppos.y);
  makeDraggable(fab, fab, 'rc-robot-pos');
  makeDraggable($('#robotDrag'), panel, 'rc-panel-pos');
  /* quick-action chips */
  const chipsEl = $('#robotChips');
  if (chipsEl) {
    const CHIPS = [
      'What failed today and why?',
      'Publish the missed posts now.',
      'Undo the last post you published.',
      'Show me the bot status.'
    ];
    chipsEl.innerHTML = CHIPS.map((c, i) => `<button class="rchip" data-chip="${i}">${esc(c)}</button>`).join('');
    chipsEl.addEventListener('click', (ev) => {
      const b = ev.target.closest('[data-chip]');
      if (!b) return;
      inp.value = CHIPS[Number(b.dataset.chip)];
      inp.focus();
      try { sendAiChat(); } catch (e) {}
    });
  }
  $('#robotExpand').addEventListener('click', (ev) => { ev.stopPropagation(); panel.classList.toggle('exp'); });
})();

/* ── 22 · COLLAPSIBLE CARDS ─────────────────────────────────────── */
(function collapsibles() {
  const KEY = 'rc-cards';
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch (e) {}
  $$('.view').forEach((view) => {
    const vname = view.dataset.view;
    let idx = 0;
    view.querySelectorAll(':scope > .card').forEach((card) => {
      const header = card.querySelector(':scope > .card-h');
      if (!header) return;
      idx += 1;
      const id = vname + '.' + idx;
      if (!card.querySelector(':scope > .card-b')) {
        const body = document.createElement('div');
        body.className = 'card-b';
        let node = header.nextSibling;
        while (node) { const nx = node.nextSibling; body.appendChild(node); node = nx; }
        card.appendChild(body);
      }
      card.classList.add('collapsible');
      const chev = document.createElement('span');
      chev.className = 'chev';
      chev.innerHTML = '<svg class="icon icon-xs" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>';
      header.appendChild(chev);
      const open = saved[id] != null ? saved[id] : true; // all open by default (data-dense)
      if (!open) card.classList.add('collapsed');
      header.addEventListener('click', (ev) => {
        if (ev.target.closest('button, input, select, a, label')) return;
        const nowOpen = !card.classList.contains('collapsed');
        card.classList.toggle('collapsed', nowOpen);
        saved[id] = !nowOpen;
        try { localStorage.setItem(KEY, JSON.stringify(saved)); } catch (e) {}
      });
    });
  });
})();

/* ── 23 · COMMAND PALETTE + GLOBAL KEYS ─────────────────────────── */
(function palette() {
  const scrim = $('#palScrim'), input = $('#palInput'), list = $('#palList');
  if (!scrim) return;
  let sel = 0;
  const ICONS = { home: 'layout-dashboard', sources: 'radio', browse: 'globe', targets: 'target', routing: 'route', newpost: 'pen', scheduled: 'calendar-clock', approvals: 'inbox', posts: 'file-text', media: 'image', branding: 'layers', aipilot: 'bot', aireply: 'reply', digest: 'languages', guardrails: 'shield', whatsapp: 'chat', journal: 'journal', bulk: 'megaphone', email: 'mail', analytics: 'chart', health: 'pulse', logs: 'terminal', settings: 'settings', audit: 'history', about: 'info' };
  /* pre-Meridian-2 names stay searchable and jump to their one home */
  const LEGACY_NAMES = { dashboard: 'Dashboard', content: 'Content', beautify: 'Beautify', calendar: 'Calendar', templates: 'Templates', 'auto-reply': 'Auto-reply' };
  const ACTIONS = [
    { id: 'act-pause', label: 'Pause / resume all mirroring', icon: 'pause', run: () => { const b = $('#pauseBtn'); if (b) b.click(); } },
    { id: 'act-compose', label: 'Compose a new post', icon: 'pen', run: () => show('newpost') },
    { id: 'act-resync', label: 'Re-sync sources & targets now', icon: 'refresh', run: () => resyncChannels(true) },
    { id: 'act-theme', label: 'Cycle theme (dark / light / auto)', icon: 'sun', run: () => { const b = $('#themeBtn'); if (b) b.click(); } },
    { id: 'act-robot', label: 'Open the AI assistant', icon: 'robot', run: () => { const b = $('#robotFab'); if (b) b.click(); } },
    { id: 'act-settings-ai', label: 'Settings → AI provider', icon: 'bot', run: () => { show('settings'); setTimeout(() => $('#aiProvider').scrollIntoView({ block: 'center' }), 200); } },
    { id: 'act-settings-cloud', label: 'Settings → Cloud memory', icon: 'cloud', run: () => { show('settings'); setTimeout(() => $('#backupNow').scrollIntoView({ block: 'center' }), 200); } }
  ];
  const items = [
    ...ACTIONS,
    ...Object.keys(TITLES).map((v) => ({ id: 'v-' + v, label: TITLES[v], icon: ICONS[v] || 'grid', kind: 'view', run: () => show(v) }))
  ].map((i) => ({ ...i, kind: i.kind || 'action' }));
  /* fuzzy: subsequence match, scored by run-length */
  const fuzzy = (q, s) => {
    q = q.toLowerCase(); s = s.toLowerCase();
    if (!q) return 0;
    let qi = 0, score = 0, streak = 0;
    for (let si = 0; si < s.length && qi < q.length; si++) {
      if (s[si] === q[qi]) { qi += 1; streak += 1; score += streak * 2; }
      else streak = 0;
    }
    return qi === q.length ? score - s.length * 0.1 : -1;
  };
  let searchTimer = null, searchGen = 0;
  const paint = (all) => {
    sel = 0;
    list._hits = all;
    list.innerHTML = all.length
      ? all.map((i, idx) => `<div class="pal-i${idx === 0 ? ' on' : ''}" data-i="${idx}"><span class="pi-ico"></span><span>${esc(i.label)}</span><span class="pal-k">${i.kind}</span></div>`).join('')
      : '<div class="pal-empty">Nothing matches — try “posts”, “template”, “pause”…</div>';
    all.forEach((i, idx) => {
      if (!i.icon) return;
      ico(i.icon).then((svg) => {
        const el = list.querySelector('.pal-i[data-i="' + idx + '"] .pi-ico');
        if (el && el.isConnected) el.innerHTML = svg;
      });
    });
  };
  const render = (q) => {
    const local = items.map((i) => ({ i, sc: fuzzy(q, i.label) })).filter((x) => x.sc >= 0).sort((a, b) => b.sc - a.sc).map((x) => x.i).slice(0, 12);
    paint(local);
    /* 5D (R67): full-text search (FTS5) — posts + logs + chats */
    const query = String(q || '').trim();
    if (query.length < 2) return;
    const gen = ++searchGen;
    clearTimeout(searchTimer);
    searchTimer = setTimeout(async () => {
      try {
        const r = await api('/api/search?q=' + encodeURIComponent(query));
        if (gen !== searchGen) return; // a newer query superseded this one
        const flat = (x) => String(x || '').replace(/\s+/g, ' ');
        const extra = [];
        for (const p of (r.posts || []).slice(0, 6)) extra.push({ icon: 'file-text', kind: 'post', label: flat(p.snippet).slice(0, 70) || 'post #' + p.id, run: () => { show('posts'); const t = $('#pfText'); if (t) { t.value = query; t.dispatchEvent(new Event('input', { bubbles: true })); } } });
        for (const l of (r.logs || []).slice(0, 4)) extra.push({ icon: 'terminal', kind: 'log', label: flat(l.snippet || l.msg).slice(0, 70), run: () => show('logs') });
        for (const c of (r.chats || []).slice(0, 4)) extra.push({ icon: 'chat', kind: 'chat', label: (c.name ? c.name + ' — ' : '') + flat(c.snippet).slice(0, 60), run: () => { show('whatsapp'); setTimeout(() => { try { waOpen(c.chat_jid); } catch (e) {} }, 500); } });
        const base = (list._hits || []).slice(0, 8);
        paint([...base, ...extra].slice(0, 16));
      } catch (e) { /* search is an enhancement — never break the palette */ }
    }, 250);
  };
  const open = () => { scrim.hidden = false; input.value = ''; render(''); input.focus(); };
  const close = () => { scrim.hidden = true; };
  $('#palBtn').addEventListener('click', open);
  scrim.addEventListener('click', (ev) => { if (ev.target === scrim) close(); });
  document.addEventListener('keydown', (ev) => {
    if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'k') { ev.preventDefault(); if (scrim.hidden) open(); else close(); return; }
    if (scrim.hidden) {
      const ae = document.activeElement;
      const typing = ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.isContentEditable);
      if (typing) return;
      if (ev.key === '/') { ev.preventDefault(); open(); }
      else if (ev.key === 'n') { ev.preventDefault(); show('newpost'); }
      else if (ev.key === '?') {
        ev.preventDefault();
        openModal({
          title: 'Keyboard shortcuts', icon: ico('command'),
          html: `<div style="display:grid;gap:8px;font-size:var(--t14)">
            <div><kbd>Ctrl</kbd> <kbd>K</kbd> — command palette (jump anywhere)</div>
            <div><kbd>/</kbd> — open the palette</div>
            <div><kbd>n</kbd> — new post in the Composer</div>
            <div><kbd>Esc</kbd> — close palette / modal / picker</div>
            <div><kbd>?</kbd> — this help</div></div>`,
          primary: false
        });
      }
      return;
    }
    if (ev.key === 'Escape') close();
    else if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
      ev.preventDefault();
      const hits = list._hits || [];
      if (!hits.length) return;
      sel = (sel + (ev.key === 'ArrowDown' ? 1 : hits.length - 1)) % hits.length;
      $$('.pal-i', list).forEach((el, i) => el.classList.toggle('on', i === sel));
      const active = list.querySelector('.pal-i.on');
      if (active) active.scrollIntoView({ block: 'nearest' });
    } else if (ev.key === 'Enter') {
      const it = (list._hits || [])[sel];
      if (it) { close(); it.run(); }
    }
  });
  input.addEventListener('input', () => render(input.value));
  list.addEventListener('click', (ev) => {
    const el = ev.target.closest('.pal-i');
    if (!el) return;
    const it = (list._hits || [])[Number(el.dataset.i)];
    if (it) { close(); it.run(); }
  });
})();

/* ── 23.5 · 5F (R76–R79): chat tools · contacts · broadcast lists · rate caps ── */
function waFillHBar() {
  const bar = $('#waHBar');
  if (!bar) return;
  if (!waActive) { bar.hidden = true; bar.innerHTML = ''; return; }
  bar.hidden = false;
  const pinned = Boolean((waList.find((c) => c.jid === waActive) || {}).pinned);
  bar.innerHTML = [
    ['waha-pin', pinned ? '📌' : '📌', pinned ? 'Unpin chat' : 'Pin chat to the top', pinned ? 'on' : ''],
    ['waha-labels', '🏷️', 'Labels for this chat', ''],
    ['waha-sched', '⏰', 'Schedule a message to this chat', ''],
    ['waha-export', '⬇️', 'Export this chat (txt / csv)', ''],
    ['waha-media', '🖼️', 'All media in this chat', '']
  ].map(([id, t, ti, cls]) => `<button class="wa-hb ${cls}" id="${id}" title="${ti}" aria-label="${ti}">${t}</button>`).join('');
  $('#waha-pin').addEventListener('click', async () => {
    try {
      const r = await api('/api/inbox/' + jidUrl(waActive) + '/pin?' + sessQ(), { method: 'POST' });
      waList.forEach((c) => { if (c.jid === waActive) c.pinned = r.pinned; });
      waRenderList(); waFillHBar(); toast(r.pinned ? 'Chat pinned — it stays at the top of the list.' : 'Chat unpinned.');
    } catch (e) { toast(e.message, 'err'); }
  });
  $('#waha-labels').addEventListener('click', waChatLabels);
  $('#waha-sched').addEventListener('click', waScheduleModal);
  $('#waha-export').addEventListener('click', waExportMenu);
  $('#waha-media').addEventListener('click', waMediaGallery);
}
async function waChatLabels() {
  try {
    const [all, mine] = await Promise.all([api('/api/inbox/labels'), api('/api/inbox/' + jidUrl(waActive) + '/labels?' + sessQ())]);
    const myIds = new Set((mine.list || []).map((x) => x.id));
    openModal({
      title: 'Labels for this chat', icon: ico('tag'), primary: null,
      html: `<p class="muted tiny f-help">Tick the labels that fit this chat — they're saved per chat, per number.</p>
        <div id="waLblList" style="margin-top:10px">` + (all.list || []).map((l) => `
        <label class="wa-lbl-row"><input type="checkbox" data-lbl="${l.id}" ${myIds.has(l.id) ? 'checked' : ''}>
        <span class="wa-lbl-dot" style="background:${esc(l.color || '#007AFF')}"></span><span class="wa-lbl-name">${esc(l.name)}</span>
        <span class="muted tiny wa-lbl-cnt">${l.count || 0} chat(s)</span>
        <button class="btn btn-sm wa-lbl-del" data-del="${l.id}" title="Delete this label everywhere">✕</button></label>`).join('') + (all.list && all.list.length ? '' : '<p class="muted tiny">No labels yet — add one below.</p>') + `</div>
        <div class="row-form" style="margin-top:12px"><input class="in" id="waNewLbl" placeholder="New label name" style="flex:1"><button class="btn" id="waNewLblBtn" style="flex:none">Add label</button></div>`
    });
    $('#waLblList').querySelectorAll('input[type=checkbox]').forEach((cb) => cb.addEventListener('change', async () => {
      try {
        await api('/api/inbox/' + jidUrl(waActive) + '/labels?' + sessQ(), { method: 'POST', body: { labelId: Number(cb.dataset.lbl), on: cb.checked } });
        const cnt = cb.closest('.wa-lbl-row') && cb.closest('.wa-lbl-row').querySelector('.wa-lbl-cnt');
        if (cnt) cnt.textContent = Math.max(0, Number(cnt.textContent || 0) + (cb.checked ? 1 : -1)) + ' chat(s)';
      } catch (e) { cb.checked = !cb.checked; toast(e.message, 'err'); }
    }));
    $('#waNewLblBtn').addEventListener('click', async () => {
      const name = $('#waNewLbl').value.trim();
      if (!name) return;
      try { await api('/api/inbox/labels', { method: 'POST', body: { name } }); toast('Label added', 'ok'); waChatLabels(); } catch (e) { toast(e.message, 'err'); }
    });
    $('#waLblList').querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', (ev) => {
      ev.preventDefault(); ev.stopPropagation();
      if (!window.confirm('Delete this label from every chat?')) return;
      api('/api/inbox/labels/' + b.dataset.del + '/delete', { method: 'POST' }).then(() => { toast('Label deleted'); waChatLabels(); }).catch((e) => toast(e.message, 'err'));
    }));
  } catch (e) { toast(e.message, 'err'); }
}
function waExportMenu() {
  openModal({
    title: 'Export this chat', icon: ico('download'), primary: null,
    html: `<p class="muted tiny f-help">Downloads every archived message in this chat (text, timestamps, senders, media markers).</p>
      <div class="row-actions" style="margin-top:12px">
        <a class="btn btn-p" href="/api/inbox/${jidUrl(waActive)}/export?${sessQ()}&format=txt">Plain text (.txt)</a>
        <a class="btn" href="/api/inbox/${jidUrl(waActive)}/export?${sessQ()}&format=csv">Spreadsheet (.csv)</a>
      </div>`
  });
}
function waScheduleModal() {
  openModal({
    title: 'Schedule a WhatsApp message', icon: ico('clock'), primary: null,
    html: `<p class="muted tiny f-help">The connected number sends this to <b>${esc(shortJid(waActive))}</b> at the picked time (Pakistan time).</p>
      <div class="field" style="margin-top:12px"><label>Message</label><textarea class="in" id="wsText" rows="4" placeholder="What should it say?"></textarea></div>
      <div class="row-form" style="margin-top:12px"><input class="in" id="wsAt" type="datetime-local" style="flex:none;width:auto"></div>
      <div class="field" style="margin-top:12px"><label>Repeat</label>
        <select class="in" id="wsRepeat" style="width:auto">
          <option value="once">Once</option>
          <option value="daily">Every day</option>
          <option value="weekly">Every week (same weekday)</option>
          <option value="weekdays">Weekdays (Mon–Fri)</option>
          <option value="interval">Every N minutes</option>
        </select>
      </div>
      <div class="row-form" id="wsIntRow" hidden style="margin-top:12px"><input class="in" id="wsIntMin" type="number" min="1" max="10080" placeholder="Minutes (1–14400)" style="flex:none;width:auto"></div>
      <div class="row-actions" style="margin-top:12px"><button class="btn btn-p" id="wsAdd">Schedule it</button></div>
      <div id="wsExisting" style="margin-top:14px"></div>`
  });
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
  $('#wsAt').value = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}`;
  $('#wsRepeat').addEventListener('change', () => { $('#wsIntRow').hidden = $('#wsRepeat').value !== 'interval'; });
  $('#wsAdd').addEventListener('click', async () => {
    const text = $('#wsText').value.trim();
    const at = $('#wsAt').value;
    if (!text) { toast('Write the message first.', 'err'); return; }
    if (!at) { toast('Pick the time first.', 'err'); return; }
    try {
      await api('/api/inbox/scheduled', { method: 'POST', body: { session: curNum().id, jid: waActive, text, localAt: at, repeat: $('#wsRepeat').value, intervalMin: $('#wsRepeat').value === 'interval' ? Number($('#wsIntMin').value) : undefined } });
      closeModal(); toast('Scheduled — it will send itself at that time (PKT).', 'ok');
    } catch (e) { toast(e.message, 'err'); }
  });
  api('/api/inbox/scheduled?' + sessQ()).then((d) => {
    const box = $('#wsExisting');
    if (!box || !(d.list || []).length) { if (box) box.innerHTML = ''; return; }
    box.innerHTML = `<h3 style="margin-top:4px;font-size:var(--t14);font-weight:600">Already scheduled</h3>` + (d.list).map((s) => `
      <div class="wa-lbl-row"><input type="checkbox" data-wsen="${s.id}" ${s.enabled ? 'checked' : ''} title="On/off">
      <span class="wa-lbl-name tiny">${esc(shortJid(s.jid))} — ${esc(s.text.slice(0, 40))}${s.text.length > 40 ? '…' : ''}<br><span class="muted tiny">${esc(s.at.slice(0, 16))} PKT · ${esc(s.repeat)}${s.repeat === 'interval' ? ' every ' + s.intervalMin + ' min' : ''}</span></span>
      <button class="btn btn-sm" data-wsdel="${s.id}" title="Remove">✕</button></div>`).join('');
    box.querySelectorAll('input[data-wsen]').forEach((cb) => cb.addEventListener('change', () => api('/api/inbox/scheduled/' + cb.dataset.wsen + '/enable?' + sessQ(), { method: 'POST', body: { on: cb.checked } }).catch((e) => toast(e.message, 'err'))));
    box.querySelectorAll('[data-wsdel]').forEach((b) => b.addEventListener('click', () => api('/api/inbox/scheduled/' + b.dataset.wsdel + '/delete?' + sessQ(), { method: 'POST' }).then(() => waScheduleModal()).catch((e) => toast(e.message, 'err'))));
  }).catch(() => { });
}
async function waMediaGallery() {
  try {
    const d = await api('/api/inbox/' + jidUrl(waActive) + '/media-gallery?' + sessQ());
    const list = d.list || [];
    openModal({
      title: 'Media in this chat', icon: ico('image'), primary: null,
      html: list.length ? `<div class="wa-mediagrid">${list.map((x) => `
        <a class="wa-mcell" href="/api/inbox/${jidUrl(waActive)}/media/${x.id}?${sessQ()}" title="${esc(x.name || x.kind)} — ${esc(fmtWhen(x.ts))}">
          <span class="wa-mkind">${x.kind === 'image' ? '🖼️' : x.kind === 'video' ? '🎬' : (x.kind === 'audio' || x.kind === 'ptt') ? '🎤' : x.kind === 'document' ? '📄' : '📎'}</span>
          <span class="wa-mmeta">${esc((x.name || x.kind).slice(0, 24))}<br><span class="muted tiny">${fmtWhen(x.ts)}${x.bytes ? ' · ' + Math.round(x.bytes / 1024) + ' KB' : ''}</span></span>
        </a>`).join('')}</div>
        <p class="muted tiny" style="margin-top:10px">Tap any item to download it. Media arrives with chat sync and history loads.</p>`
        : '<p class="muted tiny">No media in this chat yet — photos, videos, voice notes and documents show up here as they sync.</p>'
    });
  } catch (e) { toast(e.message, 'err'); }
}
async function waQuickReplies() {
  try {
    const d = await api('/api/inbox/quick-replies');
    openModal({
      title: 'Quick replies', icon: ico('zap'), primary: null,
      html: `<p class="muted tiny f-help">Tap one to drop it into the message box — edit, then send. Keep your most-used lines here.</p>
        <div id="wqrList" style="margin-top:10px">` + (d.list || []).map((q) => `
        <div class="wqr-row"><button class="wqr-use" data-q="${esc(q.text)}">💬 ${esc(q.text.length > 80 ? q.text.slice(0, 80) + '…' : q.text)}</button><button class="btn btn-sm wqr-del" data-del="${q.id}" title="Delete this reply">✕</button></div>`).join('') + (d.list && d.list.length ? '' : '<p class="muted tiny">Nothing saved yet — add your first one below.</p>') + `</div>
        <div class="row-form" style="margin-top:12px"><input class="in" id="wqrNew" placeholder="Add a quick reply…" style="flex:1"><button class="btn" id="wqrAdd" style="flex:none">Add</button></div>`
    });
    $('#wqrList').querySelectorAll('.wqr-use').forEach((b) => b.addEventListener('click', () => {
      const inp = $('#waSendInput');
      inp.value = (inp.value ? inp.value.replace(/\s*$/, ' ') : '') + b.dataset.q;
      closeModal(); inp.focus(); toast('Quick reply inserted — review and press send.', 'ok');
    }));
    $('#wqrList').querySelectorAll('.wqr-del').forEach((b) => b.addEventListener('click', () => {
      api('/api/inbox/quick-replies/' + b.dataset.del + '/delete', { method: 'POST' }).then(() => { toast('Deleted'); waQuickReplies(); }).catch((e) => toast(e.message, 'err'));
    }));
    const addIt = async () => {
      const t = $('#wqrNew').value.trim();
      if (!t) return;
      try { await api('/api/inbox/quick-replies', { method: 'POST', body: { text: t } }); toast('Saved', 'ok'); waQuickReplies(); } catch (e) { toast(e.message, 'err'); }
    };
    $('#wqrAdd').addEventListener('click', addIt);
    $('#wqrNew').addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); addIt(); } });
  } catch (e) { toast(e.message, 'err'); }
}
$('#waQuickBtn').addEventListener('click', waQuickReplies);
async function waContactDetails(jid) {
  try {
    const d = await api('/api/contacts/' + jidUrl(jid) + '?' + sessQ());
    openModal({
      title: d.name || shortJid(jid), icon: ico('users'), primary: null,
      html: `<div class="field"><label>Your note <span class="muted tiny">— private to you, saved to this contact</span></label><textarea class="in" id="cnote" rows="3" placeholder="e.g. Franchisee — follow up Friday">${esc(d.note || '')}</textarea></div>
        <div class="row-actions" style="margin-top:8px"><button class="btn btn-p" id="cnoteSave">Save note</button>${d.noteUpdatedAt ? `<span class="muted tiny" style="align-self:center">updated ${esc(when(d.noteUpdatedAt))}</span>` : ''}</div>
        <h3 style="margin-top:16px;font-size:var(--t14);font-weight:600">Tags</h3>
        <div class="row-form wrap" id="ctagBox" style="margin-top:8px">` + (d.tags || []).map((t) => `
          <label class="wa-lbl-row" style="width:auto"><input type="checkbox" data-ctag="${t.id}" checked><span class="wa-lbl-dot" style="background:var(--accent,#007AFF)"></span>${esc(t.name)}</label>`).join('') + (d.tags && d.tags.length ? '' : '<span class="muted tiny">No tags yet.</span>') + `</div>
        <div class="row-form" style="margin-top:8px"><input class="in" id="ctagNew" placeholder="Add a tag…" style="flex:1"><button class="btn" id="ctagAdd" style="flex:none">Tag</button></div>
        <h3 style="margin-top:16px;font-size:var(--t14);font-weight:600">Timeline <span class="muted tiny">— recent activity for this number</span></h3>
        <div id="ctimeline" style="margin-top:8px">${(d.timeline || []).map((t) => `<div class="wqr-row"><span class="muted tiny" style="flex:none;width:120px">${esc(when(t.ts))}</span><span class="tiny">${esc(t.kind)}${t.text ? ' — ' + esc(t.text.slice(0, 120)) : ''}</span></div>`).join('') || '<p class="muted tiny">No activity recorded yet — notes, calls and synced messages will appear here.</p>'}</div>`
    });
    $('#cnoteSave').addEventListener('click', async () => {
      try { await api('/api/contacts/' + jidUrl(jid) + '/note?' + sessQ(), { method: 'POST', body: { note: $('#cnote').value } }); toast('Note saved', 'ok'); } catch (e) { toast(e.message, 'err'); }
    });
    $('#ctagBox').querySelectorAll('input[type=checkbox]').forEach((cb) => cb.addEventListener('change', async () => {
      try { await api('/api/contacts/' + jidUrl(jid) + '/tags?' + sessQ(), { method: 'POST', body: { tagId: Number(cb.dataset.ctag), on: cb.checked } }); } catch (e) { cb.checked = !cb.checked; toast(e.message, 'err'); }
    }));
    $('#ctagAdd').addEventListener('click', async () => {
      const name = $('#ctagNew').value.trim();
      if (!name) return;
      try {
        const r = await api('/api/contacts/tags', { method: 'POST', body: { name } });
        if (r.id) await api('/api/contacts/' + jidUrl(jid) + '/tags?' + sessQ(), { method: 'POST', body: { tagId: r.id, on: true } });
        toast('Tag added', 'ok'); waContactDetails(jid);
      } catch (e) { toast(e.message, 'err'); }
    });
  } catch (e) { toast(e.message, 'err'); }
}
$('#waContactsCsv').addEventListener('click', () => { window.location.href = '/api/contacts.csv?' + sessQ(); });
$('#waContactsDupes').addEventListener('click', async () => {
  try {
    const d = await api('/api/contacts/dupes?' + sessQ());
    const grp = (title, items) => items.length ? `<h3 style="margin-top:14px;font-size:var(--t14);font-weight:600">${title} <span class="muted tiny">— ${items.length} group(s)</span></h3>` + items.map((g) => `
      <div class="dup-g"><div class="muted tiny" style="margin-top:8px">“${esc(g[0].name || '+' + g[0].phone)}” appears ${g.length}×</div>
      ${g.map((x) => `<div class="dup-row">👤 <b>${esc(x.name || '—')}</b> <span class="muted">+${esc(x.phone)}</span></div>`).join('')}</div>`).join('') : '';
    const none = !d.byName.length && !d.byPhone.length;
    openModal({
      title: 'Duplicate finder', icon: ico('search'), primary: null,
      html: none ? '<p class="muted tiny">No duplicates found — every name and every number is unique. 🎉</p>'
        : '<p class="muted tiny f-help">Same person under slightly different names, or one number saved twice. Nothing is changed — review and clean up in your phone’s address book.</p>' + grp('Same name, different numbers', d.byName) + grp('Same number, saved more than once', d.byPhone)
    });
  } catch (e) { toast(e.message, 'err'); }
});
$('#bcNewList').addEventListener('click', () => bcListModal(null));
/* ── R79: per-target caps + regex blocklist + per-rule replace toggles ── */
async function loadGuardTargets() {
  const tb = $('#grTargetsTable tbody');
  if (!tb) return;
  try {
    const d = await api('/api/guardrates');
    if (!(d.targets || []).length) { tb.innerHTML = '<tr><td colspan="3" class="muted tiny" style="padding:12px">No target channels saved yet — add them in Channel Targets, then cap them here.</td></tr>'; return; }
    tb.innerHTML = d.targets.map((t) => `
      <tr><td><b>${esc(t.name)}</b><div class="muted tiny">${esc(t.jid)}</div></td>
      <td class="num"><span class="muted tiny">${t.lastHour} sent in the last hour</span></td>
      <td class="num"><input class="in" type="number" min="0" max="500" data-gtr="${esc(t.jid)}" value="${t.max}" style="width:88px" title="0 = follow the global guard above"></td></tr>`).join('');
  } catch (e) { toast(e.message, 'err'); }
}
$('#grSave').addEventListener('click', async () => {
  const targets = {};
  $$('#grTargetsTable [data-gtr]').forEach((i) => { targets[i.dataset.gtr] = i.value; });
  try { await api('/api/guardrates', { method: 'POST', body: { targets } }); toast('Per-target rate caps saved', 'ok'); } catch (e) { toast(e.message, 'err'); }
});
function renderReplaceRules() {
  const box = $('#replaceRulesBox');
  const ta = $('#setReplace');
  if (!box || !ta) return;
  const lines = ta.value.split('\n').map((l) => l.trim()).filter(Boolean);
  if (!lines.length) { box.innerHTML = ''; return; }
  box.innerHTML = `<div class="rr-box">` + lines.map((line) => {
    const disabled = line.startsWith('- ');
    const body = disabled ? line.slice(2) : line;
    const i = body.indexOf('=>');
    const oldT = i === -1 ? body : body.slice(0, i);
    const newT = i === -1 ? '' : body.slice(i + 2);
    return `<label class="rr-row ${disabled ? 'off' : ''}">
      <input type="checkbox" data-rron ${disabled ? '' : 'checked'} title="Untick to pause this rule (it stays saved)">
      <input class="in rr-old" value="${esc(oldT)}" placeholder="find">
      <span class="muted">→</span>
      <input class="in rr-new" value="${esc(newT)}" placeholder="replace with (empty = delete)">
      <button class="btn btn-sm rr-del" title="Remove this rule">✕</button>
    </label>`;
  }).join('') + `<button class="btn btn-sm" id="rrAdd" style="margin-top:8px">＋ Add a rule</button></div>`;
  const rebuild = () => {
    ta.value = $$('#replaceRulesBox .rr-row').map((r) =>
      (r.querySelector('[data-rron]').checked ? '' : '- ') + r.querySelector('.rr-old').value + '=>' + r.querySelector('.rr-new').value
    ).join('\n');
  };
  box.querySelectorAll('.rr-old, .rr-new, [data-rron]').forEach((el) => el.addEventListener('input', rebuild));
  box.querySelectorAll('[data-rron]').forEach((el) => el.addEventListener('change', rebuild));
  const add = () => { ta.value = (ta.value.trim() ? ta.value.replace(/\n?$/, '\n') : '') + 'find=>replace'; renderReplaceRules(); const last = box.querySelector('.rr-old:last-of-type'); if (last) last.focus(); };
  $('#rrAdd').addEventListener('click', add);
  box.querySelectorAll('.rr-del').forEach((b) => b.addEventListener('click', (ev) => { ev.preventDefault(); b.closest('.rr-row').remove(); rebuild(); renderReplaceRules(); }));
}

/* ── 25 · 5G — RSS FEED CARD (R82) ─────────────────────────────── */
(async function () {
  const $t = $('#rssTest'), $a = $('#rssAdd');
  if (!$t || !$a) return;
  const out = $('#rssTestResult');
  $t.addEventListener('click', async () => {
    const url = $('#rssUrl').value.trim();
    if (!url) return toast('Paste the feed URL first.', 'err');
    $t.disabled = true; out.textContent = 'Fetching…';
    try {
      const d = await api('/api/rss/test?url=' + encodeURIComponent(url));
      out.innerHTML = `<b style="color:var(--ok)">✓ Feed OK — ${d.items} item(s)</b> · future ID ${esc(d.jid)}<br>` + (d.sample || []).map((s) => '· ' + esc(s.title || '') + ' — ' + esc(s.ts || '')).join('<br>');
    } catch (e) { out.textContent = '✗ ' + e.message; }
    $t.disabled = false;
  });
  $a.addEventListener('click', async () => {
    const url = $('#rssUrl').value.trim(), name = $('#rssName').value.trim();
    if (!url) return toast('Paste the feed URL first.', 'err');
    if (!name) return toast('Name the feed first.', 'err');
    $a.disabled = true;
    try {
      const d = await api('/api/sources/rss', { method: 'POST', body: { url, name } });
      toast(`Feed “${name}” added — it fetches every 15 minutes.`, 'ok');
      $('#rssUrl').value = ''; $('#rssName').value = ''; out.textContent = '';
      refreshChannels('sources', {});
    } catch (e) { toast(e.message, 'err'); }
    $a.disabled = false;
  });
})();

/* ── 26 · 5G — OUTGOING WEBHOOKS (R80) ─────────────────────────── */
const HOOK_EVENTS = {
  'post.published': 'A post went out to at least one target',
  'post.failed': 'A post failed (with the reason)',
  'post.queued': 'A post entered the approval queue',
  'bulk.sent': 'A bulk / saved-list send finished',
  'wasched.sent': 'A scheduled personal WhatsApp send went out',
  'panic.on': 'Panic stop engaged — everything paused',
  'panic.off': 'Panic stop restored — exact states back',
  'alert': 'An instant alert fired'
};
async function loadHooks() {
  const box = $('#hookList');
  if (!box) return;
  let d;
  try { d = await api('/api/webhooks'); } catch (e) { box.innerHTML = `<p class="muted tiny">Could not load webhooks: ${esc(e.message)}</p>`; return; }
  const evs = (d.events || Object.entries(HOOK_EVENTS)).map((e) => Array.isArray(e) ? e : [e, HOOK_EVENTS[e] || '']);
  $('#hookEventPick').innerHTML = evs.map(([k, label]) =>
    `<label class="chk"><input type="checkbox" class="hook-ev" value="${k}"> <span class="mono tiny">${k}</span> <span class="muted tiny">— ${esc(label)}</span></label>`
  ).join('');
  const list = d.list || [];
  if (!list.length) {
    box.innerHTML = `<p class="muted tiny">No webhooks yet — <b>nothing is being sent anywhere</b> (off by default). Add one below when you want notifications at your own endpoint.</p>`;
    return;
  }
  box.innerHTML = `<table class="t"><thead><tr><th>Name</th><th class="mono">Endpoint</th><th>Events</th><th>Last result</th><th></th></tr></thead><tbody>` +
    list.map((w) => `
    <tr>
      <td><b>${esc(w.name)}</b>${w.enabled ? '' : ' <span class="b b-warn">disabled</span>'}</td>
      <td class="mono tiny" title="${esc(w.url)}">${esc(w.url.length > 46 ? w.url.slice(0, 43) + '…' : w.url)}</td>
      <td><div class="ch-sub mono">${w.events.map((e) => `<span class="b b-info">${e}</span>`).join(' ')}</div></td>
      <td class="tiny">${esc(w.last_status || '— yet —')}${w.last_at ? `<div class="muted">at ${when(w.last_at)}</div>` : ''}</td>
      <td><div class="ra">
        <button class="btn btn-sm" data-hact="test" data-id="${w.id}" title="Send one test POST to this endpoint now">Test</button>
        <button class="btn btn-sm" data-hact="toggle" data-id="${w.id}">${w.enabled ? 'Disable' : 'Enable'}</button>
        <button class="btn btn-sm btn-d" data-hact="del" data-id="${w.id}">Remove</button>
      </div></td>
    </tr>`).join('') + `</tbody></table>`;
  box.querySelectorAll('[data-hact]').forEach((b) => b.addEventListener('click', async () => {
    const id = Number(b.dataset.id), act = b.dataset.hact;
    if (act === 'toggle') {
      const w = list.find((x) => x.id === id);
      try { await api(`/api/webhooks/${id}/enable`, { method: 'POST', body: { on: !w.enabled } }); toast(w.enabled ? 'Webhook disabled — it will no longer receive anything.' : 'Webhook enabled.', 'ok'); } catch (e) { toast(e.message, 'err'); }
      loadHooks(); return;
    }
    if (act === 'del') {
      if (!confirm('Remove this webhook? It stops receiving immediately.')) return;
      try { await api(`/api/webhooks/${id}/delete`, { method: 'POST' }); toast('Webhook removed.', 'ok'); } catch (e) { toast(e.message, 'err'); }
      loadHooks(); return;
    }
    if (act === 'test') {
      b.disabled = true; b.textContent = '…';
      try {
        const d2 = await api(`/api/webhooks/${id}/test`, { method: 'POST' });
        toast(d2.result?.ok ? `Test delivered (HTTP ${d2.result.status}).` : 'Test delivered but the endpoint rejected it.', d2.result?.ok ? 'ok' : 'err');
      } catch (e) { toast('Test failed: ' + e.message, 'err'); }
      loadHooks();
    }
  }));
}
function wireHookAdd() {
  const $a = $('#hookAdd');
  if (!$a) return;
  $a.addEventListener('click', async () => {
    const name = $('#hookName').value.trim(), url = $('#hookUrl').value.trim();
    const events = $$('#hookEventPick .hook-ev:checked').map((c) => c.value);
    if (!name) return toast('Name the webhook (e.g. “Zapier”).', 'err');
    if (!url) return toast('Paste the endpoint URL.', 'err');
    if (!events.length) return toast('Pick at least one event.', 'err');
    $a.disabled = true;
    try {
      await api('/api/webhooks', { method: 'POST', body: { name, url, events } });
      toast(`Webhook “${name}” added — it now receives ${events.length} event type(s).`, 'ok');
      $('#hookName').value = ''; $('#hookUrl').value = '';
      loadHooks();
    } catch (e) { toast(e.message, 'err'); }
    $a.disabled = false;
  });
}

/* ── 27 · 5G — API EXPLORER (R81) ────────────────────────────────
   Every endpoint the dashboard uses, grouped, with its real method.
   “Try it” runs the call from YOUR session and shows the raw response.
   Endpoints that need a request body are not fired with a guessed one —
   the body template is shown instead (safe by default, R10). */
const API_EXPLORER = [
  ['Overview', [
    ['GET', '/api/overview', 'Dashboard numbers + latest activity', null],
    ['GET', '/api/status', 'Bot status used by the top bar', null]
  ]],
  ['Channels', [
    ['GET', '/api/sources', 'All followed sources', null],
    ['GET', '/api/targets', 'All target channels', null],
    ['GET', '/api/directory', 'Known channels from your phone', null],
    ['GET', '/api/matrix', 'Routing matrix state', null],
    ['GET', '/api/rss/test', 'Test that a URL is a working feed', { url: 'https://example.com/feed' }],
    ['POST', '/api/sources/rss', 'Add an RSS/Atom feed source', { name: 'Dawn Business', url: 'https://example.com/feed' }]
  ]],
  ['Queue & posts', [
    ['GET', '/api/queue', 'Approval queue items', null],
    ['POST', '/api/queue/approve-all', 'Approve every queued post now', {}],
    ['GET', '/api/posts', 'Published posts history', null],
    ['POST', '/api/posts/undo-last', 'Undo the last published post (per target)', {}]
  ]],
  ['Scheduler', [
    ['GET', '/api/scheduled', 'Scheduled posts', null],
    ['GET', '/api/wa-scheduled', 'Personal WhatsApp send schedules', null],
    ['POST', '/api/wa-scheduled', 'Add a scheduled personal WhatsApp send', { jid: '12345@s.whatsapp.net', text: 'Hi', at: '2026-11-08T14:00:00Z', repeat: 'once' }]
  ]],
  ['Guardrails', [
    ['GET', '/api/guardrates', 'Per-target rate limits', null],
    ['POST', '/api/guardrates', 'Save per-target rate limits', { 'guard.maxperhour.12345@g.us': '10' }],
    ['GET', '/api/panic', 'Panic stop state', null],
    ['POST', '/api/panic/stop', 'ENGAGE panic stop — pauses everything', {}],
    ['POST', '/api/panic/restore', 'Restore panic stop — exact previous states', {}]
  ]],
  ['Outgoing webhooks', [
    ['GET', '/api/webhooks', 'Your webhooks + last results', null],
    ['POST', '/api/webhooks', 'Add a webhook', { name: 'Zapier', url: 'https://example.com/hook', events: ['post.published'] }],
    ['POST', '/api/webhooks/1/test', 'Send one test POST to webhook #1', {}],
    ['POST', '/api/webhooks/1/enable', 'Enable/disable webhook #1', { on: true }]
  ]],
  ['Inbox & contacts', [
    ['GET', '/api/inbox', 'Chats', null],
    ['GET', '/api/inbox/labels', 'Chat labels', null],
    ['GET', '/api/inbox/scheduled', 'Scheduled chat messages', null],
    ['GET', '/api/contacts', 'Contacts', null],
    ['GET', '/api/contacts/dupes', 'Duplicate-contact helper', null],
    ['GET', '/api/broadcast', 'Saved broadcast lists', null]
  ]],
  ['System', [
    ['GET', '/api/health', 'Health v2', null],
    ['GET', '/api/audit', 'Audit trail', null],
    ['GET', '/api/backup/download', 'Download the full backup zip', null],
    ['GET', '/api/settings', 'All settings', null],
    ['POST', '/api/settings', 'Save a setting', { key: 'bot.name', value: 'Raqifluz' }]
  ]]
];
function renderApiExplorer(filter) {
  const box = $('#apiExList');
  if (!box) return;
  const q = String(filter || '').toLowerCase();
  box.innerHTML = API_EXPLORER.map(([group, rows], gi) => {
    const rs = rows.map((row, i) => ({ row, i })).filter(({ row: [, p, d] }) => !q || (p + ' ' + d + ' ' + group).toLowerCase().includes(q));
    if (!rs.length) return '';
    return `<div class="apiex-g">${esc(group)}</div>` + rs.map(({ row: [m, p, d, params], i }) => `
      <div class="apiex-row">
        <span class="b ${m === 'GET' ? 'b-info' : 'b-warn'} mono" style="flex:none">${m}</span>
        <code class="apiex-p mono tiny" title="${esc(p)}">${esc(p)}</code>
        <span class="muted tiny apiex-d">${esc(d)}${params ? ' <span class="muted">· needs a body</span>' : ''}</span>
        <button class="btn btn-sm" data-apiex="${gi}|${i}" style="flex:none">${params ? 'Show body' : 'Try it'}</button>
      </div>`).join('');
  }).join('') || '<p class="muted tiny">No endpoint matches that filter.</p>';
  box.querySelectorAll('[data-apiex]').forEach((b) => b.addEventListener('click', async () => {
    const [gi, ii] = b.dataset.apiex.split('|');
    const entry = API_EXPLORER[Number(gi)][1][Number(ii)];
    const [m, p, d, params] = entry;
    if (params) { showApiResult(m + ' ' + p, 'This endpoint needs a request body. It was NOT called with a guessed one — send it from the corresponding UI button, or from your own tool with a body like:', JSON.stringify(params, null, 2)); return; }
    b.disabled = true; b.textContent = '…';
    try {
      if (p === '/api/backup/download') {
        const r = await fetch(p, { headers: TOKEN ? { Authorization: 'Bearer ' + TOKEN } : {} });
        const blob = await r.blob();
        b.textContent = 'Try it';
        showApiResult(m + ' ' + p, `Binary response (${r.headers.get('content-type') || 'application/octet-stream'}, ${blob.size.toLocaleString()} bytes, HTTP ${r.status}) — a full backup zip. Opening it here would start a download, so the raw body is not shown.`);
      } else {
        const resp = await api(p);
        b.textContent = 'Try it';
        showApiResult(m + ' ' + p, JSON.stringify(resp, null, 2));
      }
    } catch (e) {
      b.textContent = 'Try it';
      showApiResult(m + ' ' + p, 'Error: ' + e.message, true);
    }
  }));
}
function showApiResult(title, note, text, isErr) {
  let box = $('#apiExResult');
  if (!box) {
    box = document.createElement('div');
    box.id = 'apiExResult';
    const list = $('#apiExList');
    if (list) list.after(box);
  }
  box.innerHTML = `<div class="apiex-res${isErr ? ' err' : ''}"><div class="apiex-res-h"><span class="mono tiny">${esc(title)}</span><button class="btn btn-sm" id="apiExClose">Close</button></div>${note ? `<p class="muted tiny">${esc(note)}</p>` : ''}<pre class="mono tiny">${esc(String(text).slice(0, 4000))}</pre></div>`;
  box.querySelector('#apiExClose').addEventListener('click', () => box.remove());
}

/* ── 29 · 5H — AUTOMATION: WA command channel + auto-pilot (R85/R87) ── */
async function loadAutomation() {
  const $pin = $('#waPin');
  if (!$pin) return;
  try {
    const d = await api('/api/wacommand');
    $('#waPinState').innerHTML = d.pinSet
      ? '<b style="color:var(--ok)">PIN is set</b> — destructive commands are armed.'
      : 'No PIN yet — destructive commands (undo / pause / panic) stay disabled until you set one.';
    if (d.ownJid) $('#waPinState').innerHTML += ` Commands work when you message <b>${esc(d.ownJid)}</b> (your own number).`;
    const tb = $('#waCmdTable tbody');
    if (tb) tb.innerHTML = d.commands.map(([c, desc]) => `<tr><td class="mono">${esc(c)}</td><td class="tiny">${esc(desc)}</td></tr>`).join('');
  } catch (e) { /* non-fatal */ }
  try {
    const a = await api('/api/autopilot');
    const $max = $('#apMax');
    if ($max && document.activeElement !== $max) $max.value = a.maxDay;
    const st = $('#apState');
    if (st) st.textContent = a.last ? `Last pass: ${a.last.action} — ${a.last.detail}` : 'No pass yet — it runs hourly while ON.';
    const lb = $('#apLog tbody');
    if (lb) lb.innerHTML = a.log.length ? a.log.map((r) => `<tr><td class="tiny num">${when(r.at)}</td><td class="mono tiny">${esc(r.action)}</td><td class="tiny">${esc(r.detail)}</td></tr>`).join('') : '<tr><td colspan="3" class="muted tiny">The pilot has not run yet — turn it on and it logs every action here (daily cap included).</td></tr>';
  } catch (e) { /* non-fatal */ }
}
function wireAutomation() {
  const $save = $('#waPinSave');
  if ($save) $save.addEventListener('click', async () => {
    const pin = $('#waPin').value.trim();
    try { await api('/api/wacommand', { method: 'POST', body: { pin } }); toast(pin ? 'PIN saved — destructive commands armed.' : 'PIN cleared — destructive commands disabled.', 'ok'); loadAutomation(); }
    catch (e) { toast(e.message, 'err'); }
  });
  const $ap = $('#apSave');
  if ($ap) $ap.addEventListener('click', async () => {
    const maxDay = parseInt($('#apMax').value, 10);
    if (!maxDay || maxDay < 1) return toast('Enter the daily action cap (1–100).', 'err');
    try { await api('/api/autopilot', { method: 'POST', body: { maxDay } }); toast('Auto-pilot cap saved.', 'ok'); loadAutomation(); }
    catch (e) { toast(e.message, 'err'); }
  });
}

/* ── 30 · 5H — EVERGREEN RECYCLING (R86) ───────────────────────── */
async function loadEgr() {
  const $q = $('#egrQuota');
  if (!$q) return;
  try {
    const d = await api('/api/evergreen');
    if (document.activeElement !== $q) $q.value = d.quota;
    if (document.activeElement !== $('#egrMinAge')) $('#egrMinAge').value = d.minAgeDays;
    $('#egrState').textContent = `Today: ${d.usedToday}/${d.quota} used · ${d.total} total · ${d.last ? 'last: ' + when(d.last.at) : 'never recycled yet'}`;
    const lb = $('#egrLog tbody');
    if (lb) lb.innerHTML = d.log.length ? d.log.map((r) => `<tr><td class="tiny num">${when(r.at)}</td><td class="tiny" style="max-width:420px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(r.body)}">${esc(r.body)}</td><td class="num tiny">${r.targets}</td></tr>`).join('') : '<tr><td colspan="3" class="muted tiny">Nothing recycled yet — turn the Evergreen switch on (above) and the 30-min tick starts within an hour.</td></tr>';
  } catch (e) { /* non-fatal */ }
}
function wireEgr() {
  const $save = $('#egrSave');
  if (!$save) return;
  $save.addEventListener('click', async () => {
    const quota = parseInt($('#egrQuota').value, 10);
    const minAge = parseInt($('#egrMinAge').value, 10);
    if (isNaN(quota) || isNaN(minAge)) return toast('Fill both numbers (per day + older than).', 'err');
    try { await api('/api/evergreen', { method: 'POST', body: { quota, minAge } }); toast('Evergreen settings saved.', 'ok'); loadEgr(); }
    catch (e) { toast(e.message, 'err'); }
  });
}

/* ── 31 · 5H — PLAN MY WEEK → Approval Queue drafts (R88) ──────── */
function wirePlanWeek() {
  const $b = $('#planWeekBtn');
  if (!$b) return;
  $b.addEventListener('click', async () => {
    const msg = $('#planWeekMsg');
    $b.disabled = true; msg.textContent = 'The AI is planning your week (10–30 s)…';
    try {
      const d = await api('/api/plan-week', { method: 'POST' });
      msg.textContent = '';
      openModal({
        title: 'Your week is planned', icon: ico('calendar'),
        html: `<p class="muted tiny">${d.planned} drafts are in the <b>Approval Queue</b> — nothing is published until you approve. Edit or reject any of them there.</p>
          <div style="margin-top:12px;max-height:340px;overflow:auto">` +
          d.items.map((x, i) => `<div style="border:1px solid var(--bd);border-radius:10px;padding:8px 10px;margin-bottom:8px"><b class="tiny">Day ${i + 1}</b><div class="tiny" style="margin-top:4px">${esc(x.text)}</div></div>`).join('') +
          `</div>`,
        primaryLabel: 'Open the Approval Queue',
        primary: () => { show('approvals'); return false; }
      });
      toast(`${d.planned} week drafts are in the Approval Queue.`, 'ok');
    } catch (e) {
      $b.disabled = false;
      msg.textContent = '✗ ' + e.message;
    }
  });
}

/* ── 28 · 5G — PWA (R83) ───────────────────────────────────────── */
(function () {
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('/sw.js').catch(() => { /* non-HTTPS preview etc. — dashboard still works fully */ });
  }
})();

/* ── 32 · 5I — MEDIA LIBRARY (I2) ──────────────────────────────── */
const __ml = { kind: '', q: '', session: 'main' };
async function loadMediaLib() {
  const grid = $('#mlGrid');
  if (!grid) return;
  grid.innerHTML = '';
  const d = await api('/api/media-lib?kind=' + encodeURIComponent(__ml.kind) + '&q=' + encodeURIComponent(__ml.q) + '&session=' + encodeURIComponent(__ml.session));
  const list = d.list || [];
  $('#mlCount').textContent = d.total + ' item(s)';
  $('#mlEmpty').style.display = list.length ? 'none' : '';
  grid.innerHTML = list.map((m) => {
    const isImg = m.kind === 'image' || /image\//.test(m.mime || '');
    const thumb = isImg
      ? `<img loading="lazy" src="/api/media-lib/download?ref=${encodeURIComponent(m.ref)}" alt="${esc(m.name || 'image')}" onerror="this.parentElement.innerHTML='<span class=\\'icon\\'>🖼</span>'">`
      : (m.kind === 'video' ? '🎬' : m.kind === 'audio' ? '🎵' : '📄');
    const from = m.src === 'chat' ? (chanName({ jid: m.jid, name: '' }) || shortJid(m.jid)) : 'Queued post media';
    return `<div class="ml-tile" data-ref="${esc(m.ref)}">
      <div class="ml-thumb">${thumb}</div>
      <div class="ml-meta"><div class="ml-name" title="${esc(m.name || m.ref)}">${esc(m.name || 'file')}</div><div class="ml-sub" title="${esc(from)}">${esc(from)} · ${(m.bytes / 1048576).toFixed(1)} MB</div></div>
      <div class="ml-acts">
        <a class="btn btn-g" href="/api/media-lib/download?ref=${encodeURIComponent(m.ref)}" title="Download the original file">↓ Get</a>
        <button class="btn btn-g ml-del" title="Remove from storage (manual only — nothing is auto-deleted)">✕</button>
      </div></div>`;
  }).join('');
  grid.querySelectorAll('.ml-del').forEach((b) => b.addEventListener('click', async () => {
    const ref = b.closest('.ml-tile').dataset.ref;
    const ok = await confirmModal('Remove this media?', 'It is removed from the dashboard storage. Published posts on the channel are NOT affected.', 'Remove', true);
    if (!ok) return;
    try { await api('/api/media-lib/delete', { method: 'POST', body: { ref } }); toast('Removed from storage', 'ok'); loadMediaLib(); }
    catch (e) { toast(e.message, 'err'); }
  }));
}
function wireMediaLib() {
  const $k = $('#mlKind'), $q = $('#mlSearch'), $s = $('#mlSession');
  if (!$k) return;
  $k.addEventListener('change', () => { __ml.kind = $k.value; loadMediaLib(); });
  let t;
  $q.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => { __ml.q = $q.value.trim(); loadMediaLib(); }, 350); });
  $s.addEventListener('change', () => { __ml.session = $s.value; loadMediaLib(); });
  $('#mlRefresh').addEventListener('click', () => loadMediaLib());
  /* fill the session picker from the connected numbers (main + any extra) */
  api('/api/numbers').then((d) => {
    const ids = (d.list || []).map((x) => x.id).filter(Boolean);
    if (ids.length > 1) $s.innerHTML = ids.map((n) => `<option value="${esc(n)}">${esc(n)}</option>`).join('');
  }).catch(() => { });
}
/* Meridian 2: Library = media grid + templates + card maker (one screen) */
loaders.media = async () => { await loadMediaLib(); await loaders.templates(); };

/* ── 32 · 5I — ANNOUNCEMENT CARD (I4) ──────────────────────────── */
async function openCardModal(p) {
  const body = String(p.body || '');
  const firstLine = body.split('\n').find((l) => l.trim().length >= 8) || body.slice(0, 60);
  const title = (firstLine || 'Announcement').replace(/[*_~#]/g, '').trim().slice(0, 120);
  const srcName = p.source_name || '';
  openModal({
    title: 'Announcement card',
    html: `<div class="muted tiny" style="margin-bottom:8px">A branded 1080×1080 card, rendered on the server with zero dependencies — SVG source + PNG. Nothing is attached to any post automatically.</div>
      <div class="field"><label>Card title</label><input class="in" id="cardTitle" value="${esc(title)}"></div>
      <div class="field"><label>Card text</label><textarea class="in" id="cardBody" rows="4">${esc(body.slice(0, 700))}</textarea></div>
      <div class="row-form" style="margin-top:10px">
        <input class="in" id="cardSource" value="${esc(srcName)}" placeholder="Source name" style="flex:1">
        <input class="in" id="cardFooter" value="${esc((document.querySelector('#signatureInput') || {}).value || '')}" placeholder="Footer line" style="flex:1">
      </div>
      <div class="row-actions" style="margin-top:12px">
        <button class="btn btn-p" id="cardPng">⬇ Download PNG</button>
        <button class="btn" id="cardSvg">⬇ Download SVG</button>
      </div>
      <div class="muted tiny" id="cardBusy" style="margin-top:8px;display:none">Rendering on the server…</div>`,
    actions: false
  });
  const params = () => ({
    title: $('#cardTitle').value.slice(0, 200),
    body: $('#cardBody').value.slice(0, 1500),
    source: $('#cardSource').value.slice(0, 80),
    footer: $('#cardFooter').value.slice(0, 80),
    date: new Date().toISOString().slice(0, 10)
  });
  const download = (url, filename) => {
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
  };
  const pngBtn = $('#cardPng');
  pngBtn.addEventListener('click', async () => {
    $('#cardBusy').style.display = '';
    try {
      const r = await fetch('/api/card', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(params()) });
      if (!r.ok) throw new Error((await r.json()).error || 'Render failed');
      const blob = await r.blob();
      const u = URL.createObjectURL(blob);
      download(u, 'announcement-card.png');
      setTimeout(() => URL.revokeObjectURL(u), 30e3);
      toast('Card rendered — PNG downloaded', 'ok');
    } catch (e) { toast(e.message, 'err'); }
    $('#cardBusy').style.display = 'none';
  });
  $('#cardSvg').addEventListener('click', () => {
    const q = new URLSearchParams(params()).toString();
    download('/api/card-svg?' + q, 'announcement-card.svg');
  });
}

/* ── 32 · 5I — HASHTAG FREQUENCY (I6) ──────────────────────────── */
let __hasTop = [];
async function loadHasFreq() {
  const box = $('#hasFreqList');
  if (!box) return;
  const days = $('#hasFreqDays').value;
  try {
    const d = await api('/api/hashtags/freq?days=' + days);
    __hasTop = d.list || [];
    $('#hasFreqMeta').textContent = d.posts + ' own post(s) in the last ' + days + ' day(s)';
    box.innerHTML = __hasTop.length
      ? __hasTop.map((h) => `<span class="b b-info" style="cursor:default" title="Used ${h.n}× in your published posts">#${esc(h.tag.slice(1))} <b class="num">${h.n}</b></span>`).join('')
      : '<span class="muted tiny">No hashtags found in your published posts in this window.</span>';
  } catch (e) { box.innerHTML = `<span class="muted tiny">${esc(e.message)}</span>`; }
}
function wireHasFreq() {
  const $go = $('#hasFreqGo');
  if (!$go) return;
  $go.addEventListener('click', () => loadHasFreq());
  $('#hasFreqDays').addEventListener('change', () => loadHasFreq());
  $('#hasFreqCopy').addEventListener('click', () => {
    const top = __hasTop.slice(0, 5).map((h) => h.tag).join(' ');
    if (!top) return toast('Nothing to copy yet', 'err');
    if (navigator.clipboard) navigator.clipboard.writeText(top).then(() => toast('Top 5 copied: ' + top, 'ok')).catch(() => toast('Copy failed', 'err'));
    else toast('Clipboard unavailable', 'err');
  });
}
/* ── 32 · 5I — FRESHNESS GUARD (I7) ────────────────────────────── */
async function loadFreshness() {
  const $h = $('#freshHours');
  if (!$h) return;
  try {
    const d = await api('/api/freshness');
    if (document.activeElement !== $h) $h.value = d.hours;
    $('#freshState').textContent = d.hours > 0 ? `ON — posts older than ${d.hours} h are skipped with a "stale" reason.` : 'OFF — every pipeline event is considered (dedupe still applies).';
  } catch (e) { /* non-fatal */ }
}
function wireFreshness() {
  const $b = $('#freshSave');
  if (!$b) return;
  $b.addEventListener('click', async () => {
    const n = parseInt($('#freshHours').value, 10);
    if (!Number.isFinite(n) || n < 0) return toast('Hours must be 0 (off) or a positive number.', 'err');
    try { await api('/api/freshness', { method: 'POST', body: { hours: n } }); toast(n > 0 ? `Freshness guard ON — ${n} h` : 'Freshness guard OFF', 'ok'); loadFreshness(); }
    catch (e) { toast(e.message, 'err'); }
  });
}
loaders.guardrails = (loaders.guardrails || (async () => { }));
const __guardBase = loaders.guardrails;
loaders.guardrails = async () => { await __guardBase(); loadFreshness(); };
wireMediaLib(); wireHasFreq(); wireFreshness(); // 5I

/* ── 33 · 5J — J1 inspector · J2 wizard · J3 help · J4 branding · J5 KPI drag · J6 calendar · J7 safety · J8 pacing · J9 about · J10 language ── */
let __kpiOrder = '', __setupDone = false, __brand = null, __calYM = '', __calMode = 'month';
async function loadUiState() {
  try {
    const s = await api('/api/settings');
    __kpiOrder = s.kpiOrder || '';
    __setupDone = Boolean(s.setupDone);
    applyLang(s.lang || 'en');
    const sel = $('#setLang');
    if (sel && document.activeElement !== sel) sel.value = s.lang || 'en';
  } catch (e) { /* non-fatal */ }
  window.__uiStateLoaded = true; // Meridian 2: the first-run wizard may auto-open now
  if (window.__m2WizTick) window.__m2WizTick();
}

/* J5 — KPI drag & drop, order persisted (ui.kpi.order) */
const KPI_IDS = ['wa', 'published', 'failed', 'sources', 'nextjob', 'latency'];
function wireKpiDrag() {
  const grid = $('#kpiGrid');
  if (!grid) return;
  let dragId = null;
  $$('.kpi-drag', grid).forEach((card) => {
    card.addEventListener('dragstart', (e) => { dragId = card.dataset.kpi; try { e.dataTransfer.setData('text/plain', dragId); e.dataTransfer.effectAllowed = 'move'; } catch { } });
    card.addEventListener('dragend', () => { dragId = null; saveKpiOrder(); });
    card.addEventListener('dragover', (e) => {
      e.preventDefault();
      const overId = card.dataset.kpi;
      if (!dragId || dragId === overId) return;
      const ids = [...grid.querySelectorAll('.kpi-drag')].map((c) => c.dataset.kpi);
      const from = ids.indexOf(dragId), to = ids.indexOf(overId);
      if (from < 0 || to < 0) return;
      ids.splice(to, 0, ids.splice(from, 1)[0]);
      ids.forEach((id) => { const el = grid.querySelector(`.kpi-drag[data-kpi="${id}"]`); if (el) grid.appendChild(el); });
      __kpiOrder = ids.join(',');
    });
  });
}
let __kpiSaveT = null;
function saveKpiOrder() {
  clearTimeout(__kpiSaveT);
  __kpiSaveT = setTimeout(() => api('/api/settings', { method: 'POST', body: { kpiOrder: __kpiOrder } }).then(() => toast('KPI order saved', 'ok')).catch(() => { }), 500);
}
/* J2 — finish / reopen the saved wizard */
{
  const fin = $('#setupFinish');
  if (fin) fin.addEventListener('click', async () => {
    try { await api('/api/settings', { method: 'POST', body: { setupDone: true } }); __setupDone = true; fin.closest('.card').hidden = true; toast('Setup marked complete — the wizard stays hidden (reopen anytime from Home)', 'ok'); }
    catch (e) { toast(e.message, 'err'); }
  });
  const re = $('#setupReopen');
  if (re) re.addEventListener('click', async () => {
    try {
      await api('/api/settings', { method: 'POST', body: { setupDone: false } });
      __setupDone = false;
      if (window.openWizard) window.openWizard(0); else loaders.home().catch(() => { });
    } catch (e) { toast(e.message, 'err'); }
  });
}

/* J3 — "?" help overlay: every switch in one line, searchable */
const HOME_LABELS = {
  '#swGeneral': 'Settings · General', '#swBrand': 'Publish · Brand',
  '#swAipilot': 'Automate · Pilot', '#swRules': 'Automate · Rules',
  '#swDigest': 'Automate · Reports and Digest', '#swRecap': 'Automate · Reports and Digest',
  '#swWeekly': 'Automate · Reports and Digest', '#swInstantalerts': 'Automate · Reports and Digest',
  '#swAireply': 'Inbox · Replies', '#swReplyKb': 'Inbox · Replies',
  '#swQueue': 'Publish · Queue', '#swPosts': 'Publish · History',
  '#swRouting': 'Channels · Routing', '#swAnalytics': 'Insights · Analytics',
  '#swLibrary': 'Publish · Library', '#swWaCommand': 'Settings · WhatsApp'
};
const HELP_GROUPS = [
  { name: 'Publish pipeline', keys: ['queue', 'dedupe', 'crossdedupe', 'dedsplit', 'polltext', 'smartmedia', 'linktools', 'beautify', 'headers', 'hashtags', 'signature'] },
  { name: 'AI features', keys: ['aipilot', 'aisafety', 'translate', 'tldr', 'autobold', 'emojibullets', 'digest', 'aireply', 'transcribe', 'replykb', 'recap'] },
  { name: 'Scheduling & automation', keys: ['scheduler', 'evergreen', 'autopilot', 'weekly', 'waCommand'] },
  { name: 'Routing & analytics', keys: ['routing', 'matrix', 'analytics'] },
  { name: 'Posts, cards & alerts', keys: ['editposts', 'announcard', 'instantalerts'] }
];
function renderHelpList(q) {
  const list = $('#helpList');
  if (!list) return;
  const ql = String(q || '').toLowerCase();
  const out = [];
  for (const g of HELP_GROUPS) {
    const rows = g.keys.filter((k) => SWITCHES[k] && (!ql || (SWITCHES[k].name + ' ' + SWITCHES[k].desc).toLowerCase().includes(ql))).map((k) => {
      const sw = SWITCHES[k];
      return `<div class="help-row" role="button" tabindex="0" data-key="${k}"><span class="h-name">${esc(sw.name)}</span><span class="h-desc">${esc(sw.desc)}</span><span class="h-home">${esc(HOME_LABELS[SWITCH_HOME[k]] || 'Settings')}</span></div>`;
    });
    if (rows.length) out.push(`<div class="help-g">${esc(g.name)}</div>` + rows.join(''));
  }
  list.innerHTML = out.join('') || '<div class="muted tiny" style="padding:14px">Nothing matches that.</div>';
}
{
  const scrim = $('#helpScrim');
  if (scrim) {
    const openHelp = () => { scrim.hidden = false; renderHelpList(''); const s = $('#helpSearch'); if (s) s.focus(); };
    const closeHelp = () => { scrim.hidden = true; };
    // Clicking a row jumps to the view that hosts that switch (its home element's
    // nearest .view) and closes the overlay. Previously the rows were inert, so
    // picking a line "went nowhere".
    const goHome = (row) => {
      const el = row && row.dataset.key ? $(SWITCH_HOME[row.dataset.key]) : null;
      const view = el && el.closest ? el.closest('.view') : null;
      if (view && view.dataset.view) show(view.dataset.view);
      closeHelp();
    };
    $('#helpBtn').addEventListener('click', openHelp);
    $('#helpClose').addEventListener('click', closeHelp);
    scrim.addEventListener('click', (e) => { if (e.target === scrim) closeHelp(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !scrim.hidden) closeHelp(); });
    $('#helpSearch').addEventListener('input', (e) => renderHelpList(e.target.value));
    $('#helpList').addEventListener('click', (e) => { const row = e.target.closest('.help-row'); if (row) goHome(row); });
    $('#helpList').addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      const row = e.target.closest('.help-row'); if (!row) return;
      e.preventDefault(); goHome(row);
    });
  }
}

/* J4 — Branding Studio: presets + hex fields + live preview (saved brand drives every card) */
loaders.branding = async () => {
  try {
    const d = await api('/api/brand');
    __brand = d.brand;
    const sw = (p) => `<span class="bp-sw" style="background:${p.bg}"><i style="background:${p.accent}"></i><i style="background:${p.panel}"></i><i style="background:${p.ink}"></i></span>`;
    $('#brandPresets').innerHTML = Object.entries(d.presets).map(([id, p]) =>
      `<button class="btn btn-g bp-btn" data-p="${id}" title="Apply the ${id} preset">${sw(p)} <span>${id}</span></button>`).join('');
    $$('#brandPresets .bp-btn').forEach((b) => b.addEventListener('click', () => { __brand = { ...d.presets[b.dataset.p] }; renderBrandFields(); renderBrandPreview(); }));
    renderBrandFields();
    renderBrandPreview();
  } catch (e) { toast(e.message, 'err'); }
};
/* Meridian 2: Beautify is now the Rewrite panel inside Compose + the Brand screen —
   the hashtag-frequency tool (its last independent piece) loads with Brand. */
{
  const __brandingBase = loaders.branding;
  loaders.branding = async () => { await __brandingBase(); loadHasFreq(); };
}
const BRAND_FIELDS = [['accent', 'Accent (highlights)'], ['bg', 'Background'], ['panel', 'Card panel'], ['ink', 'Text'], ['muted', 'Secondary text']];
function renderBrandFields() {
  const box = $('#brandFields');
  if (!box || !__brand) return;
  box.innerHTML = BRAND_FIELDS.map(([k, label]) =>
    `<div class="field"><label>${label}</label><div class="row-form" style="gap:6px"><input type="color" class="bp-color" data-bk="${k}" value="${__brand[k]}"><input class="in bp-hex" data-bk="${k}" value="${__brand[k]}" maxlength="7" spellcheck="false"></div></div>`).join('');
  $$('#brandFields .bp-color').forEach((c) => c.addEventListener('input', () => {
    const hexIn = box.querySelector(`.bp-hex[data-bk="${c.dataset.bk}"]`);
    if (hexIn && /^#[0-9a-fA-F]{6}$/.test(hexIn.value)) hexIn.value = c.value;
    __brand[c.dataset.bk] = c.value; renderBrandPreview();
  }));
  $$('#brandFields .bp-hex').forEach((h) => h.addEventListener('input', () => {
    if (/^#[0-9a-fA-F]{6}$/.test(h.value)) {
      const colIn = box.querySelector(`.bp-color[data-bk="${h.dataset.bk}"]`);
      if (colIn) colIn.value = h.value;
      __brand[h.dataset.bk] = h.value; renderBrandPreview();
    }
  }));
}
function brandPreviewUrl() {
  if (!__brand) return '';
  const q = new URLSearchParams({ title: 'Big announcement', body: 'Your card text lands here — four lines, then it stops.', source: 'Your channel', date: '2026-09-16', footer: 'My Channel' });
  for (const k of Object.keys(__brand)) q.set(k, __brand[k]);
  return '/api/card-svg?' + q.toString();
}
function renderBrandPreview() { const img = $('#brandPreview'); if (img) img.src = brandPreviewUrl(); }
{
  const bs = $('#brandSave');
  if (bs) bs.addEventListener('click', async () => {
    try { await api('/api/brand', { method: 'POST', body: __brand }); toast('Brand saved — every new card uses it now', 'ok'); }
    catch (e) { toast(e.message, 'err'); }
  });
  const br = $('#brandReset');
  if (br) br.addEventListener('click', async () => {
    try { const d = await api('/api/brand'); __brand = { ...d.defaults }; renderBrandFields(); renderBrandPreview(); toast('Reset to defaults — click Save to keep it', 'ok'); }
    catch (e) { toast(e.message, 'err'); }
  });
}

/* J6 — Content Calendar: month grid + week strip, everything merged (PKT dates) */
const CAL_VIEW = { published: 'posts', scheduled: 'scheduled', draft: 'approvals', plan: 'approvals', evergreen: 'posts' };
function pktYM(d) { const p = new Date(d.getTime() + 5 * 3600e3); return `${p.getUTCFullYear()}-${String(p.getUTCMonth() + 1).padStart(2, '0')}`; }
loaders.calendar = async () => {
  if (!__calYM) __calYM = pktYM(new Date());
  await loadCalendar();
};
async function loadCalendar() {
  try {
    const d = await api('/api/calendar?ym=' + __calYM);
    renderCalendar(d);
  } catch (e) { toast(e.message, 'err'); }
}
function renderCalendar(d) {
  const grid = $('#fcalGrid'), week = $('#fcalWeek'), head = $('#fcalHead');
  if (!grid) return;
  const [y, m] = d.year ? [d.year, d.month] : [__calYM.slice(0, 4), __calYM.slice(5, 7)].map(Number);
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  $('#fcalTitle').textContent = `${MONTHS[m - 1]} ${y}`;
  const byDay = {};
  for (const it of d.items) (byDay[it.date] = byDay[it.date] || []).push(it);
  const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  head.innerHTML = DOW.map((x) => `<span>${x}</span>`).join('');
  const first = new Date(Date.UTC(y, m - 1, 1));
  const lead = (first.getUTCDay() + 6) % 7; // Monday-first offset
  const dim = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const todayStr = pktYM(new Date()) + '-' + String(new Date(Date.now() + 5 * 3600e3).getUTCDate()).padStart(2, '0');
  let cells = '';
  for (let i = 0; i < lead; i++) cells += '<span class="cal-c off"></span>';
  for (let day = 1; day <= dim; day++) {
    const ds = `${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const items = byDay[ds] || [];
    const chips = items.slice(0, 3).map((it) =>
      `<button class="cal-chip cal-${it.kind}" data-v="${CAL_VIEW[it.kind] || 'posts'}" title="${esc(it.time)} ${esc(it.title)} — ${esc(it.source)}">${esc((it.time || '') + ' ' + it.title)}</button>`).join('');
    const more = items.length > 3 ? `<span class="cal-more">+${items.length - 3} more</span>` : '';
    cells += `<span class="cal-c ${ds === todayStr ? 'today' : ''}"><b>${day}</b>${chips}${more}</span>`;
  }
  grid.innerHTML = cells;
  $$('#fcalGrid .cal-chip').forEach((c) => c.addEventListener('click', () => show(c.dataset.v)));
  /* week strip — the week containing today (or the 15th for other months) */
  const anchor = (String(m).padStart(2, '0') === pktYM(new Date()).slice(5, 7)) ? new Date(Date.now() + 5 * 3600e3) : new Date(Date.UTC(y, m - 1, 15));
  const aLead = (anchor.getUTCDay() + 6) % 7;
  const weekStart = new Date(anchor.getTime() - aLead * 86400e3);
  week.innerHTML = DOW.map((_, i) => {
    const dt = new Date(weekStart.getTime() + i * 86400e3);
    const ds = dt.toISOString().slice(0, 10);
    const items = byDay[ds] || [];
    return `<div class="cw-col"><div class="cw-d">${DOW[i]} ${dt.getUTCDate()}</div>${items.map((it) => `<div class="cal-chip cal-${it.kind}" data-v="${CAL_VIEW[it.kind] || 'posts'}" title="${esc(it.source)}">${esc((it.time || '') + ' ' + it.title)}</div>`).join('') || '<div class="muted tiny">—</div>'}</div>`;
  }).join('');
  $$('#fcalWeek .cal-chip').forEach((c) => c.addEventListener('click', () => show(c.dataset.v)));
}
{
  const tabs = $('#fcalTabs');
  if (tabs) {
    $$('#fcalTabs .tab').forEach((t) => t.addEventListener('click', () => {
      $$('#fcalTabs .tab').forEach((x) => x.classList.toggle('on', x === t));
      __calMode = t.dataset.cal;
      $('#fcalGrid').hidden = __calMode !== 'month';
      $('#fcalHead').hidden = __calMode !== 'month';
      $('#fcalWeek').hidden = __calMode !== 'week';
    }));
    const nav = (delta) => {
      let [y, m] = __calYM.split('-').map(Number);
      m += delta;
      if (m < 1) { m = 12; y--; } if (m > 12) { m = 1; y++; }
      __calYM = `${y}-${String(m).padStart(2, '0')}`;
      loadCalendar();
    };
    $('#fcalPrev').addEventListener('click', () => nav(-1));
    $('#fcalNext').addEventListener('click', () => nav(1));
    $('#fcalToday').addEventListener('click', () => { __calYM = pktYM(new Date()); loadCalendar(); });
  }
}

/* J8 — Pacing visualizer (last 24 h PKT vs the rate-guard cap) */
async function loadPacing() {
  try {
    const d = await api('/api/pacing');
    const chart = $('#paceChart');
    if (!chart) return;
    chart.innerHTML = d.perHour.map((n, i) =>
      `<div class="pc-cell ${n >= d.cap ? 'over' : ''}" title="${i}:00–${i + 1}:00 PKT — ${n} post(s)"><div class="pc-bar" style="height:${Math.max(4, Math.min(100, Math.round((n / d.cap) * 100)))}%"></div><span class="pc-h">${i % 3 === 0 ? i : ''}</span></div>`).join('');
    $('#paceNow').textContent = `— last hour: ${d.lastHour}/${d.cap} used`;
    const total = d.perHour.reduce((a, b) => a + b, 0);
    const peak = Math.max(...d.perHour);
    $('#paceFoot').textContent = total ? `${total} post(s) in the last 24 h · peak hour: ${peak} · cap: ${d.cap}/h` : 'No posts in the last 24 hours.';
  } catch (e) { /* non-fatal */ }
}
loaders.guardrails = (loaders.guardrails || (async () => { }));
const __guardJ = loaders.guardrails;
loaders.guardrails = async () => { await __guardJ(); loadPacing(); };

/* J7 — AI safety screen criteria (the switch itself rides the standard power API) */
async function loadAiSafety() {
  try {
    const d = await api('/api/power/aisafety');
    const el = $('#aisafetyInput');
    if (el && document.activeElement !== el) el.value = d.criteria;
  } catch (e) { /* non-fatal */ }
}
loaders.aipilot = (loaders.aipilot || (async () => { }));
const __aiPilotJ = loaders.aipilot;
loaders.aipilot = async () => { await __aiPilotJ(); loadAiSafety(); };
{
  const b = $('#aisafetySave');
  if (b) b.addEventListener('click', async () => {
    try { await api('/api/power/aisafety', { method: 'POST', body: { criteria: $('#aisafetyInput').value } }); toast('Safety rule saved', 'ok'); }
    catch (e) { toast(e.message, 'err'); }
  });
}

/* J1 — Pipeline Inspector: dry-run any text through the exact pipeline order */
let __piSources = [];
loaders.routing = (loaders.routing || (async () => { }));
const __routingJ = loaders.routing;
loaders.routing = async () => {
  await __routingJ();
  const sel = $('#piSource');
  if (!sel) return;
  try {
    const s = await api('/api/sources');
    __piSources = s.list || [];
    const cur = sel.value;
    sel.innerHTML = '<option value="">No source (global gates only)</option>' + __piSources.map((x) => `<option value="${esc(x.jid)}">${esc(x.name || x.jid)}</option>`).join('');
    if ([...sel.options].some((o) => o.value === cur)) sel.value = cur;
  } catch (e) { /* picker stays global */ }
};
{
  const b = $('#piRun');
  if (b) b.addEventListener('click', async () => {
    const text = $('#piText').value;
    if (!text.trim()) return toast('Paste the post text to inspect first', 'err');
    b.disabled = true;
    try {
      const d = await api('/api/pipeline/inspect', { method: 'POST', body: { text, source: $('#piSource').value, hasMedia: false } });
      $('#piOut').hidden = false;
      const c = d.counters || {};
      $('#piCounters').innerHTML = `<span class="pi-c">Today: <b>${c.published || 0}</b> published · <b>${c.skipped || 0}</b> skipped · <b>${c.failed || 0}</b> failed</span><span class="pi-c">Rate guard now: <b>${c.lastHour || 0}/${c.cap || '—'}</b>/h</span>`;
      $('#piGates').innerHTML = '<div class="pi-g-h">Safety gates (checked, nothing marked)</div>' + d.gates.map((g) =>
        `<div class="pi-gate ${g.fired ? 'fire' : ''}"><span class="pi-g-ic">${g.fired ? '⛔' : '✓'}</span><span><b>${esc(g.name)}</b>${g.fired ? ' — <b>would skip</b>: ' : ' — '}${esc(g.detail)}</span></div>`).join('');
      $('#piStages').innerHTML = '<div class="pi-g-h">Stage by stage (exact pipeline order)</div>' + d.stages.map((s) =>
        `<div class="pi-stage ${s.changed ? 'changed' : ''}"><div class="pi-s-h"><b>${esc(s.name)}</b>${s.changed ? '<span class="pi-chip">changed</span>' : ''}<span class="muted tiny" style="margin-left:auto">${esc(s.note)}</span></div>${s.changed ? `<pre class="pi-before">${esc(s.before.slice(0, 400))}</pre><pre class="pi-after">${esc(s.after.slice(0, 400))}</pre>` : ''}</div>`).join('');
      $('#piRouting').textContent = `Would publish to ${d.targetCount} target(s): ${d.targets.length ? d.targets.join(', ') : '— none —'}${d.targetNote ? ' (' + d.targetNote + ')' : ''} · ${d.partCount} part(s) of ≤4096 chars`;
    } catch (e) { toast(e.message, 'err'); }
    b.disabled = false;
  });
}

/* J9 — About: version, changelog, last boot, storage */
const CHANGELOG = [
  ['v9.1.0 — Reference layout (this build)', 'Full integration of the delivered reference design: top bar is now a breadcrumb (GROUP / Screen) with a live connection pill, labeled Panic stop and a wide Search anything field (Ctrl K). Sidebar: rotated R brand mark with the SIGNAL DESK sub-line, a one-line 8/8 health readout, the WhatsApp paired-identity card, the panic-stop status with the Esc key hint, and the workspace-owner row with inline help + theme controls. Home: COMMAND / OVERVIEW eyebrow, time-of-day greeting, LIVE badge, a real 24-hour activity chart (hourly published / skipped / failed, Pakistan time, new read-only /api/overview/hourly route), queue status, system health ring and adaptive pacing panels. Settings: exactly five sections in reference order — Workspace & language (bot name, language, theme as Dark / Light / System pills), Delivery controls, Integrations & reports, Security & sessions, Data & recovery; multi-group tabs now show every group they cover. All 25 screens, all 33 switches, the pipeline, WhatsApp pairing and settings persistence are unchanged'],
  ['v9.0.0 — Signal Desk', 'Full redesign from the delivered product spec + 8 mockups. Olive-black console (#10130F) on a four-step olive surface ladder · one citron accent (#D7F36A) · NO shadows anywhere (borders + surface steps only) · Noto Sans Arabic variable 400–700, self-hosted, one family for EN + UR. New eight-group IA (Command · Broadcast · Channels · People · Studio · Intelligence · Insights · System) — all 25 screens live in the sidebar, no inner-tab row · 64 px top bar · 248 px sidebar (72 px rail on tablet) · 1440 px canvas. Phone: 5-item bottom bar with the raised 56 px citron Compose. Spec component refresh: 42 px inputs, 40 px buttons, 42×24 switches, 112 px KPIs with a 3×24 citron rule, 22 px status pills, 56 px table rows, 160 ms switch motion. Read-only switch chips ("Label · Off ↗") on Home/Compose/History — state + deep link, never a second control. Light theme (#F4F6EF, accent #5E7C19) · Urdu RTL shell (inbox stays LTR) · WhatsApp mirror byte-identical · pipeline untouched · REPO-SLIM hotfix: media of ANY size is saved (the old 450 KB / 5 MB caps are gone) — and the media of any post is deleted right after it is published to the target channel, so nothing accumulates; WhatsApp-tab photos live on disk instead of inside the database (a 30-day safety net for unposted media, Settings → Storage), the cloud login syncs only when something actually changes (idle = zero GitHub writes), and one click "Compacts" the backup branch to a single snapshot so the GitHub repo stops growing'],
  ['v8.5.0 — Graphite', 'The visual system, rebuilt from scratch: Geist typeface (self-hosted) · warm graphite surfaces · monochrome system with off-white primary actions · one warm accent, deployed scarcely · hairlines + inner top-edge light, no card shadows in dark · refined buttons, switches, tables, KPIs, command palette, modals, toasts · light theme with tint elevation · WhatsApp mirror untouched'],
  ['v8.4.0 — Meridian 2', 'One home per switch · Everyday/Power rail · Home, Channels, Publish, Inbox · 5-step setup wizard + 60-second tour · Calendar folded into Scheduled (List/Calendar) · Templates + media + cards → Library · Beautify → Rewrite in Compose + Brand screen · Reports and Digest · deep links + Recent + queue swipe · Meridian 2 palette, motion and type'],
  ['v8.3.0', 'GitHub repo storage gauge in Settings · Data · Storage (full-clone size, honest verdicts, 60 s cache)'],
  ['v8.2.0 — Meridian', 'Full visual redesign (dark-first, hairline borders, one accent) · 6-area rail · inner tabs · command palette · WhatsApp mirror kept byte-identical'],
  ['v8.1.0', 'IA cleanup · minimal six-job rail · saved UI state'],
  ['v8.0.0', 'Lean re-architecture · single-process Express + EJS + vanilla JS · SQLite state · cloud memory (GitHub-backed, 10-min save)'],
  ['v7.6.0', 'Pipeline Inspector dry-run · setup wizard (saved, auto-hides) · “?” one-line guide for every switch · Branding Studio · drag-to-reorder Overview KPIs · Content Calendar (month + week, all content merged) · AI safety screen (off) · pacing visualizer · this changelog · Urdu RTL (optional)'],
  ['v7.5.x', 'Subscriber snapshots + growth · media library · smart media checks (off) · announcement cards (SVG+PNG) · hashtags v2 local frequency · freshness guard (off) · link cleanup (off) · row quick actions · resend with rate guard'],
  ['v7.5.x', 'WhatsApp command channel (off, my-number-locked, PIN destructive) · evergreen recycling (off, daily quota) · bounded Auto-Pilot (off, never deletes, panic-killed) · “Plan my week” → Approval Queue drafts'],
  ['v7.5.x', 'Outgoing webhooks (off, 3× retry, test) · API explorer “try it” · RSS/Atom sources (15-min fetch, same pipeline) · PWA manifest + shortcuts'],
  ['v7.5.x', 'Chat search/pins/labels/quick-replies/scheduled sends/export · contacts + notes + timeline · broadcast lists · per-target rate caps + blocklist patterns + find→replace'],
  ['v7.5.x', 'Audit view + CSV · backup/restore · read-only second password + login alerts + session timeout · storage manager · panic stop · adaptive pacing · public /status'],
  ['v7.4.x', 'Analytics v2 (per-target, heatmap, skip reasons) · goals + leaderboard · weekly report (email+WA, CSV/PDF) · Health v2 + self-test · notification bell · full-text search'],
  ['v7.4.x', 'Per-feature provider+model + usage meter · prompt library (10 seeded) · TL;DR / auto-bold / emoji bullets · glossary enforcement · voice transcription · auto-reply KB + hours · morning recap'],
  ['v7.3.x', 'Composer formatting toolbar + preview + drafts + uploads · AI Improve/Shorten/Formal/Translate/Emojify · snippets with {placeholders} · test-send to self · history retry/edit/filters'],
  ['v7.3.x — Phase 5A', 'Approve-first + Approval Queue + delay buffer · source rule cards · routing matrix + cross-source dedupe · >4096 auto-split · polls→text · Live Queue + Retry-all · scheduler (once/daily/weekly/weekdays/interval, PKT) · mirror-latency KPI · undo last published'],
  ['v7.3.x — Phase R', 'The Precision Console shell rebuilt from blank: N2 channel picker, N1 in-place live sync, parity 25/25, tests 25/25 + 79/79'],
  ['v7.3.0 and earlier', 'WhatsApp mirroring core: sources → targets, dedupe, rate guard, media recovery, offline recovery, zombie watchdog, cloud sync, public /connect QR + pairing code, WhatsApp-style inbox']
];
loaders.about = async () => {
  try {
    const [ov, st] = await Promise.all([api('/api/overview'), api('/api/storage').catch(() => null)]);
    if ($('#abUptime')) $('#abUptime').textContent = `uptime — booted ${ov.uptime || 0} time(s)`;
    if ($('#abDeploy')) $('#abDeploy').textContent = ov.lastBoot ? `last boot ${when(ov.lastBoot)}` : 'last boot —';
    if ($('#abStorage') && st) {
      const kb = (n) => (n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.round(n / 1024) + ' KB');
      $('#abStorage').textContent = `storage — DB ${kb(st.dbBytes || 0)} · media ${kb(st.mediaBytes || 0)} · ${st.mediaCount || 0} file(s)`;
    }
    if ($('#abChangelog')) {
      $('#abChangelog').innerHTML = CHANGELOG.map(([v, what]) =>
        `<div class="chg"><div class="chg-v">${esc(v)}</div><div class="chg-w muted tiny">${esc(what)}</div></div>`).join('');
    }
  } catch (e) { /* non-fatal */ }
};

/* J10 — language: English (default) / Urdu (RTL, best-effort labels) */
/* Meridian 2 labels (Urdu, RTL). The WhatsApp mirror is EXEMPT — it always stays LTR
   and byte-identical to the official client (CSS: body.ur .wa-mirror forces ltr). */
const UR_NAV = {
  home: 'ہوم', sources: 'ذرائع', browse: 'دریافت', targets: 'ہدف', routing: 'روٹنگ',
  newpost: 'لکھیں', scheduled: 'مقررہ', approvals: 'قطار', posts: 'تاریخ',
  media: 'لائبریری', branding: 'برانڈ',
  aipilot: 'پائلٹ', guardrails: 'قواعد', digest: 'ریپورٹس اور ڈائجسٹ', aireply: 'جوابات',
  whatsapp: 'واٹس ایپ', journal: 'رابطے', bulk: 'بالک بھیجیں', email: 'ای میل',
  analytics: 'تجزیات', health: 'صحت', logs: 'لاگز', settings: 'ترتیبات', audit: 'معائنہ', about: 'بارے میں'
};
function applyLang(lang) {
  const ur = lang === 'ur';
  try {
    document.documentElement.dir = ur ? 'rtl' : 'ltr';
    document.documentElement.lang = ur ? 'ur' : 'en';
    document.body.classList.toggle('ur', ur);
    $$('.sb-item[data-view]').forEach((a) => {
      const lbl = a.querySelector('.lbl');
      if (!lbl) return;
      if (ur && UR_NAV[a.dataset.view]) lbl.textContent = UR_NAV[a.dataset.view];
      else if (!ur) lbl.textContent = a.dataset.lbl || TITLES[a.dataset.view] || lbl.textContent;
    });
    /* bottom bar (labels without data-view) + current view title */
    $$('.bt[data-view]').forEach((a) => {
      const lbl = a.querySelector('span');
      if (!lbl) return;
      const v = a.dataset.view === '__publish' ? 'newpost' : a.dataset.view;
      if (ur && UR_NAV[v]) lbl.textContent = UR_NAV[v];
      else if (!ur) lbl.textContent = a.dataset.lbl || TITLES[v] || lbl.textContent;
    });
    const vt = $('#viewTitle');
    if (vt) {
      if (ur && UR_NAV[currentView]) vt.textContent = UR_NAV[currentView];
      else if (!ur) vt.textContent = TITLES[currentView] || vt.textContent;
    }
  } catch (e) { /* language must never break the app */ }
}
{
  const sel = $('#setLang');
  if (sel) sel.addEventListener('change', async () => {
    try { await api('/api/settings', { method: 'POST', body: { lang: sel.value } }); applyLang(sel.value); toast(sel.value === 'ur' ? 'اردو (RTL) آن — best-effort labels' : 'English (LTR) آن', 'ok'); }
    catch (e) { toast(e.message, 'err'); }
  });
}

/* ── 23b · MERIDIAN 2 SHELL — power group · sidebar footer · More sheet ·
        first-run wizard + 60-s tour · WhatsApp gates · panic chip · queue swipe ── */
(function m2shell() {
  /* Power group — collapsed by default, remembers state */
  const gPower = $('#gPower'), pItems = $('#gPowerItems');
  if (gPower && pItems) {
    let closed = true;
    try { closed = localStorage.getItem('rc-power-closed') !== '0'; } catch (e) {}
    const applyG = () => {
      gPower.classList.toggle('closed', closed);
      pItems.classList.toggle('closed', closed);
      gPower.setAttribute('aria-expanded', String(!closed));
    };
    applyG();
    gPower.addEventListener('click', () => {
      closed = !closed; applyG();
      try { localStorage.setItem('rc-power-closed', closed ? '1' : '0'); } catch (e) {}
    });
  }
  /* Sidebar footer — Help · Theme · panic status */
  const sbHelp = $('#sbHelpBtn');
  if (sbHelp) sbHelp.addEventListener('click', () => { const s = $('#helpScrim'); if (s) s.hidden = !s.hidden; });
  const sbTheme = $('#sbThemeBtn');
  if (sbTheme) sbTheme.addEventListener('click', () => { const t = $('#themeBtn'); if (t) t.click(); });
  window.m2PaintPanicStatus = (on) => {
    const el = $('#sbPanicStatus'); if (!el) return;
    el.dataset.p = on ? 'on' : 'off';
    const t = el.querySelector('.p-txt'); if (t) t.textContent = on ? 'Panic ON' : 'Panic off';
  };
  /* More sheet (<640) — everything that does not fit the five main slots */
  const moreScrim = $('#moreScrim');
  if (moreScrim) {
    /* Signal Desk: everything not in the five bottom slots, grouped by the eight IA groups */
    const areas = [
      ['Overview', ['analytics', 'digest']],
      ['Publishing & Content', ['scheduled', 'posts', 'bulk', 'media']],
      ['Channels & Routing', ['targets', 'browse', 'routing', 'guardrails']],
      ['Audience & Automation', ['whatsapp', 'journal', 'aireply', 'aipilot']],
      ['System & Workspace', ['branding', 'health', 'logs', 'audit', 'email', 'settings', 'about']]
    ];
    $('#moreList').innerHTML = areas.map(([name, vs]) =>
      `<div class="more-g">${name}</div>` + vs.map((v) => `<button class="more-it" data-mv="${v}">${TITLES[v] || v}</button>`).join('')).join('');
    $$('.more-it', moreScrim).forEach((b) => b.addEventListener('click', () => { moreScrim.hidden = true; show(b.dataset.mv); }));
    $('#btMoreBtn').addEventListener('click', () => { moreScrim.hidden = false; });
    $('#moreClose').addEventListener('click', () => { moreScrim.hidden = true; });
    moreScrim.addEventListener('click', (ev) => { if (ev.target === moreScrim) moreScrim.hidden = true; });
  }
  /* WhatsApp gates — Sources/Targets locked until the number is linked */
  window.__updateWaGates = (status) => {
    const locked = status !== 'open';
    for (const id of ['srcGate', 'tgtGate']) { const g = document.getElementById(id); if (g) g.hidden = !locked; }
  };
  $$('[data-wagate]').forEach((b) => b.addEventListener('click', () => window.openWizard && window.openWizard(1)));

  /* ── First-run wizard: 5 steps, skippable, resumable, re-openable ── */
  const wiz = $('#wizScrim');
  const WSTEPS = [
    { t: 'Welcome', done: null,
      body: '<p class="wiz-p">Welcome to <b>Raqifluz</b>. Five minutes to your first published post: link WhatsApp, pick one source and one target, then publish. Every automation is OFF by default — you switch on only what you want, each from its one home.</p><p class="wiz-p"><button class="btn btn-g btn-sm" id="wizTourBtn">Take the 60-second tour instead</button></p>' },
    { t: 'Link WhatsApp', done: (st) => st.status === 'open',
      body: '<p class="wiz-p">Open <b>Home</b> and scan the QR code with WhatsApp → Linked devices. One scan is enough — cloud memory keeps it alive across deploys.</p><p class="wiz-p"><button class="btn btn-p" id="wizGoHome">Open Home</button></p>' },
    { t: 'Add your first source', done: (ov) => (ov.sources || 0) > 0,
      body: '<p class="wiz-p">A <b>source</b> is a channel the bot follows — every post it makes gets mirrored to your targets.</p><p class="wiz-p"><button class="btn btn-p" id="wizGoSrc">Add a source</button></p>' },
    { t: 'Add your first target', done: (ov) => (ov.targets || 0) > 0,
      body: '<p class="wiz-p">A <b>target</b> is your channel — where the mirrored posts land. Your channel is the one you are admin of.</p><p class="wiz-p"><button class="btn btn-p" id="wizGoTgt">Add a target</button></p>' },
    { t: 'Publish your first post', done: (ov) => !!(ov.today && ov.today.published > 0),
      body: '<p class="wiz-p">Write or paste a post in <b>Compose</b> and press <b>Publish</b>. That is the whole product — everything else is optional.</p><p class="wiz-p"><button class="btn btn-p" id="wizGoCmp">Open Compose</button></p>' }
  ];
  let wStep = 0, wTimer = null;
  try { wStep = Math.min(4, Math.max(0, parseInt(localStorage.getItem('rc-wiz-step') || '0', 10) || 0)); } catch (e) {}
  let wizSkipped = false;
  try { wizSkipped = localStorage.getItem('rc-wiz-skipped') === '1'; } catch (e) {}
  let __wizState = { st: null, ov: null };
  const wizAllDone = () => {
    const { st, ov } = __wizState;
    return !!(st && ov && st.status === 'open' && (ov.sources || 0) > 0 && (ov.targets || 0) > 0 && ov.today && ov.today.published > 0);
  };
  /* the wizard is "available" while any step remains; skipped = no auto-open, pill stays */
  const wizAvailable = () => !__setupDone && !wizAllDone();
  function wizSave() { try { localStorage.setItem('rc-wiz-step', String(wStep)); } catch (e) {} }
  function wizClose() {
    if (wiz) wiz.hidden = true;
    if (wTimer) { clearInterval(wTimer); wTimer = null; }
    paintWizPill();
  }
  window.openWizard = function (step) {
    if (!wiz) return;
    if (step != null) { wStep = Math.min(4, Math.max(0, step)); wizSave(); }
    wiz.hidden = false;
    wizRender();
    wizTick();
    if (wTimer) clearInterval(wTimer);
    wTimer = setInterval(wizTick, 5000);
  };
  function wizRender() {
    const s = WSTEPS[wStep];
    $('#wizTitle').textContent = s.t;
    $('#wizStepLbl').textContent = `${wStep + 1} of ${WSTEPS.length}`;
    $('#wizBody').innerHTML = s.body;
    $('#wizBack').hidden = wStep === 0;
    $('#wizNext').textContent = wStep === WSTEPS.length - 1 ? 'Finish' : 'Next';
    $('#wizDots').innerHTML = WSTEPS.map((_, i) => `<span class="wiz-dot ${i === wStep ? 'on' : ''}"></span>`).join('');
    const gh = $('#wizGoHome'); if (gh) gh.addEventListener('click', () => { wizClose(); show('home'); });
    const gs = $('#wizGoSrc'); if (gs) gs.addEventListener('click', () => { wizClose(); show('sources'); });
    const gt = $('#wizGoTgt'); if (gt) gt.addEventListener('click', () => { wizClose(); show('targets'); });
    const gc = $('#wizGoCmp'); if (gc) gc.addEventListener('click', () => { wizClose(); show('newpost'); });
    const tw = $('#wizTourBtn'); if (tw) tw.addEventListener('click', () => { wizClose(); tourStart(); });
  }
  async function wizTick() {
    if (!wiz || wiz.hidden) return;
    const s = WSTEPS[wStep];
    if (!s.done) return;
    try {
      const [st, ov] = await Promise.all([api('/api/status'), api('/api/overview').catch(() => null)]);
      if (!s.done(st || {}, ov || {})) return;
      wStep = Math.min(WSTEPS.length - 1, wStep + 1);
      wizSave();
      if (wStep === WSTEPS.length) {
        wizClose();
        toast('Setup complete — everything else is optional. Reopen this wizard anytime from Home.', 'ok');
      } else if (wiz && !wiz.hidden) wizRender();
    } catch (e) { /* retry next tick */ }
  }
  $('#wizNext').addEventListener('click', () => {
    if (wStep >= WSTEPS.length - 1) {
      wizClose();
      api('/api/settings', { method: 'POST', body: { setupDone: true } }).then(() => { __setupDone = true; loaders.home().catch(() => {}); });
      return;
    }
    wStep++; wizSave(); wizRender();
  });
  $('#wizBack').addEventListener('click', () => { wStep = Math.max(0, wStep - 1); wizSave(); wizRender(); });
  $('#wizSkip').addEventListener('click', () => {
    wizSkipped = true;
    try { localStorage.setItem('rc-wiz-skipped', '1'); } catch (e) {}
    wizClose();
  });
  /* floating pill — the wizard stays resumable / re-openable after a skip */
  let pill = null;
  function paintWizPill() {
    const avail = wizAvailable();
    if (avail && !pill) {
      pill = document.createElement('button');
      pill.className = 'wiz-pill';
      pill.id = 'wizPill';
      pill.title = 'Reopen the setup wizard — your progress is saved';
      pill.addEventListener('click', () => { wizSkipped = false; window.openWizard(); });
      document.body.appendChild(pill);
    }
    if (!pill) return;
    pill.hidden = !avail || (wiz && !wiz.hidden);
    pill.textContent = `Setup — step ${Math.min(wStep + 1, WSTEPS.length)} of ${WSTEPS.length}`;
  }
  /* refresh wizard state (status + overview) so steps auto-complete */
  async function wizStateTick() {
    if (!window.__uiStateLoaded) return; // wait for setupDone/lang to be known
    try { __wizState = { st: await api('/api/status'), ov: await api('/api/overview').catch(() => null) }; }
    catch (e) { /* keep last state */ }
    paintWizPill();
    if (!__setupDone && !wizSkipped && wizAvailable() && !wizStepSeen) {
      wizStepSeen = true;
      window.openWizard(Math.min(wStep, WSTEPS.length - 1));
    }
  }
  let wizStepSeen = false;
  window.__m2WizTick = wizStateTick; // loadUiState pokes this once setupDone/lang are known
  setInterval(wizStateTick, 5000);
  wizStateTick();

  /* ── 60-second tour: 5 stops, auto-advances ── */
  const TOUR = [
    { t: 'Home', d: 'The pulse: WhatsApp status, today’s numbers, recent activity and the QR code while you link.', go: 'home' },
    { t: 'Compose', d: 'Write, rewrite with AI, turn it into a card — and publish now.', go: 'newpost' },
    { t: 'Publish', d: 'Queue, Scheduled, History, Library and Brand — everything about what goes out.', go: 'scheduled' },
    { t: 'Inbox', d: 'Your WhatsApp as an official-looking mirror, contacts and AI replies.', go: 'whatsapp' },
    { t: 'Settings', d: 'General, WhatsApp, AI and Automation, Data and Backup, Access and Session.', go: 'settings' }
  ];
  const tourScrim = $('#tourScrim');
  let tStep = 0, tTimer = null;
  function tourRender() {
    const s = TOUR[tStep];
    $('#tourBody').innerHTML = `<div class="tour-t">${s.t}</div><div class="tour-d">${s.d}</div><button class="btn btn-g btn-sm" id="tourGo">Open ${s.t}</button>`;
    $('#tourCount').textContent = `Stop ${tStep + 1} of ${TOUR.length}`;
    $('#tourGo').addEventListener('click', () => { show(s.go); });
    $('#tourNext').textContent = tStep === TOUR.length - 1 ? 'Finish tour' : 'Next stop';
  }
  window.tourStart = function () {
    if (!tourScrim) return;
    tStep = 0;
    tourScrim.hidden = false;
    tourRender();
    if (tTimer) clearInterval(tTimer);
    tTimer = setInterval(() => {
      if (tStep >= TOUR.length - 1) tourEnd();
      else { tStep++; tourRender(); }
    }, 12000);
  };
  function tourEnd() {
    if (tourScrim) tourScrim.hidden = true;
    if (tTimer) { clearInterval(tTimer); tTimer = null; }
  }
  if (tourScrim) {
    $('#tourNext').addEventListener('click', () => { tStep >= TOUR.length - 1 ? tourEnd() : (tStep++, tourRender()); });
    $('#tourDone').addEventListener('click', tourEnd);
  }

  /* ── Queue swipe (mobile <640): right = approve · left = reject ── */
  const content = $('#content');
  if (content) {
    let sx = 0, sy = 0, row = null, dx = 0, active = false;
    content.addEventListener('touchstart', (e) => {
      if (window.innerWidth > 640) return;
      row = e.target.closest('.q-item');
      if (!row || !e.touches[0]) { row = null; return; }
      sx = e.touches[0].clientX; sy = e.touches[0].clientY; dx = 0; active = true;
    }, { passive: true });
    content.addEventListener('touchmove', (e) => {
      if (!active || !row || !e.touches[0]) return;
      dx = e.touches[0].clientX - sx;
      const dy = e.touches[0].clientY - sy;
      if (Math.abs(dy) > Math.abs(dx) + 14) { active = false; row.style.transform = ''; return; }
      row.style.transition = 'none';
      row.style.transform = `translateX(${Math.max(-120, Math.min(120, dx * 0.5))}px)`;
    }, { passive: true });
    content.addEventListener('touchend', () => {
      const r = row; row = null;
      if (!active || !r) return;
      active = false;
      r.style.transition = 'transform 160ms ease-out';
      r.style.transform = '';
      setTimeout(() => { r.style.transition = ''; }, 220);
      const btn = dx > 80 ? r.querySelector('[data-q="approve"]') : dx < -80 ? r.querySelector('[data-q="reject"]') : null;
      if (btn && !btn.disabled) btn.click();
    });
  }

  /* Library → “Make a card in Compose” */
  const lc = $('#libCardGo');
  if (lc) lc.addEventListener('click', () => { show('newpost'); });
})();

/* ── 24 · BOOT ──────────────────────────────────────────────────── */
pollStatus();
ensureSwitches();
loadHooks();
wireHookAdd();
renderApiExplorer('');
wireAutomation(); wireEgr(); wirePlanWeek(); // 5H (R85–R88)
loadUiState(); // 5J: saved UI state — KPI order, setup wizard, language
{
  const f = $('#apiExSearch');
  if (f) f.addEventListener('input', () => renderApiExplorer(f.value));
}
let startView = 'home';
try {
  /* deep link (#view=whatsapp, plus optional &row=…) wins over the remembered view; legacy names remap */
  const h = (location.hash || '').match(/view=([a-z-]+)/);
  const r = (location.hash || '').match(/row=([A-Za-z0-9._-]+)/);
  if (r) window.__deepRow = r[1];
  if (h && TITLES[LEGACY_VIEWS[h[1]] || h[1]]) startView = LEGACY_VIEWS[h[1]] || h[1];
  else { const v = localStorage.getItem('rc-view') || localStorage.getItem('rq6-view'); if (v && TITLES[LEGACY_VIEWS[v] || v]) startView = LEGACY_VIEWS[v] || v; }
} catch (e) {}
show(startView);
