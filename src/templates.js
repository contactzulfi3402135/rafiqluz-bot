'use strict';
/**
 * v7.6.0 — POST TEMPLATES v2. Every published post's TEXT can be rewritten into
 * a template format (images/videos/documents are NEVER touched — text/caption only).
 *
 * Zones (v2): a template is up to three zones:
 *   header — above the post (overrides the global header when non-empty)
 *   body   — the post text; must contain {text} / {{POST}}
 *   footer — below the post (overrides the global footer when non-empty)
 *
 * Placeholders (v2) — all six work in every zone, plus the legacy {{POST}}/{{DATE}}:
 *   {text}      the full post text (= {{POST}})
 *   {title}     the first line of the post (max 60 chars)
 *   {source}    the source channel name (or its number, last 4 digits)
 *   {date}      today, Pakistan time   (= {{DATE}})
 *   {time}      now, Pakistan time (e.g. "10:30 PM")
 *   {hashtags}  hashtags found inside the post text (#word …)
 *
 * Per-template AI style (v2): each template can carry a short style instruction
 * (e.g. "punchy, two lines, keep Urdu"). In FIXED mode the AI beautify step
 * receives that instruction, so the text is rewritten in the template's voice
 * before the template zones wrap it. (Rotate/shuffle can't know the template
 * in advance — the instruction only applies in fixed mode.)
 *
 * Pool (v2): rotate/shuffle use the ticked pool (checkbox list). Empty pool =
 * the full set (v7.5.0 behaviour).
 *
 * Samples (v2): every template stores a STATIC before/after sample — computed
 * from a fixed example post with no AI calls, so the UI can show what a
 * template does before you commit to it.
 *
 * Migration (v7.5.0 → v7.6.0, idempotent, one-time flag):
 *   - "Signature" switch  → footer semantics (power.signature.text key is kept,
 *     zero data movement; the engine treats it as the global footer)
 *   - "Auto headers" switch, empty custom header → the post's TITLE LINE
 *     (the old emoji category headers are superseded by the title-line mapping)
 * The v7.5.0 custom template body is read as the BODY zone — nothing is lost.
 */
const { ring } = require('./logger');
const { S } = require('./db');

const MODES = ['off', 'single', 'rotate', 'shuffle'];

/** 20 ready-made templates. body = the body zone; header/footer zones default
 *  to empty (so the global header/footer switches still apply). */
const TEMPLATES = [
  { id: 'plain', name: 'Plain', body: '{{POST}}' },
  { id: 'bold', name: 'Bold', body: '*{{POST}}*' },
  { id: 'date-stamp', name: 'Date stamp (top)', body: '_{{DATE}}_\n\n{{POST}}' },
  { id: 'date-bottom', name: 'Date stamp (bottom)', body: '{{POST}}\n\n_{{DATE}}_' },
  { id: 'dots', name: 'Dotted divider', body: '· · · · · ·\n\n{{POST}}' },
  { id: 'dashes', name: 'Dashes frame', body: '———————\n{{POST}}\n———————' },
  { id: 'stars', name: 'Star frame', body: '✦ ✦ ✦\n\n{{POST}}\n\n✦ ✦ ✦' },
  { id: 'quote', name: 'Quote', body: '❝ {{POST}} ❞' },
  { id: 'box', name: 'Box frame', body: '┌────────┐\n{{POST}}\n└────────┘' },
  { id: 'banner', name: 'Banner bars', body: '▓▓▓▓▓▓▓▓\n\n{{POST}}\n\n▓▓▓▓▓▓▓▓' },
  { id: 'bolt', name: 'Bolt ⚡', body: '⚡ *{{POST}}*' },
  { id: 'megaphone', name: 'Megaphone 📢', body: '📢 {{POST}}' },
  { id: 'new', name: 'New 🆕', body: '🆕 {{POST}}' },
  { id: 'important', name: 'Important 🔴', body: '🔴 *{{POST}}*' },
  { id: 'check', name: 'Confirmed ✅', body: '✅ {{POST}}' },
  { id: 'sparkle', name: 'Sparkle ✨', body: '✨ {{POST}} ✨' },
  { id: 'fire', name: 'Trending 🔥', body: '🔥 {{POST}}' },
  { id: 'info', name: 'Notice ℹ️', body: 'ℹ️ {{POST}}' },
  { id: 'classic', name: 'Classic (post + date)', body: '{{POST}}\n\n· {{DATE}}' },
  { id: 'elegant', name: 'Elegant ✧', body: '✧･ﾟ {{POST}} ･ﾟ✧' }
];
const TPL_BY_ID = Object.fromEntries(TEMPLATES.map((t) => [t.id, t]));

const MODE_KEY = 'power.template.mode';
const PICK_KEY = 'power.template.pick';
const CUSTOM_KEY = 'power.template.custom';
const ROT_KEY = 'power.template.rot';
const POOL_KEY = 'power.template.pool';          // v7.6.0: comma list of ids (may include "custom")
const CUSTOM_HIST_KEY = 'power.template.history'; // v7.6.0: last 5 custom saves [{ts, zones|raw}]
const STYLE_PREFIX = 'tpl.style.';                 // v7.6.0: per-template AI style instruction
const MIGRATED_KEY = 'tpl.migrated.v1';            // v7.6.0: one-time signature→footer / auto-header→title mapping

/* ---------------- one-time, idempotent migration (R35/R36) ---------------- */
function migrateV1() {
  if (S.getBool(MIGRATED_KEY, false)) return;
  const sig = String(S.get('power.signature.text', '')).trim();
  S.set(MIGRATED_KEY, '1');
  ring.info('template.migrate', `Templates v2 mapped v7.5.0 settings: signature${sig ? ' text' : ''} → global footer (key kept), auto-header with empty custom header → post title line. Nothing was deleted.`);
}
try { migrateV1(); } catch { /* settings not ready yet */ }

/* ---------------- time helpers (Pakistan time) ---------------- */
function dateLabel() {
  try {
    return new Date().toLocaleDateString('en-GB', { timeZone: 'Asia/Karachi', day: 'numeric', month: 'short', year: 'numeric' });
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}
function timeLabel() {
  try {
    return new Date().toLocaleTimeString('en-US', { timeZone: 'Asia/Karachi', hour: 'numeric', minute: '2-digit' });
  } catch {
    return new Date().toTimeString().slice(0, 5);
  }
}

/* ---------------- placeholder context (R30) ---------------- */
function firstLine(text, max = 60) {
  const t = String(text || '').replace(/\r/g, '').trim();
  const line = t.split('\n')[0] || '';
  return line.length > max ? line.slice(0, max - 1) + '…' : line;
}
function extractHashtags(text) {
  const m = String(text || '').match(/#[A-Za-z0-9_؀-ۿ\p{L}]{2,}/gu) || [];
  const seen = new Set();
  const out = [];
  for (const h of m) {
    const k = h.toLowerCase();
    if (!seen.has(k)) { seen.add(k); out.push(h); }
  }
  return out.slice(0, 8).join(' ');
}
function makeCtx(text, sourceName) {
  const src = String(sourceName || '').trim();
  return {
    text: String(text || ''),
    title: firstLine(text),
    source: src || (sourceName ? '' : 'Channel'),
    date: dateLabel(),
    time: timeLabel(),
    hashtags: extractHashtags(text)
  };
}

/** Fill any zone string with placeholders. Legacy {{POST}}/{{DATE}} included. */
function fillText(zone, ctx) {
  if (!zone) return '';
  return String(zone)
    .replace(/\{\{POST\}\}/gi, () => ctx.text)
    .replace(/\{\{DATE\}\}/gi, () => ctx.date)
    .replace(/\{\{TITLE\}\}/gi, () => ctx.title)
    .replace(/\{\{SOURCE\}\}/gi, () => ctx.source)
    .replace(/\{\{TIME\}\}/gi, () => ctx.time)
    .replace(/\{\{HASHTAGS\}\}/gi, () => ctx.hashtags)
    .replace(/\{text\}/gi, () => ctx.text)
    .replace(/\{title\}/gi, () => ctx.title)
    .replace(/\{source\}/gi, () => ctx.source)
    .replace(/\{date\}/gi, () => ctx.date)
    .replace(/\{time\}/gi, () => ctx.time)
    .replace(/\{hashtags\}/gi, () => ctx.hashtags);
}

/* v7.5.0-compatible single-arg fill (kept for aicontrol / old callers) */
function fill(body, text) {
  return fillText(body, makeCtx(text, ''));
}

/* ---------------- custom template (zones | raw) + history ---------------- */
function getCustom() {
  const raw = String(S.get(CUSTOM_KEY, ''));
  if (!raw.trim()) return null;
  /* v2 stores JSON {zones: {header, body, footer}}; v7.5.0 stores a plain body */
  try {
    const o = JSON.parse(raw);
    if (o && typeof o === 'object' && o.zones && typeof o.zones.body === 'string') {
      return { id: 'custom', name: 'Your custom', header: String(o.zones.header || ''), body: o.zones.body, footer: String(o.zones.footer || ''), builtIn: false };
    }
  } catch { /* plain body — fall through */ }
  return { id: 'custom', name: 'Your custom', header: '', body: raw, footer: '', builtIn: false };
}
function customZones() {
  const c = getCustom();
  return c ? { header: c.header, body: c.body, footer: c.footer } : { header: '', body: '', footer: '' };
}
function getHistory() {
  try {
    const h = JSON.parse(S.get(CUSTOM_HIST_KEY, '[]'));
    return Array.isArray(h) ? h.slice(0, 5) : [];
  } catch { return []; }
}
function pushHistory(entry) {
  let h = getHistory();
  h = [entry, ...h].slice(0, 5);
  try { S.set(CUSTOM_HIST_KEY, JSON.stringify(h)); } catch { }
  return h;
}

/* ---------------- pool (R32) ---------------- */
function getPool() {
  const p = String(S.get(POOL_KEY, '')).split(',').map((x) => x.trim()).filter(Boolean);
  return p; // ids, may include 'custom'; empty = full set
}
function setPool(ids) {
  const arr = (Array.isArray(ids) ? ids : String(ids || '').split(',')).map((x) => String(x).trim()).filter(Boolean);
  const clean = arr.filter((x) => x === 'custom' || TPL_BY_ID[x]);
  S.set(POOL_KEY, clean.join(','));
  return clean;
}

/* ---------------- per-template AI style (R30) ---------------- */
function getStyles() {
  const out = {};
  for (const t of TEMPLATES) {
    const v = String(S.get(STYLE_PREFIX + t.id, '')).trim();
    if (v) out[t.id] = v;
  }
  const cv = String(S.get(STYLE_PREFIX + 'custom', '')).trim();
  if (cv) out.custom = cv;
  return out;
}
function setStyle(id, instr) {
  if (!TPL_BY_ID[id] && id !== 'custom') throw new Error('Unknown template "' + id + '"');
  const v = String(instr || '').trim().slice(0, 300);
  if (v) S.set(STYLE_PREFIX + id, v);
  else S.set(STYLE_PREFIX + id, '');
  return v;
}
/** Style instruction for the AI beautify step — only meaningful in fixed mode. */
function styleHint() {
  const info = getInfo();
  if (info.mode !== 'single') return '';
  return String(S.get(STYLE_PREFIX + (info.pick === 'custom' ? 'custom' : info.pick), '')).trim();
}

/* ---------------- info / save ---------------- */
function getInfo() {
  let mode = String(S.get(MODE_KEY, 'off'));
  if (!MODES.includes(mode)) mode = 'off';
  let pick = String(S.get(PICK_KEY, TEMPLATES[0].id));
  if (pick !== 'custom' && !TPL_BY_ID[pick]) pick = TEMPLATES[0].id;
  const custom = String(S.get(CUSTOM_KEY, ''));
  return { mode, pick, custom };
}

function saveInfo({ mode, pick, custom, zones, raw, pool }) {
  if (mode != null) {
    const m = String(mode);
    if (!MODES.includes(m)) throw new Error(`Unknown mode "${mode}". Use: ${MODES.join(', ')}`);
    S.set(MODE_KEY, m);
  }
  if (pool != null) setPool(pool);
  if (zones && typeof zones === 'object') {
    const body = String(zones.body || '').trim();
    if (!/\{text\}|\{\{POST\}\}/i.test(body)) throw new Error('The body zone needs the post text — include {text} (or {{POST}}) somewhere in it.');
    S.set(CUSTOM_KEY, JSON.stringify({ zones: { header: String(zones.header || '').slice(0, 300), body: String(zones.body).slice(0, 1200), footer: String(zones.footer || '').slice(0, 300) } }));
    pushHistory({ ts: Date.now(), kind: 'zones', zones: { header: String(zones.header || ''), body: String(zones.body), footer: String(zones.footer || '') } });
  } else if (raw != null) {
    S.set(CUSTOM_KEY, String(raw).slice(0, 1500));
    if (String(raw).trim()) pushHistory({ ts: Date.now(), kind: 'raw', zones: { header: '', body: String(raw).slice(0, 1500), footer: '' } });
  } else if (custom != null) {
    S.set(CUSTOM_KEY, String(custom).slice(0, 1500));
    if (String(custom).trim()) pushHistory({ ts: Date.now(), kind: 'raw', zones: { header: '', body: String(custom).slice(0, 1500), footer: '' } });
  }
  if (pick != null) {
    const p = String(pick);
    if (p !== 'custom' && !TPL_BY_ID[p]) {
      const byName = TEMPLATES.find((t) => t.name.toLowerCase() === p.toLowerCase() || t.id === p.toLowerCase());
      if (!byName) throw new Error(`Unknown template "${pick}". Available: ${TEMPLATES.map((t) => t.name).join(', ')} (or "custom")`);
      S.set(PICK_KEY, byName.id);
    } else S.set(PICK_KEY, p);
  }
  const info = getInfo();
  ring.info('template.save', `Post template set — mode: ${info.mode}, pick: ${info.pick === 'custom' ? 'custom' : (TPL_BY_ID[info.pick] || {}).name}, pool: ${getPool().join(',') || 'all'}`);
  return info;
}

function tplHeaderFooter(tpl) {
  return { header: String(tpl.header || '').trim(), footer: String(tpl.footer || '').trim() };
}

/* ---------------- the engine ---------------- */
function pickTemplate(mode, pick, customTpl, pool, dryRun = false) {
  const builtins = TEMPLATES.map((t) => ({ ...t, header: '', footer: '' }));
  const all = customTpl ? [...builtins, customTpl] : builtins;
  let candidates = all;
  if (pool && pool.length) {
    const pset = new Set(pool);
    candidates = all.filter((t) => pset.has(t.id));
    if (!candidates.length) candidates = all; // pool ticked nothing usable — never break posting
  }
  if (mode === 'single') {
    return (pick === 'custom' ? customTpl : TPL_BY_ID[pick] ? { ...TPL_BY_ID[pick], header: '', footer: '' } : null);
  }
  if (mode === 'shuffle') return candidates[Math.floor(Math.random() * candidates.length)];
  // rotate — deterministic, persisted index (v7.5.0 behaviour); dryRun (5J J1
  // Pipeline Inspector) previews the CURRENT pick without advancing the index
  const idx = Math.max(0, parseInt(S.get(ROT_KEY, '0'), 10) || 0);
  if (!dryRun) S.set(ROT_KEY, String(idx + 1));
  return candidates[idx % candidates.length];
}

/**
 * Apply the configured template to a post's text.
 * @param {string} text        the fully cleaned/translated post text
 * @param {object} [opts]      { sourceName } — source channel name for {source}
 * @returns {{text: string, used: string|null, tplId: string|null, header: string, footer: string}}
 * header/footer = the zones the template itself contributed (the pipeline
 * skips the global header/footer for a post when these are non-empty).
 */
function apply(text, opts = {}) {
  const { mode, pick } = getInfo();
  if (mode === 'off' || !mode) return { text: String(text), used: null, tplId: null, header: '', footer: '' };
  const customTpl = getCustom();
  const tpl = pickTemplate(mode, pick, customTpl, getPool(), Boolean(opts.dryRun));
  if (!tpl || !String(tpl.body || '').trim()) return { text: String(text), used: null, tplId: null, header: '', footer: '' };
  const ctx = makeCtx(text, opts.sourceName || '');
  const head = fillText(tpl.header, ctx).trim();
  const main = fillText(tpl.body, ctx);
  const foot = fillText(tpl.footer, ctx).trim();
  const parts = [head, main, foot].filter((p) => String(p || '').trim() !== '');
  const out = parts.join('\n\n');
  ring.info('template.use', `Post formatted with template "${tpl.name}" (${mode})`);
  return {
    text: out, used: tpl.name, tplId: tpl.id, header: head, footer: foot,
    hasHashtagZone: /\{hashtags\}|\{\{HASHTAGS\}\}/i.test(String(tpl.body || '') + String(tpl.header || '') + String(tpl.footer || ''))
  };
}

/* ---------------- list + STATIC samples (R31, no AI) ---------------- */
const SAMPLE_POST = 'Admission open — Punjab Public Service Commission. Last date 31 October. Apply online at the official website. Fee Rs. 1,500. #jobs #punjab';
const SAMPLE_CTX = {
  text: SAMPLE_POST,
  title: firstLine(SAMPLE_POST),
  source: 'Raqq News',
  date: '15 Oct 2026',
  time: '10:30 PM',
  hashtags: '#jobs #punjab'
};
function sampleOf(tpl) {
  const head = fillText(tpl.header, SAMPLE_CTX).trim();
  const main = fillText(tpl.body, SAMPLE_CTX);
  const foot = fillText(tpl.footer, SAMPLE_CTX).trim();
  return { before: SAMPLE_POST, after: [head, main, foot].filter((p) => p).join('\n\n') };
}
function list() {
  const customTpl = getCustom();
  const rows = TEMPLATES.map((t) => {
    const tpl = { ...t, header: '', footer: '' };
    const s = sampleOf(tpl);
    return { id: t.id, name: t.name, body: t.body, builtIn: true, sampleBefore: s.before, sampleAfter: s.after, style: String(S.get(STYLE_PREFIX + t.id, '')).trim() };
  });
  if (customTpl) {
    const s = sampleOf(customTpl);
    rows.push({ id: 'custom', name: customTpl.name, body: customTpl.body, header: customTpl.header, footer: customTpl.footer, builtIn: false, sampleBefore: s.before, sampleAfter: s.after, style: String(S.get(STYLE_PREFIX + 'custom', '')).trim() });
  }
  return rows;
}
function samples() {
  return list().map((t) => ({ id: t.id, name: t.name, before: t.sampleBefore, after: t.sampleAfter }));
}

/** Live preview for the UI (uses the CURRENT selection; sample post if no text). */
function preview(text, opts = {}) {
  const sample = String(text || SAMPLE_POST);
  const out = apply(sample, { sourceName: 'Sample Channel', ...opts });
  return { example: out.text, used: out.used, tplId: out.tplId, header: out.header, footer: out.footer, ...getInfo(), pool: getPool(), styles: getStyles(), history: getHistory(), zones: customZones() };
}

module.exports = {
  TEMPLATES, MODES,
  list, getInfo, saveInfo, apply, preview, fill, fillText,
  dateLabel, timeLabel, firstLine, extractHashtags, makeCtx,
  samples, getStyles, setStyle, styleHint,
  getPool, setPool, getHistory, pushHistory, customZones,
  migrateV1
};
