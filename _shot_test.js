/* Visual QA harness — desktop 1440 + phone 390 screenshots, overflow audit, console errors */
const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

const PORT = 20249;
const SHOTS = '/home/user/shots';
fs.mkdirSync(SHOTS, { recursive: true });

const VIEWS = ['home', 'approvals', 'sources', 'analytics', 'settings', 'whatsapp', 'health', 'newpost', 'posts', 'bulk', 'media', 'email', 'audit', 'journal', 'aipilot'];

async function login() {
  const r = await fetch(`http://localhost:${PORT}/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'test1234' }),
    redirect: 'manual',
  });
  const setc = r.headers.getSetCookie ? r.headers.getSetCookie() : [];
  return setc.map(c => c.split(';')[0]);
}

(async () => {
  const cookies = await login();
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--force-device-scale-factor=1'],
  });
  const report = { consoleErrors: [], overflows: [], pageErrors: [] };

  async function shoot(viewport, tag, views, opts = {}) {
    const page = await browser.newPage();
    await page.setViewport(viewport);
    for (const c of cookies) {
      const [name, val] = c.split('=');
      await page.setCookie({ name, value: val, url: `http://localhost:${PORT}/` });
    }
    page.on('console', (m) => { if (m.type() === 'error') report.consoleErrors.push(`[${tag}] ${m.text().slice(0, 200)}`); });
    page.on('pageerror', (e) => report.pageErrors.push(`[${tag}] ${String(e.message).slice(0, 200)}`));
    const results = [];
    let first = true;
    for (const v of views) {
      if (first) {
        await page.goto(`http://localhost:${PORT}/admin#view=${v}`, { waitUntil: 'load', timeout: 30000 });
        first = false;
      } else {
        await page.evaluate((vv) => { window.show(vv); window.scrollTo(0, 0); }, v);
      }
      await new Promise(r => setTimeout(r, opts.wait || 1200));
      await page.evaluate(() => { const w = document.querySelector('#wizScrim'); if (w) w.style.display = 'none'; });
      await page.screenshot({ path: path.join(SHOTS, `${tag}-${v}.png`), fullPage: !!opts.full });
      // overflow audit
      const ov = await page.evaluate(() => {
        const vw = document.documentElement.clientWidth;
        const out = { scrollW: document.documentElement.scrollWidth, bad: [] };
        if (out.scrollW > vw + 1) out.bad.push(`DOC scrollWidth ${out.scrollW} > ${vw}`);
        const sw = document.scrollingElement.scrollWidth;
        document.querySelectorAll('body *').forEach((el) => {
          const r = el.getBoundingClientRect();
          if (r.width === 0 && r.height === 0) return;
          const st = getComputedStyle(el);
          if (st.display === 'none' || st.visibility === 'hidden') return;
          if (r.right > vw + 2) {
            const cls = (el.className && el.className.baseVal !== undefined) ? el.className.baseVal : (el.className || '');
            if (st.position === 'fixed' || st.position === 'sticky') {
              if (out.bad.length < 12) out.bad.push(`${el.tagName}.${String(cls).slice(0, 60)} right=${Math.round(r.right)} (fixed/sticky)`);
              return;
            }
            let inScroller = false, anc = el.parentElement;
            while (anc && anc !== document.body) {
              const ox = getComputedStyle(anc).overflowX;
              if ((ox === 'auto' || ox === 'scroll') && anc.getBoundingClientRect().right <= vw + 2) { inScroller = true; break; }
              anc = anc.parentElement;
            }
            if (!inScroller && out.bad.length < 12) out.bad.push(`${el.tagName}.${String(cls).slice(0, 60)} right=${Math.round(r.right)}`);
          }
        });
        return out;
      });
      results.push({ v, ...ov });
      if (opts.after) await opts.after(page);
    }
    return results;
  }

  const desk = await shoot({ width: 1440, height: 900 }, 'desk', VIEWS.slice(0, 7));
  const phViews = ['home', 'approvals', 'sources', 'analytics', 'settings', 'whatsapp', 'health', 'newpost', 'posts'];
  const phone = await shoot({ width: 390, height: 844, isMobile: true, hasTouch: true, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1' }, 'phone', phViews, { full: true, wait: 1500 });

  fs.writeFileSync(path.join(SHOTS, 'report.json'), JSON.stringify(report, null, 1));
  console.log('=== OVERFLOWS ===');
  [...desk, ...phone].forEach((r) => {
    if (r.bad.length) console.log(`\n${r.v} (${r.scrollW}px wide):` + r.bad.map(b => '\n  ' + b).join(''));
    else console.log(`${r.v}: clean`);
  });
  console.log('\n=== CONSOLE ERRORS ===');
  console.log(report.consoleErrors.length ? [...new Set(report.consoleErrors)].join('\n') : 'none');
  console.log('\n=== PAGE ERRORS ===');
  console.log(report.pageErrors.length ? [...new Set(report.pageErrors)].join('\n') : 'none');
  await browser.close();
  process.exit(0);
})().catch((e) => { console.error('HARNESS FAIL:', e); process.exit(1); });
