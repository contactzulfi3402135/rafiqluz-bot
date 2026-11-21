/* v7.6.0 — persist "replace-push" unit test (repo stays at 1 commit on bot-state).
   Spins up a mock GitHub API on 127.0.0.1 and runs persist.upload() against it:
   A) branch exists  → blob/tree/commit + force PUT on the ref, NO /contents calls
   B) branch missing → ref created via POST
   C) replace-push fails → falls back to classic Contents-API push (state still saved)
   Run: node test/persist-push.js
*/
const http = require('http');

const calls = [];
let scenario = 'A';

const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    const p = req.url.split('?')[0];
    calls.push(req.method + ' ' + p);
    const json = (o, code = 200) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
    if (p.endsWith('/git/blobs') && req.method === 'POST') {
      if (scenario === 'C') return json({ message: 'boom' }, 500);
      return json({ sha: 'BLOB1' });
    }
    if (p.endsWith('/git/trees') && req.method === 'POST') return json({ sha: 'TREE1' });
    if (p.endsWith('/git/commits') && req.method === 'POST') {
      const b = JSON.parse(body);
      if (b.parents && b.parents.length) return json({ message: 'must be a root commit' }, 400);
      return json({ sha: 'CMT1' });
    }
    if (p.endsWith('/git/ref/heads/bot-state')) return json({ object: { ref: 'refs/heads/bot-state' } });
    if (p.endsWith('/git/ref/bot-state')) return scenario === 'B' ? json({ message: 'Not Found' }, 404) : json({ object: { ref: 'refs/heads/bot-state' } });
    if (p.endsWith('/git/refs/bot-state')) {
      const b = JSON.parse(body);
      if (scenario === 'A') {
        if (req.method !== 'PUT' || b.force !== true || b.sha !== 'CMT1') return json({ message: 'bad replace' }, 400);
      }
      if (scenario === 'B' && req.method !== 'POST') return json({ message: 'expected POST create' }, 400);
      return json({ ref: 'refs/heads/bot-state', object: { sha: 'CMT1' } });
    }
    if (p.endsWith('/contents/bot-state.zip')) {
      if (req.method === 'GET') return json({ sha: 'OLD123' });
      return json({ content: { sha: 'NEW123' } });
    }
    return json({ message: 'unexpected ' + req.method + ' ' + p }, 404);
  });
});

const results = [];
const check = (n, ok) => results.push([ok ? 'PASS' : 'FAIL', n]);

(async () => {
  await new Promise((r) => server.listen(3987, '127.0.0.1', r));
  process.env.PERSIST_GITHUB_REPO = 'test/raqifluz-push-test';
  process.env.PERSIST_GITHUB_TOKEN = 'ghp_test';
  process.env.PERSIST_GITHUB_API = 'http://127.0.0.1:3987';
  const persist = require('../src/persist');

  /* A: replace-push, branch exists */
  calls.length = 0; scenario = 'A';
  const okA = await persist.upload();
  check('A: upload succeeds', okA === true);
  check('A: uses git-data API (blob+tree+commit)', calls.includes('POST /repos/test/raqifluz-push-test/git/blobs') && calls.some((c) => c.endsWith('/git/trees')) && calls.some((c) => c.endsWith('/git/commits')));
  check('A: ref force-updated (PUT)', calls.includes('PUT /repos/test/raqifluz-push-test/git/refs/bot-state'));
  check('A: no classic /contents push', !calls.some((c) => c.startsWith('PUT /repos/test/raqifluz-push-test/contents')));

  /* B: replace-push, branch missing → ref POST create */
  calls.length = 0; scenario = 'B';
  const okB = await persist.upload();
  check('B: upload succeeds with missing branch', okB === true);
  check('B: ref created via POST', calls.includes('POST /repos/test/raqifluz-push-test/git/refs/bot-state'));

  /* C: replace-push broken → classic fallback still saves */
  calls.length = 0; scenario = 'C';
  const okC = await persist.upload();
  check('C: fallback saves state via Contents API', okC === true && calls.some((c) => c.startsWith('PUT /repos/test/raqifluz-push-test/contents')));

  server.close();
  let pass = 0;
  for (const [s, n] of results) { console.log(s, '-', n); if (s === 'PASS') pass++; }
  console.log(`${pass}/${results.length} passed`);
  process.exit(pass === results.length ? 0 : 1);
})().catch((e) => { console.error('TEST CRASH:', e); process.exit(2); });
