/*
 * traction's service worker — its only job is making the app open with no signal.
 *
 * The data layer already survives offline (state is localStorage-first and syncs
 * to Supabase on a debounce), so the gap this closes is the app *shell*: without
 * a worker, a phone in a backyard with no bars gets a blank page instead of the
 * timer.
 *
 * Strategy is deliberately split:
 *   - navigations   → network-first, cache fallback. A deploy is picked up on the
 *                     next online load; being offline falls back to the last
 *                     known-good page.
 *   - build assets  → cache-first. Vite fingerprints these filenames, so a given
 *                     URL's bytes never change and serving from cache is always
 *                     correct (and instant).
 *   - anything else → straight to the network, uncached. Supabase reads/writes
 *                     and signed Storage URLs must never be answered from a cache.
 */

const CACHE = 'traction-v1'
const SHELL = './index.html'

self.addEventListener('install', event => {
  // Warm the shell so the very first offline launch works even if the user never
  // navigated again after installing.
  event.waitUntil(
    caches.open(CACHE)
      .then(c => c.add(new Request(SHELL, { cache: 'reload' })))
      .catch(() => {/* a failed prewarm must not block activation */})
      .then(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim()),
  )
})

/** Vite emits fingerprinted files under assets/ — same URL always means same bytes. */
function isBuildAsset(url) {
  return url.origin === self.location.origin && url.pathname.includes('/assets/')
}

/** Icons and the manifest: same-origin, rarely change, fine to serve stale-then-refresh. */
function isStaticExtra(url) {
  return url.origin === self.location.origin
    && /\.(png|svg|ico|webmanifest)$/.test(url.pathname)
}

self.addEventListener('fetch', event => {
  const { request } = event
  // Only GET is cacheable, and a cross-origin API call is never ours to answer.
  if (request.method !== 'GET') return

  const url = new URL(request.url)

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then(res => {
          const copy = res.clone()
          caches.open(CACHE).then(c => c.put(SHELL, copy)).catch(() => {})
          return res
        })
        .catch(async () => (await caches.match(SHELL)) ?? Response.error()),
    )
    return
  }

  if (isBuildAsset(url) || isStaticExtra(url)) {
    event.respondWith(
      caches.match(request).then(hit => {
        if (hit) return hit
        return fetch(request).then(res => {
          // Only store complete, same-origin successes — an opaque or partial
          // response cached here would be served back as a broken asset forever.
          if (res.ok && res.type === 'basic') {
            const copy = res.clone()
            caches.open(CACHE).then(c => c.put(request, copy)).catch(() => {})
          }
          return res
        })
      }),
    )
  }
})
