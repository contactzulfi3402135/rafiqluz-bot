'use strict';
/**
 * v6.0.0 — the post pipeline. Every post from every source walks this path:
 *   dedupe → type check (polls skipped honestly) → media fetch →
 *   regex clean → AI beautify (switch) → header (switch) → hashtags (switch) →
 *   AI pilot gate (switch, fail-open) → publish → honest result.
 */
const { ring } = require('./logger');
const { S, CH, P, SR, RC, AUD, LAT, P5A, GL } = require('./db');
const ai = require('./ai');
const wa = require('./wa');  // runtime-only: socket for media recovery + channel names
const publishMod = require('./publish');
const templates = require('./templates');   // v7.5.0: post template formatting (text only)
const queue5a = require('./queue5a');       // 5A: approval/hold queue (R37/R43/R47/R48)

const SWITCH_DEFAULTS = {
  scheduler: false, routing: false, analytics: false, editposts: false,
  aipilot: false, dedupe: false, beautify: false, headers: false, hashtags: false,
  translate: false, aireply: false, digest: false,
  signature: false,   // v6.2: auto-append the owner's signature/footer to every post
  /* 5A (v7.7.0) — every new automation OFF by default (R8) */
  queue: false,        // R37: Approval Queue — "approve first" sources + global delay buffer
  crossdedupe: false,  // R40: same story from 2+ sources in the window → publish once, merge credits
  dedsplit: false,     // R41: auto-split posts over 4096 chars into numbered parts (media on part 1)
  polltext: false,     // R42: polls → text post (question + options)
  matrix: false,       // R39: routing matrix — explicit source × target on/off grid
  /* 5C (v7.7.0) — every new automation OFF by default (R8) */
  tldr: false,         // R56: prepend a 1-line TL;DR (AI) to longer posts
  autobold: false,     // R56: AI bolds the 1-3 key phrases of every post
  emojibullets: false, // R56: bullet lines get rotating emoji bullets (no AI)
  transcribe: false,   // R58: voice messages → text (needs Gemini, see Settings · AI)
  replykb: false,      // R59: knowledge-base auto-reply (hours + allowlist)
  recap: false,        // R60: morning recap of yesterday to your own number
  /* 5D (v7.8.0) — every new automation OFF by default (R8) */
  weekly: false,        // R63: weekly report (WA + email) on a day+time of your choice
  instantalerts: false, // R65: instant WhatsApp alerts on failures (30-min cooldown per type)
  /* 5H (v7.9.0) — every new automation OFF by default (R8) */
  waCommand: false,     // R85: WhatsApp command channel on the owner's own number (PIN for destructive)
  evergreen: false,     // R86: daily recycling of proven old posts (quota + rotation, rate-guard aware)
  autopilot: false,     // R87: bounded self-maintenance (retries + unstick; capped; never deletes)
  /* 5I (v7.10.0) — every new automation OFF by default (R8) */
  smartmedia: false,    // I3: validate media kind vs content + size caps before publish (honest skip)
  linktools: false,     // I8: strip tracking params (utm_*/fbclid/gclid/…) from URLs in post text
  announcard: false,    // I4: branded announcement card (SVG + PNG) tool on posts (nothing auto-attached)
  /* 5J (v7.7.x) — every new automation OFF by default (R8) */
  aisafety: false       // J7: AI safety screen — AI criteria review of the final text before routing (fail-open)
};
const on = (k) => S.getBool(`power.${k}.on`, SWITCH_DEFAULTS[k] === true);

/** Rule check for smart routing (per-target include/exclude words, text vs media). */
function routeAllowed(target, { text, hasMedia }) {
  if (!on('routing')) return true;
  try {
    const rules = JSON.parse(S.get('power.routing.rules', '[]'));
    const rule = rules.find((r) => r.jid === target.jid);
    if (!rule) return true; // no rule = allow all
    const words = String(text || '').toLowerCase();
    const inc = (rule.include || '').toLowerCase().split(',').map((w) => w.trim()).filter(Boolean);
    const exc = (rule.exclude || '').toLowerCase().split(',').map((w) => w.trim()).filter(Boolean);
    if (exc.some((w) => words.includes(w))) return false;
    if (rule.type === 'text' && hasMedia) return false;
    if (rule.type === 'media' && !hasMedia) return false;
    if (inc.length && !inc.some((w) => words.includes(w))) return false;
    return true;
  } catch { return true; } // routing never throws
}

/** 5A (R46): shared text normalizer (dedupe + cross-dedupe + edit-diff). */
function normalizeText(text) {
  return String(text || '').toLowerCase().replace(/[^a-z0-9\u0600-\u06FF ]/g, ' ').replace(/\s+/g, ' ').trim();
}

/* 5A (R38): Pakistan-time wall clock for active-hours windows. */
const PKT_TZ = 'Asia/Karachi';
function pktWall() {
  try {
    const f = new Intl.DateTimeFormat('en-GB', { timeZone: PKT_TZ, hour: '2-digit', minute: '2-digit', hour12: false });
    const p = Object.fromEntries(f.formatToParts(new Date()).map((x) => [x.type, x.value]));
    return `${p.hour === '24' ? '00' : p.hour}:${p.minute}`;
  } catch { const d = new Date(); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; }
}
function inActiveWindow(rule, hm) {
  const from = /^([01]\d|2[0-3]):[0-5]\d$/.test(rule.active_from || '') ? rule.active_from : '';
  const to = /^([01]\d|2[0-3]):[0-5]\d$/.test(rule.active_to || '') ? rule.active_to : '';
  if (!from && !to) return true;
  if (!from) return hm <= to;
  if (!to) return hm >= from;
  return from <= to ? (hm >= from && hm < to) : (hm >= from || hm < to); // wraps midnight
}

/* 5A (R41): split long posts at paragraph seams, label "(i/n)". Every output
   part is guaranteed ≤ limit (label headroom reserved), content order kept. */
function splitParts(text, limit = 4096) {
  const t = String(text || '');
  if (t.length <= limit) return [t];
  const eff = Math.max(500, limit - 24); // headroom for the "(1/3)" label
  const raw = [];
  let cur = '';
  const flush = () => { if (cur.trim()) raw.push(cur.trim()); cur = ''; };
  for (const para of t.split(/\n\n+/)) {
    const pieces = [];
    let rest = para;
    while (rest.length > eff) { // one paragraph longer than the whole budget → hard cut at a space
      let cut = rest.lastIndexOf(' ', eff);
      if (cut < eff * 0.5) cut = eff;
      pieces.push(rest.slice(0, cut));
      rest = rest.slice(cut).trim();
    }
    if (rest) pieces.push(rest);
    for (const pc of pieces) {
      if (cur && cur.length + 2 + pc.length > eff) flush();
      cur = cur ? `${cur}\n\n${pc}` : pc;
    }
  }
  flush();
  const n = raw.length;
  return raw.map((c, i) => `(${i + 1}/${n}) ${c}`);
}

/** Near-duplicate detection (smart repost): same normalized text within N hours. */
function isNearDuplicate(text) {
  if (!on('dedupe')) return false;
  try {
    const norm = normalizeText(text);
    if (norm.length < 25) return false; // short posts are not worth deduping
    const hours = 12;
    const since = new Date(Date.now() - hours * 3600e3).toISOString().slice(0, 19).replace('T', ' ');
    const recent = require('./db').open().prepare(`SELECT source_msg_id, reason FROM posts WHERE created_at >= ? AND status='published'`).all(since);
    for (const r of recent) {
      const other = String(r.reason || '').toLowerCase().replace(/[^a-z0-9\u0600-\u06FF ]/g, ' ').replace(/\s+/g, ' ').trim();
      if (!other || other.length < 25) continue;
      // overlap similarity (cheap Jaccard on word sets)
      const a = new Set(norm.split(' ')); const b = new Set(other.split(' '));
      let inter = 0; for (const w of a) if (b.has(w)) inter += 1;
      const sim = inter / Math.max(1, Math.min(a.size, b.size));
      if (sim > 0.82) return true;
    }
    return false;
  } catch { return false; }
}

function headerFor(text) {
  if (!on('headers')) return '';
  /* v7.6.0 (R36): custom header wins (placeholders {text}{title}{source}{date}
     {time}{hashtags} work inside it); with an EMPTY custom header the auto
     header is the post's TITLE LINE — the old emoji category headers are
     superseded by the template title-line mapping. */
  const customHead = String(S.get('power.header.text', '')).trim();
  if (customHead) return templates.fillText(customHead, templates.makeCtx(text, ''));
  const title = templates.firstLine(text);
  return title ? `*${title}*` : '';
}

function hashtagsFor(text) {
  if (!on('hashtags')) return '';
  const t = String(text || '').toLowerCase();
  const tags = [];
  if (/job|vacanc|hiring/.test(t)) tags.push('jobs');
  if (/admission|result|exam/.test(t)) tags.push('education');
  if (/police|news|accident/.test(t)) tags.push('news');
  if (/lahore/.test(t)) tags.push('lahore');
  if (/punjab/.test(t)) tags.push('punjab');
  if (/pakistan/.test(t)) tags.push('pakistan');
  return tags.slice(0, 5).map((x) => `#${x}`).join(' ');
}

/** Extract text + media from a raw Baileys message object. */
function extract(m) {
  let msg = m.message || {};
  // v6.4: unwrap the standard containers (view-once photos in channels!)
  if (msg.viewOnceMessage?.message) msg = msg.viewOnceMessage.message;
  else if (msg.viewOnceMessageV2?.message) msg = msg.viewOnceMessageV2.message;
  else if (msg.ephemeralMessage?.message) msg = msg.ephemeralMessage.message;
  const type = Object.keys(msg)[0] || '';
  let text = '';
  let media = null;
  if (msg.conversation) text = msg.conversation;
  else if (msg.extendedTextMessage) text = msg.extendedTextMessage.text || '';
  else if (msg.imageMessage) { text = msg.imageMessage.caption || ''; media = { kind: 'image', msg: msg.imageMessage }; }
  else if (msg.videoMessage) { text = msg.videoMessage.caption || ''; media = { kind: 'video', msg: msg.videoMessage }; }
  // v6.4: photos sent as documents/files (very common in channels) — mirrored now
  else if (msg.documentMessage) {
    text = msg.documentMessage.caption || '';
    media = { kind: 'document', msg: msg.documentMessage };
  }
  else if (msg.pollCreationMessage || msg.pollCreationMessageV3) {
    // 5A (R42): carry the poll's question + options so "Polls to text" can publish them
    const p = msg.pollCreationMessage || msg.pollCreationMessageV3;
    const q = String(p?.name || p?.question || '').trim();
    const opts = (p?.options || p?.pollOptions || []).map((o) => String(o?.optionName || o?.name || '').trim()).filter(Boolean);
    return { poll: true, pollText: [q, ...opts.map((o) => `- ${o}`)].join('\n').trim() };
  }
  return { text: String(text || ''), media, type };
}

/* v7.3.5 — THE channel-media fix, ported verbatim from the v5.7.x bot that made
   images work: WhatsApp channels store media on the CDN as RAW (unencrypted)
   bytes — the message deliberately carries url/directPath/fileSha256 and an
   EMPTY mediaKey, so Baileys' downloadMediaMessage ALWAYS dies with "Cannot
   derive from empty media key" (there is no key to refresh — updateMediaMessage
   cannot help a raw channel image). The official apps simply download the
   plaintext bytes from the CDN url — so we do exactly that. */
function mediaNodeOf(m) {
  let msg = m.message || {};
  if (msg.viewOnceMessage?.message) msg = msg.viewOnceMessage.message;
  else if (msg.viewOnceMessageV2?.message) msg = msg.viewOnceMessageV2.message;
  else if (msg.ephemeralMessage?.message) msg = msg.ephemeralMessage.message;
  const type = Object.keys(msg)[0] || '';
  return { type, body: type ? msg[type] : null };
}
const mediaKeyLen = (body) => (body?.mediaKey ? (body.mediaKey.length || body.mediaKey.byteLength || 0) : 0);

/** Plaintext CDN download of a keyless (raw) channel image. */
async function downloadRawChannel(m) {
  const { body } = mediaNodeOf(m);
  const candidates = [];
  if (body?.url) candidates.push(String(body.url));
  if (body?.directPath) {
    const alt = `https://mmg.whatsapp.net${body.directPath}`;
    if (!candidates.includes(alt)) candidates.push(alt);
  }
  if (!candidates.length) return null;
  for (const url of candidates) {
    for (let a = 1; a <= 2; a++) {
      try {
        const res = await fetch(url, { signal: AbortSignal.timeout(90000) });
        if (!res.ok) throw new Error(`CDN HTTP ${res.status}`);
        const buf = Buffer.from(await res.arrayBuffer());
        if (!buf.length) throw new Error('CDN returned 0 bytes');
        // newsletters carry fileSha256 over the PLAINTEXT — verify (warn only)
        if (body.fileSha256 && body.fileSha256.length) {
          const expected = Buffer.from(body.fileSha256).toString('hex');
          const actual = require('crypto').createHash('sha256').update(buf).digest('hex');
          if (actual !== expected) ring.warn('media.sha256', `Channel media sha256 mismatch — accepting anyway (${String(m.key?.remoteJid || '').slice(-6)}\u2026)`);
        }
        return buf;
      } catch { /* try next candidate / attempt */ }
    }
  }
  return null;
}

async function downloadMedia(m) {
  const sock = wa.getSocket();
  const { body } = mediaNodeOf(m);
  const keyless = body && mediaKeyLen(body) === 0;

  // KEYLESS = channel media by design → raw CDN bytes (the old-bot fix).
  if (keyless && (body.url || body.directPath)) {
    const buf = await downloadRawChannel(m).catch(() => null);
    if (buf?.length) {
      ring.info('media.raw', `Channel image fetched as raw CDN bytes (${Math.round(buf.length / 1024)} KB) \u2014 ${String(m.key?.remoteJid || '').slice(-6)}\u2026`);
      return buf;
    }
    // the delivered copy's CDN url may be stale — the re-fetched copy carries a fresh one
    try {
      if (sock && String(m.key?.remoteJid || '').endsWith('@newsletter')) {
        const posts = await wa.fetchChannelPosts(sock, String(m.key.remoteJid), 25).catch(() => []);
        const found = (posts || []).find((x) => x?.key?.id === m.key.id);
        if (found?.message) {
          const buf2 = await downloadRawChannel(found).catch(() => null);
          if (buf2?.length) {
            ring.info('media.refetched', `Channel image recovered via re-fetch + raw download \u2014 ${String(m.key?.remoteJid || '').slice(-6)}\u2026`);
            return buf2;
          }
        }
      }
    } catch { /* fall through */ }
  }

  // KEYED media (or keyless without urls) — Baileys' downloader with key refresh.
  const { downloadMediaMessage } = require('@whiskeysockets/baileys');
  const buf = await downloadMediaMessage({ key: m.key, message: m.message }, 'buffer', {},
    { logger: require('./logger').baileysLogger, reuploadRequest: sock?.updateMediaMessage || null });
  if (!buf || !buf.length) throw new Error('empty media');
  return buf;
}

/** Intake — called for every message from a source channel. */
const inFlight = new Set(); // same message can arrive via message-receive AND messages.upsert

async function intake(m) {
  try {
    if (require('./lifecycle').isStopping()) return;
    if (S.getBool('mirror.paused', false)) return;  // global pause — nothing is marked, so unpause + recovery resumes flow
    if (S.getBool('panic.on', false)) return;       // 5E (R73): panic stop — same resume-on-restore guarantee
    const jid = String(m.key?.remoteJid || '');
    if (!jid.endsWith('@newsletter')) return;         // channels only
    const src = CH.listActiveSources().find((s) => s.jid === jid);
    if (!src) return;                                  // not an active source
    const id = String(m.key?.id || '');
    if (!id) return;
    if (P.seen(jid, id)) { handleSourceEdit(jid, id, m); return; } // 5A (R44): known id = re-delivery OR source edit
    const dedupeKey = `${jid}:${id}`;
    if (inFlight.has(dedupeKey)) return;               // already being processed (double event)
    inFlight.add(dedupeKey);
    try {
      await processOne(m, src, jid, id);
    } finally {
      inFlight.delete(dedupeKey);
    }
  } catch (err) {
    ring.error('pipeline.error', `Pipeline error: ${err.message}`);
  }
}

/** 5G (R82): RSS/ATOM entry point — a synthetic message object flows through
    the SAME processOne() path (identical dedupe, blocklist, rate guard,
    keyword routing, 4096-split, approval queue, publish). intake() and its
    @newsletter-only contract are untouched (R2: additive, never loosened). */
async function intakeRss({ jid, id, text, ts, title, link, url, sourceName }) {
  try {
    if (S.getBool('mirror.paused', false)) return;  // same pause guarantee as WA intake
    if (S.getBool('panic.on', false)) return;       // 5E (R73): panic stop holds RSS too
    if (!String(jid || '').endsWith('@rss')) return; // only OUR rss pseudo-jids, ever
    const src = CH.listActiveSources().find((s) => s.jid === jid);
    if (!src) return;                               // paused/removed feed → nothing
    if (!id || P.seen(jid, id)) return;             // pipeline dedupe (rss_seen is a second belt)
    const dedupeKey = jid + ':' + id;
    if (inFlight.has(dedupeKey)) return;
    inFlight.add(dedupeKey);
    try {
      const body = String(text || '').slice(0, 6000);
      const m = {
        key: { remoteJid: jid, id, fromMe: false },
        message: { extendedTextMessage: { text: body } },
        messageTimestamp: Math.floor(Number(ts) / 1000) || Math.floor(Date.now() / 1000)
      };
      await processOne(m, src, jid, id);
    } finally { inFlight.delete(dedupeKey); }
  } catch (err) {
    ring.error('pipeline.error', `RSS pipeline error (${sourceName || jid}): ${err.message}`);
  }
}

/* 5A (R44): a source edits one of its own published posts.
   Policy (Setting "When a source edits its post"): ignore (default) /
   mark-edited / update-post (update-post only works while Auto-post-edit is on). */
function handleSourceEdit(jid, id, m) {
  const policy = String(S.get('post.sourceedit.policy', 'ignore'));
  if (policy === 'ignore') return;
  const postId = P.postId(jid, id);
  if (!postId) return;
  const d = require('./db').open();
  const row = d.prepare('SELECT * FROM posts WHERE id=?').get(postId);
  if (!row) return;
  const x = extract(m);
  const newNorm = normalizeText(String(x.text || ''));
  if (newNorm && newNorm === normalizeText(String(row.reason || ''))) return; // same content — a re-delivery, not an edit
  AUD.log('source', 'post.source-edited', `Source ${jid} edited a post already handled by the bot (policy: ${policy})`);
  if (policy === 'mark') {
    P.setStatus(postId, 'edited', 'source edited the original post');
    ring.info('sourceedit.mark', `A source edited one of its posts — the history row is marked as edited (${jid})`);
    return;
  }
  if (!on('editposts')) { ring.warn('sourceedit.blocked', `Source edited a post, but "update post" only works while Auto-post-edit is on`); return; }
  (async () => {
    try {
      let body = await ai.beautify(String(x.text || ''), templates.styleHint());
      const applied = templates.apply(body || x.text, {});
      const newFinal = String(applied.text || '').trim();
      if (!newFinal) throw new Error('the edited text is empty');
      const res = await publishMod.editPublished(jid, id, newFinal);
      d.prepare('UPDATE posts SET body=? WHERE id=?').run(newFinal.slice(0, 4096), postId);
      ring.info('sourceedit.update', `Source edit applied to ${res.ok} target(s) (${jid})`);
    } catch (err) {
      ring.warn('sourceedit.fail', `Could not apply the source edit: ${err.message}`);
    }
  })().catch(() => { });
}

/* 5A (R40): the same story reaches two sources in the window → publish ONCE,
   merge the credits. The credit lives in the history ("via" column); when
   Auto-post-edit is on, the live post also gets the merged credit appended. */
function crossDedupeHits(norm, jid) {
  if (!on('crossdedupe') || norm.length < 25) return null;
  try {
    const win = Math.max(1, Math.min(1440, parseInt(S.get('crossdedupe.window.min', '30'), 10) || 30));
    const hits = P5A.crossRecent(norm, jid, win);
    return hits.length ? hits : null;
  } catch { return null; }
}
function mergeViaCredit(hit, srcName) {
  try {
    const d = require('./db').open();
    const orig = d.prepare('SELECT * FROM posts WHERE id=?').get(hit.id);
    if (!orig) return;
    let via = String(orig.via || '');
    const names = via ? via.split('|') : [];
    const label = `${hit.source_jid}~${String(srcName || hit.source_jid).slice(0, 40)}`;
    if (!names.some((n) => n.startsWith(hit.source_jid + '~'))) names.push(label);
    d.prepare('UPDATE posts SET via=? WHERE id=?').run(names.slice(0, 6).join('|'), hit.id);
    const pk = d.prepare("SELECT target_jid, msg_id FROM post_keys WHERE post_id=? AND msg_id != 'undone'").all(hit.id);
    if (on('editposts') && pk.length && String(orig.body || '').trim()) {
      const viaTxt = names.map((n) => n.split('~').slice(1).join('~')).join(' + ');
      const newText = `${String(orig.body).trim()}\n\n*via ${viaTxt}*`;
      publishMod.editPublished(orig.source_jid, orig.source_msg_id, newText.slice(0, 4096)).catch((e) => ring.warn('crossdedupe.edit', `Could not append the merged credit live: ${e.message}`));
    }
    ring.info('crossdedupe.credit', `Merged credit: this story also came via ${hit.source_jid}`);
  } catch { /* credits never break the pipeline */ }
}

/** Global blocklist — posts matching any entry are NEVER published (always on).
    5F (R79): `blocklist.regex` (OFF by default) treats each entry as a
    case-insensitive regex instead of a plain word; invalid patterns are skipped. */
function blockedWord(text) {
  const raw = String(S.get('blocklist.words', ''));
  // 5F (R79): regex patterns may contain commas ({2,3}, alternation), so in
  // regex mode multi-line input = one pattern per line; otherwise comma-split.
  const entries = (raw.includes('\n') && S.getBool('blocklist.regex', false) ? raw.split('\n') : raw.split(',')).map((w) => w.trim()).filter(Boolean);
  if (!entries.length) return null;
  const t = String(text || '');
  if (S.getBool('blocklist.regex', false)) {
    for (const e of entries) {
      try { if (new RegExp(e, 'i').test(t)) return e; } catch { /* invalid pattern — skip it */ }
    }
    return null;
  }
  const words = entries.map((w) => w.toLowerCase()).filter((w) => w.length >= 3);
  const tl = t.toLowerCase();
  return words.find((w) => tl.includes(w)) || null;
}

/** 5I (I8): link tools — strip tracking params from URLs. Only the parameters on
    the list are removed; every other parameter and the rest of the text are
    untouched. URLs that are not valid are left exactly as they were. */
const TRACKING_PARAMS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'utm_id', 'fbclid', 'gclid', 'gclsrc', 'mkt_tok', 'igsh', 'si', 'mc_cid', 'mc_eid', 'ref'];
function stripTrackingParams(text) {
  const t = String(text || '');
  if (!t.includes('http')) return t;
  return t.replace(/https?:\/\/[^\s"'<>]+/gi, (u) => {
    try {
      const raw = new URL(u).searchParams;
      const all = [...raw.keys()];
      const keep = all.filter((k) => !TRACKING_PARAMS.includes(k.toLowerCase()));
      if (keep.length === all.length) return u; // nothing to strip
      const qs = keep.length ? '?' + keep.map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(raw.get(k) ?? '')}`).join('&') : '';
      const base = u.slice(0, u.indexOf('?'));
      return base + qs;
    } catch { return u; }
  });
}

const countUrls = (t) => (String(t || '').match(/https?:\/\/[^\s"'<>]+/gi) || []).length;

/** 5I (I3): pure validation — returns null when the media is acceptable,
    otherwise the human reason it was refused. Caps (MB): image 10, video 40,
    document 20 — safe for channel upload limits. No compression, ever. */
function smartMediaCheck(kind, mime, bytes) {
  const caps = { image: 10, video: 40, document: 20 };
  const cap = caps[kind] || 20;
  const mb = (Number(bytes) || 0) / 1048576;
  if (mb > cap) return `${kind || 'media'} is ${mb.toFixed(1)} MB — over the ${cap} MB cap`;
  if (kind === 'image' && !/^image\//i.test(String(mime || ''))) return `declared image but content type is ${mime || 'unknown'}`;
  if (kind === 'video' && !/^video\//i.test(String(mime || ''))) return `declared video but content type is ${mime || 'unknown'}`;
  return null;
}

/** Rate guard — protects the channel from spam floods (always on, configurable). */
function rateGuarded() {
  const max = Math.max(3, parseInt(S.get('guard.maxperhour', '30'), 10) || 30);
  return CH.publishedLastHour() >= max ? max : 0;
}

async function processOne(m, src, jid, id) {
  {
    CH.setLastPost(jid);                               // source health tracking
    if (m.key.fromMe) return;                          // never re-post our own posts

    // v7.3.4: if this source still has no real name (raw number), learn it from
    // WhatsApp once — every UI (tables, history, pickers) then shows the channel name.
    if (src && (!src.name || src.name === jid || /^\d+$/.test(src.name))) {
      const s = wa.getSocket();
      if (s) {
        wa.channelMeta(s, jid).then((meta) => {
          if (meta?.name && meta.name !== jid) { CH.recordDir(jid, meta.name, meta.role || null); ring.info('channel.named', `Channel named: ${meta.name}`); }
        }).catch(() => { });
      }
    }

    const parts = extract(m);
    if (parts.poll) {
      P.mark(jid, id, 'skipped', 'poll');
      ring.info('post.skip.poll', `Poll skipped — WhatsApp does not allow reposting polls (${src.name || jid})`);
      return;
    }

    // 5I (I7) — freshness guard (default OFF = 0 hours = no change in behavior):
    // posts older than the configured age are skipped BEFORE the media fetch and
    // the dedupe steps, with an honest reason. Only ADDS a skip; no safety step moves.
    {
      const freshH = Math.max(0, Math.min(720, parseInt(S.get('freshness.hours', '0'), 10) || 0));
      if (freshH > 0 && m.messageTimestamp) {
        const ageH = (Date.now() - m.messageTimestamp * 1000) / 3600e3;
        if (ageH > freshH) {
          P.mark(jid, id, 'skipped', `stale: ${Math.round(ageH)}h old (freshness ${freshH}h)`);
          ring.info('post.skip.stale', `Post skipped — ${Math.round(ageH)}h old, freshness guard allows ${freshH}h (${src.name || jid})`);
          return;
        }
      }
    }

    // media: fetch now; a failure is honest, never an empty post
    let mediaBuf = null; let mediaKind = null; let mediaMime = null;
    if (parts.media) {
      try {
        mediaBuf = await downloadMedia(m);
        mediaKind = parts.media.kind;
        mediaMime = parts.media.msg?.mimetype || 'image/jpeg';
      } catch (err) {
        if (!parts.text) {
          P.mark(jid, id, 'failed', `media unfetchable: ${err.message}`);
          ring.info('post.skip.empty', `Post counted as FAILED: no usable text and its media could not be fetched (${parts.type})`);
          require('./alerts').maybe('failed', 'A post failed — media unfetchable', `${src.name || jid}: ${err.message}`); // 5D (R65)
          return;
        }
        ring.warn('media.fail', `Media could not be fetched — posting text only (${err.message})`);
      }
    }
    if (!parts.text && !mediaBuf) {
      P.mark(jid, id, 'skipped', 'empty');
      ring.info('post.skip.empty', `Post skipped: empty (${parts.type})`);
      return;
    }

    // 5I (I3) — smart media validation (OFF by default): the media that WAS
    // downloaded must match its declared kind and stay under per-kind size caps.
    // Fails with an HONEST skip reason — no compression, no retry, no guesswork.
    if (on('smartmedia') && mediaBuf) {
      const why = smartMediaCheck(mediaKind, mediaMime, mediaBuf.length);
      if (why) {
        P.mark(jid, id, 'skipped', `smart media: ${why}`);
        ring.warn('post.skip.smartmedia', `Smart media skipped: ${why} (${src.name || jid})`);
        return;
      }
    }

    // 5A (R38) — per-source rule card: active hours (PKT), keyword include/exclude,
    // daily cap with optional auto-pause. Safety order: these run BEFORE the
    // dedupe/blocklist/guard steps, which are never touched.
    const rule = SR.get(jid);
    if (rule.active_from || rule.active_to) {
      if (!inActiveWindow(rule, pktWall())) {
        P.mark(jid, id, 'skipped', 'outside active hours');
        ring.info('post.skip.hours', `Post skipped — ${src.name || jid} is only active ${rule.active_from || '…'}–${rule.active_to || '…'} PKT`);
        return;
      }
    }
    {
      const inc = String(rule.include || '').toLowerCase().split(',').map((w) => w.trim()).filter(Boolean);
      const exc = String(rule.exclude || '').toLowerCase().split(',').map((w) => w.trim()).filter(Boolean);
      const low = String(parts.text || '').toLowerCase();
      if (inc.length && !inc.some((w) => low.includes(w))) {
        P.mark(jid, id, 'skipped', 'keyword filter (include)');
        ring.info('post.skip.include', `Post skipped — ${src.name || jid} only publishes posts containing: ${inc.join(', ')}`);
        return;
      }
      if (exc.length && exc.some((w) => low.includes(w))) {
        P.mark(jid, id, 'skipped', `keyword filter (exclude: ${exc.find((w) => low.includes(w))})`);
        ring.info('post.skip.exclude', `Post skipped — ${src.name || jid} is set to never publish posts containing: ${exc.join(', ')}`);
        return;
      }
    }
    if (rule.max_per_day > 0) {
      const dayStart = new Date(Date.now() - (Date.now() + 5 * 3600e3) % 86400e3).toISOString().slice(0, 19).replace('T', ' '); // PKT day start (UTC+5)
      const todayCount = P5A.countFor(jid, dayStart);
      if (todayCount >= rule.max_per_day) {
        if (rule.auto_pause) {
          CH.setStatus(jid, 'paused');
          AUD.log('pipeline', 'source.auto-paused', `${src.name || jid} auto-paused — daily cap of ${rule.max_per_day} reached`);
          ring.warn('post.skip.cap', `Source ${src.name || jid} auto-PAUSED — it hit its daily cap of ${rule.max_per_day} posts`);
        } else {
          ring.info('post.skip.cap', `Post skipped — ${src.name || jid} reached its daily cap of ${rule.max_per_day} posts`);
        }
        P.mark(jid, id, 'skipped', `daily cap: ${rule.max_per_day}/day reached`);
        return;
      }
    }

    // near-duplicate guard (smart repost)
    if (isNearDuplicate(parts.text)) {
      P.mark(jid, id, 'skipped', 'near-duplicate');
      ring.info('post.skip.dedupe', `Near-duplicate skipped — a very similar post was published in the last 12 h (${src.name || jid})`);
      return;
    }

    // 5A (R40) — cross-source dedupe: same story from another source in the window
    const norm5a = normalizeText(parts.text);
    const xHits = crossDedupeHits(norm5a, jid);
    if (xHits) {
      P.mark(jid, id, 'skipped', `cross-source duplicate (${xHits.length} source(s) in window)`);
      ring.info('crossdedupe.hit', `Cross-source dedupe: the same story was already published — merged the "via" credit (${src.name || jid})`);
      for (const h of xHits.slice(0, 5)) mergeViaCredit(h, src.name || jid);
      return;
    }

    // global blocklist (always-on safety)
    const badWord = blockedWord(parts.text);
    if (badWord) {
      P.mark(jid, id, 'skipped', `blocklist: ${badWord}`);
      ring.warn('post.skip.blocklist', `Post blocked — it contains the blocked word "${badWord}" (${src.name || jid}). Remove the word in Settings → Guardrails if this is wrong.`);
      return;
    }

    // rate guard (anti-spam protection for the target channel)
    const guardMax = rateGuarded();
    if (guardMax) {
      P.mark(jid, id, 'skipped', `rate guard: ${guardMax}/h limit reached`);
      ring.warn('post.skip.guard', `Rate guard: ${guardMax} posts already published this hour — post held back to protect the channel. Raise the limit in Settings → Guardrails.`);
      return;
    }

    // AI pilot gate — fail OPEN (never lose a post because AI is down)
    if (on('aipilot')) {
      const criteria = S.get('power.aipilot.criteria', '');
      if (criteria.trim() && parts.text.trim()) {
        const verdict = await ai.matches(parts.text, criteria);
        if (verdict === false) {
          P.mark(jid, id, 'skipped', `AI pilot: not matching "${criteria.slice(0, 60)}"`);
          ring.info('post.filtered', `AI pilot skipped a post (${src.name || jid}) — didn't match: ${criteria.slice(0, 60)}`);
          return;
        }
      }
    }

    // compose (v7.6.0 spec order): clean/beautify → translate → TEMPLATE →
    // hashtags → global header/footer. A template's own header/footer zones
    // override the global ones for that post.
    let body = await ai.beautify(parts.text, templates.styleHint());
    if (on('translate')) {
      const lang = String(S.get('ai.translate.lang', '')).trim();
      if (lang) body = await ai.translate(body || parts.text, lang);
    }
    /* v7.5.0 template (v2 zones) — rewrites the TEXT into the owner's format
       (fixed / rotate / shuffle; 20 ready-made + custom; pool = ticked set).
       Media is never touched: only the text/caption goes through the template.
       Mode OFF (the default) leaves the post exactly as before. */
    const applied = templates.apply(body || parts.text, { sourceName: src.name || src.jid });
    let final = applied.text;
    const tags = hashtagsFor(body || parts.text);
    if (tags && !applied.hasHashtagZone) final = `${final}\n\n${tags}`;
    if (applied.header === '') {
      const head = headerFor(body || parts.text);
      if (head) final = `${head}\n\n${final}`;
    }
    if (applied.footer === '') {
      if (on('signature')) {
        const sig = String(S.get('power.signature.text', '')).trim();
        if (sig) final = `${final}\n\n${sig}`;
      }
    }

    // 5C (R56): optional post-processing — each switch OFF by default,
    // AI steps fail OPEN (the post publishes without the enhancement).
    if (on('tldr') && final.length >= 240) {
      try {
        const line = await ai.callFor('tldr', `Write ONE line (max 140 characters, same language as the post) that summarizes this post. Reply with ONLY that line.\n\n${final.slice(0, 6000)}`);
        if (line && line.trim()) final = `TL;DR: ${line.trim().slice(0, 160)}\n\n${final}`;
      } catch { /* fail-open: publish without the TL;DR */ }
    }
    if (on('autobold')) {
      try {
        const out = await ai.callFor('autobold', `Bold the 1 to 3 most important phrases or numbers in this post by wrapping them in *asterisks* (WhatsApp bold). Change NOTHING else — no reordering, no new words, no emoji.\n\n${final.slice(0, 6000)}`);
        if (out && /\*/.test(out) && out.trim().length >= Math.floor(final.length * 0.9)) final = out.trim();
      } catch { /* fail-open */ }
    }
    if (on('emojibullets')) final = emojiBullets(final);
    /* 5C (R57): glossary — owner terms are enforced on the final text
       (covers the template output; translate applies it earlier too). */
    try {
      const gl = GL.list();
      if (gl.length) final = GL.apply(final);
    } catch { }

    // 5I (I8): link tools (OFF by default) — clean tracking params from the
    // URLs in the FINAL text, after every other transformation.
    if (on('linktools')) {
      try {
        const cleaned = stripTrackingParams(final);
        if (cleaned !== final) ring.info('linktools.clean', `Stripped tracking params from ${countUrls(final)} URL(s) (${src.name || jid})`);
        final = cleaned;
      } catch { /* never fail a post over link cleaning */ }
    }

    // 5J (J7) — AI safety screen (OFF by default, R8): an AI criteria review of the
    // FINAL text before it is routed (e.g. "no political content, no ban-risk words").
    // Fail-OPEN like every other AI step — the AI being down never loses a post.
    let safetyReview = false;
    if (on('aisafety')) {
      const crit = String(S.get('power.aisafety.criteria', '')).trim();
      if (crit && final.trim()) {
        try {
          const verdict = await ai.matches(final, crit);
          if (verdict == null && S.get('power.aisafety.unavailable', 'open') === 'review') safetyReview = true;
          if (verdict === false) {
            P.mark(jid, id, 'skipped', 'AI safety: flagged by the safety screen');
            ring.warn('post.skip.aisafety', `Post held by the AI safety screen (${src.name || jid}) — adjust the criteria in AI Pilot → Safety`);
            return;
          }
        } catch { if (S.get('power.aisafety.unavailable', 'open') === 'review') safetyReview = true; }
      } else if (S.get('power.aisafety.unavailable', 'open') === 'review') safetyReview = true;
    }

    // publish to every allowed target:
    //   1. per-source mapping (if the source is pinned to specific targets)
    //   2. routing rules (per-target include/exclude/type)
    const hasMedia = Boolean(mediaBuf);
    const mapped = String(src.targets || '').trim();
    let targets = CH.listActiveTargets();
    if (mapped) {
      const allowed = mapped.split(',').map((x) => x.trim()).filter(Boolean);
      targets = targets.filter((t) => allowed.includes(t.jid));
      if (!targets.length) {
        P.mark(jid, id, 'skipped', 'mapping: source has no matching target');
        ring.info('post.skip.mapping', `Post skipped — ${src.name || jid} is mapped to target(s) that are paused or removed (${src.targets})`);
        return;
      }
    }
    targets = targets.filter((t) => routeAllowed(t, { text: final, hasMedia }));
    if (!targets.length) {
      P.mark(jid, id, 'skipped', 'routing: no target matched');
      ring.info('post.skip.routing', `Post skipped — no target's routing rule matched it (${src.name || jid})`);
      return;
    }

    // 5A (R39) — the routing matrix overrides the computed set: an explicit cell
    // ON adds the target, an explicit cell OFF removes it. No cells = legacy behavior.
    if (on('matrix')) {
      const cells = RC.enabledMap();
      const set = new Set(targets.map((t) => t.jid)); // start from mapping/routing result
      for (const t of CH.listActiveTargets()) {       // explicit cells override
        if (cells[`${jid}|${t.jid}`] === true) set.add(t.jid);
        else if (cells[`${jid}|${t.jid}`] === false) set.delete(t.jid);
      }
      targets = CH.listActiveTargets().filter((t) => set.has(t.jid));
      if (!targets.length) {
        P.mark(jid, id, 'skipped', 'routing matrix: no enabled target');
        ring.info('post.skip.matrix', `Post skipped — the routing matrix has no enabled target for ${src.name || jid}`);
        return;
      }
    }

    // 5A (R37) — the approval/hold gate: per-source "approve first" and/or the
    // global delay buffer. The composed final text + media are held, then the
    // queue publishes them through the SAME publisher (verification intact).
    const delayMin = Math.max(0, Math.min(1440, parseInt(S.get('queue.delay.min', '0'), 10) || 0));
    if (safetyReview || (on('queue') && (rule.approve_first || delayMin > 0))) {
      queue5a.enqueue({ sourceJid: jid, sourceMsgId: id, text: final, mediaBuf, mediaKind, mediaMime, msgTs: m.messageTimestamp || 0, targetJids: targets.map((t) => t.jid), requireApproval: Boolean(rule.approve_first || safetyReview) });
      try { require('./webhooks').fire('post.queued', { source: src.name || jid, approveFirst: !!rule.approve_first, delayMin }); } catch { } // 5G (R80)
      return;
    }

    // 5A (R41) — auto-split: over-4096 posts become numbered parts, media on part 1
    const mediaObj = (caption) => (mediaKind === 'video'
      ? { video: mediaBuf, caption, mimetype: mediaMime }
      : mediaKind === 'document'
        ? { document: mediaBuf, caption, mimetype: mediaMime, fileName: parts.media?.msg?.fileName || 'file' }
        : { image: mediaBuf, caption, mimetype: mediaMime });
    const partTexts = on('dedsplit') ? splitParts(final, 4096) : [final];
    const content = partTexts.length > 1
      ? { parts: partTexts.map((t, i) => (i === 0 && mediaBuf) ? mediaObj(t) : { text: t }) }
      : (mediaBuf ? mediaObj(final) : { text: final });
    if (partTexts.length > 1) ring.info('split.post', `Long post split into ${partTexts.length} numbered parts (media on part 1) — ${src.name || jid}`);
    const result = await publishMod.publish(content, {
      sourceJid: jid, sourceMsgId: id,
      only: targets.map((t) => t.jid),
      hasMedia: Boolean(mediaBuf),
      norm: (body || parts.text).slice(0, 400)
    });
    // 5A: keep the composed body + split count + source→publish latency (R46)
    {
      const pid = P.postId(jid, id);
      if (pid) {
        try {
          const d = require('./db').open();
          d.prepare('UPDATE posts SET body=?, part=? WHERE id=?').run(String(final).slice(0, 4096), partTexts.length - 1, pid);
          if (result.sent > 0 && m.messageTimestamp) LAT.record(pid, Math.max(0, Date.now() - m.messageTimestamp * 1000));
        } catch { }
      }
    }
    if (result.complete) {
      const lagSec = m.messageTimestamp ? Math.max(0, Math.round(Date.now() / 1000 - m.messageTimestamp)) : null;
      /* v9.0.0 (owner policy): the media is now in the target channel — delete
         the local copy (any size; nothing kept after posting). Text stays. */
      if (mediaBuf) { try { require('./db').IB.clearMediaForMsg('main', jid, id); ring.info('post.media.cleaned', `Post media deleted right after publishing (${mediaKind}) — it lives in the target channel now`); } catch { } }
      ring.info('post.published', `Published from ${src.name || jid}: ${result.sent}/${result.sent + result.failed} targets${mediaBuf ? `, 1 ${mediaKind}` : ''}${partTexts.length > 1 ? `, ${partTexts.length} parts` : ''}${lagSec != null ? ` (${lagSec}s after the source post)` : ''}`);
      try { require('./webhooks').fire('post.published', { source: src.name || jid, sent: result.sent, failed: result.failed, via: targets.map((t) => t.jid).join(', ') }); } catch { } // 5G (R80)
    } else if (result.failed) {
      // not marked by publish() (e.g. WhatsApp offline) → leave unmarked so the
      // recovery pull re-feeds it when the connection returns; if marked, record the failure honestly
      const pid = P.postId(jid, id);
      if (pid) {
        P.setStatus(pid, 'failed', result.errors.join(' | ').slice(0, 200));
        require('./alerts').maybe('failed', 'A post failed to publish', `${src.name || jid}: ${result.errors[0] || 'unknown'}`); // 5D (R65)
        try { require('./webhooks').fire('post.failed', { source: src.name || jid, error: result.errors[0] || 'unknown' }); } catch { } // 5G (R80)
      } else ring.warn('publish.deferred', `Publish deferred (WhatsApp not connected) — ${src.name || jid} post will be retried on reconnect`);
    }
  }
}

/* 5C (R56): emoji bullets — deterministic (no AI). Lines that already start
   with a bullet/number get a rotating emoji bullet; other lines are untouched. */
const EMOJI_BULLETS = ['📌', '✅', '⭐', '🔔', '👉'];
/** 5J (J1): Pipeline Inspector — DRY-RUN a text through the pipeline's
 *  deterministic text stages in the EXACT pipeline order (beautify/translate/
 *  TL;DR/auto-bold are AI: reported, not run — no cost, no side effects,
 *  nothing is published or queued). Returns per-stage before/after + the
 *  safety gates that WOULD fire + the final text + routing match. */
function inspectText(text, { sourceJid = '', hasMedia = false } = {}) {
  const stages = [];
  const push = (name, before, after, note) => stages.push({ name, before: String(before || ''), after: String(after || ''), changed: String(before || '') !== String(after || ''), note: String(note || '') });
  const gates = [];
  const addGate = (name, fired, detail) => gates.push({ name, fired: Boolean(fired), detail: String(detail || '') });
  let t = String(text || '');
  const src = sourceJid ? CH.listActiveSources().find((s) => s.jid === sourceJid) : null;
  const srcName = (src && (src.name || sourceJid)) || (sourceJid || '');

  /* ---- safety gates (read-only checks; in the real pipeline these precede compose) ---- */
  if (src) {
    const rule = SR.get(src.jid) || {};
    if (rule.active_from || rule.active_to) {
      const inWin = inActiveWindow(rule, pktWall());
      addGate('Active hours (source rule)', !inWin, inWin ? `inside ${rule.active_from || '…'}–${rule.active_to || '…'} PKT now` : `outside ${rule.active_from || '…'}–${rule.active_to || '…'} PKT now`);
    }
    const inc = String(rule.include || '').toLowerCase().split(',').map((w) => w.trim()).filter(Boolean);
    const exc = String(rule.exclude || '').toLowerCase().split(',').map((w) => w.trim()).filter(Boolean);
    const low = t.toLowerCase();
    if (inc.length) addGate('Keyword include', !inc.some((w) => low.includes(w)), `must contain: ${inc.join(', ')}`);
    if (exc.length) addGate('Keyword exclude', exc.some((w) => low.includes(w)), `must not contain: ${exc.join(', ')}${exc.some((w) => low.includes(w)) ? ' — HIT: ' + exc.find((w) => low.includes(w)) : ''}`);
    if (rule.max_per_day > 0) {
      const dayStart = new Date(Date.now() - (Date.now() + 5 * 3600e3) % 86400e3).toISOString().slice(0, 19).replace('T', ' ');
      const used = P5A.countFor(src.jid, dayStart);
      addGate('Daily cap (source rule)', used >= rule.max_per_day, `${used}/${rule.max_per_day} used today`);
    }
  }
  addGate('Near-duplicate (12 h)', isNearDuplicate(t), 'a very similar post was published in the last 12 h');
  const xHits = sourceJid ? (crossDedupeHits(normalizeText(t), sourceJid) || []) : [];
  addGate('Cross-source dedupe', Boolean(xHits.length), xHits.length ? `already published by ${xHits.length} other source(s) in the window` : '');
  const bad = blockedWord(t);
  addGate('Global blocklist', Boolean(bad), bad ? `contains the blocked word “${bad}”` : '');
  const guardMax = rateGuarded();
  const cap = Math.max(3, parseInt(S.get('guard.maxperhour', '30'), 10) || 30);
  addGate('Rate guard', Boolean(guardMax), `${CH.publishedLastHour()}/${cap}/h used`);

  /* ---- compose stages, EXACT pipeline order (5C R56 note: AI steps fail-open at publish) ---- */
  stages.push({ name: 'AI clean-up / beautify', before: t, after: t, changed: false, note: ai.state().hasKey ? 'runs with your AI key at publish (dry-run never calls the AI)' : 'no AI key — only the local clean-up (spacing/watermarks) applies at publish' });
  if (on('translate')) {
    const lang = String(S.get('ai.translate.lang', '')).trim();
    stages.push({ name: 'Translate', before: t, after: t, changed: false, note: on('translate') && lang ? `ON → ${lang} at publish (dry-run never calls the AI)` : 'OFF' });
  }
  if (on('aipilot')) {
    const c = String(S.get('power.aipilot.criteria', '')).trim();
    stages.push({ name: 'AI Pilot gate', before: t, after: t, changed: false, note: c ? `ON — posts must match “${c.slice(0, 60)}” (checked at publish)` : 'ON — no criteria set, passes everything' });
  }
  if (on('aisafety')) {
    const c = String(S.get('power.aisafety.criteria', '')).trim();
    stages.push({ name: 'AI safety screen', before: t, after: t, changed: false, note: c ? `ON — final text must match “${c.slice(0, 60)}” (checked at publish; unavailable: ${S.get("power.aisafety.unavailable", "open") === "review" ? "hold for review" : "continue"})` : 'ON — no criteria set, passes everything' });
  }

  const applied = templates.apply(t, { sourceName: srcName, dryRun: true });
  push('Template (v7.5.0 zones)', t, applied.text, applied.used ? `template “${applied.used}” (${templates.getInfo().mode})` : (templates.getInfo().mode === 'off' ? 'template mode OFF' : 'no template matched the pool'));
  let cur = applied.text;
  const tags = hashtagsFor(cur);
  if (tags && !applied.hasHashtagZone) { cur = `${cur}\n\n${tags}`; push('Hashtags', cur.replace(/\n\n#[^\n]*$/, ''), cur, `auto tags: ${tags}`); }
  else push('Hashtags', cur, cur, tags ? 'template has its own hashtag zone' : on('hashtags') ? 'no tag keywords in the text' : 'switch OFF');
  if (applied.header === '') {
    const head = headerFor(cur);
    if (head) { const b = cur; cur = `${head}\n\n${cur}`; push('Auto header', b, cur, 'post title line as header'); }
    else push('Auto header', cur, cur, on('headers') ? 'no title line found' : 'switch OFF');
  } else push('Template header/footer', cur, cur, `provided by the template (“${applied.used}”)`);
  if (applied.footer === '' && on('signature')) {
    const sig = String(S.get('power.signature.text', '')).trim();
    if (sig) { const b = cur; cur = `${cur}\n\n${sig}`; push('Signature / footer', b, cur, 'auto-appended'); }
    else push('Signature / footer', cur, cur, 'switch ON but no signature text set');
  }
  if (on('tldr')) stages.push({ name: 'TL;DR line', before: cur, after: cur, changed: false, note: cur.length >= 240 ? 'ON — adds a one-line summary at publish (dry-run never calls the AI)' : 'ON — text under 240 chars, skipped at publish' });
  if (on('autobold')) stages.push({ name: 'Auto bold', before: cur, after: cur, changed: false, note: 'ON — bolds key phrases at publish (dry-run never calls the AI)' });
  const eb = on('emojibullets') ? emojiBullets(cur) : cur;
  push('Emoji bullets', cur, eb, on('emojibullets') ? 'list lines get bullet emoji' : 'switch OFF');
  cur = eb;
  let gl = [];
  try { gl = GL.list() || []; } catch { }
  if (gl.length) {
    const beforeGl = cur;
    try { cur = GL.apply(cur); } catch { }
    push('Glossary (owner terms)', beforeGl, cur, `${gl.length} term(s) enforced`);
  } else push('Glossary (owner terms)', cur, cur, 'no glossary terms defined');
  if (on('linktools')) {
    const beforeLk = cur;
    try { cur = stripTrackingParams(cur); } catch { }
    push('Link tools (tracking cleanup)', beforeLk, cur, on('linktools') ? 'utm_*/fbclid/etc stripped from URLs' : 'switch OFF');
  }

  /* ---- split + routing (read-only) ---- */
  const parts = splitParts(cur);
  stages.push({ name: 'Auto-split (>4096 chars)', before: cur.slice(0, 300), after: parts.length > 1 ? `${parts.length} parts — ${parts.map((p) => p.length).join(' + ')} chars` : '1 part — ' + cur.length + ' chars', changed: parts.length > 1, note: parts.length > 1 ? 'parts labeled (1/2)… — media rides part 1' : '' });
  const mapped = src ? String(src.targets || '').trim() : '';
  let targets = CH.listActiveTargets();
  if (mapped) targets = targets.filter((tt) => mapped.split(',').map((x) => x.trim()).filter(Boolean).includes(tt.jid));
  const allowed = targets.filter((tt) => routeAllowed(tt, { text: cur, hasMedia }));
  return {
    stages, gates, finalText: cur, partCount: parts.length, partSizes: parts.map((p) => p.length),
    targets: allowed.map((tt) => tt.name || tt.jid), targetCount: allowed.length,
    targetNote: mapped ? 'source is pinned to specific targets' : ''
  };
}

/** 5J (J1): counter strip — today's (PKT day) tallies + the rate guard now. Read-only. */
function counters() {
  const dayStartUtc = new Date(Date.now() - (Date.now() + 5 * 3600e3) % 86400e3).toISOString().slice(0, 19).replace('T', ' ');
  const d = require('./db').open();
  const rows = d.prepare(`SELECT p.status, COUNT(*) n FROM posts p WHERE p.created_at >= ? GROUP BY p.status`).all(dayStartUtc);
  const byTarget = d.prepare(`SELECT t.name, t.jid, COUNT(pk.post_id) n FROM post_keys pk JOIN posts p ON p.id = pk.post_id JOIN targets t ON t.jid = pk.target_jid WHERE p.status='published' AND p.created_at >= ? GROUP BY pk.target_jid ORDER BY n DESC`).all(dayStartUtc);
  const lastHour = CH.publishedLastHour();
  const cap = Math.max(3, parseInt(S.get('guard.maxperhour', '30'), 10) || 30);
  return {
    dayStartPkt: dayStartUtc.slice(0, 10),
    published: rows.find((r) => r.status === 'published')?.n || 0,
    skipped: rows.find((r) => r.status === 'skipped')?.n || 0,
    failed: rows.find((r) => r.status === 'failed')?.n || 0,
    edited: rows.find((r) => r.status === 'edited')?.n || 0,
    lastHour, cap,
    byTarget
  };
}

function emojiBullets(text) {
  let i = 0;
  return String(text || '').split('\n').map((line) => {
    const m = line.match(/^\s*(?:[-*•–]|\d+[.)])\s+(.*)$/);
    if (!m) return line;
    const b = EMOJI_BULLETS[i % EMOJI_BULLETS.length];
    i += 1;
    return `${b} ${m[1]}`;
  }).join('\n');
}

module.exports = {
  intake, intakeRss, extract, routeAllowed, isNearDuplicate, splitParts, normalizeText, handleSourceEdit, emojiBullets, blockedWord,
  stripTrackingParams, smartMediaCheck, inspectText, counters,
  switches: () => { const o = {}; for (const k of Object.keys(SWITCH_DEFAULTS)) o[k] = on(k); return o; },
  setSwitch: (k, v) => { if (!(k in SWITCH_DEFAULTS)) throw new Error(`unknown switch: ${k}`); S.set(`power.${k}.on`, v ? '1' : '0'); },
  SWITCH_DEFAULTS
};
