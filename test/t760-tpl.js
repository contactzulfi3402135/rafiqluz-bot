/* v7.6.0 P4 — template engine v2 unit battery (R30–R36). Self-cleaning. Run: node test/t760-tpl.js */
const path = require('path');
const ROOT = path.join(__dirname, '..');
process.chdir(ROOT);
const T = require(ROOT + '/src/templates');
const db = require(ROOT + '/src/db').open();
const results = [];
const check = (n, ok) => results.push([ok ? 'PASS' : 'FAIL', n]);
const SAMPLE = 'Punjab Board result is out. Check at official site. #results #punjab';

/* idempotent migration */
T.migrateV1(); T.migrateV1();
check('migrateV1 idempotent (flag set)', db.prepare("SELECT value FROM settings WHERE key='tpl.migrated.v1'").get()?.value === '1');

/* placeholders */
const ctx = T.makeCtx('Hello world line one #alpha\nmore', 'Raqq News');
check('ctx.title = first line', ctx.title === 'Hello world line one #alpha');
check('ctx.hashtags extracted', ctx.hashtags === '#alpha');
const filled = T.fillText('{title} — {source} · {date} {time} {hashtags} · {text}', ctx);
check('all 6 placeholders fill', filled.includes('Hello world line one') && filled.includes('Raqq News') && filled.includes('#alpha') && filled.includes('Hello world'));
const legacy = T.fillText('{{POST}} / {{DATE}}', ctx);
check('legacy POST filled', legacy.startsWith('Hello world'));
check('legacy DATE filled (no braces left)', !legacy.includes('{{DATE}}') && !legacy.includes('{{POST}}'));

/* apply: off */
T.saveInfo({ mode: 'off' });
let r = T.apply(SAMPLE, { sourceName: 'Raqq News' });
check('mode off → unchanged', r.text === SAMPLE && r.used === null);

/* apply: single + zones */
T.saveInfo({ zones: { header: '✦ {source} ✦', body: '*{title}*\n\n{text}\n\n{hashtags}', footer: '— {date}' }, mode: 'single', pick: 'custom' });
r = T.apply(SAMPLE, { sourceName: 'Raqq News' });
check('zone header filled', r.text.startsWith('✦ Raqq News ✦'));
check('zone body placeholders', r.text.includes('*Punjab Board result is out') && r.text.includes('#results #punjab'));
check('zone footer filled', /— \d{1,2} \w{3} \d{4}$/.test(r.text.trim()));
check('apply reports header/footer zones', r.header === '✦ Raqq News ✦' && r.footer.length > 0);
check('hasHashtagZone flag', r.hasHashtagZone === true);

/* pool: rotate restricted to ticked set */
T.setPool(['bold', 'stars']);
T.saveInfo({ mode: 'rotate', pick: 'bold' });
const usedSet = new Set();
for (let i = 0; i < 6; i++) usedSet.add(T.apply(SAMPLE).used);
check('rotate stays inside pool', [...usedSet].every((u) => ['Bold', 'Star frame'].includes(u)));
check('rotate actually rotates (2 used)', usedSet.size >= 2);
T.setPool([]);

/* style hint */
T.setStyle('stars', 'punchy, two lines');
T.saveInfo({ mode: 'single', pick: 'stars' });
check('styleHint in fixed mode', T.styleHint() === 'punchy, two lines');
T.saveInfo({ mode: 'rotate' });
check('styleHint empty in rotate', T.styleHint() === '');
T.setStyle('stars', '');

/* static samples */
const s1 = T.samples();
const s2 = T.samples();
check('20 built-in samples', s1.length >= 20 && s1.filter((s) => s.id !== 'custom').length === 20);
check('samples are static (repeat-equal)', JSON.stringify(s1) === JSON.stringify(s2));
check('sample after != before for a frame', s1.find((s) => s.id === 'stars').after.includes('✦'));
check('sample ctx fixed (15 Oct 2026)', s1.find((s) => s.id === 'date-stamp').after.includes('15 Oct 2026'));

/* zones with custom in list() */
T.saveInfo({ zones: { header: 'H', body: '{text}', footer: 'F' }, mode: 'single', pick: 'custom' });
const lst = T.list();
check('custom row has zones in list', lst.find((x) => x.id === 'custom').header === 'H');

/* history cap 5 */
for (let i = 0; i < 6; i++) T.saveInfo({ zones: { header: '', body: '{text} v' + i, footer: '' } });
check('history capped at 5', T.getHistory().length === 5);
check('history newest first', T.getHistory()[0].zones.body.includes('v5'));

/* zones validation */
let threw = false;
try { T.saveInfo({ zones: { header: '', body: 'no placeholder here', footer: '' } }); } catch { threw = true; }
check('body without {text} rejected', threw);

/* v7.5.0 plain-string custom still readable */
db.prepare("DELETE FROM settings WHERE key='power.template.custom'").run();
require(ROOT + '/src/db').S.set('power.template.custom', '✨ {{POST}} ✨');
const c = T.customZones();
check('v7.5.0 plain custom readable as body zone', c.body === '✨ {{POST}} ✨' && c.header === '');

/* cleanup */
for (const k of ['power.template.mode','power.template.pick','power.template.custom','power.template.rot','power.template.pool','power.template.history','tpl.migrated.v1','tpl.style.stars']) db.prepare('DELETE FROM settings WHERE key=?').run(k);

let pass = 0;
for (const [s, n] of results) { console.log(s, '-', n); if (s === 'PASS') pass++; }
console.log(`${pass}/${results.length} passed`);
process.exit(pass === results.length ? 0 : 1);
