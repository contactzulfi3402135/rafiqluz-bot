'use strict';
/**
 * 5G (R82): RSS/ATOM SOURCE TYPE — feeds are fetched every 15 minutes and each
 * NEW item is fed through the SAME pipeline (pipeline.intakeRss → processOne)
 * as WhatsApp channels: identical dedupe, blocklist, rate guard, keyword
 * routing, 4096-splitting, approval queue and publish path. RSS sources never
 * touch the WhatsApp link, and intake()'s @newsletter-only contract is
 * unchanged (R2 — an additive entry, never a loosened guard).
 * Per-fetch item cap (20) keeps a runaway feed from flooding the pipeline.
 */
const db = require('./db');
const { S, CH } = db;
const { ring } = require('./logger');
const crypto = require('crypto');

const POLL_MS = 15 * 60e3;
const MAX_ITEMS_PER_FETCH = 20;

/** Stable pseudo-jid per feed URL (the sources table is keyed by jid). */
function rssJid(url) {
  const h = crypto.createHash('sha1').update(String(url || '').trim().toLowerCase()).digest('hex').slice(0, 14);
  return 'rss-' + h + '@rss';
}

function decodeXml(s) {
  return String(s || '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => { try { return String.fromCodePoint(Number(n)); } catch { return ''; } })
    .replace(/&amp;/g, '&');
}
function stripTags(s) {
  return String(s || '').replace(/<\s*(br|\/p|\/div|\/li|\/h[1-6])[^>]*>/gi, '\n').replace(/<[^>]*>/g, ' ').replace(/[ \t]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim();
}

/** Lightweight RSS 2.0 / Atom parser — zero new dependencies (R6 stack). */
function parseFeed(xml) {
  const out = [];
  const isAtom = /<feed[\s>]/.test(xml);
  const blockRe = isAtom ? /<entry[\s>][\s\S]*?<\/entry>|<entry\/>/g : /<item[\s>][\s\S]*?<\/item>|<item\/>/g;
  for (const m of String(xml || '').match(blockRe) || []) {
    const get = (tag) => {
      const r = m.match(new RegExp('<' + tag + '(?:\\s[^>]*)?>([\\s\\S]*?)</' + tag + '>', 'i'));
      return r ? r[1].trim() : '';
    };
    let title = decodeXml(get('title') || get('name'));
    let link = '';
    if (isAtom) {
      const alt = m.match(/<link[^>]*rel=["']alternate["'][^>]*href=["']([^"']*)["']/i) || m.match(/<link[^>]*href=["']([^"']*)["'][^>]*rel=["']alternate["']/i);
      link = alt ? decodeXml(alt[1]) : (m.match(/<link[^>]*href=["']([^"']*)["']/i) || [])[1] || '';
    } else {
      link = decodeXml(get('link'));
    }
    const descRaw = get('description') || get('summary') || get('content:encoded') || get('content') || '';
    let desc = stripTags(decodeXml(descRaw));
    // RSS often mirrors the title into the description — drop the duplicate opening
    if (title && desc.startsWith(title)) desc = desc.slice(title.length).trim();
    const tsRaw = get('pubDate') || get('published') || get('dc:date') || get('updated') || '';
    const t = Date.parse(tsRaw);
    const guid = (get('guid') || get('id') || link || (title + '|' + (Number.isFinite(t) ? t : ''))).slice(0, 300);
    const text = [title, desc].filter(Boolean).join('\n\n').trim();
    if ((title || desc) && guid) out.push({ id: guid, title: title.slice(0, 300), link: String(link || '').slice(0, 500), text: text.slice(0, 3800), ts: Number.isFinite(t) ? t : Date.now() });
    if (out.length >= MAX_ITEMS_PER_FETCH) break;
  }
  return out;
}

/** Active RSS sources (kind='rss', not paused, with a URL). */
function sources() {
  return CH.listActiveSources().filter((s) => s.kind === 'rss' && s.url);
}

/** Fetch one feed and push unseen items into the pipeline. Returns stats. */
async function pollOnce(src) {
  const res = await fetch(src.url, {
    redirect: 'follow',
    signal: AbortSignal.timeout(20e3),
    headers: { 'user-agent': 'Mozilla/5.0 (compatible; RaqifluzBot/1.0; channel-relay)', accept: 'application/atom+xml, application/rss+xml, application/xml, text/xml' }
  });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const xml = await res.text();
  const items = parseFeed(xml);
  let added = 0, seen = 0;
  const pipeline = require('./pipeline');
  for (const it of items) {
    const d = db.open();
    if (d.prepare('SELECT 1 FROM rss_seen WHERE url=? AND guid=?').get(src.url, it.id)) { seen++; continue; }
    d.prepare('INSERT OR IGNORE INTO rss_seen(url, guid) VALUES(?,?)').run(src.url, it.id);
    await pipeline.intakeRss({ jid: src.jid, id: it.id, text: it.text, ts: it.ts, title: it.title, link: it.link, url: src.url, sourceName: src.name });
    added++;
  }
  return { items: items.length, added, seen };
}

/** UI "Test feed" — fetch + parse only, nothing published. */
async function testFeed(url) {
  const res = await fetch(String(url || ''), { redirect: 'follow', signal: AbortSignal.timeout(15e3), headers: { 'user-agent': 'RaqifluzBot-1.0 (feed-test)' } });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const items = parseFeed(await res.text());
  if (!items.length) throw new Error('Fetched OK but no items found — the URL may not be a feed.');
  return {
    items: items.length,
    jid: rssJid(url),
    sample: items.slice(0, 3).map((i) => ({ title: i.title, link: i.link, ts: new Date(i.ts).toISOString().slice(0, 16).replace('T', ' ') }))
  };
}

function start() {
  const pass = async () => {
    if (S.getBool('panic.on', false)) return; // 5E (R73): panic stop holds RSS too
    for (const s of sources()) {
      try {
        const r = await pollOnce(s);
        if (r.added) ring.info('rss.fetched', `RSS “${s.name}”: ${r.added} new item(s) into the pipeline`);
      } catch (err) {
        ring.warn('rss.fail', `RSS “${s.name}” fetch failed: ${String(err?.message || err).slice(0, 140)}`);
      }
    }
  };
  setInterval(() => { pass().catch(() => { }); }, POLL_MS).unref?.();
  setTimeout(() => { pass().catch(() => { }); }, 20e3).unref?.(); // first pass shortly after boot
  ring.info('rss.ready', 'RSS/Atom engine armed — feeds fetch every 15 minutes');
}

module.exports = { rssJid, parseFeed, sources, pollOnce, testFeed, start, POLL_MS };
