import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const DATA_DIR = path.join(__dirname, '..', 'data');
export const DB_FILE = path.join(DATA_DIR, 'db.json');

let cache = null;
let saveTimer = null;

export const store = {
  load() {
    if (cache) return cache;
    cache = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    return cache;
  },
  reset(obj) { cache = obj; this.saveNow(); },
  /* collections */
  get(name) { return (this.load()[name] ??= []); },
  find(name, pred) { return this.get(name).find(pred); },
  filter(name, pred) { return this.get(name).filter(pred); },
  insert(name, row) {
    const r = { id: (this.get(name).at(-1)?.id || 0) + 1, ...row };
    this.get(name).push(r);
    return r;
  },
  update(name, id, patch) {
    const row = this.find(name, (x) => x.id === id);
    if (!row) return null;
    Object.assign(row, patch);
    return row;
  },
  remove(name, id) {
    const list = this.get(name);
    const i = list.findIndex((x) => x.id === id);
    if (i >= 0) list.splice(i, 1);
    return i >= 0;
  },
  /* audit */
  audit(action, target = '', actor = 'Admin') {
    this.insert('audit', { action, target, actor, at: Date.now() });
  },
  log(level, msg, extra = {}) {
    this.insert('logs', { level, msg, at: Date.now(), ...extra });
    if (this.get('logs').length > 400) this.get('logs').splice(0, this.get('logs').length - 400);
  },
  /* debounced write to data/db.json */
  save() {
    if (saveTimer) return;
    saveTimer = setTimeout(() => { saveTimer = null; this.saveNow(); }, 300);
  },
  saveNow() {
    if (!cache) return;
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const tmp = DB_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(cache, null, 1));
    fs.renameSync(tmp, DB_FILE);
  },
};
