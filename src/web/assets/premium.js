/* ═══════════════════════════════════════════════════════════════════════════
   RAQIFLUZ — v12.0 "OBSIDIAN" PREMIUM LAYER (client)
   Runs AFTER app.js. Every feature below is additive and fail-safe: if
   anything here throws, the console still works exactly as before.
   ═══════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  var $ = function (sel, root) { return (root || document).querySelector(sel); };
  var $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };
  var reduced = false;
  try { reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) {}
  var CODENAME = 'Obsidian';
  var VERSION = '12.0.0';
  function soft(label, fn) { try { fn(); } catch (e) { try { console.warn('[obsidian] ' + label + ':', e); } catch (_) {} } }
  function api(path, opts) {
    return fetch(path, Object.assign({ headers: { Accept: 'application/json' }, credentials: 'same-origin' }, opts || {}))
      .then(function (r) { return r.json(); });
  }
  function navigate(view) {
    var btn = $('#sidebar .sb-item[data-view="' + view + '"]') || $('.bt[data-view="' + view + '"]');
    if (btn) { btn.click(); return true; }
    try { location.hash = '#view=' + view; } catch (e) {}
    return false;
  }

  /* ────────────────────────────────────────────────────────────────────────
     1 · SIDEBAR — version whisper above the owner row
     ──────────────────────────────────────────────────────────────────────── */
  soft('sidebar-version', function () {
    var foot = $('.sb-foot'); if (!foot || $('.sb-version')) return;
    var div = document.createElement('div');
    div.className = 'sb-version';
    div.innerHTML = '<span class="sb-v-dot"></span> Raqifluz <b>v' + VERSION + '</b> · ' + CODENAME;
    foot.appendChild(div);
  });

  /* ────────────────────────────────────────────────────────────────────────
     2 · TOP BAR — live clock chip + system status pill (+ PWA install)
     ──────────────────────────────────────────────────────────────────────── */
  var tbRight = $('.tb-right.top-actions');
  var pwaBtn = null;

  var clockChip = null;
  soft('clock', function () {
    if (!tbRight) return;
    clockChip = document.createElement('span');
    clockChip.className = 'tb-clock';
    clockChip.setAttribute('aria-hidden', 'true');
    clockChip.innerHTML = '<b>--:--:--</b><span class="tb-clock-tz">LOCAL</span>';
    tbRight.insertBefore(clockChip, tbRight.firstChild);
    var timeEl = clockChip.querySelector('b');
    var tick = function () {
      var d = new Date();
      var p = function (n) { return String(n).padStart(2, '0'); };
      timeEl.textContent = p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
    };
    tick(); setInterval(tick, 1000);
  });

  var sysPill = null;
  soft('sys-pill', function () {
    if (!tbRight) return;
    sysPill = document.createElement('span');
    sysPill.className = 'sys-pill';
    sysPill.innerHTML = '<span class="sys-dot"></span><span class="sys-txt">CHECKING</span>';
    sysPill.title = 'Live platform state — refreshes every 20 seconds';
    clockChip ? clockChip.after(sysPill) : tbRight.insertBefore(sysPill, tbRight.firstChild);
  });

  function paintSysPill(state, tip) {
    if (!sysPill) return;
    sysPill.classList.remove('ok', 'warn', 'err');
    sysPill.classList.add(state);
    $('.sys-txt', sysPill).textContent = state === 'ok' ? 'ALL SYSTEMS GO' : state === 'warn' ? 'ATTENTION' : 'DEGRADED';
    if (tip) sysPill.title = tip;
  }
  function refreshSysPill() {
    api('/api/overview').then(function (ov) {
      if (!ov || ov.ok === false) { paintSysPill('warn', 'Overview unavailable — the console still works.'); return; }
      var wa = (ov.wa && ov.wa.status) || 'unknown';
      var panic = !!(ov.panic && (ov.panic.active || ov.panic.on));
      var paused = !!ov.mirrorPaused;
      var cloud = !!ov.cloud;
      var tip = 'WhatsApp: ' + wa + ' · mirror: ' + (paused ? 'paused' : 'live') + ' · cloud snapshot: ' + (cloud ? 'on' : 'off') + (panic ? ' · PANIC STOP ACTIVE' : '');
      if (panic) paintSysPill('err', tip);
      else if (wa === 'open' && !paused) paintSysPill('ok', tip);
      else paintSysPill('warn', tip);
    }).catch(function () { paintSysPill('err', 'Could not reach /api/overview — check the network tab.'); });
  }
  soft('sys-pill-poll', function () { refreshSysPill(); setInterval(refreshSysPill, 20000); });

  soft('pwa-pill', function () {
    if (!tbRight) return;
    var installed = false;
    try { installed = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true; } catch (e) {}
    if (installed) return;
    var deferred = null;
    window.addEventListener('beforeinstallprompt', function (e) {
      e.preventDefault(); deferred = e;
      if ($('.pwa-pill')) return;
      pwaBtn = document.createElement('button');
      pwaBtn.type = 'button';
      pwaBtn.className = 'pwa-pill';
      pwaBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 3v12m0 0 4-4m-4 4-4-4" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg> Install app';
      pwaBtn.addEventListener('click', function () {
        if (!deferred) return;
        deferred.prompt();
        deferred.userChoice.finally(function () { deferred = null; if (pwaBtn) pwaBtn.hidden = true; });
      });
      sysPill ? sysPill.after(pwaBtn) : tbRight.insertBefore(pwaBtn, tbRight.firstChild);
    });
    window.addEventListener('appinstalled', function () { if (pwaBtn) pwaBtn.hidden = true; celebrate(70); });
  });

  /* ────────────────────────────────────────────────────────────────────────
     3 · HOME — MISSION CONTROL strip (real clock, real quick actions,
         real release-readiness ring fed by /api/overview + /api/meta)
     ──────────────────────────────────────────────────────────────────────── */
  soft('mission-control', function () {
    var home = $('.view[data-view="home"]');
    var heading = home && $('.page-heading', home);
    if (!home || !heading || $('.mc-strip', home)) return;

    var strip = document.createElement('div');
    strip.className = 'mc-strip';
    strip.setAttribute('role', 'region');
    strip.setAttribute('aria-label', 'Mission control');
    strip.innerHTML =
      '<div class="mc-left">' +
        '<div class="mc-eyebrow"><span class="mc-live"></span> Mission Control</div>' +
        '<div class="mc-clock" id="mcClock">--:--:--</div>' +
        '<div class="mc-date" id="mcDate">Loading date…</div>' +
      '</div>' +
      '<div class="mc-right">' +
        '<div class="mc-qa-label">Quick actions</div>' +
        '<div class="mc-qa">' +
          '<button class="mc-btn" data-goview="newpost"><svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg> New post</button>' +
          '<button class="mc-btn" data-goview="approvals"><svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M5 13l4 4L19 7" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg> Approvals</button>' +
          '<button class="mc-btn" data-goview="analytics"><svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M4 20V10m6 10V4m6 16v-7" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg> Analytics</button>' +
          '<button class="mc-btn" data-goview="health"><svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M3 12h4l3-8 4 16 3-8h4" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg> Self-test</button>' +
        '</div>' +
        '<div class="mc-readiness">' +
          '<svg class="mc-ring" width="44" height="44" viewBox="0 0 44 44" aria-hidden="true">' +
            '<defs><linearGradient id="mcRingGrad" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#6ee7b7"/><stop offset=".5" stop-color="#10b981"/><stop offset="1" stop-color="#0ea5e9"/></linearGradient></defs>' +
            '<circle class="ring-bg" cx="22" cy="22" r="18"></circle>' +
            '<circle class="ring-fg" id="mcRingFg" cx="22" cy="22" r="18" stroke-dasharray="113.1" stroke-dashoffset="113.1"></circle>' +
          '</svg>' +
          '<div class="mc-readiness-txt"><b id="mcVerdict">Release readiness —</b><span id="mcVerdictSub">verifying live state…</span></div>' +
        '</div>' +
      '</div>';
    heading.after(strip);

    var clockEl = $('#mcClock', strip), dateEl = $('#mcDate', strip);
    var tick = function () {
      var d = new Date(), p = function (n) { return String(n).padStart(2, '0'); };
      clockEl.textContent = p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
      dateEl.textContent = d.toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
    };
    tick(); setInterval(tick, 1000);

    api('/api/overview').then(function (ov) {
      var checks = [
        !!(ov && ov.wa && ov.wa.status === 'open'),
        !!(ov && !ov.mirrorPaused),
        !!(ov && !(ov.panic && (ov.panic.active || ov.panic.on))),
        !!(ov && ov.cloud)
      ];
      var pass = checks.filter(Boolean).length;
      var pct = Math.round((pass / checks.length) * 100);
      var C = 2 * Math.PI * 18;
      var ring = $('#mcRingFg', strip);
      if (ring) { ring.style.strokeDasharray = String(C); ring.style.strokeDashoffset = String(C * (1 - pct / 100)); }
      var verdict = pct === 100 ? 'Release readiness — 100%' : 'Release readiness — ' + pct + '%';
      var sub = pass + '/4 live checks pass · ' + (checks[3] ? 'cloud snapshot on' : 'cloud snapshot off');
      var v = $('#mcVerdict', strip), s = $('#mcVerdictSub', strip);
      if (v) v.textContent = verdict;
      if (s) s.textContent = sub;
    }).catch(function () {
      var v = $('#mcVerdict', strip); if (v) v.textContent = 'Release readiness — n/a';
      var s = $('#mcVerdictSub', strip); if (s) s.textContent = 'overview unreachable';
    });
  });

  /* ────────────────────────────────────────────────────────────────────────
     4 · KPI COUNT-UP — numerals rise on first paint (once)
     ──────────────────────────────────────────────────────────────────────── */
  soft('kpi-countup', function () {
    if (reduced) return;
    var grid = $('#kpiGrid'); if (!grid) return;
    var done = false;
    var run = function () {
      if (done || !grid.children.length) return;
      done = true;
      $$('.k-v', grid).forEach(function (el) {
        var raw = (el.textContent || '').trim();
        var m = raw.match(/^([\d][\d,]*)$/);
        if (!m) return;
        var target = parseInt(m[1].replace(/,/g, ''), 10);
        if (!isFinite(target) || target <= 0) return;
        var dur = 850, t0 = null;
        var fmt = function (n) { return n.toLocaleString(); };
        var frame = function (t) {
          if (!t0) t0 = t;
          var p = Math.min(1, (t - t0) / dur);
          var e = 1 - Math.pow(2, -10 * p); if (p === 1) e = 1;
          el.textContent = fmt(Math.round(target * e));
          if (p < 1) requestAnimationFrame(frame); else el.textContent = fmt(target);
        };
        requestAnimationFrame(frame);
      });
    };
    var obs = new MutationObserver(run);
    obs.observe(grid, { childList: true });
    setTimeout(run, 1200);
  });

  /* ────────────────────────────────────────────────────────────────────────
     5 · CONFETTI — small cannon, earned only by real successes
     ──────────────────────────────────────────────────────────────────────── */
  var confettiCanvas = null, confettiCtx = null, confettiParts = [], confettiRaf = 0, lastBurst = 0;
  function ensureCanvas() {
    if (confettiCanvas) return true;
    try {
      confettiCanvas = document.createElement('canvas');
      confettiCanvas.className = 'confetti-canvas';
      document.body.appendChild(confettiCanvas);
      confettiCtx = confettiCanvas.getContext('2d');
      var resize = function () { confettiCanvas.width = innerWidth; confettiCanvas.height = innerHeight; };
      resize(); window.addEventListener('resize', resize);
      return true;
    } catch (e) { return false; }
  }
  function celebrate(count) {
    if (reduced || !ensureCanvas()) return;
    count = count || 46;
    var W = confettiCanvas.width, colors = ['#6ee7b7', '#10b981', '#34d399', '#f59e0b', '#fde68a', '#60a5fa', '#f8fafc'];
    for (var i = 0; i < count; i++) {
      var fromLeft = i % 2 === 0;
      confettiParts.push({
        x: fromLeft ? -12 : W + 12, y: innerHeight * (0.55 + Math.random() * 0.35),
        vx: (fromLeft ? 1 : -1) * (5 + Math.random() * 6.5), vy: -(7 + Math.random() * 6),
        w: 6 + Math.random() * 6, h: 8 + Math.random() * 10,
        rot: Math.random() * Math.PI, vr: (Math.random() - .5) * .3,
        color: colors[(Math.random() * colors.length) | 0], life: 130 + (Math.random() * 60) | 0
      });
    }
    if (!confettiRaf) confettiTick();
  }
  function confettiTick() {
    confettiRaf = requestAnimationFrame(confettiTick);
    var ctx = confettiCtx; ctx.clearRect(0, 0, confettiCanvas.width, confettiCanvas.height);
    confettiParts = confettiParts.filter(function (p) { return p.life-- > 0 && p.y < innerHeight + 40; });
    if (!confettiParts.length) { cancelAnimationFrame(confettiRaf); confettiRaf = 0; ctx.clearRect(0, 0, confettiCanvas.width, confettiCanvas.height); return; }
    confettiParts.forEach(function (p) {
      p.vy += 0.32; p.x += p.vx; p.y += p.vy; p.rot += p.vr; p.vx *= 0.995;
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot);
      ctx.fillStyle = p.color; ctx.globalAlpha = Math.max(0, Math.min(1, p.life / 90));
      ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h); ctx.restore();
    });
  }
  var SUCCESS_RE = /(sent|published|queued|saved|complete|completed|done|exported|backup|linked|connected|restored|approved|scheduled)/i;
  soft('toast-confetti', function () {
    var toasts = $('#toasts'); if (!toasts || !('MutationObserver' in window)) return;
    var obs = new MutationObserver(function (muts) {
      var now = Date.now(); if (now - lastBurst < 1500) return;
      muts.forEach(function (m) {
        $$('.toast.ok', m.target).forEach(function (t) {
          if (!t.__celebrated && SUCCESS_RE.test(t.textContent || '')) { t.__celebrated = true; lastBurst = now; celebrate(46); }
        });
      });
    });
    obs.observe(toasts, { childList: true, subtree: true });
  });

  /* ────────────────────────────────────────────────────────────────────────
     6 · KEYBOARD — "?" shortcut atlas + G-chords for speed navigation
     ──────────────────────────────────────────────────────────────────────── */
  var overlay = null, chordAt = 0;
  var CHORDS = { h: 'home', q: 'approvals', a: 'analytics', s: 'settings', c: 'sources', n: 'newpost', l: 'logs', i: 'whatsapp', p: 'posts', r: 'routing', b: 'browse' };
  var SHORTCUTS = [
    ['Ctrl / ⌘ + K', 'Command palette — jump anywhere'],
    ['/', 'Open the command palette'],
    ['?', 'This shortcut atlas'],
    ['Esc', 'Close palette / modal / this panel'],
    ['G then H', 'Go to Home'],
    ['G then N', 'Compose a new post'],
    ['G then Q', 'Open the approval queue'],
    ['G then P', 'Post history'],
    ['G then C', 'Channels — sources'],
    ['G then R', 'Routing matrix'],
    ['G then A', 'Analytics'],
    ['G then I', 'WhatsApp inbox'],
    ['G then L', 'System logs'],
    ['G then S', 'Settings']
  ];
  function closeOverlay() { if (overlay) { overlay.remove(); overlay = null; } }
  function openOverlay() {
    if (overlay) { closeOverlay(); return; }
    overlay = document.createElement('div');
    overlay.className = 'shortcut-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-label', 'Keyboard shortcuts');
    overlay.innerHTML =
      '<div class="shortcut-panel">' +
        '<h3><svg width="18" height="18" viewBox="0 0 24 24" fill="none"><rect x="2" y="6" width="20" height="12" rx="2" stroke="currentColor" stroke-width="1.6"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M6 14h.01M18 14h.01M9 14h6" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg> Keyboard atlas</h3>' +
        '<p>Every chord works anywhere except inside text fields. Press <b>?</b> again or <b>Esc</b> to close.</p>' +
        '<div class="shortcut-grid">' + SHORTCUTS.map(function (s) {
          return '<div class="shortcut-row"><span>' + s[1] + '</span><kbd>' + s[0] + '</kbd></div>';
        }).join('') + '</div>' +
      '</div>';
    overlay.addEventListener('click', function (e) { if (e.target === overlay) closeOverlay(); });
    document.body.appendChild(overlay);
  }
  document.addEventListener('keydown', function (e) {
    var t = e.target || {};
    var typing = /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName || '') || t.isContentEditable;
    if (e.key === 'Escape') { closeOverlay(); return; }
    if (typing) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === '?') { e.preventDefault(); openOverlay(); return; }
    var k = (e.key || '').toLowerCase();
    var now = Date.now();
    if (k === 'g') { chordAt = now; return; }
    if (now - chordAt < 900 && CHORDS[k]) { chordAt = 0; e.preventDefault(); closeOverlay(); navigate(CHORDS[k]); }
  }, true);

  /* ────────────────────────────────────────────────────────────────────────
     7 · ABOUT — Release readiness card (live data from /api/meta + overview)
     ──────────────────────────────────────────────────────────────────────── */
  soft('release-readiness', function () {
    var about = $('.view[data-view="about"]');
    if (!about || $('.readiness-card', about)) return;
    var anchor = $('.ph', about) || about.firstElementChild;
    var card = document.createElement('div');
    card.className = 'card readiness-card';
    card.innerHTML =
      '<div class="card-h"><svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M12 2 3 7v6c0 5 3.8 9.4 9 11 5.2-1.6 9-6 9-11V7l-9-5Z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="m9.5 12 2 2 3.5-4" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg> Release readiness <span class="muted tiny">— verified live, not on paper</span></div>' +
      '<div class="card-b">' +
        '<div class="rr-head">' +
          '<div class="rr-score"><span id="rrScore">–</span><small> / 100</small></div>' +
          '<p class="rr-verdict" id="rrVerdict">Verifying WhatsApp state, mirror switch, panic latch, cloud memory and this browser session…</p>' +
        '</div>' +
        '<div class="rr-grid" id="rrGrid"><div class="shimmer" style="height:38px"></div><div class="shimmer" style="height:38px"></div><div class="shimmer" style="height:38px"></div><div class="shimmer" style="height:38px"></div></div>' +
        '<div class="rr-meta" id="rrMeta"></div>' +
      '</div>';
    anchor.after(card);

    Promise.all([api('/api/meta').catch(function () { return null; }), api('/api/overview').catch(function () { return null; })])
      .then(function (res) {
        var meta = res[0] || {}, ov = res[1] || {};
        var secureCtx = false;
        try { secureCtx = window.isSecureContext || location.protocol === 'https:' || location.hostname === 'localhost'; } catch (e) {}
        var waOpen = !!(ov.wa && ov.wa.status === 'open');
        var mirrorOn = !ov.mirrorPaused;
        var panicClear = !(ov.panic && (ov.panic.active || ov.panic.on));
        var cloudOn = !!ov.cloud;
        var checks = [
          { label: 'WhatsApp session', ok: waOpen, detail: waOpen ? 'linked & open' : 'not linked' },
          { label: 'Mirror switch', ok: mirrorOn, detail: mirrorOn ? 'live' : 'paused' },
          { label: 'Panic latch', ok: panicClear, detail: panicClear ? 'clear' : 'ACTIVE' },
          { label: 'Cloud snapshots', ok: cloudOn, detail: cloudOn ? 'enabled' : 'off (local only)' },
          { label: 'Secure context', ok: secureCtx, detail: secureCtx ? 'https / localhost' : 'plain http' },
          { label: 'Build fingerprint', ok: !!(meta && meta.version), detail: meta && meta.version ? ('v' + meta.version + ' · ' + (meta.codename || '')) : 'unknown' }
        ];
        var pass = checks.filter(function (c) { return c.ok; }).length;
        var score = Math.round((pass / checks.length) * 100);
        $('#rrScore', card).textContent = String(score);
        $('#rrVerdict', card).textContent = score === 100
          ? 'Every live check passes. The workspace is fully operational — deploy with confidence.'
          : score >= 67
            ? 'Healthy with reservations — review the amber checks below before the next deploy.'
            : 'Attention required — one or more critical checks failed. See System Health for the full report.';
        $('#rrGrid', card).innerHTML = checks.map(function (c) {
          return '<div class="rr-item ' + (c.ok ? 'pass' : 'info') + '"><span class="rr-mark">' + (c.ok ? '✓' : '!') + '</span><span><b>' + c.label + '</b><br>' + c.detail + '</span></div>';
        }).join('');
        if (meta && meta.version) {
          $('#rrMeta', card).innerHTML =
            '<div>Version<b>v' + meta.version + ' · ' + (meta.codename || 'Obsidian') + '</b></div>' +
            '<div>Node runtime<b>' + (meta.node || '—') + ' · ' + (meta.platform || '') + '/' + (meta.arch || '') + '</b></div>' +
            '<div>Process<b>pid ' + (meta.pid || '—') + ' · RSS ' + (meta.rssMB != null ? meta.rssMB + ' MB' : '—') + '</b></div>' +
            '<div>Uptime<b>' + (meta.uptimeSec != null ? Math.floor(meta.uptimeSec / 3600) + 'h ' + Math.floor((meta.uptimeSec % 3600) / 60) + 'm' : '—') + '</b></div>' +
            '<div>Environment<b>' + (meta.env || 'production') + ' · ' + (meta.timezone || '') + '</b></div>' +
            '<div>License<b>' + (meta.license || 'MIT') + '</b></div>';
          var ab = $('#abVersion'); if (ab) ab.textContent = 'v' + meta.version + ' · ' + (meta.codename || 'Obsidian');
        }
      });
  });

  /* ────────────────────────────────────────────────────────────────────────
     8 · ABOUT CHANGELOG — prepend the Obsidian entry (presentation only;
         the seeded array in app.js is left untouched for integrity)
     ──────────────────────────────────────────────────────────────────────── */
  soft('changelog-entry', function () {
    var box = $('#abChangelog'); if (!box) return;
    var entry = document.createElement('div');
    entry.className = 'chg';
    entry.innerHTML = '<div class="chg-v">v12.0.0 — Obsidian (this build)</div>' +
      '<div class="chg-w muted tiny">The premium overhaul: split-screen login + link pages with living aurora artwork · frosted command-deck top bar with live clock, system-status pill and PWA install · Mission Control strip on Home (real clock, quick actions, live release-readiness ring) · KPI count-up numerals · success confetti earned by real actions · "?" keyboard atlas + G-chords · Release readiness report in About (verified live) · gradient primary buttons with light sweep · refined sidebar with version whisper · ambient aurora background + blueprint grid · thin scrollbars, focus rings, reduced-motion support · new /api/meta build fingerprint · hardened security headers (Permissions-Policy, COOP, Origin-Agent-Cluster) · repository re-organized (docs/, tools/) + CI + LICENSE + SECURITY.md</div>';
    box.insertBefore(entry, box.firstChild);
  });
})();
