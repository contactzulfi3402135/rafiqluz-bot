/* Telegram adapter — SIMULATION MODE (spec §1).
   To go live: replace detectPost()/status() with real Telegram Bot API calls. */
export const simTelegram = {
  _db: null,
  init(db) { this._db = db; },
  status() { return { connected: true, mode: 'simulation', channels: this._db.sources.length }; },
  detectPost() {
    const s = this._db.sources.filter((x) => x.status === 'active');
    const src = s[Math.floor(Math.random() * s.length)] || this._db.sources[0];
    const samples = [
      'New release notes are out — read the full breakdown',
      'Why every team is adopting this workflow this quarter',
      'A practical guide to scaling content pipelines',
      'Five patterns we keep seeing in top-performing channels',
      'Deep dive: how the new API changes integration work',
      'Community picks: the week’s most-shared updates',
    ];
    return { source: src, text: samples[Math.floor(Math.random() * samples.length)], at: Date.now() };
  },
};
