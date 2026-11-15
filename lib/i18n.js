import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cache = {};
for (const l of ['en', 'ur']) {
  cache[l] = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'locales', l + '.json'), 'utf8'));
}

export function langOf(req, db) {
  try {
    const m = String(req.headers.cookie || '').match(/(?:^|;\s*)rq_lang=(en|ur)/);
    if (m) return m[1];
  } catch { /* no cookie */ }
  return db.settings?.language === 'ur' ? 'ur' : 'en';
}

export function tFor(lang, db) {
  const l = lang === 'ur' ? 'ur' : 'en';
  const dict = cache[l] || cache.en;
  return (key, vars) => {
    let s = dict[key];
    if (s === undefined) s = cache.en[key] ?? key;
    if (vars) for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, String(v));
    return s;
  };
}

export function applySettingsLocals(res, db, lang) {
  const s = db.settings;
  res.locals.settings = s;
  res.locals.theme = s.theme || 'dark';
  res.locals.accent = s.accent || 'emerald';
  res.locals.greeting = greetingFor(lang);
  res.locals.queueCount = db.queue.filter((q) => q.status === 'pending').length;
  res.locals.unreadNotif = db.notifications?.unread || 0;
  const score = db.health?.score ?? 98;
  res.locals.healthState = score >= 95 ? 'ok' : score >= 85 ? 'warn' : 'err';
  res.locals.paused = !!db.paused;
}

function greetingFor(lang) {
  const h = new Date().getHours();
  const part = h < 12 ? 'morning' : h < 18 ? 'afternoon' : 'evening';
  return lang === 'ur' ? { morning: 'صبح بخیر', afternoon: 'دوپہر بخیر', evening: 'شام بخیر' }[part]
    : { morning: 'Good morning', afternoon: 'Good afternoon', evening: 'Good evening' }[part];
}
