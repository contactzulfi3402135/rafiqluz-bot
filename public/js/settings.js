/* SETTINGS (spec §8): 8 tabs, staged dirty-state save, 33 switches with
   owned sub-settings (disabled 40% + hint until ON), search/counter/reset,
   instant theme/language/accent, PIN modal, Configure → jumps. */
import {
  api, toast, t, esc, $, $$, openModal, closeModal, applyTheme, applyAccent, setLang,
} from './app.js';

const OWNER_OF = {
  quiet_hours: 'quiet', best_time: 'bestTime', random_jitter: 'jitter',
  weekend_pause: 'weekend', burst_guard: 'burst',
  max_post_age: 'maxPostAge',
  auto_translate: 'translateTo', link_shortener: 'shortenerDomain',
  blocklist: 'blocklist', allowlist_only: 'allowlist', flag_keywords: 'flagKeywords',
  daily_report: 'reportTime',
  notify_pending: 'pendingThreshold', health_alert: 'healthThreshold', weekly_digest: 'digestDay',
  auto_backup: 'backupFreq', cloud_sync: 'cloudProvider', extended_audit: 'auditRetention',
  pin_for_changes: 'pin',
  ai_pilot_suggest: 'pilotMode',
  brand_footer: 'footer',
};
const JUMP_TAB = {
  quiet: 'pacing', bestTime: 'pacing', jitter: 'pacing', weekend: 'pacing', burst: 'pacing',
  maxPostAge: 'automation', translateTo: 'automation', shortenerDomain: 'automation',
  blocklist: 'ai', allowlist: 'ai', flagKeywords: 'ai', pilotMode: 'ai',
  reportTime: 'general',
  pendingThreshold: 'notifications', healthThreshold: 'notifications', digestDay: 'notifications',
  backupFreq: 'storage', cloudProvider: 'storage', auditRetention: 'storage',
  pin: 'whatsapp', footer: 'general',
};

export function initSettings() {
  const form = $('#set-form');
  if (!form) return;
  const sw = window.__SWITCHES || {};
  let dirty = false;

  const markDirty = () => {
    dirty = true;
    const b = $('#set-save');
    if (b) b.classList.add('dirty');
    if (b) b.disabled = false;
  };
  const markClean = () => {
    dirty = false;
    const b = $('#set-save');
    if (b) b.classList.remove('dirty');
    if (b) b.disabled = true;
  };

  /* tabs */
  $$('#set-tabs .tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      $$('#set-tabs .tab').forEach((x) => x.setAttribute('aria-selected', x === tab ? 'true' : 'false'));
      $$('.set-panel').forEach((p) => { p.hidden = p.dataset.tab !== tab.dataset.tab; });
    });
  });
  const switchTab = (name) => {
    const tab = $(`#set-tabs .tab[data-tab="${name}"]`);
    if (tab) tab.click();
  };

  /* tag inputs (blocklist / allowlist / flag keywords) */
  $$('.tagbox').forEach((box) => {
    const input = box.querySelector('input');
    const commit = () => {
      const v = input.value.trim().replace(/,+$/, '');
      if (!v) return;
      const chip = document.createElement('span');
      chip.className = 'htag';
      chip.innerHTML = `${esc(v)} <span class="x" role="button" aria-label="remove">✕</span>`;
      chip.querySelector('.x').addEventListener('click', () => { chip.remove(); markDirty(); });
      box.insertBefore(chip, input);
      input.value = '';
      markDirty();
    };
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); commit(); }
    });
    input.addEventListener('blur', commit);
  });
  const readTags = (sel) => {
    const box = $(sel);
    if (!box) return [];
    return $$('.htag', box).map((c) => c.textContent.replace('✕', '').trim());
  };

  /* owned sub-settings: lock state follows the switch */
  const syncOwned = () => {
    $$('.owned').forEach((w) => {
      const key = w.dataset.owner;
      const on = !!sw[key];
      w.classList.toggle('locked', !on);
      w.querySelectorAll('input,select,button').forEach((el) => { el.disabled = !on; });
      const hint = w.querySelector('.off-hint');
      if (hint) hint.style.display = on ? 'none' : 'inline-flex';
    });
  };
  syncOwned();

  /* 33 switches */
  $$('#opts-list .tog[data-key]').forEach((tog) => {
    tog.addEventListener('click', async (e) => {
      e.preventDefault();
      const key = tog.dataset.key;
      const on = tog.getAttribute('aria-checked') !== 'true';
      try {
        await api(`/settings/switches/${key}`, { body: { value: on }, silent: true });
      } catch (err) {
        if (err.needPin) { askPin(() => {}); return; }
        return;
      }
      tog.setAttribute('aria-checked', on ? 'true' : 'false');
      sw[key] = on;
      updateCounter();
      syncOwned();
      /* special: language/theme live preview is elsewhere; switches just persist */
      if (key === 'quiet_hours') toast(t('toast.saved'), 'ok');
    });
  });
  function updateCounter() {
    const n = Object.values(sw).filter(Boolean).length;
    const c = $('#opts-count');
    if (c) c.textContent = t('opts.counter', { n });
    const bar = $('#sw-count');
    if (bar) bar.textContent = t('setg.switches_count', { n });
  }

  /* options search */
  $('#opts-q')?.addEventListener('input', (e) => {
    const q = e.target.value.toLowerCase();
    $$('#opts-list .opt-group').forEach((g) => {
      let any = false;
      $$('.opt-row', g).forEach((row) => {
        const ok = !q || row.dataset.search.includes(q);
        row.style.display = ok ? '' : 'none';
        if (ok) any = true;
      });
      g.style.display = any ? '' : 'none';
    });
  });

  /* reset all */
  $('#opts-reset')?.addEventListener('click', async () => {
    const { confirmModal } = await import('./app.js');
    if (!(await confirmModal(t('opts.reset'), t('opts.reset_confirm'), { danger: true }))) return;
    const on = Object.keys(sw).filter((k) => sw[k]);
    for (const k of on) {
      try { await api(`/settings/switches/${k}`, { body: { value: false }, silent: true }); } catch {}
      sw[k] = false;
    }
    $$('#opts-list .tog[data-key]').forEach((tog) => tog.setAttribute('aria-checked', 'false'));
    updateCounter();
    syncOwned();
    toast(t('opts.reset_done'), 'ok');
  });

  /* configure → jumps */
  $$('#opts-list .opt-conf').forEach((a) => a.addEventListener('click', () => {
    const field = a.dataset.field;
    switchTab(JUMP_TAB[field] || 'general');
    const target = $(`#f-${field}`);
    if (target) {
      target.scrollIntoView({ behavior: 'smooth', block: 'center' });
      target.style.outline = '2px solid var(--accent)';
      setTimeout(() => { target.style.outline = ''; }, 1400);
    }
  }));

  /* switches bar (general tab) */
  $('#sw-bar')?.addEventListener('click', () => {
    switchTab('options');
    form.scrollIntoView({ behavior: 'smooth' });
  });

  /* ── tab-specific wiring ── */
  /* General: theme segmented, accent swatches, language, PIN */
  $$('#seg-theme button').forEach((b) => b.addEventListener('click', () => {
    $$('#seg-theme button').forEach((x) => x.setAttribute('aria-pressed', x === b ? 'true' : 'false'));
    applyTheme(b.dataset.theme, { save: false });
    markDirty();
  }));
  $$('#sw-accent .swatch').forEach((s) => s.addEventListener('click', () => {
    $$('#sw-accent .swatch').forEach((x) => x.setAttribute('aria-pressed', x === s ? 'true' : 'false'));
    applyAccent(s.dataset.accent, false);
    markDirty();
  }));
  $('#set-lang')?.addEventListener('change', (e) => { if (e.target.value) setLang(e.target.value); });
  $('#set-pin')?.addEventListener('click', () => askPin());

  /* WhatsApp */
  $('#wa-test-s')?.addEventListener('click', async () => {
    try {
      const { to } = await api('/wa/test', { body: {} });
      toast(t('wa.toast_test', { phone: to }), 'ok');
    } catch {}
  });
  $$('#set-commands .cmd-chip').forEach((c) => c.addEventListener('click', () => c.classList.toggle('on')));

  /* Notifications test */
  $('#nt-test')?.addEventListener('click', async () => {
    try { await api('/notify/test', { body: {}, silent: true }); toast(t('setn.tested'), 'ok'); } catch {}
  });

  /* Storage */
  $('#st-backup')?.addEventListener('click', async () => {
    try { const { file } = await api('/backup', { body: {} }); toast(t('sets.backup_done'), 'ok'); } catch {}
  });
  $('#st-export')?.addEventListener('click', () => { location.href = '/api/export'; });
  $('#st-restore-file')?.addEventListener('change', async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const text = await f.text();
    try { JSON.parse(text); } catch {
      toast('Invalid JSON file', 'err');
      e.target.value = '';
      return;
    }
    const { confirmModal } = await import('./app.js');
    if (!(await confirmModal(t('sets.restore'), t('sets.restore_note'), { danger: true }))) { e.target.value = ''; return; }
    try {
      await api('/restore', { body: { json: text } });
      toast(t('sets.restore_ok'), 'ok');
      setTimeout(() => location.reload(), 600);
    } catch (err2) { toast(err2.message, 'err'); }
  });
  $('#st-cloud')?.addEventListener('change', (e) => {
    $('#st-cloud-creds').style.display = e.target.value !== 'none' ? '' : 'none';
    markDirty();
  });

  /* ── save (staged, dirty-state, PIN-gated) ── */
  $('#set-save')?.addEventListener('click', async () => {
    const body = collect();
    try {
      await api('/settings', { method: 'PUT', body });
      toast(t('settings.saved_toast'), 'ok');
      markClean();
    } catch (err) {
      if (err.needPin) askPin();
    }
  });

  function collect() {
    const g = (id) => $(id)?.value;
    const n = (id) => parseInt($(id)?.value, 10);
    return {
      name: g('#set-name'), botName: g('#set-bot'), reportTime: g('#set-report'),
      timezone: g('#set-tz'),
      theme: $$('#seg-theme button').find((b) => b.getAttribute('aria-pressed') === 'true')?.dataset.theme,
      accent: $$('#sw-accent .swatch').find((s) => s.getAttribute('aria-pressed') === 'true')?.dataset.accent,
      waOwner: g('#set-wa'), channelName: g('#set-ch'),
      allowedCommands: $$('#set-commands .cmd-chip.on').map((c) => c.dataset.cmd),
      pacing: {
        speed: g('#p-speed'), adaptive: $('#p-adapter')?.getAttribute('aria-checked') === 'true',
        minDelay: n('#p-min'), maxDelay: n('#p-max'), maxPerMin: n('#p-per'), dailyCap: n('#p-cap'),
        quietFrom: g('#p-qfrom'), quietTo: g('#p-qto'),
        bestTime: $$('#p-best .htag').map((c) => c.textContent.trim()),
        jitter: n('#p-jitter'), burst: n('#p-burst'),
        weekendSat: $('#p-sat')?.getAttribute('aria-checked') === 'true',
        weekendSun: $('#p-sun')?.getAttribute('aria-checked') === 'true',
      },
      automation: {
        approval: g('#a-approval'), bulkDelay: n('#a-bulk'), retries: n('#a-retries'),
        backoff: g('#a-backoff'), maxPostAge: n('#a-age'), translateTo: g('#a-trans'),
        shortenerDomain: g('#a-short'),
      },
      ai: {
        pilotMode: $$('#seg-pilot button').find((b) => b.getAttribute('aria-pressed') === 'true')?.dataset.mode,
        blocklist: readTags('#ai-block'), allowlist: readTags('#ai-allow'), flagKeywords: readTags('#ai-flag'),
        minTextLength: n('#ai-minlen'),
      },
      notifications: { pendingThreshold: n('#n-pend'), healthThreshold: n('#n-health'), digestDay: g('#n-day') },
      storage: { logRetention: n('#st-logret'), auditRetention: n('#st-auditret'), backupFreq: g('#st-freq'), cloudProvider: g('#st-cloud') },
    };
  }

  async function askPin(after) {
    const m = openModal({
      title: t('settings.pin_modal'),
      sub: t('settings.pin_sub'),
      body: `
        <div class="field"><label>${t('settings.pin_new')}</label><input class="input mono" id="pin-1" type="password" inputmode="numeric" maxlength="8"></div>
        <div class="field"><label>${t('settings.pin_repeat')}</label><input class="input mono" id="pin-2" type="password" inputmode="numeric" maxlength="8"></div>
        <div class="ferr" id="pin-err">${esc(t('settings.pin_err'))}</div>`,
      foot: `<button class="btn btn-secondary" data-x>${esc(t('common.cancel'))}</button><button class="btn btn-primary" data-y>${esc(t('common.save'))}</button>`,
    });
    m.querySelector('[data-x]').addEventListener('click', closeModal);
    m.querySelector('[data-y]').addEventListener('click', async () => {
      const p1 = m.querySelector('#pin-1').value;
      const p2 = m.querySelector('#pin-2').value;
      if (!/^\d{4,8}$/.test(p1) || p1 !== p2) {
        m.querySelector('#pin-err').classList.add('show');
        return;
      }
      try {
        await api('/settings/pin', { body: { pin: p1 }, silent: true });
        toast(t('settings.pin_saved'), 'ok');
        closeModal();
        after && after();
        /* if PIN was needed for saving, retry the save */
        if (dirty) {
          try { await api('/settings', { method: 'PUT', body: { ...collect(), pin: p1 } }); toast(t('settings.saved_toast'), 'ok'); markClean(); } catch {}
        }
      } catch {}
    });
  }

  /* initial: save disabled until dirty */
  const b = $('#set-save');
  if (b) b.disabled = true;
  /* any input marks dirty */
  form.addEventListener('input', (e) => { if (e.target.matches('input,select,textarea')) markDirty(); });
  form.addEventListener('change', (e) => { if (e.target.matches('input,select')) markDirty(); });
  $$('#set-form .tog').forEach((tg) => tg.addEventListener('click', () => {
    /* non-switch toggles (adaptive etc.) also dirty */
    if (!tg.dataset.key) markDirty();
  }));
}
