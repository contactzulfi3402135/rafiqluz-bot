/* Phase 2 — settings regroup: pure EJS markup move (zero JS edits).
   Reads src/web/views/dashboard.ejs, replaces the settings <section>
   (from `<section class="view" data-view="settings"` to the closing
   `</section>` right before the ABOUT comment) with the spec's 8-tab
   layout. Every existing card/field/id is preserved verbatim; only
   container membership changes. New elements are static (no state,
   no JS): mirror status row, pointer cards, 33-options index. */
const fs = require('fs');
const p = 'src/web/views/dashboard.ejs';
const lines = fs.readFileSync(p, 'utf8').split('\n');

// 1-based inclusive ranges of existing cards (from grep of current file)
const R = {
  branding:   [1362, 1367],
  dashboard:  [1368, 1398],
  chatFeat:   [1401, 1407],
  waCommand:  [1409, 1421],
  waReport:   [1423, 1429],
  postingSw:  [1433, 1436],
  autopilot:  [1437, 1450],
  pipeline:   [1453, 1469],
  aiProvider: [1472, 1497],
  aiPerFeat:  [1500, 1506],
  prompts:    [1509, 1520],
  glossary:   [1523, 1535],
  security:   [1538, 1557],
  apiKey:     [1560, 1566],
  backup:     [1569, 1582],
  cloud:      [1585, 1595],
  storage:    [1596, 1640],
  session:    [1643, 1649],
};
const blk = (k) => lines.slice(R[k][0] - 1, R[k][1]).join('\n');
// sanity: each block must start with a card div and end with </div>
for (const [k, b] of Object.entries({ blk: Object.keys(R).map(blk) })) { }
Object.entries(R).forEach(([k, b]) => {
  const t = lines.slice(b[0] - 1, b[1]).join('\n');
  if (!/^ {8}<div class="card/.test(t.split('\n')[0])) throw new Error('block start wrong: ' + k + ' -> ' + t.split('\n')[0]);
  if (!/^ {8}<\/div>$/.test(t.split('\n').pop())) throw new Error('block end wrong: ' + k + ' -> ' + JSON.stringify(t.split('\n').pop()));
});

// section boundaries
let start = lines.findIndex((l) => l.includes('<section class="view" data-view="settings"'));
if (start < 0) throw new Error('settings section not found');
// closing </section> = the line right before the ABOUT comment
const aboutIdx = lines.findIndex((l) => l.includes('SYSTEM · ABOUT'));
let end = -1;
for (let i = aboutIdx - 1; i > start; i--) { if (lines[i].trim() === '</section>') { end = i; break; } }
if (end < 0) throw new Error('settings section end not found');

const opts33 = [
  ['Publish pipeline', '#view=settings', [
    ['Scheduler', 'Publish queued posts at their scheduled time'],
    ['Smart dedupe', 'Skip near-duplicate posts within 12 hours'],
    ['Cross-source dedupe', 'Same story from 2+ sources in the window publishes once, with merged via-credits'],
    ['Split long posts', 'Posts over 4096 characters become numbered parts, media on part 1'],
    ['Polls to text', 'Publish channel polls as a text post (question + options) instead of skipping them'],
    ['Smart media checks', 'Before publish: media must match its kind and stay under the size caps (image 10 MB · video 40 MB · document 20 MB) — otherwise an honest skip, no compression'],
  ]],
  ['Formatting', '#view=branding', [
    ['AI beautify', 'AI cleans and titles every post (regex clean always on)'],
    ['Auto headers', 'Add a category header line (JOBS, NEWS…)'],
    ['Auto hashtags', 'Append #jobs #news style tags'],
    ['AI translate', 'Translate every post to your chosen language first'],
    ['TL;DR line', 'Long posts get a 1-line summary on top (AI — skipped automatically if AI is unavailable)'],
    ['Auto-bold key phrases', 'AI bolds the 1–3 most important phrases of every post with *asterisks*'],
    ['Emoji bullets', 'Bullet lines get rotating emoji bullets (deterministic, no AI)'],
    ['Signature (footer)', 'Append your signature/footer to every published post'],
    ['Link cleanup', 'Strip tracking params (utm_*, fbclid, gclid…) from URLs in the final post text — everything else stays untouched'],
  ]],
  ['AI Pilot', '#view=aipilot', [
    ['AI pilot', 'AI decides which posts are worth publishing'],
    ['Evergreen recycling', 'Re-share proven older text posts within a daily quota (rotation + rate guard)'],
    ['Auto-pilot', 'Hourly self-maintenance: retry failed items, never deletes, daily cap, panic stop kills it'],
  ]],
  ['Safety screen', '#view=guardrails', [
    ['AI safety screen', 'An AI criteria review of the FINAL text before routing — e.g. "no political content". Fail-open: if the AI is down the post publishes as usual'],
  ]],
  ['Reports & Digest', '#view=digest', [
    ['AI daily digest', 'Once a day, AI posts a summary of everything published'],
    ['Morning recap', 'Daily plain-text recap of yesterday (published/skipped/failed + up next) sent to your own number'],
    ['Weekly report', 'A plain-text week summary to your own number + email (if connected) on the day and time below'],
    ['Instant alerts', 'The moment something fails (post, WhatsApp, crash) you get a WhatsApp alert — 30-min cooldown per type'],
  ]],
  ['Replies', '#view=aireply', [
    ['AI auto-reply', 'AI answers personal WhatsApp messages for you (10-min per-chat limit)'],
    ['Voice transcription', 'Voice messages in your chats are turned into text (needs a Gemini key — Settings · AI)'],
    ['Knowledge-base replies', 'Stored question → answer pairs, sent exactly (no AI). Hours + allowlist below; empty allowlist = nobody'],
  ]],
  ['Approval queue', '#view=approvals', [
    ['Approval queue', 'Posts from "approve first" sources wait here for your OK; the delay buffer also waits here'],
  ]],
  ['History', '#view=posts', [
    ['Edit posts', 'Edit or delete already-published posts (experimental)'],
  ]],
  ['Routing', '#view=routing', [
    ['Smart routing', 'Per-target include / exclude / media rules'],
    ['Routing matrix', 'Apply the explicit source × target on/off grid (off = current mapping behavior)'],
  ]],
  ['Analytics', '#view=analytics', [
    ['Analytics', 'Per-day, per-source and failure counters'],
  ]],
  ['Library', '#view=media', [
    ['Announcement cards', 'Make a branded 1080×1080 PNG card (with SVG source) from any post — a manual tool, never auto-attached'],
  ]],
  ['WhatsApp command channel', '#view=settings', [
    ['WA command channel', 'Run the bot from your own WhatsApp number — status, approve, undo… (destructive needs the PIN)'],
  ]],
];
const optsCount = opts33.reduce((a, [, , rows]) => a + rows.length, 0);
if (optsCount !== 33) throw new Error('options index has ' + optsCount + ' rows, expected 33');
const optsHtml = opts33.map(([group, href, rows]) => `          <div class="opt-h">${group}</div>
${rows.map(([n, d]) => `          <div class="opt-row"><b>${n.replace(/"/g, '&quot;')}</b><span class="muted tiny">${d.replace(/"/g, '&quot;')}</span><a class="text-link" href="#${href}">Configure →</a></div>`).join('\n')}`).join('\n');

const nav = `          <nav class="set-nav settings-rail" id="setNav" aria-label="Settings sections">
      <button class="set-tab on" data-setgroup="general" role="tab" tabindex="0"><%- icon('globe','icon icon-sm') %><span class="lbl">General</span></button>
      <button class="set-tab" data-setgroup="whatsapp" role="tab" tabindex="0"><%- icon('chat','icon icon-sm') %><span class="lbl">WhatsApp</span></button>
      <button class="set-tab" data-setgroup="pacing" role="tab" tabindex="0"><%- icon('gauge','icon icon-sm') %><span class="lbl">Pacing</span></button>
      <button class="set-tab" data-setgroup="automation" role="tab" tabindex="0"><%- icon('zap','icon icon-sm') %><span class="lbl">Automation</span></button>
      <button class="set-tab" data-setgroup="ai" role="tab" tabindex="0"><%- icon('bot','icon icon-sm') %><span class="lbl">AI &amp; Rules</span></button>
      <button class="set-tab" data-setgroup="notifications" role="tab" tabindex="0"><%- icon('mail','icon icon-sm') %><span class="lbl">Notifications</span></button>
      <button class="set-tab" data-setgroup="data" role="tab" tabindex="0"><%- icon('database','icon icon-sm') %><span class="lbl">Storage</span></button>
      <button class="set-tab" data-setgroup="options" role="tab" tabindex="0"><%- icon('sliders','icon icon-sm') %><span class="lbl">33 Options</span></button>
          </nav>`;

const newSection = `      <section class="view" data-view="settings" hidden>
        <div class="ph"><div class="ph-l"><h2>Settings</h2><div class="ph-d">Everything the bot can be told — eight sections, one at a time. Every change saves with its own button on the spot. The WhatsApp mirror is always left exactly as WhatsApp renders it.</div></div></div>
        <div class="set-wrap">
          <!-- Reskin §7.5/§8: spec's eight tabs over the app's existing field cards.
               Tab wiring is attribute-generic (data-setgroup / data-sets), zero JS changes.
               Existing group keys kept where possible (general, whatsapp, automation, ai,
               data) so remembered tabs in localStorage keep resolving. -->
${nav}
          <div class="set-body" id="setBody">

      <div class="set-group on" data-setgroup="general">
${blk('branding')}
${blk('dashboard')}
${blk('security')}
${blk('apiKey')}
${blk('session')}
        <div class="set-footbar"><b>33 optional switches</b><span class="muted">— all off by default, each lives on its own screen. Full index:</span><a class="text-link" href="#view=settings">Open 33 Options →</a></div>
      </div>
      <div class="set-group" data-setgroup="whatsapp">
${blk('chatFeat')}
${blk('waCommand')}
        <div class="card cat">
          <div class="card-h"><%- icon('lock','icon') %> WhatsApp mirror <span class="pill ok">Locked</span></div>
          <div class="card-b"><p class="muted tiny f-help">The WhatsApp tab copies WhatsApp's own look — colors, layout, spacing. It is never themed, never re-skinned, and always stays left-to-right, exactly as WhatsApp renders it. Nothing below changes it.</p></div>
        </div>
      </div>
      <div class="set-group" data-setgroup="pacing">
${blk('pipeline')}
        <div class="card cat">
          <div class="card-h"><%- icon('gauge','icon') %> Where the rest of pacing lives</div>
          <div class="card-b">
            <p class="muted tiny f-help">The rate-guard cap, per-target rate caps, the 24-hour pacing visualizer and the freshness guard live on the <a class="text-link" href="#view=guardrails">Rules screen</a> — the delay buffer (minutes every post waits before publishing) lives on the <a class="text-link" href="#view=approvals">Queue screen</a>, and the delivery rate controller is shown on <a class="text-link" href="#view=home">Home</a>.</p>
          </div>
        </div>
      </div>
      <div class="set-group" data-setgroup="automation">
${blk('postingSw')}
${blk('autopilot')}
      </div>
      <div class="set-group" data-setgroup="ai">
${blk('aiProvider')}
${blk('aiPerFeat')}
${blk('prompts')}
${blk('glossary')}
        <div class="card cat">
          <div class="card-h"><%- icon('bot','icon') %> Where the rest of AI lives</div>
          <div class="card-b">
            <p class="muted tiny f-help">The AI pilot rule and evergreen / auto-pilot limits live on the <a class="text-link" href="#view=aipilot">AI Pilot screen</a> · auto-reply instruction and knowledge base on the <a class="text-link" href="#view=aireply">Auto-replies screen</a> · the AI safety-screen criteria on the <a class="text-link" href="#view=guardrails">Rules screen</a>.</p>
          </div>
        </div>
      </div>
      <div class="set-group" data-setgroup="notifications">
${blk('waReport')}
        <div class="card cat">
          <div class="card-h"><%- icon('mail','icon') %> Where the rest of notifications lives</div>
          <div class="card-b">
            <p class="muted tiny f-help">Daily digest, morning recap, weekly report and instant alerts — each with its own switch, time and test button — live together on the <a class="text-link" href="#view=digest">Reports &amp; Digest screen</a>. The bot has no separate email accounts to configure; email goes out only if a sender is already connected in the Email screen.</p>
          </div>
        </div>
      </div>
      <div class="set-group" data-setgroup="data">
${blk('backup')}
${blk('cloud')}
${blk('storage')}
      </div>
      <div class="set-group" data-setgroup="options">
        <div class="card">
          <div class="card-h"><%- icon('sliders','icon') %> All 33 optional switches <span class="pill num">33</span></div>
          <div class="card-b">
            <p class="muted tiny f-help" style="margin-bottom:12px">Every automation the bot can do, in one place — read-only here. Each switch keeps its own home screen (one home per switch), where it is turned on or off with its sub-settings. "Configure" jumps to that home. None of the 33 are on by default.</p>
            <div class="opt-index">
${optsHtml}
            </div>
          </div>
        </div>
      </div>

      </div>
        </div>
      </section>`;

const out = lines.slice(0, start).concat(newSection.split('\n')).concat(lines.slice(end + 1)).join('\n');
fs.writeFileSync(p, out);
console.log('settings section replaced: old lines', start + 1, '–', end + 1, '(removed ' + (end - start + 1) + ' lines, added ' + newSection.split('\n').length + ')');
