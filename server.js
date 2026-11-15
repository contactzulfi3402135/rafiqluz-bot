import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import ejs from 'ejs';
import { store, DATA_DIR, DB_FILE } from './lib/store.js';
import { ensureSeed } from './lib/seed.js';
import { startSim } from './lib/sim.js';
import { tFor, langOf, applySettingsLocals } from './lib/i18n.js';
import { sprite } from './lib/icons.js';
import { simTelegram, simWhatsApp, simAI } from './services/index.js';
import pages from './routes/pages.js';
import api from './routes/api.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = __dirname;
const PORT = parseInt(process.env.PORT || '3000', 10);
const MODE = 'simulation'; // adapters in /services run in simulation mode (spec §1)

/* ── boot: data ─────────────────────────────────────────────── */
fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(DB_FILE)) ensureSeed();
const db = store.load();
simTelegram.init(db); simWhatsApp.init(db); simAI.init(db);

const app = express();
app.disable('x-powered-by');
app.set('view engine', 'ejs');
app.set('views', path.join(ROOT, 'views'));
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(ROOT, 'public'), { maxAge: '1h' }));

/* client i18n dictionaries (app.js loadDict) */
const LOCALES = path.join(ROOT, 'locales');
app.get('/locales/:file', (req, res) => {
  const f = String(req.params.file).replace(/[^a-zA-Z0-9_.-]/g, '');
  const name = f.endsWith('.json') ? f : f + '.json';
  const p = path.join(LOCALES, name);
  if (!fs.existsSync(p)) return res.status(404).json({ ok: false, error: 'Not found' });
  res.type('application/json; charset=utf-8').send(fs.readFileSync(p, 'utf8'));
});

/* tiny cookie reader (no extra dependency) */
function cookies(req) {
  const out = {};
  (req.headers.cookie || '').split(';').forEach((p) => {
    const i = p.indexOf('=');
    if (i > 0) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim());
  });
  return out;
}

/* ── request locals: language, theme, helpers ───────────────── */
function timeAgo(ts, lang) {
  const s = Math.max(1, Math.round((Date.now() - ts) / 1000));
  if (s < 60) return lang === 'ur' ? `${s} سیکنٹ پہلے` : `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return lang === 'ur' ? `${m} منٹ پہلے` : `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return lang === 'ur' ? `${h} گھنٹے پہلے` : `${h}h ago`;
  const d = Math.round(h / 24);
  return lang === 'ur' ? `${d} دن پہلے` : `${d}d ago`;
}

app.use((req, res, next) => {
  const lang = langOf(req, db);
  const t = tFor(lang, db);
  res.locals.t = t;
  res.locals.lang = lang;
  res.locals.dir = lang === 'ur' ? 'rtl' : 'ltr';
  res.locals.mode = MODE;
  res.locals.timeAgo = (ts) => timeAgo(ts, lang);
  res.locals.now = Date.now();
  res.locals.healthChecks = db.health.checks;
  res.locals.notifItems = db.notifications.items.slice(0, 5);
  res.locals.userName = db.settings.name || 'Admin';
  res.locals.botName = db.settings.botName || 'Raqifluz';
  applySettingsLocals(res, db, lang);
  next();
});

const NAV_KEY = {
  'ai-pilot': 'pilot', 'auto-replies': 'autoreplies', 'not-found': 'home',
};
/* render a page inside the layout (layout = full document) */
async function renderPage(res, name, data) {
  const navKey = NAV_KEY[name] || name;

  const content = await ejs.renderFile(path.join(ROOT, 'views', 'pages', name + '.ejs'), {
    ...res.locals,
    ...data,
    t: res.locals.t, lang: res.locals.lang, timeAgo: res.locals.timeAgo,
    settings: db.settings, mode: MODE, navKey,
  });
  res.render('layout', { ...res.locals, content, page: name, navKey });
}
app.locals.renderPage = renderPage;
app.locals.svgSprite = sprite();
/* routes call res.renderPage(name, data) — bind res explicitly (this = res would shift args) */
app.use((req, res, next) => { res.renderPage = (name, data) => renderPage(res, name, data); next(); });

app.use('/', pages);
app.use('/api', api);

/* 404 → friendly page */
app.use((req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ ok: false, error: 'Not found' });
  res.status(404);
  renderPage(res, 'not-found', { active: '' }).catch(() => res.send('Not found'));
});

/* errors never crash: friendly JSON / text */
app.use((err, req, res, next) => {
  console.error('[rq-error]', req.method, req.path, err.stack || err);
  if (res.headersSent) return next(err);
  if (req.path.startsWith('/api/')) return res.status(400).json({ ok: false, error: String(err.message || err) });
  res.status(500).send('Something went wrong. Please try again.');
});

app.listen(PORT, '0.0.0.0', () => {
  startSim(db);
  console.log(`Raqifluz dashboard running: http://localhost:${PORT} (mode: ${MODE})`);
});
