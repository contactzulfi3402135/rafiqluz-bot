/* Vanilla pointer-event drag-to-reorder for route cards & rule rows (spec §7.3/§7.13).
   After each drop, the new order is persisted (routes: PUT order; rules: priority). */

export function initDnd() {
  wire('#route-list', 'routes');
  wire('#rule-list', 'rules');
}

function wire(listSel, kind) {
  const list = document.querySelector(listSel);
  if (!list) return;
  let dragEl = null, startY = 0, offY = 0;

  const items = () => [...list.querySelectorAll('.route-card, .rule-row')];

  list.addEventListener('pointerdown', (e) => {
    const grip = e.target.closest('.grip');
    if (!grip) return;
    const el = grip.closest('.route-card, .rule-row');
    if (!el) return;
    dragEl = el;
    const r = el.getBoundingClientRect();
    startY = r.top;
    offY = e.clientY - r.top;
    el.setPointerCapture(e.pointerId);
    el.style.transition = 'none';
    el.style.position = 'relative';
    el.style.zIndex = '30';
    el.style.opacity = '.95';
    e.preventDefault();
  });

  list.addEventListener('pointermove', (e) => {
    if (!dragEl) return;
    const dy = e.clientY - startY - offY;
    dragEl.style.transform = `translateY(${dy}px)`;
  });

  list.addEventListener('pointerup', async (e) => {
    if (!dragEl) return;
    const el = dragEl;
    dragEl = null;
    el.style.transition = '';
    el.style.transform = '';
    el.style.position = '';
    el.style.zIndex = '';
    el.style.opacity = '';

    const all = items();
    const y = e.clientY;
    let to = -1;
    all.forEach((it, i) => {
      if (it === el) return;
      const r = it.getBoundingClientRect();
      if (y >= r.top && y < r.bottom) to = i;
    });
    const from = all.indexOf(el);
    if (to < 0 || to === from) return;
    const target = to > from ? all[to].nextElementSibling : all[to];
    list.insertBefore(el, target);
    [...list.querySelectorAll('.route-prio, .rule-prio')].forEach((n, i) => { n.textContent = i + 1; });
    try {
      const { api, toast, t } = await import('./app.js');
      for (const it of items()) {
        const id = parseInt(it.dataset.id, 10);
        const order = items().indexOf(it);
        if (kind === 'routes' && it.dataset.source) {
          await api(`/routes/${id}`, { method: 'PUT', body: { source: it.dataset.source, targets: JSON.parse(it.dataset.targets || '[]'), order }, silent: true });
        } else if (kind === 'rules' && it.dataset.name) {
          await api(`/rules/${id}`, { method: 'PUT', body: { name: it.dataset.name, priority: order + 1 }, silent: true });
        }
      }
      toast(t('common.saved'), 'ok');
    } catch {}
  });

  list.addEventListener('pointercancel', () => {
    if (dragEl) {
      dragEl.style.cssText = '';
      dragEl = null;
    }
  });
}
