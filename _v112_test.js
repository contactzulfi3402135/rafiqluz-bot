'use strict';
/* v1.1.2 verification: (1) login styled, (2) banner per-channel Add + numeric
   names masked, (3) AI panel no auto-refresh + manual refresh works,
   (4) chanLbl masking unit checks. Live server on :20249. */
const puppeteer = require('puppeteer');
const BASE = 'http://127.0.0.1:20249';
let fails = 0;
const ok = (name, cond, extra = '') => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  — ' + extra : ''}`); if (!cond) fails++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const errors = [];

  /* ── 1 · LOGIN PAGE — desktop + phone ── */
  for (const [label, w, h, ua] of [
    ['desktop', 1440, 900, null],
    ['phone', 390, 844, 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'],
  ]) {
    const page = await browser.newPage();
    page.on('console', (m) => { if (m.type() === 'error') errors.push('login-' + label + ': ' + m.text()); });
    page.on('pageerror', (e) => errors.push('login-' + label + '-pageerror: ' + e.message));
    await page.setViewport({ width: w, height: h });
    if (ua) await page.setUserAgent(ua);
    const res = await page.goto(BASE + '/login', { waitUntil: 'load', timeout: 20000 });
    ok(`login/${label} HTTP ok (200/304)`, res.status() === 200 || res.status() === 304, 'status=' + res.status());
    const css = await page.evaluate(() => {
      const c = document.querySelector('.login-card');
      const cs = getComputedStyle(c);
      const i = document.querySelector('.login-card input');
      const is = getComputedStyle(i);
      const body = getComputedStyle(document.body);
      return {
        cardBg: cs.backgroundColor, cardBorder: cs.borderTopWidth + ' ' + cs.borderTopStyle,
        cardRadius: cs.borderTopLeftRadius, cardShadow: cs.boxShadow !== 'none',
        inputBg: is.backgroundColor, inputH: is.height, inputRadius: is.borderTopLeftRadius,
        bodyBg: body.backgroundColor, hasBtnBlock: !!document.querySelector('.btn-block'),
        h1: c.querySelector('h1').textContent.trim(),
      };
    });
    ok(`login/${label} card painted (bg)`, css.cardBg.startsWith('rgb(') && css.cardBg !== 'rgba(0, 0, 0, 0)', css.cardBg);
    ok(`login/${label} card bordered`, css.cardBorder.startsWith('1px') && /solid/.test(css.cardBorder), css.cardBorder);
    const tokR = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--r-card').trim());
    ok(`login/${label} card radius = --r-card token`, css.cardRadius === tokR, `got ${css.cardRadius} token ${tokR}`);
    ok(`login/${label} card shadow`, css.cardShadow);
    ok(`login/${label} input styled`, css.inputH === '42px' && css.inputRadius === '8px', `h=${css.inputH} r=${css.inputRadius} bg=${css.inputBg}`);
    ok(`login/${label} page bg painted`, css.bodyBg !== 'rgba(0, 0, 0, 0)', css.bodyBg);
    await page.screenshot({ path: `/home/user/shots/v112-login-${label}.png`, fullPage: true });
    await page.close();
  }

  /* ── 2 · REAL FORM LOGIN → DASHBOARD (session cookie + bearer token) ── */
  const page = await browser.newPage();
  page.on('console', (m) => { if (m.type() === 'error') errors.push('dash: ' + m.text()); });
  page.on('pageerror', (e) => errors.push('dash-pageerror: ' + e.message));
  await page.setViewport({ width: 1440, height: 900 });
  await page.evaluateOnNewDocument(() => { try { localStorage.setItem('rc-wiz-skipped', '1'); } catch (e) {} });
  await page.goto(BASE + '/login', { waitUntil: 'load', timeout: 20000 });
  await page.type('input[name=username]', 'admin');
  await page.type('input[name=password]', 'test1234');
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'load', timeout: 20000 }).catch(() => {}),
    page.click('.login-card button[type="submit"]'),
  ]);
  const urlAfter = page.url();
  ok('form login lands on /admin', urlAfter.startsWith(BASE + '/admin'), urlAfter);
  const hasTok = await page.evaluate(() => Boolean(localStorage.getItem('rq6-token')));
  ok('bearer token stored by login script', hasTok);
  const wizHidden = await page.evaluate(() => { const w = document.getElementById('wizScrim'); return w ? w.hidden : true; });
  ok('first-run wizard not covering page', wizHidden);
  await sleep(3000);

  /* chanLbl unit checks in-page */
  const units = await page.evaluate(() => ({
    numeric: chanLbl('12345678', '12036312345678@newsletter'),
    real: chanLbl('Tech News Daily', '12036312345678@newsletter'),
    empty: chanLbl('', '1203631234567890@newsletter'),
    jidAsName: chanLbl('1203631234567890@newsletter', '1203631234567890@newsletter'),
  }));
  ok('chanLbl masks numeric name', units.numeric === 'Channel •5678', units.numeric);
  ok('chanLbl keeps real name', units.real === 'Tech News Daily', units.real);
  ok('chanLbl masks empty name', units.empty === 'Channel •7890', units.empty);
  ok('chanLbl masks jid-as-name', units.jidAsName === 'Channel •7890', units.jidAsName);

  /* ── stub fetch: followedMissing with numeric + real names ── */
  await page.evaluate(() => {
    const orig = window.fetch;
    window.__chatReqs = 0;
    window.__addHits = [];
    window.__added = new Set();
    const FOLLOWED = [
      { jid: '12036300999999999999@newsletter', name: '12036300999999999999' },
      { jid: '12036311111111111111@newsletter', name: 'Real News Channel' },
    ];
    window.fetch = async (url, opts = {}) => {
      const u = String(url);
      if (u.includes('/api/ai/chat') && (!opts.method || opts.method === 'GET')) window.__chatReqs++;
      if (u.includes('/api/sources')) {
        return new Response(JSON.stringify({ ok: true, list: [], followedMissing: FOLLOWED.filter((m) => !window.__added.has(m.jid)) }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (u.includes('/api/browse/add-source')) {
        const b = JSON.parse(opts.body || '{}');
        window.__addHits.push(b.jid);
        window.__added.add(b.jid);
        return new Response(JSON.stringify({ ok: true, jid: b.jid, name: 'n' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      return orig(url, opts);
    };
  });

  await page.evaluate(() => show('sources'));
  await sleep(2000);
  const banner = await page.evaluate(() => {
    const box = document.getElementById('srcSyncBanner');
    if (!box) return null;
    return {
      hidden: box.hidden,
      html: box.innerHTML,
      head: (box.querySelector('.ssb-head') || {}).textContent || '',
      rows: Array.from(box.querySelectorAll('.ssb-row')).map((r) => ({
        name: r.querySelector('.ssb-name').textContent,
        add: !!r.querySelector('button[data-add]'),
      })),
      hasAddAll: /Add all/.test(box.innerHTML) || !!document.getElementById('srcSyncAll'),
    };
  });
  ok('banner visible with 2 rows', banner && !banner.hidden && banner.rows.length === 2, banner ? `rows=${banner.rows.length}` : 'no box');
  ok('numeric name masked in banner', banner && banner.rows[0].name === 'Channel •9999', banner && banner.rows[0].name);
  ok('real name kept in banner', banner && banner.rows[1].name === 'Real News Channel', banner && banner.rows[1].name);
  ok('each row has its own Add button', banner && banner.rows.every((r) => r.add));
  ok('"Add all" option removed', banner && banner.hasAddAll === false);
  await page.screenshot({ path: '/home/user/shots/v112-sources-banner.png' });

  /* click Add on the numeric-named row */
  await page.click('.ssb-row button[data-add]');
  await sleep(1200);
  const after1 = await page.evaluate(() => {
    const box = document.getElementById('srcSyncBanner');
    return { hits: window.__addHits, rows: box ? box.querySelectorAll('.ssb-row').length : -1, hidden: box ? box.hidden : null };
  });
  ok('Add click hit /api/browse/add-source with jid', after1.hits.length === 1 && after1.hits[0] === '12036300999999999999@newsletter', JSON.stringify(after1.hits));
  ok('added row removed from banner', after1.rows === 1, `rows=${after1.rows}`);
  await page.click('.ssb-row button[data-add]');
  await sleep(1200);
  const after2 = await page.evaluate(() => {
    const box = document.getElementById('srcSyncBanner');
    return { rows: box ? box.querySelectorAll('.ssb-row').length : -1, hidden: box ? box.hidden : null };
  });
  ok('banner hides when last channel added', after2.hidden === true, JSON.stringify(after2));

  /* ── 3 · AI PANEL — no auto-refresh, manual refresh works ── */
  const rfBtn = await page.evaluate(() => !!document.getElementById('robotRefresh'));
  ok('manual Refresh button exists in AI panel header', rfBtn);
  await page.click('#robotFab');
  await sleep(1500);
  const c0 = await page.evaluate(() => window.__chatReqs);
  ok('opening panel loads assistant once', c0 >= 1, `reqs=${c0}`);
  await sleep(12000); // 8 s timer would have added 1–2 more requests
  const c1 = await page.evaluate(() => window.__chatReqs);
  ok('NO auto-refresh over 12 s (request count unchanged)', c1 === c0, `before=${c0} after=${c1}`);
  await page.click('#robotRefresh');
  await sleep(1000);
  const c2 = await page.evaluate(() => window.__chatReqs);
  ok('manual Refresh button fires a reload', c2 === c1 + 1, `before=${c1} after=${c2}`);
  await page.screenshot({ path: '/home/user/shots/v112-ai-panel.png' });

  /* ── 4 · srcRefresh wiring exists (no full click — WA not linked) ── */
  const wiring = await page.evaluate(() => {
    const src = document.getElementById('srcRefresh');
    return { exists: !!src, listeners: typeof getEventListeners === 'function' };
  });
  ok('Sources Refresh button present', wiring.exists);

  await page.close();
  await browser.close();

  console.log('---');
  if (errors.length) { console.log('CONSOLE/PAGE ERRORS:'); errors.forEach((e) => console.log('  ' + e)); }
  ok('zero console/page errors', errors.length === 0, `${errors.length} errors`);
  console.log(fails === 0 ? 'ALL TESTS PASSED' : `${fails} TEST(S) FAILED`);
  process.exit(fails === 0 ? 0 : 1);
})().catch((e) => { console.error('HARNESS ERROR:', e); process.exit(2); });
