/* 5F UNIT TESTS (R76–R79) — chat labels/pins/quick-replies/scheduled sends/export,
   contact notes+tags+timeline+dupes, broadcast lists + history, per-target rate
   caps, regex blocklist, per-rule find→replace enable.
   Runs on a fresh scratch DB (R3: migrations idempotent). Usage: node test/t766-5f.js */
'use strict';
const fs = require('fs');
const path = require('path');

process.env.DATABASE_PATH = 'data/t766-test/bot.sqlite';
process.env.SESSION_DIR = 'data/t766-test/sessions';
const DBFILE = path.resolve(__dirname, '..', 'data', 't766-test', 'bot.sqlite');
fs.rmSync(path.dirname(DBFILE), { recursive: true, force: true });
fs.mkdirSync(path.dirname(DBFILE), { recursive: true });

const db = require('../src/db');
const wa = require('../src/wa');
const power = require('../src/power');
const wasched = require('../src/wasched');
const pipeline = require('../src/pipeline');
const ai = require('../src/ai');
const publishMod = require('../src/publish');
const inbox = require('../src/inbox');

let passed = 0, failed = 0;
function ok(cond, label) {
  if (cond) { passed++; console.log('  ok  ' + label); }
  else { failed++; console.log('  FAIL ' + label); }
}
const d = db.open();

/* ── stub the WhatsApp link ── */
let fakeSock = null, fakeStatus = 'open';
wa.getSocket = () => fakeSock;
wa.getStatus = () => ({ status: fakeStatus });
function freshSock(fail) {
  const sent = [];
  fakeSock = { sendMessage: async (jid, payload) => { if (fail) throw new Error(fail); sent.push([jid, payload]); return { key: { id: 'S' + sent.length } }; } };
  return sent;
}

async function main() {
  console.log('\n[1] schema R3 — 5F tables + idempotent migration on a populated DB');
  {
    d.prepare("INSERT INTO settings(key, value) VALUES('seed.key', '1')").run();
    const before = d.prepare('SELECT value FROM settings WHERE key=\'seed.key\'').get();
    const d2 = db.open(); // re-open = migrations re-run
    const after = d2.prepare('SELECT value FROM settings WHERE key=\'seed.key\'').get();
    ok(before && after && before.value === after.value, 're-open keeps existing data (idempotent)');
    const want = ['chat_labels', 'chat_label_map', 'quick_replies', 'wa_scheduled', 'contact_notes', 'contact_tags', 'contact_tag_map', 'contact_events', 'broadcast_lists', 'target_publish_log'];
    const have = d.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r) => r.name);
    ok(want.every((t) => have.includes(t)), 'all 10 5F tables present: ' + want.filter((t) => !have.includes(t)).length === 0 ? 'yes' : 'missing ' + want.filter((t) => !have.includes(t)).join(','));
    const bh = d.prepare('PRAGMA table_info(bulk_history)').all().map((c) => c.name);
    ok(bh.includes('list_id') && bh.includes('list_name'), 'bulk_history gained list_id/list_name (ALTER, not drop)');
    const ws = d.prepare('PRAGMA table_info(wa_scheduled)').all().map((c) => c.name);
    ok(ws.includes('weekdays') && ws.includes('interval_min') && ws.includes('tz'), 'wa_scheduled has repeat-detail columns');
  }

  console.log('\n[2] chat labels (R76)');
  {
    const l1 = db.CL.add('Promo', '#F59E0B');
    const l2 = db.CL.add('VIP', '#EF4444');
    ok(l1 && l2 && l1 !== l2, 'two labels created with ids');
    db.CL.setForChat('main', '111@s.whatsapp.net', l1, true);
    db.CL.setForChat('main', '222@s.whatsapp.net', l1, true);
    db.CL.setForChat('main', '222@s.whatsapp.net', l2, true);
    let mine = db.CL.forChat('main', '222@s.whatsapp.net');
    ok(mine.length === 2 && mine.some((x) => x.id === l1) && mine.some((x) => x.id === l2), 'per-chat membership (chat 222 has both)');
    const counts = db.CL.counts();
    ok(counts[l1] === 2 && counts[l2] === 1, 'label counts per chat: ' + JSON.stringify(counts));
    db.CL.setForChat('main', '111@s.whatsapp.net', l1, false);
    ok(db.CL.counts()[l1] === 1, 'unlabelling decrements the count');
    const list = db.CL.list();
    ok(list.length === 2 && list.find((x) => x.id === l1).name === 'Promo', 'list keeps names/colors');
    db.CL.del(l2);
    const left = db.CL.forChat('main', '222@s.whatsapp.net');
    ok(db.CL.list().length === 1 && left.length === 1 && left[0].id === l1, 'delete removes label + its memberships (l1 stays)');
  }

  console.log('\n[3] quick replies (R76)');
  {
    const q1 = db.QR.add('Thanks, get in touch!');
    const q2 = db.QR.add('Prices are available on request.');
    ok(q1 && q2, 'replies saved');
    ok(db.QR.list().length === 2, 'list has both');
    ok(db.QR.add('') === null, 'empty text is refused');
    db.QR.del(q1);
    ok(db.QR.list().length === 1 && db.QR.list()[0].id === q2, 'delete works');
  }

  console.log('\n[4] scheduled sends — storage + tz (R76)');
  {
    const row = wasched.add({ session: 'main', jid: '111@s.whatsapp.net', text: 'Morning report', localAt: '2026-11-09T09:00', repeat: 'daily' });
    ok(row && row.at === '2026-11-09T04:00:00.000Z', '09:00 PKT stored as 04:00 UTC (PKT = UTC+5)');
    ok(row.repeat === 'daily' && row.tz === 'Asia/Karachi', 'repeat + tz persisted');
    const due = db.WAS.due(Date.parse('2026-11-09T05:00:00Z'), 'main');
    ok(due.length === 1 && due[0].id === row.id, 'due() finds the past-due item');
    const due2 = db.WAS.due(Date.parse('2026-11-09T03:00:00Z'), 'main');
    ok(due2.length === 0, 'due() respects the time');
    const iv = wasched.add({ session: 'main', jid: '111@s.whatsapp.net', text: 'interval item', localAt: '2026-11-09T09:30', repeat: 'interval', intervalMin: 99999 });
    ok(iv.interval_min === 10080, 'interval minutes clamped to 10080');
    const wd = wasched.add({ session: 'main', jid: '222@s.whatsapp.net', text: 'weekday item', localAt: '2026-11-11T10:00', repeat: 'weekdays' });
    ok(wd.weekdays === '1,2,3,4,5', 'weekdays repeat defaults Mon–Fri');
    db.WAS.setEnabled(row.id, false);
    ok(db.WAS.due(Date.parse('2026-11-09T05:00:00Z'), 'main').every((r) => r.id !== row.id), 'disabled item is not due');
    db.WAS.del(iv.id); db.WAS.del(wd.id); db.WAS.del(row.id);
    ok(db.WAS.list('main').length === 0, 'delete works');
  }

  console.log('\n[5] nextRun — drift-free repeat math (R76)');
  {
    const DAY = 86400000;
    const base = '2026-11-08T04:00:00.000Z'; // fixed anchor; assertions below are clock-robust (no fixed "now" window)
    const once = wasched.nextRun({ at: base, repeat: 'once', weekdays: '', interval_min: 0, tz: 'Asia/Karachi' });
    ok(once === null, 'once → null (gets disabled after one send)');
    // daily: a drift-free 24h lattice — the next run is the FIRST slot strictly in the future (PKT has no DST, so steps are exact)
    const daily = wasched.nextRun({ at: base, repeat: 'daily', weekdays: '', interval_min: 0, tz: 'Asia/Karachi' });
    const dOff = new Date(daily) - new Date(base);
    ok(daily && dOff % DAY === 0 && new Date(daily) > Date.now() && (new Date(daily) - DAY) <= Date.now(), 'daily → drift-free +24h lattice, first future slot');
    // weekly: the same property on a 7-day lattice
    const weekly = wasched.nextRun({ at: base, repeat: 'weekly', weekdays: '', interval_min: 0, tz: 'Asia/Karachi' });
    const wOff = new Date(weekly) - new Date(base);
    ok(weekly && wOff % (7 * DAY) === 0 && new Date(weekly) > Date.now() && (new Date(weekly) - 7 * DAY) <= Date.now(), 'weekly → drift-free +7d lattice, first future slot');
    const iv = wasched.nextRun({ at: base, repeat: 'interval', weekdays: '', interval_min: 30, tz: 'Asia/Karachi' });
    ok(iv > base && (Date.parse(iv) - Date.parse(base)) >= 30 * 60e3, 'interval → advances by ≥ the step');
    // weekdays: anchor to a FUTURE PKT-Friday → the next run is the following Monday (Sat+Sun skipped)
    let fr = new Date(Date.now() + 30 * DAY); fr.setUTCHours(4, 0, 0, 0);
    const pktDay = (dd) => new Date(dd.getTime() + 5 * 3600000).getUTCDay(); // PKT = UTC+5
    while (pktDay(fr) !== 5) fr = new Date(fr.getTime() + DAY); // roll forward to a Friday (PKT)
    const wd = wasched.nextRun({ at: fr.toISOString(), repeat: 'weekdays', weekdays: '1,2,3,4,5', interval_min: 0, tz: 'Asia/Karachi' });
    ok(wd === new Date(fr.getTime() + 3 * DAY).toISOString(), 'weekdays → a Friday skips Sat+Sun and lands the next Monday');
    ok(typeof power.advance({ at: base, repeat: 'daily' }) === 'string', 'reuses the 5A power.advance engine');
  }

  console.log('\n[6] wasched.tick — the send loop (R76)');
  {
    const sent = freshSock();
    const idOnce = db.WAS.add({ session: 'main', jid: '333@s.whatsapp.net', text: 'fire once', at: new Date(Date.now() - 60e3).toISOString(), repeat: 'once' });
    const idDaily = db.WAS.add({ session: 'main', jid: '444@s.whatsapp.net', text: 'every day', at: new Date(Date.now() - 60e3).toISOString(), repeat: 'daily' });
    await wasched.tick('main');
    ok(sent.length === 2, 'both due items sent');
    ok(sent[0][1].text === 'fire once' && sent[1][1].text === 'every day', 'correct text per contact');
    const after1 = db.WAS.get(idOnce);
    ok(after1 && after1.sent === 1 && after1.enabled === 0, 'once → marked sent AND disabled');
    const after2 = db.WAS.get(idDaily);
    ok(after2 && after2.sent === 1 && after2.enabled === 1 && Date.parse(after2.at) > Date.now(), 'daily → marked sent, stays enabled, moved to the next day');
    const idFuture = db.WAS.add({ session: 'main', jid: '555@s.whatsapp.net', text: 'not yet', at: new Date(Date.now() + 3600e3).toISOString(), repeat: 'once' });
    const before = sent.length;
    await wasched.tick('main');
    ok(sent.length === before, 'future item is not touched');
    // panic stop freezes scheduled sends (make idDaily due again so panic has something to block)
    d.prepare('UPDATE wa_scheduled SET at=? WHERE id=?').run(new Date(Date.now() - 1000).toISOString(), idDaily);
    db.S.set('panic.on', '1');
    const b2 = sent.length;
    await wasched.tick('main');
    ok(sent.length === b2, 'panic ON → due item NOT sent (5E R73 respected)');
    db.S.set('panic.on', '0');
    const b2b = sent.length;
    await wasched.tick('main');
    ok(sent.length === b2b + 1, 'panic OFF → the item sends (nothing was lost while paused)');
    // failed send → 1-minute retry, never lost
    freshSock('peer not found');
    d.prepare('UPDATE wa_scheduled SET at=? WHERE id=?').run(new Date(Date.now() - 1000).toISOString(), idDaily);
    await wasched.tick('main');
    const retried = db.WAS.get(idDaily);
    ok(retried && Date.parse(retried.at) > Date.now() && Date.parse(retried.at) - Date.now() < 120e3, 'failed send → retried in ~1 minute (item never lost)');
    ok(retried && retried.enabled === 1, 'failed item stays enabled');
    db.WAS.del(idOnce); db.WAS.del(idDaily); db.WAS.del(idFuture);
    // link not ready → items wait
    fakeStatus = 'close';
    const idWait = db.WAS.add({ session: 'main', jid: '666@s.whatsapp.net', text: 'wait', at: new Date(Date.now() - 1000).toISOString(), repeat: 'once' });
    const b3 = sent.length;
    await wasched.tick('main');
    ok(sent.length === b3, 'link closed → tick is a no-op (items wait, nothing lost)');
    db.WAS.del(idWait);
    fakeStatus = 'open';
  }

  console.log('\n[7] wasched.add — validation (R76)');
  {
    let threw = false;
    try { wasched.add({ jid: '111@s.whatsapp.net', text: 'x', localAt: 'garbage' }); } catch { threw = true; }
    ok(threw, 'invalid time → clean error, nothing stored');
    threw = false;
    try { wasched.add({ jid: '111@s.whatsapp.net', text: '', localAt: '2026-11-09T09:00' }); } catch { threw = true; }
    ok(threw, 'empty message → clean error');
    threw = false;
    try { wasched.add({ jid: '111@s.whatsapp.net', text: 'ok', localAt: '2026-11-09T09:00', repeat: 'nonsense' }); } catch { threw = true; }
    ok(!threw, 'unknown repeat falls back to once (never crashes)');
  }

  console.log('\n[8] contacts — notes, tags, timeline (R77)');
  {
    db.CN.set('main', '111@s.whatsapp.net', 'VIP client — calls on Fridays');
    ok(db.CN.get('main', '111@s.whatsapp.net').note === 'VIP client — calls on Fridays', 'note saved');
    const t1 = db.CN.addTag('vip');
    const t2 = db.CN.addTag('franchisee');
    db.CN.setForContact('main', '111@s.whatsapp.net', t1, true);
    db.CN.setForContact('main', '111@s.whatsapp.net', t2, true);
    db.CN.setForContact('main', '111@s.whatsapp.net', t2, false);
    const tags = db.CN.forContact('main', '111@s.whatsapp.net');
    ok(tags.length === 1 && tags[0].name === 'vip', 'tag on/off (franchisee removed)');
    d.prepare("INSERT INTO inbox_msgs(session, chat_jid, from_me, ts, body) VALUES('main','111@s.whatsapp.net',0,'2026-11-08 09:00:00','hello there')").run();
    d.prepare("INSERT INTO inbox_msgs(session, chat_jid, from_me, ts, body, kind) VALUES('main','111@s.whatsapp.net',1,'2026-11-08 09:05:00','thanks!','text')").run();
    db.CN.event('main', '111@s.whatsapp.net', 'call', 'Missed call');
    const tl = db.CN.timeline('main', '111@s.whatsapp.net', 50);
    ok(tl.length >= 3, 'timeline mixes messages + events (' + tl.length + ' items)');
    ok(tl.every((x) => x.ts && x.kind), 'timeline rows carry ts+kind');
    db.CN.set('main', '111@s.whatsapp.net', '');
    ok(db.CN.get('main', '111@s.whatsapp.net').note === '', 'note can be cleared');
    ok(db.CT.one('main', 'nope@s.whatsapp.net') === null, 'CT.one returns null for unknown');
  }

  console.log('\n[9] broadcast lists (R78)');
  {
    const b1 = db.BCL.add('Family', '923001111111,Ali\n923002222222\n923003333333,Sara');
    ok(b1, 'list created');
    const got = db.BCL.get(b1);
    ok(got.name === 'Family' && db.BCL.countRecipients(got.recipients) === 3, 'recipients counted (3, blank lines ignored)');
    db.BCL.update(b1, 'Family v2', '923001111111');
    ok(db.BCL.get(b1).name === 'Family v2' && db.BCL.countRecipients(db.BCL.get(b1).recipients) === 1, 'update replaces name+recipients');
    db.BULKH.record(3, 2, 1, 'hello everyone', b1, 'Family v2');
    const h = db.BULKH.list(5)[0];
    ok(h.list_id === b1 && h.list_name === 'Family v2', 'history row carries the list id+name');
    db.BCL.del(b1);
    ok(db.BCL.list().length === 0, 'delete works');
  }

  console.log('\n[10] bulkSend — list meta + single history row (R78)');
  {
    const sent = freshSock();
    const r = await inbox.bulkSend('923001111111,Ali\n923002222222', 'Hi {name}!', { skipRecord: true, listId: 7, listName: 'Family' });
    ok(r.sent === 2 && r.total === 2, 'two recipients delivered');
    ok(sent[0][1].text === 'Hi Ali!' && sent[1][1].text === 'Hi !', '{name} personalized per recipient');
    const afterBulk = db.BULKH.list(5).filter((h) => h.list_id === 7);
    ok(afterBulk.length === 0, 'skipRecord → bulkSend writes NO history row');
    db.BULKH.record(r.total, r.sent, r.total - r.sent, 'Hi {name}!', 7, 'Family'); // the route does the single record
    const rows = db.BULKH.list(5).filter((h) => h.list_id === 7);
    ok(rows.length === 1, 'route-side record → exactly ONE history row (no double log)');
    ok(rows[0].list_name === 'Family', 'history row named after the list');
    await inbox.bulkSend('923004444444', 'plain bulk');
    ok(db.BULKH.list(1)[0].text === 'plain bulk', 'default path still records its own row');
  }

  console.log('\n[11] per-target rate caps (R79)');
  {
    publishMod; // (kept for import)
    const P = require('../src/publish');
    ok(typeof P.perTargetMax === 'function', 'perTargetMax exported');
    db.CH.addTarget('T1@newsletter', 'Channel One');
    db.CH.addTarget('T2@newsletter', 'Channel Two');
    ok(db.CH.listActiveTargets().length === 2, 'two targets active');
    db.S.set('guard.maxperhour', '30');
    // fake sendToChannel
    let chSent = 0;
    wa.sendToChannel = async (sock, jid, c) => { chSent++; return 'CH' + chSent; };
    fakeStatus = 'open'; freshSock();
    db.S.set('guard.maxperhour.T1@newsletter', '1'); // T1 capped at 1/h
    const run1 = await P.publish({ text: 'first post' }, {});
    ok(run1.sent === 2, 'first post reaches both targets');
    ok(db.CH.pubCountLastHour('T1@newsletter') === 1, 'T1 ledger counted 1');
    const run2 = await P.publish({ text: 'second post' }, {});
    ok(run2.sent === 1, 'second post: T1 skipped by its cap, T2 still gets it');
    ok(run2.errors.some((e) => e.includes('per-target cap')), 'skip is reported honestly in errors');
    ok(db.CH.pubCountLastHour('T2@newsletter') === 2, 'T2 ledger counted both');
    ok(db.CH.pubCountLastHour('T1@newsletter') === 1, 'T1 never exceeded its cap of 1');
    db.S.set('guard.maxperhour.T1@newsletter', '0');
    const run3 = await P.publish({ text: 'third post' }, {});
    ok(run3.sent === 2, 'cap 0 → back to the global guard (both sent)');
    // perTargetMax unit
    db.S.set('guard.maxperhour.T1@newsletter', '5');
    ok(P.perTargetMax('T1@newsletter') === 5, 'perTargetMax reads the key');
    ok(P.perTargetMax('unknown@newsletter') === 0, 'perTargetMax defaults to 0 (global guard)');
    // the per-hour window expires
    d.prepare("UPDATE target_publish_log SET ts = datetime('now', '-2 hours')").run();
    ok(db.CH.pubCountLastHour('T1@newsletter') === 0, 'older-than-1-hour publishes leave the window');
    db.CH.removeTarget('T1@newsletter'); db.CH.removeTarget('T2@newsletter');
  }

  console.log('\n[12] blocklist regex mode (R79)');
  {
    const bl = pipeline.blockedWord;
    db.S.set('blocklist.words', 'winner,lottery');
    db.S.set('blocklist.regex', '0');
    ok(bl('You are the WINNER!') === 'winner', 'plain mode: case-insensitive substring');
    ok(bl('no prizes here') === null, 'plain mode: no match → null');
    db.S.set('blocklist.regex', '1');
    ok(bl('congratulations winner 555') === 'winner', 'regex mode: pattern matches');
    ok(bl('WINNER alert') === 'winner', 'regex mode: case-insensitive by default');
    db.S.set('blocklist.words', 'price\\d{2,}\nwinner');
    ok(bl('price999 special') === 'price\\d{2,}', 'regex mode: real regex (digits) — multi-line keeps {2,} intact');
    db.S.set('blocklist.words', 'lottery');
    ok(bl('winner test') === null, 'regex mode: no match → null');
    db.S.set('blocklist.words', '([\nwinner');
    ok(bl('winner test') === 'winner', 'invalid pattern (unclosed class) skipped — the rest still works');
    ok(bl('a{ literal') === null, 'invalid pattern never matches');
    db.S.set('blocklist.regex', '0');
    ok(bl('a{ literal') === null, 'plain mode ignores a{ (entries <3 chars or substring only)');
    db.S.set('blocklist.words', '');
    ok(bl('anything at all') === null, 'empty blocklist → nothing blocked (default OFF state)');
  }

  console.log('\n[13] per-rule find→replace enable (R79)');
  {
    const rep = ai.applyReplacements;
    db.S.set('replace.rules', 'Old Brand=>New Brand\n- bye=>ciao\nJoin our channel=>');
    let t = rep('Hello from Old Brand, bye for now. Join our channel!');
    ok(t.includes('New Brand'), 'enabled rule applied');
    ok(t.includes('bye') && !t.includes('ciao'), 'disabled rule (dash prefix) NOT applied');
    ok(!t.includes('Join our channel'), 'delete rule (empty new) still removes');
    db.S.set('replace.rules', '- a=>b\nc=>d');
    t = rep('a c');
    ok(t === 'a d', 'only non-dashed lines run');
    // 30-rule cap: build 40 rules (w<#>x so no rule is a substring of another)
    let big = '';
    for (let i = 0; i < 40; i++) big += `w${i}x=>${i}\n`;
    db.S.set('replace.rules', big);
    t = rep('w0x w39x');
    ok(t === '0 w39x', 'rule cap 30: first 30 apply, the rest ignored safely');
    db.S.set('replace.rules', '');
  }

  console.log(`\n${failed === 0 ? 'ALL PASS' : 'FAILURES'} — ${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}
main().catch((e) => { console.error('SUITE CRASH:', e); process.exit(1); });
