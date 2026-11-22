import { test, expect } from '@playwright/test';
import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import postcss from 'postcss';
import tailwindcss from 'tailwindcss';

test.use({ channel: process.env.RESIDENT_UI_BROWSER_CHANNEL || undefined, video: 'off' });
test.describe.configure({ mode: 'serial' });
test.setTimeout(120_000);

const frontend = fileURLToPath(new URL('../../', import.meta.url));
const residentName = 'Marisol Dela Cruz with a deliberately long registered name';
const address = 'Purok 12 Riverside Extension near the Municipal Health Center, Barangay San Jose, Pili, Camarines Sur';
const longReview = 'Please provide a clearer copy of the document and confirm your current residence with the barangay health office. '.repeat(30);
const consultationNote = 'Follow up after the community health assessment and review the recorded recommendations with the resident. '.repeat(5);
const recordData = {
  resident: {
    name: residentName,
    barangay: 'San Jose Riverside Extension Barangay',
    birthDate: '1994-03-12',
    age: 32,
    sex: 'Female',
    verificationStatus: 'Approved',
  },
  consultations: [{
    id: 'consultation-1', date: '2026-11-10', time: '09:15', status: 'completed',
    serviceCategory: 'Community Health Assessment', seenBy: 'Nurse Maria Santos',
    chiefComplaint: consultationNote, findings: consultationNote, diagnosis: consultationNote,
    medications: 'Vitamin supplement as directed', treatmentGiven: consultationNote,
    recommendations: consultationNote, serviceName: 'Community Health Assessment',
    followUpRequired: 'Yes', nextVisitDate: '2026-12-10',
    vitals: { bloodPressure: '120/80', temperature: '36.7', pulseRate: '72', respiratoryRate: '18', oxygenSaturation: '98', height: '158', weight: '58', bmi: '23.2', bmiCategory: 'normal' },
  }],
  vaccinations: [{ id: 'vaccine-1', name: 'Seasonal Influenza Vaccine', dose: 'Dose 1', date: '2026-10-20', status: 'Complete' }],
  healthServiceRecords: [{
    id: 'service-1', serviceName: 'Community Nutrition and Wellness Support Program',
    serviceCategory: 'Community Health', date: '2026-11-12',
    serviceProvided: consultationNote, assessment: consultationNote,
    recommendations: consultationNote, followUpRequired: true,
    followUpDate: '2026-12-12', notes: consultationNote,
  }],
};

const modules = {
  '@/features/health-records/components/LabResultsPanel': 'export default function LabResultsPanel() { return null; }',
  '@/context/AuthContext': `export const useAuth = () => ({ user: { id: 'synthetic-resident', name: ${JSON.stringify(residentName)}, email: 'resident@example.test', role: 'resident' }, refreshProfile: async () => {}, logout: async () => {} });`,
  '@/context/ThemeContext': `export const useTheme = () => ({ theme: 'light', setTheme: () => {} });`,
  '@/lib/brand': `export const ROLES = { resident: { name: 'Resident' }, 'resident-limited': { name: 'Resident' } };`,
  '@/lib/barangayScope': `export const getAssignedBarangay = () => '';`,
  '@/lib/supabase': `export const supabase = { auth: { getSession: async () => ({ data: { session: { user: { email: 'resident@example.test' }, expires_at: 1893456000 } } }), signInWithPassword: async () => ({ error: null }), updateUser: async () => ({ error: null }) } };`,
  '@/services/api/verificationsApi': `export const fetchMyVerification = async () => window.verificationFixture; export const resubmitOwnVerification = async () => ({});`,
  '@/services/api/apiClient': `export const postFormData = async () => ({ document: {} });`,
  '@/services/api': `
    export const residentsApi = {
      updateMine: async (payload) => { window.profileSavePayload = payload; return { profile: { cellphoneNo: payload.cellphoneNo } }; },
      myHealthRecords: async (params) => { window.healthRecordParams = params; return ${JSON.stringify(recordData)}; },
    };
    export const visitPlansApi = { directory: async () => ({ facilities: [{ services: [{ id: 'service-1', name: 'Community Health Assessment', category: 'Community Health', active: true }] }] }) };
    export const authApi = { updateMe: async () => ({ user: {} }) };
    export const registrationApi = { registerResident: async () => ({}) };
    export const api = { get: async () => ({ transfer: null }) };`,
  '@/features/health-records/lib/healthRecordPdf': `export const downloadHealthRecordPdf = async () => {};`,
  '@/features/verification/components/VerificationBadge': `import React from 'react'; export default function VerificationBadge({ status }) { return <span>{status}</span>; }`,
  '@/features/registration/components/UploadComponent': `import React from 'react'; export default function UploadComponent({ label }) { return <div className="rounded border p-3">{label}</div>; }`,
  '@/features/settings/components/OfficialLogosSection': `import React from 'react'; export default function OfficialLogosSection() { return null; }`,
  '@/layouts/NavTabsLayout': `import React from 'react'; export function NavTabs() { return null; }`,
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
      stdin: { resolveDir: frontend, loader: 'jsx', contents: `
        import React from 'react';
        import { createRoot } from 'react-dom/client';
        import { MemoryRouter } from 'react-router-dom';
        import SettingsPage from './src/features/settings/pages/SettingsPage.jsx';
        import HealthRecord from './src/features/health-records/pages/HealthRecord.jsx';
        window.mountResidentPage = (page) => createRoot(document.getElementById('root')).render(
          <MemoryRouter initialEntries={[page === 'profile' ? '/app/resident/profile' : '/app/resident/record']}>
            {page === 'profile' ? <SettingsPage roleKey="resident" /> : <HealthRecord />}
          </MemoryRouter>
        );`,
      },
      plugins: [{ name: 'resident-fixtures', setup(builder) {
        builder.onResolve({ filter: /^@\// }, ({ path }) => Object.hasOwn(modules, path) ? { path, namespace: 'resident-fixtures' } : null);
        builder.onLoad({ filter: /.*/, namespace: 'resident-fixtures' }, ({ path }) => ({ contents: modules[path], loader: 'jsx', resolveDir: frontend }));
      } }],
    }),
    postcss([tailwindcss(fileURLToPath(new URL('../../tailwind.config.js', import.meta.url)))])
      .process(css.replace(/^@import .+;$/gm, ''), { from: fileURLToPath(cssUrl) }),
  ]);
  fixture = bundle.outputFiles[0].text;
  stylesheet = compiled.css;
});

async function mount(page, screen, verificationStatus = 'approved') {
  await page.route('**/*', (route) => route.abort());
  await page.setContent('<div class="min-w-0 lg:ml-72"><main class="app-main mx-auto min-w-0 max-w-[1180px] px-3 py-5 sm:px-4 sm:py-6 md:px-8 md:py-8"><div id="root"></div></main></div>');
  await page.addStyleTag({ content: stylesheet });
  await page.addScriptTag({ content: fixture });
  await page.evaluate(({ screen, verificationStatus, residentName, address, rejectionReason }) => {
    window.profileSavePayload = null;
    window.verificationFixture = {
      hasResidentRecord: true,
      verification: {
        id: 'verification-1', status: verificationStatus, name: residentName,
        barangay: 'San Jose Riverside Extension Barangay', birthDate: '1994-03-12', age: 32,
        sex: 'Female', address, contactNumber: '09171234567',
        municipality: 'Pili, Camarines Sur', registeredDate: '2026-01-10', ref: 'RES-2026-0001',
        submittedAt: '2026-01-10', rejectionReason,
      },
    };
    window.mountResidentPage(screen);
  }, { screen, verificationStatus, residentName, address, rejectionReason: longReview });
}

const viewports = [
  { width: 390, height: 844, name: '390x844' },
  { width: 768, height: 1024, name: '768x1024' },
  { width: 1366, height: 768, name: '1366x768' },
];

for (const viewport of viewports) {
  test(`resident profile form and details remain usable at ${viewport.name}`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await mount(page, 'profile');
    await expect(page.getByRole('heading', { name: 'Resident details' })).toBeVisible();
    await expect(page.locator('dd').filter({ hasText: address })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    expect(await page.locator('dd').evaluateAll((values) => values.every((value) => value.scrollWidth <= value.clientWidth))).toBe(true);

    const contactInput = page.locator('input').nth(2);
    await expect(contactInput).toHaveValue('09171234567');
    const bounds = await contactInput.boundingBox();
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(viewport.width);
    await contactInput.fill('09175551234');
    await page.getByRole('button', { name: 'Save Changes' }).click();
    await expect.poll(() => page.evaluate(() => window.profileSavePayload)).toEqual({ cellphoneNo: '09175551234' });
    await expect(page.getByText('Profile updated successfully.')).toBeVisible();

    await page.getByRole('button', { name: 'Change Password', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('Please fill in all password fields.');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });

  test(`resident health record wraps its summaries and history at ${viewport.name}`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await mount(page, 'health-record');
    await expect(page.getByRole('heading', { name: 'My Health Record' })).toBeVisible();
    await expect(page.getByText(residentName, { exact: true })).toBeVisible();
    const summary = page.locator('.ui-card').first().locator('div.grid').first();
    const expectedColumns = viewport.width < 640 ? 2 : viewport.width < 1280 ? 3 : 6;
    expect(await summary.evaluate((element) => getComputedStyle(element).gridTemplateColumns.split(' ').length)).toBe(expectedColumns);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

    await page.getByRole('tab', { name: 'Consultation History' }).click();
    await expect(page.getByRole('heading', { name: 'Consultation History' })).toBeVisible();
    await expect(page.getByText(consultationNote, { exact: true }).first()).toBeVisible();
    await page.getByLabel('From date').fill('2026-12-01');
    await page.getByLabel('To date').fill('2026-11-01');
    await expect(page.getByRole('alert')).toContainText('The end date cannot be before the start date.');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

    await page.getByRole('tab', { name: 'Health Service History' }).click();
    await expect(page.getByRole('heading', { name: 'Health Service History' })).toBeVisible();
    await expect(page.getByText('Community Nutrition and Wellness Support Program', { exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
}

test('resident verification resubmission dialog fits and scrolls at 390x844', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mount(page, 'profile', 'resubmission_required');
  await page.getByRole('button', { name: 'Resubmit Documents' }).click();
  const overlay = page.locator('.fixed.inset-0').last();
  const dialog = overlay.locator(':scope > div');
  await expect(page.getByRole('heading', { name: 'Resubmit Verification Documents' })).toBeVisible();
  const bounds = await dialog.boundingBox();
  expect(bounds.x).toBeGreaterThanOrEqual(0);
  expect(bounds.y).toBeGreaterThanOrEqual(0);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(390);
  expect(bounds.y + bounds.height).toBeLessThanOrEqual(844);
  const scrollRegion = dialog.locator('.overflow-y-auto');
  expect(await scrollRegion.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true);
  await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Submit Resubmission' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
