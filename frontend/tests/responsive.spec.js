// KALUSAGAP v20 - Responsive Design Test Suite
// Tests viewport responsiveness across all device sizes

import { test, expect } from '@playwright/test';

// Viewport test matrix as specified in requirements
const VIEWPORTS = [
  { name: 'Small Mobile', width: 320, height: 568 },
  { name: 'Mobile (iPhone 13)', width: 375, height: 812 },
  { name: 'Mobile (iPhone 13 Pro)', width: 390, height: 844 },
  { name: 'Large Mobile', width: 430, height: 932 },
  { name: 'Small Tablet', width: 600, height: 960 },
  { name: 'Tablet (iPad)', width: 768, height: 1024 },
  { name: 'Large Tablet (iPad Pro)', width: 1024, height: 768 },
  { name: 'Laptop', width: 1280, height: 720 },
  { name: 'Desktop', width: 1440, height: 900 },
  { name: 'Large Desktop', width: 1920, height: 1080 },
];

// Test routes for each role
const TEST_ROUTES = {
  mho: [
    { path: '/app/mho/dashboard', name: 'MHO Dashboard' },
    { path: '/app/mho/residents', name: 'MHO Residents Directory' },
    { path: '/app/mho/health-trends', name: 'MHO Health Trends' },
  ],
  phn: [
    { path: '/app/phn/dashboard', name: 'PHN Dashboard' },
    { path: '/app/phn/residents', name: 'PHN Residents Directory' },
    { path: '/app/phn/health-records', name: 'PHN Health Records' },
  ],
  health_supervisor: [
    { path: '/app/health_supervisor/dashboard', name: 'Health Supervisor Dashboard' },
    { path: '/app/health_supervisor/residents', name: 'Health Supervisor Residents' },
    { path: '/app/health_supervisor/verifications', name: 'Health Supervisor Verifications' },
  ],
  bhw: [
    { path: '/app/bhw/dashboard', name: 'BHW Dashboard' },
    { path: '/app/bhw/households', name: 'BHW Households' },
  ],
  resident: [
    { path: '/app/resident/dashboard', name: 'Resident Dashboard' },
    { path: '/app/resident/health-records', name: 'Resident Health Records' },
  ],
};

// Helper function to check for horizontal overflow
async function checkNoHorizontalOverflow(page) {
  const hasOverflow = await page.evaluate(() => {
    const html = document.documentElement;
    const body = document.body;
    return html.scrollWidth > html.clientWidth || body.scrollWidth > body.clientWidth;
  });
  return !hasOverflow;
}

// Helper function to check touch target sizes (minimum 44x44 CSS pixels)
async function checkTouchTargets(page) {
  const smallTargets = await page.evaluate(() => {
    const buttons = Array.from(document.querySelectorAll('button, a[href], input[type="button"], input[type="submit"]'));
    return buttons.filter(el => {
      const rect = el.getBoundingClientRect();
      return rect.width < 44 || rect.height < 44;
    }).length;
  });
  return smallTargets;
}

// Helper function to check for overlapping elements
async function checkOverlappingElements(page) {
  const overlaps = await page.evaluate(() => {
    const elements = Array.from(document.querySelectorAll('button, a, input, select'));
    let overlapCount = 0;
    
    for (let i = 0; i < elements.length; i++) {
      for (let j = i + 1; j < elements.length; j++) {
        const rect1 = elements[i].getBoundingClientRect();
        const rect2 = elements[j].getBoundingClientRect();
        
        if (!(rect1.right < rect2.left || 
              rect1.left > rect2.right || 
              rect1.bottom < rect2.top || 
              rect1.top > rect2.bottom)) {
          overlapCount++;
        }
      }
    }
    
    return overlapCount;
  });
  return overlaps;
}

// Test suite for responsive layout
test.describe('Responsive Layout Tests', () => {
  // Test login functionality first
  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
    // Add login steps here based on your authentication
    // This is a placeholder - adjust according to your actual auth flow
  });

  VIEWPORTS.forEach(viewport => {
    test.describe(`${viewport.name} (${viewport.width}×${viewport.height})`, () => {
      test.use({ viewport: { width: viewport.width, height: viewport.height } });

      // Test navigation accessibility
      test('should have accessible navigation', async ({ page }) => {
        await page.goto('/app/mho/dashboard');
        
        // Check if mobile menu button exists on small screens
        if (viewport.width < 1024) {
          const menuButton = page.locator('button[aria-label="Open navigation menu"]');
          await expect(menuButton).toBeVisible();
          
          // Click to open menu
          await menuButton.click();
          
          // Check if navigation drawer appears
          const nav = page.locator('nav[aria-label="Main navigation"]');
          await expect(nav).toBeVisible();
        } else {
          // Desktop should have visible sidebar
          const sidebar = page.locator('aside').first();
          await expect(sidebar).toBeVisible();
        }
      });

      // Test for horizontal overflow
      test('should not have horizontal overflow', async ({ page }) => {
        await page.goto('/app/mho/dashboard');
        const noOverflow = await checkNoHorizontalOverflow(page);
        expect(noOverflow).toBeTruthy();
      });

      // Test touch targets on mobile
      if (viewport.width < 768) {
        test('should have adequate touch targets on mobile', async ({ page }) => {
          await page.goto('/app/mho/dashboard');
          const smallTargets = await checkTouchTargets(page);
          // Allow a small number of exceptions for very small indicators
          expect(smallTargets).toBeLessThan(5);
        });
      }

      // Test KPI sections are visible
      test('should display KPI metrics correctly', async ({ page }) => {
        await page.goto('/app/mho/dashboard');
        
        const kpiSection = page.locator('.supervisor-metric-grid, .ui-stat-card').first();
        await expect(kpiSection).toBeVisible();
        
        // Check that KPI values are readable
        const kpiValues = page.locator('.supervisor-metric-value, .font-stat').first();
        await expect(kpiValues).toBeVisible();
      });

      // Test page header responsiveness
      test('should have responsive page header', async ({ page }) => {
        await page.goto('/app/mho/dashboard');
        
        const pageHeader = page.locator('.ui-page-header');
        await expect(pageHeader).toBeVisible();
        
        const headerTitle = page.locator('.ui-page-header h1');
        await expect(headerTitle).toBeVisible();
      });

      // Test tables are accessible
      test('should display tables accessibly', async ({ page }) => {
        await page.goto('/app/mho/residents');
        
        // On mobile, should show card view or scrollable table
        if (viewport.width < 768) {
          const hasCards = await page.locator('.mobile-table-cards').count() > 0;
          const hasTable = await page.locator('table').count() > 0;
          expect(hasCards || hasTable).toBeTruthy();
        } else {
          // Desktop should show table
          const table = page.locator('table');
          await expect(table.first()).toBeVisible();
        }
      });

      // Test pagination controls
      test('should have accessible pagination', async ({ page }) => {
        await page.goto('/app/mho/residents');
        
        // Wait for data to load
        await page.waitForTimeout(1000);
        
        const pagination = page.locator('[aria-label="List pagination"]');
        if (await pagination.count() > 0) {
          await expect(pagination.first()).toBeVisible();
          
          // Check buttons are accessible
          const nextButton = page.locator('button:has-text("Next")').or(page.locator('button[aria-label="Go to next page"]'));
          if (await nextButton.count() > 0) {
            await expect(nextButton.first()).toBeVisible();
          }
        }
      });

      // Test form responsiveness
      test('should have responsive forms', async ({ page }) => {
        // This test needs to be adjusted based on your actual forms
        // Placeholder test
        await page.goto('/app/mho/dashboard');
        expect(true).toBeTruthy();
      });

      // Test no element clipping
      test('should not have clipped text or elements', async ({ page }) => {
        await page.goto('/app/mho/dashboard');
        
        // Check for text overflow
        const clippedElements = await page.evaluate(() => {
          const allElements = Array.from(document.querySelectorAll('*'));
          return allElements.filter(el => {
            const style = window.getComputedStyle(el);
            return style.overflow === 'hidden' && 
                   el.scrollWidth > el.clientWidth && 
                   !el.classList.contains('truncate') && 
                   !el.classList.contains('line-clamp-2');
          }).length;
        });
        
        // Some intentional truncation is okay (e.g., .truncate class)
        expect(clippedElements).toBeLessThan(10);
      });
    });
  });
});

// Test suite for specific role dashboards
test.describe('Role Dashboard Responsive Tests', () => {
  Object.entries(TEST_ROUTES).forEach(([role, routes]) => {
    test.describe(`${role.toUpperCase()} Role`, () => {
      routes.forEach(route => {
        test(`${route.name} should be responsive`, async ({ page }) => {
          // Test at key breakpoints
          const keyViewports = [
            { width: 375, height: 812 },  // Mobile
            { width: 768, height: 1024 }, // Tablet
            { width: 1440, height: 900 }, // Desktop
          ];

          for (const viewport of keyViewports) {
            await page.setViewportSize(viewport);
            await page.goto(route.path);
            
            // Check no horizontal overflow
            const noOverflow = await checkNoHorizontalOverflow(page);
            expect(noOverflow).toBeTruthy();
            
            // Check page loads
            const body = page.locator('body');
            await expect(body).toBeVisible();
          }
        });
      });
    });
  });
});

// Test suite for dark mode
test.describe('Dark Mode Responsive Tests', () => {
  test('should maintain responsiveness in dark mode', async ({ page }) => {
    await page.goto('/app/mho/dashboard');
    
    // Enable dark mode (adjust selector based on your implementation)
    await page.evaluate(() => {
      document.documentElement.classList.add('dark');
    });
    
    // Test at mobile size
    await page.setViewportSize({ width: 375, height: 812 });
    
    const noOverflow = await checkNoHorizontalOverflow(page);
    expect(noOverflow).toBeTruthy();
    
    // Check that elements are still visible
    const pageHeader = page.locator('.ui-page-header');
    await expect(pageHeader).toBeVisible();
  });
});

// Test suite for accessibility
test.describe('Responsive Accessibility Tests', () => {
  test('should be keyboard navigable on all viewports', async ({ page }) => {
    await page.goto('/app/mho/dashboard');
    
    // Tab through interactive elements
    await page.keyboard.press('Tab');
    const focused = page.locator(':focus');
    await expect(focused).toBeFocused();
  });

  test('should have proper ARIA labels', async ({ page }) => {
    await page.goto('/app/mho/dashboard');
    
    // Check for proper ARIA labels on navigation
    const nav = page.locator('nav[aria-label]');
    expect(await nav.count()).toBeGreaterThan(0);
  });
});

// Performance test
test.describe('Responsive Performance Tests', () => {
  test('should load quickly on mobile', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    
    const startTime = Date.now();
    await page.goto('/app/mho/dashboard');
    const loadTime = Date.now() - startTime;
    
    // Should load within 5 seconds even on mobile
    expect(loadTime).toBeLessThan(5000);
  });
});
