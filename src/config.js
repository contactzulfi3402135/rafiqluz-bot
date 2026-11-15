'use strict';
/**
 * v6.0.0 — configuration, paths, defaults.
 * Every value can be overridden by env (Heroku Config Vars / .env).
 */
const path = require('path');
const fs = require('fs');
const dotenv = require('dotenv');

const ROOT = path.resolve(__dirname, '..');
dotenv.config({ path: path.join(ROOT, '.env') }); // env vars ALWAYS win (Heroku sets real PORT)

const env = (k, f = '') => (process.env[k] != null && process.env[k] !== '' ? process.env[k] : f);
const envInt = (k, f) => { const n = parseInt(process.env[k] || '', 10); return Number.isFinite(n) ? n : f; };

const PATHS = {
  sessions: path.join(ROOT, env('SESSION_DIR', 'sessions')),
  database: path.join(ROOT, env('DATABASE_PATH', 'data/bot.sqlite')),
  media: path.join(ROOT, 'media'),
  backups: path.join(ROOT, 'backups'),
  logs: path.join(ROOT, 'logs')
};

const config = {
  version: '9.1.0',
  botName: env('BOT_NAME', 'Raqifluz Channel Bot'),
  root: ROOT,
  paths: PATHS,

  whatsapp: {
    sessionName: env('SESSION_NAME', 'main'),
    browserName: 'RaqifluzBot', // the proven Ubuntu/Chrome web identity — do NOT change (v5.7.1 lesson)
    pollSec: envInt('CHANNEL_POLL_SEC', 180),      // follow verification + PULL safety-net cadence
    pullSec: envInt('SOURCE_PULL_SEC', 30),        // v6.4: pull safety-net cadence (was 180 — now a fast backup to live push)
    nightStart: envInt('NIGHT_START_MIN', 0),      // 00:00 PKT
    nightEnd: envInt('NIGHT_END_MIN', 240),        // 04:00 PKT
    maxNumbers: envInt('NUMBERS_MAX', 5)           // v7: main + extra numbers (each costs ~40 MB RAM)
  },

  dashboard: {
    port: envInt('PORT', envInt('SERVER_PORT', 20249)),
    username: env('DASHBOARD_USERNAME', 'admin'),
    password: env('DASHBOARD_PASSWORD', ''),
    sessionSecret: env('SESSION_SECRET', 'change-me'),
    publicUrl: env('PUBLIC_URL', env('RENDER_EXTERNAL_URL', '')).replace(/\/+$/, '')
  },

  persist: {
    repo: env('PERSIST_GITHUB_REPO', ''),
    token: env('PERSIST_GITHUB_TOKEN', ''),
    branch: env('PERSIST_GITHUB_BRANCH', 'bot-state'),
    intervalMin: Math.max(3, envInt('PERSIST_INTERVAL_MIN', 10)),
    api: env('PERSIST_GITHUB_API', 'https://api.github.com')
  },

  ai: {
    provider: env('AI_PROVIDER', 'openrouter').toLowerCase(),
    openrouterKey: env('OPENROUTER_API_KEY', env('GEMINI_API_KEY', '')),
    model: env('AI_MODEL', 'meta-llama/llama-3.3-70b-instruct:free') // free default — $0 balance works
  },

  memWarnMb: Math.max(128, envInt('MEM_WARN_MB', 440)), // Heroku 512 MB plan
  tunnel: env('ENABLE_TUNNEL', '') === '1',
  reportAt: env('REPORT_AT', '21:00') // PKT — daily WhatsApp report time
};

function ensureDirs() {
  const dirs = [PATHS.sessions, path.dirname(PATHS.database), PATHS.media, PATHS.backups, PATHS.logs];
  for (const d of dirs) {
    try { fs.mkdirSync(d, { recursive: true }); } catch { /* best effort */ }
  }
}

module.exports = { config, ensureDirs, env, envInt };
