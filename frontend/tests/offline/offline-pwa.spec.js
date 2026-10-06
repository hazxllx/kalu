import { test, expect } from '@playwright/test';

/**
 * Production-build PWA / offline verification.
 *
 * These tests exercise the REAL service worker (`src/sw.js`) from `dist/` served
 * by `vite preview`. They do not require Supabase or an authenticated session —
 * they cover the parts of the offline milestone that do not depend on a live
 * database: SW registration, the precached app shell, the offline navigation
 * fallback, the standalone offline page, and the rule that API / authorized
 * requests are never cached.
 */

const waitForController = (page) =>
  page.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 15_000 });

test.describe('KALUSAGAP PWA offline behavior (production build)', () => {
  test('registers the service worker and serves a valid manifest', async ({ page }) => {
    await page.goto('/login');

    const manifestHref = await page.getAttribute('link[rel="manifest"]', 'href');
    expect(manifestHref, 'a web app manifest link is present').toBeTruthy();

    const manifest = await page.evaluate(async (href) => {
      const res = await fetch(href, { cache: 'no-store' });
      return { status: res.status, body: await res.json() };
    }, manifestHref);
    expect(manifest.status).toBe(200);
    expect(manifest.body.name).toContain('KALUSAGAP');
    expect(manifest.body.display).toBe('standalone');

    const sw = await page.evaluate(async () => {
      const reg = await navigator.serviceWorker.ready;
      return { scope: reg.scope, active: !!reg.active };
    });
    expect(sw.active).toBe(true);
    expect(sw.scope).toContain('/');
  });

  test('serves the cached app shell for an offline deep-link navigation', async ({ page, context }) => {
    await page.goto('/login');
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.reload();
    await waitForController(page);

    await context.setOffline(true);
    // A deep SPA route that was never fetched directly must fall back to the
    // precached shell (not the browser's own error page).
    await page.goto('/app/bhw/dashboard', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('body')).toBeVisible();
    const hasAppRoot = await page.evaluate(() => !!document.querySelector('#root'));
    expect(hasAppRoot, 'the SPA shell (#root) is rendered while offline').toBe(true);
  });

  test('serves the standalone offline fallback page when offline', async ({ page, context }) => {
    // The fallback page is a plain static file that does not register a service
    // worker itself, so establish the SW from the app first.
    await page.goto('/login');
    await waitForController(page);
    await page.goto('/offline.html', { waitUntil: 'domcontentloaded' });
    await context.setOffline(true);
    await page.goto('/offline.html', { waitUntil: 'domcontentloaded' });
    await expect(page.getByText('You are offline')).toBeVisible();
  });

  test('never caches API requests or requests carrying an Authorization header', async ({ page }) => {
    await page.goto('/login');
    await page.evaluate(() => navigator.serviceWorker.ready);
    await waitForController(page);

    const result = await page.evaluate(async () => {
      const origin = location.origin;
      // Same-origin API base in this build (VITE_API_URL=/api) => NetworkOnly.
      await fetch('/api/health').catch(() => {});
      // Any request with an Authorization header is NetworkOnly.
      await fetch('/api/secure-probe', {
        headers: { Authorization: 'Bearer probe' },
      }).catch(() => {});
      const cacheNames = await caches.keys();
      const hitApi = !!(await caches.match(origin + '/api/health'));
      const hitAuth = !!(await caches.match(origin + '/api/secure-probe'));
      return { hitApi, hitAuth, cacheNames };
    });

    expect(result.hitApi, 'API response is not cached').toBe(false);
    expect(result.hitAuth, 'authorized response is not cached').toBe(false);
    expect(
      result.cacheNames.some((name) => /precache/i.test(name)),
      'the app shell precache exists, so caching is active',
    ).toBe(true);
  });
});
