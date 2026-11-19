// Uses only loopback. Every external browser request is intercepted and aborted.
// No accounts, backend responses, application data, or production services are used.
import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { createServer } from 'vite';
import { loadLocalEnvironment } from '../../config/localDevelopment.js';
import { fileURLToPath } from 'node:url';

const frontend = fileURLToPath(new URL('../../', import.meta.url));
const env = loadLocalEnvironment('development', frontend);
if (env.VITE_SUPABASE_ANON_KEY) {
  throw new Error('Run this no-service browser smoke with the blank-key local template before configuring local auth.');
}
let browser;
let server;
try {
  server = await createServer({ root: frontend, mode: 'development', server: { open: false } });
  await server.listen();
  for (const path of ['/.env', '/.env.production', '/.env.development']) {
    const response = await fetch(`${env.VITE_APP_BASE_URL}${path}`);
    assert.equal(response.status, 403, 'environment files must never be served to the browser');
  }
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ serviceWorkers: 'block' });
  const external = [];
  const errors = [];
  const allowedOrigins = new Set([
    new URL(env.VITE_APP_BASE_URL).origin,
    new URL(env.VITE_API_URL).origin,
    ...(env.VITE_SUPABASE_URL ? [new URL(env.VITE_SUPABASE_URL).origin] : []),
  ]);
  await context.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (allowedOrigins.has(url.origin)) return route.continue();
    external.push(url.origin);
    return route.abort('blockedbyclient');
  });
  const page = await context.newPage();
  page.setDefaultNavigationTimeout(90_000);
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(() => {
    window.localCspViolations = [];
    document.addEventListener('securitypolicyviolation', (event) => {
      window.localCspViolations.push({ directive: event.effectiveDirective, blocked: event.blockedURI });
    });
  });
  const response = await page.goto(env.VITE_APP_BASE_URL, { waitUntil: 'networkidle' });
  assert.match(response.headers()['content-security-policy'], /frame-src 'self' blob:/);
  await page.getByText('DEVELOPMENT ENVIRONMENT', { exact: true }).waitFor();
  assert.deepEqual(await page.evaluate(() => window.localCspViolations), []);
  await page.goto(`${env.VITE_APP_BASE_URL}/login`, { waitUntil: 'networkidle' });
  await page.getByText('DEVELOPMENT ENVIRONMENT', { exact: true }).waitFor();
  assert.equal(await page.evaluate(async () => (await import('/src/lib/supabase.js')).supabase), null);
  assert.deepEqual(errors, []);
  assert.deepEqual(external, [], 'normal app startup must not attempt any external request');

  // Preserve the existing local attachment/PDF preview capability.
  await page.evaluate(() => {
    const frame = document.createElement('iframe');
    frame.id = 'local-preview-probe';
    frame.src = URL.createObjectURL(new Blob(['<p>Local preview probe</p>'], { type: 'text/html' }));
    document.body.append(frame);
  });
  await page.frameLocator('#local-preview-probe').getByText('Local preview probe', { exact: true }).waitFor();
  assert.deepEqual(await page.evaluate(() => window.localCspViolations), []);

  await page.evaluate(async () => {
    await fetch('https://production.example.test/api/safety-probe').catch(() => {});
    const image = new Image();
    image.src = 'https://production.example.test/safety-probe.png';
    const frame = document.createElement('iframe');
    frame.src = 'https://production.example.test/safety-probe';
    document.body.append(frame);
  });
  await page.waitForFunction(() => ['connect-src', 'img-src', 'frame-src'].every((directive) =>
    window.localCspViolations.some((event) => event.directive === directive)));
  assert.deepEqual(external, [], 'CSP must block hosted probes before browser network routing');

  // Check the documented map exception without making a public network request.
  await page.evaluate(() => fetch('https://tiles.openfreemap.org/styles/positron').catch(() => {}));
  assert.deepEqual(external, ['https://tiles.openfreemap.org']);
  assert.deepEqual(errors, []);
  console.log('PASS: landing/login render, local-only startup, blank auth unavailable, hosted fetch/image/frame blocked, intentional map exception intercepted.');
} finally {
  await browser?.close();
  await server?.close();
}
