/* Raqifluz client core — vanilla ES module (spec §1/§12) */
import { areaChart, sparkline } from './charts.js';
import { initQueue } from './queue.js';
import { initSettings } from './settings.js';
import { initPalette } from './palette.js';
import { initDnd } from './dnd.js';
import { bindI18nClient } from './i18n-client.js';

export const BOOT = JSON.parse(document.getElementById('boot-data')?.textContent || '{}');
export const LANG = BOOT.lang || 'en';
export const $ = (s, el = document) => el.querySelector(s);
export const $$ = (s, el = document) => [...el.querySelectorAll(s)];
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export async function api(path, opts = {}) {
  const res = await fetch('/api' + path, {
    headers: { 'Content-Type': 'application/json' },
    method: opts.method || (opts.body ? 'POST' : 'GET'),
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  let data = {};
  try { data = await res.json(); } catch { /* empty */ }
  if (!res.ok) {
    if (!opts.silent) toast(data.error || 'Something went wrong', 'err');
    throw Object.assign(new Error(data.error || res.statusText), { needPin: data.needPin, data });
  }
  return data;
}

/* ── toast ────────────────────────────────────────────────────── */
export function toast(msg, type = 'ok') {
  const zone = $('#toasts');
  if (!zone) return;
  const tpl = $('#tpl-toast').content.firstElementChild.cloneNode(true);
  tpl.classList.add(type);
  tpl.querySelector('[data-tpl="msg"]').textContent = msg;
  const icon = { ok: 'i-checkCircle', warn: 'i-alertTriangle', err: 'i-alertCircle' }[type] || 'i-checkCircle';
  tpl.querySelector('svg use').setAttribute('href', '#' + icon);
  zone.appendChild(tpl);
  const kill = () => { tpl.style.opacity = '0'; tpl.style.transform = 'translateY(8px)'; setTimeout(() => tpl.remove(), 180); };
  tpl.querySelector('[data-close-toast]').addEventListener('click', kill);
  setTimeout(kill, 3500);
}

/* ── relative time ────────────────────────────────────────────── */
export function timeAgo(ts) {
  const s = Math.max(1, Math.round((Date.now() - ts) / 1000));
  if (s < 60) return LANG === 'ur' ? s + ' سیکنٹ پہلے' : s + 's ago';
  const m = Math.round(s / 60);
  if (m < 60) return LANG === 'ur' ? m + ' منٹ پہلے' : m + 'm ago';
  const h = Math.round(m / 60);
  if (h < 24) return LANG === 'ur' ? h + ' گھنٹے پہلے' : h + 'h ago';
  const d2 = Math.round(h / 24);
  return LANG === 'ur' ? d2 + ' دن پہلے' : d2 + 'd ago';
}
export function fullTime(ts) {
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/* ── menu manager (one open at a time) ────────────────────────── */
let openMenu = null;
export function toggleMenu(btn, menu) {
  const willOpen = menu.hidden;
  closeMenus();
  if (willOpen) {
    menu.hidden = false;
    btn.setAttribute('aria-expanded', 'true');
    openMenu = { btn, menu };
  }
}
export function closeMenus() {
  if (openMenu) {
    openMenu.menu.hidden = true;
    openMenu.btn.setAttribute('aria-expanded', 'false');
    openMenu = null;
  }
  $$('.menu:not([hidden])').forEach((m) => { m.hidden = true; });
}
document.addEventListener('click', (e) => {
  if (!e.target.closest('.menu') && !e.target.closest('[aria-haspopup="true"]')) closeMenus();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    closeMenus();
    closeDrawer();
    closeModal();
    closePalette();
    closeMobileDrawer();
  }
});

/* ── theme / accent ───────────────────────────────────────────── */
export function applyTheme(theme, { save = true, toast: doToast = true } = {}) {
  const d = document.documentElement;
  d.setAttribute('data-theme', theme);
  try { localStorage.setItem('rq_theme', theme); } catch {}
  const ic = $('#theme-ic');
  if (ic) ic.querySelector('use').setAttribute('href', theme === 'dark' ? '#i-sun' : '#i-moon');
  if (save) api('/settings', { method: 'PUT', body: { theme }, silent: true }).catch(() => {});
  if (doToast) {
    const t = theme === 'dark' ? (LANG === 'ur' ? 'ڈارک' : 'Dark') : (LANG === 'ur' ? 'لائٹ' : 'Light');
    toast(LANG === 'ur' ? 'تھیم: ' + t : 'Theme: ' + t, 'ok');
  }
  drawCharts();
}
export function applyAccent(accent, save = true) {
  const d = document.documentElement;
  d.setAttribute('data-accent', accent);
  try { localStorage.setItem('rq_accent', accent); } catch {}
  if (save) api('/settings', { method: 'PUT', body: { accent }, silent: true }).catch(() => {});
}

/* ── language (cookie + reload = full RTL/translation) ────────── */
export function setLang(lang) {
  try {
    document.cookie = `rq_lang=${lang};path=/;max-age=${365 * 86400};samesite=lax`;
    localStorage.setItem('rq_lang', lang);
  } catch {}
  api('/settings', { method: 'PUT', body: { language: lang }, silent: true }).catch(() => {});
  location.reload();
}

/* ── panic stop (global) ──────────────────────────────────────── */
export async function togglePanic() {
  try {
    const { paused } = await api('/panic', { body: {} });
    setPausedUI(paused);
  } catch { /* toast shown by api() */ }
}
export function setPausedUI(paused) {
  const d = document.documentElement;
  /* banner */
  let banner = $('#panic-banner');
  if (paused && !banner) {
    banner = document.createElement('div');
    banner.className = 'panic-banner';
    banner.id = 'panic-banner';
    banner.setAttribute('role', 'alert');
    banner.innerHTML = `<svg class="ic"><use href="#i-alertTriangle"/></svg>
      <span>${esc(t('panic.banner'))}</span>
      <button class="btn btn-primary sm" id="panic-resume" type="button">${esc(t('panic.resume_btn'))}</button>`;
    const main = $('.main');
    main.insertBefore(banner, main.children[1]);
    banner.querySelector('#panic-resume').addEventListener('click', togglePanic);
  } else if (!paused && banner) {
    banner.remove();
  }
  /* status chip */
  const chip = $('#status-chip');
  if (chip) {
    chip.classList.toggle('paused', paused);
    const txt = $('#status-chip-txt');
    if (txt) txt.textContent = t(paused ? 'topbar.status_paused' : 'topbar.status_ok');
  }
  /* sidebar pill(s) + panic button(s) */
  for (const id of ['side-status', 'side-status-m']) {
    const p = document.getElementById(id);
    if (p) p.classList.toggle('paused', paused);
  }
  for (const id of ['side-status-txt', 'side-status-txt-m']) {
    const p = document.getElementById(id);
    if (p) p.textContent = paused ? t('app.paused') : t('app.online');
  }
  for (const id of ['panic-btn', 'panic-btn-m']) {
    const b = document.getElementById(id);
    if (b) {
      b.classList.toggle('btn-danger-solid', !paused);
      b.classList.toggle('btn-primary', paused);
      b.innerHTML = paused
        ? `<svg class="ic"><use href="#i-play"/></svg><span class="plabel">${esc(t('panic.resume'))}</span><svg class="ic"><use href="#i-play"/></svg>`
        : `<svg class="ic"><use href="#i-pause"/></svg><span class="plabel">${esc(t('panic.label'))}</span><svg class="ic"><use href="#i-pause"/></svg>`;
      b.onclick = togglePanic;
    }
  }
}

/* ── mobile drawer ────────────────────────────────────────────── */
export function openMobileDrawer() {
  const m = $('#m-drawer');
  if (!m) return;
  m.classList.add('open');
  document.body.style.overflow = 'hidden';
}
export function closeMobileDrawer() {
  const m = $('#m-drawer');
  if (m) { m.classList.remove('open'); document.body.style.overflow = ''; }
}

/* ── drawer / modal helpers (templates in partials/templates.ejs) ── */
export function openDrawer({ title, body, foot = '' }) {
  closeDrawer();
  const tpl = $('#tpl-drawer').content.firstElementChild.cloneNode(true);
  tpl.querySelector('[data-tpl="title"]').textContent = title;
  tpl.querySelector('[data-tpl="body"]').innerHTML = body;
  tpl.querySelector('[data-tpl="foot"]').innerHTML = foot;
  document.body.appendChild(tpl);
  $$('[data-close-d]', tpl).forEach((el) => el.addEventListener('click', closeDrawer));
  return tpl;
}
export function closeDrawer() {
  $$('.scrim[data-close-d]').forEach((s) => s.remove());
  $$('.drawer').forEach((d) => d.remove());
}
export function openModal({ title, sub = '', body, foot = '', wide = false, stretch = false }) {
  closeModal();
  const tpl = $('#tpl-modal').content.firstElementChild.cloneNode(true);
  const modal = tpl.querySelector('.modal');
  if (wide) modal.classList.add('wide');
  if (stretch) modal.querySelector('.modal-f').classList.add('stretch');
  tpl.querySelector('[data-tpl="title"]').textContent = title;
  tpl.querySelector('[data-tpl="sub"]').textContent = sub;
  tpl.querySelector('[data-tpl="body"]').innerHTML = body;
  tpl.querySelector('[data-tpl="foot"]').innerHTML = foot;
  document.body.appendChild(tpl);
  $$('[data-close-m2]', tpl).forEach((el) => el.addEventListener('click', closeModal));
  const first = tpl.querySelector('input, select, textarea, button');
  if (first) setTimeout(() => first.focus(), 40);
  return tpl;
}
export function closeModal() {
  $$('.modal-scrim').forEach((s) => s.remove());
  $$('.modal').forEach((m) => m.remove());
}

/* ── confirm modal helper ─────────────────────────────────────── */
export function confirmModal(title, msg, { danger = false, label } = {}) {
  return new Promise((resolve) => {
    const m = openModal({
      title, sub: msg,
      body: '',
      foot: `<button class="btn btn-secondary" data-x>${esc(t('common.cancel'))}</button>
             <button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-y>${esc(label || t('common.confirm'))}</button>`,
    });
    m.querySelector('[data-x]').addEventListener('click', () => { closeModal(); resolve(false); });
    m.querySelector('[data-y]').addEventListener('click', () => { closeModal(); resolve(true); });
  });
}

/* ── charts registry (redraw on theme change / resize) ────────── */
const chartJobs = [];
export function registerChart(job) { chartJobs.push(job); job(); }
export function drawCharts() { chartJobs.forEach((j) => { try { j(); } catch (e) { console.error(e); } }); }
let rTimer = null;
window.addEventListener('resize', () => {
  clearTimeout(rTimer);
  rTimer = setTimeout(drawCharts, 250);
});

/* ── translation (client-side strings mirror server locale) ───── */
let _dict = {};
export function t(key, vars) {
  let s = _dict[key];
  if (s === undefined) s = key;
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.split(`{${k}}`).join(String(v));
  return s;
}
export async function loadDict() {
  try {
    const r = await fetch(`/locales/${LANG}.json`);
    _dict = await r.json();
  } catch { _dict = {}; }
}

/* ── boot ─────────────────────────────────────────────────────── */
function boot() {
  loadDict();
  bindI18nClient();

  /* theme icon to current state */
  const theme = document.documentElement.getAttribute('data-theme') || 'dark';
  const tic = $('#theme-ic');
  if (tic) tic.querySelector('use').setAttribute('href', theme === 'dark' ? '#i-sun' : '#i-moon');

  /* theme toggle */
  $('#theme-toggle')?.addEventListener('click', () => {
    const cur = document.documentElement.getAttribute('data-theme');
    applyTheme(cur === 'dark' ? 'light' : 'dark');
  });

  /* menus */
  $('#status-chip')?.addEventListener('click', (e) => { e.stopPropagation(); toggleMenu(e.currentTarget, $('#status-menu')); });
  $('#bell-btn')?.addEventListener('click', (e) => { e.stopPropagation(); toggleMenu(e.currentTarget, $('#bell-menu')); });
  $('#user-btn')?.addEventListener('click', (e) => { e.stopPropagation(); toggleMenu(e.currentTarget, $('#user-menu')); });

  /* bell: mark read */
  $('#mark-read')?.addEventListener('click', async () => {
    try {
      await api('/notifs/read', { body: {}, silent: true });
      const dot = $('#bell-dot'); if (dot) dot.remove();
      $$('#bell-menu .dot[style*="var(--info)"]').forEach((d) => d.style.background = 'var(--surface-3)');
    } catch {}
  });

  /* user menu */
  $('#user-menu')?.addEventListener('click', (e) => {
    const b = e.target.closest('[data-user]');
    if (!b) return;
    const a = b.dataset.user;
    closeMenus();
    if (a === 'profile' || a === 'settings') location.href = '/settings';
    if (a === 'about') location.href = '/about';
  });
  $('#lang-en')?.addEventListener('click', () => setLang('en'));
  $('#lang-ur')?.addEventListener('click', () => setLang('ur'));

  /* global search → palette */
  $('#gsearch')?.addEventListener('click', () => openPalette());
  $('#search-m')?.addEventListener('click', () => openPalette());
  initPalette();

  /* panic buttons */
  $$('.panic-btn').forEach((b) => b.addEventListener('click', togglePanic));
  $('#panic-resume')?.addEventListener('click', togglePanic);

  /* mobile */
  $('#hamb')?.addEventListener('click', openMobileDrawer);
  $$('#m-drawer [data-close-m]').forEach((el) => el.addEventListener('click', closeMobileDrawer));
  $$('#m-drawer a[data-nav]').forEach((a) => a.addEventListener('click', closeMobileDrawer));

  /* charts + pages */
  initPage();
  setTimeout(drawCharts, 60);
  window.__BOOT_SWITCHES = BOOT.settings?.switches || {};
}

function initPage() {
  const page = document.body.dataset.page;
  if (page === 'home') initHome();
  if (page === 'queue') initQueue();
  if (page === 'settings') initSettings();
  if (page === 'routing' || page === 'rules') initDnd();
  if (page === 'sources') initSources();
  if (page === 'targets') initTargets();
  if (page === 'discover') initDiscover();
  if (page === 'routing') initRouting();
  if (page === 'compose') initCompose();
  if (page === 'scheduled') initScheduled();
  if (page === 'history') initHistory();
  if (page === 'library') initLibrary();
  if (page === 'brand') initBrand();
  if (page === 'whatsapp') initWhatsapp();
  if (page === 'contacts') initContacts();
  if (page === 'auto-replies') initAutoReplies();
  if (page === 'ai-pilot') initPilot();
  if (page === 'analytics') initAnalytics();
  if (page === 'health') initHealth();
  if (page === 'logs') initLogs();
  if (page === 'about') initAbout();
  if (page === 'not-found') {}
}

/* ── HOME ─────────────────────────────────────────────────────── */
function initHome() {
  const chartHost = $('#home-chart');
  let curRange = '7d';
  const draw = () => {
    const data = window.__HOME_SERIES?.[curRange];
    if (!data || !chartHost) return;
    areaChart(chartHost, data, {
      colors: { published: 'var(--success)', skipped: 'var(--info)', failed: 'var(--error)' },
      ticks: data.ticks,
    });
  };
  registerChart(draw);
  /* range chips */
  $$('.range-chip').forEach((c) => c.addEventListener('click', () => {
    $$('.range-chip').forEach((x) => x.setAttribute('aria-pressed', x === c ? 'true' : 'false'));
    curRange = c.dataset.range;
    draw();
  }));
  /* live activity via SSE */
  const list = $('#act-list');
  if (list) {
    const es = new EventSource(`/api/activity/stream?since=${Date.now()}`);
    es.onmessage = (ev) => {
      try {
        const items = JSON.parse(ev.data);
        for (const it of items) {
          const row = document.createElement('div');
          row.className = 'act-row';
          const dot = it.kind === 'failed' ? 'err' : it.kind === 'skipped' ? 'warn' : 'ok';
          row.innerHTML = `<span class="act-dot ${dot}"></span>
            <span class="act-body"><b>${esc(it.status)}</b> · ${esc(it.text)}</span>
            <span class="act-time">${timeAgo(it.at)}</span>`;
          list.prepend(row);
        }
        while (list.children.length > 7) list.lastElementChild.remove();
      } catch {}
    };
    es.onerror = () => {};
  }
  /* ticking counters (sim) */
  const todayVal = $('#kpi-today-val');
  if (todayVal) {
    let cur = todayVal.textContent;
    setInterval(async () => {
      try {
        const { kpis } = await api('/stats?range=7d', { silent: true });
        const v = kpis.today.value;
        const [before, after] = cur.match(/^(\d+)(.*)$/);
        const next = before ? Math.max(parseInt(before, 10), v) : v;
        todayVal.textContent = next + (after || '');
        cur = todayVal.textContent;
      } catch {}
    }, 25_000);
  }
  /* self-test (home card) */
  $('#selftest-home')?.addEventListener('click', runSelfTest);
  $('#greet-panic')?.addEventListener('click', togglePanic);
  /* setup wizard */
  $('#setup-open')?.addEventListener('click', openSetupWizard);
  /* quick actions */
  $$('.qa').forEach((a) => a.addEventListener('click', () => { location.href = a.dataset.href; }));
  /* pacing toggle */
  $('#pacing-toggle')?.addEventListener('click', async (e) => {
    e.preventDefault();
    const on = e.currentTarget.getAttribute('aria-checked') !== 'true';
    e.currentTarget.setAttribute('aria-checked', on ? 'true' : 'false');
    e.currentTarget.closest('.card')?.classList.toggle('on', on);
    const cap = $('#pacing-cap');
    if (cap) cap.style.opacity = on ? '1' : '.5';
    try {
      await api('/settings', { method: 'PUT', body: { pacing: { adaptive: on } }, silent: true });
    } catch {}
  });
  /* queue overview counts are static per render; refresh from /api/queue on arrival is handled by sim reload */
}

async function runSelfTest(btn) {
  const host = btn.closest('.card') || document;
  const rows = $$('.check-row', host);
  const log = host.querySelector('.test-log');
  if (log) { log.classList.add('show'); log.innerHTML = ''; }
  for (const row of rows) {
    const ic = row.querySelector('svg');
    if (ic) { ic.classList.add('spin'); ic.querySelector('use').setAttribute('href', '#i-refresh'); }
    await new Promise((r) => setTimeout(r, 220));
    if (ic) { ic.classList.remove('spin'); ic.querySelector('use').setAttribute('href', '#i-checkCircle'); }
    if (log) log.insertAdjacentHTML('beforeend', `<div class="ln ok">✓ ${esc(row.textContent.trim())}</div>`);
  }
  try { await api('/health/self-test', { body: {}, silent: true }); } catch {}
  toast(LANG === 'ur' ? 'سیف ٹیسٹ کامیاب' : 'Self-test passed', 'ok');
}

function openSetupWizard() {
  const steps = window.__SETUP_STEPS || [];
  const idx = Math.min(steps.findIndex((s) => !s.done), 4);
  const m = openModal({
    title: t('home.setup'),
    sub: t('home.setup_step', { n: idx + 1 }),
    wide: true,
    body: `<div class="steps">
      ${steps.map((s, i) => `
        <div class="step ${s.done ? 'done' : ''} ${i === idx ? 'cur' : ''}">
          <span class="n">${s.done ? '<svg class="ic ic-sm"><use href="#i-check"/></svg>' : i + 1}</span>
          <span class="txt">${esc(s.name)}</span>
          ${s.done ? '' : i === idx ? '<button class="btn btn-primary sm" data-step-done type="button">' + esc(t('common.saved')) + '</button>' : '<small>—</small>'}
        </div>`).join('')}
    </div>`,
    foot: `<button class="btn btn-secondary" data-next>${esc(t('home.setup_next'))}</button>`,
  });
  m.querySelector('[data-step-done]')?.addEventListener('click', async () => {
    try { await api('/settings', { method: 'PUT', body: { reportTime: '08:00' }, silent: true }); } catch {}
    closeModal();
    toast(t('common.saved'), 'ok');
  });
  m.querySelector('[data-next]').addEventListener('click', () => {
    const cur = idx;
    if (cur >= 4) { closeModal(); return; }
    const nextSteps = steps.map((s, i) => (i === cur ? { ...s, done: true } : s));
    m.querySelector('.steps').outerHTML = `
      <div class="steps">
      ${nextSteps.map((s, i) => `
        <div class="step ${s.done ? 'done' : ''} ${i === cur + 1 && !s.done ? 'cur' : ''}">
          <span class="n">${s.done ? '<svg class="ic ic-sm"><use href="#i-check"/></svg>' : i + 1}</span>
          <span class="txt">${esc(s.name)}</span>
          ${!s.done && i === cur + 1 ? '<button class="btn btn-primary sm" data-step-done type="button">' + esc(t('common.saved')) + '</button>' : '<small>—</small>'}
        </div>`).join('')}
    </div>`;
    m.querySelector('[data-step-done]')?.addEventListener('click', () => { closeModal(); toast(t('common.saved'), 'ok'); });
  });
}

/* ── SOURCES ──────────────────────────────────────────────────── */
function initSources() {
  /* tabs */
  bindTabs('#src-tabs', '#src-list');
  /* add modal */
  $('#src-add')?.addEventListener('click', () => {
    const m = openModal({
      title: t('sources.add_title'), sub: t('sources.add_sub'),
      body: `
        <div class="field"><label>${t('sources.name')}</label><input class="input" id="sa-name" maxlength="60" placeholder="e.g. Tech News"></div>
        <div class="field"><label>${t('sources.link')}</label><input class="input" id="sa-link" placeholder="${esc(t('sources.link_ph'))}"></div>
        <div class="field"><label>${t('sources.status')}</label>
          <select class="select" id="sa-status"><option value="active">${t('common.active')}</option><option value="paused">${t('common.paused')}</option></select>
        </div>
        <div id="sa-test" class="small muted" style="display:none"></div>`,
      foot: `<button class="btn btn-secondary" id="sa-test-btn">${esc(t('sources.test'))}</button>
             <button class="btn btn-primary" id="sa-save">${esc(t('common.add'))}</button>`,
    });
    m.querySelector('#sa-test-btn').addEventListener('click', async () => {
      const btn = m.querySelector('#sa-test-btn');
      const out = m.querySelector('#sa-test');
      btn.disabled = true; btn.textContent = t('sources.testing');
      out.style.display = 'block'; out.textContent = '…';
      await new Promise((r) => setTimeout(r, 900));
      const link = m.querySelector('#sa-link').value.trim();
      const ok = !link || link.startsWith('@') || link.includes('t.me/');
      out.textContent = ok ? t('sources.test_ok', { n: 12 + Math.floor(Math.random() * 40) }) : t('sources.test_fail');
      out.style.color = ok ? 'var(--success-text)' : 'var(--error-text)';
      btn.disabled = false; btn.textContent = t('sources.test');
    });
    m.querySelector('#sa-save').addEventListener('click', async () => {
      const name = m.querySelector('#sa-name').value.trim();
      const link = m.querySelector('#sa-link').value.trim();
      if (!name || !link) return toast(LANG === 'ur' ? 'نام اور لنک درکار ہیں' : 'Name and link are required', 'err');
      try {
        const { item } = await api('/sources', { body: { name, link, status: m.querySelector('#sa-status').value } });
        closeModal();
        toast(t('sources.toast_added'), 'ok');
        location.reload();
      } catch {}
    });
  });
  /* rows */
  $$('#src-list [data-id]').forEach((row) => {
    const id = parseInt(row.dataset.id, 10);
    row.querySelector('[data-act="rules"]')?.addEventListener('click', () => openSourceRules(id));
    row.querySelector('[data-act="menu"]')?.addEventListener('click', (e) => {
      e.stopPropagation();
      openRowMenu(row, row.querySelector('[data-act="menu"]'), [
        { label: row.dataset.status === 'paused' ? t('sources.menu.resume') : t('sources.menu.pause'), run: async () => {
            try { await api(`/sources/${id}`, { method: 'PUT', body: { name: row.dataset.name, handle: row.dataset.handle, status: row.dataset.status === 'paused' ? 'active' : 'paused' } }); location.reload(); } catch {}
        } },
        { label: t('sources.menu.duplicate'), run: async () => {
            try { await api('/sources', { body: { name: row.dataset.name + ' (copy)', link: row.dataset.handle } }); toast(t('sources.toast_added')); location.reload(); } catch {}
        } },
        { label: t('sources.menu.delete'), danger: true, run: async () => {
            if (!(await confirmModal(t('common.delete'), t('sources.delete_confirm', { name: row.dataset.name }), { danger: true }))) return;
            try { await api(`/sources/${id}`, { method: 'DELETE', body: {} }); location.reload(); } catch {}
        } },
      ]);
    });
  });
}

function openSourceRules(id) {
  const s = (window.__SOURCES || []).find((x) => x.id === id);
  if (!s) return;
  const m = openModal({
    title: t('sources.rules_title', { name: s.name }),
    wide: true,
    body: `
      <div class="set-grid">
        <div class="field"><label>${t('sources.r.approval')}</label>
          <select class="select" id="r-approval">
            <option value="inherit" ${s.rules.approval === 'inherit' ? 'selected' : ''}>${t('sources.r.approval.inherit')}</option>
            <option value="manual" ${s.rules.approval === 'manual' ? 'selected' : ''}>${t('sources.r.approval.manual')}</option>
            <option value="auto" ${s.rules.approval === 'auto' ? 'selected' : ''}>${t('sources.r.approval.auto')}</option>
          </select></div>
        <div class="field"><label>${t('sources.r.max_hour')}</label><input class="input" id="r-maxh" type="number" min="1" max="200" value="${s.rules.maxPerHour}"></div>
        <div class="field set-full"><label>${t('sources.r.include')}</label><input class="input" id="r-inc" value="${esc((s.rules.include || []).join(', '))}" placeholder="${esc(t('sources.r.include_ph'))}"></div>
        <div class="field set-full"><label>${t('sources.r.exclude')}</label><input class="input" id="r-exc" value="${esc((s.rules.exclude || []).join(', '))}"></div>
        <label class="chk-row2"><span class="chk" role="checkbox" tabindex="0" aria-checked="${s.rules.mediaOnly ? 'true' : 'false'}" id="r-media" style="cursor:pointer"><svg class="ic"><use href="#i-check"/></svg></span>${t('sources.r.media_only')}</label>
        <label class="chk-row2"><span class="chk" role="checkbox" tabindex="0" aria-checked="${s.rules.stripLinks ? 'true' : 'false'}" id="r-strip" style="cursor:pointer"><svg class="ic"><use href="#i-check"/></svg></span>${t('sources.r.strip')}</label>
        <div class="field"><label>${t('sources.r.translate')}</label>
          <select class="select" id="r-trans">
            <option value="none" ${s.rules.translate === 'none' ? 'selected' : ''}>—</option>
            <option value="en" ${s.rules.translate === 'en' ? 'selected' : ''}>English</option>
            <option value="ur" ${s.rules.translate === 'ur' ? 'selected' : ''}>اردو</option>
          </select></div>
        <label class="chk-row2"><span class="chk" role="checkbox" tabindex="0" aria-checked="${s.rules.footer ? 'true' : 'false'}" id="r-foot" style="cursor:pointer"><svg class="ic"><use href="#i-check"/></svg></span>${t('sources.r.footer')}</label>
      </div>`,
    foot: `<button class="btn btn-secondary" data-x>${esc(t('common.cancel'))}</button>
           <button class="btn btn-primary" data-y>${esc(t('common.save'))}</button>`,
  });
  $$('#r-media, #r-strip, #r-foot', m).forEach((c) => c.addEventListener('click', () => toggleChk(c)));
  m.querySelector('[data-x]').addEventListener('click', closeModal);
  m.querySelector('[data-y]').addEventListener('click', async () => {
    try {
      await api(`/sources/${id}`, {
        method: 'PUT', body: {
          name: s.name, handle: s.handle,
          status: s.status,
          rules: {
            approval: m.querySelector('#r-approval').value,
            maxPerHour: parseInt(m.querySelector('#r-maxh').value, 10) || 20,
            include: m.querySelector('#r-inc').value.split(',').map((x) => x.trim()).filter(Boolean),
            exclude: m.querySelector('#r-exc').value.split(',').map((x) => x.trim()).filter(Boolean),
            mediaOnly: m.querySelector('#r-media').getAttribute('aria-checked') === 'true',
            stripLinks: m.querySelector('#r-strip').getAttribute('aria-checked') === 'true',
            footer: m.querySelector('#r-foot').getAttribute('aria-checked') === 'true',
            translate: m.querySelector('#r-trans').value,
            trusted: s.rules.trusted,
            routes: s.rules.routes,
          },
        },
      });
      closeModal();
      toast(t('sources.toast_saved'), 'ok');
    } catch {}
  });
}

/* row menu helper */
export function openRowMenu(row, anchor, items) {
  closeMenus();
  const menu = document.createElement('div');
  menu.className = 'menu';
  menu.style.top = '40px';
  menu.innerHTML = items.map((it, i) => `<button class="menu-item" data-i="${i}" style="${it.danger ? 'color:var(--error-text)' : ''}">${esc(it.label)}</button>`).join('');
  row.appendChild(menu);
  const kill = () => { menu.remove(); document.removeEventListener('click', kill); };
  setTimeout(() => document.addEventListener('click', (e) => { if (!e.target.closest('.menu')) kill(); }), 0);
  menu.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => { kill(); items[parseInt(b.dataset.i, 10)].run(); }));
}
export function toggleChk(el) {
  const on = el.getAttribute('aria-checked') !== 'true';
  el.setAttribute('aria-checked', on ? 'true' : 'false');
}

/* tabs helper */
export function bindTabs(tabsSel, listSel) {
  const tabs = $(tabsSel);
  if (!tabs) return;
  const list = $(listSel);
  $$('.tab', tabs).forEach((tab) => {
    tab.addEventListener('click', () => {
      $$('.tab', tabs).forEach((x) => x.setAttribute('aria-selected', x === tab ? 'true' : 'false'));
      if (list) {
        const f = tab.dataset.filter || '';
        $$(listSel + ' [data-status]').forEach((row) => {
          row.style.display = !f || f === 'all' || row.dataset.status === f ? '' : 'none';
        });
      }
      tabs.dispatchEvent(new CustomEvent('tab-change', { detail: { filter: tab.dataset.filter } }));
    });
  });
}

/* ── TARGETS ──────────────────────────────────────────────────── */
function initTargets() {
  bindTabs('#tg-tabs', '#tg-list');
  /* pagination */
  const rows = $$('#tg-list [data-id]');
  const PER = 20;
  let page = 0;
  const renderPage_ = () => {
    rows.forEach((row, i) => { row.style.display = Math.floor(i / PER) === page ? '' : 'none'; });
    const pages = Math.ceil(rows.length / PER);
    const info = $('#tg-pageinfo');
    if (info) info.textContent = `${page * PER + 1}–${Math.min((page + 1) * PER, rows.length)} / ${rows.length}`;
    const prev = $('#tg-prev'), next = $('#tg-next');
    if (prev) prev.disabled = page === 0;
    if (next) next.disabled = page >= pages - 1;
  };
  $('#tg-prev')?.addEventListener('click', () => { page = Math.max(0, page - 1); renderPage_(); });
  $('#tg-next')?.addEventListener('click', () => { page = Math.min(Math.ceil(rows.length / PER) - 1, page + 1); renderPage_(); });
  const refresh = () => renderPage_();
  $('#tg-tabs')?.addEventListener('tab-change', refresh);
  rows.forEach((row) => {
    const id = parseInt(row.dataset.id, 10);
    row.querySelector('[data-act="rules"]')?.addEventListener('click', () => openTargetRules(id));
    row.querySelector('[data-act="fix"]')?.addEventListener('click', async () => {
      try { await api(`/targets/${id}`, { method: 'PUT', body: { name: row.dataset.name, link: row.dataset.handle, status: 'active', error: null } }); toast(t('targets.reconnected', { name: row.dataset.name }), 'ok'); location.reload(); } catch {}
    });
    row.querySelector('[data-act="menu"]')?.addEventListener('click', (e) => {
      e.stopPropagation();
      openRowMenu(row, row.querySelector('[data-act="menu"]'), [
        { label: row.dataset.status === 'paused' ? t('targets.menu.resume') : t('targets.menu.pause'), run: async () => {
            try { await api(`/targets/${id}`, { method: 'PUT', body: { name: row.dataset.name, link: row.dataset.handle, status: row.dataset.status === 'paused' ? 'active' : 'paused' } }); location.reload(); } catch {}
        } },
        { label: t('targets.menu.delete'), danger: true, run: async () => {
            if (!(await confirmModal(t('common.delete'), t('targets.delete_confirm', { name: row.dataset.name }), { danger: true }))) return;
            try { await api(`/targets/${id}`, { method: 'DELETE', body: {} }); location.reload(); } catch {}
        } },
      ]);
    });
  });
  $('#tg-add')?.addEventListener('click', () => {
    const m = openModal({
      title: t('targets.add_title'),
      body: `
        <div class="field"><label>${t('targets.name')}</label><input class="input" id="ta-name"></div>
        <div class="field"><label>${t('targets.link')}</label><input class="input" id="ta-link" placeholder="@handle · +92 …"></div>
        <div class="field"><label>${t('targets.kind')}</label>
          <select class="select" id="ta-kind"><option value="channel">${t('targets.kind.channel')}</option><option value="group">${t('targets.kind.group')}</option><option value="user">${t('targets.kind.user')}</option></select></div>`,
      foot: `<button class="btn btn-secondary" data-x>${esc(t('common.cancel'))}</button>
             <button class="btn btn-primary" data-y>${esc(t('common.add'))}</button>`,
    });
    m.querySelector('[data-x]').addEventListener('click', closeModal);
    m.querySelector('[data-y]').addEventListener('click', async () => {
      const name = m.querySelector('#ta-name').value.trim();
      const link = m.querySelector('#ta-link').value.trim();
      if (!name || !link) return toast(LANG === 'ur' ? 'نام اور لنک درکار ہیں' : 'Name and link are required', 'err');
      try {
        await api('/targets', { body: { name, link, kind: m.querySelector('#ta-kind').value } });
        closeModal(); toast(t('targets.toast_added'), 'ok'); location.reload();
      } catch {}
    });
  });
}
function openTargetRules(id) {
  const tg = (window.__TARGETS || []).find((x) => x.id === id);
  if (!tg) return;
  const m = openModal({
    title: t('targets.rules_title', { name: tg.name }),
    body: `
      <div class="set-grid">
        <div class="field"><label>${t('targets.r.types')}</label>
          <select class="select" id="gr-types"><option value="all" ${tg.rules.types === 'all' ? 'selected' : ''}>${t('targets.r.types.all')}</option><option value="text" ${tg.rules.types === 'text' ? 'selected' : ''}>${t('targets.r.types.text')}</option><option value="media" ${tg.rules.types === 'media' ? 'selected' : ''}>${t('targets.r.types.media')}</option></select></div>
        <div class="field"><label>${t('targets.r.lang')}</label>
          <select class="select" id="gr-lang"><option value="auto" ${tg.rules.lang === 'auto' ? 'selected' : ''}>Auto</option><option value="en" ${tg.rules.lang === 'en' ? 'selected' : ''}>English</option><option value="ur" ${tg.rules.lang === 'ur' ? 'selected' : ''}>اردو</option></select></div>
        <div class="field"><label>${t('targets.r.max_day')}</label><input class="input" id="gr-max" type="number" min="1" max="500" value="${tg.rules.maxPerDay}"></div>
        <label class="chk-row2"><span class="chk" role="checkbox" tabindex="0" aria-checked="${tg.rules.footer ? 'true' : 'false'}" id="gr-foot" style="cursor:pointer"><svg class="ic"><use href="#i-check"/></svg></span>${t('targets.r.footer')}</label>
      </div>`,
    foot: `<button class="btn btn-secondary" data-x>${esc(t('common.cancel'))}</button>
           <button class="btn btn-primary" data-y>${esc(t('common.save'))}</button>`,
  });
  m.querySelector('#gr-foot').addEventListener('click', (e) => toggleChk(e.currentTarget));
  m.querySelector('[data-x]').addEventListener('click', closeModal);
  m.querySelector('[data-y]').addEventListener('click', async () => {
    try {
      await api(`/targets/${id}`, {
        method: 'PUT', body: {
          name: tg.name, link: tg.handle, status: tg.status, kind: tg.kind,
          rules: { types: m.querySelector('#gr-types').value, lang: m.querySelector('#gr-lang').value, maxPerDay: parseInt(m.querySelector('#gr-max').value, 10) || 50, footer: m.querySelector('#gr-foot').getAttribute('aria-checked') === 'true' },
        },
      });
      closeModal(); toast(t('common.saved'), 'ok');
    } catch {}
  });
}

/* ── DISCOVER ─────────────────────────────────────────────────── */
function initDiscover() {
  const cards = $$('#disc-grid [data-id]');
  const apply = () => {
    const q = ($('#disc-search')?.value || '').toLowerCase();
    const cat = document.querySelector('#disc-cats .chip[aria-pressed="true"]')?.dataset.cat || 'all';
    cards.forEach((c) => {
      const okCat = cat === 'all' || c.dataset.cat === cat;
      const okQ = !q || c.dataset.name.toLowerCase().includes(q) || c.dataset.handle.toLowerCase().includes(q);
      c.style.display = okCat && okQ ? '' : 'none';
    });
  };
  $('#disc-search')?.addEventListener('input', apply);
  $$('#disc-cats .chip').forEach((c) => c.addEventListener('click', () => {
    $$('#disc-cats .chip').forEach((x) => x.setAttribute('aria-pressed', x === c ? 'true' : 'false'));
    apply();
  }));
  cards.forEach((c) => {
    const id = parseInt(c.dataset.id, 10);
    c.querySelector('[data-act="add"]')?.addEventListener('click', async (e) => {
      e.currentTarget.disabled = true;
      try {
        await api(`/discover/${id}`, { body: {} });
        e.currentTarget.textContent = t('discover.added');
        e.currentTarget.classList.remove('btn-primary');
        e.currentTarget.classList.add('btn-secondary');
        toast(t('discover.toast', { name: c.dataset.name }), 'ok');
      } catch { e.currentTarget.disabled = false; }
    });
    c.querySelector('[data-act="preview"]')?.addEventListener('click', () => {
      openModal({
        title: c.dataset.name,
        sub: c.dataset.handle + ' · ' + t('discover.subs', { n: c.dataset.subs }),
        body: `<p class="small" style="color:var(--text-2)">${esc(c.dataset.desc || '')}</p>
               <div class="mono-line">📣 ${esc(c.dataset.name)} · new post detected 2m ago</div>
               <div class="mono-line">“Top 5 updates from the wire — read the full breakdown.”</div>`,
        foot: `<button class="btn btn-primary" data-x>${esc(t('common.close'))}</button>`,
      }).querySelector('[data-x]').addEventListener('click', closeModal);
    });
  });
}

/* ── ROUTING ──────────────────────────────────────────────────── */
function initRouting() {
  const list = $('#route-list');
  const cards = $$('#route-list .route-card');
  const renum = () => cards.forEach((c, i) => { const n = c.querySelector('.route-prio'); if (n) n.textContent = i + 1; });
  /* new route drawer */
  $('#route-new')?.addEventListener('click', () => {
    const srcs = (window.__SRC_LIST || []).map((s) => `<option>${esc(s.name)}</option>`).join('');
    const tgs = (window.__TGT_LIST || []).map((s) => `<option>${esc(s)}</option>`).join('');
    const d = openDrawer({
      title: t('routing.new_title'),
      body: `
        <div class="field"><label>${t('routing.source')}</label><select class="select" id="rr-src">${srcs}</select></div>
        <div class="field"><label>${t('routing.targets')}</label><select class="select" id="rr-tgs" multiple size="5">${tgs}</select></div>
        <div class="field"><label>${t('routing.cond.keywords')}</label><input class="input" id="rr-kw" placeholder="${esc(t('routing.cond.keywords_ph'))}"></div>
        <div class="set-grid">
          <label class="chk-row2"><span class="chk" role="checkbox" tabindex="0" aria-checked="false" id="rr-media"><svg class="ic"><use href="#i-check"/></svg></span>${t('routing.cond.media')}</label>
          <div class="field"><label>${t('routing.cond.lang')}</label><select class="select" id="rr-lang"><option value="any">${t('routing.cond.any')}</option><option value="en">English</option><option value="ur">اردو</option></select></div>
          <div class="field"><label>${t('routing.delay')}</label><input class="input" id="rr-delay" type="number" min="0" max="1440" value="0"></div>
          <div class="field"><label>${t('routing.approval')}</label><select class="select" id="rr-appr"><option value="inherit">${t('routing.inherit')}</option><option value="manual">Manual</option><option value="auto">Auto</option></select></div>
        </div>`,
      foot: `<button class="btn btn-secondary" data-x>${esc(t('common.cancel'))}</button>
             <button class="btn btn-primary" data-y>${esc(t('common.save'))}</button>`,
    });
    d.querySelector('#rr-media').addEventListener('click', (e) => toggleChk(e.currentTarget));
    d.querySelector('[data-x]').addEventListener('click', closeDrawer);
    d.querySelector('[data-y]').addEventListener('click', async () => {
      const targets = [...d.querySelector('#rr-tgs').selectedOptions].map((o) => o.value);
      if (!targets.length) return toast(LANG === 'ur' ? 'کم از کم ایک ٹارگٹ منتخب کریں' : 'Select at least one target', 'err');
      try {
        await api('/routes', {
          body: {
            source: d.querySelector('#rr-src').value,
            targets, keywords: d.querySelector('#rr-kw').value,
            media: d.querySelector('#rr-media').getAttribute('aria-checked') === 'true',
            lang: d.querySelector('#rr-lang').value,
            delay: parseInt(d.querySelector('#rr-delay').value, 10) || 0,
            approval: d.querySelector('#rr-appr').value, on: true,
          },
        });
        closeDrawer(); toast(t('routing.toast_saved'), 'ok'); location.reload();
      } catch {}
    });
  });
  /* enable toggle + delete */
  cards.forEach((c) => {
    const id = parseInt(c.dataset.id, 10);
    c.querySelector('[data-act="toggle"]')?.addEventListener('click', async (e) => {
      const on = e.currentTarget.getAttribute('aria-checked') !== 'true';
      e.currentTarget.setAttribute('aria-checked', on ? 'true' : 'false');
      c.style.opacity = on ? '1' : '.55';
      try { await api(`/routes/${id}`, { method: 'PUT', body: { on, source: c.dataset.source, targets: JSON.parse(c.dataset.targets || '[]') } }); } catch {}
    });
    c.querySelector('[data-act="del"]')?.addEventListener('click', async () => {
      try { await api(`/routes/${id}`, { method: 'DELETE', body: {} }); toast(t('routing.toast_deleted'), 'ok'); location.reload(); } catch {}
    });
  });
  if (list) renum();
}

/* ── COMPOSE ──────────────────────────────────────────────────── */
function initCompose() {
  const ta = $('#cmp-text');
  const count = $('#cmp-count');
  const preview = $('#cmp-preview');
  const renderPreview = () => {
    if (!preview || !ta) return;
    const sw = BOOT.settings.switches;
    const brand = window.__BRAND || {};
    let text = ta.value || '';
    const tags = [...text.matchAll(/#(\w+)/g)].map((m) => '#' + m[1]);
    let linksStripped = false;
    if (sw.strip_links) {
      const urls = text.match(/\bhttps?:\/\/\S+/g) || [];
      if (urls.some((u) => !u.includes('t.me/'))) {
        text = text.replace(/\bhttps?:\/\/(?!t\.me\/)\S+/g, ' ');
        linksStripped = true;
      }
    }
    const footer = sw.brand_footer && brand.footer ? renderVars(brand.footer, brand.name) : '';
    preview.innerHTML = `
      ${ta.dataset.media ? `<div class="bmedia thumb ${thumbClass(ta.dataset.media)}" style="width:100%;height:140px;border-radius:10px"><svg class="ic" style="width:40px;height:40px"><use href="#i-${motifIcon(ta.dataset.media)}"/></svg></div>` : ''}
      <div style="white-space:pre-wrap">${esc(text)}</div>
      ${tags.length ? `<div style="margin-top:8px;display:flex;gap:6px;flex-wrap:wrap">${tags.map((x) => `<span class="htag">${esc(x)}</span>`).join('')}</div>` : ''}
      ${footer ? `<div style="margin-top:8px;color:var(--text-3);font-size:12px">${esc(footer)}</div>` : ''}
      <div class="btime">${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
      ${sw.dedupe_posts ? `<div style="margin-top:8px" class="sim-note"><svg class="ic ic-sm"><use href="#i-alertCircle"/></svg><span>${esc(t('compose.dedupe'))}</span><button class="card-link" style="margin-inline-start:auto;border:0;background:none;cursor:pointer;font-size:12px;color:var(--accent)" onclick="this.closest('.bubble').remove()">${esc(t('compose.dedupe_skip'))}</button></div>` : ''}
      ${linksStripped ? `<div style="margin-top:6px;font-size:11px;color:var(--text-3)">${esc(t('compose.strip_links'))}</div>` : ''}`;
  };
  function renderVars(str, name) {
    return String(str || '').replace(/\{brand\}/g, name || 'Raqifluz').replace(/\{date\}/g, new Date().toLocaleDateString());
  }
  function motifIcon(m) { return { city: 'building', laptop: 'laptop', plant: 'leaf', chart: 'chart', chat: 'messageSquare' }[m] || 'image'; }
  function thumbClass(m) { return 'thumb-' + (['city', 'laptop', 'plant', 'chart', 'chat', 'skyline', 'text'].includes(m) ? m : 'text'); }
  ta?.addEventListener('input', () => {
    if (count) count.textContent = t('compose.chars', { n: ta.value.length });
    renderPreview();
  });
  renderPreview();

  /* toolbar */
  const insert = (before, after = '') => {
    if (!ta) return;
    const s = ta.selectionStart, e = ta.selectionEnd;
    ta.value = ta.value.slice(0, s) + before + ta.value.slice(s, e) + after + ta.value.slice(e);
    ta.focus();
    renderPreview();
  };
  $$('.c-toolbar .ibtn').forEach((b) => b.addEventListener('click', () => {
    const a = b.dataset.a;
    if (a === 'bold') insert('**', '**');
    if (a === 'italic') insert('_', '_');
    if (a === 'link') insert('https://');
    if (a === 'emoji') insert(' 🚀 ');
    if (a === 'hash') insert('#');
  }));

  /* media drop */
  const dz = $('#cmp-drop');
  dz?.addEventListener('click', () => $('#cmp-file')?.click());
  dz?.addEventListener('dragover', (e) => e.preventDefault());
  dz?.addEventListener('drop', (e) => {
    e.preventDefault();
    setMedia(e.dataTransfer.files?.[0]?.name || 'city');
  });
  $('#cmp-file')?.addEventListener('change', (e) => setMedia(e.target.files?.[0]?.name || ''));
  function setMedia(name) {
    const m = /plant|leaf/i.test(name) ? 'plant' : /chart|graph|stat/i.test(name) ? 'chart' : /lap|desk/i.test(name) ? 'laptop' : name ? 'city' : 'text';
    if (!name) { ta.dataset.media = ''; dz.innerHTML = dzDefault; }
    else {
      ta.dataset.media = m;
      dz.innerHTML = `<svg class="ic"><use href="#i-image"/></svg><b style="color:var(--text-1)">${esc(name)}</b><span style="font-size:12px">${esc(t('compose.media_note'))}</span>`;
    }
    renderPreview();
  }
  const dzDefault = dz ? dz.innerHTML : '';

  /* AI assist */
  $('#cmp-ai')?.addEventListener('click', async () => {
    if (!BOOT.settings.switches.ai_rewrite) {
      toast(t('compose.ai_hint'), 'warn');
      return;
    }
    const btn = $('#cmp-ai');
    btn.disabled = true; btn.textContent = '…';
    await new Promise((r) => setTimeout(r, 700));
    ta.value = simRewrite(ta.value);
    renderPreview();
    btn.disabled = false; btn.textContent = t('compose.ai');
    toast(t('compose.ai_applied'), 'ok');
  });
  function simRewrite(text) {
    const c = String(text || '').trim().replace(/\s+/g, ' ');
    if (!c) return c;
    return c.charAt(0).toUpperCase() + c.slice(1).replace(/[. ]+$/, '') + '. — shared via Raqifluz';
  }

  /* targets chips */
  const wrap = $('#cmp-tgs');
  const allBtn = $('#cmp-tgs-all');
  allBtn?.addEventListener('click', () => {
    const chips = $$('.tchip', wrap);
    const anyOff = chips.some((c) => !c.classList.contains('on'));
    chips.forEach((c) => c.classList.toggle('on', anyOff));
  });
  $$('.tchip', wrap).forEach((c) => c.addEventListener('click', () => c.classList.toggle('on')));

  /* delivery */
  let delivery = 'queue';
  $$('.dl-card').forEach((c) => c.addEventListener('click', () => {
    $$('.dl-card').forEach((x) => x.setAttribute('aria-checked', x === c ? 'true' : 'false'));
    delivery = c.dataset.dl;
    $('#cmp-sched')?.classList.toggle('hidden', delivery !== 'schedule');
    const send = $('#cmp-send');
    if (send) send.textContent = delivery === 'now' ? t('compose.send_now') : delivery === 'schedule' ? t('compose.send_schedule') : t('compose.send_queue');
  }));

  /* save draft */
  $('#cmp-draft')?.addEventListener('click', async () => {
    const text = ta.value.trim();
    if (!text) return toast(LANG === 'ur' ? 'پیغام خالی ہے' : 'Message is empty', 'err');
    try {
      await api('/library/snippet', { body: { name: text.slice(0, 40) + '…', content: text } });
      toast(t('compose.draft_saved'), 'ok');
    } catch {}
  });

  /* send */
  $('#cmp-send')?.addEventListener('click', async () => {
    const text = ta.value.trim();
    const targets = $$('.tchip.on', wrap).map((c) => c.dataset.name);
    if (!text) return toast(LANG === 'ur' ? 'پیغام خالی ہے' : 'Message is empty', 'err');
    if (!targets.length) return toast(t('compose.targets_none'), 'err');
    const at = $('#cmp-when')?.valueAsNumber || Date.now();
    try {
      const { delivery: dl } = await api('/compose', { body: { title: $('#cmp-title')?.value || '', text, targets, delivery, at, media: ta.dataset.media || 'text' } });
      toast(dl === 'now' ? t('compose.toast_now') : dl === 'schedule' ? t('compose.toast_scheduled') : t('compose.toast'), 'ok');
      setTimeout(() => location.reload(), 600);
    } catch {}
  });

  /* prefill from ?q= (library "Use") */
  if (window.__PREFILL) { ta.value = window.__PREFILL; ta.dispatchEvent(new Event('input')); }
}

/* ── SCHEDULED ────────────────────────────────────────────────── */
function initScheduled() {
  bindTabs('#sch-tabs', null);
  const list = $$('#sch-list [data-id]');
  list.forEach((row) => {
    row.querySelector('[data-act="cancel"]')?.addEventListener('click', async () => {
      if (!(await confirmModal(t('scheduled.cancel'), t('scheduled.cancel_confirm'), { danger: true }))) return;
      try { await api(`/scheduled/${row.dataset.id}`, { method: 'DELETE', body: {} }); location.reload(); } catch {}
    });
    row.querySelector('[data-act="edit"]')?.addEventListener('click', () => {
      const m = openModal({
        title: row.dataset.title,
        body: `<div class="field"><label>${t('compose.schedule_at')}</label><input class="input" type="datetime-local" id="sch-when" value="${toLocalInput(new Date(parseInt(row.dataset.at, 10)))}"></div>`,
        foot: `<button class="btn btn-secondary" data-x>${esc(t('common.cancel'))}</button><button class="btn btn-primary" data-y>${esc(t('common.save'))}</button>`,
      });
      m.querySelector('[data-x]').addEventListener('click', closeModal);
      m.querySelector('[data-y]').addEventListener('click', async () => {
        try {
          await api(`/scheduled/${row.dataset.id}`, { method: 'PUT', body: { title: row.dataset.title, at: m.querySelector('#sch-when').valueAsNumber, targets: parseInt(row.dataset.targets, 10) || 1 } });
          closeModal(); toast(t('common.saved'), 'ok'); location.reload();
        } catch {}
      });
    });
  });
  /* calendar */
  const cal = $('#cal-grid');
  if (cal) {
    const items = (window.__SCHEDULED || []).map((s) => s.at);
    const byDay = {};
    items.forEach((at) => {
      const d = new Date(at);
      const k = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
      (byDay[k] ||= 0);
      byDay[k]++;
    });
    let y = new Date().getFullYear(), mo = new Date().getMonth();
    const draw = () => {
      const first = new Date(y, mo, 1);
      const startDow = first.getDay();
      const days = new Date(y, mo + 1, 0).getDate();
      const prevDays = new Date(y, mo, 0).getDate();
      const dows = [t('day.sunday'), t('day.monday'), t('day.tuesday'), t('day.wednesday'), t('day.thursday'), t('day.friday'), t('day.saturday')].map((x) => `<div class="dow">${esc(x)}</div>`).join('');
      let cells = '';
      for (let i = 0; i < 42; i++) {
        let d, other = false;
        if (i < startDow) { d = prevDays - startDow + 1 + i; other = true; }
        else if (i >= startDow + days) { d = i - startDow - days + 1; other = true; }
        else d = i - startDow + 1;
        const real = other ? (i < startDow ? new Date(y, mo - 1, d) : new Date(y, mo + 1, d)) : new Date(y, mo, d);
        const k = `${real.getFullYear()}-${real.getMonth()}-${real.getDate()}`;
        const n = byDay[k] || 0;
        cells += `<div class="day ${other ? 'other' : ''}" data-k="${k}"><span class="n">${d}</span>${n ? `<span class="cnt">${n}</span><span class="dots">${'<i></i>'.repeat(Math.min(n, 4))}</span>` : ''}</div>`;
      }
      cal.innerHTML = dows + cells;
      $$('.day', cal).forEach((cEl) => cEl.addEventListener('click', () => {
        $$('.day', cal).forEach((x) => x.classList.remove('sel'));
        cEl.classList.add('sel');
        const side = $('#cal-side');
        const dayItems = (window.__SCHEDULED || []).filter((s) => {
          const d = new Date(s.at);
          return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}` === cEl.dataset.k;
        });
        side.innerHTML = dayItems.length
          ? dayItems.map((s) => `<div class="log-line"><span class="lt">${new Date(s.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span><span class="msg">${esc(s.title)}</span><span class="lpill info">${s.targets}</span></div>`).join('')
          : `<div class="small muted" style="padding:12px">${t('scheduled.empty')}</div>`;
      }));
    };
    $('#cal-prev')?.addEventListener('click', () => { mo--; if (mo < 0) { mo = 11; y--; } draw(); });
    $('#cal-next')?.addEventListener('click', () => { mo++; if (mo > 11) { mo = 0; y++; } draw(); });
    draw();
  }
  function toLocalInput(d) {
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
  }
}

/* ── HISTORY ──────────────────────────────────────────────────── */
function initHistory() {
  const rows = $$('#hist-tbody [data-id]');
  const apply = () => {
    const q = ($('#hist-q')?.value || '').toLowerCase();
    const st = document.querySelector('#hist-status .chip[aria-pressed="true"]')?.dataset.st || 'all';
    const src = $('#hist-src')?.value || 'all';
    rows.forEach((row) => {
      const okQ = !q || row.dataset.title.toLowerCase().includes(q) || row.dataset.source.toLowerCase().includes(q);
      const okS = st === 'all' || row.dataset.status === st;
      const okR = src === 'all' || row.dataset.source === src;
      row.style.display = okQ && okS && okR ? '' : 'none';
    });
  };
  $('#hist-q')?.addEventListener('input', apply);
  $$('#hist-status .chip').forEach((c) => c.addEventListener('click', () => {
    $$('#hist-status .chip').forEach((x) => x.setAttribute('aria-pressed', x === c ? 'true' : 'false'));
    apply();
  }));
  $('#hist-src')?.addEventListener('change', apply);
  rows.forEach((row) => {
    row.addEventListener('click', (e) => {
      if (e.target.closest('[data-act]')) return;
      const h = (window.__HISTORY || []).find((x) => x.id === parseInt(row.dataset.id, 10));
      if (!h) return;
      const d = openDrawer({
        title: h.title,
        body: `
          <div class="sys-row"><span class="k">${t('history.col.time')}</span><span class="v mono">${fullTime(h.at)}</span></div>
          <div class="sys-row"><span class="k">${t('history.col.source')}</span><span class="v">${esc(h.source)}</span></div>
          <div class="sys-row"><span class="k">${t('history.col.status')}</span><span class="v">${esc(t('status.' + h.status))}</span></div>
          <div class="sys-row"><span class="k">${t('history.col.latency')}</span><span class="v mono">${h.latency ? h.latency.toFixed(2) + 's' : '—'}</span></div>
          <h3 style="margin-top:12px;font-size:14px">${t('history.detail.targets')}</h3>
          ${(h.targetsResults || []).map((tr) => `<div class="chk-row"><span class="dot ${tr.ok ? 'ok' : 'bad'}"></span><span>${esc(tr.target)}</span><small>${tr.ok ? '✓' : '✗'} ${fullTime(tr.at)}</small></div>`).join('') || '<div class="small muted">—</div>'}`,
        foot: h.status === 'failed' ? `<button class="btn btn-secondary" data-x>${esc(t('common.close'))}</button><button class="btn btn-primary" data-y>${esc(t('history.retry'))}</button>` : `<button class="btn btn-primary" data-x style="flex:1">${esc(t('common.close'))}</button>`,
      });
      d.querySelector('[data-y]')?.addEventListener('click', async () => {
        try { await api(`/history/${h.id}/retry`, { body: {} }); toast(t('history.retried'), 'ok'); closeModal(); } catch {}
      });
      d.querySelector('[data-x]').addEventListener('click', closeDrawer);
    });
    row.querySelector('[data-act="export"]')?.addEventListener('click', (e) => {
      e.stopPropagation();
      doHistExport();
    });
  });
  $('#hist-export')?.addEventListener('click', doHistExport);
  function doHistExport() {
    const visible = rows.filter((r) => r.style.display !== 'none');
    const head = 'time,title,source,targets,status,latency\n';
    const body = visible.map((r) => [fullTime(parseInt(r.dataset.at, 10)), `"${(r.dataset.title || '').replace(/"/g, '""')}"`, r.dataset.source, r.dataset.targets, r.dataset.status, r.dataset.latency].join(',')).join('\n');
    download('history.csv', head + body);
    toast(t('history.exported', { n: visible.length }), 'ok');
  }
}

export function download(name, text) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

/* ── LIBRARY ──────────────────────────────────────────────────── */
  function initLibrary() {
  bindTabs('#lib-tabs', '#lib-grid');
  /* filter grid by tab (tabs have data-filter) */
  const tabs = $$('#lib-tabs .tab');
  tabs.forEach((tab) => tab.addEventListener('click', () => {
    const f = tab.dataset.filter;
    $$('#lib-grid .lib-card').forEach((c) => { c.style.display = c.dataset.kind === f ? '' : 'none'; });
  }));
  $('#lib-new')?.addEventListener('click', () => {
    const cur = $('#lib-tabs .tab[aria-selected="true"]')?.dataset.filter || 'template';
    const m = openModal({
      title: t('library.new_title'),
      body: `
        <div class="field"><label>${t('library.name')}</label><input class="input" id="lb-name"></div>
        <div class="field"><label>${t('library.content')}</label><textarea class="textarea" id="lb-content" ${cur === 'media' ? 'placeholder="—"' : ''}></textarea></div>`,
      foot: `<button class="btn btn-secondary" data-x>${esc(t('common.cancel'))}</button><button class="btn btn-primary" data-y>${esc(t('common.add'))}</button>`,
    });
    m.querySelector('[data-x]').addEventListener('click', closeModal);
    m.querySelector('[data-y]').addEventListener('click', async () => {
      const name = m.querySelector('#lb-name').value.trim();
      if (!name) return toast(LANG === 'ur' ? 'نام درکار ہے' : 'Name is required', 'err');
      try {
        await api(`/library/${cur}`, { body: { name, content: m.querySelector('#lb-content').value } });
        closeModal(); toast(t('library.toast_added'), 'ok'); location.reload();
      } catch {}
    });
  });
  $$('#lib-grid .lib-card').forEach((c) => {
    c.querySelector('[data-act="use"]')?.addEventListener('click', () => {
      const item = (window.__LIBRARY || []).find((l) => l.id === parseInt(c.dataset.id, 10));
      if (!item) return;
      if (item.kind === 'template') {
        location.href = '/compose?q=' + encodeURIComponent(item.content);
      } else if (item.kind === 'snippet') {
        const ta = location.pathname === '/compose' ? $('#cmp-text') : null;
        if (ta) { ta.value += (ta.value ? '\n' : '') + item.content; ta.dispatchEvent(new Event('input')); toast(t('library.used'), 'ok'); }
        else location.href = '/compose?q=' + encodeURIComponent(item.content);
      } else {
        toast(t('library.used'), 'ok');
      }
    });
    c.querySelector('[data-act="menu"]')?.addEventListener('click', (e) => {
      e.stopPropagation();
      openRowMenu(c, c.querySelector('[data-act="menu"]'), [
        { label: t('common.delete'), danger: true, run: async () => {
            if (!(await confirmModal(t('common.delete'), t('library.delete_confirm'), { danger: true }))) return;
            try { await api(`/library/${c.dataset.id}`, { method: 'DELETE', body: {} }); location.reload(); } catch {}
        } },
      ]);
    });
  });
}

/* ── BRAND ────────────────────────────────────────────────────── */
function initBrand() {
  const b = window.__BRAND || {};
  const footerPreview = () => {
    const el = $('#br-foot-prev');
    if (!el) return;
    const v = $('#br-footer')?.value || '';
    el.textContent = (v || '—').replace(/\{brand\}/g, $('#br-name')?.value || b.name).replace(/\{date\}/g, new Date().toLocaleDateString());
  };
  $('#br-footer')?.addEventListener('input', footerPreview);
  $('#br-name')?.addEventListener('input', footerPreview);
  footerPreview();
  /* variable chips insert */
  $$('#br-vars .htag').forEach((ch) => ch.addEventListener('click', () => {
    const f = $('#br-footer');
    if (f) { f.value += ch.dataset.v; f.dispatchEvent(new Event('input')); }
  }));
  /* hashtag sets */
  $$('#br-sets [data-act="rmset"]').forEach((btn) => btn.addEventListener('click', () => {
    const sEl = btn.closest('.br-set');
    const name = sEl.dataset.name;
    window.__BRAND.hashtags = window.__BRAND.hashtags.filter((s) => s.name !== name);
    sEl.remove();
  }));
  $('#br-addset')?.addEventListener('click', () => {
    const tags = ($('#br-set-ph')?.value || '').split(/\s+/).filter(Boolean).map((x) => x.startsWith('#') ? x : '#' + x);
    if (!tags.length) return;
    const set = { name: `Set ${window.__BRAND.hashtags.length + 1}`, tags };
    window.__BRAND.hashtags.push(set);
    const wrap = $('#br-sets');
    const div = document.createElement('div');
    div.className = 'br-set';
    div.dataset.name = set.name;
    div.innerHTML = `<b class="small" style="margin-inline-end:8px">${esc(set.name)}</b>${set.tags.map((x) => `<span class="htag">${esc(x)}</span>`).join('')}<button class="ibtn" data-act="rmset" style="width:24px;height:24px" aria-label="remove"><svg class="ic ic-xs"><use href="#i-x"/></svg></button>`;
    wrap.appendChild(div);
    div.querySelector('[data-act="rmset"]').addEventListener('click', () => {
      window.__BRAND.hashtags = window.__BRAND.hashtags.filter((s) => s.name !== set.name);
      div.remove();
    });
    const ph = $('#br-set-ph');
    if (ph) ph.value = '';
  });
  /* watermark slider */
  const slider = $('#br-op');
  slider?.addEventListener('input', () => { $('#br-op-val').textContent = slider.value + '%'; });
  /* save */
  $('#br-save')?.addEventListener('click', async () => {
    try {
      await api('/brand', {
        method: 'PUT', body: {
          name: $('#br-name').value, tagline: $('#br-tag').value, tone: $('#br-tone').value,
          footer: $('#br-footer').value, hashtags: window.__BRAND.hashtags,
          watermark: { pos: $('#br-pos').value, opacity: parseInt(slider?.value || '45', 10) },
        },
      });
      toast(t('brand.toast'), 'ok');
    } catch {}
  });
}

/* ── WHATSAPP ─────────────────────────────────────────────────── */
function initWhatsapp() {
  $('#wa-test')?.addEventListener('click', async () => {
    try {
      const { to } = await api('/wa/test', { body: {} });
      toast(t('wa.toast_test', { phone: to }), 'ok');
      addMirrorLine(`Test message to ${to} (simulated)`);
    } catch {}
  });
  $('#wa-reconnect')?.addEventListener('click', async () => {
    try { await api('/wa/test', { body: {}, silent: true }); toast(t('wa.reconnected'), 'ok'); } catch {}
  });
  const cmdInput = $('#wa-cmd');
  const sendCmd = async () => {
    const cmd = cmdInput?.value.trim();
    if (!cmd) return;
    try {
      const { reply, messages } = await api('/wa/cmd', { body: { cmd } });
      cmdInput.value = '';
      const feed = $('#wa-feed');
      const p = (n) => String(n).padStart(2, '0');
      const now = new Date();
      feed.insertAdjacentHTML('afterbegin',
        `<div class="mono-line"><span class="t">${p(now.getHours())}:${p(now.getMinutes())}</span>Owner → ${esc(cmd)}</div>` +
        `<div class="mono-line"><span class="t">${p(now.getHours())}:${p(now.getMinutes())}</span>${esc(reply)}</div>`);
    } catch {}
  };
  $('#wa-cmd-btn')?.addEventListener('click', sendCmd);
  cmdInput?.addEventListener('keydown', (e) => { if (e.key === 'Enter') sendCmd(); });
  $$('.cmd-chip[data-cmd]').forEach((c) => c.addEventListener('click', () => {
    if (cmdInput) { cmdInput.value = c.dataset.cmd; cmdInput.focus(); }
  }));
}
function addMirrorLine(text) {
  const feed = $('#mirror-feed');
  if (!feed) return;
  const now = new Date();
  const p = (n) => String(n).padStart(2, '0');
  feed.insertAdjacentHTML('afterbegin', `<div class="mono-line"><span class="t">${p(now.getHours())}:${p(now.getMinutes())}</span>${esc(text)}</div>`);
}

/* ── CONTACTS ─────────────────────────────────────────────────── */
function initContacts() {
  const rows = $$('#ct-rows [data-id]');
  const apply = () => {
    const q = ($('#ct-q')?.value || '').toLowerCase();
    const role = $('#ct-role')?.value || 'all';
    rows.forEach((r) => {
      const okQ = !q || r.dataset.name.toLowerCase().includes(q) || r.dataset.phone.includes(q);
      const okR = role === 'all' || r.dataset.role === role;
      r.style.display = okQ && okR ? '' : 'none';
    });
  };
  $('#ct-q')?.addEventListener('input', apply);
  $('#ct-role')?.addEventListener('change', apply);
  rows.forEach((row) => {
    row.querySelector('[data-act="test"]')?.addEventListener('click', async () => {
      try { await api('/contacts/test', { body: { name: row.dataset.name } }); toast(t('contacts.sent', { name: row.dataset.name }), 'ok'); } catch {}
    });
    row.querySelector('[data-act="menu"]')?.addEventListener('click', (e) => {
      e.stopPropagation();
      openRowMenu(row, row.querySelector('[data-act="menu"]'), [
        { label: t('contacts.send'), run: async () => { try { await api('/contacts/test', { body: { name: row.dataset.name } }); toast(t('contacts.sent', { name: row.dataset.name }), 'ok'); } catch {} } },
        { label: t('common.delete'), danger: true, run: async () => {
            if (!(await confirmModal(t('common.delete'), t('contacts.delete_confirm'), { danger: true }))) return;
            try { await api(`/contacts/${row.dataset.id}`, { method: 'DELETE', body: {} }); location.reload(); } catch {}
        } },
      ]);
    });
  });
  $('#ct-add')?.addEventListener('click', () => {
    const m = openModal({
      title: t('contacts.add'),
      body: `
        <div class="field"><label>${t('contacts.name')}</label><input class="input" id="ct-name"></div>
        <div class="field"><label>${t('contacts.phone')}</label><input class="input" id="ct-phone" placeholder="+92 3xx xxxxxxx" style="font-family:var(--font-mono)"></div>
        <div class="set-grid">
          <div class="field"><label>${t('contacts.role')}</label><select class="select" id="ct-role-m"><option value="admin">Admin</option><option value="viewer">Viewer</option></select></div>
          <div class="field"><label>${t('contacts.tag')}</label><input class="input" id="ct-tag" placeholder="team"></div>
        </div>`,
      foot: `<button class="btn btn-secondary" data-x>${esc(t('common.cancel'))}</button><button class="btn btn-primary" data-y>${esc(t('common.add'))}</button>`,
    });
    m.querySelector('[data-x]').addEventListener('click', closeModal);
    m.querySelector('[data-y]').addEventListener('click', async () => {
      const name = m.querySelector('#ct-name').value.trim();
      const phone = m.querySelector('#ct-phone').value.trim();
      if (!name || !phone) return toast(LANG === 'ur' ? 'نام اور نمبر درکار ہیں' : 'Name and number are required', 'err');
      try {
        await api('/contacts', { body: { name, phone, role: m.querySelector('#ct-role-m').value, tag: m.querySelector('#ct-tag').value } });
        closeModal(); toast(t('common.saved'), 'ok'); location.reload();
      } catch {}
    });
  });
  $('#ct-import')?.addEventListener('click', () => toast(t('contacts.imported'), 'ok'));
}

/* ── AUTO-REPLIES ─────────────────────────────────────────────── */
function initAutoReplies() {
  $('#ar-enable')?.addEventListener('click', async () => {
    try {
      await api('/settings/switches/auto_replies', { body: { value: true } });
      toast(t('ar.enabled'), 'ok');
      setTimeout(() => location.reload(), 500);
    } catch {}
  });
  const rows = $$('#ar-rows [data-id]');
  rows.forEach((row) => {
    const id = parseInt(row.dataset.id, 10);
    row.querySelector('[data-act="toggle"]')?.addEventListener('click', async (e) => {
      const on = e.currentTarget.getAttribute('aria-checked') !== 'true';
      e.currentTarget.setAttribute('aria-checked', on ? 'true' : 'false');
      row.style.opacity = on ? '1' : '.55';
      try { await api(`/auto-replies/${id}`, { method: 'PUT', body: { trigger: row.dataset.trigger, reply: row.dataset.reply, active: on } }); } catch {}
    });
    row.querySelector('[data-act="edit"]')?.addEventListener('click', () => openArDrawer(parseInt(row.dataset.id, 10), true));
    row.querySelector('[data-act="del"]')?.addEventListener('click', async () => {
      if (!(await confirmModal(t('common.delete'), t('ar.delete_confirm'), { danger: true }))) return;
      try { await api(`/auto-replies/${id}`, { method: 'DELETE', body: {} }); location.reload(); } catch {}
    });
  });
  $('#ar-new')?.addEventListener('click', () => openArDrawer(null, false));
  const runTest = async () => {
    const msg = $('#ar-test')?.value.trim();
    const out = $('#ar-test-out');
    if (!msg) return;
    try {
      const { hit } = await api('/auto-replies/test', { body: { msg } });
      out.style.display = 'block';
      out.textContent = hit ? t('ar.test_hit', { t: hit.trigger, r: hit.reply }) : t('ar.test_miss');
      out.style.color = hit ? 'var(--success-text)' : 'var(--warning-text)';
    } catch {}
  };
  $('#ar-test-btn')?.addEventListener('click', runTest);
  $('#ar-test')?.addEventListener('keydown', (e) => { if (e.key === 'Enter') runTest(); });
}
function openArDrawer(id, isEdit) {
  const a = (window.__AUTO_REPLIES || []).find((x) => x.id === id);
  const d = openDrawer({
    title: isEdit ? t('common.edit') : t('ar.new_title'),
    body: `
      <div class="field"><label>${t('ar.trigger')}</label><input class="input" id="ar-tr" value="${esc(a?.trigger || '')}" placeholder="${esc(t('ar.trigger_ph'))}"></div>
      <div class="set-grid">
        <div class="field"><label>${t('ar.match')}</label><select class="select" id="ar-mt"><option value="contains" ${a?.match === 'contains' ? 'selected' : ''}>${t('ar.match.contains')}</option><option value="exact" ${a?.match === 'exact' ? 'selected' : ''}>${t('ar.match.exact')}</option></select></div>
        <div class="field"><label>${t('ar.scope')}</label><select class="select" id="ar-sc"><option value="all" ${a?.scope === 'all' ? 'selected' : ''}>${t('ar.scope.all')}</option><option value="owner" ${a?.scope === 'owner' ? 'selected' : ''}>${t('ar.scope.owner')}</option></select></div>
      </div>
      <div class="field"><label>${t('ar.reply')}</label><textarea class="textarea" id="ar-re">${esc(a?.reply || '')}</textarea></div>`,
    foot: `<button class="btn btn-secondary" data-x>${esc(t('common.cancel'))}</button><button class="btn btn-primary" data-y>${esc(t('common.save'))}</button>`,
  });
  d.querySelector('[data-x]').addEventListener('click', closeDrawer);
  d.querySelector('[data-y]').addEventListener('click', async () => {
    const trigger = d.querySelector('#ar-tr').value.trim();
    if (!trigger) return toast(LANG === 'ur' ? 'ٹریگر درکار ہے' : 'Trigger is required', 'err');
    try {
      const body = { trigger, match: d.querySelector('#ar-mt').value, scope: d.querySelector('#ar-sc').value, reply: d.querySelector('#ar-re').value, active: true };
      if (id) await api(`/auto-replies/${id}`, { method: 'PUT', body });
      else await api('/auto-replies', { body });
      closeDrawer(); toast(t('common.saved'), 'ok'); location.reload();
    } catch {}
  });
}

/* ── AI PILOT ─────────────────────────────────────────────────── */
function initPilot() {
  $('#pilot-enable')?.addEventListener('click', async () => {
    try {
      await api('/settings/switches/ai_pilot_suggest', { body: { value: true } });
      toast(t('common.saved'), 'ok');
      setTimeout(() => location.reload(), 500);
    } catch {}
  });
  /* mode segmented (same value as Settings > AI & Rules) */
  $$('#pilot-mode button').forEach((b) => b.addEventListener('click', async () => {
    $$('#pilot-mode button').forEach((x) => x.setAttribute('aria-pressed', x === b ? 'true' : 'false'));
    try { await api('/settings', { method: 'PUT', body: { ai: { pilotMode: b.dataset.mode } }, silent: true }); } catch {}
  }));
  $$('#pilot-feed [data-id]').forEach((c) => {
    const id = parseInt(c.dataset.id, 10);
    c.querySelector('[data-act="accept"]')?.addEventListener('click', async () => {
      try {
        await api(`/pilot/${id}`, { body: { action: 'accept' } });
        toast(t('pilot.accepted'), 'ok');
        c.remove();
      } catch {}
    });
    c.querySelector('[data-act="dismiss"]')?.addEventListener('click', async () => {
      try {
        await api(`/pilot/${id}`, { body: { action: 'dismiss' } });
        toast(t('pilot.dismissed'), 'ok');
        c.remove();
      } catch {}
    });
  });
}

/* ── RULES ────────────────────────────────────────────────────── */
function initRules() {
  const rows = $$('#rule-list [data-id]');
  rows.forEach((row) => {
    const id = parseInt(row.dataset.id, 10);
    row.querySelector('[data-act="toggle"]')?.addEventListener('click', async (e) => {
      const on = e.currentTarget.getAttribute('aria-checked') !== 'true';
      e.currentTarget.setAttribute('aria-checked', on ? 'true' : 'false');
      row.style.opacity = on ? '1' : '.55';
      try { await api(`/rules/${id}`, { method: 'PUT', body: { name: row.dataset.name, on } }); } catch {}
    });
    row.querySelector('[data-act="del"]')?.addEventListener('click', async () => {
      if (!(await confirmModal(t('common.delete'), t('rules.delete_confirm'), { danger: true }))) return;
      try { await api(`/rules/${id}`, { method: 'DELETE', body: {} }); location.reload(); } catch {}
    });
  });
  $('#rule-new')?.addEventListener('click', () => {
    const d = openDrawer({
      title: t('rules.new_title'),
      body: `
        <div class="field"><label>${t('rules.cond_type')}</label>
          <select class="select" id="rl-type">
            <option value="keyword">${t('rules.cond.keyword')}</option>
            <option value="media">${t('rules.cond.media')}</option>
            <option value="source">${t('rules.cond.source')}</option>
            <option value="length">${t('rules.cond.length')}</option>
          </select></div>
        <div class="field"><label>${t('rules.value')}</label><input class="input" id="rl-val"></div>
        <div class="field"><label>${t('rules.action')}</label>
          <select class="select" id="rl-act"><option value="skip">Skip</option><option value="flag">Flag</option><option value="delay">Delay</option><option value="route">Route</option></select></div>
        <div class="field"><label>${t('rules.priority')}</label><input class="input" id="rl-prio" type="number" min="1" max="99" value="${rows.length + 1}"></div>
        <label class="chk-row2"><span class="chk on" role="checkbox" tabindex="0" aria-checked="true" id="rl-on"><svg class="ic"><use href="#i-check"/></svg></span>${t('rules.on')}</label>`,
      foot: `<button class="btn btn-secondary" data-x>${esc(t('common.cancel'))}</button><button class="btn btn-primary" data-y>${esc(t('common.save'))}</button>`,
    });
    d.querySelector('#rl-on').addEventListener('click', (e) => toggleChk(e.currentTarget));
    d.querySelector('[data-x]').addEventListener('click', closeDrawer);
    d.querySelector('[data-y]').addEventListener('click', async () => {
      const name = `${t('rules.cond_type')} → ${d.querySelector('#rl-act').value}`;
      try {
        await api('/rules', { body: { name, condType: d.querySelector('#rl-type').value, condValue: d.querySelector('#rl-val').value, actType: d.querySelector('#rl-act').value, actValue: d.querySelector('#rl-act').value === 'delay' ? '15 min' : '', priority: parseInt(d.querySelector('#rl-prio').value, 10) || 1, on: d.querySelector('#rl-on').getAttribute('aria-checked') === 'true' } });
        closeDrawer(); toast(t('rules.toast_saved'), 'ok'); location.reload();
      } catch {}
    });
  });
}

/* ── ANALYTICS ────────────────────────────────────────────────── */
function initAnalytics() {
  const statsEl = $('#an-stats');
  const chartEl = $('#an-chart');
  const draw = (range) => {
    const S = window.__AN_STATS[range];
    const SER = window.__AN_SERIES[range];
    if (statsEl && S) {
      statsEl.innerHTML = [
        [t('analytics.s.total'), fmtInt(S.total), S.dTotal, true],
        [t('analytics.s.success'), S.success + '%', S.dSuccess, true],
        [t('analytics.s.skipped'), fmtInt(S.skipped), S.dSkipped, true],
        [t('analytics.s.failed'), fmtInt(S.failed), S.dFailed, true],
        [t('analytics.s.latency'), S.latency + 's', S.dLatency, true],
        [t('analytics.s.reach'), S.reach, S.dReach, true],
      ].map(([lab, val, d, good]) => `
        <div class="an-stat">
          <div class="caps">${esc(lab)}</div>
          <div class="val num">${esc(val)}</div>
          <span class="delta ${good ? 'good' : 'bad'}"><svg class="ic"><use href="#i-${(d || '').startsWith('-') ? 'trendDown' : 'trendUp'}"/></svg>${esc(d || '')}</span>
        </div>`).join('');
    }
    if (chartEl && SER) areaChart(chartEl, SER, { colors: { published: 'var(--success)', skipped: 'var(--info)', failed: 'var(--error)' }, ticks: SER.ticks });
  };
  const setRange = (range) => {
    $$('.range-seg button').forEach((b) => b.setAttribute('aria-pressed', b.dataset.range === range ? 'true' : 'false'));
    draw(range);
  };
  $$('.range-seg button').forEach((b) => b.addEventListener('click', () => setRange(b.dataset.range)));
  $('#an-range-m')?.addEventListener('change', (e) => setRange(e.target.value));
  draw('7d');
  bindTabs('#an-tabs', null);
  /* generate report */
  $('#an-rep-new')?.addEventListener('click', () => {
    const m = openModal({
      title: t('analytics.reports_new_title'),
      body: `
        <div class="set-grid">
          <div class="field"><label>${t('analytics.reports_type')}</label><select class="select" id="rep-type"><option value="daily">Daily</option><option value="weekly">Weekly</option><option value="monthly">Monthly</option></select></div>
          <div class="field"><label>${t('analytics.reports.range')}</label><select class="select" id="rep-range"><option value="7d">7d</option><option value="30d">30d</option><option value="90d">90d</option></select></div>
        </div>`,
      foot: `<button class="btn btn-secondary" data-x>${esc(t('common.cancel'))}</button><button class="btn btn-primary" data-y>${esc(t('analytics.reports_new'))}</button>`,
    });
    m.querySelector('[data-x]').addEventListener('click', closeModal);
    m.querySelector('[data-y]').addEventListener('click', async () => {
      try {
        const { reports } = await api('/reports', { body: { type: m.querySelector('#rep-type').value, range: m.querySelector('#rep-range').value } });
        renderReports(reports);
        closeModal(); toast(t('analytics.reports_generated'), 'ok');
      } catch {}
    });
  });
  function renderReports(reports) {
    const list = $('#an-reports');
    if (!list) return;
    list.innerHTML = reports.map((r) => `
      <div class="src-row">
        <span class="avatar sm g-2"><svg class="ic ic-sm"><use href="#i-fileText"/></svg></span>
        <div><div class="src-name" style="font-size:14px">${esc({ daily: 'Daily summary', weekly: 'Weekly digest', monthly: 'Monthly report' }[r.type] || r.type)}</div>
        <div class="src-sub" style="direction:ltr">${esc(r.date)} · ${esc(r.meta)}</div></div>
        <span class="src-count num" style="margin-inline-start:auto">${esc(r.size)}</span>
        <div class="src-acts">
          <button class="btn btn-secondary sm" data-dl="${r.id}">${esc(t('analytics.reports.download'))}</button>
          <button class="btn btn-secondary sm" data-html="${r.id}">${esc(t('analytics.reports.pdf'))}</button>
        </div>
      </div>`).join('');
    list.querySelectorAll('[data-dl]').forEach((b) => b.addEventListener('click', () => {
      const r = reports.find((x) => x.id === b.dataset.dl);
      download(`${r.type}-${r.date}.csv`, 'date,metric,value\n' + r.meta.split(' · ').map((x) => `"${x}"`).join('\n'));
      toast(t('toast.exported'), 'ok');
    }));
    list.querySelectorAll('[data-html]').forEach((b) => b.addEventListener('click', () => {
      const r = reports.find((x) => x.id === b.dataset.html);
      const html = `<!doctype html><meta charset="utf-8"><title>Raqifluz ${r.type}</title><body style="font-family:system-ui;max-width:720px;margin:40px auto"><h1>Raqifluz — ${r.type} report</h1><p>${r.date}</p><p>${r.meta}</p><hr><p class="muted">Generated by Raqifluz v1.0.0 (simulation mode)</p>`;
      download(`${r.type}-${r.date}.html`, html);
      toast(t('toast.exported'), 'ok');
    }));
  }
  function fmtInt(n) { return Number(n).toLocaleString(LANG === 'ur' ? 'ur-PK' : 'en-US'); }
}

/* ── HEALTH ───────────────────────────────────────────────────── */
function initHealth() {
  $('#ht-run')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    btn.textContent = t('health.running');
    const cards = $$('#ht-grid .hcheck');
    const log = $('#ht-log');
    if (log) { log.classList.add('show'); log.innerHTML = ''; }
    for (const c of cards) {
      c.classList.add('testing');
      const pill = c.querySelector('.spill');
      if (pill) { pill.className = 'spill spill-neutral'; pill.innerHTML = '…'; }
      await new Promise((r) => setTimeout(r, 350));
      c.classList.remove('testing');
      if (pill) { pill.className = 'spill spill-success'; pill.innerHTML = `<span class="dot"></span>${t('status.healthy')}`; }
      if (log) log.insertAdjacentHTML('beforeend', `<div class="ln ok">✓ ${esc(c.dataset.name)} — ${esc(c.dataset.metric)}</div>`);
    }
    try { await api('/health/self-test', { body: {}, silent: true }); } catch {}
    btn.disabled = false;
    btn.textContent = t('health.run');
    toast(t('health.pass'), 'ok');
  });
}

/* ── LOGS ─────────────────────────────────────────────────────── */
function initLogs() {
  const rows = $$('#log-list .log-line');
  const arows = $$('#audit-list .log-line');
  const apply = () => {
    const q = ($('#log-q')?.value || '').toLowerCase();
    const lv = $('#log-level')?.value || 'all';
    rows.forEach((r) => {
      const okQ = !q || r.dataset.msg.toLowerCase().includes(q);
      const okL = lv === 'all' || r.dataset.level === lv;
      r.style.display = okQ && okL ? '' : 'none';
    });
  };
  $('#log-q')?.addEventListener('input', apply);
  $('#log-level')?.addEventListener('change', apply);
  $('#log-range')?.addEventListener('change', apply);
  /* live tail */
  const liveBtn = $('#log-live');
  let live = null;
  liveBtn?.addEventListener('click', () => {
    if (live) {
      clearInterval(live);
      live = null;
      liveBtn.setAttribute('aria-checked', 'false');
      return;
    }
    liveBtn.setAttribute('aria-checked', 'true');
    live = setInterval(() => {
      api('/activity', { silent: true }).then(({ items }) => {
        const newest = items[0];
        if (!newest) return;
        const host = $('#log-list');
        if (host && !host.querySelector(`[data-uid="${newest.id}"]`)) {
          const now = new Date();
          const p = (n) => String(n).padStart(2, '0');
          const cls = newest.kind === 'failed' ? 'error' : newest.kind === 'skipped' ? 'warn' : '';
          host.insertAdjacentHTML('afterbegin', `<div class="log-line ${cls}" data-uid="${newest.id}"><span class="lt">${p(now.getHours())}:${p(now.getMinutes())}:${p(now.getSeconds())}</span><span class="lpill ${newest.kind === 'failed' ? 'error' : newest.kind === 'skipped' ? 'warn' : 'info'}">${newest.status}</span><span class="msg">${esc(newest.text)}</span></div>`);
        }
      }).catch(() => {});
    }, 8000);
  });
  $('#log-export')?.addEventListener('click', () => {
    const visible = rows.filter((r) => r.style.display !== 'none');
    download('raqifluz-activity.log', visible.map((r) => `${r.dataset.ts} [${r.dataset.level.toUpperCase()}] ${r.dataset.msg}`).join('\n'));
    toast(t('logs.exported', { n: visible.length }), 'ok');
  });
  $('#audit-export')?.addEventListener('click', () => {
    const visible = arows.filter((r) => r.style.display !== 'none');
    download('raqifluz-audit.log', visible.map((r) => `${r.dataset.ts} | ${r.dataset.actor} | ${r.dataset.action} | ${r.dataset.target}`).join('\n'));
    toast(t('logs.exported', { n: visible.length }), 'ok');
  });
  bindTabs('#log-tabs', null);
}

/* ── ABOUT ────────────────────────────────────────────────────── */
function initAbout() {
  $('#ab-export')?.addEventListener('click', () => {
    location.href = '/api/export';
  });
  $('#ab-backup')?.addEventListener('click', async () => {
    try { const { file } = await api('/backup', { body: {} }); toast(t('sets.backup_done'), 'ok'); } catch {}
  });
}

document.addEventListener('DOMContentLoaded', boot);
