'use strict';
/* Vendored Lucide icons (MIT, stroke style). Inlined server-side at render time —
   NO icon CDN at runtime (R19/R6). Size/stroke controlled by CSS (.icon).
   The original class="lucide lucide-…" attribute is replaced with "icon" so all
   dashboard CSS targets .icon uniformly. */
const fs = require('fs');
const path = require('path');
const DIR = path.join(__dirname, 'assets/icons');
const cache = new Map();
function icon(name, cls) {
  let svg = cache.get(name);
  if (svg === undefined) {
    try {
      let raw = fs.readFileSync(path.join(DIR, name + '.svg'), 'utf-8').trim();
      raw = raw.replace(/<!--[\s\S]*?-->/g, '');
      raw = raw.replace(/\swidth="\d+"(?=\s|>)/, '').replace(/\sheight="\d+"(?=\s|>)/, '');
      raw = raw.replace(/<svg([^>]*)>/, (m, attrs) => {
        const extra = (cls || '').replace(/\bicon\b/g, '').trim();
        return '<svg' + attrs.replace(/\sclass="[^"]*"/, '') + ` class="icon${extra ? ' ' + extra : ''}" aria-hidden="true" focusable="false">`;
      });
      svg = raw;
    } catch { svg = ''; }
    cache.set(name, svg);
  }
  if (!svg) return '';
  return svg;
}
module.exports = { icon };
