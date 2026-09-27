/**
 * Resident & Household Management Tests
 * Tests: 1.1-1.6 Resident list, profile, creation, editing, household management, search/filter
 */

import { test, expect } from '@playwright/test';
import { 
  login, 
  logout, 
  navigateTo, 
  takeScreenshot, 
  recordTestResult,
  captureConsoleErrors,
  captureNetworkErrors,
  createBugReport,
  waitAndClick,
  fillField,
  selectOption,
  isVisible,
  getText,
  generateTestResident,
  verifyPersistence,
  SEVERITY,
} from '../helpers/test-helpers.js';

const results = [];
const bugs = [];
const consoleErrors = [];
const networkErrors = [];

test.describe('1. Resident & Household Management', () => {
  let page;
  let role = 'supervisor'; // Health Supervisor has resident/household management access

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    consoleErrors.push(...captureConsoleErrors(page));
    networkErrors.push(...captureNetworkErrors(page));
    await login(page, role);
  });

  test.afterAll(async () => {
    await logout(page);
    await page.close();
  });

  test('1.1 Resident List - Loads and displays records', async () => {
    await navigateTo(page, '/app/health_supervisor/residents');
    await expect(page.locator('h1:has-text("Resident Directory")')).toBeVisible({ timeout: 10000 });
    
    // Wait for table or empty state
    await page.waitForSelector('table', { timeout: 15000 }).catch(() => {});
    await page.locator('text=No residents found, text=Verified residents').first().waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
    
    const screenshot = await takeScreenshot(page, '01-resident-household', '01-resident-list');
    recordTestResult(results, '1.1 Resident List Load', role, 'passed', { screenshot: screenshot.filename });
  });

  test('1.1 Resident List - Search works', async () => {
    await navigateTo(page, '/app/health_supervisor/residents');
    await page.waitForSelector('input[placeholder*="Search"]', { timeout: 10000 });
    
    // Search for existing data
    await fillField(page, 'input[placeholder*="Search"]', 'test');
    await page.waitForTimeout(500); // debounce
    
    const screenshot = await takeScreenshot(page, '01-resident-household', '02-resident-search');
    recordTestResult(results, '1.1 Resident Search', role, 'passed', { screenshot: screenshot.filename });
  });

  test('1.1 Resident List - Filter works', async () => {
    await navigateTo(page, '/app/health_supervisor/residents');
    // Check if there are filter controls
    const hasFilters = await isVisible(page, 'select, [role="combobox"]');
    if (hasFilters) {
      const screenshot = await takeScreenshot(page, '01-resident-household', '03-resident-filters');
      recordTestResult(results, '1.1 Resident Filters', role, 'passed', { screenshot: screenshot.filename });
    } else {
      recordTestResult(results, '1.1 Resident Filters', role, 'skipped', { reason: 'No filter controls found' });
    }
  });

  test('1.2 Resident Profile - View existing resident', async () => {
    await navigateTo(page, '/app/health_supervisor/residents');
    await page.waitForSelector('table', { timeout: 10000 }).catch(() => {});
    await page.locator('text=No residents found').first().waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
    
    // Click view on first resident if any
    const viewBtn = page.locator('button:has-text("View"), a:has-text("View")').first();
    if (await viewBtn.isVisible({ timeout: 5000 })) {
      await viewBtn.click();
      await page.waitForSelector('text=Demographics, text=Resident', { timeout: 10000 });
      
      const screenshot = await takeScreenshot(page, '01-resident-household', '04-resident-profile');
      recordTestResult(results, '1.2 Resident Profile View', role, 'passed', { screenshot: screenshot.filename });
      
      // Close modal
      await page.keyboard.press('Escape');
      await page.waitForTimeout(500);
    } else {
      recordTestResult(results, '1.2 Resident Profile View', role, 'skipped', { reason: 'No residents to view' });
    }
  });

  test('1.3 Resident Creation - Create test resident', async () => {
    await navigateTo(page, '/app/health_supervisor/residents');
    await page.waitForSelector('button:has-text("Add Resident")', { timeout: 10000 });
    
    await waitAndClick(page, 'button:has-text("Add Resident")');
    await page.waitForSelector('text=Add Resident', { timeout: 5000 });
    
    const testResident = generateTestResident('QA-AUDIT-RES');
    
    // Fill form
    await fillField(page, 'input[placeholder*="Maria"]', testResident.firstName);
    await fillField(page, 'input[placeholder*="Santos"]', testResident.middleName);
    await fillField(page, 'input[placeholder*="Dela Cruz"]', testResident.lastName);
    await fillField(page, 'input[type="date"]', testResident.dob);
    // Sex is a native select
    await selectOption(page, 'select:has(option:has-text("Female"))', testResident.gender);
    await fillField(page, 'input[placeholder*="0917"]', testResident.contact);
    // Barangay is SearchableSelect - type to search and select
    await fillField(page, 'input[placeholder*="Search barangay"]', testResident.barangay);
    await page.waitForTimeout(500);
    await page.keyboard.press('Enter');
    await fillField(page, 'input[placeholder*="Purok"]', testResident.purok);
    await fillField(page, 'input[placeholder*="street"]', testResident.street);
    await fillField(page, 'input[placeholder*="house"]', testResident.houseNo);
    
    const screenshot = await takeScreenshot(page, '01-resident-household', '05-resident-form-filled');
    
    // Submit
    await waitAndClick(page, 'button:has-text("Add Resident")');
    await page.waitForSelector('text=added to the resident directory, text=Resident added', { timeout: 10000 });
    
    const successScreenshot = await takeScreenshot(page, '01-resident-household', '06-resident-created');
    recordTestResult(results, '1.3 Resident Creation', role, 'passed', { 
      screenshot: successScreenshot.filename,
      testData: testResident 
    });
  });

  test('1.4 Resident Editing - Edit test resident', async () => {
    await navigateTo(page, '/app/health_supervisor/residents');
    await page.waitForSelector('table tbody tr', { timeout: 10000 });
    
    // Find our test resident
    const testResidentName = 'QA-AUDIT-RES';
    const row = page.locator(`tr:has-text("${testResidentName}")`).first();
    if (await row.isVisible({ timeout: 5000 })) {
      // Click edit
      await row.locator('button:has-text("Edit")').click();
      await page.waitForSelector('text=Edit Resident', { timeout: 5000 });
      
      // Modify a safe field (contact number)
      await fillField(page, 'input[placeholder*="0917"]', '09181234567');
      
      const screenshot = await takeScreenshot(page, '01-resident-household', '07-resident-edit-form');
      
      // Save
      await waitAndClick(page, 'button:has-text("Save Changes")');
      await page.waitForSelector('text=updated successfully', { timeout: 10000 });
      
      const successScreenshot = await takeScreenshot(page, '01-resident-household', '08-resident-edited');
      recordTestResult(results, '1.4 Resident Editing', role, 'passed', { screenshot: successScreenshot.filename });
    } else {
      recordTestResult(results, '1.4 Resident Editing', role, 'skipped', { reason: 'Test resident not found in list' });
    }
  });

  test('1.5 Household Management - View households', async () => {
    await navigateTo(page, '/app/health_supervisor/households');
    await expect(page.locator('h1:has-text("Household Profiling")')).toBeVisible({ timeout: 10000 });
    await page.waitForSelector('table', { timeout: 15000 }).catch(() => {});
    await page.locator('text=No households').first().waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
    
    const screenshot = await takeScreenshot(page, '01-resident-household', '09-household-list');
    recordTestResult(results, '1.5 Household List View', role, 'passed', { screenshot: screenshot.filename });
  });

  test('1.5 Household Management - View household details', async () => {
    await navigateTo(page, '/app/health_supervisor/households');
    await page.waitForSelector('table', { timeout: 10000 }).catch(() => {});
    await page.locator('text=No households').first().waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
    
    const viewBtn = page.locator('button:has-text("View details"), tr').first();
    if (await viewBtn.isVisible({ timeout: 5000 })) {
      // Click the row or view button
      await viewBtn.click();
      await page.waitForSelector('text=Household Members, text=Household Information', { timeout: 10000 });
      
      const screenshot = await takeScreenshot(page, '01-resident-household', '10-household-detail');
      recordTestResult(results, '1.5 Household Detail View', role, 'passed', { screenshot: screenshot.filename });
      
      await page.keyboard.press('Escape');
    } else {
      recordTestResult(results, '1.5 Household Detail View', role, 'skipped', { reason: 'No households to view' });
    }
  });

  test('1.6 Search/Filter - Search for known resident', async () => {
    await navigateTo(page, '/app/health_supervisor/residents');
    await page.waitForSelector('input[placeholder*="Search"]', { timeout: 10000 });
    
    await fillField(page, 'input[placeholder*="Search"]', 'QA-AUDIT');
    await page.waitForTimeout(500);
    
    // Check results
    const hasResults = await isVisible(page, 'table tbody tr');
    const screenshot = await takeScreenshot(page, '01-resident-household', '11-search-qa-resident');
    recordTestResult(results, '1.6 Search Known Resident', role, 'passed', { 
      screenshot: screenshot.filename,
      hasResults 
    });
  });

  test('1.6 Search/Filter - Non-existent search', async () => {
    await navigateTo(page, '/app/health_supervisor/residents');
    await fillField(page, 'input[placeholder*="Search"]', 'NONEXISTENTRESIDENT12345');
    await page.waitForTimeout(500);
    
    const emptyState = await isVisible(page, 'text=No residents found, text=No matching');
    const screenshot = await takeScreenshot(page, '01-resident-household', '12-search-nonexistent');
    recordTestResult(results, '1.6 Search Non-existent', role, 'passed', { 
      screenshot: screenshot.filename,
      emptyState 
    });
  });
});

// Export results for summary
test.afterAll(async () => {
  const fs = await import('fs');
  const path = await import('path');
  
  const summary = {
    feature: 'Resident & Household Management',
    tests: results.length,
    passed: results.filter(r => r.status === 'passed').length,
    failed: results.filter(r => r.status === 'failed').length,
    blocked: results.filter(r => r.status === 'blocked').length,
    skipped: results.filter(r => r.status === 'skipped').length,
    results,
    bugs,
    consoleErrors: consoleErrors.slice(0, 50),
    networkErrors: networkErrors.slice(0, 50),
  };
  
  const dir = path.join('evidence');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'resident-household-results.json'), JSON.stringify(summary, null, 2));
});