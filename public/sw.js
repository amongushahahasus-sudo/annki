const CACHE = 'akasheet-shell-v1';
const ROOT = new URL('./', self.location.href);
const ESSENTIAL = ['.', 'icon.svg', 'manifest.webmanifest', 'sample.pdf'].map(p => new URL(p, ROOT).href);
self.addEventListener('install', event => { event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ESSENTIAL))); });
self.addEventListener('activate', event => { event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('akasheet-shell-') && key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin || !request.url.startsWith(ROOT.href)) return;
  // OAuth callback codes and error details must not be written to the offline cache.
  const params = new URL(request.url).searchParams;
  if (['code', 'sb_flow_id', 'token_hash', 'access_token', 'refresh_token', 'error', 'error_code', 'error_description'].some(key => params.has(key))) return;
  event.respondWith(fetch(request).then(response => {
    if (response.ok && !request.headers.has('range')) { const copy = response.clone(); void caches.open(CACHE).then(cache => cache.put(request, copy)); }
    return response;
  }).catch(() => caches.match(request, { ignoreVary: true }).then(cached => cached || (request.mode === 'navigate' ? caches.match(ROOT.href, { ignoreVary: true }) : undefined)).then(response => response || new Response('オフラインです。接続してからもう一度お試しください。', { status: 503, headers: { 'Content-Type': 'text/plain;charset=utf-8' } }))));
});
