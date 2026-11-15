/* Hand-written SVG chart helper (spec §2.4): line/area, dashed grid,
   12px labels, 2.5px lines, gradient area, dots, hover crosshair + tooltip.
   No libraries, no external requests. */

export function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || name;
}

function niceTicks(data, count = 4) {
  let max = 0;
  for (const arr of data) for (const v of arr) max = Math.max(max, v);
  if (max <= 0) max = 10;
  const raw = max / count;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10) * mag;
  const top = Math.ceil(max / step) * step;
  const ticks = [];
  for (let v = 0; v <= top + 0.001; v += step) ticks.push(Math.round(v * 100) / 100);
  return ticks;
}

function smoothPath(pts) {
  /* monotone-ish catmull-rom */
  if (pts.length < 2) return '';
  let d = `M ${pts[0][0]} ${pts[0][1]}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(pts.length - 1, i + 2)];
    const c1x = p1[0] + (p2[0] - p0[0]) / 6, c1y = p1[1] + (p2[1] - p0[1]) / 6;
    const c2x = p2[0] - (p3[0] - p1[0]) / 6, c2y = p2[1] - (p3[1] - p1[1]) / 6;
    d += ` C ${c1x.toFixed(1)} ${c1y.toFixed(1)}, ${c2x.toFixed(1)} ${c2y.toFixed(1)}, ${p2[0].toFixed(1)} ${p2[1].toFixed(1)}`;
  }
  return d;
}

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* main chart: host element receives an <svg> */
export function areaChart(host, series, { colors, ticks: fixedTicks, height = 260 } = {}) {
  if (!host || !series) return;
  const W = Math.max(320, host.clientWidth || 640);
  const H = height;
  const pad = { t: 16, r: 14, b: 28, s: 44 };
  const cw = W - pad.s - pad.r;
  const ch = H - pad.t - pad.b;
  const labels = series.labels || [];
  const n = labels.length;
  const keys = Object.keys(colors || {});
  const dataArrs = keys.map((k) => series[k] || []);
  let ticks = fixedTicks && fixedTicks.length ? fixedTicks : niceTicks(dataArrs);
  const top = ticks[ticks.length - 1] || 1;
  const x = (i) => pad.s + (n <= 1 ? cw / 2 : (i / (n - 1)) * cw);
  const y = (v) => pad.t + ch - (v / top) * ch;

  /* sparse x labels */
  const step = Math.max(1, Math.ceil(n / 8));
  let grid = '';
  for (const tv of ticks) {
    grid += `<line x1="${pad.s}" y1="${y(tv)}" x2="${W - pad.r}" y2="${y(tv)}" stroke="${cssVar('--border-1')}" stroke-dasharray="3 5" stroke-width="1"/>
             <text x="${pad.s - 8}" y="${y(tv) + 4}" text-anchor="end" font-size="12" fill="${cssVar('--text-3')}" font-family="inherit">${esc(fmtNum(tv))}</text>`;
  }
  let xlab = '';
  labels.forEach((lb, i) => {
    if (i % step !== 0 && i !== n - 1) return;
    xlab += `<text x="${x(i)}" y="${H - 8}" text-anchor="middle" font-size="12" fill="${cssVar('--text-3')}" font-family="inherit">${esc(lb)}</text>`;
  });

  const defs = `<defs>${keys.map((k, i) => `
    <linearGradient id="ag-${host.id || 'c'}-${i}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${colors[k]}" stop-opacity="0.28"/>
      <stop offset="1" stop-color="${colors[k]}" stop-opacity="0"/>
    </linearGradient>`).join('')}</defs>`;

  const lines = keys.map((k, i) => {
    const vals = series[k] || [];
    const pts = vals.map((v, j) => [x(j), y(v)]);
    const d = smoothPath(pts);
    const area = d ? `${d} L ${x(vals.length - 1)} ${y(0)} L ${x(0)} ${y(0)} Z` : '';
    const dots = n <= 14 ? pts.map((p) => `<circle cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="2.6" fill="${colors[k]}"/>`).join('') : '';
    return `<path d="${area}" fill="url(#ag-${host.id || 'c'}-${i})" stroke="none"/>
            <path d="${d}" fill="none" stroke="${colors[k]}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>${dots}`;
  }).join('');

  host.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="activity chart">
    ${defs}${grid}${xlab}${lines}
    <line id="${(host.id || 'c')}-xh" x1="0" y1="${pad.t}" x2="0" y2="${pad.t + ch}" stroke="${cssVar('--border-2')}" stroke-width="1" style="display:none"/>
    <rect id="${(host.id || 'c')}-ov" x="${pad.s}" y="${pad.t}" width="${cw}" height="${ch}" fill="transparent"/>
  </svg>
  <div class="ctip" id="${(host.id || 'c')}-tip" style="position:absolute;display:none;pointer-events:none;background:var(--surface-2);border:1px solid var(--border-1);border-radius:10px;padding:8px 10px;font-size:12px;z-index:5"></div>`;

  const svg = host.querySelector('svg');
  const ov = host.querySelector('[id$="-ov"]');
  const xh = host.querySelector('[id$="-xh"]');
  const tip = host.querySelector('[id$="-tip"]');
  if (!ov) return;
  ov.addEventListener('mousemove', (e) => {
    const r = svg.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * W;
    const i = Math.round(((px - pad.s) / cw) * (n - 1));
    const ci = Math.max(0, Math.min(n - 1, i));
    xh.style.display = '';
    xh.setAttribute('x1', x(ci)); xh.setAttribute('x2', x(ci));
    tip.style.display = 'block';
    tip.innerHTML = `<b>${esc(labels[ci])}</b>` + keys.map((k) => `<div style="display:flex;justify-content:space-between;gap:12px;margin-top:2px"><span style="color:${colors[k]}">●</span> ${esc(k)} <b style="margin-inline-start:auto">${esc(fmtNum(series[k][ci]))}</b></div>`).join('');
    const tr = host.getBoundingClientRect();
    const lx = Math.min(tr.width - 130, Math.max(0, ((x(ci) / W) * tr.width + 10)));
    tip.style.left = lx + 'px';
    tip.style.top = '8px';
  });
  ov.addEventListener('mouseleave', () => { xh.style.display = 'none'; tip.style.display = 'none'; });
}

/* 80x28 sparkline, 2px stroke, optional 12% area fill */
export function sparkline(values, { color = 'var(--success)', w = 80, h = 28, id } = {}) {
  if (!values || values.length < 2) return '';
  let min = Infinity, max = -Infinity;
  for (const v of values) { min = Math.min(min, v); max = Math.max(max, v); }
  const span = max - min || 1;
  const pts = values.map((v, i) => [ (i / (values.length - 1)) * (w - 4) + 2, h - 3 - ((v - min) / span) * (h - 8) ]);
  const d = smoothPath(pts);
  const area = `${d} L ${pts[pts.length - 1][0]} ${h} L ${pts[0][0]} ${h} Z`;
  const gid = 'sp' + (id || Math.random().toString(36).slice(2, 7));
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" aria-hidden="true">
    <defs><linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${color}" stop-opacity="0.12"/><stop offset="1" stop-color="${color}" stop-opacity="0"/></linearGradient></defs>
    <path d="${area}" fill="url(#${gid})" stroke="none"/>
    <path d="${d}" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`;
}

/* 120px circular gauge */
export function gaugeSVG(score, size = 120, stroke = 10) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const off = c * (1 - Math.max(0, Math.min(100, score)) / 100);
  return `<svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" aria-hidden="true">
    <circle class="track" cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke-width="${stroke}"/>
    <circle class="prog" cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke-width="${stroke}"
      stroke-dasharray="${c.toFixed(1)}" stroke-dashoffset="${off.toFixed(1)}" transform="rotate(-90 ${size / 2} ${size / 2})"/>
  </svg>`;
}

function fmtNum(v) {
  if (v >= 1000) return (v / 1000).toFixed(1).replace(/\.0$/, '') + 'k';
  return String(Math.round(v * 10) / 10);
}
