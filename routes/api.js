import { Router } from 'express';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { store, DATA_DIR, DB_FILE } from '../lib/store.js';
import { simTelegram, simWhatsApp, simAI } from '../services/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const r = Router();
const db = () => store.load();

/* helper: state change + audit + save */
function changed(action, target, extra = {}) {
  const d = db();
  d.audit.unshift({ id: (d.audit.at(-1)?.id || 0) + 1, action, target, actor: extra.actor || 'Admin', at: Date.now() });
  if (d.audit.length > 400) d.audit.length = 400;
  store.log('info', `${action} (${target})`);
  store.save();
  return { ok: true };
}
const fail = (res, msg, code = 400, extra = {}) => res.status(code).json({ ok: false, error: msg, ...extra });
const str = (v, max = 200) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const num = (v, min = -1e9, max = 1e9) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : NaN);

/* ── settings ─────────────────────────────────────────────────── */
r.get('/settings', (req, res) => {
  const s = db().settings;
  res.json({ ok: true, settings: { ...s, pinHash: undefined, waOwner: s.waOwner } });
});

r.put('/settings', (req, res) => {
  const d = db();
  const s = d.settings;
  const b = req.body || {};
  if (s.switches.pin_for_changes && !b.pin) return fail(res, 'PIN required', 403, { needPin: true });
  if (typeof b.name === 'string') s.name = b.name.trim().slice(0, 60) || s.name;
  if (typeof b.botName === 'string') s.botName = b.botName.trim().slice(0, 60) || s.botName;
  if (b.reportTime && /^[0-2]\d:[0-5]\d$/.test(String(b.reportTime))) s.reportTime = b.reportTime;
  if (['en', 'ur'].includes(b.language)) s.language = b.language;
  if (typeof b.timezone === 'string' && b.timezone.length < 60) s.timezone = b.timezone;
  if (['dark', 'light', 'auto'].includes(b.theme)) s.theme = b.theme;
  if (['emerald', 'violet'].includes(b.accent)) s.accent = b.accent;
  if (typeof b.waOwner === 'string') s.waOwner = b.waOwner.trim().slice(0, 24) || s.waOwner;
  if (typeof b.channelName === 'string') s.channelName = b.channelName.trim().slice(0, 60) || s.channelName;
  if (Array.isArray(b.allowedCommands)) s.allowedCommands = b.allowedCommands.slice(0, 12).map((c) => str(c, 24)).filter(Boolean);
  if (b.pacing && typeof b.pacing === 'object') {
    const p = s.pacing;
    if (['Slow', 'Normal', 'Fast', 'Custom'].includes(b.pacing.speed)) p.speed = b.pacing.speed;
    if (typeof b.pacing.adaptive === 'boolean') p.adaptive = b.pacing.adaptive;
    for (const k of ['minDelay', 'maxDelay', 'maxPerMin', 'dailyCap', 'jitter', 'burst']) {
      const v = num(b.pacing[k]);
      if (!Number.isNaN(v)) p[k] = v;
    }
    if (/^[0-2]\d:[0-5]\d$/.test(String(b.pacing.quietFrom || ''))) p.quietFrom = b.pacing.quietFrom;
    if (/^[0-2]\d:[0-5]\d$/.test(String(b.pacing.quietTo || ''))) p.quietTo = b.pacing.quietTo;
    if (Array.isArray(b.pacing.bestTime)) p.bestTime = b.pacing.bestTime.slice(0, 3).map((x) => str(x, 16));
    if (typeof b.pacing.weekendSat === 'boolean') p.weekendSat = b.pacing.weekendSat;
    if (typeof b.pacing.weekendSun === 'boolean') p.weekendSun = b.pacing.weekendSun;
  }
  if (b.automation && typeof b.automation === 'object') {
    const a = s.automation;
    if (['manual', 'trusted', 'auto'].includes(b.automation.approval)) a.approval = b.automation.approval;
    const bulk = num(b.automation.bulkDelay); if (!Number.isNaN(bulk)) a.bulkDelay = bulk;
    const rt = num(b.automation.retries, 0, 5); if (!Number.isNaN(rt)) a.retries = rt;
    if (['30s', '2m', '10m'].includes(b.automation.backoff)) a.backoff = b.automation.backoff;
    const age = num(b.automation.maxPostAge, 0, 720); if (!Number.isNaN(age)) a.maxPostAge = age;
    if (['none', 'ur', 'en'].includes(b.automation.translateTo)) a.translateTo = b.automation.translateTo;
    if (typeof b.automation.shortenerDomain === 'string') a.shortenerDomain = str(b.automation.shortenerDomain, 60);
  }
  if (b.ai && typeof b.ai === 'object') {
    const a = s.ai;
    if (['off', 'suggest', 'auto'].includes(b.ai.pilotMode)) a.pilotMode = b.ai.pilotMode;
    for (const k of ['blocklist', 'allowlist', 'flagKeywords']) {
      if (Array.isArray(b.ai[k])) a[k] = b.ai[k].slice(0, 40).map((x) => str(x, 40)).filter(Boolean);
    }
    const ml = num(b.ai.minTextLength, 0, 10000); if (!Number.isNaN(ml)) a.minTextLength = ml;
  }
  if (b.notifications && typeof b.notifications === 'object') {
    const n = s.notifications;
    const pt = num(b.notifications.pendingThreshold, 1, 999); if (!Number.isNaN(pt)) n.pendingThreshold = pt;
    const ht = num(b.notifications.healthThreshold, 0, 100); if (!Number.isNaN(ht)) n.healthThreshold = ht;
    if (['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'].includes(b.notifications.digestDay)) n.digestDay = b.notifications.digestDay;
  }
  if (b.storage && typeof b.storage === 'object') {
    const st = s.storage;
    const lr = num(b.storage.logRetention, 1, 3650); if (!Number.isNaN(lr)) st.logRetention = lr;
    const ar = num(b.storage.auditRetention, 1, 3650); if (!Number.isNaN(ar)) st.auditRetention = ar;
    if (['daily', 'weekly'].includes(b.storage.backupFreq)) st.backupFreq = b.storage.backupFreq;
    if (['none', 's3', 'gdrive', 'dropbox'].includes(b.storage.cloudProvider)) st.cloudProvider = b.storage.cloudProvider;
  }
  changed('settings:saved', 'settings', { actor: 'Admin' });
  res.json({ ok: true });
});

r.patch('/settings/switches/:key', (req, res) => {
  const d = db();
  const s = d.settings;
  const k = req.params.key;
  if (!(k in s.switches)) return fail(res, 'Unknown switch: ' + k);
  const v = req.body && typeof req.body.value === 'boolean' ? req.body.value : !s.switches[k];
  s.switches[k] = v;
  changed(`switch:${k} → ${v ? 'on' : 'off'}`, 'settings');
  res.json({ ok: true, key: k, value: v, on: Object.values(s.switches).filter(Boolean).length });
});

r.post('/settings/pin', (req, res) => {
  const d = db();
  const pin = String((req.body || {}).pin || '');
  if (!/^\d{4,8}$/.test(pin)) return fail(res, 'PIN must be 4–8 digits');
  d.settings.pinHash = 'sha256:salt:' + crypto.createHash('sha256').update('rq:' + pin).digest('hex');
  d.settings.pinChanged = Date.now();
  changed('security:pin updated', 'settings');
  res.json({ ok: true });
});

/* ── panic stop (global, 1 tap, no confirm) ───────────────────── */
r.post('/panic', (req, res) => {
  const d = db();
  d.paused = !d.paused;
  const on = d.paused;
  d.recentActivity.unshift({
    id: Date.now(),
    kind: on ? 'failed' : 'published',
    status: on ? 'Paused' : 'Resumed',
    text: on ? 'Panic Stop engaged by owner' : 'Publishing resumed by owner',
    at: Date.now(), ok: !on,
  });
  d.recentActivity.length = Math.min(d.recentActivity.length, 20);
  simWhatsApp.line(on ? 'PAUSED by owner (Panic Stop)' : 'RESUMED by owner');
  changed(on ? 'panic:engaged' : 'panic:resumed', 'bot');
  store.log(on ? 'warn' : 'info', on ? 'Panic Stop engaged — publishing paused' : 'Panic Stop released — publishing resumed');
  store.saveNow();
  res.json({ ok: true, paused: d.paused });
});

/* ── health ───────────────────────────────────────────────────── */
r.get('/health', (req, res) => res.json({ ok: true, health: db().health, paused: db().paused }));
r.post('/health/self-test', (req, res) => {
  const d = db();
  changed('health:self-test run', 'health');
  res.json({ ok: true, score: d.health.score, checks: d.health.checks.map((c) => ({ ...c })) });
});

/* ── queue ────────────────────────────────────────────────────── */
r.get('/queue', (req, res) => {
  const d = db();
  let items = d.queue;
  const st = String(req.query.status || '');
  const ty = String(req.query.type || '');
  if (st && st !== 'all') items = items.filter((q) => q.status === st);
  if (ty === 'text') items = items.filter((q) => q.media === 'text');
  if (ty === 'media') items = items.filter((q) => q.media !== 'text');
  res.json({ ok: true, items });
});

const qSetStatus = (id, status) => {
  const d = db();
  const item = d.queue.find((q) => q.id === id);
  if (!item) return null;
  item.status = status;
  return item;
};

r.post('/queue/:id/approve', (req, res) => {
  const item = qSetStatus(parseInt(req.params.id, 10), 'approved');
  if (!item) return fail(res, 'Post not found', 404);
  d_activity(db(), `Approved · ${item.title} → ${item.targets} targets`);
  changed('queue:approved ' + item.title, 'queue');
  res.json({ ok: true, id: item.id, status: item.status });
});

r.post('/queue/:id/discard', (req, res) => {
  const d = db();
  const i = d.queue.findIndex((q) => q.id === parseInt(req.params.id, 10));
  if (i < 0) return fail(res, 'Post not found', 404);
  const [item] = d.queue.splice(i, 1);
  d.history.unshift({
    id: (d.history.at(-1)?.id || 0) + 1, at: Date.now(), title: item.title,
    source: item.source, targets: item.targets, status: 'skipped', latency: 0, targetsResults: [],
  });
  changed('queue:discarded ' + item.title, 'queue');
  res.json({ ok: true, id: item.id });
});

r.put('/queue/:id', (req, res) => {
  const d = db();
  const item = d.queue.find((q) => q.id === parseInt(req.params.id, 10));
  if (!item) return fail(res, 'Post not found', 404);
  const b = req.body || {};
  if (typeof b.title === 'string' && b.title.trim()) item.title = b.title.trim().slice(0, 120);
  if (typeof b.text === 'string') item.text = b.text.slice(0, 2000);
  if (Array.isArray(b.tags)) item.tags = b.tags.slice(0, 12).map((t) => str(t, 24));
  if (Array.isArray(b.targetNames)) item.targetNames = b.targetNames.slice(0, 60).map((t) => str(t, 60));
  const n = num(b.targets, 1, 48); if (!Number.isNaN(n)) item.targets = n;
  if (b.at && Number.isFinite(b.at)) item.at = b.at;
  if (typeof b.note === 'string') item.note = str(b.note, 200);
  changed('queue:edited ' + item.title, 'queue');
  res.json({ ok: true, item });
});

r.post('/queue/bulk', (req, res) => {
  const d = db();
  const b = req.body || {};
  const ids = Array.isArray(b.ids) ? b.ids.map((x) => parseInt(x, 10)).filter(Number.isFinite) : [];
  const action = String(b.action || '');
  if (!ids.length) return fail(res, 'No posts selected');
  if (!['approve', 'discard', 'delay'].includes(action)) return fail(res, 'Unknown action');
  let n = 0;
  const delayMin = num(b.delayMin, 1, 60 * 24);
  for (const id of ids) {
    const item = d.queue.find((q) => q.id === id);
    if (!item) continue;
    if (action === 'approve') item.status = 'approved';
    else if (action === 'discard') {
      const i = d.queue.findIndex((q) => q.id === id);
      d.queue.splice(i, 1);
    } else {
      item.status = 'delayed';
      item.at = Date.now() + (Number.isNaN(delayMin) ? 5 : delayMin) * 60_000;
      item.note = `Delayed ${Number.isNaN(delayMin) ? 5 : delayMin} min (bulk)`;
    }
    n++;
  }
  d_activity(db(), `${action === 'approve' ? 'Bulk approved' : action === 'discard' ? 'Bulk discarded' : 'Bulk delayed'} · ${n} posts`);
  changed(`queue:bulk ${action} (${n})`, 'queue');
  res.json({ ok: true, n });
});

/* ── CRUD collections ─────────────────────────────────────────── */
function crud(name, validate) {
  const col = name.replace(/\//g, '-');
  r.get(name, (req, res) => res.json({ ok: true, items: store.get(col) }));
  r.post(name, (req, res) => {
    const row = validate(req.body || {});
    if (!row) return fail(res, 'Invalid input');
    const item = store.insert(col, row);
    changed(`${col}:created ${item.name || item.title}`, name);
    res.json({ ok: true, item });
  });
  r.put(`${name}/:id`, (req, res) => {
    const id = parseInt(req.params.id, 10);
    const existing = store.find(col, (x) => x.id === id);
    if (!existing) return fail(res, 'Not found', 404);
    const merged = { ...existing, ...(req.body || {}) };
    const item = store.update(col, id, validate(merged, true));
    if (!item) return fail(res, 'Invalid input', 400);
    changed(`${col}:updated ${item.name || item.title}`, name);
    res.json({ ok: true, item });
  });
  r.delete(`${name}/:id`, (req, res) => {
    const id = parseInt(req.params.id, 10);
    const item = store.find(col, (x) => x.id === id);
    if (!store.remove(col, id)) return fail(res, 'Not found', 404);
    changed(`${col}:deleted ${item?.name || item?.title || ''}`, name);
    res.json({ ok: true });
  });
}

crud('/sources', (b) => {
  const name = str(b.name, 60);
  const handle = str(b.handle, 60) || str(b.link, 60);
  if (!name || !handle) return null;
  const ruleDefaults = { approval: 'inherit', include: [], exclude: [], mediaOnly: false, maxPerHour: 20, routes: [], translate: 'none', footer: false, stripLinks: false, trusted: false };
  return {
    name, handle: handle.startsWith('@') || handle.includes('/') ? handle : '@' + handle,
    subs: str(b.subs, 10) || (typeof b.subs === 'string' ? b.subs : '1.0K'), status: b.status === 'paused' ? 'paused' : 'active',
    last: b.last || Date.now(),
    rules: { ...ruleDefaults, ...(typeof b.rules === 'object' && b.rules) },
  };
});
crud('/targets', (b) => {
  const name = str(b.name, 60);
  const link = str(b.link, 40);
  const kind = ['channel', 'group', 'user'].includes(b.kind) ? b.kind : 'channel';
  if (!name || !link) return null;
  return {
    name, handle: kind === 'user' ? link : (link.startsWith('@') ? link : '@' + link.replace(/[^a-z0-9]/gi, '').toLowerCase()),
    kind,
    status: b.status === 'paused' ? 'paused' : b.status === 'error' ? 'error' : 'active',
    members: Number.isFinite(parseInt(b.members, 10)) ? parseInt(b.members, 10) : (kind === 'user' ? 1 : 1000),
    last: b.last || Date.now(),
    rules: { types: 'all', lang: 'auto', maxPerDay: 50, footer: false, ...(typeof b.rules === 'object' && b.rules) },
    error: b.error === null ? null : b.error,
  };
});
crud('/routes', (b) => ({
  source: str(b.source, 60),
  targets: Array.isArray(b.targets) ? b.targets.slice(0, 30).map((t) => str(t, 60)) : [],
  when: { keywords: str(b.keywords, 120), media: !!b.media, lang: ['en', 'ur', 'any'].includes(b.lang) ? b.lang : 'any' },
  delay: num(b.delay, 0, 1440) || 0,
  approval: ['inherit', 'manual', 'auto'].includes(b.approval) ? b.approval : 'inherit',
  on: b.on !== false,
}));
crud('/rules', (b) => {
  const name = str(b.name, 80);
  if (!name) return null;
  return {
    name,
    cond: { type: ['keyword', 'media', 'source', 'length'].includes(b.condType) ? b.condType : 'keyword', value: str(b.condValue, 120) },
    act: { type: ['skip', 'flag', 'delay', 'route'].includes(b.actType) ? b.actType : 'skip', value: str(b.actValue, 60) },
    priority: num(b.priority, 1, 99) || 1,
    on: b.on !== false,
  };
});
crud('/contacts', (b) => {
  const name = str(b.name, 60);
  const phone = str(b.phone, 24);
  if (!name || !phone) return null;
  return { name, phone, role: ['owner', 'admin', 'viewer'].includes(b.role) ? b.role : 'viewer', tag: str(b.tag, 20) || 'team', last: Date.now() };
});
crud('/auto-replies', (b) => {
  const trigger = str(b.trigger, 60);
  if (!trigger) return null;
  return { trigger, match: b.match === 'exact' ? 'exact' : 'contains', reply: str(b.reply, 500) || '…', scope: b.scope === 'owner' ? 'owner' : 'all', active: b.active !== false };
});
crud('/scheduled', (b) => {
  const title = str(b.title, 120);
  const at = num(b.at, Date.now(), Date.now() + 366 * 86_400_000);
  if (!title || Number.isNaN(at)) return null;
  return { title, at, targets: num(b.targets, 1, 48) || 1 };
});

/* library (typed collection: library/<type>) */
r.get('/library/:type', (req, res) => {
  const t = req.params.type;
  if (!['template', 'media', 'snippet'].includes(t)) return fail(res, 'Bad type');
  res.json({ ok: true, items: db().library.filter((l) => l.kind === t) });
});
r.post('/library/:type', (req, res) => {
  const t = req.params.type;
  if (!['template', 'media', 'snippet'].includes(t)) return fail(res, 'Bad type');
  const b = req.body || {};
  const name = str(b.name, 80);
  if (!name) return fail(res, 'Name required');
  const d = db();
  const item = store.insert('library', { kind: t, name, content: str(b.content, 1000), tags: Array.isArray(b.tags) ? b.tags.map((x) => str(x, 24)).slice(0, 8) : [], tint: b.tint || 'emerald', motif: b.motif || 'text', created: Date.now() });
  changed(`library:added ${name}`, 'library');
  res.json({ ok: true, item });
});
r.delete('/library/:id', (req, res) => {
  const d = db();
  const item = store.find('library', (x) => x.id === parseInt(req.params.id, 10));
  if (!store.remove('library', parseInt(req.params.id, 10))) return fail(res, 'Not found', 404);
  changed(`library:deleted ${item?.name || ''}`, 'library');
  res.json({ ok: true });
});

/* ── stats / activity ─────────────────────────────────────────── */
r.get('/stats', (req, res) => {
  const d = db();
  const range = ['1h', '24h', '7d', '30d', '90d'].includes(req.query.range) ? req.query.range : '7d';
  res.json({ ok: true, range, series: d.analytics.series[range], stats: d.analytics.stats[range], kpis: d.analytics.kpis, top: d.analytics.topSources });
});
r.get('/activity', (req, res) => res.json({ ok: true, items: db().recentActivity.slice(0, 12) }));

/* SSE: live recent activity (spec §11) */
r.get('/activity/stream', (req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  res.write('retry: 3000\n\n');
  let last = req.query.since ? parseInt(req.query.since, 10) : Date.now();
  const send = () => {
    const items = db().recentActivity.filter((a) => a.at > last).slice(0, 5);
    if (items.length) {
      last = Math.max(...items.map((a) => a.at));
      res.write(`data: ${JSON.stringify(items)}\n\n`);
    }
  };
  send();
  const iv = setInterval(send, 20_000);
  req.on('close', () => clearInterval(iv));
});

/* ── backup / restore / export ────────────────────────────────── */
r.post('/backup', (req, res) => {
  try {
    const d = db();
    const dir = path.join(DATA_DIR, 'backups');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `backup-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
    store.saveNow();
    fs.copyFileSync(DB_FILE, file);
    changed('backup:created', 'storage');
    res.json({ ok: true, file: path.basename(file) });
  } catch (e) {
    fail(res, 'Backup failed: ' + e.message);
  }
});
r.post('/restore', (req, res) => {
  const b = req.body || {};
  if (b.file) {
    try {
      const p = path.join(DATA_DIR, 'backups', path.basename(String(b.file)));
      const data = JSON.parse(fs.readFileSync(p, 'utf8'));
      if (!data.settings || !Array.isArray(data.queue)) throw new Error('bad shape');
      store.reset(data);
      changed('storage:restored ' + path.basename(p), 'storage');
      return res.json({ ok: true });
    } catch (e) {
      return fail(res, 'Restore failed: ' + e.message);
    }
  }
  const raw = b.json;
  if (!raw) return fail(res, 'Nothing to restore');
  try {
    const data = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!data.settings || !Array.isArray(data.queue)) throw new Error('bad shape');
    store.reset(data);
    changed('storage:restored', 'storage');
    res.json({ ok: true });
  } catch (e) {
    fail(res, 'Restore failed: invalid JSON or shape');
  }
});
r.get('/export', (req, res) => {
  const d = db();
  const out = JSON.stringify(d, null, 1);
  res.setHeader('Content-Disposition', 'attachment; filename="raqifluz-export.json"');
  res.setHeader('Content-Type', 'application/json');
  res.send(out);
});

/* ── extras used by pages ─────────────────────────────────────── */
r.put('/brand', (req, res) => {
  const d = db();
  const b = req.body || {};
  const br = d.brand;
  if (typeof b.name === 'string' && b.name.trim()) br.name = b.name.trim().slice(0, 60);
  if (typeof b.tagline === 'string') br.tagline = str(b.tagline, 120);
  if (['casual', 'professional', 'urgent'].includes(b.tone)) br.tone = b.tone;
  if (typeof b.footer === 'string') br.footer = str(b.footer, 200);
  if (Array.isArray(b.hashtags)) {
    br.hashtags = b.hashtags.slice(0, 12).map((s) => ({ name: str(s.name, 40) || 'Set', tags: (s.tags || []).map((x) => str(x, 24)).slice(0, 20) }));
  }
  if (b.watermark && typeof b.watermark === 'object') {
    if (['top-start', 'top-end', 'bottom-start', 'bottom-end'].includes(b.watermark.pos)) br.watermark.pos = b.watermark.pos;
    const op = num(b.watermark.opacity, 0, 100); if (!Number.isNaN(op)) br.watermark.opacity = op;
  }
  changed('brand:saved', 'brand');
  res.json({ ok: true, brand: br });
});

r.post('/wa/test', (req, res) => {
  const d = db();
  simWhatsApp.line(`Test message to ${d.settings.waOwner} (simulated)`);
  changed('whatsapp:test message', 'whatsapp');
  res.json({ ok: true, to: d.settings.waOwner });
});
r.post('/wa/cmd', (req, res) => {
  const d = db();
  const cmd = str((req.body || {}).cmd, 60);
  if (!cmd) return fail(res, 'Empty command');
  const reply = simWhatsApp.reply(cmd);
  d.waMessages.unshift({ id: (d.waMessages.at(-1)?.id || 0) + 1, dir: 'in', from: d.settings.waOwner, text: cmd, at: Date.now() });
  d.waMessages.unshift({ id: (d.waMessages.at(-1)?.id || 0) + 1, dir: 'out', text: reply, at: Date.now() });
  d.waMessages.length = Math.min(d.waMessages.length, 30);
  changed(`whatsapp:cmd ${cmd}`, 'whatsapp', { actor: 'WhatsApp cmd' });
  store.saveNow();
  res.json({ ok: true, reply, messages: d.waMessages.slice(0, 12), paused: d.paused });
});

r.post('/pilot/:id', (req, res) => {
  const d = db();
  const id = parseInt(req.params.id, 10);
  const s = d.pilotSuggestions.find((x) => x.id === id);
  if (!s) return fail(res, 'Suggestion not found', 404);
  const act = String((req.body || {}).action || 'dismiss');
  const i = d.pilotSuggestions.findIndex((x) => x.id === id);
  if (i >= 0) d.pilotSuggestions.splice(i, 1);
  d.pilotEvents.unshift({ id: Date.now(), at: Date.now(), msg: (act === 'accept' ? 'Applied: ' : 'Dismissed: ') + s.title, ok: true });
  d.pilotEvents.length = Math.min(d.pilotEvents.length, 12);
  changed(`pilot:${act} ${s.title}`, 'pilot');
  res.json({ ok: true, act });
});

r.post('/notifs/read', (req, res) => {
  const d = db();
  d.notifications.items.forEach((n) => { n.read = true; });
  d.notifications.unread = 0;
  changed('notifications:all read', 'notifications');
  res.json({ ok: true });
});

r.post('/reports', (req, res) => {
  const d = db();
  const b = req.body || {};
  const type = ['daily', 'weekly', 'monthly'].includes(b.type) ? b.type : 'daily';
  const range = ['7d', '30d', '90d'].includes(b.range) ? b.range : '7d';
  const s = d.analytics.stats[range];
  d.reports.unshift({
    id: (d.reports.at(-1)?.id || 0) + 1, type,
    date: range === '7d' ? 'Last 7 days' : range === '30d' ? 'Last 30 days' : 'Last 90 days',
    at: Date.now(), meta: `${s.total} published · ${s.skipped} skipped · ${s.failed} failed`, size: '16 KB',
  });
  changed(`reports:generated ${type} ${range}`, 'reports');
  res.json({ ok: true, reports: d.reports.slice(0, 10) });
});

r.post('/discover/:id', (req, res) => {
  const d = db();
  const item = d.discover.find((x) => x.id === parseInt(req.params.id, 10));
  if (!item) return fail(res, 'Not found', 404);
  store.insert('sources', { name: item.name, handle: item.handle, subs: item.subs, status: 'active', last: Date.now(), rules: { approval: 'inherit', include: [], exclude: [], mediaOnly: false, maxPerHour: 20, routes: [], translate: 'none', footer: false, stripLinks: false, trusted: false } });
  changed(`discover:added ${item.name}`, 'sources');
  res.json({ ok: true, source: d.sources.at(-1) });
});

r.post('/contacts/test', (req, res) => {
  const name = str((req.body || {}).name, 60);
  if (!name) return fail(res, 'Name required');
  changed(`contacts:test dm ${name}`, 'contacts');
  res.json({ ok: true, name });
});

r.post('/auto-replies/test', (req, res) => {
  const d = db();
  const msg = str((req.body || {}).msg, 300).toLowerCase();
  if (!msg) return fail(res, 'Type a message first');
  const hit = d.autoReplies.find((a) => a.active && (a.match === 'exact' ? msg === a.trigger.toLowerCase() : msg.includes(a.trigger.toLowerCase())));
  res.json({ ok: true, hit: hit ? { trigger: hit.trigger, reply: hit.reply } : null });
});

r.post('/compose', (req, res) => {
  const d = db();
  const b = req.body || {};
  const text = str(b.text, 2000);
  if (!text) return fail(res, 'Message is empty');
  const targets = Array.isArray(b.targets) ? b.targets.slice(0, 48) : [];
  if (!targets.length) return fail(res, 'Select at least one target');
  const delivery = ['queue', 'schedule', 'now'].includes(b.delivery) ? b.delivery : 'queue';
  const at = num(b.at, Date.now(), Date.now() + 366 * 86_400_000);
  const title = str(b.title, 120) || text.slice(0, 60) + (text.length > 60 ? '…' : '');
  if (delivery === 'schedule') {
    if (Number.isNaN(at)) return fail(res, 'Pick a time to schedule');
    store.insert('scheduled', { title, at, targets: targets.length });
    changed('scheduled:created ' + title, 'scheduled');
  } else {
    store.insert('queue', { title, text, tags: (b.tags || []).map((x) => str(x, 24)).slice(0, 12), source: 'Manual', targets: targets.length, at: Date.now(), media: b.media || 'text', status: 'pending', note: delivery === 'now' ? 'Published immediately (simulated)' : '' });
    if (delivery === 'now') simWhatsApp.line(`Published now: ${title.slice(0, 48)}`);
    changed(`compose:added ${title}`, 'queue');
  }
  res.json({ ok: true, delivery });
});

r.post('/history/:id/retry', (req, res) => {
  const d = db();
  const item = d.history.find((h) => h.id === parseInt(req.params.id, 10));
  if (!item) return fail(res, 'Not found', 404);
  store.insert('scheduled', { title: item.title + ' (retry)', at: Date.now() + 5 * 60_000, targets: item.targets });
  changed(`history:retry ${item.title}`, 'history');
  res.json({ ok: true });
});

r.post('/notify/test', (req, res) => {
  changed('notifications:test sent', 'notifications');
  res.json({ ok: true });
});

function d_activity(d, text) {
  d.recentActivity.unshift({ id: Date.now(), kind: 'published', status: 'Published', text, at: Date.now(), ok: true });
  d.recentActivity.length = Math.min(d.recentActivity.length, 20);
}

export default r;
