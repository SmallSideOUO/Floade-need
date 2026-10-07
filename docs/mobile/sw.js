const CACHE = 'floade-mobile-v0.1.17'
const FILES = ['./', './index.html', './app.css', './app.js', './github.js', './store.js', './manifest.webmanifest', './icon.svg', './icon-192.png', './icon-512.png', './vendor/marked.umd.js', './vendor/purify.min.js']
self.addEventListener('install', event => { event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(FILES))) })
self.addEventListener('activate', event => { event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('floade-mobile-') && key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim())) })
// Cache only the public app shell. Private GitHub responses/credentials never enter HTTP caches.
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url)
  if (event.request.method !== 'GET' || url.origin !== self.location.origin || !url.pathname.startsWith(new URL(self.registration.scope).pathname)) return
  event.respondWith(fetch(event.request).then(response => {
    if (response.ok && FILES.some(file => new URL(file, self.registration.scope).pathname === url.pathname)) {
      const clone = response.clone(); event.waitUntil(caches.open(CACHE).then(cache => cache.put(event.request, clone)))
    }
    return response
  }).catch(async () => (await caches.match(event.request)) || (event.request.mode === 'navigate' ? caches.match('./index.html') : Response.error())))
})
