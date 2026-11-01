// The app works with no network: its pages and the planning core are kept
// here, so everything except the AI keeps running.
const CACHE = 'mesocycle-v6';
const CORE = ['planner', 'invariants', 'tools', 'week-tools', 'setup', 'sample', 'demo-state', 'handlers', 'radar', 'diff', 'tradeoff', 'ics'].map((f) => `/core/${f}.js`);
const SHELL = ['/', '/css/app.css', '/js/app.js', '/js/strings.js', '/js/audio.js', '/icon.svg', '/icon-192.png', '/manifest.webmanifest', '/privacy', '/terms', '/huong-dan', '/core/replay-en.json', '/core/replay-vi.json', '/sample-syllabus.pdf', ...CORE];
const PATIENCE_MS = 1500;

self.addEventListener('install', (e) => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)));
});

self.addEventListener('activate', (e) => e.waitUntil((async () => {
  for (const name of await caches.keys()) if (name !== CACHE) await caches.delete(name);
  await self.clients.claim();
})()));

// The network first, so a new version shows at once. But a weak connection does
// not hold the app hostage: after a moment the saved copy answers, and the
// network still refreshes it for next time.
async function fresh(request) {
  const saved = () => caches.match(request, { ignoreSearch: true });
  const network = fetch(request).then((r) => {
    if (r.ok) { const copy = r.clone(); caches.open(CACHE).then((c) => c.put(request, copy)); }
    return r;
  });
  const slow = new Promise((done) => { setTimeout(done, PATIENCE_MS); }).then(saved);
  const first = await Promise.race([network.catch(() => null), slow]);
  return first || (await saved()) || network;
}

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/')) return;
  e.respondWith(fresh(e.request));
});

// Reminders: the push carries no content, so the sentence is fixed here.
self.addEventListener('push', (e) => e.waitUntil(self.registration.showNotification('Mesocycle', {
  body: 'Tới giờ việc tiếp theo. Time for your next block.', icon: '/icon-192.png', tag: 'next-block',
})));
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: 'window' }).then((list) => (list[0] ? list[0].focus() : self.clients.openWindow('/'))));
});
