import { Router } from 'express';
import { store } from '../lib/store.js';
import { OPTIONS, OPTION_GROUPS } from '../lib/options.js';

const r = Router();
const db = () => store.load();

const fmt = (ts) => {
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

/* 1 · HOME */
r.get('/', (req, res) => {
  const d = db();
  const kpis = d.analytics.kpis;
  const q = d.queue;
  res.renderPage('home', {
    kpis,
    health: d.health,
    recent: d.recentActivity.slice(0, 5),
    pacing: d.pacing,
    setup: d.setup,
    qcounts: {
      pending: q.filter((x) => x.status === 'pending').length,
      approved: q.filter((x) => x.status === 'approved').length,
      waiting: q.filter((x) => x.status === 'waiting').length,
      delayed: q.filter((x) => x.status === 'delayed').length,
    },
    series: d.analytics.series,
  });
});

/* 2 · SOURCES */
r.get('/sources', (req, res) => {
  const d = db();
  res.renderPage('sources', {
    sources: d.sources,
    counts: {
      all: d.sources.length,
      active: d.sources.filter((s) => s.status === 'active').length,
      paused: d.sources.filter((s) => s.status === 'paused').length,
      errors: d.sources.filter((s) => s.status === 'error').length,
    },
    targets: d.targets.map((t) => t.name),
  });
});

/* 3 · TARGETS */
r.get('/targets', (req, res) => {
  const d = db();
  res.renderPage('targets', {
    targets: d.targets,
    counts: {
      all: d.targets.length,
      active: d.targets.filter((t) => t.status === 'active').length,
      paused: d.targets.filter((t) => t.status === 'paused').length,
      errors: d.targets.filter((t) => t.status === 'error').length,
    },
  });
});

/* 4 · DISCOVER */
r.get('/discover', (req, res) => {
  res.renderPage('discover', { discover: db().discover });
});

/* 5 · ROUTING */
r.get('/routing', (req, res) => {
  const d = db();
  res.renderPage('routing', { routes: d.routes, sources: d.sources, targets: d.targets });
});

/* 6 · COMPOSE */
r.get('/compose', (req, res) => {
  const d = db();
  const prefill = req.query.q ? decodeURIComponent(String(req.query.q)) : '';
  res.renderPage('compose', {
    targets: d.targets,
    brand: d.brand,
    prefill,
    sw: d.settings.switches,
    aiRewrite: d.settings.switches.ai_rewrite,
  });
});

/* 7 · QUEUE */
r.get('/queue', (req, res) => {
  const d = db();
  const q = d.queue;
  res.renderPage('queue', {
    items: q,
    counts: {
      all: q.length,
      pending: q.filter((x) => x.status === 'pending').length,
      delayed: q.filter((x) => x.status === 'delayed').length,
      approved: q.filter((x) => x.status === 'approved').length,
      waiting: q.filter((x) => x.status === 'waiting').length,
      text: q.filter((x) => x.status === 'pending' && x.type === 'text').length,
      media: q.filter((x) => x.status === 'pending' && x.type !== 'text').length,
    },
    targets: d.targets,
    bulkDelay: d.settings.automation.bulkDelay,
    sw: d.settings.switches,
  });
});

/* 8 · SCHEDULED */
r.get('/scheduled', (req, res) => {
  res.renderPage('scheduled', { scheduled: db().scheduled });
});

/* 9 · HISTORY */
r.get('/history', (req, res) => {
  const d = db();
  res.renderPage('history', { history: d.history, sources: d.sources });
});

/* 10 · LIBRARY */
r.get('/library', (req, res) => {
  const d = db();
  res.renderPage('library', {
    library: d.library,
    counts: {
      template: d.library.filter((l) => l.kind === 'template').length,
      media: d.library.filter((l) => l.kind === 'media').length,
      snippet: d.library.filter((l) => l.kind === 'snippet').length,
    },
  });
});

/* 11 · BRAND */
r.get('/brand', (req, res) => {
  const d = db();
  res.renderPage('brand', {
    brand: d.brand,
    sw: d.settings.switches,
    accent: d.settings.accent,
  });
});

/* 12 · WHATSAPP */
r.get('/whatsapp', (req, res) => {
  const d = db();
  res.renderPage('whatsapp', {
    mirror: d.mirror,
    waMessages: d.waMessages,
    settings: d.settings,
    mode: 'simulation',
  });
});

/* 13 · CONTACTS */
r.get('/contacts', (req, res) => {
  res.renderPage('contacts', { contacts: db().contacts });
});

/* 14 · AUTO-REPLIES */
r.get('/auto-replies', (req, res) => {
  const d = db();
  res.renderPage('auto-replies', {
    autoReplies: d.autoReplies,
    on: d.settings.switches.auto_replies,
  });
});

/* 15 · AI PILOT */
r.get('/ai-pilot', (req, res) => {
  const d = db();
  res.renderPage('ai-pilot', {
    mode: d.settings.ai.pilotMode,
    suggestions: d.pilotSuggestions,
    events: d.pilotEvents,
    on: d.settings.switches.ai_pilot_suggest,
  });
});

/* 16 · RULES */
r.get('/rules', (req, res) => {
  res.renderPage('rules', { rules: db().rules });
});

/* 17 · ANALYTICS */
r.get('/analytics', (req, res) => {
  const d = db();
  const srcRows = d.sources.map((s) => {
    const top = d.analytics.topSources.find((t) => t.name === s.name);
    return {
      name: s.name, handle: s.handle,
      published: top ? top.published : 180 + (s.name.length * 37) % 900,
      success: top ? top.success : 97.5 + (s.name.length % 20) / 10,
      skipped: top ? top.skipped : 8 + (s.name.length * 3) % 60,
      latency: top ? top.latency : 1.4 + (s.name.length % 8) * 0.2,
    };
  });
  const tgRows = d.targets.slice(0, 24).map((t) => ({
    name: t.name, kind: t.kind, members: t.members,
    published: 120 + (t.members % 900), last: t.last,
    success: 97 + (t.members % 25) / 10,
  }));
  res.renderPage('analytics', {
    stats: d.analytics.stats,
    series: d.analytics.series,
    top: d.analytics.topSources,
    srcRows, tgRows,
    reports: d.reports,
  });
});

/* 18 · HEALTH */
r.get('/health', (req, res) => {
  const d = db();
  res.renderPage('health', {
    health: d.health,
    meta: d.meta,
    node: process.version,
    uptime: d.meta.uptimeSince,
    dbSize: '214 KB',
  });
});

/* 19 · LOGS */
r.get('/logs', (req, res) => {
  const d = db();
  res.renderPage('logs', { logs: d.logs, audit: d.audit, fmt });
});

/* 20 · SETTINGS */
r.get('/settings', (req, res) => {
  const d = db();
  res.renderPage('settings', {
    settings: d.settings,
    brand: d.brand,
    options: OPTIONS,
    groups: OPTION_GROUPS,
    auditFixed: !d.settings.switches.extended_audit,
  });
});

/* 21 · ABOUT */
r.get('/about', (req, res) => {
  const d = db();
  res.renderPage('about', {
    meta: d.meta,
    mode: 'simulation',
    uptime: d.meta.uptimeSince,
    dbSize: '214 KB',
    queue: d.queue.length,
  });
});

/* 404 */
r.get('/not-found', (req, res) => res.renderPage('not-found', {}));

export default r;
