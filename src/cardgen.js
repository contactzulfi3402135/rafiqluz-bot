'use strict';
/**
 * 5I (I4): ANNOUNCEMENT CARD — SVG design + PNG raster, ZERO new dependencies.
 * Renders a 1080×1080 branded card from a post's text using a hand-written
 * PNG encoder (zlib is built into Node) and an embedded 5×7 dot font. The SVG
 * is the shareable vector source; the PNG is the WhatsApp-ready raster.
 * Nothing is attached to any post automatically (R2) — the card is a tool the
 * owner runs from the composer / post history when the switch is ON.
 */
const zlib = require('zlib');
const S = require('./db').S;

/* ---------------- 5J (J4): Branding Studio — saved brand colors drive every card ---------------- */
const BRAND_DEFAULTS = { accent: '#10B981', bg: '#0b1220', panel: '#111b2d', ink: '#e7eef6', muted: '#8ca0b8' };
const BRAND_PRESETS = {
  midnight: { ...BRAND_DEFAULTS },
  ember:    { accent: '#F59E0B', bg: '#17100a', panel: '#241a10', ink: '#f6efe6', muted: '#b8a58c' },
  royal:    { accent: '#60A5FA', bg: '#0a101d', panel: '#101a2c', ink: '#e9effb', muted: '#93a4c0' },
  rose:     { accent: '#FB7185', bg: '#170d11', panel: '#241519', ink: '#f8eef1', muted: '#b893a0' }
};
const HEX_RE = /^#[0-9a-fA-F]{6}$/;
const hexToRgb = (h) => { if (!HEX_RE.test(String(h || ''))) return null; const n = parseInt(String(h).slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
/** Read the owner's saved brand (Branding Studio) with per-field fallback. */
function brandColors() {
  const out = { ...BRAND_DEFAULTS };
  for (const k of Object.keys(BRAND_DEFAULTS)) {
    const v = String(S.get(`brand.${k}`, '')).trim();
    if (HEX_RE.test(v)) out[k] = v;
  }
  return out;
}
/** Validate + normalize a brand payload (hex per field; unknown keys dropped). */
function normalizeBrand(d) {
  const out = {};
  for (const k of Object.keys(BRAND_DEFAULTS)) {
    const v = String((d && d[k]) || '').trim();
    out[k] = HEX_RE.test(v) ? v.toLowerCase() : BRAND_DEFAULTS[k];
  }
  return out;
}

/* ---------------- 5×7 dot font (rows top→bottom, leftmost char = column 0) ---------------- */
const F = (rows) => rows;
const FONT = {
  ' ': F(['.....', '.....', '.....', '.....', '.....', '.....', '.....']),
  '!': F(['.1.', '.1.', '.1.', '.1.', '.1.', '...', '.1.']),
  '"': F(['.1.', '.1.', '.1.', '...', '...', '...', '...']),
  '#': F(['.1.', '.1.', '111', '.1.', '111', '.1.', '.1.']),
  $: F(['.11', '101', '110', '101', '011', '101', '11.']),
  '%': F(['11.', '11.', '.1.', '.1.', '.1.', '11.', '11.']),
  '&': F(['.11', '101', '110', '101', '101', '101', '011']),
  "'": F(['.1.', '.1.', '...', '...', '...', '...', '...']),
  '(': F(['..1', '.1.', '.1.', '.1.', '.1.', '.1.', '..1']),
  ')': F(['1..', '.1.', '.1.', '.1.', '.1.', '.1.', '1..']),
  '*': F(['.1.', '1.1', '.1.', '...', '1.1', '.1.', '...']),
  '+': F(['...', '.1.', '111', '.1.', '...', '...', '...']),
  ',': F(['...', '...', '...', '.1.', '.1.', '...', '.1.']),
  '-': F(['...', '...', '...', '111', '...', '...', '...']),
  '.': F(['...', '...', '...', '...', '...', '...', '.1.']),
  '/': F(['...', '...', '..1', '.1.', '.1.', '1..', '...']),
  '0': F(['.11', '101', '101', '101', '101', '101', '.11']),
  '1': F(['.1.', '11.', '.1.', '.1.', '.1.', '.1.', '111']),
  '2': F(['.11', '101', '...', '...1', '..1', '.1.', '111']),
  '3': F(['110', '010', '010', '...1', '...1', '101', '...1']),
  '4': F(['...1', '....1', '...1', '1111', '...1', '...1', '...1']),
  '5': F(['111', '1..', '11.', '...1', '...1', '101', '...1']),
  '6': F(['...1', '...1', '11.', '111', '101', '101', '.11']),
  '7': F(['111', '...1', '..1', '.1.', '.1.', '.1.', '.1.']),
  '8': F(['.11', '101', '101', '.11', '101', '101', '.11']),
  '9': F(['.11', '101', '101', '.11', '...1', '...1', '.11']),
  ':': F(['...', '...', '.1.', '...', '.1.', '...', '...']),
  ';': F(['...', '...', '.1.', '...', '.1.', '...', '.1.']),
  '<': F(['..1', '.1.', '1..', '.1.', '..1', '...', '...']),
  '=': F(['...', '...', '111', '...', '111', '...', '...']),
  '>': F(['1..', '.1.', '..1', '.1.', '1..', '...', '...']),
  '?': F(['.11', '101', '...1', '..1', '..1', '...', '..1']),
  '@': F(['.11', '101', '111', '101', '111', '...1', '.1.']),
  A: F(['.1.', '1.1', '1.1', '111', '1.1', '1.1', '1.1']),
  B: F(['11.', '101', '101', '11.', '101', '101', '11.']),
  C: F(['.11', '101', '1..', '1..', '1..', '101', '.11']),
  D: F(['11.', '101', '101', '101', '101', '101', '11.']),
  E: F(['111', '1..', '11.', '1..', '1..', '1..', '111']),
  F: F(['111', '1..', '11.', '1..', '1..', '1..', '1..']),
  G: F(['.11', '101', '1..', '111', '101', '101', '.11']),
  H: F(['1.1', '1.1', '1.1', '111', '1.1', '1.1', '1.1']),
  I: F(['111', '.1.', '.1.', '.1.', '.1.', '.1.', '111']),
  J: F(['..1', '..1', '..1', '..1', '..1', '101', '.1.']),
  K: F(['1.1', '101', '11.', '1..', '11.', '101', '1.1']),
  L: F(['1..', '1..', '1..', '1..', '1..', '1..', '111']),
  M: F(['1.1', '111', '111', '1.1', '1.1', '1.1', '1.1']),
  N: F(['1.1', '111', '111', '111', '1.1', '1.1', '1.1']),
  O: F(['.1.', '1.1', '1.1', '1.1', '1.1', '1.1', '.1.']),
  P: F(['11.', '101', '101', '11.', '1..', '1..', '1..']),
  Q: F(['.1.', '1.1', '1.1', '1.1', '1.1', '.1.', '..1']),
  R: F(['11.', '101', '101', '11.', '11.', '101', '1.1']),
  S: F(['.11', '101', '1..', '.1.', '..1', '101', '.11']),
  T: F(['111', '...1', '...1', '...1', '...1', '...1', '...1']),
  U: F(['1.1', '1.1', '1.1', '1.1', '1.1', '1.1', '.1.']),
  V: F(['1.1', '1.1', '1.1', '1.1', '1.1', '1.1', '.1.']),
  W: F(['1.1', '1.1', '1.1', '1.1', '1.1', '111', '1.1']),
  X: F(['1.1', '1.1', '.1.', '.1.', '.1.', '1.1', '1.1']),
  Y: F(['1.1', '1.1', '.1.', '.1.', '.1.', '.1.', '.1.']),
  Z: F(['111', '...1', '..1', '.1.', '1..', '1..', '111']),
  '[': F(['11', '1.', '1.', '1.', '1.', '1.', '11']),
  '\\': F(['...', '...', '1..', '.1.', '.1.', '...1', '...']),
  ']': F(['11', '.1', '.1', '.1', '.1', '.1', '11']),
  '^': F(['.1.', '1.1', '...', '...', '...', '...', '...']),
  '_': F(['...', '...', '...', '...', '...', '...', '111']),
  '`': F(['.1.', '1..', '...', '...', '...', '...', '...']),
  a: F(['...', '...', '.11', '...1', '.11', '...1', '.11']),
  b: F(['1..', '1..', '11.', '101', '101', '101', '11.']),
  c: F(['...', '...', '.11', '101', '...', '101', '.11']),
  d: F(['...1', '...1', '.11', '101', '101', '101', '.11']),
  e: F(['...', '...', '.11', '111', '...', '101', '.11']),
  f: F(['...1', '...1', '11.', '...1', '...1', '...1', '...1']),
  g: F(['...', '...', '.11', '101', '.11', '...1', '.1.']),
  h: F(['1..', '1..', '11.', '101', '101', '101', '101']),
  i: F(['.1.', '...', '.1.', '.1.', '.1.', '.1.', '.1.']),
  j: F(['..1', '...', '..1', '..1', '..1', '101', '.1.']),
  k: F(['1..', '1..', '101', '11.', '101', '101', '1.1']),
  l: F(['11.', '.1.', '.1.', '.1.', '.1.', '.1.', '.1.']),
  m: F(['...', '...', '11.', '111', '111', '1.1', '1.1']),
  n: F(['...', '...', '11.', '101', '101', '101', '101']),
  o: F(['...', '...', '.1.', '1.1', '1.1', '1.1', '.1.']),
  p: F(['...', '...', '11.', '101', '11.', '1..', '1..']),
  q: F(['...', '...', '.11', '101', '.11', '...1', '...1']),
  r: F(['...', '...', '11.', '101', '1..', '1..', '1..']),
  s: F(['...', '...', '.11', '1..', '.1.', '..1', '11.']),
  t: F(['.1.', '.1.', '111', '.1.', '.1.', '.1.', '..1']),
  u: F(['...', '...', '1.1', '1.1', '1.1', '1.1', '.11']),
  v: F(['...', '...', '1.1', '1.1', '1.1', '1.1', '.1.']),
  w: F(['...', '...', '1.1', '1.1', '111', '111', '1.1']),
  x: F(['...', '...', '1.1', '.1.', '.1.', '1.1', '1.1']),
  y: F(['...', '...', '1.1', '1.1', '.11', '...1', '.1.']),
  z: F(['...', '...', '111', '..1', '.1.', '1..', '111']),
  '{': F(['..1', '.1.', '.1.', '1..', '.1.', '.1.', '..1']),
  '|': F(['.1.', '.1.', '.1.', '...', '.1.', '.1.', '.1.']),
  '}': F(['1..', '.1.', '.1.', '..1', '.1.', '.1.', '1..']),
  '~': F(['...', '...', '101', '010', '...', '...', '...']),
  '·': F(['...', '...', '...', '.1.', '...', '...', '...']),
};
const glyph = (ch) => FONT[ch] || (ch === '\n' ? null : FONT['·']);

/* ---------------- layout helpers ---------------- */
const W = 1080, H = 1080, PAD = 110;
const C = {
  bg: [11, 18, 32],        // deep slate
  panel: [17, 27, 45],     // raised panel
  accent: [16, 185, 129],  // brand emerald (#10B981)
  ink: [231, 238, 246],    // near-white text
  muted: [140, 160, 184]   // secondary text
};
const col = (c, a = 1) => [Math.round(c[0] * a), Math.round(c[1] * a), Math.round(c[2] * a), 255];
/* 5J (J4): convert the saved hex brand into rgb triples for the raster renderer. */
function rgbPal() {
  const b = brandColors();
  return { bg: hexToRgb(b.bg), panel: hexToRgb(b.panel), accent: hexToRgb(b.accent), ink: hexToRgb(b.ink), muted: hexToRgb(b.muted) };
}

function wrapText(text, maxChars, maxLines) {
  const words = String(text || '').replace(/\s+/g, ' ').trim().split(' ');
  const lines = [];
  let cur = '';
  for (const w of words) {
    if ((cur + ' ' + w).trim().length > maxChars) {
      if (cur) lines.push(cur);
      cur = w.length > maxChars ? w.slice(0, maxChars) : w;
      if (lines.length === maxLines - 1) break;
    } else cur = (cur + ' ' + w).trim();
  }
  if (cur && lines.length < maxLines) lines.push(cur);
  if (lines.length === maxLines && words.join(' ').length > lines.join(' ').length) lines[maxLines - 1] = lines[maxLines - 1].slice(0, maxChars - 1) + '…';
  return lines;
}

/* ---------------- text raster (draws into a shared RGBA buffer) ---------------- */

/** Render the full card into a Buffer (RGBA, W×H).
    Layout budget (1080²): source 300 · title 370–560 (2 lines) · body 585–850
    (4 lines) · footer strip 880 · date 912 · signature 955 · panel ends 1020. */
function render({ title, body, source, date, footer }, pal) {
  const C = pal || rgbPal(); // 5J (J4): owner's saved brand (Branding Studio)
  const px = Buffer.alloc(W * H * 4);
  const setPx = (x, y, c) => { const p = (y * W + x) * 4; px[p] = c[0]; px[p + 1] = c[1]; px[p + 2] = c[2]; px[p + 3] = 255; };
  const textAt = (x0, y0, s, t, color, gap = 1) => {
    for (let i = 0; i < t.length; i++) {
      const g = glyph(t[i]);
      if (!g) continue;
      for (let r = 0; r < 7; r++) for (let c = 0; c < 5; c++) {
        if (g[r][c] !== '1') continue;
        const x = x0 + i * (5 + gap) * s + c * s;
        const y = y0 + r * s;
        for (let dy = 0; dy < s && y + dy < H; dy++) for (let dx = 0; dx < s && x + dx < W; dx++) setPx(x + dx, y + dy, color);
      }
    }
  };
  const rect = (x, y, w, h, c) => { for (let yy = Math.max(0, y); yy < Math.min(H, y + h); yy++) for (let xx = Math.max(0, x); xx < Math.min(W, x + w); xx++) setPx(xx, yy, c); };
  const rrect = (x, y, w, h, r, c) => {
    rect(x + r, y, w - 2 * r, h, c);
    rect(x, y + r, r, h - 2 * r, c);
    rect(x + w - r, y + r, r, h - 2 * r, c);
    for (let dy = 0; dy < r; dy++) for (let dx = 0; dx < r; dx++) {
      if ((dx - r + 1) ** 2 + (dy - r + 1) ** 2 <= r * r) {
        setPx(x + dx, y + dy, c); setPx(x + w - r + dx, y + dy, c);
        setPx(x + dx, y + h - r + dy, c); setPx(x + w - r + dx, y + h - r + dy, c);
      }
    }
  };
  // background + panel
  rect(0, 0, W, H, col(C.bg));
  rrect(60, 60, W - 120, H - 120, 48, col(C.panel));
  // accent bar + kicker
  rect(PAD, 150, 120, 18, col(C.accent));
  textAt(PAD, 200, 7, 'A N N O U N C E M E N T', col(C.accent), 1);
  // source line
  textAt(PAD, 300, 6, String(source || '').toUpperCase().slice(0, 40), col(C.muted), 1);
  // title (2 lines max)
  const tLines = wrapText(title || '', 12, 2);
  tLines.forEach((ln, i) => textAt(PAD, 370 + i * 96, 12, ln, col(C.ink), 1));
  // body (4 lines max)
  const bLines = wrapText(body || '', 21, 4);
  bLines.forEach((ln, i) => textAt(PAD, 585 + i * 72, 7, ln, col(C.ink, 0.92), 1));
  // footer strip
  rect(PAD, H - 200, W - 2 * PAD, 4, col(C.accent, 0.35));
  textAt(PAD, H - 168, 6, String(date || '').slice(0, 40), col(C.muted), 1);
  textAt(PAD, H - 118, 6, String(footer || '').slice(0, 46), col(C.accent, 0.9), 1);
  return px;
}

/* ---------------- PNG encoder (zlib built-in) ---------------- */
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function toPNG(px) {
  const raw = Buffer.alloc(H * (W * 4 + 1));
  for (let y = 0; y < H; y++) {
    raw[y * (W * 4 + 1)] = 0; // filter: none
    px.copy(raw, y * (W * 4 + 1) + 1, y * W * 4, (y + 1) * W * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 6 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

/* ---------------- public API ---------------- */
function ownerBranding() {
  const sig = String(S.get('power.signature.text', '')).trim();
  const name = sig.split('\n')[0].replace(/[*_~#]/g, '').trim();
  return name || 'My Channel';
}
function cardForPost({ title, body, source, date, footer }) {
  const data = {
    title: String(title || body || '').slice(0, 120),
    body: String(body || '').slice(0, 1200),
    source: String(source || '').slice(0, 60),
    date: String(date || new Date().toISOString().slice(0, 10)),
    footer: String(footer || ownerBranding()).slice(0, 60)
  };
  const png = toPNG(render(data, rgbPal()));
  return { png, svg: cardSVG(data, brandColors()) };
}
/** 5J (J4): SVG uses the owner's saved brand hexes (BRAND_DEFAULTS fallback). */
function cardSVG(d, pal) {
  const b = pal || brandColors();
  const esc = (s) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const tLines = wrapText(d.title || '', 12, 2);
  const bLines = wrapText(d.body || '', 21, 4);
  const [ar, ag, ab] = hexToRgb(b.accent);
  const titleT = tLines.map((l, i) => `<text x="110" y="${440 + i * 96}" font-family="Arial, sans-serif" font-weight="bold" font-size="92" fill="${b.ink}">${esc(l)}</text>`).join('\n  ');
  const bodyT = bLines.map((l, i) => `<text x="110" y="${635 + i * 72}" font-family="Arial, sans-serif" font-size="60" fill="${b.ink}">${esc(l)}</text>`).join('\n  ');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1080" viewBox="0 0 1080 1080">
  <rect width="1080" height="1080" fill="${b.bg}"/>
  <rect x="60" y="60" width="960" height="960" rx="48" fill="${b.panel}"/>
  <rect x="110" y="150" width="120" height="18" fill="${b.accent}"/>
  <text x="110" y="230" font-family="Arial, sans-serif" font-size="52" letter-spacing="10" fill="${b.accent}">ANNOUNCEMENT</text>
  <text x="110" y="330" font-family="Arial, sans-serif" font-size="42" fill="${b.muted}">${esc(d.source).toUpperCase()}</text>
  ${titleT}
  ${bodyT}
  <rect x="110" y="880" width="860" height="4" fill="rgba(${ar},${ag},${ab},.35)"/>
  <text x="110" y="954" font-family="Arial, sans-serif" font-size="42" fill="${b.muted}">${esc(d.date)}</text>
  <text x="110" y="1004" font-family="Arial, sans-serif" font-size="42" fill="${b.accent}">${esc(d.footer)}</text>
</svg>`;
}

module.exports = { cardForPost, cardSVG, wrapText, brandColors, normalizeBrand, BRAND_DEFAULTS, BRAND_PRESETS, hexToRgb };
