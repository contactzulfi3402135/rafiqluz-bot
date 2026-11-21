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
function accounts() {
  let list;try{list=JSON.parse(S.get('email.accounts','[]'));}catch{throw Error('Email account settings are damaged; restore a verified backup before making changes.');}
  if(!Array.isArray(list)||list.length>10||list.some(a=>!a||typeof a.id!=='string'||!a.id||typeof a.user!=='string'||!a.user||(!a.pass&&!a.pass_enc)||(a.pass&&typeof a.pass!=='string')||(a.pass_enc&&typeof a.pass_enc!=='string')||(a.pass&&a.pass_enc))||new Set(list.map(a=>a.id)).size!==list.length)throw Error('Email account settings are damaged; restore a verified backup before making changes.');
  return list;
}
function saveAccounts(list,marker='') {
  if(!Array.isArray(list)||list.length>10)throw Error('At most 10 email accounts can be saved.');
  const d=db(),put=d.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value');
  d.transaction(()=>{put.run('email.accounts',JSON.stringify(list));if(marker)put.run('email.secret_key_check',marker);})();
  try{if(typeof S.onChange==='function')S.onChange('email.accounts')}catch{}
}
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
  if(list.length>=10)throw Error('At most 10 email accounts can be saved.');
  const id='a'+require('crypto').randomUUID();const protectedPass=require('./email-vault').newCredential(list,id,pass);
  const acc = {
    id,
    label: String(label || PRESETS[provider].name).slice(0, 40),
    provider, user,
    ...(protectedPass.pass_enc ? {pass_enc:protectedPass.pass_enc} : {pass:protectedPass.pass}),
    host: provider === 'custom' ? String(host).trim().slice(0, 120) : '',
    port: provider === 'custom' ? (Number(port) || 587) : 0
  };
  list.push(acc); saveAccounts(list,protectedPass.marker || '');
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
function verifyCredential(id){const acc=id?accountById(id):defaultAccount();if(!acc)throw Error('Connect an email account first.');require('./email-vault').passwordFor(acc);}
const presetList = () => Object.entries(PRESETS).map(([id, p]) => ({ id, name: p.name, passUrl: p.passUrl }));

/* ---------------- sending ---------------- */
function transporterFor(acc) {
  const preset = PRESETS[acc.provider] || PRESETS.custom;
  const host = acc.provider === 'custom' ? String(acc.host || '').trim() : preset.host;
  const port = Number(acc.provider === 'custom' ? acc.port : preset.port) || 587;
  if (!host) throw new Error('This account has no SMTP host set.');
  return nodemailer.createTransport({ host, port, secure: port === 465, auth: { user: acc.user, pass: require('./email-vault').passwordFor(acc) } });
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

const stopped=()=>require('./panic').active() || require('./lifecycle').isStopping();
async function sendOne(acc, to, subject, text) {
  if(stopped()) throw new Error('Panic stop or shutdown is active; no new email was started.');
  const tr = transporterFor(acc);
  const info=await tr.sendMail({
    from: `"${acc.label}" <${acc.user}>`,
    to, subject: String(subject || '(no subject)').slice(0, 200),
    text: String(text || '').slice(0, 12000)
  });
  const accepted=Array.isArray(info?.accepted) && info.accepted.some(a=>String(typeof a==='object' ? a.address : a).toLowerCase()===String(to).toLowerCase());
  if(!accepted)throw new Error('SMTP acceptance was not confirmed.');
  return String(info?.messageId || '').slice(0,240);
}

/** Parse "email" / "email,Name" lines → [{email, name}] (deduped, max 100). */
function parseList(raw) {
  const out = []; const seen = new Set();
  for (const line of String(raw || '').split(/[\n;]+/)) {
    const t = line.trim(); if (!t) continue;
    const [rawAddr, ...nameParts] = t.split(',');
    const email = String(rawAddr || '').trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error('An email address is invalid. Correct the list before sending.');
    if (!seen.has(email)) { seen.add(email); out.push({ email, name: nameParts.join(',').trim().slice(0, 60) }); }
  }
  if(out.length>100)throw new Error('Email lists are limited to 100 recipients. No email was sent.');
  return out;
}

// SQLite journal for queued recipient outcomes. A claim precedes the SMTP
// operation; an interrupted or ambiguous claim is never replayed automatically.
function journal(){const d=db();d.exec(`CREATE TABLE IF NOT EXISTS email_delivery_attempts (
  queue_id INTEGER NOT NULL, recipient TEXT NOT NULL, state TEXT NOT NULL,
  provider_id TEXT NOT NULL DEFAULT '', detail TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT (datetime('now')), PRIMARY KEY(queue_id,recipient)
)`);return d;}
function sync(reason){try{require('./persist').syncSoon(reason,5000)}catch{}}
async function sendList(acc, rawList, subject, body, queueId=null) {
  const list = parseList(rawList);
  if (!list.length) throw new Error('No valid email addresses — use one per line: someone@example.com or someone@example.com,Name');
  if(list.some(item=>String(body || '').replaceAll('{name}', item.name || '').length>12000))throw Error('A personalized message would exceed 12,000 characters. No email was started.');
  const results = []; let sent = 0;
  for (const item of list) {
    if(stopped()){results.push({to:item.email,ok:false,state:'not_sent',error:'Stopped before sending'});continue;}
    const text = String(body || '').replaceAll('{name}', item.name || '');
    if(queueId){
      const n=journal().prepare("INSERT OR IGNORE INTO email_delivery_attempts(queue_id,recipient,state) VALUES(?,?,'sending')").run(queueId,item.email).changes;
      if(!n){results.push({to:item.email,ok:false,state:'needs_review',error:'An existing attempt requires review'});continue;}
      sync('email-claim');
    }
    try {
      const providerId=await sendOne(acc, item.email, subject, text);
      if(queueId)journal().prepare("UPDATE email_delivery_attempts SET state='accepted',provider_id=?,detail='SMTP server accepted; delivery is not confirmed',updated_at=datetime('now') WHERE queue_id=? AND recipient=? AND state='sending'").run(providerId,queueId,item.email);
      sent += 1; results.push({ to: item.email, ok: true, state:'accepted' });
      record(acc.user, item.email, subject, true, null);
    } catch (err) {
      const msg='SMTP outcome not confirmed. Check the recipient and server before sending again.';
      if(queueId)journal().prepare("UPDATE email_delivery_attempts SET state='uncertain',detail=?,updated_at=datetime('now') WHERE queue_id=? AND recipient=? AND state='sending'").run(msg,queueId,item.email);
      results.push({ to: item.email, ok: false, state:'uncertain', error: msg });
      record(acc.user, item.email, subject, false, msg);
    }
    if(queueId)sync('email-result');
    if (list.length > 1 && item !== list[list.length-1] && !stopped()) await new Promise((r) => setTimeout(r, PACE_MS));
  }
  ring.info('email.send', `SMTP accepted ${sent}/${list.length} requests; recipient delivery is not confirmed`);
  return { sent, total: list.length, complete:sent===list.length, results };
}

/* ---------------- test ---------------- */
async function testAccount(id) {
  const acc = id ? accountById(id) : defaultAccount();
  if (!acc) return { ok: false, error: 'Connect an email account first.' };
  if(stopped())return {ok:false,error:'Panic stop or shutdown is active. No email was started.'};
  try {require('./email-vault').passwordFor(acc);}catch{return {ok:false,error:require('./email-vault').LOCKED};}
  try {
    await sendOne(acc, acc.user, 'Raqifluz Bot — test email', '✅ This is a test email from your Raqifluz bot. If you can read this, email sending works!');
    record(acc.user, acc.user, 'Test email', true, null);
    return { ok: true, message: `SMTP accepted the test email to ${acc.user}; check the inbox and spam folder to verify delivery.` };
  } catch (err) {
    const msg = 'Test email outcome not confirmed. Check the inbox and server before retrying.';
    record(acc.user, acc.user, 'Test email', false, msg);
    return { ok: false, error: msg };
  }
}

/* ---------------- queue (send-later + big lists in background) ---------------- */
function enqueue(accountId, rawList, subject, body, atMs) {
  const acc = accountId ? accountById(accountId) : defaultAccount();
  if (!acc) throw new Error('Connect an email account first.');
  const list = parseList(rawList);
  if (!list.length) throw new Error('No valid email addresses — use one per line: someone@example.com or someone@example.com,Name');
  if(list.some(item=>String(body || '').replaceAll('{name}', item.name || '').length>12000))throw Error('A personalized message would exceed 12,000 characters. No email was scheduled.');
  if (!String(subject || '').trim() && !String(body || '').trim()) throw new Error('Subject or message is required.');
  db().prepare('INSERT INTO email_queue(at, account_id, to_list, subject, body, status) VALUES(?,?,?,?,?,?)')
    .run(toSqlUtc(atMs || Date.now()), acc.id, String(rawList).slice(0, 8000), String(subject || '').slice(0, 200), String(body || '').slice(0, 12000), 'pending');
  sync('email-queue');
}
function pendingQueue() { const d=journal();return d.prepare("SELECT id,at,account_id,to_list,subject,status,error,sent_at FROM email_queue WHERE status IN ('pending','sending','needs_review','failed') ORDER BY id DESC LIMIT 200").all().map(row=>({...row,attempts:d.prepare('SELECT recipient,state,provider_id AS providerId,detail,updated_at AS updatedAt FROM email_delivery_attempts WHERE queue_id=? ORDER BY recipient').all(row.id)})); }
function cancelQueued(id) { const n=db().prepare("UPDATE email_queue SET status='cancelled' WHERE id=? AND status='pending'").run(id).changes;if(!n)throw Error('The email is no longer pending; check its status before sending again.');sync('email-cancel'); }
function resolveQueued(id,confirmed){if(confirmed!==true)throw Error('Confirm that you checked the recipients and email history.');const n=db().prepare("UPDATE email_queue SET status='reviewed' WHERE id=? AND status IN ('needs_review','failed')").run(id).changes;if(!n)throw Error('This queue item does not need review.');sync('email-review');}
function history(limit = 60) { return db().prepare('SELECT * FROM email_history ORDER BY id DESC LIMIT ?').all(limit); }

/** The policy behind the Send buttons: schedule / background / immediate. */
async function sendOrQueue({ accountId, to, subject, body, scheduleAt } = {}) {
  const acc = accountId ? accountById(accountId) : defaultAccount();
  if (!acc) throw new Error('Connect an email account first (Email tab → Connect account).');
  require('./email-vault').passwordFor(acc);
  if(String(to||'').length>8000 || String(subject||'').length>200 || String(body||'').length>12000)throw Error('Recipient list, subject or message exceeds the limit. No email was started.');
  if(!String(subject||'').trim() && !String(body||'').trim())throw Error('Subject or message is required.');
  if (scheduleAt) {
    const t = Date.parse(scheduleAt);
    if (!Number.isFinite(t)) throw new Error('Bad schedule time.');
    enqueue(acc.id, to, subject, body, t);
    ring.info('email.scheduled', `Email scheduled for ${toSqlUtc(t)} UTC via ${acc.user}`);
    return { queued: true, note: 'Scheduled — it will send automatically at that time.' };
  }
  if(stopped())throw Error('Panic stop or shutdown is active; no new email was started.');
  const list = parseList(to);
  if (!list.length) throw new Error('No valid email addresses — use one per line: someone@example.com or someone@example.com,Name');
  if (list.length > INLINE_MAX) {
    enqueue(acc.id, to, subject, body, null);
    return { queued: true, note: `${list.length} recipients — sending in the background (paced, 1 email / 5 s). Watch the history below.` };
  }
  const r = await sendList(acc, to, subject, body);
  return { queued: false, ...r };
}

let queueRunning=false,lastCredentialWarning=false;
async function processQueue() {
  if(queueRunning || stopped())return;
  queueRunning=true;
  try {
    const d=db();const row=d.prepare("SELECT * FROM email_queue WHERE status='pending' AND at <= datetime('now') ORDER BY id ASC LIMIT 1").get();
    if (!row) return;
    const candidate=accountById(row.account_id);
    if(candidate){try{require('./email-vault').passwordFor(candidate);lastCredentialWarning=false;}catch{if(!lastCredentialWarning)ring.warn('email.key.locked','Email credential key unavailable; queued email remains pending. Review the key and queue before resuming.');lastCredentialWarning=true;return;}}
    const changed=d.prepare("UPDATE email_queue SET status='sending' WHERE id=? AND status='pending'").run(row.id).changes;if(!changed)return;
    sync('email-queue-claim');
    try {
      const acc = accountById(row.account_id);
      if (!acc) throw new Error('The sending account was removed.');
      const result=await sendList(acc, row.to_list, row.subject, row.body,row.id);
      if(result.complete)d.prepare("UPDATE email_queue SET status='sent',error=NULL,sent_at=datetime('now') WHERE id=? AND status='sending'").run(row.id);
      else d.prepare("UPDATE email_queue SET status='needs_review',error=? WHERE id=? AND status='sending'").run(`SMTP accepted ${result.sent}/${result.total}. Check history and recipients before sending again.`,row.id);
    } catch (err) {
      d.prepare("UPDATE email_queue SET status='needs_review',error=? WHERE id=? AND status='sending'").run('The queue did not complete. Check recipients and history before sending again.',row.id);
      ring.warn('email.queue.fail','Queued email needs review; no automatic retry will be attempted.');
    }
    sync('email-queue-result');
  } finally {queueRunning=false;}
}
function recoverQueue() {
  const d=journal();const recover=d.transaction(()=>{
    d.prepare("UPDATE email_delivery_attempts SET state='uncertain',detail='Interrupted while sending; check this recipient before trying again.',updated_at=datetime('now') WHERE state='sending' AND queue_id IN (SELECT id FROM email_queue WHERE status='sending')").run();
    return d.prepare("UPDATE email_queue SET status='needs_review',error='Interrupted during sending; check each recipient and history before trying again.' WHERE status='sending'").run().changes;
  });const n=recover();if(n)sync('email-queue-recovery');return n;
}
function start() {
  recoverQueue();
  setInterval(() => { processQueue().catch(()=>ring.warn('email.queue.fail','Email queue failed; inspect the queue before retrying.')); }, 15000).unref?.();
  ring.info('email.ready', 'Email engine ready — queued messages require review after an interrupted or uncertain send');
}

module.exports = {
  start, addAccount, removeAccount, setDefault, publicAccounts, presetList,
  securityStatus:()=>require('./email-vault').status(accounts()), verifyCredential,
  accountById, defaultAccount, testAccount, sendOrQueue, pendingQueue, cancelQueued, resolveQueued, history, processQueue, recoverQueue
};
