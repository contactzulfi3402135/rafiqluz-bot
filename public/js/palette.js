/* ⌘K command palette (spec §3.3/§13): pages + actions, fuzzy list, arrows, Enter */
import { openModal, t } from './app.js';

let paletteEl = null;
let idx = 0;

const PAGES = [
  ['/', 'nav.home', 'i-home'],
  ['/sources', 'nav.sources', 'i-radio'],
  ['/targets', 'nav.targets', 'i-target'],
  ['/discover', 'nav.discover', 'i-compass'],
  ['/routing', 'nav.routing', 'i-route'],
  ['/compose', 'nav.compose', 'i-pen'],
  ['/queue', 'nav.queue', 'i-inbox'],
  ['/scheduled', 'nav.scheduled', 'i-calendar'],
  ['/history', 'nav.history', 'i-history'],
  ['/library', 'nav.library', 'i-image'],
  ['/brand', 'nav.brand', 'i-layers'],
  ['/whatsapp', 'nav.whatsapp', 'i-message'],
  ['/contacts', 'nav.contacts', 'i-users'],
  ['/auto-replies', 'nav.autoreplies', 'i-reply'],
  ['/ai-pilot', 'nav.pilot', 'i-bot'],
  ['/rules', 'nav.rules', 'i-shield'],
  ['/analytics', 'nav.analytics', 'i-chart'],
  ['/health', 'nav.health', 'i-activity'],
  ['/logs', 'nav.logs', 'i-terminal'],
  ['/settings', 'nav.settings', 'i-settings'],
  ['/about', 'nav.about', 'i-info'],
];

function actions() {
  return [
    { label: t('topbar.act_compose'), run: () => { location.href = '/compose'; } },
    { label: t('topbar.act_approve_all'), run: async () => {
        const { api } = await import('./app.js');
        const pending = (await api('/queue?status=pending', { silent: true })).items || [];
        if (!pending.length) return;
        await api('/queue/bulk', { body: { ids: pending.map((p) => p.id), action: 'approve' } });
        location.href = '/queue';
      } },
    { label: t('topbar.act_selftest'), run: () => { location.href = '/health'; } },
    { label: t('topbar.act_theme'), run: () => {
        const d = document.documentElement;
        const cur = d.getAttribute('data-theme');
        d.setAttribute('data-theme', cur === 'dark' ? 'light' : 'dark');
        try { localStorage.setItem('rq_theme', d.getAttribute('data-theme')); } catch {}
      } },
    { label: t('topbar.act_panic'), danger: true, run: async () => {
        const { api, togglePanic } = await import('./app.js');
        await togglePanic();
      } },
    { label: t('topbar.act_backup'), run: async () => {
        const { api, toast } = await import('./app.js');
        try { await api('/backup', { body: {} }); toast(t('sets.backup_done'), 'ok'); } catch {}
      } },
  ];
}

function fuzzy(q, text) {
  q = (q || '').toLowerCase().trim();
  if (!q) return true;
  text = text.toLowerCase();
  let qi = 0;
  for (const ch of text) {
    if (ch === q[qi]) qi++;
    if (qi === q.length) return true;
  }
  return text.includes(q);
}

export function openPalette() {
  if (paletteEl) return;
  idx = 0;
  const m = openModal({
    title: '',
    sub: '',
    wide: true,
    body: `
      <div class="field" style="margin-bottom:4px">
        <input class="input" id="pal-q" placeholder="${esc(t('topbar.search_ph'))}" autocomplete="off" style="height:48px;font-size:16px">
      </div>
      <div class="menu-head" style="padding:8px 4px">${esc(t('topbar.palette_pages'))}</div>
      <div id="pal-pages" style="max-height:280px;overflow-y:auto"></div>
      <div class="menu-head" style="padding:8px 4px">${esc(t('topbar.palette_actions'))}</div>
      <div id="pal-acts" style="max-height:200px;overflow-y:auto"></div>`,
    foot: `<span class="small muted" style="margin-inline-start:auto">${esc('↑↓ ' + (document.documentElement.lang === 'ur' ? 'چلوں · Enter چنیں' : 'to move · Enter to pick') + ' · Esc ' + (document.documentElement.lang === 'ur' ? 'بند' : 'to close'))}</span>`,
  });
  paletteEl = m;
  const q = m.querySelector('#pal-q');
  const render = () => {
    const query = q.value;
    const pages = PAGES.filter(([, k]) => fuzzy(query, t(k)));
    const acts = actions().filter((a) => fuzzy(query, a.label));
    m.querySelector('#pal-pages').innerHTML = pages.map(([href, k, ic], i) => `
      <button class="menu-item" data-href="${href}" data-i="${i}"><svg class="ic"><use href="#${ic}"/></svg><span>${esc(t(k))}</span></button>`).join('') || '<div class="small muted" style="padding:8px 12px">—</div>';
    m.querySelector('#pal-acts').innerHTML = acts.map((a, i) => `
      <button class="menu-item" data-act="${i}" style="${a.danger ? 'color:var(--error-text)' : ''}"><svg class="ic"><use href="#i-zap"/></svg><span>${esc(a.label)}</span></button>`).join('') || '<div class="small muted" style="padding:8px 12px">—</div>';
    idx = 0;
    bindItems();
  };
  function bindItems() {
    const all = [...m.querySelectorAll('.menu-item')];
    all.forEach((b, i) => b.addEventListener('click', () => run(i)));
    all.forEach((b, i) => {
      b.addEventListener('mouseenter', () => setIdx(i));
    });
  }
  function setIdx(i) {
    const all = [...m.querySelectorAll('.menu-item')];
    all.forEach((b, j) => b.style.background = j === i ? 'var(--surface-2)' : '');
    idx = i;
  }
  function run(i) {
    const all = [...m.querySelectorAll('.menu-item')];
    const b = all[i];
    if (!b) return;
    closeModal2();
    if (b.dataset.href) location.href = b.dataset.href;
    else {
      const a = actions()[parseInt(b.dataset.act, 10)];
      a.run();
    }
  }
  function closeModal2() {
    closePalette();
  }
  q.addEventListener('input', render);
  q.addEventListener('keydown', (e) => {
    const all = [...m.querySelectorAll('.menu-item')];
    if (e.key === 'ArrowDown') { e.preventDefault(); setIdx(Math.min(all.length - 1, idx + 1)); }
    if (e.key === 'ArrowUp') { e.preventDefault(); setIdx(Math.max(0, idx - 1)); }
    if (e.key === 'Enter') { e.preventDefault(); run(idx); }
  });
  /* closing via X / Esc must clear paletteEl */
  const orig = m.querySelector('[data-close-m2]');
  orig.addEventListener('click', () => closePalette());
  render();
  setTimeout(() => q.focus(), 30);
}
export function closePalette() {
  paletteEl = null;
  document.querySelectorAll('.modal-scrim').forEach((s) => s.remove());
  document.querySelectorAll('.modal').forEach((mm) => mm.remove());
}
function esc(s) { return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

export function initPalette() {
  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      openPalette();
    }
  });
}
