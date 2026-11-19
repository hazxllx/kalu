import { test, expect } from '@playwright/test';
import { build } from 'esbuild';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import postcss from 'postcss';
import tailwindcss from 'tailwindcss';

const edgeExecutableCandidates = [
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
];
const browserChannel = process.env.NAVIGATION_UI_BROWSER_CHANNEL ||
  (edgeExecutableCandidates.some((path) => existsSync(path)) ? 'msedge' : undefined);

test.use({ channel: browserChannel, video: 'off' });

const frontend = fileURLToPath(new URL('../../', import.meta.url));
const roles = {
  resident: {
    name: 'Synthetic Resident',
    email: 'resident.synthetic@example.test',
    feature: 'Health Services',
    featurePath: '/app/resident/health-services',
  },
  bhw: {
    name: 'Synthetic Barangay Health Worker',
    email: 'bhw.synthetic@example.test',
    feature: 'Household Profiling',
    featurePath: '/app/bhw/households',
  },
};
const viewports = [
  { width: 390, height: 844 },
  { width: 768, height: 1024 },
  { width: 1366, height: 768 },
];
const mobileViewports = viewports.filter(({ width }) => width < 1024);

// Keep service and context boundaries synthetic while importing the production
// DashboardLayout and navConfig, so these tests exercise the real shell behavior.
const modules = {
  '@/components/common/Icon': `
    import React from 'react';
    export default function Icon({ ...props }) { return <span aria-hidden="true" {...props} />; }
  `,
  '@/features/offline/components/OfflineStatusIndicator': `
    import React from 'react';
    export default function OfflineStatusIndicator() {
      return <span aria-label="Connection status: Online. No pending changes">Online</span>;
    }
  `,
  '@/lib/brand': `
    export const LOGO_URL = 'data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=';
    export const ROLES = {
      resident: { key: 'resident', label: 'Resident (Verified)', name: 'Resident (Verified)', basePath: '/app/resident' },
      bhw: { key: 'bhw', label: 'Barangay Health Worker', name: 'Barangay Health Worker', basePath: '/app/bhw' },
    };
  `,
  '@/services/api': `
    export const notificationsApi = { list: async () => ({ rows: [] }) };
  `,
  '@/services/notifications/unreadBus': `
    export const onUnreadChanged = () => () => {};
  `,
  '@/context/AuthContext': `
    const profiles = {
      resident: { id: 'synthetic-resident', name: 'Synthetic Resident', email: 'resident.synthetic@example.test', role: 'resident' },
      bhw: { id: 'synthetic-bhw', name: 'Synthetic Barangay Health Worker', email: 'bhw.synthetic@example.test', role: 'bhw' },
    };
    export const useAuth = () => {
      const user = profiles[window.__navigationRole] || profiles.resident;
      return {
        user,
        logout: () => { window.__navigationLoggedOut = true; },
        refreshProfile: async () => user,
      };
    };
  `,
  '@/context/PermissionsContext': `
    const can = () => true;
    export const usePermissions = () => {
      const role = window.__navigationRole || 'resident';
      const userId = role === 'bhw' ? 'synthetic-bhw' : 'synthetic-resident';
      return {
        can,
        matrixLoadState: {
          userId,
          role,
          status: 'ready',
          source: 'server',
          expiresAt: Date.now() + 60 * 60 * 1000,
        },
        refreshMatrix: async () => true,
      };
    };
  `,
  '@/services/offline/connectivity': `
    export const isNavigatorOnline = () => true;
  `,
  '@/lib/supervisorScope': `
    export const getSupervisorScope = () => null;
  `,
};

let fixture;
let stylesheet;

test.beforeAll(async () => {
  test.setTimeout(120_000);
  const cssUrl = new URL('../../src/styles/index.css', import.meta.url);
  const css = await readFile(cssUrl, 'utf8');
  const [bundle, compiled] = await Promise.all([
    build({
      absWorkingDir: frontend,
      bundle: true,
      write: false,
      minify: true,
      tsconfig: fileURLToPath(new URL('../../jsconfig.json', import.meta.url)),
      stdin: {
        resolveDir: frontend,
        loader: 'jsx',
        contents: `
          import React, { useEffect } from 'react';
          import { createRoot } from 'react-dom/client';
          import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
          import DashboardLayout from './src/layouts/DashboardLayout.jsx';

          function RouteProbe() {
            const location = useLocation();
            useEffect(() => { window.__navigationPath = location.pathname; }, [location.pathname]);
            return (
              <section data-testid="route-probe" data-path={location.pathname}>
                <h1>Route probe</h1>
                <p>{location.pathname}</p>
              </section>
            );
          }

          window.mountNavigation = (roleKey, initialPath) => {
            window.__navigationRole = roleKey;
            window.__navigationLoggedOut = false;
            createRoot(document.getElementById('root')).render(
              <MemoryRouter initialEntries={[initialPath]}>
                <Routes>
                  <Route path="/app/:role/*" element={<DashboardLayout roleKey={roleKey} />}>
                    <Route path="*" element={<RouteProbe />} />
                  </Route>
                </Routes>
              </MemoryRouter>
            );
          };
        `,
      },
      plugins: [{
        name: 'navigation-fixtures',
        setup(builder) {
          builder.onResolve({ filter: /^@\// }, ({ path }) =>
            Object.hasOwn(modules, path) ? { path, namespace: 'navigation-fixtures' } : null);
          builder.onLoad({ filter: /.*/, namespace: 'navigation-fixtures' }, ({ path }) => ({
            contents: modules[path],
            loader: 'jsx',
            resolveDir: frontend,
          }));
        },
      }],
    }),
    postcss([tailwindcss(fileURLToPath(new URL('../../tailwind.config.js', import.meta.url)))])
      .process(css.replace(/^@import .+;$/gm, ''), { from: fileURLToPath(cssUrl) }),
  ]);
  fixture = bundle.outputFiles[0].text;
  stylesheet = compiled.css;
});

async function mount(page, roleKey, initialPath = `/app/${roleKey}/dashboard`) {
  await page.route('**/*', (route) => route.abort());
  await page.setContent('<div id="root"></div>');
  await page.addStyleTag({ content: stylesheet });
  await page.addScriptTag({ content: fixture });
  await page.evaluate(({ role, path }) => window.mountNavigation(role, path), {
    role: roleKey,
    path: initialPath,
  });
  await expect(page.locator('.kalusagap-shell')).toBeVisible();
  await expect(page.getByTestId('route-probe')).toHaveAttribute('data-path', initialPath);
}

async function expectNoPageOverflow(page, label) {
  const metrics = await page.evaluate(() => ({
    viewport: window.innerWidth,
    documentWidth: document.documentElement.scrollWidth,
    bodyWidth: document.body.scrollWidth,
  }));
  expect(metrics.documentWidth, `${label}: document overflow (${JSON.stringify(metrics)})`)
    .toBeLessThanOrEqual(metrics.viewport);
  expect(metrics.bodyWidth, `${label}: body overflow (${JSON.stringify(metrics)})`)
    .toBeLessThanOrEqual(metrics.viewport);
}

for (const roleKey of Object.keys(roles)) {
  const role = roles[roleKey];

  for (const viewport of viewports) {
    test(`${roleKey} shell has no page overflow at ${viewport.width}x${viewport.height}`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await mount(page, roleKey);
      await expectNoPageOverflow(page, `${roleKey} dashboard at ${viewport.width}x${viewport.height}`);
    });
  }

  for (const viewport of mobileViewports) {
    test(`${roleKey} mobile drawer opens, closes, and navigates at ${viewport.width}x${viewport.height}`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await mount(page, roleKey);

      const menuButton = page.getByRole('button', { name: 'Open navigation menu' });
      const mobileNav = page.locator('aside[aria-label="Mobile navigation"]');
      await expect(menuButton).toHaveAttribute('aria-expanded', 'false');
      await menuButton.click();
      await expect(menuButton).toHaveAttribute('aria-expanded', 'true');
      await expect(mobileNav).toBeVisible();
      await expect(mobileNav.getByRole('link', { name: role.feature, exact: true })).toBeVisible();
      await expectNoPageOverflow(page, `${roleKey} open drawer at ${viewport.width}px`);

      await page.keyboard.press('Escape');
      await expect(mobileNav).toBeHidden();
      await menuButton.click();
      await expect(mobileNav).toBeVisible();
      await mobileNav.getByRole('button', { name: 'Close menu' }).click();
      await expect(mobileNav).toBeHidden();

      await menuButton.click();
      await expect(mobileNav).toBeVisible();
      await page.locator('[class~="bg-slate-900/40"]').click({
        position: { x: viewport.width - 4, y: 4 },
      });
      await expect(mobileNav).toBeHidden();

      await menuButton.click();
      await mobileNav.getByRole('link', { name: role.feature, exact: true }).click();
      await expect(page.getByTestId('route-probe')).toHaveAttribute('data-path', role.featurePath);
      await expect(mobileNav).toBeHidden();
      await expect(menuButton).toHaveAttribute('aria-expanded', 'false');
    });
  }

  for (const viewport of viewports) {
    test(`${roleKey} account dropdown links work at ${viewport.width}x${viewport.height}`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await mount(page, roleKey);

      const accountButton = page.getByRole('button', { name: 'Account menu' });
      const accountMenu = page.locator('div[class~="top-full"][class~="w-72"]');
      await accountButton.click();
      await expect(accountButton).toHaveAttribute('aria-expanded', 'true');
      await expect(accountMenu).toBeVisible();
      await expect(accountMenu).toContainText(role.name);
      await expect(accountMenu).toContainText(role.email);
      await expect(accountMenu.getByRole('link', { name: 'Profile', exact: true })).toBeVisible();
      await expect(accountMenu.getByRole('link', { name: 'Settings', exact: true })).toBeVisible();
      await expectNoPageOverflow(page, `${roleKey} account dropdown at ${viewport.width}px`);

      await accountMenu.getByRole('link', { name: 'Profile', exact: true }).click();
      await expect(page.getByTestId('route-probe')).toHaveAttribute('data-path', `/app/${roleKey}/profile`);
      await expect(accountButton).toHaveAttribute('aria-expanded', 'false');

      await mount(page, roleKey);
      await accountButton.click();
      await accountMenu.getByRole('link', { name: 'Settings', exact: true }).click();
      await expect(page.getByTestId('route-probe')).toHaveAttribute('data-path', `/app/${roleKey}/settings`);
      await expect(accountButton).toHaveAttribute('aria-expanded', 'false');
    });
  }

  test(`${roleKey} desktop sidebar collapses and expands at 1366x768`, async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    await mount(page, roleKey);

    const sidebar = page.locator('aside.app-sidebar').first();
    await expect(sidebar).toBeVisible();
    await expect(sidebar).toHaveAttribute('data-sidebar-state', 'expanded');
    await expect(page.getByRole('button', { name: 'Open navigation menu' })).toBeHidden();
    await expect(page.getByRole('link', { name: 'Dashboard', exact: true }).first()).toBeVisible();
    await expectNoPageOverflow(page, `${roleKey} expanded desktop sidebar`);

    await page.getByRole('button', { name: 'Collapse sidebar' }).click();
    await expect(sidebar).toHaveAttribute('data-sidebar-state', 'collapsed');
    await expect(page.getByRole('button', { name: 'Expand sidebar' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Dashboard', exact: true }).first()).toBeVisible();
    await expectNoPageOverflow(page, `${roleKey} collapsed desktop sidebar`);

    await page.getByRole('button', { name: 'Expand sidebar' }).click();
    await expect(sidebar).toHaveAttribute('data-sidebar-state', 'expanded');
    await expectNoPageOverflow(page, `${roleKey} restored desktop sidebar`);
  });
}
