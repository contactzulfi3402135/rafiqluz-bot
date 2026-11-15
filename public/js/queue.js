/* QUEUE page logic (spec §6.2): filters, selection bar, bulk actions,
   live badge updates, inline discard confirm, edit drawer, empty state. */
import {
  api, toast, t, timeAgo, esc, openDrawer, closeModal, closeDrawer, confirmModal, $, $$,
} from './app.js';

export function initQueue() {
  const list = $('#q-list');
  if (!list) return;
  const rows = () => $$('#q-list .q-row');
  let filter = 'pending';
  let type = 'all';

  const counts = (window.__Q_COUNTS || {});
  const setChipCounts = () => {
    $$('#q-chips .chip').forEach((ch) => {
      const f = ch.dataset.f;
      let n = 0;
      rows().forEach((r) => {
        const okT = type === 'all' || (type === 'text' ? r.dataset.type === 'text' : r.dataset.type !== 'text');
        if (!okT) return;
        if (f === 'all' || r.dataset.status === f) n++;
      });
      ch.querySelector('.cnt').textContent = '(' + n + ')';
    });
    /* type dropdown text (desktop) */
    const td = $('#q-type');
    if (td) {
      const nText = rows().filter((r) => r.dataset.status === 'pending' && r.dataset.type === 'text').length;
      const nMedia = rows().filter((r) => r.dataset.status === 'pending' && r.dataset.type !== 'text').length;
      td.innerHTML = `<option value="all">${t('queue.type')}</option><option value="text">${t('queue.type.text')} (${nText})</option><option value="media">${t('queue.type.media')} (${nMedia})</option>`;
      td.value = type;
    }
  };

  const apply = () => {
    rows().forEach((r) => {
      const okF = filter === 'all' || r.dataset.status === filter;
      const okT = type === 'all' || (type === 'text' ? r.dataset.type === 'text' : r.dataset.type !== 'text');
      r.style.display = okF && okT ? '' : 'none';
    });
    setChipCounts();
    syncSelection();
  };

  $$('#q-chips .chip').forEach((ch) => ch.addEventListener('click', () => {
    $$('#q-chips .chip').forEach((x) => x.setAttribute('aria-pressed', x === ch ? 'true' : 'false'));
    filter = ch.dataset.f;
    apply();
  }));
  $('#q-type')?.addEventListener('change', (e) => { type = e.target.value; apply(); });
  $('#q-type-m')?.addEventListener('change', (e) => { type = e.target.value; apply(); });

  /* mobile approve-all */
  $('#q-approve-all-m')?.addEventListener('click', () => bulkAll('approve'));

  /* bulk dropdown */
  const bulkBtn = $('#q-bulk');
  bulkBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    const menu = $('#q-bulk-menu');
    menu.hidden = !menu.hidden;
  });
  document.addEventListener('click', () => { const m = $('#q-bulk-menu'); if (m) m.hidden = true; });
  $('#q-bulk-menu')?.addEventListener('click', (e) => {
    const b = e.target.closest('[data-bulk]');
    if (!b) return;
    const act = b.dataset.bulk;
    const pending = rows().filter((r) => r.dataset.status === 'pending');
    if (act === 'approve') bulkAll('approve');
    if (act === 'delay') {
      bulk(pending.map((r) => parseInt(r.dataset.id, 10)), 'delay');
    }
    if (act === 'select') toggleAll(true);
  });

  async function bulkAll(action) {
    const ids = rows().filter((r) => r.dataset.status === 'pending').map((r) => parseInt(r.dataset.id, 10));
    if (!ids.length) return;
    if (BOOT_switch('confirm_bulk')) {
      if (!(await confirmModal(t('queue.confirm_bulk', { n: ids.length }), ''))) return;
    }
    await bulk(ids, action);
  }

  async function bulk(ids, action, delayMin) {
    if (!ids.length) return;
    try {
      await api('/queue/bulk', { body: { ids, action, delayMin } });
      const n = ids.length;
      if (action === 'approve') {
        toast(t('queue.toast_bulk', { n, action: LANG_ur() ? 'منظور' : 'approved' }), 'ok');
        const rowsTo = rows().filter((r) => ids.includes(parseInt(r.dataset.id, 10)));
        rowsTo.forEach((r) => { r.classList.add('removing'); });
        setTimeout(() => rowsTo.forEach((r) => r.remove()), 180);
      } else if (action === 'discard') {
        toast(t('queue.toast_bulk', { n, action: LANG_ur() ? 'مسترد' : 'discarded' }), 'ok');
        rows().filter((r) => ids.includes(parseInt(r.dataset.id, 10))).forEach((r) => { r.classList.add('removing'); });
        setTimeout(() => rows().filter((r) => ids.includes(parseInt(r.dataset.id, 10))).forEach((r) => r.remove()), 180);
      } else {
        toast(t('queue.toast_delayed', { n }), 'ok');
      }
      tickBadges(-n, action === 'approve');
      apply();
      checkEmpty();
    } catch {}
  }

  /* live badge: nav queue count */
  function tickBadges(delta, approved = false) {
    for (const id of ['qbadge', 'qbadge-m', 'qbadge-d']) {
      const b = document.getElementById(id);
      if (!b) continue;
      let v = parseInt(b.textContent, 10) + delta;
      b.textContent = Math.max(0, v);
      if (v === 0) b.style.display = 'none';
    }
  }

  /* selection bar */
  const selbar = $('#q-selbar');
  const selected = () => rows().filter((r) => r.style.display !== 'none' && r.querySelector('.chk[aria-checked="true"]')).map((r) => parseInt(r.dataset.id, 10));
  function syncSelection() {
    const n = selected().length;
    if (!selbar) return;
    selbar.classList.toggle('show', n > 0);
    const cnt = selbar.querySelector('.cnt');
    if (cnt) cnt.textContent = t('queue.selected', { n });
    const ba = selbar.querySelector('[data-sel="approve"]');
    if (ba) ba.textContent = t('queue.bulk_approve', { n });
    const da = selbar.querySelector('[data-sel="discard"]');
    if (da) da.style.display = n ? '' : 'none';
  }
  function toggleAll(on) {
    rows().forEach((r) => {
      if (r.style.display === 'none') return;
      const c = r.querySelector('.chk');
      if (c) c.setAttribute('aria-checked', on ? 'true' : 'false');
    });
    syncSelection();
  }
  selbar?.querySelector('[data-sel="all"]')?.addEventListener('click', () => {
    const anyOff = rows().some((r) => r.style.display !== 'none' && r.querySelector('.chk')?.getAttribute('aria-checked') !== 'true');
    toggleAll(anyOff);
  });
  selbar?.querySelector('[data-sel="approve"]')?.addEventListener('click', async () => {
    const ids = selected();
    if (BOOT_switch('confirm_bulk') && !(await confirmModal(t('queue.confirm_bulk', { n: ids.length }), ''))) return;
    await bulk(ids, 'approve');
  });
  selbar?.querySelector('[data-sel="discard"]')?.addEventListener('click', async () => {
    const ids = selected();
    if (!(await confirmModal(t('queue.confirm_bulk_discard', { n: ids.length }), '', { danger: true }))) return;
    await bulk(ids, 'discard');
  });
  selbar?.querySelector('[data-sel="clear"]')?.addEventListener('click', () => toggleAll(false));
  selbar?.querySelector('[data-sel="delay"]')?.addEventListener('change', async (e) => {
    if (!e.target.value) return;
    const ids = selected();
    await bulk(ids, 'delay', parseInt(e.target.value, 10));
    e.target.value = '';
  });

  /* rows */
  rows().forEach((r) => {
    const id = parseInt(r.dataset.id, 10);
    const chk = r.querySelector('.chk');
    chk?.addEventListener('click', () => {
      const on = chk.getAttribute('aria-checked') !== 'true';
      chk.setAttribute('aria-checked', on ? 'true' : 'false');
      syncSelection();
    });
    r.querySelector('[data-act="approve"]')?.addEventListener('click', async () => {
      try {
        await api(`/queue/${id}/approve`, { body: {} });
        toast(t('queue.toast_approved'), 'ok');
        r.classList.add('removing');
        setTimeout(() => { r.remove(); apply(); checkEmpty(); }, 180);
        tickBadges(-1, true);
        /* add to recent activity on home is server-side */
      } catch {}
    });
    r.querySelector('[data-act="edit"]')?.addEventListener('click', () => openEdit(r));
    const dsc = r.querySelector('[data-act="discard"]');
    const inline = r.querySelector('.q-inline-confirm');
    dsc?.addEventListener('click', () => {
      if (inline) {
        inline.classList.add('show');
        r.querySelector('[data-act="discard-yes"]')?.addEventListener('click', async () => {
          try {
            await api(`/queue/${id}/discard`, { body: {} });
            toast(t('queue.toast_discarded'), 'ok');
            r.classList.add('removing');
            setTimeout(() => { r.remove(); apply(); checkEmpty(); }, 180);
            tickBadges(-1);
          } catch {}
        });
        r.querySelector('[data-act="discard-no"]')?.addEventListener('click', () => inline.classList.remove('show'));
      }
    });
  });

  function openEdit(r) {
    const id = parseInt(r.dataset.id, 10);
    const item = (window.__Q_ITEMS || []).find((x) => x.id === id);
    if (!item) return;
    const d = openDrawer({
      title: t('queue.edit_title'),
      body: `
        <div class="field"><label>${t('queue.edit_title')}</label><input class="input" id="qe-title" value="${esc(item.title)}"></div>
        <div class="field"><label>${t('queue.edit_text')}</label><textarea class="textarea" id="qe-text">${esc(item.text || '')}</textarea></div>
        <div class="field"><label>${t('queue.edit_tags')}</label><input class="input" id="qe-tags" value="${esc((item.tags || []).join(' '))}"></div>
        <div class="set-grid">
          <div class="field"><label>${t('queue.edit_schedule')}</label><input class="input" type="datetime-local" id="qe-when" value="${toLocal(new Date(item.at))}"></div>
          <div class="field"><label>${t('queue.from').split('→')[0]}</label><input class="input" id="qe-n" type="number" min="1" max="48" value="${item.targets}"></div>
        </div>
        <div class="field"><label>${t('queue.edit_targets')}</label>
          <div class="tchip-wrap" id="qe-tgs" style="max-height:110px">
            ${(window.__TGT_NAMES || []).slice(0, 24).map((n) => `<span class="tchip on" data-name="${esc(n)}"><span class="box"><svg class="ic"><use href="#i-check"/></svg></span>${esc(n)}</span>`).join('')}
          </div>
        </div>`,
      foot: `<button class="btn btn-secondary" data-x>${esc(t('common.cancel'))}</button>
             <button class="btn btn-primary" data-y>${esc(t('queue.edit_approve'))}</button>`,
    });
    $$('#qe-tgs .tchip', d).forEach((c) => c.addEventListener('click', () => c.classList.toggle('on')));
    d.querySelector('[data-x]').addEventListener('click', closeDrawer);
    d.querySelector('[data-y]').addEventListener('click', async () => {
      try {
        await api(`/queue/${id}`, {
          method: 'PUT', body: {
            title: d.querySelector('#qe-title').value,
            text: d.querySelector('#qe-text').value,
            tags: d.querySelector('#qe-tags').value.split(/\s+/).filter(Boolean),
            targets: parseInt(d.querySelector('#qe-n').value, 10) || item.targets,
            at: d.querySelector('#qe-when').valueAsNumber || item.at,
            targetNames: $$('#qe-tgs .tchip.on', d).map((c) => c.dataset.name),
          },
        });
        await api(`/queue/${id}/approve`, { body: {}, silent: true });
        closeDrawer();
        toast(t('queue.toast_approved'), 'ok');
        r.classList.add('removing');
        setTimeout(() => { r.remove(); apply(); checkEmpty(); }, 180);
        tickBadges(-1);
      } catch {}
    });
  }

  function checkEmpty() {
    if (!rows().length) {
      list.innerHTML = `
        <div class="empty">
          <span class="tile"><svg class="ic" style="width:22px;height:22px"><use href="#i-inbox"/></svg></span>
          <h4>${esc(t('queue.empty'))}</h4>
          <p>${esc(t('queue.empty_sub'))}</p>
          <a class="btn btn-primary" href="/sources">${esc(t('nav.sources'))} →</a>
        </div>`;
    }
  }

  function toLocal(d) {
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
  }
  function BOOT_switch(k) { try { return !!(window.__BOOT_SWITCHES || {})[k]; } catch { return false; } }
  function LANG_ur() { return document.documentElement.lang === 'ur'; }

  apply();
  checkEmpty();
}
