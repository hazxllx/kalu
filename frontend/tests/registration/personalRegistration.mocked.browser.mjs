import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import { chromium, expect } from '@playwright/test';

// Explicit runner: node --test tests/registration/personalRegistration.mocked.browser.mjs
// Auth, API, SMTP failures and OTP responses are browser-boundary mocks.
const root = fileURLToPath(new URL('../../', import.meta.url));
const authOrigin = 'http://127.0.0.1:54399';
const email = 'browser-test@example.invalid';
const password = 'BrowserTest42!';
const user = {
  id: '11111111-1111-4111-8111-111111111111', email,
  aud: 'authenticated', role: 'authenticated',
  identities: [{ id: 'mock-identity', provider: 'email' }],
  app_metadata: { provider: 'email', providers: ['email'] }, user_metadata: {},
  created_at: '2026-01-01T00:00:00Z',
};
let server;
let browser;
let origin;
const savedEnv = {};

before(async () => {
  const fakeKey = `${Buffer.from('{"alg":"HS256","typ":"JWT"}').toString('base64url')}.${Buffer.from('{"role":"anon","iss":"supabase-demo"}').toString('base64url')}.mock-signature`;
  const overrides = {
    VITE_APP_BASE_URL: 'http://127.0.0.1:4197',
    VITE_API_URL: 'http://127.0.0.1:4197/api',
    VITE_SUPABASE_URL: authOrigin,
    VITE_SUPABASE_ANON_KEY: fakeKey,
  };
  for (const [key, value] of Object.entries(overrides)) {
    savedEnv[key] = process.env[key];
    process.env[key] = value;
  }
  // Do not load repository Vite/Playwright configs or any .env files.
  server = await createServer({
    root, configFile: false, envDir: false, envPrefix: [],
    mode: 'registration-browser-mocked', plugins: [react(), {
      name: 'isolated-registration-browser-entry',
      transformIndexHtml(html) {
        return html.replace('src="/src/main.jsx"', 'src="/@registration-browser-entry"');
      },
      resolveId(id) {
        if (id === '/@registration-browser-entry') return '\0registration-browser-entry';
      },
      load(id) {
        if (id === '\0registration-browser-entry') {
          return `import React from 'react';
            import { createRoot } from 'react-dom/client';
            import { BrowserRouter } from 'react-router-dom';
            import Registration from '/src/features/registration/pages/NewResidentRegistration.jsx';
            import '/src/styles/index.css';
            createRoot(document.getElementById('root')).render(
              React.createElement(BrowserRouter, null, React.createElement(Registration)));
          `;
        }
      },
    }],
    optimizeDeps: { noDiscovery: true, include: ['react', 'react-dom/client', 'react-router-dom', 'framer-motion', 'lucide-react', '@supabase/supabase-js', '@tanstack/react-query', 'dexie'] },
    resolve: { alias: { '@': fileURLToPath(new URL('../../src', import.meta.url)) } },
    define: Object.fromEntries(Object.keys(overrides).map((key) => [
      `import.meta.env.${key}`, JSON.stringify(process.env[key]),
    ])),
    server: { host: '127.0.0.1', port: 4197, strictPort: true, open: false, hmr: false },
  });
  await server.listen();
  origin = 'http://127.0.0.1:4197';
  browser = await chromium.launch({ headless: true });
});

after(async () => {
  await browser?.close();
  await server?.close();
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

async function fixture(t, width, responses = {}) {
  const context = await browser.newContext({
    viewport: { width, height: width < 600 ? 852 : 900 },
    isMobile: width < 600, hasTouch: width < 600, serviceWorkers: 'block',
  });
  const requests = [];
  const unexpected = [];
  const pageErrors = [];
  const resources = [];
  const pending = new Set();
  const page = await context.newPage();
  page.on('response', (response) => resources.push([response.url(), response.status(), response.headers()['content-type']]));
  page.on('request', (request) => pending.add(request.url()));
  page.on('requestfinished', (request) => pending.delete(request.url()));
  page.on('requestfailed', (request) => pending.delete(request.url()));
  page.setDefaultTimeout(10_000);
  page.on('console', (message) => {
    if (message.type() === 'error') t.diagnostic(`Browser console: ${message.text()}`);
  });
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await context.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin === authOrigin) {
      const endpoint = url.pathname.replace('/auth/v1/', '');
      requests.push({ endpoint, body: request.postDataJSON(), method: request.method() });
      const response = responses[endpoint] || (endpoint === 'signup'
        ? { status: 200, body: { user, session: null } }
        : endpoint === 'user'
          ? { status: 200, body: { ...user, email_confirmed_at: '2026-01-01T00:00:00Z' } }
          : { status: 200, body: {} });
      const result = typeof response === 'function' ? await response(request) : response;
      await route.fulfill({ status: result.status, json: result.body });
      return;
    }
    if (url.origin === origin && url.pathname.startsWith('/api/')) {
      await route.fulfill({ status: 200, json: { data: [] } });
      return;
    }
    if (url.origin === origin) return route.continue();
    unexpected.push(`${request.method()} ${url.origin}${url.pathname}`);
    await route.abort('blockedbyclient');
  });
  t.after(async () => {
    await context.close();
    assert.deepEqual(unexpected, [], 'No external requests permitted');
    assert.deepEqual(pageErrors, [], 'No browser runtime errors');
  });
  await page.goto(`${origin}/register/new/step-1`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  try {
    await expect(page.getByRole('heading', { name: 'Personal Information', exact: true })).toBeVisible({ timeout: 10_000 });
  } catch (error) {
    t.diagnostic(`Pending: ${JSON.stringify([...pending])}`);
    t.diagnostic(`Page errors: ${JSON.stringify(pageErrors)}`);
    t.diagnostic(`Responses: ${JSON.stringify(resources)}`);
    t.diagnostic(`HTML: ${(await page.content()).slice(0, 5000)}`);
    t.diagnostic(`Page body: ${(await page.locator('body').innerText()).slice(0, 3000)}`);
    throw error;
  }
  return { page, requests };
}

async function personal(page) {
  await page.locator('#resident-first-name').fill('Juan');
  await page.locator('#resident-middle-name').fill('Reyes');
  await page.locator('#resident-last-name').fill('Dela Cruz');
  await page.locator('#resident-birth-date').fill('2000-06-15');
  await page.getByRole('radio', { name: 'Male', exact: true }).click();
  await page.locator('#resident-civil-status').selectOption('Single');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Account & Contact', exact: true })).toBeVisible();
}

async function account(page) {
  await page.locator('#resident-email').fill(email);
  await page.locator('#resident-password').fill(password);
  await page.locator('#resident-confirm-password').fill(password);
  await page.locator('#resident-mobile').fill('09123456789');
  await page.locator('#resident-barangay').click();
  await page.getByRole('button', { name: 'San Isidro', exact: true }).click();
  await page.locator('#resident-zone').selectOption('1');
  await page.getByRole('checkbox').nth(0).check();
  await page.getByRole('checkbox').nth(1).check();
}

async function finishCooldown(page) {
  // Yield between seconds so React can commit each recursive timeout effect.
  for (let tick = 0; tick < 65; tick += 1) {
    if (await page.getByRole('button', { name: 'Resend verification code', exact: true }).count()) return;
    await page.clock.runFor(1000);
    await page.waitForTimeout(20);
  }
  await expect(page.getByRole('button', { name: 'Resend verification code', exact: true })).toBeEnabled();
}

test('mocked Chromium 393: successful resend, invalid OTP correction and explicit change-email reset', async (t) => {
  let verificationAttempts = 0;
  const { page, requests } = await fixture(t, 393, {
    verify: () => ++verificationAttempts === 1
      ? { status: 403, body: { code: 'otp_expired', msg: 'Token has expired or is invalid' } }
      : { status: 200, body: {
        access_token: 'mock-access-token', refresh_token: 'mock-refresh-token',
        token_type: 'bearer', expires_in: 3600,
        user: { ...user, email_confirmed_at: '2026-01-01T00:00:00Z' },
      } },
  });
  await personal(page);
  await account(page);
  await page.clock.install();
  await send(page);
  await finishCooldown(page);
  await page.getByRole('button', { name: 'Resend verification code', exact: true }).click();
  await expect(page.getByText('The email service accepted your new verification code. Check your inbox and spam folder.', { exact: true })).toBeVisible();
  assert.equal(requests.filter((request) => request.endpoint === 'resend').length, 1);
  await otp(page);
  await expect(page.getByRole('alert')).toContainText('This code is invalid or has expired.');
  await expect(page.getByRole('textbox', { name: 'Verification digit 1', exact: true })).toBeEnabled();
  await page.getByRole('textbox', { name: 'Verification digit 1', exact: true }).fill('9');
  await page.getByRole('button', { name: 'Verify Email', exact: true }).click();
  await expect(page.getByText('Email address verified', { exact: true })).toBeVisible();
  assert.equal(requests.filter((request) => request.endpoint === 'verify')[1].body.token, '912345');
  await page.getByRole('button', { name: 'Change email address', exact: true }).click();
  await expect(page.locator('#resident-email')).toBeEditable();
  await page.clock.runFor(1000);
  await expect(page.locator('#resident-email')).toBeEditable();
  await expect(page.getByText('Email address verified', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.getByText('Please verify your email address before continuing.', { exact: true })).toBeVisible();
});

async function send(page) {
  await page.getByRole('button', { name: 'Send Verification Code', exact: true }).click();
  await expect(page.getByText('Pending: check your email', { exact: true })).toBeVisible();
}

async function otp(page) {
  for (const [index, digit] of [...'012345'].entries()) {
    await page.getByRole('textbox', { name: `Verification digit ${index + 1}`, exact: true }).fill(digit);
  }
  await page.getByRole('button', { name: 'Verify Email', exact: true }).click();
}

for (const width of [320, 393, 1440]) {
  test(`mocked Chromium ${width}: native DOB, age, missing/invalid/future validation and field preservation`, async (t) => {
    const { page, requests } = await fixture(t, width);
    const dob = page.locator('#resident-birth-date');
    const age = page.getByPlaceholder('Auto-calculated');
    await expect(dob).toHaveAttribute('type', 'date');
    await expect(dob).toHaveAttribute('autocomplete', 'bday');
    await expect(age).toHaveAttribute('readonly', '');
    await page.locator('#resident-first-name').fill('Juan3');
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await expect(page.locator('#resident-first-name')).toHaveAttribute('aria-invalid', 'true');
    await expect(dob).toHaveAttribute('aria-invalid', 'true');
    await expect(page.locator('#resident-first-name')).toHaveValue('Juan3');
    await dob.fill('2000-06-15');
    const now = new Date();
    const expectedAge = now.getFullYear() - 2000 - (now.getMonth() < 5 || (now.getMonth() === 5 && now.getDate() < 15) ? 1 : 0);
    await expect(age).toHaveValue(String(expectedAge));
    await dob.fill('2999-01-01');
    await expect(dob).toHaveAttribute('aria-invalid', 'true');
    await expect(age).toHaveValue('');
    assert.equal(await dob.evaluate((input) => input.validity.rangeOverflow), true);
    // Chromium sanitizes impossible calendar dates to empty before React receives them.
    await dob.evaluate((input) => { input.value = '2025-02-30'; input.dispatchEvent(new Event('input', { bubbles: true })); });
    await dob.blur();
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await expect(dob).toHaveAttribute('aria-invalid', 'true');
    await personal(page);
    assert.equal(requests.filter((r) => r.endpoint === 'signup').length, 0);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'No horizontal overflow');
  });

  test(`mocked Chromium ${width}: live password mismatch, contact validation, unverified gate and preserved fields`, async (t) => {
    const { page, requests } = await fixture(t, width);
    await personal(page);
    await account(page);
    await page.locator('#resident-confirm-password').fill('Different42!');
    await expect(page.getByText('Passwords do not match.', { exact: true })).toBeVisible();
    await page.locator('#resident-password').fill('Different42!');
    await expect(page.getByText('Passwords do not match.', { exact: true })).toHaveCount(0);
    await page.locator('#resident-password').fill(password);
    await expect(page.getByText('Passwords do not match.', { exact: true })).toBeVisible();
    await page.locator('#resident-confirm-password').fill(password);
    await page.locator('#resident-mobile').fill('08123456789');
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await expect(page.locator('#resident-mobile')).toHaveAttribute('aria-invalid', 'true');
    await expect(page.getByText('Please verify your email address before continuing.', { exact: true })).toBeVisible();
    await expect(page.locator('#resident-password')).toHaveValue(password);
    await expect(page.locator('#resident-mobile')).toHaveValue('08123456789');
    await expect(page.locator('#resident-email')).toHaveValue(email);
    await page.locator('#resident-mobile').fill('09123456789');
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Account & Contact', exact: true })).toBeVisible();
    assert.equal(requests.filter((r) => r.endpoint === 'signup').length, 0);
  });

  test(`mocked Chromium ${width}: pending signup, duplicate click one request, verified OTP and Step 3 required inputs`, async (t) => {
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    const { page, requests } = await fixture(t, width, {
      signup: async () => { await gate; return { status: 200, body: { user, session: null } }; },
      verify: { status: 200, body: {
        access_token: 'mock-access-token', refresh_token: 'mock-refresh-token',
        token_type: 'bearer', expires_in: 3600,
        user: { ...user, email_confirmed_at: '2026-01-01T00:00:00Z' },
      } },
    });
    t.after(() => release());
    await personal(page);
    await account(page);
    await page.getByRole('button', { name: 'Send Verification Code', exact: true }).evaluate((button) => { button.click(); button.click(); });
    await expect(page.getByRole('button', { name: 'Sending', exact: true })).toBeDisabled();
    await expect.poll(() => requests.filter((r) => r.endpoint === 'signup').length).toBe(1);
    release();
    await expect(page.getByText('Pending: check your email', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: /Resend available in/ })).toBeDisabled();
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await expect(page.getByText('Please verify your email address before continuing.', { exact: true })).toBeVisible();
    await otp(page);
    await expect(page.getByText('Email address verified', { exact: true })).toBeVisible();
    const verification = requests.find((r) => r.endpoint === 'verify');
    assert.equal(verification.body.token, '012345');
    assert.equal(verification.body.email, email);
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Identity Verification', exact: true })).toBeVisible();
    await expect(page.locator('input[type="file"]')).toHaveCount(3);
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    for (const message of ['Select your government-issued ID.', 'Enter the number shown on your government ID.', 'Upload the front of your government ID.', 'Upload the back of your government ID.', 'Upload your identity photo holding the ID.']) {
      await expect(page.getByText(message, { exact: true })).toBeVisible();
    }
    await expect(page.getByRole('heading', { name: 'Identity Verification', exact: true })).toBeVisible();
    assert.equal(requests.filter((r) => r.endpoint === 'signup').length, 1);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'No horizontal overflow');
  });

  test(`mocked Chromium ${width}: resend SMTP failure remains visible in pending panel`, async (t) => {
    const { page, requests } = await fixture(t, width, {
      resend: { status: 500, body: { code: 'unexpected_failure', msg: 'SMTP error sending confirmation email' } },
    });
    await personal(page);
    await account(page);
    await page.clock.install();
    await send(page);
    await finishCooldown(page);
    await page.getByRole('button', { name: 'Resend verification code', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('The email service could not send your verification code.');
    await expect(page.getByText('Pending: check your email', { exact: true })).toBeVisible();
    assert.equal(requests.filter((r) => r.endpoint === 'resend').length, 1);
    await expect(page.locator('#resident-password')).toHaveValue(password);
  });

  test(`mocked Chromium ${width}: initial SMTP failure does not claim code sent`, async (t) => {
    const { page } = await fixture(t, width, {
      signup: { status: 500, body: { code: 'unexpected_failure', msg: 'SMTP error sending confirmation email' } },
    });
    await personal(page);
    await account(page);
    await page.getByRole('button', { name: 'Send Verification Code', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('The email service could not send your verification code.');
    await expect(page.getByText('Pending: check your email', { exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Send Verification Code', exact: true })).toBeEnabled();
  });

  test(`mocked Chromium ${width}: expired OTP stays unverified and requires new code`, async (t) => {
    const { page } = await fixture(t, width, {
      verify: { status: 403, body: { code: 'otp_expired', msg: 'Token has expired' } },
    });
    await personal(page);
    await account(page);
    await send(page);
    await otp(page);
    await expect(page.getByText('Expired: request a new code', { exact: true })).toBeVisible();
    await expect(page.getByRole('alert')).toContainText('This code is invalid or has expired.');
    await expect(page.getByRole('button', { name: 'Verify Email', exact: true })).toBeDisabled();
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Account & Contact', exact: true })).toBeVisible();
  });

  test(`mocked Chromium ${width}: Auth rate limit enforces cooldown without duplicate signup`, async (t) => {
    const { page, requests } = await fixture(t, width, {
      signup: { status: 429, body: { code: 'over_email_send_rate_limit', msg: 'For security purposes, you can only request this after 60 seconds.' } },
    });
    await personal(page);
    await account(page);
    await page.getByRole('button', { name: 'Send Verification Code', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('Too many verification emails');
    await expect(page.getByRole('button', { name: 'Send Verification Code', exact: true })).toBeDisabled();
    await expect(page.getByText('Pending: check your email', { exact: true })).toHaveCount(0);
    assert.equal(requests.filter((r) => r.endpoint === 'signup').length, 1);
  });
}
