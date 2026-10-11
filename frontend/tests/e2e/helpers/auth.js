// Reusable authentication + navigation helpers.
//
// Selectors use accessible queries verified against
// src/features/authentication/pages/Login.jsx (label "Email address" /
// "Password", submit button "Sign in"). No credentials are hardcoded — they are
// resolved from the environment by helpers/env.js.

import { expect } from '@playwright/test';
import { ROUTES, credentials } from './env.js';

/**
 * Sign in through the real login UI as the given role's synthetic account and
 * wait for the app shell to replace the login form. Deterministic: it waits for
 * the URL to leave /login rather than sleeping.
 *
 * @param {import('@playwright/test').Page} page
 * @param {string} role  e.g. 'rhu_personnel', 'resident', 'health_supervisor'
 */
export async function loginAs(page, role) {
  const { email, password } = credentials(role);
  await page.goto(ROUTES.login);
  await page.getByLabel(/email address/i).fill(email);
  await page.getByLabel(/^password/i).fill(password);
  await page.getByRole('button', { name: /sign in|log ?in/i }).click();
  // The login route is left on success; assert we are inside the app.
  await expect(page).toHaveURL(/\/app\//, { timeout: 30_000 });
}

/** Navigate to an in-app route (must already be authenticated). */
export async function gotoApp(page, path) {
  await page.goto(path);
  await expect(page).toHaveURL(new RegExp(path.replace(/[/]/g, '\\/')));
}

/** Assert that direct navigation to a path does NOT grant access (redirect/denied). */
export async function expectNoAccess(page, path) {
  await page.goto(path);
  // An unauthorized visit must not land on the protected route itself.
  await expect(page).not.toHaveURL(new RegExp(`${path.replace(/[/]/g, '\\/')}$`));
}

export { ROUTES };
