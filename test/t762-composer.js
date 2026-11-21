'use strict';
/*
 * 5B (v7.7.0) — unit tests for the composer build:
 *  1. idempotent 5B migrations on a populated DB copy (R3)
 *  2. R51 snippets — CRUD, ordering, truncation
 *  3. R49 drafts — CRUD, ordering, truncation
 *  4. R53 per-post retry / edit-republish — guard rails (no WA, wrong status, no stored text)
 */
const fs = require('fs');
const path = require('path');

process.env.DATABASE_PATH = 'data/t762-test/bot.sqlite';
process.env.SESSION_DIR = 'data/t762-test/sessions';
const DBFILE = path.resolve(__dirname, '..', 'data', 't762-test', 'bot.sqlite');
fs.rmSync(path.dirname(DBFILE), { recursive: true, force: true });
fs.mkdirSync(path.dirname(DBFILE), { recursive: true });

let passed = 0, failed = 0;
const ok = (cond, label) => { if (cond) { passed += 1; console.log('  ok  ' + label); } else { failed += 1; console.error('  FAIL ' + label); } };

(async () => {
  const db = require('../src/db');
  db.open();
  const d = db.open();

  /* ---------- 1 · 5B migrations (R3: idempotent, no data loss) ---------- */
  console.log('\n[1] 5B migrations');
  {
    const tables = d.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('snippets','drafts')").all().map((r) => r.name).sort();
    ok(JSON.stringify(tables) === JSON.stringify(['drafts', 'snippets']), '5B tables created on boot');
    /* seed data, then re-run SCHEMA_5B on a byte copy — must be a pure no-op */
    d.prepare("INSERT INTO snippets(name, body) VALUES('Seed','keep me')").run();
    d.prepare("INSERT INTO drafts(name, text) VALUES('Seed draft','keep me too')").run();
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'db.js'), 'utf8');
    const m = src.match(/const SCHEMA_5B = `([\s\S]*?)`;/);
    const copy = path.join(path.dirname(DBFILE), 'copy.sqlite');
    d.pragma('wal_checkpoint(TRUNCATE)'); /* flush WAL into the main file before byte-copying */
    fs.copyFileSync(DBFILE, copy);
    const Database = require('better-sqlite3');
    const c = new Database(copy);
    for (const stmt of m[1].split(/;\s*\n/)) { const o = stmt.trim(); if (o) { try { c.exec(o + ';'); } catch (e) { throw new Error('SCHEMA_5B not idempotent: ' + o.slice(0, 60) + ' → ' + e.message); } } }
    ok(c.prepare('SELECT COUNT(*) n FROM snippets').get().n === 1, 're-run on populated copy: snippet intact');
    ok(c.prepare('SELECT COUNT(*) n FROM drafts').get().n === 1, 're-run on populated copy: draft intact');
    c.close();
    /* clean the seeds so the CRUD section starts empty */
    d.prepare('DELETE FROM snippets').run();
    d.prepare('DELETE FROM drafts').run();
  }

  /* ---------- 2 · R51 snippets ---------- */
  console.log('\n[2] snippets CRUD');
  {
    const a = db.SN.add('Promo', 'Hi {name}, {deal} is live!');
    const b = db.SN.add('aa-early', 'alphabet first');
    ok(a && b && b > a, 'add() returns increasing ids');
    let list = db.SN.list();
    ok(list.length === 2 && list[0].name === 'aa-early' && list[1].name === 'Promo', 'list() ordered by name (case-insensitive)');
    db.SN.update(a, 'Promo X', 'changed body');
    list = db.SN.list();
    const p = list.find((s) => s.id === a);
    ok(p.name === 'Promo X' && p.body === 'changed body', 'update() renames and rewrites the body');
    ok(typeof p.updated_at === 'string' && p.updated_at.length > 0, 'update() stamps updated_at');
    db.SN.remove(b);
    list = db.SN.list();
    ok(list.length === 1 && list[0].id === a, 'remove() deletes only the named row');
    const longId = db.SN.add('Long', 'x'.repeat(30000));
    ok(db.SN.list().find((s) => s.id === longId).body.length === 20000, 'body truncated to 20k chars');
    db.SN.remove(longId);
    ok(db.SN.add('', 'orphan') !== null, 'name falls back to Untitled');
  }

  /* ---------- 3 · R49 drafts ---------- */
  console.log('\n[3] drafts CRUD');
  {
    const a = db.DR.add('first', 'text one');
    await new Promise((r) => setTimeout(r, 1100)); /* updated_at has 1s resolution */
    const b = db.DR.add('second', 'text two');
    let list = db.DR.list();
    ok(list.length === 2 && list[0].id === b, 'list() newest-updated first');
    db.DR.update(b, 'second-edit', 'changed');
    list = db.DR.list();
    const s = list.find((x) => x.id === b);
    ok(s.name === 'second-edit' && s.text === 'changed', 'update() rewrites name + text');
    db.DR.remove(a);
    list = db.DR.list();
    ok(list.length === 1 && list[0].id === b, 'remove() deletes only the named draft');
    const longId = db.DR.add('Long', 'y'.repeat(70000));
    ok(db.DR.list().find((x) => x.id === longId).text.length === 60000, 'draft text truncated to 60k chars');
    db.DR.remove(longId);
  }

  /* ---------- 4 · R53 retry / edit-republish guard rails ---------- */
  console.log('\n[4] post body storage + retry-one / edit-republish guards (no WhatsApp connected)');
  {
    const q = require('../src/queue5a');
    /* body column: P.mark stores full text, reason stays a short note */
    db.P.mark('456@newsletter', 'MB1', 'published', 'short note', 'full body text here');
    const mrow = d.prepare('SELECT * FROM posts WHERE source_msg_id=?').get('MB1');
    ok(mrow && mrow.body === 'full body text here' && mrow.reason === 'short note', 'P.mark stores the full text in body, the note in reason');
    db.P.setStatus(mrow.id, 'edited', 'edited note', 'changed full text');
    ok(d.prepare('SELECT body FROM posts WHERE id=?').get(mrow.id).body === 'changed full text', 'P.setStatus updates body when given one');
    db.P.setStatus(mrow.id, 'skipped', 'skipped note');
    ok(d.prepare('SELECT body FROM posts WHERE id=?').get(mrow.id).body === 'changed full text', 'P.setStatus without a body leaves it untouched');
    d.prepare('DELETE FROM posts WHERE source_msg_id=?').run('MB1');
    d.prepare("INSERT INTO posts(source_jid, source_msg_id, status, reason, body) VALUES('123@newsletter','PF1','published','ok','published body text')").run();
    d.prepare("INSERT INTO posts(source_jid, source_msg_id, status, reason, body) VALUES('123@newsletter','PF2','failed','WA down','failed body text')").run();
    d.prepare("INSERT INTO posts(source_jid, source_msg_id, status, reason, body) VALUES('123@newsletter','PF3','skipped','','')").run();
    const pubId = d.prepare("SELECT id FROM posts WHERE source_msg_id='PF1'").get().id;
    const failId = d.prepare("SELECT id FROM posts WHERE source_msg_id='PF2'").get().id;
    const skipId = d.prepare("SELECT id FROM posts WHERE source_msg_id='PF3'").get().id;

    let e1 = null;
    try { await q.retryOneFailed(pubId); } catch (err) { e1 = err.message; }
    ok(/only failed posts/i.test(String(e1)), 'retry-one on a PUBLISHED post is refused');

    let e2 = null;
    try { await q.retryOneFailed(failId); } catch (err) { e2 = err.message; }
    ok(/not connected/i.test(String(e2)), 'retry-one on a FAILED post fails cleanly without WhatsApp (post stays in queue)');
    ok(d.prepare('SELECT status FROM posts WHERE id=?').get(failId).status === 'failed', 'failed row untouched after the refused retry');

    let e3 = null;
    try { await q.republishOne(skipId, ''); } catch (err) { e3 = err.message; }
    ok(/no text is stored/i.test(String(e3)), 'edit-republish of a body-less post with no new text is refused');

    let e4 = null;
    try { await q.republishOne(skipId, 'brand new text'); } catch (err) { e4 = err.message; }
    ok(/not connected/i.test(String(e4)), 'edit-republish fails cleanly without WhatsApp (nothing published)');

    let e5 = null;
    try { await q.republishOne(99999, 'x'); } catch (err) { e5 = err.message; }
    ok(/not found/i.test(String(e5)), 'edit-republish of a missing id is refused');
  }

  /* close the singleton so the process can exit naturally */
  d.close();
  console.log('\nT762-COMPOSER (5B): ' + passed + ' passed, ' + failed + ' failed');
  process.exitCode = failed ? 1 : 0;
})().catch((err) => { console.error('FATAL', err); process.exitCode = 1; });
