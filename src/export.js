'use strict';
/** 5D (R63) — Analytics exports. CSV = the full row history for the range.
 *  PDF = a hand-written minimal PDF 1.4 single-page summary (Helvetica, no
 *  binary fonts, no dependencies — the 200 MB dyno does not earn a PDF
 *  library). The xref offsets are computed byte-exact and verified by tests. */
const { A, open } = require('./db');

function fromFor(days) { return new Date(Date.now() - days * 86400e3).toISOString().slice(0, 19).replace('T', ' '); }
function dirNames() { try { return Object.fromEntries(require('./db').CH.dirList().map((c) => [c.jid, c.name || c.jid])); } catch { return {}; } }

function normReason(r) { return String(r || '').split(':')[0].split('(')[0].trim() || 'other'; }

function summary(days) {
  const from = fromFor(days);
  const names = dirNames();
  const rows = Object.fromEntries(A.since(from).map((r) => [r.status, r.n]));
  const media = A.mediaSplit(from);
  const reasons = {};
  for (const r of A.skipReasons(from)) reasons[normReason(r.reason)] = (reasons[normReason(r.reason)] || 0) + r.n;
  const failed = open().prepare('SELECT source_jid, reason, created_at FROM posts WHERE created_at >= ? AND status=? ORDER BY id DESC LIMIT 20').all(from, 'failed');
  return {
    days, from, names,
    pub: rows.published || 0, edit: rows.edited || 0, skip: rows.skipped || 0, fail: rows.failed || 0,
    media,
    topSources: A.perSourceFull(from).slice(0, 8).map((s) => ({ name: names[s.source_jid] || s.source_jid, pub: s.pub || 0, failed: s.failed || 0, media: s.media || 0 })),
    topTargets: A.perTarget(from).slice(0, 8).map((s) => ({ name: names[s.target_jid] || s.target_jid, pub: s.pub || 0, failed: s.failed || 0 })),
    topReasons: Object.entries(reasons).sort((a, b) => b[1] - a[1]).slice(0, 8),
    failed
  };
}

function csv(days) {
  const from = fromFor(days);
  const names = dirNames();
  const esc = (v) => { const s = String(v == null ? '' : v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const lines = ['id,created_at,source,status,reason,targets,media,body'];
  for (const r of A.rows(from, 5000)) {
    lines.push([r.id, r.created_at, names[r.source_jid] || r.source_jid, r.status, r.reason, r.targets, r.has_media ? 'yes' : 'no', String(r.body || '').slice(0, 500).replace(/\s+/g, ' ')].map(esc).join(','));
  }
  return lines.join('\n');
}

/* PDF text line → PDF literal string (escape \ ( ) and drop non-Latin-1) */
function pstr(s) {
  return String(s)
    .replace(/[^\x20-\x7E\u00A0-\u00FF]/g, (c) => (c === '\n' ? '' : '?'))
    .replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

function pdf(days) {
  const s = summary(days);
  const gen = new Date(Date.now() + 5 * 3600e3).toISOString().replace('T', ' ').slice(0, 16);
  const L = [];
  L.push(`RAQIFLUZ CHANNEL BOT - ANALYTICS EXPORT`);
  L.push(`Range: last ${s.days} days    Generated: ${gen} PKT`);
  L.push('');
  L.push(`Published: ${s.pub}    Edited: ${s.edit}    Skipped: ${s.skip}    Failed: ${s.fail}`);
  L.push(`Media posts: ${s.media.withMedia}    Text posts: ${s.media.text}`);
  L.push('');
  L.push('TOP SOURCES');
  for (const [i, r] of s.topSources.entries()) L.push(`${i + 1}. ${r.name} - ${r.pub} published, ${r.failed} failed, ${r.media} media`);
  if (!s.topSources.length) L.push('(none)');
  L.push('');
  L.push('TOP TARGETS');
  for (const [i, r] of s.topTargets.entries()) L.push(`${i + 1}. ${r.name} - ${r.pub} published, ${r.failed} failed`);
  if (!s.topTargets.length) L.push('(none)');
  L.push('');
  L.push('WHY THINGS WERE SKIPPED');
  for (const [r, n] of s.topReasons) L.push(`${r} - ${n}`);
  if (!s.topReasons.length) L.push('(nothing skipped)');
  L.push('');
  L.push(`FAILED POSTS (latest ${s.failed.length} of ${s.fail})`);
  for (const f of s.failed) L.push(`${f.created_at} - ${s.names[f.source_jid] || f.source_jid}: ${String(f.reason || '').slice(0, 80)}`);
  if (!s.failed.length) L.push('(no failures)');
  if (L.length > 54) { L.length = 54; L.push(`... truncated - the CSV export has the full list (${s.days} days)`); }

  let content = 'BT /F1 10 Tf 50 792 Td 13 TL\n';
  content += L.map((line) => `(${pstr(line)}) Tj T*\n`).join('');
  content += 'ET';

  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(content, 'latin1')} >>\nstream\n${content}\nendstream`
  ];

  const enc = (x) => Buffer.from(x, 'latin1');
  let out = enc('%PDF-1.4\n');
  const offsets = [0];
  objs.forEach((body, i) => {
    offsets.push(out.length);
    out = Buffer.concat([out, enc(`${i + 1} 0 obj\n${body}\nendobj\n`)]);
  });
  const xrefAt = out.length;
  let xref = `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= objs.length; i++) xref += String(offsets[i]).padStart(10, '0') + ' 00000 n \n';
  out = Buffer.concat([out, enc(xref), enc(`trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`)]);
  return out;
}

module.exports = { csv, pdf, summary };
