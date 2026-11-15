import { store } from './store.js';
import { simTelegram, simWhatsApp } from '../services/index.js';

const M = 60_000;
let timer = null;

/* Live simulation (spec §1): activity every 20–40s, counters tick. */
export function startSim(db) {
  const tick = () => {
    try {
      if (db.settings.botPaused) {
        if (timer) clearTimeout(timer);
        timer = setTimeout(tick, 45_000);
        return;
      }
      const r = Math.random();
      if (r < 0.5) {
        /* a source feed detected a post */
        const det = simTelegram.detectPost();
        db.recentActivity.unshift({ id: Date.now(), msg: `New post from “${det.source.name}”`, at: Date.now(), ok: true, icon: 'radio' });
        db.recentActivity.length = Math.min(db.recentActivity.length, 20);
        store.log('info', `Source “${det.source.name}” synced — 1 new post detected`, { source: det.source.name });
        if (Math.random() < 0.3) {
          db.queue.unshift({
            id: (db.queue.at(-1)?.id || 0) + 1,
            title: det.text.slice(0, 46) + (det.text.length > 46 ? '…' : ''),
            source: det.source.name,
            type: Math.random() < 0.3 ? 'image' : 'text',
            status: 'pending', at: Date.now(),
            targets: 4 + Math.floor(Math.random() * 12), note: '',
          });
          db.notifications.unread += 1;
          store.log('info', `Queue +1 pending: ${det.text.slice(0, 40)}`, { source: det.source.name });
        }
      } else if (r < 0.8) {
        /* pacing engine published a small batch */
        const n = 2 + Math.floor(Math.random() * 5);
        const t = 44 + Math.floor(Math.random() * 6);
        db.analytics.stats['7d'].published += n;
        db.recentActivity.unshift({ id: Date.now(), msg: `Published ${n} posts to ${t} targets`, at: Date.now(), ok: true, icon: 'send' });
        db.recentActivity.length = Math.min(db.recentActivity.length, 20);
        simWhatsApp.line(`Published ${n} posts to ${t} targets (paced)`);
        store.log('info', `Pacing: published ${n} posts to ${t} targets`);
      } else {
        /* minor warning */
        const warns = ['Target hit flood wait (1.9s)', '1 post held by min-score rule', 'Telegram sync slow (210ms) — OK'];
        const w = warns[Math.floor(Math.random() * warns.length)];
        db.recentActivity.unshift({ id: Date.now(), msg: w, at: Date.now(), ok: false, icon: 'alertTriangle' });
        db.recentActivity.length = Math.min(db.recentActivity.length, 20);
        store.log('warn', w);
      }
      store.save();
    } catch (e) {
      console.error('sim tick failed:', e.message);
    }
    timer = setTimeout(tick, 20_000 + Math.random() * 20_000);
  };
  timer = setTimeout(tick, 25_000);
}
