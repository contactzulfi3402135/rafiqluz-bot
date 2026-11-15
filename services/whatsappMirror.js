/* WhatsApp mirror adapter — SIMULATION MODE (spec §1).
   The mirror is a LOCKED CORE module: it records every bot action.
   To go live: point line() at the real WhatsApp bridge. */
export const simWhatsApp = {
  _db: null,
  init(db) { this._db = db; },
  line(text) {
    this._db.mirror.unshift({ at: Date.now(), text });
    if (this._db.mirror.length > 24) this._db.mirror.pop();
    return this._db.mirror[0];
  },
  reply(cmd) {
    const c = String(cmd).trim().toLowerCase();
    const m = this._db.settings;
    switch (c) {
      case 'status': return `Raqifluz is ${this._db.paused ? 'PAUSED (Panic Stop active)' : 'online'} · ${this._db.sources.length} sources · ${this._db.targets.length} targets · queue ${this._db.queue.filter((q) => q.status === 'pending').length} pending`;
      case 'pause': this._db.paused = true; return 'Paused. Publishing stopped — no posts will go out until you resume.';
      case 'resume': this._db.paused = false; return 'Resumed. Queued posts continue from where they stopped.';
      case 'approve all': return 'Approved all pending posts. They are scheduled with smart pacing.';
      case 'report': return `Daily report: 742 posts today · success 98.7% · avg latency 1.8s · queue ${this._db.queue.filter((q) => q.status === 'pending').length} pending.`;
      case 'health': return `Health ${this._db.health?.score ?? 98}/100 — all 8 checks pass. Storage 62% used.`;
      default: return 'Unknown command. Try: status, pause, resume, approve all, report, health.';
    }
  },
};
