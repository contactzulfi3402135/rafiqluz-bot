// focused: phone WA chat-toggle — CSS state + back button wiring
const path = require('path');
const puppeteer = require('puppeteer');
const BASE = 'http://127.0.0.1:20249';
const SHOTS = '/home/user/shots';

(async () => {
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await page.setUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1');

  const lr = await fetch(BASE + '/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'test1234' }), redirect: 'manual',
  });
  const setc = lr.headers.getSetCookie ? lr.headers.getSetCookie() : [];
  console.log('login', lr.status, 'cookies', setc.length);
  for (const c of setc) { const [name, value] = c.split(';')[0].split('='); await page.setCookie({ name, value, url: BASE }); }
  await page.goto(BASE + '/admin', { waitUntil: 'load', timeout: 30000 });
  await new Promise(res => setTimeout(res, 1500));
  await page.evaluate(() => { window.show('whatsapp'); const w = document.querySelector('#wizScrim'); if (w) w.style.display = 'none'; });
  await new Promise(res => setTimeout(res, 800));

  // 1) default state: side visible, pane hidden, back hidden
  const s0 = await page.evaluate(() => ({
    sideDisplay: getComputedStyle(document.querySelector('.ww-side')).display,
    paneDisplay: getComputedStyle(document.querySelector('.wa-pane')).display,
    backDisplay: getComputedStyle(document.querySelector('#waBackBtn')).display,
  }));
  console.log('closed state', JSON.stringify(s0));
  await page.screenshot({ path: path.join(SHOTS, 'phone-ww-closed.png') });

  // 2) simulate open chat
  await page.evaluate(() => document.querySelector('.ww').classList.add('chat-open'));
  await new Promise(res => setTimeout(res, 300));
  const s1 = await page.evaluate(() => ({
    sideDisplay: getComputedStyle(document.querySelector('.ww-side')).display,
    paneDisplay: getComputedStyle(document.querySelector('.wa-pane')).display,
    backDisplay: getComputedStyle(document.querySelector('#waBackBtn')).display,
    backRight: Math.round(document.querySelector('#waBackBtn').getBoundingClientRect().right),
    backTop: Math.round(document.querySelector('#waBackBtn').getBoundingClientRect().top),
  }));
  console.log('open state', JSON.stringify(s1));
  await page.screenshot({ path: path.join(SHOTS, 'phone-ww-open.png') });

  // 3) back button must remove the class (JS wiring)
  await page.click('#waBackBtn');
  await new Promise(res => setTimeout(res, 200));
  const s2 = await page.evaluate(() => document.querySelector('.ww').classList.contains('chat-open'));
  console.log('after back click, chat-open =', s2);

  await browser.close();
  console.log('DONE');
})().catch(e => { console.error('FAIL', e.message); process.exit(1); });
