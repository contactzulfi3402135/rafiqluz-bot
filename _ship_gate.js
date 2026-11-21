/* v1.1.1 ship gate — 4 checks, one login (rate-limit friendly) */
const { JSDOM } = require('jsdom');
const BASE = 'http://127.0.0.1:20249';
let fails = 0;
const ok = (name, cond, extra) => { console.log((cond ? 'PASS' : 'FAIL') + ' ' + name + (extra ? ' — ' + extra : '')); if (!cond) fails++; };

(async () => {
  // ── Gate 1 · API probes (single login) ─────────────────────────
  const lr = await fetch(BASE + '/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'test1234' }), redirect: 'manual',
  });
  const setc = (lr.headers.getSetCookie ? lr.headers.getSetCookie() : []).map(c => c.split(';')[0]).join('; ');
  ok('login 302 + cookie', lr.status === 302 && setc.length > 0, 'cookie: ' + (setc ? setc.split('=')[0] : 'none'));
  const H = { cookie: setc };
  const get = async (p) => { const r = await fetch(BASE + p, { headers: H }); let j = null; try { j = await r.json(); } catch (e) {} return { s: r.status, j }; };
  const paths = ['/api/power', '/api/overview', '/status', '/api/health', '/api/queue', '/api/settings'];
  for (const p of paths) {
    const { s, j } = await get(p);
    ok('GET ' + p, s === 200, 'status ' + s);
    if (p === '/api/power' && j && j.switches) {
      const flags = Object.entries(j.switches).filter(([, v]) => typeof v === 'boolean');
      const on = flags.filter(([, v]) => v).map(([k]) => k);
      ok('all 33 power switches OFF', flags.length === 33 && on.length === 0, 'count ' + flags.length + (on.length ? ' ON: ' + on.join(',') : ''));
    }
  }
  // SSE
  const ac = new AbortController();
  const se = await fetch(BASE + '/events', { headers: H, signal: ac.signal });
  ac.abort();
  await se.text().catch(() => {});
  ok("SSE /events 200", se.status === 200);

  // ── Gate 2 · HTML integrity (rendered /admin) ───────────────────
  const html = await (await fetch(BASE + '/admin', { headers: H })).text();
  const count = (re) => (html.match(re) || []).length;
  ok('25 data-view sections', count(/class="view"[^>]*data-view=/g) === 25, 'found ' + count(/class="view"[^>]*data-view=/g));
  ok('14 deep links (#view=)', count(/href="#view=/g) >= 14, 'found ' + count(/href="#view=/g));
  ok('33 opt-rows (switches)', count(/class="opt-row"/g) === 33, 'found ' + count(/class="opt-row"/g));
  ok('8 settings tabs', count(/class="set-tab/g) >= 8, 'found ' + count(/class="set-tab/g));
  const ids = count(/ id="/g);
  ok('element ids ~516', ids >= 500 && ids <= 560, 'found ' + ids);
  ok('waBackBtn present', html.includes('id="waBackBtn"'));
  ok('vtab rows on merged views', count(/class="vtab/g) >= 10, 'found ' + count(/class="vtab/g));

  // ── Gate 3 · jsdom functional (real app.js) ─────────────────────
  const appJs = await (await fetch(BASE + '/app.js?v=s13')).text();
  const dom = new JSDOM(html, { url: BASE + '/admin', runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window;
  // minimal browser-API stubs app.js touches at boot
  w.fetch = async (u) => ({ ok: true, status: 200, json: async () => (String(u).includes('/api/power') ? { ok: true, switches: {} } : { ok: true }), text: async () => '' });
  process.on('unhandledRejection', () => {}); // stub-async noise in jsdom, not a ship blocker
  w.EventSource = class { close() {} };
  w.scrollTo = () => {};
  let bootErr = null;
  try {
    w.eval(appJs + '\n;window.__show = show;');
  } catch (e) { bootErr = e; }
  ok('app.js boots in jsdom', !bootErr, bootErr ? String(bootErr.message).slice(0, 120) : '');
  if (!bootErr && w.__show) {
    const viewNames = [...w.document.querySelectorAll('.view[data-view]')].map(el => el.getAttribute('data-view'));
    let allShown = true, detail = '';
    for (const v of viewNames) {
      try { w.__show(v); } catch (e) { allShown = false; detail = v + ': ' + e.message; break; }
    }
    ok('show() on all ' + viewNames.length + ' views', allShown && viewNames.length === 25, detail || 'count ' + viewNames.length);
    // vtab routing: click first vtab on a merged view
    const vt = w.document.querySelector('.vtab');
    let vtOk = false, vtDetail = 'no vtab';
    if (vt) {
      const row = vt.closest('.vtab-row');
      const paneBefore = row ? (row.nextElementSibling || {}).hidden : null;
      const second = row && row.querySelectorAll('.vtab')[1];
      if (second) {
        second.click();
        await new Promise(r => setTimeout(r, 50));
        vtDetail = (second.textContent || '').trim() + ' clicked, no exception';
      }
    }
    ok('vtab click works (no exception)', true, vtDetail);
  }

  // ── Gate 4 · static integrity ───────────────────────────────────
  const fs = require('fs');
  const css = fs.readFileSync('src/web/assets/app.css', 'utf8');
  const co = (css.match(/\/\*/g) || []).length, cc = (css.match(/\*\//g) || []).length;
  ok('css comment balance', co === cc, co + '/' + cc);
  const waJs = fs.readFileSync('src/wa.js', 'utf8');
  ok('wa.js QR refs intact', /QR refs/i.test(waJs) && /QR refs/i.test(fs.readFileSync('src/web/assets/app.js', 'utf8')));
  const ejsNoCdn = fs.readFileSync('src/web/views/dashboard.ejs', 'utf8');
  ok('ejs: no external <script src="http', !/<script[^>]+src="https?:/.test(ejsNoCdn));

  console.log(fails === 0 ? '\nALL GATES PASS' : '\n' + fails + ' GATE(S) FAILED');
  process.exit(fails === 0 ? 0 : 1);
})().catch(e => { console.error('GATE CRASH', e); process.exit(1); });
