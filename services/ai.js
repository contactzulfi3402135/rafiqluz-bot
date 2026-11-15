/* AI adapter — SIMULATION MODE (spec §1).
   To go live: replace rewrite()/suggestions() with your model provider calls. */
export const simAI = {
  init() {},
  rewrite(text) {
    const t = String(text || '').trim();
    if (!t) return 'Write something first and I will tighten it up.';
    const cleaned = t.replace(/\s+/g, ' ');
    return `${cleaned.charAt(0).toUpperCase() + cleaned.slice(1).replace(/[. ]+$/, '')}. — shared via Raqifluz`;
  },
  suggestions(db) {
    const srcs = db.sources.map((s) => s.name);
    const tgs = db.targets.map((t) => t.name);
    const pick = (a) => a[Math.floor(Math.random() * a.length)];
    return [
      { title: `Route “${pick(srcs)}” posts to ${pick(tgs)}`, reason: 'Topic overlap 92% — recipients usually engage with this pairing.' },
      { title: 'Hold weekend posts until Monday 09:00', reason: 'Weekend success rate is 11% lower than weekday average.' },
      { title: 'Add “#Tech” to posts from Tech News', reason: 'Posts with a consistent tag get 18% more reads in your targets.' },
      { title: `Split long posts from ${pick(srcs)} into 2`, reason: 'Posts over 400 words have a 3× skip rate in your targets.' },
    ];
  },
};
