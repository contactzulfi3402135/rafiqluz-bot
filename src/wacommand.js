'use strict';
/**
 * 5H (R85): WHATSAPP COMMAND CHANNEL — talk to the bot from the "message
 * yourself" chat. OFF by default. Locked to the owner's own number ONLY —
 * no one else's message can ever trigger a command. Destructive commands
 * (undo / pause / panic) need the PIN from Settings (R9: my-number-locked +
 * PIN destructive). Every command is logged (audit + assistant history) and
 * mirrored into the AI assistant chat, so the robot and the WA channel see
 * the same conversation. Uses the EXISTING control toolset (queue5a, panic,
 * settings) — nothing is re-implemented, and no pipeline step is touched.
 */
const { S, AUD, AICHAT, NTF, P } = require('./db');
const { ring } = require('./logger');

const DESTRUCTIVE = new Set(['undo', 'pause', 'panic']);

function norm(text) {
  return String(text || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function ownJid() {
  const phone = String(S.get('main.phone', '')).trim();
  return phone ? `${phone}@s.whatsapp.net` : '';
}

function pinSet() { return /^\d{4,8}$/.test(String(S.get('waCommand.pin', ''))); }

/** The command catalog (also rendered in Settings). */
const COMMANDS = [
  ['status', 'Connection, queue and today’s numbers'],
  ['approve', 'Approve everything in the Approval Queue'],
  ['failed', 'What failed in the last 24 h'],
  ['undo last', '⚠ PIN — undo the most recent published post'],
  ['pause', '⚠ PIN — pause all mirroring (global pause)'],
  ['resume', '⚠ PIN — clear the global pause'],
  ['panic', '⚠ PIN — full panic stop (restores exact states)'],
  ['help', 'List the commands']
];

function statusText() {
  const wa = require('./wa');
  const st = wa.getStatus().status;
  const q = require('./queue5a');
  const d = require('./db').open();
  const today = d.prepare("SELECT status, COUNT(*) n FROM posts WHERE created_at >= date('now') GROUP BY status").all();
  const t = (s) => (today.find((x) => x.status === s) || { n: 0 }).n;
  const panic = S.getBool('panic.on', false);
  const paused = S.getBool('mirror.paused', false);
  return [
    '📡 Bot status',
    `WhatsApp: ${st}${paused ? ' · PAUSED' : ''}${panic ? ' · PANIC STOP' : ''}`,
    `Approval queue: ${q.pendingCount()} waiting`,
    `Today: ${t('published')} published · ${t('skipped')} skipped · ${t('failed')} failed`
  ].join('\n');
}

function failedText() {
  const d = require('./db').open();
  const rows = d.prepare("SELECT source_jid, reason, created_at FROM posts WHERE status='failed' AND created_at >= datetime('now','-1 day') ORDER BY id DESC LIMIT 5").all();
  if (!rows.length) return '✅ Nothing failed in the last 24 hours.';
  return ['❌ Failed in the last 24 h:'].concat(rows.map((r) => `• ${(r.source_jid || 'source')} — ${r.reason || 'unknown'}`)).join('\n');
}

async function undoText() {
  const q = require('./queue5a');
  const d = require('./db').open();
  const last = d.prepare(`SELECT pk.target_jid FROM post_keys pk JOIN posts p ON p.id = pk.post_id
    WHERE p.status IN ('published','edited') ORDER BY pk.at DESC, pk.id DESC LIMIT 1`).get();
  if (!last) return 'No published post found to undo.';
  const r = await q.undoLast(last.target_jid);
  return `↩️ Undid the last post on ${last.target_jid}${r ? '' : ''}. It is removed from the channel.`;
}

/** Handle one command. Returns the reply text (or null when not a command). */
async function handle(rawText) {
  const line = norm(rawText);
  if (!line) return null;
  // split an optional trailing PIN: "undo last 1234" → cmd + pin
  let cmd = line, pin = '';
  const m = line.match(/^(undo( last)?|pause|panic|resume)\s+(\d{4,8})$/);
  if (m) { cmd = norm(m[1]); pin = m[3]; }
  if (!['status', 'approve', 'failed', 'undo', 'undo last', 'pause', 'resume', 'panic', 'help', '?'].includes(cmd)) return null;
  cmd = cmd === 'undo last' ? 'undo' : cmd;

  try {
    AUD.log('owner', 'wa.command', `WA command “${cmd}”${pin ? ' (with PIN)' : ''} from the owner's number`);
    if (DESTRUCTIVE.has(cmd)) {
      if (!pinSet()) return 'Set a command PIN in Settings → Automation first (4–8 digits), then send the command with the PIN, e.g. “pause 1234”.';
      if (pin !== String(S.get('waCommand.pin', ''))) return 'Wrong PIN — nothing was done. Send the command with the correct PIN, e.g. “pause 1234”.';
    }
    switch (cmd) {
      case 'status': return statusText();
      case 'approve': {
        const n = require('./queue5a').approveAll();
        return n ? `✅ Approved ${n} queued post(s) — they are going out now.` : 'The Approval Queue is empty — nothing to approve.';
      }
      case 'failed': return failedText();
      case 'undo': return await undoText();
      case 'pause': S.set('mirror.paused', '1'); NTF.add('pause', 'Global pause engaged from the WA command channel'); return '⏸ Paused — mirroring, queue, scheduler and RSS are on hold until “resume”.';
      case 'resume': S.set('mirror.paused', '0'); NTF.add('pause', 'Global pause cleared from the WA command channel'); return '▶ Resumed — everything is flowing again.';
      case 'panic': require('./panic').stop('wa-command'); return '🛑 PANIC STOP engaged — everything paused with exact-state restore. Send “resume” (with PIN) when you are ready, or restore from the dashboard.';
      case 'help': return ['📋 Commands (send to your own number):'].concat(COMMANDS.map(([c, d]) => `${c} — ${d}`)).join('\n');
      default: return null;
    }
  } catch (err) {
    AUD.log('owner', 'wa.command-error', `WA command “${cmd}” failed: ${String(err.message || err).slice(0, 160)}`);
    return `⚠️ Could not run “${cmd}”: ${String(err.message || err).slice(0, 160)}`;
  }
}

function register() {
  const wa = require('./wa');
  wa.events.on('wa.message', (m) => {
    (async () => {
      try {
        if (!S.getBool('power.waCommand.on', false)) return;          // OFF by default
        if (!m?.key || !m.key.fromMe) return;                          // only MY messages
        const jid = String(m.key.remoteJid || '');
        const own = ownJid();
        if (!own || jid !== own) return;                               // my number, locked
        const text = m.message?.extendedTextMessage?.text || m.message?.conversation || '';
        const reply = await handle(text);
        if (reply === null) return;
        AICHAT.add('user', `WA: ${String(text).slice(0, 300)}`);
        AICHAT.add('assistant', reply.slice(0, 2000));                 // mirrored to the assistant
        const sock = wa.getSocket();
        if (sock && !require('./panic').active() && !require('./lifecycle').isStopping()) await sock.sendMessage(own, { text: reply.slice(0, 3500) });
        ring.info('wa.command', `WA command handled: ${norm(text).slice(0, 40)}`);
      } catch (err) {
        ring.warn('wa.command-error', `Command channel error: ${String(err?.message || err).slice(0, 140)}`);
      }
    })();
  });
  ring.info('wacommand.ready', 'WA command channel armed (off by default — enable in Settings → Automation)');
}

module.exports = { COMMANDS, DESTRUCTIVE, handle, register, ownJid, pinSet };
