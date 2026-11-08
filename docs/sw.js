// A small network-first service worker. The network always wins when it answers, so a new version is never
// pinned out; the cache only answers when the network can't, so the site still opens offline.

const CACHE = 'daybook-v1';

/** How long the network gets before the cache answers instead, so one bar of signal doesn't mean a blank page. */
const PATIENCE_MS = 3000;

const SHELL = [
  './',
  'style.css',
  'manifest.webmanifest',
  'icons/favicon.svg',
  'icons/icon-180.png',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'js/app.js',
  'js/backup.js',
  'js/calendar-day.js',
  'js/calendar-state.js',
  'js/calendar-view.js',
  'js/demo.js',
  'js/dialogs.js',
  'js/dom.js',
  'js/event-editor.js',
  'js/events.js',
  'js/format.js',
  'js/gesture.js',
  'js/grid.js',
  'js/motion.js',
  'js/notices.js',
  'js/schema.js',
  'js/sheet.js',
  'js/store.js',
  'js/swipe.js',
  'js/task-editor.js',
  'js/tasks.js',
  'js/toast.js',
  'js/todo-view.js',
  'js/wording.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      await cache.addAll(SHELL.map((path) => new Request(path, { cache: 'reload' })));
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(names.filter((name) => name !== CACHE).map((name) => caches.delete(name)));
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;
  const network = fetch(request);
  event.waitUntil(remember(request, network));
  event.respondWith(answer(request, network));
});

/** Keeps a copy of what the network sends. Whatever goes wrong here stays here: the page has its answer regardless. */
async function remember(request, network) {
  try {
    const response = await network;
    if (!response.ok) return;
    const copy = response.clone(); // Straight away, before the page starts reading the original.
    const cache = await caches.open(CACHE);
    await cache.put(request, copy);
  } catch {
    // Offline, out of quota, or the cache is broken. The next visit tries again.
  }
}

async function answer(request, network) {
  const patience = new Promise((resolve) => {
    setTimeout(resolve, PATIENCE_MS, null);
  });
  const response = await Promise.race([network.catch(() => null), patience]);
  if (response) return response;
  // It failed or it's taking too long. With no copy to show, the network is all there is, however long it takes.
  return (await fromCache(request)) ?? network;
}

async function fromCache(request) {
  try {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(request, { ignoreSearch: true });
    if (cached) return cached;
    return request.mode === 'navigate' ? await cache.match('./') : undefined;
  } catch {
    return undefined;
  }
}
