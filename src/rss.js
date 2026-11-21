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

function decodeXml(value) {
  const s=String(value || '');let text='',cursor=0;
  while(cursor<s.length) {
    const start=s.indexOf('<![CDATA[',cursor);
    if(start<0){text+=s.slice(cursor);break;}
    text+=s.slice(cursor,start);const end=s.indexOf(']]>',start+9);
    if(end<0){text+=s.slice(start);break;}
    text+=s.slice(start+9,end);cursor=end+3;
  }
  return text
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => { try { return String.fromCodePoint(Number(n)); } catch { return ''; } })
    .replace(/&amp;/g, '&');
}
function stripTags(value) {
  const s=String(value || '');let out='',i=0;
  while(i<s.length) {
    const start=s.indexOf('<',i);
    if(start<0){out+=s.slice(i);break;}
    out+=s.slice(i,start);const end=s.indexOf('>',start+1);
    if(end<0) break;
    const tag=s.slice(start+1,end).trim().toLowerCase();
    if (/^(br\b|\/(p|div|li|h[1-6])\b)/.test(tag))out+='\n';
    else out+=' ';
    i=end+1;
  }
  return out.replace(/[ \t]+/g,' ').split(/\n+/).map(line=>line.trim()).join('\n').trim();
}

/** Lightweight RSS 2.0 / Atom parser — zero new dependencies (R6 stack). */
function parseFeed(xml) {
  const out = [], raw=String(xml || ''), lower=raw.toLowerCase();
  const isAtom = /<feed[\s>]/i.test(raw), tag=isAtom?'entry':'item';
  let cursor=0;
  while (cursor<raw.length && out.length<MAX_ITEMS_PER_FETCH) {
    const start=lower.indexOf('<'+tag,cursor);
    if(start<0)break;
    const next=lower[start+tag.length+1];
    if(next && !/[\s/>]/.test(next)) {cursor=start+tag.length+1;continue;}
    const openEnd=lower.indexOf('>',start+tag.length+1);
    if(openEnd<0)break;
    if(raw[openEnd-1]==='/'){cursor=openEnd+1;continue;}
    const close=lower.indexOf('</'+tag+'>',openEnd+1);
    if(close<0)break;
    const end=close+tag.length+3;
    const m=raw.slice(start,end);cursor=end;
    const lowerItem=m.toLowerCase();
    const get = (name) => {
      name=name.toLowerCase();let pos=0;
      while((pos=lowerItem.indexOf('<'+name,pos))>=0) {
        const next=lowerItem[pos+name.length+1];
        if(next && !/[\s>]/.test(next)){pos+=name.length+1;continue;}
        const open=lowerItem.indexOf('>',pos+name.length+1);if(open<0)return '';
        const close=lowerItem.indexOf('</'+name+'>',open+1);return close<0?'':m.slice(open+1,close).trim();
      }
      return '';
    };
    let title = decodeXml(get('title') || get('name'));
    let link = '';
    if (isAtom) {
      let at=0,fallback='';
      while((at=lowerItem.indexOf('<link',at))>=0) {
        const end=lowerItem.indexOf('>',at+5);if(end<0)break;
        const tagText=m.slice(at,Math.min(end+1,at+4096));at=end+1;
        const href=tagText.match(/\bhref\s*=\s*["']([^"']{0,2048})["']/i);
        if(!href)continue;
        const value=decodeXml(href[1]);if(!fallback)fallback=value;
        if(/\brel\s*=\s*["']alternate["']/i.test(tagText)){link=value;break;}
      }
      if(!link)link=fallback;
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
async function fetchFeed(url) {
  return (await require('./safe-public-fetch').fetchPublic(String(url || ''), {maxBytes:2*1024*1024,timeoutMs:20000})).toString('utf8');
}
async function pollOnce(src, options = {}) {
  const xml = await (options.fetchFeed || fetchFeed)(src.url);
  const items = parseFeed(xml);
  let added = 0, seen = 0, deferred = 0;
  const pipeline = options.pipeline || require('./pipeline');
  for (const it of items) {
    if (S.getBool('panic.on',false) || S.getBool('mirror.paused',false)) { deferred++; continue; }
    const d = db.open();
    if (d.prepare('SELECT 1 FROM rss_seen WHERE url=? AND guid=?').get(src.url,it.id)) { seen++; continue; }
    const result=await pipeline.intakeRss({ jid:src.jid, id:it.id, text:it.text, ts:it.ts, title:it.title, link:it.link, url:src.url, sourceName:src.name });
    // Record only after the pipeline has created an outcome. A crash or pause
    // before a post is recorded leaves the feed item eligible for a later poll.
    // A recorded/uncertain send is not blindly replayed.
    if (result?.state === 'recorded' || db.P.seen(src.jid,it.id)) {
      d.prepare('INSERT OR IGNORE INTO rss_seen(url,guid) VALUES(?,?)').run(src.url,it.id); added++;
    } else deferred++;
  }
  return {items:items.length,added,seen,deferred};
}

/** UI "Test feed" — fetch + parse only, nothing published. */
async function testFeed(url) {
  const items = parseFeed(await fetchFeed(url));
  if (!items.length) throw new Error('Fetched OK but no items found — the URL may not be a feed.');
  return {items:items.length,jid:rssJid(url),sample:items.slice(0,3).map(i=>({title:i.title,link:i.link,ts:new Date(i.ts).toISOString().slice(0,16).replace('T',' ')}))};
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
