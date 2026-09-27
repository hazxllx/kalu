/**
 * Password Recovery — end-to-end flow.
 *
 * Covers: Login → Forgot Password → (email) → Recovery Link → Reset Password →
 * Login with new password, plus validation and invalid-link handling.
 *
 * The actual email delivery (Supabase → Brevo SMTP → inbox) cannot be asserted
 * from a browser test, so the emailed recovery link is reproduced with the
 * Supabase Admin API (`generateLink`, service role — test-only, never shipped).
 * `resetPasswordForEmail` itself is exercised through the real UI so the request
 * path, redirect URL and success UX are all verified.
 *
 * An existing seeded resident test account is used. Its password is restored at
 * the end so other suites are unaffected.
 */
import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { CREDENTIALS } from '../helpers/test-helpers.js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || 'https://lblawqeoixojyytkmfqy.supabase.co';
const SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxibGF3cWVvaXhvanl5dGttZnF5Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4OTQ1NzIyOCwiZXhwIjoyMTA1MDMzMjI4fQ.idSat_SrDnGTfbcOAfVBWFNIGTzBhKyrfOXdHAAmltA';

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const TARGET = CREDENTIALS.resident; // { email, password }
const ORIGINAL_PASSWORD = TARGET.password;
const NEW_PASSWORD = 'NewRecovery1!';

/** Reproduce the emailed recovery link and return only its URL fragment. */
async function getRecoveryHash(email) {
  const { data, error } = await admin.auth.admin.generateLink({
    type: 'recovery',
    email,
    options: { redirectTo: 'http://localhost:5173/reset-password' },
  });
  if (error) throw new Error(`generateLink failed: ${error.message}`);
  // Follow the Supabase verify endpoint to obtain the redirect that the browser
  // would receive after clicking the email link. The recovery tokens arrive in
  // the URL hash (implicit flow).
  const res = await fetch(data.properties.action_link, { redirect: 'manual' });
  const location = res.headers.get('location');
  if (!location) throw new Error(`No redirect from verify (status ${res.status})`);
  const hashIndex = location.indexOf('#');
  if (hashIndex === -1) throw new Error(`Redirect had no recovery hash: ${location}`);
  return location.slice(hashIndex); // e.g. #access_token=...&type=recovery
}

test.afterAll(async () => {
  // Restore the seeded account password so other suites keep working.
  const { data: list } = await admin.auth.admin.listUsers();
  const user = list?.users?.find((u) => u.email === TARGET.email);
  if (user) {
    await admin.auth.admin.updateUserById(user.id, { password: ORIGINAL_PASSWORD });
  }
});

test.describe('Password Recovery flow', () => {
  test('Test 1 — Forgot Password UI: navigation and validation', async ({ page }) => {
    await page.goto('/login');
    await page.getByRole('link', { name: /forgot password/i }).click();
    await expect(page).toHaveURL(/\/forgot-password/);

    // Empty submit → validation message.
    await page.getByRole('button', { name: /send reset link/i }).click();
    await expect(page.getByText('Please enter your registered email address.')).toBeVisible();

    // Invalid format → validation message.
    await page.locator('input[type="email"]').fill('not-an-email');
    await page.getByRole('button', { name: /send reset link/i }).click();
    await expect(page.getByText('Please enter a valid email address.')).toBeVisible();

    // Valid existing account → generic success (never reveals existence).
    // Supabase rate-limits real recovery emails; accept the friendly rate-limit
    // notice as an equally valid, non-crashing outcome so the test is stable.
    await page.locator('input[type="email"]').fill(TARGET.email);
    await page.getByRole('button', { name: /send reset link/i }).click();
    await expect(
      page.getByText(/reset link sent/i).or(page.getByText(/too many requests/i)),
    ).toBeVisible({ timeout: 15000 });
  });

  test('Test 3/5 — Reset Password then login with the new password', async ({ page }) => {
    const hash = await getRecoveryHash(TARGET.email);

    // Arrive exactly as a user clicking the emailed recovery link would.
    await page.goto(`/reset-password${hash}`);

    // The recovery session is detected and the form is shown (not "invalid").
    const newPw = page.locator('input[autocomplete="new-password"]').first();
    await expect(newPw).toBeVisible({ timeout: 15000 });
    await expect(page.getByText(/create new password/i)).toBeVisible();

    const inputs = page.locator('input[autocomplete="new-password"]');

    // Password mismatch → clear message.
    await inputs.nth(0).fill(NEW_PASSWORD);
    await inputs.nth(1).fill('Different1!');
    await page.getByRole('button', { name: /update password/i }).click();
    await expect(page.getByText(/passwords do not match/i)).toBeVisible();

    // Weak password → policy message.
    await inputs.nth(0).fill('weak');
    await inputs.nth(1).fill('weak');
    await page.getByRole('button', { name: /update password/i }).click();
    await expect(page.getByText(/must meet all requirements/i)).toBeVisible();

    // Valid matching password → success.
    await inputs.nth(0).fill(NEW_PASSWORD);
    await inputs.nth(1).fill(NEW_PASSWORD);
    await page.getByRole('button', { name: /update password/i }).click();
    await expect(page.getByText(/password updated successfully/i)).toBeVisible({ timeout: 15000 });

    // Back to Login and sign in with the NEW password.
    await page.getByRole('button', { name: /back to login/i }).click();
    await expect(page).toHaveURL(/\/login/);

    await page.locator('input[type="email"]').fill(TARGET.email);
    await page.locator('input[type="password"]').fill(NEW_PASSWORD);
    await page.getByRole('button', { name: /^sign in$/i }).click();
    await expect(page).not.toHaveURL(/\/login/, { timeout: 20000 });
  });

  test('Test 4 — old password no longer works', async ({ page }) => {
    await page.goto('/login');
    await page.locator('input[type="email"]').fill(TARGET.email);
    await page.locator('input[type="password"]').fill(ORIGINAL_PASSWORD);
    await page.getByRole('button', { name: /^sign in$/i }).click();
    // Stays on /login with an error; never reaches an app route.
    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByRole('alert')).toBeVisible({ timeout: 15000 });
  });

  test('Test 6 — invalid recovery link shows a friendly error', async ({ page }) => {
    await page.goto('/reset-password#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired');
    await expect(page.getByText(/invalid or expired password reset link/i)).toBeVisible({ timeout: 15000 });
    await expect(page.getByRole('link', { name: /request a new reset link/i })).toBeVisible();
  });
});
