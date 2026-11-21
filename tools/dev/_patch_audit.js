// one-off: v2 overflow audit (skip content clipped by a fitting scrollable ancestor)
const fs = require('fs');
let s = fs.readFileSync('_shot_test.js', 'utf8');
const old = [
  "          if (r.right > vw + 2 && st.overflowX !== 'auto' && st.overflowX !== 'scroll') {",
  "            const cls = (el.className && el.className.baseVal !== undefined) ? el.className.baseVal : (el.className || '');",
  "            if (out.bad.length < 12) out.bad.push(`${el.tagName}.${String(cls).slice(0, 60)} right=${Math.round(r.right)}`);",
  "          }"
].join("\n");
const nw = [
  "          if (r.right > vw + 2) {",
  "            const cls = (el.className && el.className.baseVal !== undefined) ? el.className.baseVal : (el.className || '');",
  "            if (st.position === 'fixed' || st.position === 'sticky') {",
  "              if (out.bad.length < 12) out.bad.push(`${el.tagName}.${String(cls).slice(0, 60)} right=${Math.round(r.right)} (fixed/sticky)`);",
  "              return;",
  "            }",
  "            let inScroller = false, anc = el.parentElement;",
  "            while (anc && anc !== document.body) {",
  "              const ox = getComputedStyle(anc).overflowX;",
  "              if ((ox === 'auto' || ox === 'scroll') && anc.getBoundingClientRect().right <= vw + 2) { inScroller = true; break; }",
  "              anc = anc.parentElement;",
  "            }",
  "            if (!inScroller && out.bad.length < 12) out.bad.push(`${el.tagName}.${String(cls).slice(0, 60)} right=${Math.round(r.right)}`);",
  "          }"
].join("\n");
if (!s.includes(old)) throw new Error('anchor not found');
s = s.replace(old, nw);
fs.writeFileSync('_shot_test.js', s);
console.log('audit v2 in');
