/**
 * Test Helpers for KALUSAGAP Browser QA Audit
 * Provides shared utilities for login, navigation, screenshots, and error collection.
 */

import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';

// Test credentials come EXCLUSIVELY from environment variables. No password,
// email, or other secret is hardcoded here (BUG-026): committed fallback
// credentials are a leak and were removed. Provide them via the environment
// (e.g. an untracked .env / CI secret store) before running the E2E suite.
const CREDENTIAL_ENV = {
  admin: { email: 'KALUSAGAP_ADMIN_EMAIL', password: 'KALUSAGAP_ADMIN_PASSWORD' },
  mho: { email: 'KALUSAGAP_MHO_EMAIL', password: 'KALUSAGAP_MHO_PASSWORD' },
  rhu: { email: 'KALUSAGAP_RHU_EMAIL', password: 'KALUSAGAP_RHU_PASSWORD' },
  phn: { email: 'KALUSAGAP_PHN_EMAIL', password: 'KALUSAGAP_PHN_PASSWORD' },
  supervisor: { email: 'KALUSAGAP_SUPERVISOR_EMAIL', password: 'KALUSAGAP_SUPERVISOR_PASSWORD' },
  resident: { email: 'KALUSAGAP_RESIDENT_EMAIL', password: 'KALUSAGAP_RESIDENT_PASSWORD' },
};

/**
 * Resolve a role's credentials from the environment, or fail with a clear
 * configuration error. Never falls back to a real/default password and never
 * prints the secret value.
 */
function getCredentials(role) {
  const map = CREDENTIAL_ENV[role];
  if (!map) throw new Error(`Unknown role: ${role}`);
  const email = process.env[map.email];
  const password = process.env[map.password];
  const missing = [];
  if (!email) missing.push(map.email);
  if (!password) missing.push(map.password);
  if (missing.length) {
    throw new Error(
      `Missing test credentials for role "${role}". Set the environment variable(s): ${missing.join(', ')}. ` +
        'Test credentials must never be hardcoded in source.',
    );
  }
  return { email, password };
}

const CREDENTIALS = new Proxy(
  {},
  {
    get(_target, role) {
      if (typeof role !== 'string') return undefined;
      return getCredentials(role);
    },
  },
);

// Role descriptions for reporting
const ROLE_DESCRIPTIONS = {
  admin: 'Administrator',
  mho: 'Municipal Health Officer (MHO)',
  rhu: 'RHU Personnel',
  phn: 'Public Health Nurse (PHN)',
  supervisor: 'Health Supervisor',
  resident: 'Resident',
};

// Severity levels
export const SEVERITY = {
  CRITICAL: 'CRITICAL',
  HIGH: 'HIGH',
  MEDIUM: 'MEDIUM',
  LOW: 'LOW',
};

/**
 * Login as a specific role
 */
export async function login(page, role, options = {}) {
  const creds = getCredentials(role);

  await page.goto('/login');
  await page.waitForLoadState('networkidle');

  // Fill login form
  await page.fill('input[type="email"]', creds.email);
  await page.fill('input[type="password"]', creds.password);
  
  // Submit
  await page.click('button[type="submit"]');
  
  // Wait for navigation to complete
  await page.waitForLoadState('networkidle', { timeout: 20000 });
  
  // Verify we're logged in by checking we're on a protected route (not /login)
  await expect(page).not.toHaveURL(/\/login/);
  
  return creds;
}

/**
 * Logout
 */
export async function logout(page) {
  // Try to find and click logout
  const logoutBtn = page.locator('button:has-text("Log out"), a:has-text("Log out"), [aria-label="User menu"]').first();
  if (await logoutBtn.isVisible({ timeout: 2000 })) {
    await logoutBtn.click();
    // If it's a dropdown, click logout in dropdown
    const dropdownLogout = page.locator('text=Log out').last();
    if (await dropdownLogout.isVisible({ timeout: 2000 })) {
      await dropdownLogout.click();
    }
  }
  await page.waitForURL('/login', { timeout: 10000 });
}

/**
 * Navigate to a page and wait for it to load
 */
export async function navigateTo(page, path, options = {}) {
  const url = path.startsWith('http') ? path : `${path}`;
  await page.goto(url);
  await page.waitForLoadState('domcontentloaded', { timeout: 30000 });
  if (options.waitForSelector) {
    await page.waitForSelector(options.waitForSelector, { timeout: options.timeout || 10000 });
  }
}

/**
 * Take a named screenshot
 */
export async function takeScreenshot(page, category, name, options = {}) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `${name}-${timestamp}.png`;
  const dir = path.join('evidence', 'screenshots', category);
  
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  
  const filepath = path.join(dir, filename);
  await page.screenshot({ path: filepath, fullPage: options.fullPage !== false });
  
  return { filename, filepath, category };
}

/**
 * Record a test result
 */
export function recordTestResult(results, testName, role, status, details = {}) {
  const result = {
    test: testName,
    role: ROLE_DESCRIPTIONS[role] || role,
    status, // 'passed', 'failed', 'blocked', 'skipped'
    timestamp: new Date().toISOString(),
    ...details,
  };
  results.push(result);
  return result;
}

/**
 * Capture console errors
 */
export function captureConsoleErrors(page) {
  const errors = [];
  page.on('console', msg => {
    if (msg.type() === 'error') {
      errors.push({
        type: 'console',
        text: msg.text(),
        location: msg.location(),
      });
    }
  });
  return errors;
}

/**
 * Capture network errors
 */
export function captureNetworkErrors(page) {
  const errors = [];
  page.on('response', response => {
    if (response.status() >= 400) {
      errors.push({
        type: 'network',
        url: response.url(),
        status: response.status(),
        statusText: response.statusText(),
      });
    }
  });
  return errors;
}

/**
 * Create a bug report entry
 */
export function createBugReport(bugs, bug) {
  const id = `BUG-${String(bugs.length + 1).padStart(3, '0')}`;
  const report = {
    id,
    ...bug,
    timestamp: new Date().toISOString(),
  };
  bugs.push(report);
  return report;
}

/**
 * Wait for an element and click it
 */
export async function waitAndClick(page, selector, options = {}) {
  const element = page.locator(selector).first();
  await element.waitFor({ state: 'visible', timeout: options.timeout || 10000 });
  await element.click();
  if (options.waitForNavigation) {
    await page.waitForLoadState('networkidle');
  }
}

/**
 * Fill a form field
 */
export async function fillField(page, selector, value, options = {}) {
  const element = page.locator(selector).first();
  await element.waitFor({ state: 'visible', timeout: options.timeout || 5000 });
  await element.fill(value);
}

/**
 * Select from a dropdown
 */
export async function selectOption(page, selector, value, options = {}) {
  const element = page.locator(selector).first();
  await element.waitFor({ state: 'visible', timeout: options.timeout || 5000 });
  await element.selectOption(value);
}

/**
 * Check if element exists and is visible
 */
export async function isVisible(page, selector, timeout = 5000) {
  try {
    await page.locator(selector).first().waitFor({ state: 'visible', timeout });
    return true;
  } catch {
    return false;
  }
}

/**
 * Get text content of an element
 */
export async function getText(page, selector, timeout = 5000) {
  try {
    const element = page.locator(selector).first();
    await element.waitFor({ state: 'visible', timeout });
    return await element.textContent();
  } catch {
    return null;
  }
}

/**
 * Wait for API response
 */
export async function waitForResponse(page, urlPattern, options = {}) {
  return page.waitForResponse(response => 
    response.url().match(urlPattern) && response.status() < 400,
    { timeout: options.timeout || 15000 }
  );
}

/**
 * Generate test resident data
 */
export function generateTestResident(prefix = 'QA-AUDIT') {
  const timestamp = Date.now();
  return {
    firstName: `${prefix}-${timestamp}`,
    middleName: 'Test',
    lastName: 'Resident',
    suffix: '',
    dob: '2000-01-01',
    gender: 'Female',
    contact: '09171234567',
    barangay: 'Poblacion',
    purok: 'Purok 1',
    street: 'Main Street',
    houseNo: '123',
    civilStatus: 'Single',
  };
}

/**
 * Verify data persistence by reloading
 */
export async function verifyPersistence(page, verifyFn, role) {
  // First verification
  const firstResult = await verifyFn();
  
  // Reload page
  await page.reload();
  await page.waitForLoadState('networkidle');
  
  // Second verification
  const secondResult = await verifyFn();
  
  return {
    first: firstResult,
    second: secondResult,
    persisted: JSON.stringify(firstResult) === JSON.stringify(secondResult),
  };
}

export { CREDENTIALS, ROLE_DESCRIPTIONS };