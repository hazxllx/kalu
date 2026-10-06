/**
 * KALUSAGAP service worker (custom, injectManifest).
 *
 * Responsibilities:
 *   1. Precache the versioned application shell and build assets (the injected
 *      `self.__WB_MANIFEST` is produced by vite-plugin-pwa at build time, so a
 *      new build invalidates the previous precache).
 *   2. Serve the precached shell for offline SPA navigations, with a standalone
 *      `/offline.html` fallback when the shell is not yet cached.
 *   3. Cache same-origin static assets and web fonts.
 *   4. NEVER cache authenticated API traffic, Supabase auth/rest traffic, or any
 *      request that carries an Authorization header. Health records, tokens and
 *      private documents must always hit the network.
 *   5. Support a user-approved update flow via the SKIP_WAITING message.
 */
import { clientsClaim } from 'workbox-core';
import {
  cleanupOutdatedCaches,
  precacheAndRoute,
} from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';
import { CacheFirst, NetworkOnly, StaleWhileRevalidate } from 'workbox-strategies';
import { ExpirationPlugin } from 'workbox-expiration';
import { CacheableResponsePlugin } from 'workbox-cacheable-response';

// Bump these suffixes to invalidate the corresponding runtime caches. The
// precache manifest is already content-addressed per build, so only runtime
// caches need a manual version.
const STATIC_CACHE = 'kalusagap-static-v1';
const PAGES_CACHE = 'kalusagap-pages-v1';
const FONT_CACHE = 'kalusagap-fonts-v1';
const OFFLINE_URL = '/offline.html';

// The page posts this after the user accepts an available update.
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

clientsClaim();

// Drop precaches from earlier builds, then precache this build.
cleanupOutdatedCaches();
precacheAndRoute(self.__WB_MANIFEST || []);

/* ------------------------------------------------------------------ *
 * Never-cache category
 * ------------------------------------------------------------------ */

const isApiRequest = ({ url }) => url.pathname.startsWith('/api/');
const isSupabase = ({ url }) =>
  /(^|\.)supabase\.(co|in)$/.test(url.hostname) ||
  url.pathname.startsWith('/auth/v1') ||
  url.pathname.startsWith('/rest/v1');
const carriesAuth = ({ request }) => request.headers.has('Authorization');

registerRoute(isApiRequest, new NetworkOnly());
registerRoute(isSupabase, new NetworkOnly());
registerRoute(carriesAuth, new NetworkOnly());

/* ------------------------------------------------------------------ *
 * Offline navigation fallback
 * ------------------------------------------------------------------ */

// Network-first for navigations so the shell stays fresh; when the network is
// gone, serve the cached shell, and only then the standalone offline page.
const navigationHandler = {
  async handle({ request }) {
    try {
      const response = await fetch(request);
      if (response && response.ok) {
        const cache = await caches.open(PAGES_CACHE);
        await cache.put('/index.html', response.clone());
      }
      return response;
    } catch {
      const shell = await caches.match('/index.html');
      if (shell) return shell;
      const offline = await caches.match(OFFLINE_URL);
      return offline || Response.error();
    }
  },
};

registerRoute(
  new NavigationRoute(navigationHandler, {
    denylist: [/^\/api\//, /^\/offline\.html$/],
  }),
);

/* ------------------------------------------------------------------ *
 * Static assets + fonts
 * ------------------------------------------------------------------ */

registerRoute(
  ({ url, request }) =>
    url.origin === self.location.origin &&
    ['image', 'font', 'style', 'script'].includes(request.destination),
  new CacheFirst({
    cacheName: STATIC_CACHE,
    plugins: [
      new CacheableResponsePlugin({ statuses: [0, 200] }),
      new ExpirationPlugin({ maxEntries: 200, maxAgeSeconds: 60 * 60 * 24 * 30 }),
    ],
  }),
);

registerRoute(
  ({ url }) => url.origin === 'https://fonts.gstatic.com',
  new CacheFirst({
    cacheName: FONT_CACHE,
    plugins: [
      new CacheableResponsePlugin({ statuses: [0, 200] }),
      new ExpirationPlugin({ maxEntries: 30, maxAgeSeconds: 60 * 60 * 24 * 365 }),
    ],
  }),
);

registerRoute(
  ({ url }) => url.origin === 'https://fonts.googleapis.com',
  new StaleWhileRevalidate({
    cacheName: FONT_CACHE,
    plugins: [
      new CacheableResponsePlugin({ statuses: [0, 200] }),
      new ExpirationPlugin({ maxEntries: 30, maxAgeSeconds: 60 * 60 * 24 * 365 }),
    ],
  }),
);
