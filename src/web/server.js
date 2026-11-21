'use strict';
/** v6.0.0 — web server: owner dashboard + JSON API. Login is rate-limited;
 *  sessions + bearer token (works even where cookies are blocked). */
const path = require('path');
const express = require('express');
const session = require('express-session');
const rateLimit = require('express-rate-limit');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const fs = require('fs');

const cfg = require('../config');
const { ring, logger } = require('../logger');
const { S, CH, P, A, BULKH, CT, CL, QR, WAS, CN, BCL, SUBS } = require('../db');
const wa = require('../wa');
const channels = require('../channels');
const inbox = require('../inbox');
const email = require('../email');
const pipeline = require('../pipeline');
const { AICHAT } = require('../db');
const numbers = require('../numbers');
const power = require('../power');
const publishMod = require('../publish');
const ai = require('../ai');
const aicontrol = require('../aicontrol');   // v7.4.0: Ask-AI bot control
const templates = require('../templates');   // v7.5.0: post templates
const queue5a = require('../queue5a');       // 5A: approval/hold queue
const wasched = require('../wasched');       // 5F (R76): scheduled personal WhatsApp sends
const webhooks = require('../webhooks');     // 5G (R80): outgoing webhooks (off by default)
const rss = require('../rss');               // 5G (R82): RSS/Atom source type
const { SR, RC, LAT, AUD, SN, DR, AIU, PL, GL, RB } = require('../db'); // 5A: rule cards, matrix, latency, audit · 5B: snippets, drafts · 5C: AI usage, prompts, glossary, reply KB

// Process-local bearer credentials retain the role and session that issued them.
// They expire after the configured idle timeout and are revoked on sign-out.
const tokens = new Map();
function tokenFor(req) {
  const h = String(req.get('authorization') || '');
  if (!h.startsWith('Bearer ')) return null;
  const key = h.slice(7), t = tokens.get(key);
  if (!t) return null;
  if (Date.now() - t.lastUsed > t.timeoutMs || Date.now() - t.createdAt > 24 * 3600e3) { tokens.delete(key); return null; }
  t.lastUsed = Date.now();
  return t;
}
function revokeSessionTokens(id) {
  if (!id) return;
  for (const [key, value] of tokens) if (value.sessionId === id) tokens.delete(key);
}


function checkCredentials(username, password) {
  if (!username || String(username).trim() !== cfg.config.dashboard.username) return false;
  const hash = S.get('dashboard.password_hash', '');
  if (hash) { try { return bcrypt.compareSync(String(password || ''), hash); } catch { return false; } }
  return String(password || '') === cfg.config.dashboard.password && Boolean(cfg.config.dashboard.password);
}

function build(app) {
  app.disable('x-powered-by');
  // Default platform proxy chain is one hop (Heroku). Override only if the
  // deployment is actually behind a trusted reverse proxy.
  if (process.env.TRUST_PROXY === '1' || process.env.DYNO) app.set('trust proxy', 1);
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    // Arena's preview is intentionally embedded; regular deployments deny framing.
    if (!/\.e2b\.app(?::\d+)?$/i.test(req.get('host') || '')) res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    if (['GET','HEAD','OPTIONS'].includes(req.method)) return next();
    // Cross-site browser mutations must not use ambient cookie authority.
    if (req.get('sec-fetch-site') === 'cross-site') return res.status(403).json({ok:false,error:'Cross-site request rejected.'});
    const origin = req.get('origin');
    if (origin) {
      try { if (new URL(origin).host !== req.get('host')) return res.status(403).json({ok:false,error:'Cross-origin request rejected.'}); }
      catch { return res.status(403).json({ok:false,error:'Invalid request origin.'}); }
    }
    next();
  });
  app.set('view engine', 'ejs');
  app.set('views', path.join(__dirname, 'views'));
  app.use(express.static(path.join(__dirname, 'assets'), { maxAge: '1h' }));
  // R19: vendored Lucide icons inlined server-side at render time (no icon CDN)
  app.use((req, res, next) => { res.locals.icon = require('./icons').icon; next(); });
  /* v7.3.6: profile-photo cache for the WhatsApp tab (served under /media/avatars) */
  const AVA_DIR = path.join(__dirname, '..', '..', 'data', 'avatars');
  fs.mkdirSync(AVA_DIR, { recursive: true });
  app.use(express.json({ limit: '2mb' }));
  app.use(express.urlencoded({ extended: false, limit: '64kb' }));
  /* 5E (R71): configurable idle session timeout (minutes, default 120) —
     rolling, so active owners are never logged out mid-work. */
  const sessionTimeoutMs = () => Math.min(24 * 3600e3, Math.max(5, parseInt(S.get('session.timeout_min', '120'), 10) || 120) * 60e3);
  const configuredSecret = cfg.config.dashboard.sessionSecret;
  const sessionSecret = configuredSecret && !/^(change-me|replace-this)/i.test(configuredSecret) ? configuredSecret : crypto.randomBytes(32).toString('hex');
  if (sessionSecret !== configuredSecret) ring.warn('dashboard.secret', 'SESSION_SECRET is missing or default; using a temporary random secret. Set a long random SESSION_SECRET to keep sessions across restarts.');
  app.use(session({
    secret: sessionSecret, resave: false, saveUninitialized: false, rolling: true,
    cookie: { maxAge: 120 * 60e3, sameSite: 'lax', httpOnly: true, secure: 'auto' }
  }));
  /* the timeout is re-read on every request, so the Security card's changes apply live */
  app.use((req, res, next) => { try { if (req.session && req.session.cookie) req.session.cookie.maxAge = sessionTimeoutMs(); } catch { } next(); });

  // Profile photos are private customer data, not public static assets.
  app.use('/media/avatars', (req, res, next) => {
    if (!req.session?.authenticated) return res.status(401).end();
    next();
  }, express.static(AVA_DIR, { maxAge: '30m', setHeaders: res => res.setHeader('Cache-Control', 'private, max-age=1800') }));

  const loginLimiter = rateLimit({ windowMs: 15 * 60e3, max: 12, standardHeaders: true, legacyHeaders: false,
    handler: (req, res) => res.status(429).json({ ok: false, error: 'Too many attempts — wait 15 minutes.' }) });

  /* v1.2: channel display name — real name from sources → directory → synced
     contacts, else a masked "Channel •last4" label. No API or log ever shows
     a raw number again (v11 did the same for lists only; exports, audits,
     rule cards and AI context inherited the raw jid). */
  const badName = (n, j) => {
    const x = String(n || '').trim();
    return !x || x === j || /^\d+$/.test(x) || /^\d+(@[a-z.]+)?$/i.test(x);
  };
  const maskedName = (jid) => 'Channel •' + String(jid).split('@')[0].slice(-4);
  const displayName = (jid) => {
    const sname = CH.listSources().find((x) => x.jid === jid)?.name;
    if (!badName(sname, jid)) return sname;
    const dname = CH.dirList().find((x) => x.jid === jid)?.name;
    if (!badName(dname, jid)) return dname;
    try { const ct = CT.nameOf('main', jid); if (!badName(ct, jid)) return ct; } catch { }
    return maskedName(jid);
  };
  const nameOrJid = displayName; /* legacy alias — existing call sites keep working */
  /* v1.2: fire-and-forget name recovery — if a list still carries numeric
     names, ask WhatsApp for the real ones in the background; when one lands,
     every open dashboard tab is told to refresh via SSE. */
  let nameResolveQueued = false;
  const maybeResolveNames = (tag) => {
    if (nameResolveQueued || wa.getStatus().status !== 'open') return;
    const anyBad = [...CH.listSources(), ...CH.listTargets(), ...CH.dirList()].some((r) => badName(r.name, r.jid));
    if (!anyBad) return;
    nameResolveQueued = true;
    channels.resolveMissingNames(6).then(({ resolved }) => {
      if (resolved && resolved.length) {
        ring.info('web.names', `Recovered ${resolved.length} channel name(s) (${tag}): ${resolved.map((r) => r.name).join(', ').slice(0, 120)}`);
        ssePush('channels', { reason: 'renamed', jids: resolved.map((r) => r.jid) }); // v1.2: no throttle — a dropped state change = stale UI
      }
    }).catch(() => { }).finally(() => { nameResolveQueued = false; });
  };

  const sseClients = new Set();
  const auth = (req, res, next) => {
    if (req.session?.authenticated) { req.authRole = req.session.role === 'readonly' ? 'readonly' : 'full'; return next(); }
    const t = tokenFor(req);
    if (t) { req.authRole = t.role; return next(); }
    const key = String(req.get('x-api-key') || ''), expected = S.get('api.key', '');
    if (key && expected && Buffer.byteLength(key) === Buffer.byteLength(expected) && crypto.timingSafeEqual(Buffer.from(key), Buffer.from(expected))) { req.authRole = 'full'; return next(); }
    res.status(401).json({ ok: false, error: 'Not logged in.' });
  };
  // Public pairing is deliberately opt-in: it can add or replace accounts.
  const publicPairing = process.env.PUBLIC_PAIRING === '1';
  const pairAuth = (req, res, next) => {
    if (publicPairing) return next();
    if (req.session?.authenticated) return req.session.role !== 'readonly' ? next() : res.status(403).json({ok:false,error:'Owner access required.'});
    const t = tokenFor(req);
    if (t && t.role === 'full') return next();
    res.status(401).json({ok:false,error:'Sign in as the owner to connect a number.'});
  };

  app.get('/healthz', (req, res) => res.status(200).send('ok'));

  app.get('/', (req, res) => res.redirect(req.session?.authenticated ? '/admin' : (publicPairing ? '/connect' : '/login')));
  /* ── v7: PUBLIC pairing page — any number can be linked by scanning here.
     Chats stay inside the password-protected dashboard. ── */
  app.get('/connect', (req, res) => { if (!publicPairing && (!req.session?.authenticated || req.session.role === 'readonly')) return res.redirect('/login'); return res.render('connect', {
    botName: cfg.config.botName, version: cfg.config.version, authed: Boolean(req.session?.authenticated),
    cloud: require('../persist').publicStatus()
  }); });
  const publicLimiter = rateLimit({ windowMs: 15 * 60e3, max: 30, standardHeaders: true, legacyHeaders: false,
    handler: (req, res) => res.status(429).json({ ok: false, error: 'Too many pairing requests — wait 15 minutes.' }) });
  app.post('/api/public/connect', pairAuth, publicLimiter, async (req, res) => {
    try { const r = await numbers.add(String(req.body?.label || '')); res.json({ ok: true, ...r }); }
    catch (err) { res.status(400).json({ ok: false, error: err.message }); }
  });
  /* v7.3.3: pairing code — anyone can connect by typing a code on their phone (no QR). */
  app.post('/api/public/pair', pairAuth, publicLimiter, async (req, res) => {
    try {
      const replace = String(req.body?.replace || '');
      if (replace) {
        try { const v = numbers.publicView(replace); if (v && v.status && v.status !== 'open') await numbers.remove(replace); } catch { }
      }
      const r = await numbers.addPair(req.body?.phone);
      res.json({ ok: true, ...r });
    } catch (err) { res.status(400).json({ ok: false, error: err.message }); }
  });
  app.get('/api/public/connect/:id', pairAuth, async (req, res) => {
    const v = numbers.publicView(req.params.id);
    const qr = v.status === 'qr' ? await numbers.qrDataUrl(req.params.id) : null;
    res.json({ ok: true, ...v, qr });
  });
  app.get('/api/public/numbers', pairAuth, (req, res) => {
    res.json({ ok: true, list: numbers.list().map((n) => ({ id: n.id, label: n.label, phone: n.phone, status: n.status })) });
  });
  app.get('/login', (req, res) => res.render('login', { error: null, botName: cfg.config.botName }));
  /* 5E (R71): login email alert — best-effort, only when the owner switched
     it on (default OFF). Goes to the default email account, if connected. */
  const loginAlert = (role, req) => {
    if (!S.getBool('login.alerts', false)) return;
    try {
      const accs = email.publicAccounts();
      const def = accs.find((a) => a.isDefault);
      if (!def || !def.user) return;
      const nowPkt = new Date(Date.now() + 5 * 3600e3).toISOString().replace('T', ' ').slice(0, 16);
      email.sendOrQueue({
        to: def.user,
        subject: `Raqifluz dashboard login — ${role === 'readonly' ? 'READ-ONLY session' : 'full session'}`,
        body: `A dashboard session was opened (${role === 'readonly' ? 'READ-ONLY' : 'FULL access'}).\n\nIP: ${req.ip}\nTime (PKT): ${nowPkt}\nBrowser: ${String(req.get('user-agent') || '?').slice(0, 120)}\n\nIf this was not you, change your dashboard password in Settings → Security.`
      }).catch(() => { });
    } catch { }
  };
  app.post('/login', loginLimiter, (req, res) => {
    const { username, password } = req.body || {};
    const wantsJson = String(req.get('accept') || '').includes('application/json');
    const roOn = S.getBool('ro.enabled', false) && String(username || '').trim() === String(cfg.config.dashboard.username).trim();
    const roHash = S.get('ro.password_hash', '');
    const isRo = roOn && roHash && bcrypt.compareSync(String(password || ''), roHash);
    if (!checkCredentials(username, password) && !isRo) {
      ring.warn('dashboard.login.fail', `Failed dashboard login for "${username || '?'}"`);
      try { AUD.log('owner', 'login.fail', `Failed login for "${String(username || '?').slice(0, 40)}" from ${req.ip}`); } catch { }
      if (wantsJson) return res.status(401).json({ ok: false, error: 'Invalid username or password.' });
      return res.status(401).render('login', { error: 'Invalid username or password.', botName: cfg.config.botName });
    }
    const role = isRo ? 'readonly' : 'full';
    const oldId = req.sessionID;
    revokeSessionTokens(oldId);
    req.session.regenerate((err) => {
      if (err) return res.status(500).json({ok:false,error:'Could not start a secure session.'});
      req.session.authenticated = true;
      req.session.role = role;
      req.session.username = String(username).trim();
      const token = crypto.randomBytes(24).toString('hex');
      const now = Date.now();
      for (const [k, t] of tokens) if (now - t.lastUsed > t.timeoutMs || now - t.createdAt > 24 * 3600e3) tokens.delete(k);
      while (tokens.size >= 1000) tokens.delete(tokens.keys().next().value);
      tokens.set(token, {role, sessionId:req.sessionID, createdAt:now, lastUsed:now, timeoutMs:sessionTimeoutMs()});
      ring.info('dashboard.login', `Dashboard login: ${String(username).trim()} (${role})`);
      try { AUD.log('owner', role === 'readonly' ? 'login.readonly' : 'login', `${role === 'readonly' ? 'Read-only' : 'Full'} session from ${req.ip}`); } catch { }
      loginAlert(role, req);
      req.session.save((saveErr) => {
        if (saveErr) { tokens.delete(token); return res.status(500).json({ok:false,error:'Could not save session.'}); }
        if (wantsJson) return res.json({ ok: true, token, role });
        res.redirect('/admin');
      });
    });
  });
  app.post('/logout', (req, res) => {
    revokeSessionTokens(req.sessionID);
    const h = String(req.get('authorization') || '');
    for (const client of sseClients) if (client.authSessionId === req.sessionID || (h.startsWith('Bearer ') && client.authToken === h.slice(7))) client.end();
    if (h.startsWith('Bearer ')) tokens.delete(h.slice(7));
    req.session.destroy(() => { res.clearCookie('connect.sid'); res.redirect('/login'); });
  });

  /* ---- v7.6.0 (R24): SSE live updates — the dashboard reacts the moment something happens ---- */
  const sseLast = {};
  function ssePush(type, data, minGapMs) {
    const now = Date.now();
    if (minGapMs && sseLast[type] && now - sseLast[type] < minGapMs) return;
    sseLast[type] = now;
    if (!sseClients.size) return;
    const payload = 'data: ' + JSON.stringify(Object.assign({ type }, data || {})) + '\n\n';
    for (const r of sseClients) { try { r.write(payload); } catch (e) { sseClients.delete(r); } }
  }
  app.get('/events', (req, res) => {
    const h = req.headers.authorization || '';
    if (!req.session?.authenticated && !tokenFor(req)) return res.status(401).end();
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    res.write('retry: 5000\n\n');
    res.authSessionId = req.sessionID;
    res.authToken = h.startsWith('Bearer ') ? h.slice(7) : '';
    sseClients.add(res);
    const ping = setInterval(() => { try { res.write(': ping\n\n'); } catch (e) {} }, 25000);
    req.on('close', () => { clearInterval(ping); sseClients.delete(res); });
  });
  wa.events.on('wa.status', (e) => ssePush('status', e, 1000));
  require('../logger').logEvents.on('log', (d) => ssePush('activity', d, 2000));

  app.get('/admin', (req, res) => {
    if (!req.session?.authenticated) return res.redirect('/login');
    res.render('dashboard', { botName: S.get('bot_name', cfg.config.botName), version: cfg.config.version, username: req.session.username || 'admin' });
  });

  const api = express.Router();
  api.use(auth);
  /* Read-only restrictions apply to both sessions and issued bearer tokens. */
  api.use((req, res, next) => {
    if (req.authRole === 'readonly' && (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) || (req.path.startsWith('/backup/') || req.path === '/qr' || /^\/numbers\/[^/]+\/qr$/.test(req.path)))) {
      return res.status(403).json({ ok: false, error: 'Read-only session — sign in with the main dashboard password to make changes.' });
    }
    next();
  });
  /* 5E (R71): session introspection — role + when the idle timeout will drop it */
  api.get('/session', (req, res) => res.json({
    ok: true,
    role: req.authRole === 'readonly' ? 'readonly' : 'full',
    timeoutMin: Math.min(24 * 60, Math.max(5, parseInt(S.get('session.timeout_min', '120'), 10) || 120))
  }));

  /* ---- status + overview ---- */
  const statusFor = req => { const state = wa.getStatus(); return req.authRole === 'readonly' ? { ...state, qr: null } : state; };
  api.get('/status', (req, res) => res.json({ ok: true, ...statusFor(req) }));
  api.get('/overview', (req, res) => {
    const today = new Date(Date.now() + 5 * 3600e3).toISOString().slice(0, 10);
    const rows = Object.fromEntries(A.day(today).map((r) => [r.status, r.n]));
    res.json({
      ok: true, wa: statusFor(req),
      sources: CH.listActiveSources().length, targets: CH.listActiveTargets().length,
      today: { published: rows.published || 0, skipped: rows.skipped || 0, failed: rows.failed || 0 },
      cloud: require('../persist').enabled(),
      cloudStatus: require('../persist').publicStatus(),
      mirrorPaused: S.getBool('mirror.paused', false),
      uptime: require('../db').open().prepare('SELECT COUNT(*) n FROM uptime').get().n,
      lastBoot: (require('../db').open().prepare('SELECT booted_at FROM uptime ORDER BY id DESC LIMIT 1').get() || {}).booted_at || '', // 5J (J9): About page
      latency: LAT.stats(7),                                   // 5A (R46): mirror-latency KPI
      queue: { pending: queue5a.pendingCount(), delayMin: Math.max(0, parseInt(S.get('queue.delay.min', '0'), 10) || 0) }, // 5A (R37)
      panic: require('../panic').view(),                        // 5E (R73)
      pace: require('../pace').status()                          // 5E (R74)
    });
  });
  /* Signal Desk reference: the Home "Activity overview" chart — REAL hourly
     outcome counts for the last 24 h (PKT time), one bucket per hour.
     Additive read-only route; no schema or behavior change. */
  api.get('/overview/hourly', (req, res) => {
    try {
      const d = require('../db').open();
      const now = Date.now();
      const since = new Date(now - 24 * 3600e3).toISOString().slice(0, 19).replace('T', ' ');
      const buckets = new Array(24).fill(null).map(() => ({ published: 0, skipped: 0, failed: 0 }));
      const rows = d.prepare(`SELECT created_at, status FROM posts WHERE created_at >= ?`).all(since);
      for (const r of rows) {
        const t = new Date(String(r.created_at).replace(' ', 'T') + 'Z').getTime();
        const idx = 23 - Math.floor((now - t) / 3600e3); // 0 = oldest hour … 23 = current hour
        if (idx < 0 || idx > 23) continue;
        if (buckets[idx][r.status] !== undefined) buckets[idx][r.status] += 1;
      }
      /* hour labels in Pakistan time (UTC+5, no DST) for the bucket start */
      const labels = buckets.map((b, i) => { const dt = new Date(now - (23 - i) * 3600e3 + 5 * 3600e3); return String(dt.getUTCHours()).padStart(2, '0') + ':00'; });
      res.json({ ok: true, buckets, labels, total: rows.length });
    } catch (err) { res.status(400).json({ ok: false, error: err.message }); }
  });

  /* ---- sources / targets / directory ---- */
  for (const [kind, add] of [['sources', (i, fast) => resolveAndAdd(i, 'sources', fast)], ['targets', (i, fast) => resolveAndAdd(i, 'targets', fast)]]) {
    api.get(`/${kind}`, (req, res) => {
      /* v1.2: if the list still carries numeric names, recover the real ones
         from WhatsApp in the background (SSE notifies the tabs on success). */
      if (kind === 'sources') maybeResolveNames('sources list');
      /* v7.3.3: a channel must never show as a raw number — displayName()
         resolves sources → directory → contacts → masked "Channel •last4". */
      res.json({
        ok: true,
        list: (kind === 'sources' ? CH.listSources() : CH.listTargets()).map((c) => ({ ...c, name: displayName(c.jid), role: CH.dirRole(c.jid) })),
        /* v7.9: channels this account follows on WhatsApp that are not Sources
           yet — the Sources tab offers a one-click "add all" for exactly these. */
        ...(kind === 'sources' ? { followedMissing: CH.dirList().filter((d) => d.role && !CH.listSources().some((s) => s.jid === d.jid) && !CH.listTargets().some((t) => t.jid === d.jid)).map((d) => ({ jid: d.jid, name: displayName(d.jid) })) } : {})
      });
    });
    if (kind === 'sources') {
      api.post('/sources/sync-followed', (req, res) => {
        try {
          const added = channels.syncFollowed();
          ssePush('channels', { reason: 'sync-followed', count: added.length }); // v1.2: no throttle — a dropped state change = stale UI
          res.json({ ok: true, added, count: added.length });
        } catch (err) { res.status(400).json({ ok: false, error: err.message }); }
      });
    }
    api.post(`/${kind}`, async (req, res) => {
      try {
        const r = await add(String(req.body?.input || '').trim());
        if (!r.ok) return res.status(400).json({ ok: false, error: r.message });
        AUD.log('owner', `${kind}.add`, `Added ${kind.slice(0, -1)}: ${(kind === 'sources' ? CH.listSources() : CH.listTargets()).map((x) => displayName(x.jid)).slice(-1)[0] || String(req.body?.input || '').slice(0, 80)}`);
        res.json({ ok: true, message: r.message });
      } catch (err) { res.status(400).json({ ok: false, error: err.message }); }
    });
    /* v7.3.3: multi-select add — the dashboard ticks several channels, we add them all. */
    api.post(`/${kind}/bulk`, async (req, res) => {
      const jids = [...new Set((Array.isArray(req.body?.jids) ? req.body.jids : []).map((j) => String(j).trim()).filter((j) => j.includes('@newsletter')))];
      if (!jids.length) return res.status(400).json({ ok: false, error: 'Tick at least one channel.' });
      if (jids.length > 25) return res.status(400).json({ ok: false, error: 'Pick 25 channels at a time.' });
      const done = [], skipped = [], errors = [];
      for (const jid of jids) {
        try {
          const r = await add(jid, true);
          if (r.ok) done.push(r.message || jid);
          else if (/already in the list/i.test(r.message || '')) skipped.push(r.message || jid);
          else errors.push(r.message || jid);
        } catch (err) { errors.push(`${jid}: ${err.message}`); }
      }
      if (done.length) AUD.log('owner', `${kind}.bulk-add`, `Added ${done.length} ${kind}: ${done.map((m) => String(m).slice(0, 40)).join(', ').slice(0, 200)}`);
      res.json({ ok: true, added: done.length, done, skipped, errors });
    });
    api.patch(`/${kind}/:jid`, (req, res) => {
      const jid = decodeURIComponent(req.params.jid);
      if (req.body?.paused !== undefined) (kind === 'sources' ? CH.pauseSource : CH.pauseTarget)(jid, Boolean(req.body.paused));
      if (kind === 'sources' && req.body?.targets !== undefined) CH.setSourceTargets(jid, String(req.body.targets || '')); // v6.1 mapping
      res.json({ ok: true });
    });
    api.delete(`/${kind}/:jid`, (req, res) => {
      const jid = decodeURIComponent(req.params.jid);
      AUD.log('owner', `${kind}.remove`, `Removed ${kind.slice(0, -1)}: ${nameOrJid(jid).slice(0, 80)}`);
      (kind === 'sources' ? CH.removeSource : CH.removeTarget)(jid);
      ssePush('channels', { reason: 'removed', jid, kind }); // v1.2: no throttle — a dropped state change = stale UI
      res.json({ ok: true });
    });
  }
  api.get('/directory', (req, res) => {
    maybeResolveNames('directory');
    res.json({ ok: true, list: CH.dirList().map((d) => ({ ...d, name: displayName(d.jid) })), wa: statusFor(req), scan: channels.scanStatus() });
  });
  /* v1.2: owner-triggered name recovery — "my channels show numbers, fix it" */
  api.post('/channels/resolve-names', async (req, res) => {
    try {
      const r = await channels.resolveMissingNames(10);
      res.json({ ok: true, ...r });
    } catch (err) { res.status(400).json({ ok: false, error: err.message }); }
  });

  /* v7.8.0 · Browse channels — a real browse experience in the dashboard:
     curated catalog (categories + countries + endless paging), real Follow
     (newsletterFollow), real Add-to-Sources, real Unfollow. */
  const catg = require('../catalog');
  /* v7.9.1 search — how real WhatsApp search behaves:
     * word-based, not substring. "dawn news" finds "Dawn ⚡ News",
     * "Dawn News", "Dawn — Breaking News"… every word of the query must
     * appear (in any order, whole words) in the name or blurb.
     * Case- and diacritic-insensitive. Name matches rank above blurb-only
     * matches so the channel you meant surfaces first. */
  const normSearch = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const wordsOf = (s) => normSearch(s).split(/[^a-z0-9\u00c0-\u024f\u1e00-\u1eff\u4e00-\u9fff\u0600-\u06ff]+/).filter(Boolean);
  const allWordsIn = (hay, words) => words.every((w) => hay.includes(w));
  api.get('/browse/channels', (req, res) => {
    const q = String(req.query.q || '').trim();
    const words = q ? wordsOf(q) : [];
    const caty = String(req.query.category || '').trim();
    const country = String(req.query.country || '').trim();
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const size = Math.min(50, Math.max(4, parseInt(req.query.size, 10) || 12));
    let list = catg.CATALOG.slice();
    if (caty && catg.CATEGORIES.includes(caty)) list = list.filter((c) => c.category === caty);
    if (country && catg.COUNTRIES.includes(country)) list = list.filter((c) => c.country === country);
    if (words.length) {
      const inName = (hay) => words.filter((w) => hay.includes(w)).length;
      list = list.map((c) => {
        const nameHay = normSearch(c.name);
        const allHay = nameHay + ' ' + normSearch(c.blurb);
        if (!allWordsIn(allHay, words)) return null;
        // rank = how few of the query words the NAME carries: 0 = the channel
        // name has every word (that's what you searched for), higher = matches
        // only via the blurb. Within a rank, shorter names first.
        return { c, rank: words.length - inName(nameHay) };
      }).filter(Boolean);
      list.sort((a, b) => a.rank - b.rank || (a.c.name.length - b.c.name.length));
      list = list.map((x) => x.c);
    }
    const total = list.length;
    const start = (page - 1) * size;
    const dir = CH.dirList();
    const srcs = CH.listSources();
    /* v7.9.1: row state by CODE, not name — a directory/source row keeps the
       channel's real WhatsApp name, which can differ from the catalog name */
    const codeJid = (id) => id + '@newsletter';
    list = list.slice(start, start + size).map((c) => ({
      ...c,
      following: !!dir.some((d) => d.jid === codeJid(c.id) && d.role),
      inSources: !!srcs.some((s) => s.jid === codeJid(c.id)),
    }));
    res.json({ ok: true, list, page, size, total, hasMore: start + list.length < total, catalogTotal: catg.CATALOG.length, categories: catg.CATEGORIES, countries: catg.COUNTRIES, wa: wa.getStatus().status, followingCount: dir.filter((d) => d.role).length });
  });
  api.post('/browse/follow', async (req, res) => {
    try {
      const b = req.body || {};
      const r = await channels.browseFollow(b.link || b.code || '', { addSource: !!b.addSource });
      if (r && r.ok) ssePush('channels', { reason: 'follow', jid: r.jid }); // v1.2: no throttle — a dropped state change = stale UI
      res.json(r);
    } catch (err) { res.status(400).json({ ok: false, error: err.message }); }
  });
  api.post('/browse/unfollow', async (req, res) => {
    try {
      const b = req.body || {};
      const r = await channels.browseUnfollow(b.code || b.jid || '');
      if (r && r.ok) ssePush('channels', { reason: 'unfollow', jid: r.jid }); // v1.2: no throttle — a dropped state change = stale UI
      res.json(r);
    } catch (err) { res.status(400).json({ ok: false, error: err.message }); }
  });
  api.post('/browse/add-source', async (req, res) => {
    try {
      const b = req.body || {};
      const r = await channels.browseAddSource(b.code || b.jid || '');
      if (r && r.ok) ssePush('channels', { reason: 'addsource', jid: r.jid }); // v1.2: no throttle — a dropped state change = stale UI
      res.json(r);
    } catch (err) { res.status(400).json({ ok: false, error: err.message }); }
  });
  /* v7.7.3: the Sources "Refresh" button asks WHATSAPP — a live follow-state
     check of every known channel (names, roles, unfollow removal). */
  api.post('/directory/rescan', async (req, res) => {
    try {
      const sock = wa.getSocket();
      if (!sock || wa.getStatus().status !== 'open') return res.status(400).json({ ok: false, error: 'WhatsApp is not connected — link it in the WhatsApp tab first, then refresh.' });
      const stat = await channels.scanChannels();
      AUD.log('owner', 'sources.rescan', `Manual channel check: ${stat.checked} channel(s) verified, ${stat.removed.length} removed (unfollowed)`);
      ssePush('channels', { reason: 'rescan', removed: stat.removed }); // v1.2: no throttle — a dropped state change = stale UI
      res.json({ ok: true, ...stat });
    } catch (err) { res.status(400).json({ ok: false, error: err.message }); }
  });
  api.post('/directory/refresh', async (req, res) => {
    try {
      const sock = wa.getSocket();
      if (!sock) return res.status(400).json({ ok: false, error: 'WhatsApp is not connected.' });
      const result = await sock.newsletterMetadata('invite', String(req.body?.invite || '').split('/').pop());
      if (result?.id) { CH.recordDir(result.id, result.name, null); return res.json({ ok: true, jid: result.id, name: result.name }); }
      res.status(400).json({ ok: false, error: 'WhatsApp did not return channel details for that invite.' });
    } catch (err) { res.status(400).json({ ok: false, error: err.message }); }
  });

  /* ---- power: switches + scheduler + routing + aipilot ---- */
  api.get('/power', (req, res) => res.json({
    ok: true, switches: pipeline.switches(),
    scheduler: power.jobs(),
    routing: (() => { try { return JSON.parse(S.get('power.routing.rules', '[]')); } catch { return []; } })(),
    aipilot: S.get('power.aipilot.criteria', ''),
    signatureText: S.get('power.signature.text', ''),
    headerText: S.get('power.header.text', ''),
    template: { ...templates.getInfo(), list: templates.list(), preview: templates.preview(), pool: templates.getPool(), styles: templates.getStyles(), history: templates.getHistory(), zones: templates.customZones() },
    automonitor: channels.autoMonitorFlag()
  }));
  api.post('/power/toggle', (req, res) => {
    try {
      pipeline.setSwitch(String(req.body?.key || ''), Boolean(req.body?.on));
      ring.info('power.toggle', `⚡ ${req.body?.key} turned ${req.body?.on ? 'ON' : 'OFF'} from the dashboard`);
      AUD.log('owner', 'power.toggle', `Switch "${String(req.body?.key).slice(0, 40)}" turned ${req.body?.on ? 'ON' : 'OFF'}`);
      res.json({ ok: true, switches: pipeline.switches() });
    }
    catch (err) { res.status(400).json({ ok: false, error: err.message }); }
  });
  api.post('/power/scheduler', (req, res) => {
    try { const job = power.addJob(req.body || {}); res.json({ ok: true, job }); }
    catch (err) { res.status(400).json({ ok: false, error: err.message }); }
  });
  api.delete('/power/scheduler/:id', (req, res) => { power.removeJob(req.params.id); res.json({ ok: true }); });
  api.post('/power/routing', (req, res) => {
    const rules = Array.isArray(req.body?.rules) ? req.body.rules.slice(0, 100).map((r) => ({
      jid: String(r.jid || ''), include: String(r.include || '').slice(0, 300), exclude: String(r.exclude || '').slice(0, 300),
      type: ['all', 'text', 'media'].includes(r.type) ? r.type : 'all'
    })).filter((r) => r.jid) : [];
    S.set('power.routing.rules', JSON.stringify(rules));
    res.json({ ok: true, rules });
  });
  api.post('/power/aipilot', (req, res) => { S.set('power.aipilot.criteria', String(req.body?.criteria || '').slice(0, 500)); res.json({ ok: true }); });
  /* ---- 5J (J7): AI safety screen criteria (the switch itself rides /api/power/toggle) ---- */
  api.get('/power/aisafety', (req, res) => res.json({ ok: true, criteria: S.get('power.aisafety.criteria', ''), unavailable: S.get('power.aisafety.unavailable', 'open') }));
  api.post('/power/aisafety', (req, res) => { S.set('power.aisafety.criteria', String(req.body?.criteria || '').slice(0, 500)); if (['open','review'].includes(req.body?.unavailable)) S.set('power.aisafety.unavailable', req.body.unavailable); try { AUD.log('owner', 'aisafety.save', `AI safety screen criteria saved (${String(req.body?.criteria || '').length} chars)`); } catch { } res.json({ ok: true }); });
  api.post('/power/template', (req, res) => {
    try { const info = templates.saveInfo(req.body || {}); res.json({ ok: true, info, preview: templates.preview() }); }
    catch (err) { res.status(400).json({ ok: false, error: err.message }); }
  });
  api.post('/power/tplstyle', (req, res) => {   /* v7.6.0 (R30): per-template AI style instruction */
    try { const v = templates.setStyle(String(req.body?.id || ''), String(req.body?.style || '')); res.json({ ok: true, style: v }); }
    catch (err) { res.status(400).json({ ok: false, error: err.message }); }
  });

  /* ---- analytics (5D R61: v2 — per-target, heatmap, skip reasons, media split, trends) ---- */
  api.get('/analytics', (req, res) => {
    const days = Math.min(30, Math.max(7, parseInt(req.query.days || '14', 10) || 14));
    const base = power.analytics(days);
    const from = new Date(Date.now() - days * 86400e3).toISOString().slice(0, 19).replace('T', ' ');
    /* heatmap: 7 PKT days × 24 h, published+edited. hourBuckets returns PKT
       day + PKT hour, so days align with each other directly. */
    const buckets = A.hourBuckets(new Date(Date.now() - 7 * 86400e3).toISOString().slice(0, 19).replace('T', ' '));
    const heat = [];
    for (let dI = 6; dI >= 0; dI--) {
      const day = new Date(Date.now() - dI * 86400e3 + 5 * 3600e3).toISOString().slice(0, 10);
      const cell = { day, hours: new Array(24).fill(0) };
      for (const b of buckets) if (b.day === day) cell.hours[b.hr] = (cell.hours[b.hr] || 0) + b.n;
      heat.push(cell);
    }
    const from7 = new Date(Date.now() - 7 * 86400e3).toISOString().slice(0, 19).replace('T', ' ');
    const dayBySource = {};
    for (const b of A.sourceDays(from7)) { (dayBySource[b.source_jid] = dayBySource[b.source_jid] || {})[b.day] = b.n; }
    res.json({
      ok: true, ...base,
      perTarget: A.perTarget(from),
      sourcesFull: A.perSourceFull(from),
      skipReasons: A.skipReasons(from),
      media: A.mediaSplit(from),
      heatmap: heat,
      dayBySource
    });
  });

  /* ---- posts: history, edit, delete, purge (edit/delete/purge gated by the editposts switch) ---- */
  api.get('/posts', (req, res) => {
    const limit = Math.min(200, parseInt(req.query.limit || '50', 10) || 50);
    // v7.3.4: history rows carry the channel NAME (never a raw number) —
    // backfill from the sources list, then the synced directory.
    const srcs = CH.listSources();
    const dir = CH.dirList();
    const nameFor = (jid) => {
      if (jid === 'evergreen@bot') return 'Evergreen';          // 5H (R86): recycled posts
      const sname = srcs.find((x) => x.jid === jid)?.name;
      if (sname && sname !== jid && !/^\d+$/.test(sname)) return sname;
      const dname = dir.find((x) => x.jid === jid)?.name;
      if (dname && dname !== jid && !/^\d+$/.test(dname)) return dname;
      return '';
    };
    const rows = A.recent(limit).map((r) => ({ ...r, keys: P.keys(r.id), canEdit: pipeline.switches().editposts, source_name: nameFor(r.source_jid) }));
    res.json({ ok: true, list: rows });
  });
  api.get('/posts/:id/delivery', (req, res) => {
    const post = require('../db').open().prepare('SELECT source_jid,source_msg_id FROM posts WHERE id=?').get(Number(req.params.id));
    if (!post) return res.status(404).json({ok:false,error:'Post not found.'});
    res.json({ok:true,items:require('../delivery-ledger').forSource(post.source_jid,post.source_msg_id)});
  });
  api.get('/qr', async (req, res) => {
    const st = wa.getStatus();
    if (!st.qr) return res.json({ ok: true, qr: null, status: st.status, detail: st.detail });
    try {
      const dataUrl = await require('qrcode').toDataURL(st.qr, { width: 300, margin: 1 });
      res.json({ ok: true, qr: dataUrl, status: st.status, detail: st.detail });
    } catch { res.json({ ok: true, qr: null, status: st.status, detail: st.detail }); }
  });
  api.post('/posts/edit', async (req, res) => {
    if (!pipeline.switches().editposts) return res.status(403).json({ ok: false, error: 'Turn ON the ✍️ Edit Posts switch in Channel Power first (it is experimental).' });
    try { const r = await publishMod.editPublished(String(req.body?.sourceJid || ''), String(req.body?.sourceMsgId || ''), String(req.body?.text || '')); res.json({ ok: true, ...r }); }
    catch (err) { res.status(400).json({ ok: false, error: err.message }); }
  });
  api.post('/posts/delete', async (req, res) => {
    if (!pipeline.switches().editposts) return res.status(403).json({ ok: false, error: 'Turn ON the ✍️ Edit Posts switch in Channel Power first.' });
    try {
      const items = (req.body?.items || []).slice(0, 300).map((i) => ({ target: String(i.target || ''), msgId: String(i.msgId || '') })).filter((i) => i.target && i.msgId);
      if (!items.length) return res.status(400).json({ ok: false, error: 'No posts selected.' });
      const r = await publishMod.deletePublished(items);
      AUD.log('owner', 'posts.delete', `Deleted ${r.done} published post copy(ies) on channels (${r.errors.length} failed)`);
      res.json({ ok: true, ...r, note: r.errors.length ? `${r.done} deleted, ${r.errors.length} failed.` : `${r.done} deleted.` });
    } catch (err) { res.status(400).json({ ok: false, error: err.message }); }
  });
  api.post('/posts/purge', async (req, res) => {
    if (!pipeline.switches().editposts) return res.status(403).json({ ok: false, error: 'Turn ON the ✍️ Edit Posts switch in Channel Power first.' });
    try {
      const { jid, from, to } = req.body || {};
      if (!String(jid || '').endsWith('@newsletter')) return res.status(400).json({ ok: false, error: 'A channel is required.' });
      const fromTs = Math.floor(Date.parse(`${from}T00:00:00+05:00`) / 1000);
      const toTs = Math.floor(Date.parse(`${to}T23:59:59+05:00`) / 1000);
      if (!Number.isFinite(fromTs) || !Number.isFinite(toTs)) return res.status(400).json({ ok: false, error: 'Dates like 2026-10-08 are required.' });
      const r = await publishMod.purgeByDate(jid, { ts: fromTs, iso: new Date(fromTs * 1000).toISOString().slice(0, 19).replace('T', ' ') }, { ts: toTs, iso: new Date(toTs * 1000).toISOString().slice(0, 19).replace('T', ' ') });
      AUD.log('owner', 'posts.purge', `Date-range purge on ${nameOrJid(jid)} (${from} → ${to}): ${r.done || 0} deleted${r.errors?.length ? `, ${r.errors.length} failed` : ''}`);
      res.json({ ok: true, ...r });
    } catch (err) { res.status(400).json({ ok: false, error: err.message }); }
  });

  /* ---- AI settings (v6.2: 20 providers + live test) ---- */
  api.get('/ai', (req, res) => res.json({ ok: true, ...ai.state(), controlOn: aicontrol.controlOn() }));   // v7.4.0
  api.post('/ai/control', (req, res) => { aicontrol.setControl(Boolean(req.body && req.body.on)); res.json({ ok: true, controlOn: aicontrol.controlOn() }); });   // v7.4.0
  api.post('/ai', (req, res) => {
    const { provider, key, model } = req.body || {};
    const known = ai.state().providers.map((p) => p.id);
    if (provider && !known.includes(String(provider).toLowerCase())) return res.status(400).json({ ok: false, error: 'Unknown provider.' });
    if (typeof req.body?.contentSharing === 'boolean') { S.set('privacy.ai.content', req.body.contentSharing ? '1' : '0'); AUD.log('owner','privacy.ai',`AI content sharing ${req.body.contentSharing ? 'enabled' : 'disabled'}`); }
    if (provider) ai.setProvider(String(provider).toLowerCase());
    if (key != null) {
      const kp = String(provider || ai.state().provider).toLowerCase();
      const nk = String(key).trim();
      if (nk) { ai.setKey(kp, nk); ai.clearPause(kp); }   // v7.3.3: a fresh key re-arms the AI immediately
    }
    if (model != null) ai.setModel(String(provider || ai.state().provider).toLowerCase(), String(model).trim());
    res.json({ ok: true, ...ai.state() });
  });
  api.post('/ai/test', async (req, res) => {
    try { res.json({ ok: true, ...(await ai.testConnection()) }); }
    catch (err) { res.status(400).json({ ok: false, error: err.message }); }
  });
  /* v7.1: model picker — the models of the SELECTED provider (live list when possible) */
  api.get('/ai/models', async (req, res) => {
    try {
      const provider = String(req.query.provider || ai.state().provider).toLowerCase();
      const refresh = String(req.query.refresh || '') === '1';
      res.json({ ok: true, ...(await ai.listModels(provider, { refresh })) });
    } catch (err) { res.status(400).json({ ok: false, error: err.message }); }
  });

  /* ---- global mirroring pause (v6.2 panic button) ---- */
  api.post('/mirror/pause', (req, res) => {
    const paused = Boolean(req.body?.paused);
    S.set('mirror.paused', paused ? '1' : '0');
    ring.warn('mirror.pause', paused
      ? '⏸ ALL mirroring PAUSED from the dashboard — no posts will be published until resumed (nothing is lost: posts are recovered on resume)'
      : '▶ Mirroring RESUMED — missed posts are being recovered automatically');
    res.json({ ok: true, paused });
  });

  /* ---- logs ---- */
  api.get('/logs', (req, res) => {
    const level = String(req.query.level || 'all');
    const limit = Math.min(300, parseInt(req.query.limit || '120', 10) || 120);
    const rows = require('../db').open().prepare(
      `SELECT rowid AS id, * FROM logs ${level !== 'all' ? 'WHERE level=?' : ''} ORDER BY rowid DESC LIMIT ?`
    ).all(...(level !== 'all' ? [level] : []), limit);
    res.json({ ok: true, list: rows.reverse() });
  });

  /* ---- v7.2: cloud memory status (login survival) ---- */
  api.get('/persist/status', (req, res) => res.json({ ok: true, ...require('../persist').publicStatus() }));
  api.get('/persist/test', async (req, res) => {
    try { res.json({ ok: true, ...(await require('../persist').diagnose()) }); }
    catch (err) { res.json({ ok: false, error: String(err.message || err).slice(0, 200) }); }
  });

  /* ---- v7: connected numbers (owner view) ---- */
  api.get('/numbers', (req, res) => res.json({ ok: true, list: numbers.list(), max: numbers.MAX_NUMBERS, features: inbox.features() }));
  api.post('/numbers', async (req, res) => {
    try { const r = await numbers.add(String(req.body?.label || '')); res.json({ ok: true, ...r }); }
    catch (err) { res.status(400).json({ ok: false, error: err.message }); }
  });
  api.delete('/numbers/:id', async (req, res) => {
    try { await numbers.remove(req.params.id); res.json({ ok: true }); }
    catch (err) { res.status(400).json({ ok: false, error: err.message }); }
  });
  api.post('/numbers/:id/relink', async (req, res) => {
    try { const r = await numbers.relink(req.params.id); res.json({ ok: true, ...r }); }
    catch (err) { res.status(400).json({ ok: false, error: err.message }); }
  });
  api.get('/numbers/:id/qr', async (req, res) => {
    const v = numbers.publicView(req.params.id);
    res.json({ ok: true, ...v, qr: v.status === 'qr' ? await numbers.qrDataUrl(req.params.id) : null });
  });

  /* ---- v7: chat features (anti-delete, anti-view-once, anti-edit, call guard) ---- */
  api.get('/features', (req, res) => res.json({ ok: true, ...inbox.features() }));
  api.post('/features', (req, res) => {
    const b = req.body || {};
    for (const k of ['antidelete', 'antiviewonce', 'antiedit', 'rejectcalls']) {
      if (b[k] != null) S.set(`feat.${k}`, b[k] ? '1' : '0');
    }
    res.json({ ok: true, ...inbox.features() });
  });

  /* ---- v7: contacts synced from each number's phone ---- */
  api.get('/contacts', (req, res) => {
    const session = String(req.query.session || 'main');
    const q = String(req.query.q || '').trim();
    const list = q ? CT.search(session, q, 300) : CT.list(session, 2000);
    res.json({ ok: true, list: list.map((c) => ({ jid: c.jid, name: inbox.cleanName(c.name || c.notify), notify: inbox.cleanName(c.notify) })), count: CT.count(session) });
  });

  /* ---- WhatsApp-parity inbox ---- */
  api.get('/inbox', (req, res) => res.json({ ok: true, list: inbox.chats(String(req.query.session || 'main')) }));
  /* 5F (R76): these specific sub-routes MUST be registered before /inbox/:jid —
     Express matches in registration order, so the wildcard would otherwise swallow them. */
  api.get('/inbox/labels', (req, res) => {
    const counts = CL.counts();
    res.json({ ok: true, list: CL.list().map((l) => ({ id: l.id, name: l.name, color: l.color, count: counts[l.id] || 0 })) });
  });
  api.get('/inbox/quick-replies', (req, res) => res.json({ ok: true, list: QR.list() }));
  api.get('/inbox/scheduled', (req, res) => {
    res.json({ ok: true, list: WAS.list(String(req.query.session || 'main')).map((r) => ({
      id: r.id, jid: r.jid, text: r.text, at: r.at, repeat: r.repeat,
      weekdays: r.weekdays, intervalMin: r.interval_min, enabled: !!r.enabled, sent: r.sent, lastSent: r.last_sent
    })) });
  });
  api.get('/inbox/:jid', (req, res) => res.json({ ok: true, list: inbox.messages(String(req.query.session || 'main'), decodeURIComponent(req.params.jid)) }));
  api.get('/inbox/:jid/media/:id', (req, res) => {
    const row = inbox.media(String(req.query.session || 'main'), Number(req.params.id));
    if (!row) return res.status(404).json({ ok: false, error: 'No stored media for this message (previews are stored when WhatsApp provides them; view-once files are stored by anti-view-once).' });
    /* v9.0.0 (repo-slim): file-backed media first (post-build rows) — the bytes
       live in media/inbox/, not in the cloud-synced database */
    const rel = String(row.media_file || '');
    if (rel) {
      const fp = path.join(cfg.config.paths.media, rel);
      if (fs.existsSync(fp)) {
        res.set('Content-Type', row.media_mime || 'application/octet-stream');
        res.set('Cache-Control', 'private, max-age=86400');
        return res.sendFile(fp);
      }
    }
    if (!row.media_data) return res.status(404).json({ ok: false, error: 'No stored media for this message (previews are stored when WhatsApp provides them; view-once files are stored by anti-view-once).' });
    res.set('Content-Type', row.media_mime || 'application/octet-stream');
    res.set('Cache-Control', 'private, max-age=86400');
    res.send(Buffer.from(row.media_data));
  });
  /* v7.3.6: profile photo for a chat / contact / group / channel
     (fetchProfilePictureUrl, or the channel's own picture) — 30-min cache */
  const avaMem = new Map();
  api.get('/inbox/:jid/avatar', async (req, res) => {
    try {
      const jid = decodeURIComponent(req.params.jid);
      const session = String(req.query.session || 'main');
      const key = session + '|' + jid;
      const hit = avaMem.get(key);
      if (hit && Date.now() - hit.at < 30 * 60000 && fs.existsSync(path.join(AVA_DIR, hit.file))) {
        return res.redirect('/media/avatars/' + hit.file);
      }
      const sock = numbers.getSocket(session);
      let url = '';
      if (jid.endsWith('@newsletter')) {
        if (sock?.newsletterMetadata) {
          try {
            const meta = await sock.newsletterMetadata('jid', jid);
            const pic = String(meta?.picture || '');
            if (pic) url = pic.startsWith('http') ? pic : 'https://mmg.whatsapp.net/' + pic.replace(/^\/+/, '');
          } catch { }
        }
      } else if (sock?.fetchProfilePictureUrl) {
        try { const r = await sock.fetchProfilePictureUrl(jid); url = String(r?.profilePicUrl || ''); } catch { }
      }
      if (!url) return res.json({ ok: false, url: '' });
      const file = crypto.createHash('sha1').update(url).digest('hex').slice(0, 24) + '.jpg';
      const fp = path.join(AVA_DIR, file);
      if (!fs.existsSync(fp)) {
        const r = await fetch(url, { signal: AbortSignal.timeout(15000) });
        if (!r.ok) return res.json({ ok: false, url: '' });
        fs.writeFileSync(fp, Buffer.from(await r.arrayBuffer()));
      }
      avaMem.set(key, { file, at: Date.now(), url });
      res.redirect('/media/avatars/' + file);
    } catch {
      res.json({ ok: false, url: '' });
    }
  });
  api.post('/inbox/:jid/open', (req, res) => {
    const session = String(req.query.session || 'main');
    inbox.ensureChat(session, decodeURIComponent(req.params.jid), String(req.body?.name || ''));
    res.json({ ok: true });
  });
  api.get('/watched', (req, res) => {
    const list = inbox.watched.list().map((w) => ({ ...w, last: inbox.watched.lastActivity(w.phone) }));
    res.json({ ok: true, list });
  });
  api.post('/watched', (req, res) => {
    try { inbox.watched.add(String(req.body?.phone || ''), String(req.body?.name || '')); res.json({ ok: true }); }
    catch (err) { res.status(400).json({ ok: false, error: err.message }); }
  });
  api.delete('/watched/:phone', (req, res) => { inbox.watched.remove(req.params.phone); res.json({ ok: true }); });
  api.post('/bulk', async (req, res) => {
    try { const r = await inbox.bulkSend(req.body?.recipients, req.body?.text); res.json({ ok: true, ...r }); }
    catch (err) { res.status(400).json({ ok: false, error: err.message }); }
  });
  api.get('/bulk/history', (req, res) => res.json({ ok: true, list: BULKH.list(20) }));
  api.get('/uptime', (req, res) => res.json({ ok: true, ...inbox.uptime.stats() }));

  /* ---- v6.1: send a message from the WhatsApp tab (chat mirror → read/write) ---- */
  api.post('/inbox/:jid/history', async (req, res) => {
    try {
      const result = await inbox.requestHistory(String(req.query.session || 'main'), decodeURIComponent(req.params.jid), req.body?.count);
      res.json({ ok: true, result });
    } catch (err) { res.status(400).json({ ok: false, error: String(err.message || err).slice(0, 200) }); }
  });
  api.post('/inbox/:jid/read', (req, res) => { inbox.markRead(String(req.query.session || 'main'), decodeURIComponent(req.params.jid)); res.json({ ok: true }); });
  api.post('/inbox/:jid/send', async (req, res) => {
    try {
      const session = String(req.query.session || 'main');
      const jid = decodeURIComponent(req.params.jid);
      const text = String(req.body?.text || '').trim();
      if (!text) return res.status(400).json({ ok: false, error: 'Type a message first.' });
      if (!/@(s\.whatsapp\.net|g\.us)$/.test(jid)) return res.status(400).json({ ok: false, error: 'Not a personal chat or group.' });
      if (numbers.statusOf(session) !== 'open') throw new Error(session === 'main' ? 'WhatsApp is not connected.' : `Number ${session} is not connected — open Connect (＋) and scan its QR.`);
      const sock = numbers.getSocket(session);
      if (!sock) throw new Error('That number has no live socket right now.');
      await sock.sendMessage(jid, { text: text.slice(0, 4096) }); // {text} — the v5 lesson
      ring.info('wa.reply.sent', `Message sent from the dashboard (${session}) to ${jid}`);
      res.json({ ok: true });
    } catch (err) { res.status(400).json({ ok: false, error: err.message }); }
  });

  /* ---- 5F (R76): chat labels (GET /inbox/labels is registered above, before /inbox/:jid) ---- */
  api.post('/inbox/labels', (req, res) => {
    const name = String(req.body?.name || '').trim();
    if (!name) return res.status(400).json({ ok: false, error: 'Label name is required.' });
    const id = CL.add(name, req.body?.color);
    try { AUD.log('owner', 'label.add', `Chat label created: ${name}`); } catch { }
    res.json({ ok: true, id });
  });
  api.post('/inbox/labels/:id/delete', (req, res) => {
    CL.del(Number(req.params.id));
    res.json({ ok: true });
  });
  api.get('/inbox/:jid/labels', (req, res) => {
    res.json({ ok: true, list: CL.forChat(String(req.query.session || 'main'), decodeURIComponent(req.params.jid)) });
  });
  api.post('/inbox/:jid/labels', (req, res) => {
    const session = String(req.query.session || 'main');
    const jid = decodeURIComponent(req.params.jid);
    const on = Boolean(req.body?.on);
    CL.setForChat(session, jid, Number(req.body?.labelId), on);
    res.json({ ok: true });
  });

  /* ---- 5F (R76): pin a chat (mirror list order) ---- */
  api.post('/inbox/:jid/pin', (req, res) => {
    try {
      const session = String(req.query.session || 'main');
      const jid = decodeURIComponent(req.params.jid);
      const d = require('../db').open();
      const cur = d.prepare('SELECT pinned FROM inbox_chats WHERE session=? AND jid=?').get(session, jid);
      const next = !(cur && cur.pinned);
      d.prepare('UPDATE inbox_chats SET pinned=? WHERE session=? AND jid=?').run(next ? 1 : 0, session, jid);
      res.json({ ok: true, pinned: next });
    } catch (err) { res.status(400).json({ ok: false, error: err.message }); }
  });

  /* ---- 5F (R76): quick replies (GET registered above, before /inbox/:jid) ---- */
  api.post('/inbox/quick-replies', (req, res) => {
    const id = QR.add(String(req.body?.text || ''));
    if (!id) return res.status(400).json({ ok: false, error: 'Reply text is required (max 500 chars).' });
    res.json({ ok: true, id });
  });
  api.post('/inbox/quick-replies/:id/delete', (req, res) => { QR.del(Number(req.params.id)); res.json({ ok: true }); });

  /* ---- 5F (R76): scheduled personal WhatsApp sends (GET registered above, before /inbox/:jid) ---- */
  api.post('/inbox/scheduled', async (req, res) => {
    try {
      const row = wasched.add({
        session: String(req.body?.session || 'main'), jid: String(req.body?.jid || ''),
        text: String(req.body?.text || ''), localAt: String(req.body?.localAt || ''),
        repeat: String(req.body?.repeat || 'once'), weekdays: String(req.body?.weekdays || ''),
        intervalMin: req.body?.intervalMin
      });
      res.json({ ok: true, row });
    } catch (err) { res.status(400).json({ ok: false, error: err.message }); }
  });
  api.post('/inbox/scheduled/:id/enable', (req, res) => { WAS.setEnabled(Number(req.params.id), Boolean(req.body?.on)); res.json({ ok: true }); });
  api.post('/inbox/scheduled/:id/delete', (req, res) => { WAS.del(Number(req.params.id)); res.json({ ok: true }); });

  /* ---- 5F (R76): chat export (CSV / plain text) ---- */
  api.get('/inbox/:jid/export', (req, res) => {
    try {
      const session = String(req.query.session || 'main');
      const jid = decodeURIComponent(req.params.jid);
      const rows = require('../db').open().prepare('SELECT ts, from_me, sender_name, body, kind FROM inbox_msgs WHERE session=? AND chat_jid=? ORDER BY id ASC').all(session, jid);
      const fmt = String(req.query.format || 'txt');
      let out;
      if (fmt === 'csv') {
        const cell = (v) => { const s = String(v == null ? '' : v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
        out = ['date,time,from,who,text,kind', ...rows.map((r) => [r.ts.slice(0, 10), r.ts.slice(11, 16), r.from_me ? 'me' : 'them', r.sender_name || '', (r.body || '').slice(0, 1000), r.kind || ''].map(cell).join(','))].join('\n');
      } else {
        out = rows.map((r) => `[${r.ts}] ${r.from_me ? 'Me' : (r.sender_name || 'Them')}: ${(r.body || `[${r.kind || 'media'}]` || '').slice(0, 1000)}`).join('\n');
      }
      const base = (jid.split('@')[0] || 'chat').replace(/[^a-z0-9_-]/gi, '');
      res.setHeader('Content-Type', fmt === 'csv' ? 'text/csv; charset=utf-8' : 'text/plain; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="raqifluz-chat-${base}.${fmt === 'csv' ? 'csv' : 'txt'}"`);
      res.send(out);
    } catch (err) { res.status(400).json({ ok: false, error: err.message }); }
  });

  /* ---- 5F (R76): media gallery (everything with media in this chat) ---- */
  api.get('/inbox/:jid/media-gallery', (req, res) => {
    try {
      const session = String(req.query.session || 'main');
      const jid = decodeURIComponent(req.params.jid);
      const rows = require('../db').open().prepare("SELECT id, ts, kind, media_mime, media_name, LENGTH(media_data) bytes FROM inbox_msgs WHERE session=? AND chat_jid=? AND media_data IS NOT NULL ORDER BY id DESC LIMIT 200").all(session, jid);
      res.json({ ok: true, list: rows.map((r) => ({ id: r.id, ts: r.ts, kind: r.kind || 'image', mime: r.media_mime || '', name: r.media_name || '', bytes: r.bytes || 0 })) });
    } catch (err) { res.status(400).json({ ok: false, error: err.message }); }
  });

  /* ---- 5F (R77): contacts — notes, tags, timeline, CSV, duplicate helper ---- */
  /* /contacts/dupes MUST come before /contacts/:jid (registration order) */
  api.get('/contacts/dupes', (req, res) => {
    try {
      const session = String(req.query.session || 'main');
      const list = CT.list(session, 5000);
      const normName = (n) => String(n || '').toLowerCase().replace(/[^a-z0-9\u0600-\u06FF]/g, ' ').replace(/\s+/g, ' ').trim();
      const byName = {};
      for (const c of list) {
        const n = normName(inbox.cleanName(c.name || c.notify));
        if (!n || n.length < 3) continue;
        (byName[n] = byName[n] || []).push({ jid: c.jid, name: inbox.cleanName(c.name || c.notify), phone: String(c.jid || '').split('@')[0] });
      }
      const byPhone = {};
      for (const c of list) {
        const p = String(c.jid || '').split('@')[0].replace(/\D/g, '');
        if (p.length < 8) continue;
        (byPhone[p] = byPhone[p] || []).push({ jid: c.jid, name: inbox.cleanName(c.name || c.notify), phone: p });
      }
      const groups = (m) => Object.values(m).filter((g) => g.length > 1).slice(0, 50);
      res.json({ ok: true, byName: groups(byName), byPhone: groups(byPhone) });
    } catch (err) { res.status(400).json({ ok: false, error: err.message }); }
  });
  api.get('/contacts/:jid', (req, res) => {
    const session = String(req.query.session || 'main');
    const jid = decodeURIComponent(req.params.jid);
    const note = CN.get(session, jid);
    res.json({
      ok: true, jid,
      name: inbox.cleanName(CT.one(session, jid)?.name || ''),
      note: note.note, noteUpdatedAt: note.updated_at,
      tags: CN.forContact(session, jid),
      timeline: CN.timeline(session, jid, 50)
    });
  });
  api.post('/contacts/:jid/note', (req, res) => {
    const session = String(req.query.session || 'main');
    const jid = decodeURIComponent(req.params.jid);
    CN.set(session, jid, String(req.body?.note || ''));
    if (String(req.body?.note || '').trim()) CN.event(session, jid, 'note', 'Note updated — ' + String(req.body.note).trim().slice(0, 120));
    res.json({ ok: true });
  });
  api.post('/contacts/tags', (req, res) => {
    const id = CN.addTag(String(req.body?.name || ''));
    res.json({ ok: true, id });
  });
  api.post('/contacts/:jid/tags', (req, res) => {
    const session = String(req.query.session || 'main');
    const jid = decodeURIComponent(req.params.jid);
    CN.setForContact(session, jid, Number(req.body?.tagId), Boolean(req.body?.on));
    res.json({ ok: true });
  });
  api.get('/contacts.csv', (req, res) => {
    try {
      const session = String(req.query.session || 'main');
      const list = CT.list(session, 5000);
      const cell = (v) => { const s = String(v == null ? '' : v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
      const rows = ['phone,name,note,tags', ...list.map((c) => {
        const phone = String(c.jid || '').split('@')[0];
        const tags = CN.forContact(session, c.jid).map((t) => t.name).join('; ');
        const note = CN.get(session, c.jid).note;
        return [phone, inbox.cleanName(c.name || c.notify), note, tags].map(cell).join(',');
      })].join('\n');
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="raqifluz-contacts.csv"');
      res.send(rows);
    } catch (err) { res.status(400).json({ ok: false, error: err.message }); }
  });
  /* ---- 5F (R78): broadcast lists + history ---- */
  api.get('/broadcast', (req, res) => {
    res.json({ ok: true, lists: BCL.list().map((l) => ({ id: l.id, name: l.name, recipients: l.recipients, count: BCL.countRecipients(l.recipients), updated_at: l.updated_at })), history: BULKH.list(20) });
  });
  api.post('/broadcast', (req, res) => {
    const name = String(req.body?.name || '').trim();
    const recipients = String(req.body?.recipients || '');
    if (!name) return res.status(400).json({ ok: false, error: 'List name is required.' });
    let id = req.body?.id ? Number(req.body.id) : null;
    if (id && BCL.get(id)) { BCL.update(id, name, recipients); }
    else { id = BCL.add(name, recipients); }
    try { AUD.log('owner', 'broadcast.list', `Broadcast list ${id ? 'updated' : 'created'}: ${name} (${BCL.countRecipients(recipients)} recipients)`); } catch { }
    res.json({ ok: true, id });
  });
  api.post('/broadcast/:id/delete', (req, res) => { BCL.del(Number(req.params.id)); res.json({ ok: true }); });
  api.post('/broadcast/:id/send', async (req, res) => {
    try {
      const list = BCL.get(Number(req.params.id));
      if (!list) return res.status(400).json({ ok: false, error: 'List not found.' });
      const text = String(req.body?.text || '').trim();
      if (!text) return res.status(400).json({ ok: false, error: 'Message text is required.' });
      const result = await inbox.bulkSend(list.recipients, text, { skipRecord: true, listId: list.id, listName: list.name });
      res.json({ ok: true, sent: result.sent || 0, total: result.total || 0, results: (result.results || []).slice(0, 200) });
    } catch (err) { res.status(400).json({ ok: false, error: err.message }); }
  });

  /* ---- 5F (R79): per-target rate caps ---- */
  api.get('/guardrates', (req, res) => {
    const global = Math.max(3, parseInt(S.get('guard.maxperhour', '30'), 10) || 30);
    const targets = CH.listTargets().map((t) => ({
      jid: t.jid, name: t.name,
      max: parseInt(S.get('guard.maxperhour.' + t.jid, '0'), 10) || 0,
      lastHour: CH.pubCountLastHour(t.jid)
    }));
    res.json({ ok: true, global, targets });
  });
  api.post('/guardrates', (req, res) => {
    const map = req.body?.targets || {};
    for (const t of CH.listTargets()) {
      const n = parseInt(map[t.jid], 10);
      if (Number.isFinite(n) && n >= 1) S.set('guard.maxperhour.' + t.jid, String(Math.min(500, n)));
      else S.set('guard.maxperhour.' + t.jid, '0'); // 0 = follow the global guard
    }
    try { AUD.log('owner', 'guardrates.update', 'Per-target rate caps updated (' + Object.keys(map).length + ' target(s))'); } catch { }
    res.json({ ok: true });
  });

  /* ---- 5G (R80): outgoing webhooks (OFF by default — no rows, no sends) ---- */
  api.get('/webhooks', (req, res) => res.json({ ok: true, list: webhooks.list(), events: webhooks.EVENTS }));
  api.post('/webhooks', (req, res) => {
    try { const id = webhooks.add(req.body || {}); res.json({ ok: true, id }); }
    catch (err) { res.status(400).json({ ok: false, error: err.message }); }
  });
  api.post('/webhooks/:id/enable', (req, res) => { webhooks.setEnabled(Number(req.params.id), Boolean(req.body?.on)); res.json({ ok: true }); });
  api.post('/webhooks/:id/delete', (req, res) => { webhooks.del(Number(req.params.id)); res.json({ ok: true }); });
  api.post('/webhooks/:id/test', async (req, res) => {
    const r = await webhooks.testHook(Number(req.params.id));
    res.json(r.error ? { ok: false, error: r.error } : { ok: true, result: r });
  });

  /* ---- 5G (R82): RSS/Atom source type (15-min fetch → the same pipeline) ---- */
  api.get('/rss/test', async (req, res) => {
    const url = String(req.query.url || '').trim();
    if (!url) return res.status(400).json({ ok: false, error: 'Paste the feed URL first.' });
    try { res.json({ ok: true, ...(await rss.testFeed(url)) }); }
    catch (err) { res.status(400).json({ ok: false, error: String(err.message || err).slice(0, 160) }); }
  });
  api.post('/sources/rss', (req, res) => {
    try {
      const url = String(req.body?.url || '').trim();
      const name = String(req.body?.name || '').trim();
      let parsed;
      try { parsed = new URL(url); } catch { return res.status(400).json({ ok: false, error: 'Enter a full feed URL, starting with https://' }); }
      if (!/^https?:$/.test(parsed.protocol)) return res.status(400).json({ ok: false, error: 'Only http(s) feed URLs are allowed.' });
      const jid = rss.rssJid(url);
      const d = require('../db').open();
      const ex = d.prepare('SELECT * FROM sources WHERE jid=?').get(jid);
      if (ex) return res.status(400).json({ ok: false, error: 'That feed is already added (“' + ex.name + '”).' });
      if (!name) return res.status(400).json({ ok: false, error: 'Name the feed (that is what posts will be credited with).' });
      const r = CH.addSource(jid, name.slice(0, 80), req.body?.by || 'owner');
      d.prepare('UPDATE sources SET kind=?, url=?, targets=? WHERE jid=?').run('rss', parsed.href, String(req.body?.targets || '').slice(0, 2000), jid);
      try { AUD.log('owner', 'source.rss-added', `RSS source added: ${name} (${parsed.href}) — fetches every 15 minutes`); } catch { }
      res.json({ ok: r.ok, jid, name });
    } catch (err) { res.status(400).json({ ok: false, error: err.message }); }
  });

  /* ---- 5H (R85): WA command channel — PIN + catalog (switch lives in /api/power) ---- */
  const wacommand = require('../wacommand');
  api.get('/wacommand', (req, res) => res.json({ ok: true, on: pipeline.switches().waCommand, pinSet: wacommand.pinSet(), ownJid: wacommand.ownJid(), commands: wacommand.COMMANDS }));
  api.post('/wacommand', (req, res) => {
    const pin = String(req.body?.pin ?? '').trim();
    if (pin && !/^\d{4,8}$/.test(pin)) return res.status(400).json({ ok: false, error: 'The PIN must be 4–8 digits.' });
    S.set('waCommand.pin', pin);
    try { AUD.log('owner', 'wacommand.pin', pin ? 'WA command PIN updated' : 'WA command PIN cleared'); } catch { }
    res.json({ ok: true, pinSet: Boolean(pin) });
  });

  /* ---- 5H (R86): evergreen recycling — settings + log (switch lives in /api/power) ---- */
  const evergreen = require('../evergreen');
  api.get('/evergreen', (req, res) => res.json({ ok: true, ...evergreen.view() }));
  api.post('/evergreen', (req, res) => {
    const b = req.body || {};
    const quota = Math.max(0, Math.min(10, parseInt(b.quota, 10) || 0));
    const minAge = Math.max(0, Math.min(90, parseInt(b.minAge, 10) || 0));
    S.set('evergreen.quota', String(quota));
    S.set('evergreen.minage', String(minAge));
    res.json({ ok: true, quota, minAgeDays: minAge });
  });

  /* ---- 5H (R87): auto-pilot — cap + log (switch lives in /api/power) ---- */
  const autopilot = require('../autopilot');
  api.get('/autopilot', (req, res) => res.json({ ok: true, ...autopilot.view() }));
  api.post('/autopilot', (req, res) => {
    const maxDay = Math.max(1, Math.min(100, parseInt(req.body?.maxDay, 10) || 10));
    S.set('autopilot.maxday', String(maxDay));
    res.json({ ok: true, maxDay });
  });

  /* ---- 5H (R88): “Plan my week” → drafts in the Approval Queue ---- */
  api.post('/plan-week', async (req, res) => {
    try {
      const ai = require('../ai');
      const q5 = require('../queue5a');
      if (!ai.state().hasKey) throw new Error('Add an AI key first (Settings → AI provider). The OpenRouter free model works with a $0 balance.');
      const d = require('../db').open();
      const recent = d.prepare("SELECT body FROM posts WHERE status='published' AND length(body) >= 20 ORDER BY id DESC LIMIT 8").all().map((r) => String(r.body).slice(0, 200));
      const targets = require('../db').CH.listActiveTargets();
      if (!targets.length) throw new Error('Add at least one target channel first.');
      const context = recent.length ? 'Recent posts I already published:\n' + recent.join('\n---\n') : 'I have no recent posts yet.';
      const prompt = `You run a WhatsApp channel. Plan the next 7 days of posts for me. ${context}\n\nReply with EXACTLY 7 lines, no other text. Each line must be: D1|the full post text   (D1 = tomorrow, D7 = six days after). Posts should be 1–3 short WhatsApp lines, varied (news, tip, question to followers, announcement), in the same language as my recent posts.`;
      const out = String(await ai.chat(prompt));
      const lines = out.split('\n').map((l) => l.trim()).filter(Boolean);
      const items = [];
      for (const l of lines) {
        const m = l.match(/^D?\s?([1-7])\s*[|:–-]\s*(.+)$/i);
        if (m && !items.some((x) => x.day === Number(m[1]))) items.push({ day: Number(m[1]), text: String(m[2]).slice(0, 2000) });
      }
      items.sort((a, b) => a.day - b.day);
      if (items.length < 3) throw new Error('The AI did not return a usable plan — try again (it happens; the model must answer 7 “D1|…” lines).');
      const at = Date.now();
      for (const it of items.slice(0, 7)) {
        q5.enqueue({ sourceJid: 'plan@bot', sourceMsgId: `plan-${at}-${it.day}`, text: it.text, msgTs: Math.floor(at / 1000), targetJids: targets.map((t) => t.jid), requireApproval: true });
      }
      try { require('../db').AICHAT.add('assistant', `Planned a 7-day week — ${items.length} drafts are in the Approval Queue for your review.`); } catch { }
      try { AUD.log('owner', 'plan.week', `“Plan my week” created ${items.length} Approval Queue drafts`); } catch { }
      res.json({ ok: true, planned: items.length, items: items.map((x) => ({ day: x.day, text: x.text.slice(0, 200) })) });
    } catch (err) { res.status(400).json({ ok: false, error: String(err.message || err).slice(0, 200) }); }
  });

  /* ---- 5I (I1): subscriber counts + growth history (best-effort daily snapshots) ---- */
  api.get('/subs', (req, res) => {
    try {
      const d = require('../db').open();
      const rows = CH.listActiveSources().filter((s) => !s.kind || s.kind === 'wa').map((s) => ({
        jid: s.jid, name: s.name || s.jid,
        subs: SUBS.lastFor(s.jid)?.count ?? null,
        subsDay: SUBS.lastFor(s.jid)?.day ?? null,
        history: SUBS.history(s.jid, 14)
      }));
      res.json({ ok: true, list: rows });
    } catch (err) { res.status(400).json({ ok: false, error: err.message }); }
  });

  /* ---- 5I (I6): local hashtag frequency — top #words in your own published posts ---- */
  api.get('/hashtags/freq', (req, res) => {
    try {
      const days = Math.max(1, Math.min(365, parseInt(req.query.days, 10) || 30));
      const rows = require('../db').open().prepare(
        `SELECT body FROM posts WHERE status IN ('published','edited') AND body != '' AND created_at >= datetime('now', ?)`
      ).all('-' + days + ' days');
      const counts = new Map();
      for (const r of rows) {
        for (const m of String(r.body).matchAll(/#[A-Za-z0-9_]{2,30}/g)) {
          const tag = m[0].toLowerCase();
          const c = counts.get(tag) || { tag, n: 0, last: '' };
          c.n += 1;
          counts.set(tag, c);
        }
      }
      const list = [...counts.values()].sort((a, b) => b.n - a.n).slice(0, 25).map((c) => ({ tag: c.tag, n: c.n }));
      res.json({ ok: true, days, posts: rows.length, list });
    } catch (err) { res.status(400).json({ ok: false, error: err.message }); }
  });

  /* ---- 5I (I10): resend a published post — rate guard checked BEFORE anything is sent ---- */
  api.post('/posts/resend', async (req, res) => {
    try {
      const row = require('../db').open().prepare('SELECT * FROM posts WHERE id=?').get(Number(req.body?.id));
      if (!row) return res.status(400).json({ ok: false, error: 'Post not found.' });
      if (!row.body) return res.status(400).json({ ok: false, error: 'No text is stored for that post.' });
      const guard = queue5a.checkResendGuard(row);
      if (!guard.ok) return res.status(409).json(guard);
      const r = await queue5a.republishOne(row.id);
      try { AUD.log('owner', 'post.resend', `Post ${row.id} resent to ${r.sent} target(s) (rate guard passed)`); } catch { }
      res.json({ ok: true, ...r });
    } catch (err) { res.status(400).json({ ok: false, error: String(err.message || err).slice(0, 300) }); }
  });

  /* ---- 5I (I4): announcement card — PNG + SVG from a post (tool, never auto-attached) ---- */
  const cardgen = require('../cardgen');
  api.post('/card', (req, res) => {
    try {
      const d = req.body || {};
      const out = cardgen.cardForPost({
        title: String(d.title || '').slice(0, 200),
        body: String(d.body || '').slice(0, 1500),
        source: String(d.source || '').slice(0, 80),
        date: String(d.date || new Date().toISOString().slice(0, 10)).slice(0, 30),
        footer: String(d.footer || '').slice(0, 80)
      });
      const name = 'card-' + Date.now();
      res.setHeader('Content-Disposition', 'attachment; filename="' + name + '.png"');
      res.setHeader('X-Card-SVG', '1');
      try { AUD.log('owner', 'card.make', `Announcement card rendered (PNG ${(out.png.length / 1024).toFixed(0)} KB, SVG ${out.svg.length} B)`); } catch { }
      res.setHeader('Content-Type', 'image/png');
      res.send(out.png);
    } catch (err) { res.status(400).json({ ok: false, error: err.message }); }
  });
  api.get('/card/:postId', (req, res) => {
    try {
      const d = require('../db').open().prepare('SELECT * FROM posts WHERE id=?').get(Number(req.params.postId));
      if (!d) return res.status(404).json({ ok: false, error: 'Post not found.' });
      const srcName = CH.listSources().find((s) => s.jid === d.source_jid)?.name || CH.dirList().find((x) => x.jid === d.source_jid)?.name || '';
      const out = cardgen.cardForPost({
        title: String(d.body || '').slice(0, 120),
        body: String(d.body || '').slice(0, 1500),
        source: String(srcName),
        date: String((d.created_at || '').slice(0, 10)),
        footer: String(S.get('power.signature.text', '')).split('\n')[0].replace(/[*_~#]/g, '').trim() || 'My Channel'
      });
      res.setHeader('Content-Disposition', 'attachment; filename="card-' + d.id + '.png"');
      res.setHeader('Content-Type', 'image/png');
      res.send(out.png);
    } catch (err) { res.status(400).json({ ok: false, error: err.message }); }
  });
  api.get('/card-svg', (req, res) => {
    try {
      const d = req.query || {};
      const svg = cardgen.cardSVG({
        title: String(d.title || '').slice(0, 200),
        body: String(d.body || '').slice(0, 1500),
        source: String(d.source || '').slice(0, 80),
        date: String(d.date || new Date().toISOString().slice(0, 10)).slice(0, 30),
        footer: String(d.footer || '').slice(0, 80) || 'My Channel'
      });
      res.setHeader('Content-Disposition', 'attachment; filename="card.svg"');
      res.setHeader('Content-Type', 'image/svg+xml');
      res.send(svg);
    } catch (err) { res.status(400).json({ ok: false, error: err.message }); }
  });

  /* ---- 5I (I9): row-level undo (only when this post is the latest on the target) ---- */
  api.post('/posts/undo-row', async (req, res) => {
    try {
      const r = await queue5a.undoPostOn(req.body?.id, req.body?.target);
      res.json({ ok: true, ...r });
    } catch (err) { res.status(409).json({ ok: false, error: String(err.message || err).slice(0, 300) }); }
  });

  /* ---- 5I (I2): media library — unified view over chat media (DB BLOBs) + queued media (files) ---- */
  const fs5i = require('fs');
  const path5i = require('path');
  const HOLD_DIR_5I = path5i.join(path5i.dirname(cfg.config.paths.database), 'media-hold');
  api.get('/media-lib', (req, res) => {
    try {
      const d = require('../db').open();
      const session = String(req.query.session || 'main');
      const kind = String(req.query.kind || '');
      const q = String(req.query.q || '').trim().toLowerCase();
      const limit = Math.max(1, Math.min(400, parseInt(req.query.limit, 10) || 200));
      const rows = [];
      for (const r of d.prepare(
        `SELECT id, session, chat_jid, ts, kind, media_mime, media_name, LENGTH(media_data) bytes
           FROM inbox_msgs WHERE session=? AND media_data IS NOT NULL ORDER BY id DESC LIMIT 1000`
      ).all(session)) {
        if (kind && r.kind !== kind) continue;
        if (q && !((r.media_name || '') + ' ' + (r.chat_jid || '')).toLowerCase().includes(q)) continue;
        rows.push({ src: 'chat', ref: 'inbox:' + r.id, jid: r.chat_jid, ts: r.ts, kind: r.kind || 'image', mime: r.media_mime || '', name: r.media_name || ('msg-' + r.id), bytes: r.bytes || 0 });
      }
      try {
        if (fs5i.existsSync(HOLD_DIR_5I)) {
          for (const f of fs5i.readdirSync(HOLD_DIR_5I)) {
            const st = fs5i.statSync(path5i.join(HOLD_DIR_5I, f));
            const k = f.endsWith('.mp4') ? 'video' : f.endsWith('.bin') ? 'document' : 'image';
            if (kind && k !== kind) continue;
            if (q && !f.toLowerCase().includes(q)) continue;
            rows.push({ src: 'hold', ref: 'hold:' + f, jid: '', ts: new Date(st.mtimeMs).toISOString().slice(0, 19).replace('T', ' '), kind: k, mime: '', name: f.replace(/\.[^.]+$/, ''), bytes: st.size });
          }
        }
      } catch { /* hold dir is optional */ }
      rows.sort((a, b) => String(b.ts).localeCompare(String(a.ts)));
      res.json({ ok: true, list: rows.slice(0, limit), total: rows.length });
    } catch (err) { res.status(400).json({ ok: false, error: err.message }); }
  });
  api.get('/media-lib/download', (req, res) => {
    try {
      const ref = String(req.query.ref || '');
      if (ref.startsWith('inbox:')) {
        const r = require('../db').open().prepare('SELECT media_data, media_mime, media_name, kind FROM inbox_msgs WHERE id=?').get(Number(ref.slice(6)));
        if (!r || !r.media_data) return res.status(404).json({ ok: false, error: 'Media not found.' });
        const name = r.media_name || ('file-' + ref.slice(6) + '.' + (r.kind === 'video' ? 'mp4' : r.kind === 'document' ? 'bin' : 'jpg'));
        res.setHeader('Content-Type', r.media_mime || 'application/octet-stream');
        res.setHeader('Content-Disposition', 'attachment; filename="' + String(name).replace(/"/g, '') + '"');
        res.send(Buffer.from(r.media_data));
      } else if (ref.startsWith('hold:')) {
        const f = path5i.basename(ref.slice(5)); // never trust the rest of the path
        const p = path5i.join(HOLD_DIR_5I, f);
        if (!fs5i.existsSync(p)) return res.status(404).json({ ok: false, error: 'File not found.' });
        res.download(p);
      } else return res.status(400).json({ ok: false, error: 'Bad reference.' });
    } catch (err) { res.status(400).json({ ok: false, error: err.message }); }
  });
  api.post('/media-lib/delete', (req, res) => {
    try {
      const ref = String(req.body?.ref || '');
      if (ref.startsWith('inbox:')) {
        const n = require('../db').open().prepare('UPDATE inbox_msgs SET media_data=NULL, media_mime=NULL, media_name=NULL WHERE id=?').run(Number(ref.slice(6)));
        if (!n.changes) return res.status(404).json({ ok: false, error: 'Media not found.' });
        try { AUD.log('owner', 'media.delete', `Chat media removed from storage (msg ${ref.slice(6)})`); } catch { }
        return res.json({ ok: true });
      }
      if (ref.startsWith('hold:')) {
        const f = path5i.basename(ref.slice(5));
        const p = path5i.join(HOLD_DIR_5I, f);
        if (!fs5i.existsSync(p)) return res.status(404).json({ ok: false, error: 'File not found.' });
        fs5i.unlinkSync(p);
        try { AUD.log('owner', 'media.delete', `Queued media file removed: ${f}`); } catch { }
        return res.json({ ok: true });
      }
      return res.status(400).json({ ok: false, error: 'Bad reference.' });
    } catch (err) { res.status(400).json({ ok: false, error: err.message }); }
  });

  /* ---- 5I (I7): freshness guard setting (0 = OFF = no change in behavior) ---- */
  api.get('/freshness', (req, res) => res.json({ ok: true, hours: Math.max(0, Math.min(720, parseInt(S.get('freshness.hours', '0'), 10) || 0)) }));
  api.post('/freshness', (req, res) => {
    const n = parseInt(req.body?.hours, 10);
    if (!Number.isFinite(n) || n < 0) return res.status(400).json({ ok: false, error: 'Hours must be 0 (off) or more.' });
    S.set('freshness.hours', String(Math.min(720, n)));
    try { AUD.log('owner', 'freshness.set', `Freshness guard set to ${n === 0 ? 'OFF' : n + 'h'}`); } catch { }
    res.json({ ok: true, hours: Math.min(720, n) });
  });

  /* ---- 5J (J1): Pipeline Inspector — dry-run a text through every stage ---- */
  const pipelineMod = require('../pipeline');
  api.post('/pipeline/inspect', (req, res) => {
    try {
      const text = String(req.body?.text || '');
      if (!text.trim()) return res.status(400).json({ ok: false, error: 'Paste the post text to inspect.' });
      const out = pipelineMod.inspectText(text, { sourceJid: String(req.body?.source || ''), hasMedia: Boolean(req.body?.hasMedia) });
      try { AUD.log('owner', 'pipeline.inspect', `Pipeline dry-run: ${out.stages.length} stages, ${out.gates.filter((g) => g.fired).length} gate(s) would fire, ${out.partCount} part(s)`); } catch { }
      res.json({ ok: true, ...out, counters: pipelineMod.counters() });
    } catch (err) { res.status(400).json({ ok: false, error: err.message }); }
  });
  api.get('/pipeline/counters', (req, res) => res.json({ ok: true, ...pipelineMod.counters() }));

  /* ---- 5J (J4): Branding Studio — saved brand colors drive every card ---- */
  const cardgenMod = require('../cardgen');
  api.get('/brand', (req, res) => res.json({ ok: true, brand: cardgenMod.brandColors(), presets: cardgenMod.BRAND_PRESETS, defaults: cardgenMod.BRAND_DEFAULTS }));
  api.post('/brand', (req, res) => {
    try {
      const b = cardgenMod.normalizeBrand(req.body || {});
      for (const k of Object.keys(b)) S.set(`brand.${k}`, b[k]);
      try { AUD.log('owner', 'brand.save', `Branding saved — accent ${b.accent}, bg ${b.bg}`); } catch { }
      res.json({ ok: true, brand: b });
    } catch (err) { res.status(400).json({ ok: false, error: err.message }); }
  });

  /* ---- 5J (J6): Content Calendar — one month of everything, PKT dates ---- */
  api.get('/calendar', (req, res) => {
    try {
      const ym = String(req.query.ym || '').match(/^(\d{4})-(\d{2})$/);
      const nowD = new Date(Date.now() + 5 * 3600e3); // PKT wall clock
      const year = ym ? Number(ym[1]) : nowD.getUTCFullYear();
      const month = ym ? Number(ym[2]) : nowD.getUTCMonth() + 1;
      const d = require('../db').open();
      const items = [];
      const push = (kind, iso, time, title, source, ref) => items.push({ kind, date: String(iso || '').slice(0, 10), time: String(time || '').slice(0, 5), title: String(title || '').slice(0, 80), source: String(source || '').slice(0, 40), ref: ref || null });
      const pktDay = (utcStr) => { if (!utcStr) return null; const dt = new Date(String(utcStr).replace(' ', 'T') + (utcStr.includes('Z') ? '' : 'Z')); if (isNaN(dt)) return null; return new Date(dt.getTime() + 5 * 3600e3).toISOString().slice(0, 10); };
      const pktTime = (utcStr) => { if (!utcStr) return ''; const dt = new Date(String(utcStr).replace(' ', 'T') + (utcStr.includes('Z') ? '' : 'Z')); if (isNaN(dt)) return ''; const p = new Date(dt.getTime() + 5 * 3600e3); return p.toISOString().slice(11, 16); };
      const inMonth = (dayStr) => dayStr && dayStr.slice(0, 7) === `${year}-${String(month).padStart(2, '0')}`;
      const firstLine = (t) => (String(t || '').split('\n').find((l) => l.trim().length >= 4) || String(t || '')).trim().slice(0, 80);
      /* published + edited (pipeline output) */
      for (const r of d.prepare("SELECT id, body, created_at, status, source_jid FROM posts WHERE status IN ('published','edited') ORDER BY created_at ASC LIMIT 2000").all()) {
        const day = pktDay(r.created_at);
        if (!inMonth(day)) continue;
        const srcName = CH.listSources().find((s) => s.jid === r.source_jid)?.name || r.source_jid;
        push(r.status === 'edited' ? 'published' : 'published', day, pktTime(r.created_at), firstLine(r.body), srcName, { type: 'post', id: r.id });
      }
      /* drafts — pending Approval Queue items */
      for (const r of d.prepare("SELECT id, text, created_at, source_jid FROM approvals WHERE status='pending' ORDER BY created_at ASC LIMIT 500").all()) {
        const day = pktDay(r.created_at) || new Date(Date.now() + 5 * 3600e3).toISOString().slice(0, 10);
        if (!inMonth(day)) continue;
        const isPlan = String(r.source_jid) === 'plan@bot';
        push(isPlan ? 'plan' : 'draft', day, pktTime(r.created_at), firstLine(r.text), isPlan ? 'Weekly plan' : 'Approval queue', { type: 'approval', id: r.id });
      }
      /* scheduled — 5A post scheduler jobs (power.scheduler.jobs) */
      try {
        for (const j of JSON.parse(S.get('power.scheduler.jobs', '[]') || '[]')) {
          if (j.enabled === false) continue;
          const dt = new Date(j.at); if (isNaN(dt)) continue;
          const p = new Date(dt.getTime() + 5 * 3600e3); // job `at` is stored as UTC iso of the PKT wall time
          const day = p.toISOString().slice(0, 10);
          if (!inMonth(day)) continue;
          push('scheduled', day, p.toISOString().slice(11, 16), firstLine(j.text || j.name || 'Scheduled post'), j.repeat === 'once' ? `Scheduled (${j.repeat})` : `Scheduled (${j.repeat})`, { type: 'job', id: j.id });
        }
      } catch { }
      /* scheduled — 5F personal WhatsApp sends */
      for (const r of d.prepare('SELECT * FROM wa_scheduled WHERE enabled=1 ORDER BY at ASC LIMIT 300').all()) {
        let day = null, time = '';
        const m = String(r.at || '').match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})/);
        if (m) { day = m[1]; time = m[2]; }
        if (!day) { const dt = new Date(r.at); if (!isNaN(dt)) { const p = new Date(dt.getTime() + 5 * 3600e3); day = p.toISOString().slice(0, 10); time = p.toISOString().slice(11, 16); } }
        if (!inMonth(day)) continue;
        push('scheduled', day, time, firstLine(r.text), `${r.name || 'Personal'} · ${r.repeat || 'once'}`, { type: 'wasched', id: r.id });
      }
      /* evergreen — recycles logged in 5H */
      for (const r of d.prepare('SELECT id, post_id, body, recycled_at FROM evergreen_log ORDER BY recycled_at ASC LIMIT 500').all()) {
        const day = pktDay(r.recycled_at);
        if (!inMonth(day)) continue;
        push('evergreen', day, pktTime(r.recycled_at), firstLine(r.body), 'Evergreen recycle', { type: 'post', id: r.post_id });
      }
      items.sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
      res.json({ ok: true, year, month, items, count: items.length });
    } catch (err) { res.status(400).json({ ok: false, error: err.message }); }
  });

  /* ---- 5J (J8): Pacing Visualizer — posts per hour (last 24 h, PKT) vs the cap ---- */
  api.get('/pacing', (req, res) => {
    try {
      const d = require('../db').open();
      const rows = d.prepare("SELECT created_at FROM posts WHERE status='published' AND created_at >= datetime('now','-24 hours')").all();
      const perHour = new Array(24).fill(0);
      const perTarget = {};
      for (const r of rows) {
        const dt = new Date(String(r.created_at).replace(' ', 'T') + 'Z');
        if (isNaN(dt)) continue;
        const ageH = Math.floor((Date.now() - dt.getTime()) / 3600e3);
        if (ageH >= 0 && ageH < 24) perHour[23 - ageH] += 1;
      }
      const lastHour = CH.publishedLastHour();
      const cap = Math.max(3, parseInt(S.get('guard.maxperhour', '30'), 10) || 30);
      const targets = CH.listActiveTargets().map((t) => ({ name: t.name || t.jid, jid: t.jid }));
      res.json({ ok: true, perHour, perHourLabels: Array.from({ length: 24 }, (_, i) => i), cap, lastHour, targets, nowPkt: new Date(Date.now() + 5 * 3600e3).toISOString() });
    } catch (err) { res.status(400).json({ ok: false, error: err.message }); }
  });

  /* ---- v6.3: email (multiple accounts, compose, bulk, scheduling) ---- */
  api.get('/email/accounts', (req, res) => res.json({ ok: true, list: email.publicAccounts(), presets: email.presetList() }));
  api.post('/email/accounts', (req, res) => {
    try { const a = email.addAccount(req.body || {}); res.json({ ok: true, account: a }); }
    catch (err) { res.status(400).json({ ok: false, error: err.message }); }
  });
  api.delete('/email/accounts/:id', (req, res) => { email.removeAccount(req.params.id); res.json({ ok: true }); });
  api.post('/email/accounts/:id/default', (req, res) => {
    try { email.setDefault(req.params.id); res.json({ ok: true }); }
    catch (err) { res.status(400).json({ ok: false, error: err.message }); }
  });
  api.post('/email/test', async (req, res) => {
    try { const result = await email.testAccount(req.body?.id); res.json({ ok: true, result }); }
    catch (err) { res.status(400).json({ ok: false, error: err.message }); }
  });
  api.post('/email/send', async (req, res) => {
    try { const r = await email.sendOrQueue(req.body || {}); res.json({ ok: true, ...r }); }
    catch (err) { res.status(400).json({ ok: false, error: err.message }); }
  });
  api.get('/email/history', (req, res) => res.json({ ok: true, list: email.history(60), queue: email.pendingQueue() }));
  api.post('/email/queue/:id/cancel', (req, res) => { email.cancelQueued(req.params.id); res.json({ ok: true }); });

  /* ---- v6.1: AI chat ("Ask AI" tab) ---- */
  api.get('/ai/chat', (req, res) => res.json({ ok: true, list: AICHAT.history(40) }));
  api.post('/ai/chat', async (req, res) => {
    try {
      const message = String(req.body?.message || '');
      /* v7.4.0: aicontrol.chat — when "Bot control" is ON the AI may act
         (publish missed posts, post text, toggles, pause channels); the ⚙️
         action lines are persisted to the chat history as assistant rows. */
      const { reply, actions } = await aicontrol.chat(message);
      AICHAT.add('user', message);
      AICHAT.add('assistant', reply);
      res.json({ ok: true, reply, actions: actions || [] });
    } catch (err) { res.status(400).json({ ok: false, error: err.message }); }
  });
  api.delete('/ai/chat', (req, res) => { AICHAT.clear(); res.json({ ok: true }); });

  /* ---- v6.1: composer — publish a custom post from the dashboard ---- */
  api.post('/compose', async (req, res) => {
    try {
      const text = String(req.body?.text || '').trim();
      const imageUrls = String(req.body?.imageUrl || '').trim();
      const upB64 = String(req.body?.imageB64 || '');   // 5B: uploaded file (base64)
      const doBeautify = Boolean(req.body?.beautify);
      const active = CH.listActiveTargets().map((t) => t.jid);
      const chosen = (Array.isArray(req.body?.targets) ? req.body.targets : []).map(String).filter((j) => active.includes(j));
      if (Array.isArray(req.body?.targets) && req.body.targets.length && chosen.length !== new Set(req.body.targets.map(String)).size) return res.status(400).json({ok:false,error:'A selected target is missing or paused. Check targets before sending.'});
      if (!text && !imageUrls && !upB64) return res.status(400).json({ ok: false, error: 'Write a post, add an image URL or upload a photo.' });
      if (!active.length) return res.status(400).json({ ok: false, error: 'No active target channels — add one in the Targets tab.' });
      const sock = wa.getSocket();
      if (!sock || wa.getStatus().status !== 'open') throw new Error('WhatsApp is not connected.');

      let finalText = text;
      if (doBeautify && text) finalText = await ai.beautify(text);
      const only = chosen.length ? chosen : active;

      // optional image: uploaded file (5B) or public URL — 5 MB cap either way
      let content;
      if (upB64) {
        const buf = Buffer.from(upB64, 'base64');
        if (!buf.length) throw new Error('The uploaded image is empty.');
        if (buf.length > 5 * 1024 * 1024) throw new Error('Upload is larger than 5 MB.');
        const mime = String(req.body?.imageMime || 'image/jpeg');
        if (!/^image\//.test(mime)) throw new Error('Only image uploads are supported.');
        content = { image: buf, caption: finalText || undefined, mimetype: mime };
      } else if (imageUrls) {
        if (!/^https:\/\//i.test(imageUrls) && !/^http:\/\//i.test(imageUrls)) return res.status(400).json({ ok: false, error: 'Image URL must start with http(s)://' });
        const imgRes = await fetch(imageUrls, { signal: AbortSignal.timeout(20000) });
        if (!imgRes.ok) throw new Error(`Image could not be fetched (HTTP ${imgRes.status}).`);
        const buf = Buffer.from(await imgRes.arrayBuffer());
        if (buf.length > 5 * 1024 * 1024) throw new Error('Image is larger than 5 MB.');
        if (!/image\//.test(imgRes.headers.get('content-type') || '')) throw new Error('That URL is not an image.');
        content = { image: buf, caption: finalText || undefined, mimetype: imgRes.headers.get('content-type') };
      } else {
        content = { text: finalText };
      }
      const r = await publishMod.publish(content, { sourceJid: 'system:compose', sourceMsgId: `compose-${crypto.randomUUID()}`, only, hasMedia: Boolean(imageUrls || upB64), norm: finalText.slice(0, 400) });
      ring.info('compose.sent', `Dashboard post: ${r.sent} accepted, ${r.failed} need attention`);
      res.json({ ok: true, sent: r.sent, failed:r.failed, complete:r.complete === true, errors:r.errors, text: finalText });
    } catch (err) { res.status(400).json({ ok: false, error: err.message }); }
  });

  /* ---- 5B (R50) + 5C (R55): composer AI — Improve/Shorten/Formal/Translate/Emojify + prompt library ---- */
  api.post('/compose/ai', async (req, res) => {
    try {
      const action = String(req.body?.action || '');
      const text = String(req.body?.text || '');
      if (!text.trim()) return res.status(400).json({ ok: false, error: 'Write some text first.' });
      if (action === 'translate') {
        const lang = String(req.body?.lang || S.get('ai.translate.lang', '')).trim();
        if (!lang) return res.status(400).json({ ok: false, error: 'Pick a target language in Settings · Digest & Translate first.' });
        const out = await ai.translate(text, lang);
        if (!out || !String(out).trim()) throw new Error('AI returned an empty reply — try again.');
        return res.json({ ok: true, text: String(out).trim() });
      }
      /* 5C (R55): a prompt-library prompt (by id) or a raw custom prompt */
      let prompt = String(req.body?.prompt || '').trim();
      const pid = Number(req.body?.promptId) || 0;
      if (pid) {
        const row = PL.list().find((x) => x.id === pid);
        if (!row) return res.status(400).json({ ok: false, error: 'Prompt not found in the library.' });
        prompt = String(row.body || '');
      }
      if (prompt) {
        const out = await ai.callFor('composer', prompt + '\n\nPOST:\n' + text.slice(0, 8000), { timeoutMs: 30000, maxTokens: 900 });
        if (!out || !String(out).trim()) throw new Error('AI returned an empty reply — try again.');
        return res.json({ ok: true, text: String(out).trim() });
      }
      const PROMPTS = {
        improve: 'Improve this WhatsApp channel post for clarity, flow and punctuation. Keep the same language, tone and roughly the same length. No headers, no hashtags, no emoji. Return ONLY the improved text.',
        shorten: 'Shorten this WhatsApp channel post to at most two sentences while keeping the key facts. Same language. Return ONLY the shortened text.',
        formal: 'Rewrite this WhatsApp channel post in a formal, professional tone. Same language, no emoji, no headers, no hashtags. Return ONLY the rewritten text.',
        emojify: 'Add a few fitting emojis to this WhatsApp channel post (at most 5 total, placed naturally in the flow). Keep every word and all facts exactly as they are. Return ONLY the final text.'
      };
      if (!PROMPTS[action]) return res.status(400).json({ ok: false, error: 'Unknown action.' });
      const out = await ai.callFor('composer', PROMPTS[action] + '\n\nPOST:\n' + text.slice(0, 8000), { timeoutMs: 30000, maxTokens: 900 });
      if (!out || !String(out).trim()) throw new Error('AI returned an empty reply — try again.');
      res.json({ ok: true, text: String(out).trim() });
    } catch (err) {
      const msg = /NO_KEY|no api key|key is not set/i.test(String(err.message || '')) ? 'AI key is not set — add one in Settings · AI first.' : err.message;
      res.status(400).json({ ok: false, error: msg });
    }
  });

  /* ---- 5C (R54): per-feature provider + model + usage meter ---- */
  const AI_FEATURES = [
    ['beautify', 'Clean & beautify'], ['translate', 'Translate'], ['autoReply', 'AI auto-reply'],
    ['composer', 'Composer AI'], ['tldr', 'TL;DR'], ['autobold', 'Auto-bold'],
    ['match', 'AI pilot (picking)'], ['digest', 'Daily digest'], ['assistant', 'Assistant / robot'],
    ['transcribe', 'Voice transcription']
  ];
  api.get('/ai/features', (req, res) => {
    const usage = {};
    for (const u of AIU.list()) {
      usage[u.feature] = usage[u.feature] || { calls: 0, tokens: 0 };
      usage[u.feature].calls += u.calls;
      usage[u.feature].tokens += u.tokens;
    }
    const st = ai.state();
    res.json({
      ok: true,
      global: { provider: st.provider, model: st.model },
      providers: st.providers.map((p) => ({ id: p.id, name: p.name })),
      features: AI_FEATURES.map(([key, label]) => ({
        key, label,
        provider: S.get(`ai.feature.${key}.provider`, ''),
        model: S.get(`ai.feature.${key}.model`, ''),
        usage: usage[key] || { calls: 0, tokens: 0 }
      })),
      total: AIU.totals()
    });
  });
  api.post('/ai/features', (req, res) => {
    const key = String(req.body?.feature || '');
    const known = AI_FEATURES.find(([k]) => k === key);
    if (!known) return res.status(400).json({ ok: false, error: 'Unknown feature.' });
    const provider = String(req.body?.provider || '').trim().toLowerCase();
    const model = String(req.body?.model || '').trim();
    const valid = ai.state().providers.map((p) => p.id);
    if (provider && !valid.includes(provider)) return res.status(400).json({ ok: false, error: 'Unknown provider.' });
    S.set(`ai.feature.${key}.provider`, provider);
    S.set(`ai.feature.${key}.model`, model);
    AUD.log('owner', 'ai.feature', `Feature "${key}" → ${provider || 'global provider'}${model ? ' / ' + model : ''}`);
    res.json({ ok: true });
  });
  api.get('/ai/usage', (req, res) => { res.json({ ok: true, list: AIU.list(), total: AIU.totals() }); });

  /* ---- 5C (R55): prompt library ---- */
  api.get('/prompts', (req, res) => { try { PL.seed(); } catch { } res.json({ ok: true, list: PL.list() }); });
  api.post('/prompts', (req, res) => {
    const name = String(req.body?.name || '').trim();
    const body = String(req.body?.body || '').trim();
    if (!name || !body) return res.status(400).json({ ok: false, error: 'A name and the prompt text are required.' });
    res.json({ ok: true, id: PL.add(name, body) });
  });
  api.post('/prompts/:id', (req, res) => { PL.update(req.params.id, req.body?.name, req.body?.body); res.json({ ok: true }); });
  api.delete('/prompts/:id', (req, res) => { PL.remove(req.params.id); res.json({ ok: true }); });

  /* ---- 5C (R57): glossary — owner terms enforced in translate + templates ---- */
  api.get('/glossary', (req, res) => { res.json({ ok: true, list: GL.list() }); });
  api.post('/glossary', (req, res) => {
    const id = GL.add(req.body?.from, req.body?.to, req.body?.note);
    if (!id) return res.status(400).json({ ok: false, error: 'Both the term and its replacement are required.' });
    res.json({ ok: true, id });
  });
  api.delete('/glossary/:id', (req, res) => { GL.remove(req.params.id); res.json({ ok: true }); });

  /* ---- 5C (R59): knowledge-base auto-reply pairs ---- */
  api.get('/reply-kb', (req, res) => { res.json({ ok: true, list: RB.listAll() }); });
  api.post('/reply-kb', (req, res) => {
    const id = RB.add(req.body?.q, req.body?.a);
    if (!id) return res.status(400).json({ ok: false, error: 'Both the question and the stored answer are required.' });
    res.json({ ok: true, id });
  });
  api.post('/reply-kb/:id', (req, res) => { RB.update(req.params.id, req.body?.q, req.body?.a, req.body?.enabled); res.json({ ok: true }); });
  api.delete('/reply-kb/:id', (req, res) => { RB.remove(req.params.id); res.json({ ok: true }); });
  api.get('/reply-kb/settings', (req, res) => {
    res.json({ ok: true, from: S.get('replykb.hours.from', '09:00'), to: S.get('replykb.hours.to', '21:00'), allowlist: S.get('replykb.allowlist', '') });
  });
  api.post('/reply-kb/settings', (req, res) => {
    const t = (v, d) => /^\d{2}:\d{2}$/.test(String(v || '').trim()) ? String(v).trim() : d;
    S.set('replykb.hours.from', t(req.body?.from, '09:00'));
    S.set('replykb.hours.to', t(req.body?.to, '21:00'));
    S.set('replykb.allowlist', String(req.body?.allowlist || '').slice(0, 500));
    res.json({ ok: true });
  });
  /* 5C (R60): morning recap time (Pakistan time) */
  api.post('/recap/at', (req, res) => {
    const t = /^\d{2}:\d{2}$/.test(String(req.body?.at || '').trim()) ? String(req.body.at).trim() : '07:00';
    S.set('recap.at', t);
    res.json({ ok: true, at: t });
  });

  /* ═══ 5D (v7.8.0) — R61–R68 ═══════════════════════════════════════ */
  const health = require('../health');
  const report = require('../report');
  const alerts = require('../alerts');
  const exp = require('../export');
  const { GO, ST, NTF, F } = require('../db');

  /* ---- R62: goals + leaderboard ---- */
  api.get('/goals', (req, res) => {
    const goals = GO.all();
    const today = new Date(Date.now() + 5 * 3600e3).toISOString().slice(0, 10);
    const d = require('../db').open();
    const counts = Object.fromEntries(d.prepare(`SELECT source_jid, COUNT(*) n FROM posts WHERE created_at LIKE ?||'%' AND status IN ('published','edited') GROUP BY source_jid`).all(today).map((r) => [r.source_jid, r.n]));
    res.json({
      ok: true,
      global: { daily: parseInt(S.get('goals.daily', '0'), 10) || 0, today: d.prepare(`SELECT COUNT(*) n FROM posts WHERE created_at LIKE ?||'%' AND status IN ('published','edited')`).get(today).n },
      list: goals.map((g) => ({ ...g, today: counts[g.source_jid] || 0 }))
    });
  });
  api.post('/goals/global', (req, res) => {
    const n = Math.min(999, Math.max(0, parseInt(req.body?.n, 10) || 0));
    S.set('goals.daily', String(n));
    res.json({ ok: true, daily: n });
  });
  api.post('/goals', (req, res) => {
    const jid = String(req.body?.jid || '').trim();
    const n = Math.min(999, Math.max(0, parseInt(req.body?.n, 10) || 0));
    if (!jid) return res.status(400).json({ ok: false, error: 'Pick a source first.' });
    if (n <= 0) { GO.remove(jid); return res.json({ ok: true, removed: true }); }
    GO.set(jid, n, req.body?.note);
    res.json({ ok: true });
  });
  api.delete('/goals/:jid', (req, res) => { GO.remove(String(req.params.jid)); res.json({ ok: true }); });

  /* ---- R63: weekly report + exports ---- */
  api.get('/weekly', (req, res) => {
    res.json({ ok: true, on: pipeline.switches().weekly, at: report.weeklyConfig().at, lastweek: S.get('weekly.lastweek', ''), phone: S.get('report.phone', S.get('main.phone', '')) });
  });
  api.post('/weekly/at', (req, res) => {
    const at = String(req.body?.at || '').trim();
    if (!/^[A-Za-z]{3}\s+\d{1,2}:\d{2}$/.test(at)) return res.status(400).json({ ok: false, error: 'Format: Mon 09:00' });
    S.set('weekly.at', at);
    res.json({ ok: true, at: report.weeklyConfig().at });
  });
  api.post('/weekly/send', async (req, res) => {
    try { res.json({ ok: true, ...await report.sendWeekly({ now: true }) }); }
    catch (err) { res.status(400).json({ ok: false, error: err.message }); }
  });

  /* ---- R63: CSV / PDF export (range = the analytics picker) ---- */
  api.get('/analytics/export.csv', (req, res) => {
    const days = Math.min(30, Math.max(7, parseInt(req.query.days || '14', 10) || 14));
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="raqifluz-posts-${days}d.csv"`);
    res.send(exp.csv(days));
  });
  api.get('/analytics/export.pdf', (req, res) => {
    const days = Math.min(30, Math.max(7, parseInt(req.query.days || '14', 10) || 14));
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="raqifluz-report-${days}d.pdf"`);
    res.send(exp.pdf(days));
  });

  /* ---- R64: health v2 + full self-test ---- */
  api.get('/health', (req, res) => {
    res.json({ ok: true, ...health.score(), selftests: ST.recent(5) });
  });
  api.post('/health/selftest', (req, res) => {
    try { res.json({ ok: true, ...health.selfTest() }); }
    catch (err) { res.status(400).json({ ok: false, error: err.message }); }
  });

  /* ---- R65: instant alerts (test button) ---- */
  api.post('/alerts/test', (req, res) => {
    const r = alerts.maybe('test', 'Instant-alert test', 'This is the test alert — real failures use the same channel.');
    /* ok = the request was handled; sent/why say whether the alert actually went out */
    res.json({ ok: true, sent: r.sent, why: r.why || '' });
  });

  /* ---- R66: notification center ---- */
  api.get('/notifications', (req, res) => { res.json({ ok: true, ...NTF.list(30) }); });
  api.post('/notifications/read', (req, res) => { NTF.readAll(); res.json({ ok: true }); });
  api.post('/notifications/:id/read', (req, res) => { NTF.readOne(Number(req.params.id)); res.json({ ok: true }); });

  /* ---- R67: full-text search (FTS5) ---- */
  api.get('/search', (req, res) => {
    const q = String(req.query.q || '').trim();
    if (q.length < 2) return res.json({ ok: true, posts: [], logs: [], chats: [], engine: 'none' });
    res.json({
      ok: true,
      posts: F.posts(q, 10).list,
      logs: F.logs(q, 8).list,
      chats: F.chats(q, 8).list,
      engine: F.posts(q, 1).engine
    });
  });

  /* ═══════════ 5E (R69–R75): audit, backup, security, storage, panic, status ═══════════ */
  const backup = require('../backup');
  const panic = require('../panic');

  /* ---- R69: audit trail view + CSV ---- */
  api.get('/audit', (req, res) => {
    const limit = Math.min(2000, Math.max(1, parseInt(req.query.limit, 10) || 200));
    const q = String(req.query.q || '').trim().toLowerCase();
    const actor = String(req.query.actor || '').trim();
    let rows = AUD.recent(2000);
    if (actor) rows = rows.filter((r) => r.actor === actor);
    if (q) rows = rows.filter((r) => (r.action + ' ' + r.detail).toLowerCase().includes(q));
    res.json({ ok: true, list: rows.slice(0, limit), total: rows.length });
  });
  api.get('/audit.csv', (req, res) => {
    const rows = AUD.recent(5000);
    const csv = ['ts,actor,action,detail', ...rows.map((r) => [r.ts, r.actor, r.action, r.detail].map(csvCell).join(','))].join('\n');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="raqifluz-audit.csv"');
    res.send(csv);
  });

  /* ---- R70: local backup download + restore (with automatic pre-restore snapshot) ---- */
  api.get('/backup/download', (req, res) => {
    try {
      const zip = backup.downloadZip();
      const name = `raqifluz-backup-${new Date().toISOString().slice(0, 10)}.zip`;
      AUD.log('owner', 'backup.download', `Backup zip downloaded (${(zip.length / 1048576).toFixed(1)} MB)`);
      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
      res.send(zip);
    } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
  });
  api.post('/backup/restore', express.raw({ type: ['application/zip', 'application/octet-stream', 'application/x-sqlite3', 'application/vnd.sqlite3', 'text/plain'], limit: '200mb' }), (req, res) => {
    try {
      if (!Buffer.isBuffer(req.body) || req.body.length < 100) return res.status(400).json({ ok: false, error: 'Upload a backup zip (or a raw bot.sqlite) first.' });
      const r = backup.restoreFromBuffer(req.body);
      AUD.log('owner', 'backup.restore', `Restored from upload — pre-restore snapshot kept as ${r.preRestore}`);
      try { require('../db').NTF.add('backup', `Backup restored — previous state saved as ${r.preRestore} (download it from Backup & restore).`); } catch { }
      res.json({ ok: true, preRestore: r.preRestore, message: 'Restored. Pre-restore snapshot kept — the dashboard will reflect the restored state.' });
    } catch (err) { res.status(400).json({ ok: false, error: err.message }); }
  });
  api.get('/backup/pre-restore', (req, res) => res.json({ ok: true, list: backup.listPreRestore() }));
  api.get('/backup/pre-restore/:name', (req, res) => {
    const name = String(req.params.name || '');
    if (!/^pre-restore-[\w.-]+\.sqlite$/.test(name)) return res.status(400).json({ ok: false, error: 'Bad file name.' });
    const file = path.join(backup.BACKUP_DIR, name);
    if (!fs.existsSync(file)) return res.status(404).json({ ok: false, error: 'Snapshot not found.' });
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
    res.sendFile(file);
  });

  /* ---- R71: second (read-only) password + session timeout ---- */
  api.get('/security', (req, res) => res.json({
    ok: true,
    roEnabled: S.getBool('ro.enabled', false),
    roSet: Boolean(S.get('ro.password_hash', '')),
    loginAlerts: S.getBool('login.alerts', false),
    timeoutMin: Math.min(24 * 60, Math.max(5, parseInt(S.get('session.timeout_min', '120'), 10) || 120))
  }));
  api.post('/security', (req, res) => {
    try {
      const b = req.body || {};
      if (b.ro !== undefined) S.set('ro.enabled', b.ro ? '1' : '0');
      if (b.password) {
        const p = String(b.password);
        if (p.length < 6) return res.status(400).json({ ok: false, error: 'Password must be at least 6 characters.' });
        S.set('ro.password_hash', bcrypt.hashSync(p, 10));
      }
      if (b.loginAlerts !== undefined) S.set('login.alerts', b.loginAlerts ? '1' : '0');
      if (b.timeoutMin !== undefined) {
        const n = Math.min(24 * 60, Math.max(5, parseInt(b.timeoutMin, 10) || 120));
        S.set('session.timeout_min', String(n));
      }
      AUD.log('owner', 'security.update', `Security settings updated (readonly ${S.getBool('ro.enabled', false) ? 'on' : 'off'}, login alerts ${S.getBool('login.alerts', false) ? 'on' : 'off'}, timeout ${S.get('session.timeout_min', '120')} min)`);
      res.json({ ok: true });
    } catch (err) { res.status(400).json({ ok: false, error: err.message }); }
  });

  /* ---- R72: storage manager ---- */
  const dirSize = (dir) => {
    let n = 0, bytes = 0, oldest = null;
    try {
      for (const f of fs.readdirSync(dir)) {
        try {
          const st = fs.statSync(path.join(dir, f));
          if (!st.isFile()) continue;
          n += 1; bytes += st.size;
          if (oldest === null || st.mtimeMs < oldest) oldest = st.mtimeMs;
        } catch { }
      }
    } catch { }
    return { files: n, bytes, oldest: oldest ? new Date(oldest).toISOString() : null };
  };
  api.get('/storage', async (req, res) => {
    const d = require('../db').open();
    const dbFile = cfg.config.paths.database;
    let dbBytes = 0;
    try { dbBytes = fs.statSync(dbFile).size + (fs.existsSync(dbFile + '-wal') ? fs.statSync(dbFile + '-wal').size : 0); } catch { }
    const rows = {};
    for (const t of ['posts', 'logs', 'audit', 'approvals', 'inbox_msgs', 'settings']) {
      try { rows[t] = d.prepare(`SELECT COUNT(*) c FROM [${t}]`).get().c; } catch { rows[t] = null; }
    }
    /* v8.3.0 — GitHub repo storage gauge (real clone size); never breaks the page */
    let github = { configured: false };
    try { github = await require('../persist').githubStats({ refresh: req.query.refresh === '1' }); } catch { }
    /* v9.0.0 (repo-slim) — the new slim fields (cloud sync state + on-disk inbox media) */
    let cloud = { enabled: false, lastSyncAt: '', lastKB: 0, skips: 0, lastSyncReason: '' };
    let inboxMedia = { bytes: 0, files: 0 };
    let keepDays = 30;
    try {
      cloud = require('../persist').publicStatus();
      inboxMedia.bytes = require('../db').IB.inboxMediaBytes();
      const inDir = path.join(cfg.config.paths.media, 'inbox');
      inboxMedia.files = fs.existsSync(inDir) ? fs.readdirSync(inDir).filter((f) => fs.statSync(path.join(inDir, f)).isFile()).length : 0;
      keepDays = require('../housekeep').keepDays();
    } catch { }
    res.json({
      ok: true,
      db: { bytes: dbBytes },
      mediaHold: dirSize(path.join(__dirname, '..', 'data', 'media-hold')),
      avatars: dirSize(path.join(__dirname, '..', 'data', 'avatars')),
      preRestore: { files: backup.listPreRestore().length, bytes: backup.listPreRestore().reduce((a, x) => a + x.bytes, 0) },
      rows,
      github,
      cloud,
      inboxMedia,
      keepDays
    });
  });
  /* v9.0.0 (repo-slim): set the inbox-media retention, then prune immediately */
  api.post('/storage/keepdays', (req, res) => {
    try {
      const days = Math.min(365, Math.max(1, parseInt(req.body?.days, 10) || 30));
      require('../db').S.set('inbox.mediaKeepDays', String(days));
      const r = require('../housekeep').sweep();
      AUD.log('owner', 'storage.keepdays', `Inbox media retention set to ${days} day(s); immediate sweep removed ${r.files} file(s) + ${r.blobs} BLOB(s)`);
      res.json({ ok: true, days, detail: `Inbox media older than ${days} day(s) removed (${r.files} file(s), ${r.blobs} BLOB(s)). The database — and therefore the cloud snapshot — stays small.` });
    } catch (err) { res.status(400).json({ ok: false, error: err.message }); }
  });
  /* v9.0.0 (repo-slim): one-click "Compact cloud memory" — force a fresh
     single-commit push so the repo holds exactly one snapshot again */
  api.post('/persist/compact', async (req, res) => {
    try {
      const r = await require('../persist').compactNow();
      AUD.log('owner', 'persist.compact', `Cloud repo compacted: snapshot now ${Math.round(r.bytes / 1024)} KB (was ${Math.round(r.wasBytes / 1024)} KB)`);
      res.json({ ok: true, kb: Math.round(r.bytes / 1024), wasKb: Math.round(r.wasBytes / 1024), hash: r.hash, at: r.at });
    } catch (err) { res.status(400).json({ ok: false, error: err.message }); }
  });
  api.post('/storage/cleanup', (req, res) => {
    try {
      const kind = String(req.body?.kind || '');
      const days = Math.min(365, Math.max(1, parseInt(req.body?.days, 10) || 30));
      const cutoff = Date.now() - days * 86400e3;
      let detail = '';
      if (kind === 'media') {
        let n = 0;
        const dir = path.join(__dirname, '..', 'data', 'media-hold');
        for (const f of fs.readdirSync(dir)) {
          try {
            const st = fs.statSync(path.join(dir, f));
            if (st.isFile() && st.mtimeMs < cutoff) { fs.unlinkSync(path.join(dir, f)); n += 1; }
          } catch { }
        }
        /* v9.0.0 (repo-slim): inbox media (on-disk cache + legacy BLOBs) too —
           the two things that used to make the database — and the repo — grow */
        const m = require('../db').IB.pruneMedia(days);
        detail = `Removed ${n} media-hold file(s) + ${m.files} inbox media file(s) + ${m.blobs} old media BLOB(s) older than ${days} days`;
      } else if (kind === 'logs') {
        const r = require('../db').open().prepare("DELETE FROM logs WHERE ts < ?").run(new Date(cutoff).toISOString().slice(0, 19).replace('T', ' '));
        detail = `Removed ${r.changes} log line(s) older than ${days} days`;
      } else if (kind === 'failed-posts') {
        const r = require('../db').open().prepare("DELETE FROM posts WHERE status IN ('failed','skipped') AND created_at < ?").run(new Date(cutoff).toISOString().slice(0, 19).replace('T', ' '));
        detail = `Removed ${r.changes} old failed/skipped post record(s) (published posts are never touched)`;
      } else if (kind === 'vacuum') {
        require('../db').open().exec('PRAGMA wal_checkpoint(TRUNCATE)');
        require('../db').open().exec('VACUUM');
        detail = `Vacuumed the database (freed ${Math.round((dbBytes - fs.statSync(cfg.config.paths.database).size) / 1024)} KB, if any)`;
      } else {
        return res.status(400).json({ ok: false, error: 'Unknown cleanup kind.' });
      }
      AUD.log('owner', 'storage.cleanup', detail);
      res.json({ ok: true, detail });
    } catch (err) { res.status(400).json({ ok: false, error: err.message }); }
  });

  /* ---- R73: panic stop (pause everything / restore exact state) ---- */
  api.get('/panic', (req, res) => res.json({ ok: true, ...panic.view() }));
  api.post('/panic/stop', (req, res) => {
    const st = panic.stop(String(req.body?.by || 'owner'));
    res.json({ ok: true, ...panic.view(), previous: st });
  });
  api.post('/panic/restore', (req, res) => {
    const st = panic.restore(String(req.body?.by || 'owner'));
    res.json({ ok: true, ...panic.view(), restored: st });
  });

  /* ---- R75: PUBLIC /status — no auth, minimal, for uptime monitors ---- */
  const statusLimiter = rateLimit({ windowMs: 60e3, max: 30, standardHeaders: true, legacyHeaders: false,
    handler: (req, res) => res.status(429).json({ ok: false, error: 'slow down' }) });
  app.get('/status', statusLimiter, (req, res) => {
    const p = panic.view();
    const st = wa.getStatus();
    res.json({
      ok: true,
      botName: cfg.config.botName,
      version: cfg.config.version,
      wa: st.status,
      panic: p.on,
      uptimeSec: Math.floor(process.uptime()),
      ts: new Date().toISOString()
    });
  });

  /* ---- 5B (R52): test send — send the composed text to your own number ---- */
  api.post('/compose/test-send', async (req, res) => {
    try {
      const phone = String(req.body?.phone || '').replace(/\D/g, '');
      const text = String(req.body?.text || '').trim();
      if (!/^\d{8,15}$/.test(phone)) return res.status(400).json({ ok: false, error: 'Enter a phone number (digits only, 8–15 digits).' });
      if (!text) return res.status(400).json({ ok: false, error: 'Nothing to send — write a post first.' });
      const sock = wa.getSocket();
      if (!sock || wa.getStatus().status !== 'open') throw new Error('WhatsApp is not connected.');
      await wa.sendToChannel(sock, phone + '@s.whatsapp.net', { text: text.slice(0, 6000) });
      AUD.log('owner', 'compose.test-send', `Test message sent to +${phone}`);
      res.json({ ok: true });
    } catch (err) { res.status(400).json({ ok: false, error: err.message }); }
  });

  /* ---- 5B (R51): snippets with {placeholders} ---- */
  api.get('/snippets', (req, res) => { res.json({ ok: true, list: SN.list() }); });
  api.post('/snippets', (req, res) => {
    const name = String(req.body?.name || '').trim();
    const body = String(req.body?.body || '');
    if (!name || !body.trim()) return res.status(400).json({ ok: false, error: 'A name and some text are required.' });
    if (SN.list().some((s) => s.name.toLowerCase() === name.toLowerCase())) return res.status(400).json({ ok: false, error: 'A snippet with that name already exists.' });
    res.json({ ok: true, id: SN.add(name, body) });
  });
  api.post('/snippets/:id', (req, res) => { SN.update(req.params.id, req.body?.name, req.body?.body); res.json({ ok: true }); });
  api.delete('/snippets/:id', (req, res) => { SN.remove(req.params.id); res.json({ ok: true }); });

  /* ---- 5B (R49): composer drafts ---- */
  api.get('/drafts', (req, res) => { res.json({ ok: true, list: DR.list() }); });
  api.post('/drafts', (req, res) => {
    const name = String(req.body?.name || 'Untitled draft').trim();
    res.json({ ok: true, id: DR.add(name, req.body?.text, '') });
  });
  api.post('/drafts/:id', (req, res) => { DR.update(req.params.id, req.body?.name, req.body?.text, ''); res.json({ ok: true }); });
  api.delete('/drafts/:id', (req, res) => { DR.remove(req.params.id); res.json({ ok: true }); });

  /* ---- 5B (R53): per-post retry + edit-republish ---- */
  api.post('/posts/retry-one', async (req, res) => {
    try { res.json({ ok: true, ...(await queue5a.retryOneFailed(req.body?.id)) }); }
    catch (err) { res.status(400).json({ ok: false, error: err.message }); }
  });
  api.post('/posts/edit-republish', async (req, res) => {
    try { res.json({ ok: true, ...(await queue5a.republishOne(req.body?.id, req.body?.text)) }); }
    catch (err) { res.status(400).json({ ok: false, error: err.message }); }
  });

  /* ---- v6.1: manual cloud backup + CSV exports ---- */
  api.post('/persist/backup', async (req, res) => {
    try { await require('../persist').backupNow(); res.json({ ok: true, message: 'cloud-state synced (manual)' }); }
    catch (err) { res.status(400).json({ ok: false, error: err.message }); }
  });
  const csvCell = (v) => `"${String(v == null ? '' : v).replace(/"/g, '""').replace(/\r?\n/g, ' ')}"`;
  api.get('/export/posts.csv', (req, res) => {
    const rows = A.recent(500);
    const csv = ['id,when,source,status,detail', ...rows.map((r) => [r.id, r.created_at, r.source_jid, r.status, r.reason].map(csvCell).join(','))].join('\n');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8'); res.setHeader('Content-Disposition', 'attachment; filename="raqifluz-posts.csv"');
    res.send(csv);
  });
  api.get('/export/logs.csv', (req, res) => {
    const rows = require('../db').open().prepare('SELECT rowid AS id, * FROM logs ORDER BY rowid DESC LIMIT 2000').all();
    const csv = ['id,when,level,code,message', ...rows.map((r) => [r.id, r.ts, r.level, r.code, r.msg].map(csvCell).join(','))].join('\n');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8'); res.setHeader('Content-Disposition', 'attachment; filename="raqifluz-logs.csv"');
    res.send(csv);
  });

  /* ---- settings (v6.1: guardrails, AI extras, digest, API key) ---- */
  api.get('/settings', (req, res) => res.json({
    ok: true, botName: S.get('bot_name', cfg.config.botName),
    reportPhone: S.get('report.phone', ''), reportAt: cfg.config.reportAt,
    automonitor: channels.autoMonitorFlag(),
    blocklist: S.get('blocklist.words', ''),
    maxPerHour: S.get('guard.maxperhour', '30'),
    blocklistRegex: S.getBool('blocklist.regex', false), // 5F (R79): OFF by default (plain words)
    replaceRules: S.get('replace.rules', ''),
    translateLang: S.get('ai.translate.lang', ''),
    digestAt: S.get('digest.at', '22:00'),
    headerText: S.get('power.header.text', ''),
    aiPrompt: S.get('ai.prompt', ''),
    aireplyPrompt: S.get('power.aireply.prompt', ''),
    apiKey: req.authRole === 'readonly' ? '' : S.get('api.key', ''),
    /* 5A */
    queueDelayMin: S.get('queue.delay.min', '0'),
    crossDedupeWindowMin: S.get('crossdedupe.window.min', '30'),
    sourceEditPolicy: S.get('post.sourceedit.policy', 'ignore'),
    /* 5C */
    recapAt: S.get('recap.at', '07:00'),
    /* 5J (J2/J5/J10): UI persistence */
    setupDone: S.getBool('ui.setup.done', false),
    kpiOrder: S.get('ui.kpi.order', ''),
    lang: S.get('ui.lang', 'en')
  }));
  api.post('/settings', (req, res) => {
    const b = req.body || {};
    if (b.botName != null) S.set('bot_name', String(b.botName).slice(0, 60));
    if (b.reportPhone != null) S.set('report.phone', String(b.reportPhone).replace(/\D/g, '').slice(0, 15));
    if (b.automonitor != null) channels.setAutoMonitor(Boolean(b.automonitor));
    if (b.blocklist != null) S.set('blocklist.words', String(b.blocklist).slice(0, 1000));
    if (b.maxPerHour != null) S.set('guard.maxperhour', String(Math.max(3, parseInt(b.maxPerHour, 10) || 30)));
    if (b.blocklistRegex != null) S.set('blocklist.regex', b.blocklistRegex ? '1' : '0');
    if (b.replaceRules != null) S.set('replace.rules', String(b.replaceRules).slice(0, 2000));
    if (b.signatureText != null) S.set('power.signature.text', String(b.signatureText).slice(0, 200));
    if (b.headerText != null) S.set('power.header.text', String(b.headerText).slice(0, 200));
    if (b.translateLang != null) S.set('ai.translate.lang', String(b.translateLang).slice(0, 40));
    if (b.digestAt != null) S.set('digest.at', /^\d{2}:\d{2}$/.test(String(b.digestAt)) ? String(b.digestAt) : '22:00');
    if (b.aiPrompt != null) S.set('ai.prompt', String(b.aiPrompt).slice(0, 1500));
    if (b.aireplyPrompt != null) S.set('power.aireply.prompt', String(b.aireplyPrompt).slice(0, 800));
    /* 5A */
    if (b.queueDelayMin != null) S.set('queue.delay.min', String(Math.max(0, Math.min(1440, parseInt(b.queueDelayMin, 10) || 0))));
    if (b.crossDedupeWindowMin != null) S.set('crossdedupe.window.min', String(Math.max(1, Math.min(1440, parseInt(b.crossDedupeWindowMin, 10) || 30))));
    if (b.sourceEditPolicy != null && ['ignore', 'mark', 'update'].includes(b.sourceEditPolicy)) S.set('post.sourceedit.policy', b.sourceEditPolicy);
    /* 5J (J2/J5/J10) — UI persistence: setup wizard state, Overview KPI order, language */
    if (b.setupDone != null) S.set('ui.setup.done', b.setupDone ? '1' : '0');
    if (b.kpiOrder != null) {
      const known = ['wa', 'published', 'failed', 'sources', 'nextjob', 'latency'];
      const list = String(b.kpiOrder).split(',').map((x) => x.trim()).filter((x) => known.includes(x));
      for (const k of known) if (!list.includes(k)) list.push(k); // never lose a KPI
      S.set('ui.kpi.order', list.join(','));
    }
    if (b.lang != null && ['en', 'ur'].includes(String(b.lang))) S.set('ui.lang', String(b.lang));
    AUD.log('owner', 'settings.save', `Settings saved (${Object.keys(b).filter((k) => b[k] != null).join(', ').slice(0, 120) || 'no fields'})`);
    res.json({ ok: true });
  });
  api.post('/apikey/regenerate', (req, res) => {
    const key = crypto.randomBytes(24).toString('hex');
    S.set('api.key', key);
    ring.info('apikey.regenerated', 'Owner API key regenerated from the dashboard');
    AUD.log('owner', 'apikey.regenerate', 'Owner API key regenerated — the old key stopped working immediately');
    res.json({ ok: true, apiKey: key });
  });

  /* ---- 5A (v7.7.0): approval queue, live queue, source rules, matrix, latency, undo ---- */
  api.get('/queue', (req, res) => res.json({ ok: true, ...queue5a.liveView() }));
  api.get('/delivery/review', (req, res) => res.json({ ok:true, items:require('../delivery-ledger').review() }));
  api.post('/delivery/review/:id', (req, res) => {
    try { if (req.body?.confirmed !== true) throw new Error('Confirm that you checked the target first.'); res.json({ok:true, result:require('../delivery-ledger').resolve(req.params.id,req.body?.action)}); }
    catch (err) { res.status(400).json({ok:false,error:err.message}); }
  });
  api.post('/queue/:id(\\d+)', (req, res) => {
    const action = String(req.body?.action || '');
    try {
      if (action === 'approve') return res.json({ ok: true, item: queue5a.approve(req.params.id, String(req.body?.note || '')) });
      if (action === 'reject') return res.json({ ok: true, item: queue5a.reject(req.params.id, String(req.body?.note || '')) });
      if (action === 'retry') return res.json({ ok: true, item: queue5a.retry(req.params.id) });
      if (action === 'dismiss') return res.json({ ok: true, item: queue5a.dismiss(req.params.id) });
      if (action === 'edit-approve') {
        const t = String(req.body?.text || '');
        if (!t.trim()) return res.status(400).json({ ok: false, error: 'Text is required.' });
        queue5a.editText(req.params.id, t);
        return res.json({ ok: true, item: queue5a.approve(req.params.id, 'edited + approved') });
      }
      res.status(400).json({ ok: false, error: 'Unknown action.' });
    } catch (err) { res.status(400).json({ ok: false, error: err.message }); }
  });
  api.post('/queue/approve-all', (req, res) => res.json({ ok: true, n: queue5a.approveAll() }));
  api.post('/posts/dismiss-failed', (req, res) => {
    try {
      require('../db').open().prepare('UPDATE posts SET dismissed=1 WHERE id=? AND status=\'failed\'').run(Number(req.body?.id || 0));
      AUD.log('owner', 'post.dismiss', `Dismissed failed post ${req.body?.id}`);
      res.json({ ok: true });
    } catch (err) { res.status(400).json({ ok: false, error: err.message }); }
  });
  api.post('/queue/retry-all', async (req, res) => { try { res.json({ ok: true, ...(await queue5a.retryAllFailed()) }); } catch (err) { res.status(400).json({ ok: false, error: err.message }); } });
  api.post('/queue/delay', (req, res) => {
    const min = Math.max(0, Math.min(1440, parseInt(req.body?.min, 10) || 0));
    S.set('queue.delay.min', String(min));
    AUD.log('owner', 'queue.delay', `Delay buffer set to ${min} min`);
    res.json({ ok: true, min });
  });
  api.get('/source-rules', (req, res) => res.json({ ok: true, list: SR.all().map((r) => ({ ...r, name: nameOrJid(r.source_jid) })) }));
  api.post('/source-rules', (req, res) => {
    const jid = decodeURIComponent(String(req.params?.jid || req.body?.jid || ''));
    if (!jid.endsWith('@newsletter')) return res.status(400).json({ ok: false, error: 'A source channel is required.' });
    const b = req.body || {};
    SR.save(jid, {
      approve_first: b.approve_first, active_from: b.active_from, active_to: b.active_to,
      max_per_day: b.max_per_day, include: b.include, exclude: b.exclude, auto_pause: b.auto_pause, priority: b.priority
    });
    AUD.log('owner', 'source.rules', `Rule card saved for ${jid} (approveFirst=${b.approve_first ? 1 : 0}, cap=${b.max_per_day || 0}, hours=${b.active_from || ''}–${b.active_to || ''})`);
    res.json({ ok: true, rule: SR.get(jid) });
  });
  api.get('/routing-matrix', (req, res) => {
    const sources = CH.listSources().map((c) => ({ jid: c.jid, name: nameOrJid(c.jid) }));
    const targets = CH.listTargets().map((c) => ({ jid: c.jid, name: nameOrJid(c.jid) }));
    const cells = RC.cells();
    res.json({ ok: true, sources, targets, cells, on: pipeline.switches().matrix });
  });
  api.post('/routing-matrix', (req, res) => {
    const list = Array.isArray(req.body?.cells) ? req.body.cells : [];
    for (const c of list.slice(0, 400)) {
      const sj = decodeURIComponent(String(c.source_jid || ''));
      const tj = decodeURIComponent(String(c.target_jid || ''));
      if (!sj.endsWith('@newsletter') || !tj.endsWith('@newsletter')) continue;
      if (c.enabled === null || c.enabled === undefined && c.reset) RC.del(sj, tj);   // back to default (mapping behavior)
      else RC.set(sj, tj, Boolean(c.enabled));
    }
    AUD.log('owner', 'routing.matrix', `Routing matrix updated (${list.length} cells)`);
    res.json({ ok: true, cells: RC.cells() });
  });
  api.get('/latency', (req, res) => res.json({ ok: true, ...LAT.stats(7) }));
  api.post('/undo-last', async (req, res) => {
    try {
      const jid = decodeURIComponent(String(req.body?.target_jid || ''));
      if (!jid.endsWith('@newsletter')) return res.status(400).json({ ok: false, error: 'Pick the target channel to undo on.' });
      const r = await queue5a.undoLast(jid);
      res.json({ ok: true, ...r });
    } catch (err) { res.status(400).json({ ok: false, error: err.message }); }
  });
  api.get('/scheduler/calendar', (req, res) => res.json({ ok: true, ...power.calendar(String(req.query.month || '')) }));
  api.patch('/power/scheduler/:id', (req, res) => {
    // existing enabled-toggle stays; 5A: repeat/weekdays/interval/tz/template edits
    const l = power.jobs(); const j = l.find((x) => x.id === req.params.id);
    if (!j) return res.status(404).json({ ok: false, error: 'Job not found.' });
    const b = req.body || {};
    if (b.enabled !== undefined) j.enabled = Boolean(b.enabled);
    if (['once', 'daily', 'weekly', 'weekdays', 'interval'].includes(b.repeat)) j.repeat = b.repeat;
    if (b.repeat === 'weekdays' || b.weekdays != null) j.weekdays = String(b.weekdays || j.weekdays || '1,2,3,4,5').slice(0, 20);
    if (b.repeat === 'interval' || b.intervalMin != null) j.intervalMin = Math.max(1, Math.min(10080, parseInt(b.intervalMin, 10) || j.intervalMin || 30));
    if (b.tz) j.tz = String(b.tz).slice(0, 40);
    if (b.templateId != null) j.templateId = String(b.templateId || '').slice(0, 120);
    try { power.resave(l); } catch { }
    AUD.log('owner', 'scheduler.edit', `Scheduled post "${j.name || j.id}" updated (repeat=${j.repeat})`);
    res.json({ ok: true, job: j });
  });

  app.use('/api', api);

  /* ---- errors: honest, never silent ---- */
  app.use((err, req, res, next) => {
    logger.error({ err: err.message, url: req.url }, 'web error');
    if (res.headersSent) return next(err);
    res.status(500).json({ ok: false, error: 'Server error — see the Logs tab.' });
  });
}

/** Resolve an input (invite link or JID or picker name) into a channel add. */
const withTimeout = (p, ms, fallback) => Promise.race([
  Promise.resolve(p).catch(() => fallback),
  new Promise((r) => setTimeout(() => r(fallback), ms))
]);

async function resolveAndAdd(input, kind, fast) {
  if (!input) return { ok: false, message: 'Give an invite link or pick a channel.' };
  const sock = wa.getSocket();
  let jid = ''; let name = ''; let role = '';
  const m = String(input).match(/whatsapp\.com\/channel\/([A-Za-z0-9_-]+)/);
  if (m) {
    if (!sock) return { ok: false, message: 'Connect WhatsApp first (scan the QR), then add by invite link.' };
    const meta = await withTimeout(sock.newsletterMetadata('invite', m[1]), 8000, null);
    jid = meta?.id || ''; name = meta?.name || '';
    if (!jid) return { ok: false, message: 'WhatsApp did not return channel details for that invite (wrong link, or WhatsApp is unreachable).' };
  } else if (input.includes('@newsletter')) {
    jid = input.trim(); name = jid;
    if (fast) {
      const d = CH.dirList().find((x) => x.jid === jid);
      if (d?.name) { name = d.name; role = d.role || ''; }
    }
    if (sock && (!fast || (name === jid || !role) && numbers.statusOf('main') === 'open')) {
      const meta = await withTimeout(wa.channelMeta(sock, jid), 5000, null); // unknown JIDs can hang — never block the UI
      if (meta?.name) { name = meta.name; role = meta.role || ''; }
    }
  } else {
    const dir = CH.dirList();
    const hit = dir.find((c) => c.jid === input) || dir.find((c) => (c.name || '').toLowerCase().includes(input.toLowerCase()));
    if (!hit) return { ok: false, message: 'No channel matches — press Refresh list or paste an invite link.' };
    jid = hit.jid; name = hit.name; role = hit.role || '';
  }
  // v6.4: a TARGET must be a channel this account can post in (owner/admin) —
  // WhatsApp refuses posts from plain followers, so adding one would fail silently forever
  if (kind === 'targets') {
    if (!role && sock && (!fast || numbers.statusOf('main') === 'open')) {
      const meta = await withTimeout(wa.channelMeta(sock, jid), 6000, null);
      if (meta) { if (meta.name && (!name || name === jid)) name = meta.name; role = meta.role || ''; }
    }
    if (role && role !== 'OWNER' && role !== 'ADMIN') {
      return { ok: false, message: `"${name || jid}" — this account is only a follower there. Only channels where you are owner or admin can be targets (WhatsApp refuses posts from followers).` };
    }
  }
  if (name && name !== jid) CH.recordDir(jid, name, role || null); // the pickers learn this channel too
  const r = (kind === 'sources' ? CH.addSource : CH.addTarget)(jid, name, 'dashboard');
  if (!r.ok && r.existed) return { ok: false, message: 'That channel is already in the list.' };
  if (kind === 'sources') {
    if (fast) { Promise.resolve().then(() => channels.subscribe(jid)).catch(() => { }); } // bulk: don't hold the HTTP request open
    else { try { await withTimeout(channels.subscribe(jid), 8000, false); } catch { } } // hands-off: subscribed immediately
  }
  ring.info(`channel.${kind}.add`, `${kind === 'sources' ? 'Source' : 'Target'} added: ${name || jid}`);
  return { ok: true, message: `${name || jid} added.` };
}

module.exports = { build };
