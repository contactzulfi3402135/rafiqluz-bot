'use strict';
/**
 * v6.3.0 — Email sender: MULTIPLE personal accounts (Gmail / iCloud / custom
 * SMTP), manual compose, bulk lists with {name} personalization, send-later
 * scheduling, test button, full history. Channel posts are NEVER auto-emailed
 * (owner's choice) — every send is manual or scheduled by the owner.
 * Sending is paced (1 email / 5 s) to respect provider limits.
 */
const nodemailer = require('nodemailer');
const { ring } = require('./logger');
const { S } = require('./db');

const db = () => require('./db').open();

const PRESETS = {
  gmail: { name: 'Gmail', host: 'smtp.gmail.com', port: 465, passUrl: 'https://myaccount.google.com/apppasswords' },
  icloud: { name: 'iCloud Mail', host: 'smtp.mail.me.com', port: 587, passUrl: 'https://appleid.apple.com/account/manage' },
  custom: { name: 'Custom SMTP', host: '', port: 587, passUrl: '' }
};
const PACE_MS = 5000;   // one email every 5 s — safe for Gmail/iCloud
const INLINE_MAX = 5;   // ≤5 recipients: send immediately; more → background queue (paced)

const toSqlUtc = (ms) => new Date(ms).toISOString().slice(0, 19).replace('T', ' ');

/* ---------------- accounts ---------------- */
function accounts() { try { return JSON.parse(S.get('email.accounts', '[]')); } catch { return []; } }
function saveAccounts(list) { S.set('email.accounts', JSON.stringify((list || []).slice(0, 10))); }
function accountById(id) { return accounts().find((a) => a.id === id) || null; }
function defaultAccount() { return accountById(S.get('email.default', '')) || accounts()[0] || null; }

function addAccount({ label, provider, user, pass, host, port } = {}) {
  provider = ['gmail', 'icloud', 'custom'].includes(provider) ? provider : 'custom';
  user = String(user || '').trim();
  pass = String(pass || '').trim();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(user)) throw new Error('Enter the full email address (e.g. you@gmail.com).');
  if (!pass) throw new Error('Enter the APP password (not your normal password — see the "Get app password" link).');
  if (provider === 'custom' && !String(host || '').trim()) throw new Error('Custom SMTP needs a host (e.g. smtp.office365.com).');
  const list = accounts();
  if (list.some((a) => a.user.toLowerCase() === user.toLowerCase())) throw new Error('That email address is already connected.');
  const acc = {
    id: `a${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`,
    label: String(label || PRESETS[provider].name).slice(0, 40),
    provider, user, pass,
    host: provider === 'custom' ? String(host).trim().slice(0, 120) : '',
    port: provider === 'custom' ? (Number(port) || 587) : 0
  };
  list.push(acc); saveAccounts(list);
  if (!S.get('email.default', '')) S.set('email.default', acc.id);
  ring.info('email.account.added', `Email account connected: ${user} (${PRESETS[provider].name})`);
  return { id: acc.id, user: acc.user, label: acc.label };
}
function removeAccount(id) {
  saveAccounts(accounts().filter((a) => a.id !== id));
  if (S.get('email.default', '') === id) S.set('email.default', accounts()[0]?.id || '');
}
function setDefault(id) { if (accountById(id)) S.set('email.default', id); }
function publicAccounts() {
  const def = defaultAccount();
  return accounts().map((a) => ({
    id: a.id, label: a.label, user: a.user,
    provider: a.provider, providerName: PRESETS[a.provider]?.name || 'Custom SMTP',
    isDefault: Boolean(def && a.id === def.id)
  }));
}
const presetList = () => Object.entries(PRESETS).map(([id, p]) => ({ id, name: p.name, passUrl: p.passUrl }));

/* ---------------- sending ---------------- */
function transporterFor(acc) {
  const preset = PRESETS[acc.provider] || PRESETS.custom;
  const host = acc.provider === 'custom' ? String(acc.host || '').trim() : preset.host;
  const port = Number(acc.provider === 'custom' ? acc.port : preset.port) || 587;
  if (!host) throw new Error('This account has no SMTP host set.');
  return nodemailer.createTransport({ host, port, secure: port === 465, auth: { user: acc.user, pass: acc.pass } });
}
function friendly(err) {
  const m = String(err?.message || err || '');
  if (/EAUTH/.test(m)) return 'Wrong email or app password — check the address and the app password (2FA must be on).';
  if (/EENVELOPE|EMESSAGE/.test(m)) return 'One of the addresses is invalid — check the list.';
  if (/ETIMEDOUT|ECONNECTION|ESOCKET|EDNS/.test(m)) return 'Could not reach the mail server — check internet / host / port.';
  return m.slice(0, 180);
}
function record(accUser, to, subject, ok, error) {
  try { db().prepare('INSERT INTO email_history(account, to_addr, subject, ok, error) VALUES(?,?,?,?,?)').run(accUser, String(to).slice(0, 200), String(subject || '(no subject)').slice(0, 150), ok ? 1 : 0, error ? String(error).slice(0, 200) : null); } catch { }
}

async function sendOne(acc, to, subject, text) {
  const tr = transporterFor(acc);
  await tr.sendMail({
    from: `"${acc.label}" <${acc.user}>`,
    to, subject: String(subject || '(no subject)').slice(0, 200),
    text: String(text || '').slice(0, 12000)
  });
}

/** Parse "email" / "email,Name" lines → [{email, name}] (deduped, max 100). */
function parseList(raw) {
  const out = []; const seen = new Set();
  for (const line of String(raw || '').split(/[\n;]+/)) {
    const t = line.trim(); if (!t) continue;
    const [rawAddr, ...nameParts] = t.split(',');
    const email = String(rawAddr || '').trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) continue;
    if (!seen.has(email)) { seen.add(email); out.push({ email, name: nameParts.join(',').trim().slice(0, 60) }); }
  }
  return out.slice(0, 100);
}

/** Send to a whole list, paced; records history per recipient. */
async function sendList(acc, rawList, subject, body) {
  const list = parseList(rawList);
  if (!list.length) throw new Error('No valid email addresses — use one per line: someone@example.com or someone@example.com,Name');
  const results = []; let sent = 0;
  for (const item of list) {
    const text = String(body || '').replaceAll('{name}', item.name || '').slice(0, 12000);
    try {
      await sendOne(acc, item.email, subject, text);
      sent += 1; results.push({ to: item.email, ok: true });
      record(acc.user, item.email, subject, true, null);
    } catch (err) {
      const msg = friendly(err);
      results.push({ to: item.email, ok: false, error: msg });
      record(acc.user, item.email, subject, false, msg);
    }
    if (list.length > 1) await new Promise((r) => setTimeout(r, PACE_MS));
  }
  ring.info('email.send', `Email "${String(subject || '').slice(0, 50)}" → ${sent}/${list.length} delivered via ${acc.user}`);
  return { sent, total: list.length, results };
}

/* ---------------- test ---------------- */
async function testAccount(id) {
  const acc = accountById(id) || defaultAccount();
  if (!acc) return { ok: false, error: 'Connect an email account first.' };
  try {
    await sendOne(acc, acc.user, 'Raqifluz Bot — test email', '✅ This is a test email from your Raqifluz bot. If you can read this, email sending works!');
    record(acc.user, acc.user, 'Test email', true, null);
    return { ok: true, message: `Test email sent to ${acc.user} — check that inbox (and the spam folder the first time).` };
  } catch (err) {
    const msg = friendly(err);
    record(acc.user, acc.user, 'Test email', false, msg);
    return { ok: false, error: msg };
  }
}

/* ---------------- queue (send-later + big lists in background) ---------------- */
function enqueue(accountId, rawList, subject, body, atMs) {
  const acc = accountById(accountId) || defaultAccount();
  if (!acc) throw new Error('Connect an email account first.');
  const list = parseList(rawList);
  if (!list.length) throw new Error('No valid email addresses — use one per line: someone@example.com or someone@example.com,Name');
  if (!String(subject || '').trim() && !String(body || '').trim()) throw new Error('Subject or message is required.');
  db().prepare('INSERT INTO email_queue(at, account_id, to_list, subject, body, status) VALUES(?,?,?,?,?,?)')
    .run(toSqlUtc(atMs || Date.now()), acc.id, String(rawList).slice(0, 8000), String(subject).slice(0, 200), String(body).slice(0, 12000), 'pending');
}
function pendingQueue() { return db().prepare("SELECT * FROM email_queue WHERE status='pending' ORDER BY id ASC").all(); }
function cancelQueued(id) { db().prepare("UPDATE email_queue SET status='cancelled' WHERE id=? AND status='pending'").run(id); }
function history(limit = 60) { return db().prepare('SELECT * FROM email_history ORDER BY id DESC LIMIT ?').all(limit); }

/** The policy behind the Send buttons: schedule / background / immediate. */
async function sendOrQueue({ accountId, to, subject, body, scheduleAt } = {}) {
  const acc = accountById(accountId) || defaultAccount();
  if (!acc) throw new Error('Connect an email account first (Email tab → Connect account).');
  if (scheduleAt) {
    const t = Date.parse(scheduleAt);
    if (!Number.isFinite(t)) throw new Error('Bad schedule time.');
    enqueue(acc.id, to, subject, body, t);
    ring.info('email.scheduled', `Email scheduled for ${toSqlUtc(t)} UTC via ${acc.user}`);
    return { queued: true, note: 'Scheduled — it will send automatically at that time.' };
  }
  const list = parseList(to);
  if (!list.length) throw new Error('No valid email addresses — use one per line: someone@example.com or someone@example.com,Name');
  if (list.length > INLINE_MAX) {
    enqueue(acc.id, to, subject, body, null);
    return { queued: true, note: `${list.length} recipients — sending in the background (paced, 1 email / 5 s). Watch the history below.` };
  }
  const r = await sendList(acc, to, subject, body);
  return { queued: false, ...r };
}

async function processQueue() {
  const row = db().prepare("SELECT * FROM email_queue WHERE status='pending' AND at <= datetime('now') ORDER BY id ASC LIMIT 1").get();
  if (!row) return;
  db().prepare('UPDATE email_queue SET status=? WHERE id=?').run('sending', row.id);
  try {
    const acc = accountById(row.account_id);
    if (!acc) throw new Error('The sending account was removed.');
    await sendList(acc, row.to_list, row.subject, row.body);
    db().prepare("UPDATE email_queue SET status='sent', sent_at=datetime('now') WHERE id=?").run(row.id);
  } catch (err) {
    db().prepare('UPDATE email_queue SET status=?, error=? WHERE id=?').run('failed', friendly(err).slice(0, 200), row.id);
    ring.warn('email.queue.fail', `Queued email failed: ${friendly(err)}`);
  }
}

function start() {
  try { db().prepare("UPDATE email_queue SET status='pending' WHERE status='sending'").run(); } catch { } // heal stuck rows after a restart
  setInterval(() => { processQueue().catch(() => { }); }, 15000).unref?.();
  ring.info('email.ready', 'Email engine ready — accounts, compose, bulk lists and scheduling active');
}

module.exports = {
  start, addAccount, removeAccount, setDefault, publicAccounts, presetList,
  accountById, defaultAccount, testAccount, sendOrQueue, pendingQueue, cancelQueued, history
};
