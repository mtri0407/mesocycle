// The app works with no network: its pages and the planning core are kept
// here, so everything except the AI keeps running.
const CACHE = 'mesocycle-v3';
const CORE = ['planner', 'invariants', 'tools', 'week-tools', 'setup', 'sample', 'demo-state', 'handlers', 'radar', 'diff'].map((f) => `/core/${f}.js`);
const SHELL = ['/', '/icon.svg', '/manifest.webmanifest', '/privacy', '/huong-dan', ...CORE];

self.addEventListener('install', (e) => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)));
});

self.addEventListener('activate', (e) => e.waitUntil((async () => {
  for (const name of await caches.keys()) if (name !== CACHE) await caches.delete(name);
  await self.clients.claim();
})()));

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/')) return;
  // Network first, so a new version shows at once; the copy is for offline.
  e.respondWith(fetch(e.request)
    .then((r) => { const copy = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); return r; })
    .catch(() => caches.match(e.request, { ignoreSearch: true })));
});

// Reminders: the push carries no content, so the sentence is fixed here.
self.addEventListener('push', (e) => e.waitUntil(self.registration.showNotification('Mesocycle', {
  body: 'Tới giờ việc tiếp theo. Time for your next block.', icon: '/icon.svg', tag: 'next-block',
})));
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: 'window' }).then((list) => (list[0] ? list[0].focus() : self.clients.openWindow('/'))));
});
