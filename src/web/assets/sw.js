/* 5G (R83): Raqifluz PWA service worker — deliberately small and safe.
   • Static shell (this file, the app JS/CSS, icons, manifest): cache-first,
     so the console loads even on a flaky connection and updates on deploy.
   • Everything under /api, /media, /login, /admin, /events, /connect:
     network-only — the dashboard is LIVE data; caching it would lie to the
     owner. Offline, the shell opens and says the network is down. */
'use strict';
const VERSION = 'raqifluz-editor-v7';
const SHELL = '/sw.js';
const STATIC = ['/manifest.webmanifest', '/app.js', '/app.css', '/pwa/icon-192.png', '/pwa/icon-512.png'];

self.addEventListener('install', (ev) => {
  ev.waitUntil(caches.open(VERSION).then((c) => c.addAll([SHELL, ...STATIC])).catch(() => { })).then(() => self.skipWaiting());
});

self.addEventListener('activate', (ev) => {
  ev.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (ev) => {
  const url = new URL(ev.request.url);
  if (ev.request.method !== 'GET') return; // POSTs (all real actions) always hit the network
  const isApi = url.pathname.startsWith('/api/') || url.pathname.startsWith('/media/') ||
    ['/admin', '/connect', '/login', '/events', '/logout', '/status', '/healthz', '/'].includes(url.pathname);
  if (isApi) return; // network-only — live data is never served stale
  ev.respondWith(
    fetch(ev.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(VERSION).then((c) => c.put(ev.request, copy)).catch(() => { });
        return res;
      })
      .catch(() => caches.match(ev.request))
  );
});
