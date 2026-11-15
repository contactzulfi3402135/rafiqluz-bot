'use strict';
/*
 * 5C (v7.7.0) — unit tests for the AI-features build:
 *  1. idempotent 5C migrations on a populated DB copy (R3)
 *  2. R54 usage meter (AIU) + per-feature provider resolution (callFor)
 *  3. R55 prompt library — 10 seeds, idempotent, CRUD, built-ins protected
 *  4. R57 glossary — dedupe, case-insensitive enforce, longest-first, regex-escape
 *  5. R59 reply KB — CRUD, 70% match threshold, disabled pairs ignored
 *  6. R56 emojiBullets — deterministic conversion, non-bullets untouched
 *  7. R60 buildRecap — deterministic recap text from real DB rows
 */
const fs = require('fs');
const path = require('path');

process.env.DATABASE_PATH = 'data/t763-test/bot.sqlite';
process.env.SESSION_DIR = 'data/t763-test/sessions';
const DBFILE = path.resolve(__dirname, '..', 'data', 't763-test', 'bot.sqlite');
fs.rmSync(path.dirname(DBFILE), { recursive: true, force: true });
fs.mkdirSync(path.dirname(DBFILE), { recursive: true });

let passed = 0, failed = 0;
const ok = (cond, label) => { if (cond) { passed += 1; console.log('  ok  ' + label); } else { failed += 1; console.error('  FAIL ' + label); } };

(async () => {
  const db = require('../src/db');
  db.open();
  const d = db.open();

  /* ---------- 1 · 5C migrations (R3) ---------- */
  console.log('\n[1] 5C migrations');
  {
    const tables = d.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('ai_usage','prompts_lib','glossary','reply_kb')").all().map((r) => r.name).sort();
    ok(JSON.stringify(tables) === JSON.stringify(['ai_usage', 'glossary', 'prompts_lib', 'reply_kb']), '5C tables created on boot');
    ok('voice_text' in (d.prepare('SELECT * FROM inbox_msgs LIMIT 1').get() || {}) || d.prepare("PRAGMA table_info(inbox_msgs)").all().some((c) => c.name === 'voice_text'), 'inbox_msgs.voice_text column added (R58)');
    /* idempotent re-run on a populated byte copy */
    db.PL.seed();
    db.RB.add('Q1', 'A1');
    d.pragma('wal_checkpoint(TRUNCATE)');
    const copy = path.join(path.dirname(DBFILE), 'copy.sqlite');
    fs.copyFileSync(DBFILE, copy);
    const Database = require('better-sqlite3');
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'db.js'), 'utf8');
    const m = src.match(/const SCHEMA_5C = `([\s\S]*?)`;/);
    const c = new Database(copy);
    for (const stmt of m[1].split(/;\s*\n/)) { const o = stmt.trim(); if (o) { try { c.exec(o + ';'); } catch (e) { throw new Error('SCHEMA_5C not idempotent: ' + o.slice(0, 60) + ' → ' + e.message); } } }
    ok(c.prepare('SELECT COUNT(*) n FROM prompts_lib').get().n === 10, 're-run on populated copy: seeds intact');
    ok(c.prepare('SELECT COUNT(*) n FROM reply_kb').get().n === 1, 're-run on populated copy: KB intact');
    c.close();
  }

  /* ---------- 2 · R54 usage meter + per-feature resolution ---------- */
  console.log('\n[2] AI usage meter + per-feature provider');
  {
    db.AIU.add('tldr', 'gemini', 'gemini-3-flash', 1200, 800);
    db.AIU.add('tldr', 'gemini', 'gemini-3-flash', 900, 600);
    db.AIU.add('composer', 'openrouter', 'x', 0, 100);
    const row = db.AIU.list().find((u) => u.feature === 'tldr' && u.model === 'gemini-3-flash');
    ok(row.calls === 2, 'AIU.add upserts calls (2)');
    ok(row.tokens === 2100, 'AIU.add accumulates tokens (1200+900)');
    ok(row.ms === 1400, 'AIU.add accumulates ms (800+600)');
    const tot = db.AIU.totals();
    ok(tot.calls === 3 && tot.tokens === 2100, 'AIU.totals sums across features');
    /* per-feature provider resolution — callFor must honor the override */
    const ai = require('../src/ai');
    db.S.set('ai.feature.tldr.provider', 'totally-bogus-provider');
    let e1 = null;
    try { await ai.callFor('tldr', 'hello'); } catch (err) { e1 = err; }
    ok(e1 && /unknown provider/i.test(String(e1.message)), 'callFor uses the FEATURE provider (bogus override → unknown provider, not the global key)');
    db.S.set('ai.feature.tldr.provider', '');
    db.S.set('ai.feature.tldr.model', '');
    ok(ai.FEATURES_5C.includes('tldr') && ai.FEATURES_5C.includes('transcribe'), 'FEATURES_5C lists the metered features');
  }

  /* ---------- 3 · R55 prompt library ---------- */
  console.log('\n[3] prompt library (10 seeds)');
  {
    d.prepare('DELETE FROM prompts_lib').run();
    const n = db.PL.seed();
    ok(n === 10, 'seed() inserts exactly 10 built-ins on an empty library');
    ok(db.PL.list().length === 10, 'list() shows all 10');
    ok(db.PL.seed() === 0, 'seed() is a no-op once populated (idempotent)');
    ok(db.PL.list().every((p, i) => i === 0 || p.builtin === 1), 'all seeded prompts are marked builtin');
    const id = db.PL.add('My prompt', 'Custom body here');
    let list = db.PL.list();
    ok(list[0].builtin === 1 && list.some((p) => p.id === id && p.builtin === 0), 'built-ins stay first; owner prompts after');
    db.PL.update(id, 'My prompt v2', 'New body');
    list = db.PL.list();
    ok(list.find((p) => p.id === id).name === 'My prompt v2' && list.find((p) => p.id === id).body === 'New body', 'update() edits name + body');
    const builtinId = db.PL.list()[0].id;
    db.PL.remove(builtinId);
    ok(db.PL.list().some((p) => p.id === builtinId), 'built-ins cannot be deleted (edit instead)');
    db.PL.remove(id);
    ok(!db.PL.list().some((p) => p.id === id), 'owner prompts can be deleted');
  }

  /* ---------- 4 · R57 glossary ---------- */
  console.log('\n[4] glossary enforcement');
  {
    d.prepare('DELETE FROM glossary').run();
    db.GL.add('App', 'the app');
    db.GL.add('app', 'our app');  // duplicate from_term (case-insensitive) → updates
    ok(db.GL.list().length === 1, 'duplicate from_term updates the existing row (case-insensitive)');
    db.GL.add('Super App', 'the flagship');
    db.GL.add('C++', 'C plus plus');
    ok(db.GL.apply('The APP is great. Use super app and C++ today.') === 'The our app is great. Use the flagship and C plus plus today.', 'apply() is case-insensitive, longest-first (no nesting), regex-escaped');
    ok(db.GL.apply('nothing to see') === 'nothing to see', 'apply() is a no-op when no term matches');
    ok(db.GL.apply('') === '', 'apply() handles empty text');
    db.GL.remove(db.GL.list()[0].id);
    ok(db.GL.list().length === 2, 'remove() deletes a term');
    d.prepare('DELETE FROM glossary').run();
  }

  /* ---------- 5 · R59 reply KB ---------- */
  console.log('\n[5] knowledge-base matching');
  {
    d.prepare('DELETE FROM reply_kb').run();
    db.RB.add('What are your business hours?', 'We are open 9am to 9pm, seven days a week.');
    db.RB.add('Do you deliver to Lahore?', 'Yes — we deliver across Lahore and all major cities.');
    const kbIds = db.RB.listAll().map((r) => r.id);
    const hoursId = db.RB.listAll().find((r) => r.q.includes('business hours')).id;
    ok(db.RB.match('what are the business hours?').a.includes('9am to 9pm'), 'match() finds the hours answer (word overlap)');
    ok(db.RB.match('hi do you deliver to lahore today?').a.includes('Lahore'), 'match() tolerates extra words in the message');
    ok(db.RB.match('tell me a joke') === null, 'match() returns null below the 70% threshold');
    db.RB.update(hoursId, 'What are your business hours?', 'HOURS-NEW', false);
    ok(db.RB.match('what are the business hours?') === null, 'disabled pairs are ignored by match()');
    ok(db.RB.match('hi do you deliver to lahore today?').a.includes('Lahore'), 'the OTHER pair still matches while one is disabled');
    db.RB.update(hoursId, 'What are your business hours?', 'HOURS-NEW', true);
    ok(db.RB.match('what are the business hours?').a === 'HOURS-NEW', 'update() re-enables a pair with a new answer');
    db.RB.remove(kbIds[0] === hoursId ? kbIds[1] : kbIds[0]);
    ok(db.RB.listAll().length === 1, 'remove() deletes a pair');
    d.prepare('DELETE FROM reply_kb').run();
  }

  /* ---------- 6 · R56 emojiBullets ---------- */
  console.log('\n[6] emoji bullets (deterministic)');
  {
    const eb = require('../src/pipeline').emojiBullets;
    const out = eb('Title line\n- first item\n- second item\n1. third item\nplain line stays');
    const lines = out.split('\n');
    ok(lines[0] === 'Title line', 'non-bullet lines are untouched');
    const EMOJI_RE = /^\p{Extended_Pictographic} /u;
    ok(lines[1].endsWith('first item') && EMOJI_RE.test(lines[1]), 'dash bullets become emoji bullets');
    ok(EMOJI_RE.test(lines[2]) && EMOJI_RE.test(lines[3]), 'dash and numbered bullets all convert');
    ok(lines[1][0] !== lines[2][0] && lines[2][0] !== lines[3][0], 'emoji bullets rotate across lines (no repeats within 3)');
    ok(lines[4] === 'plain line stays', 'free text lines are left exactly as-is');
    ok(eb('') === '', 'empty text survives');
  }

  /* ---------- 7 · R60 buildRecap ---------- */
  console.log('\n[7] morning recap builder (deterministic)');
  {
    const recap = require('../src/recap');
    d.prepare("INSERT INTO posts(source_jid, source_msg_id, status, reason, body) VALUES('123@newsletter','R1','published','ok','post one')").run();
    d.prepare("INSERT INTO posts(source_jid, source_msg_id, status, reason, body) VALUES('123@newsletter','R2','published','ok','post two')").run();
    d.prepare("INSERT INTO posts(source_jid, source_msg_id, status, reason, body) VALUES('123@newsletter','R3','skipped','blocklist: x','post three')").run();
    d.prepare("INSERT INTO posts(source_jid, source_msg_id, status, reason, body) VALUES('123@newsletter','R4','failed','WhatsApp is not connected','post four')").run();
    const text = recap.buildRecap(d);
    ok(/Published: 2/.test(text), 'recap counts published (2)');
    ok(/Skipped: 1/.test(text), 'recap counts skipped (1)');
    ok(/Failed: 1/.test(text), 'recap counts failed (1)');
    ok(/WhatsApp is not connected/.test(text), 'recap lists the failed reason');
    ok(!/post four/.test(text), 'recap never leaks post bodies');
  }

  d.close();
  console.log('\nT763-5C: ' + passed + ' passed, ' + failed + ' failed');
  process.exitCode = failed ? 1 : 0;
})().catch((err) => { console.error('FATAL', err); process.exitCode = 1; });
