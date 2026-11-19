import { test, expect } from '@playwright/test';
import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import postcss from 'postcss';
import tailwindcss from 'tailwindcss';

// MOCKED BROWSER COVERAGE: this fixture bundles the production React components
// but replaces every service/context boundary with deterministic in-memory data.
// It blocks browser network requests and does not use real accounts or a database.
test.use({ video: 'off' });

const frontend = fileURLToPath(new URL('../../', import.meta.url));
const modules = {
  '@/components/common/PageHeader': `import React from 'react'; export default function PageHeader({ title, subtitle }) { return <header><h1>{title}</h1><p>{subtitle}</p></header>; }`,
  '@/components/common/Card': `import React from 'react'; export const Card = ({ children, className = '', ...props }) => <section className={className} {...props}>{children}</section>;`,
  '@/components/system': `import React from 'react'; export function ButtonSelectGroup({ ariaLabel, options, value, onChange }) { return <div role="group" aria-label={ariaLabel}>{options.map(option => <button type="button" key={option} aria-pressed={value === option} onClick={() => onChange(option)}>{option}</button>)}</div>; }`,
  '@/components/common/SearchableSelect': `import React, { useState } from 'react'; export default function SearchableSelect({ value, onChange, options, placeholder, error }) { const [open, setOpen] = useState(false); return <div><input role="combobox" aria-label="Barangay" aria-expanded={open} placeholder={placeholder} value={value} onFocus={() => setOpen(true)} onChange={event => { onChange(event.target.value); setOpen(true); }} />{open && <div role="listbox">{options.map(option => <button role="option" type="button" key={option} onClick={() => { onChange(option); setOpen(false); }}>{option}</button>)}</div>}{error && <p role="alert">{error}</p>}</div>; }`,
  '@/components/tables/TablePagination': `export default function TablePagination() { return null; }`,
  '@/context/AuthContext': `export const useAuth = () => ({ user: { id: 'mock-rhu-user', name: 'Mock RHU Clinician', role: 'rhu_personnel' } });`,
  '@/context/BarangaysContext': `export const useBarangays = () => ({ records: [{ id: 'barangay-1', name: 'Test Barangay', status: 'Active' }], loading: false, error: null });`,
  '@/services/api': `export const intakeApi = { getResident: async () => ({}), searchResidentsOffline: async () => [] }; export const referralsApi = { inbox: async () => ({ rows: [] }) }; export const medicinesApi = { list: async ({ q }) => { window.mockMedicineQueries.push(q); return { medicines: [{ id: 'catalog-med-1', genericName: 'Mock medicine', brandName: '', strength: '10 mg', dosageForm: 'Tablet', dosageInstructions: 'Catalog default directions must not be copied' }] }; } };`,
  '@/hooks/usePhnWorkflow': `export const usePhnWorkflow = () => ({ patients: [], sendToPhnQueue: async payload => { window.mockTriageCalls.push(payload); if (window.mockTriageGate) await new Promise(resolve => { window.resolveMockTriage = resolve; }); if (window.mockTriageFailure) throw new Error(window.mockTriageFailure); return { confirmed: true, id: 'mock-submission-1' }; } });`,
  '@/services/api/phnWorkflow': `export const phnWorkflowApi = { listConsultationHealthServices: async () => [] };`,
  '@/features/certificates/components/MedicalCertificateModal': `import React from 'react'; export default function MedicalCertificateModal() { return null; }`,
  '@/lib/dateUtils': `export const formatClinicalDateTime = value => ({ date: value || '—', time: '—' });`,
};

let fixture;
let stylesheet;

test.beforeAll(async () => {
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
          import React, { useState } from 'react';
          import { createRoot } from 'react-dom/client';
          import { MemoryRouter } from 'react-router-dom';
          import RhuTriage from './src/features/triage/pages/RhuTriage.jsx';
          import PhnCheckupWorkbench from './src/features/consultations/components/PhnCheckupWorkbench.jsx';
          import { mapVisitToPatient } from './src/lib/phnWorkflowMap.js';

          window.mockTriageCalls = [];
          window.mockMedicineQueries = [];
          let root;
          const resetRoot = () => { root?.unmount(); root = createRoot(document.getElementById('root')); };
          window.mountTriage = () => {
            window.mockTriageCalls = [];
            resetRoot();
            root.render(<MemoryRouter><RhuTriage /></MemoryRouter>);
          };
          function WorkbenchHost({ initialVisit }) {
            const [visit, setVisit] = useState(initialVisit);
            window.setMockWorkbenchVisit = (nextVisit) => setVisit(nextVisit);
            return <PhnCheckupWorkbench
              patient={mapVisitToPatient(visit)}
              onClose={() => { window.mockWorkbenchClosed = true; }}
              onComplete={async saved => { window.mockCompletedCheckup = saved; }}
            />;
          }
          window.mountWorkbench = visit => {
            window.mockMedicineQueries = [];
            resetRoot();
            root.render(<WorkbenchHost initialVisit={visit} />);
          };
          window.mapMockVisit = mapVisitToPatient;
        `,
      },
      plugins: [{
        name: 'rhu-mocked-browser-fixtures',
        setup(builder) {
          builder.onResolve({ filter: /^@\// }, ({ path }) =>
            Object.hasOwn(modules, path) ? { path, namespace: 'rhu-fixtures' } : null,
          );
          builder.onLoad({ filter: /.*/, namespace: 'rhu-fixtures' }, ({ path }) => ({
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

async function mount(page, expression, arg) {
  await page.route('**/*', route => route.abort());
  await page.setContent('<main class="p-3"><div id="root"></div></main>');
  await page.evaluate(() => Object.defineProperty(window.crypto, 'randomUUID', {
    configurable: true,
    value: () => 'mock-client-submission-id',
  }));
  await page.addStyleTag({ content: stylesheet });
  await page.addScriptTag({ content: fixture });
  await page.evaluate(({ expression, arg }) => window[expression](arg), { expression, arg });
}

async function completePatientStep(page) {
  await page.getByRole('button', { name: 'Register Walk-in Patient' }).click();
  await page.getByLabel('Patient Name').fill('Test Patient');
  await page.getByLabel('Age').fill('34');
  await page.getByRole('button', { name: 'Male', exact: true }).click();
  await page.getByRole('combobox', { name: 'Barangay' }).fill('Test');
  await page.getByRole('option', { name: 'Test Barangay' }).click();
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByRole('button', { name: 'Continue to Triage', exact: true }).click();
}

async function completeVitalsStep(page, values = {}) {
  await page.locator('#triage-heightCm').fill(values.height ?? '170');
  await page.locator('#triage-weightKg').fill(values.weight ?? '65');
  await page.getByLabel('Blood Pressure').fill(values.bp ?? '120/80');
  await page.locator('#triage-bloodSugar').fill(values.sugar ?? '100');
}

async function expectInfoItem(dialog, label, value) {
  await expect(dialog.getByText(label, { exact: true }).locator('..').locator('p').nth(1)).toHaveText(value);
}

async function expectTriageNotes(dialog, value) {
  await expect(dialog.getByText('Triage Notes', { exact: true }).locator('..').locator('p').nth(1)).toHaveText(value);
}

const mappedVisit = (overrides = {}) => ({
  id: 'visit-1',
  residentId: 'resident-1',
  status: 'in_review',
  visitDate: '2026-11-19',
  resident: { id: 'resident-1', firstName: 'Mapped', lastName: 'Patient', age: 42, sex: 'Female', barangay: 'Test Barangay' },
  triageSnapshot: {
    residentId: 'resident-1',
    resident: { firstName: 'Mapped', lastName: 'Patient', age: 42, sex: 'Female', barangay: 'Test Barangay' },
    visitDate: '2026-11-19', submittedAt: '2026-11-19T09:30:00Z',
    recordedByName: 'Mock RHU Clinician', chiefComplaint: 'Routine check-up',
    clinicalHistory: 'Reports feeling well.',
    vitals: { temperature: 36.7, bp: '120/80', hr: 72, rr: 16, o2sat: 98, heightCm: 170, weightKg: 65, bmi: 22.5, bloodSugar: 100 },
  },
  ...overrides,
});

test('RHU triage validates patient identity, measurements, three input steps, and retains back-navigation values', async ({ page }) => {
  await mount(page, 'mountTriage');
  await page.getByRole('button', { name: 'Register Walk-in Patient' }).click();

  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.getByText(/enter the patient's name/i)).toBeVisible();
  await expect(page.getByText(/whole-number age from 0 to 120/i)).toBeVisible();
  await expect(page.getByText(/choose the patient's sex/i)).toBeVisible();

  await page.getByLabel('Patient Name').fill('Test Patient 3');
  await page.getByLabel('Age').fill('121');
  await page.getByRole('combobox', { name: 'Barangay' }).fill('Test');
  await page.getByRole('option', { name: 'Test Barangay' }).click();
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.getByText(/without numbers/i)).toBeVisible();
  await expect(page.getByText(/whole-number age from 0 to 120/i)).toBeVisible();
  await expect(page.getByText(/choose the patient's sex/i)).toBeVisible();

  await page.getByLabel('Patient Name').fill('Test Patient');
  await page.getByLabel('Age').fill('34');
  await page.getByRole('button', { name: 'Male', exact: true }).click();
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByRole('button', { name: 'Continue to Triage', exact: true }).click();

  await completeVitalsStep(page, { bp: '120-80', weight: '-4' });
  await page.getByRole('button', { name: 'Review Triage', exact: true }).click();
  await expect(page.getByText(/number from 0\.3 to 500 for weight/i)).toBeVisible();
  await expect(page.getByText(/systolic\/diastolic whole numbers/i)).toBeVisible();
  await page.locator('#triage-weightKg').fill('65');
  await page.getByLabel('Blood Pressure').fill('120/80');
  await expect(page.getByText('22.5', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Check-up', exact: true }).click();
  await page.getByLabel('Notes / Clinical History (optional)').fill('Reports feeling well.');
  await page.getByRole('button', { name: 'Review Triage', exact: true }).click();

  await expect(page.getByRole('heading', { name: 'Review' })).toBeVisible();
  await expect(page.getByText('Test Patient', { exact: true })).toBeVisible();
  await expect(page.getByText('22.5', { exact: true })).toBeVisible();
  await expect(page.getByText('Reports feeling well.', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Visit Details' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Check-up', exact: true })).toHaveClass(/border-brand-blue/);
  await expect(page.getByLabel('Notes / Clinical History (optional)')).toHaveValue('Reports feeling well.');
  await expect(page.locator('#triage-heightCm')).toHaveValue('170');
  await expect(page.locator('#triage-weightKg')).toHaveValue('65');
  await expect(page.getByLabel('Blood Pressure')).toHaveValue('120/80');
  await expect(page.locator('#triage-bloodSugar')).toHaveValue('100');
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(page.getByText('Test Patient', { exact: true })).toBeVisible();
  await expect(page.getByText('34', { exact: true })).toBeVisible();
  await expect(page.getByText('Male', { exact: true })).toBeVisible();
});

test('RHU triage ignores a rapid duplicate submit and preserves review data after mocked send failure', async ({ page }) => {
  await mount(page, 'mountTriage');
  await completePatientStep(page);
  await completeVitalsStep(page);
  await page.getByRole('button', { name: 'Check-up', exact: true }).click();
  await page.getByRole('button', { name: 'Review Triage', exact: true }).click();
  await page.evaluate(() => {
    window.mockTriageGate = true;
    window.mockTriageFailure = 'Mocked send failure';
  });

  const submit = page.getByRole('button', { name: 'Send to Consultation' });
  await submit.dblclick();
  await expect.poll(() => page.evaluate(() => window.mockTriageCalls.length)).toBe(1);
  await expect(page.getByRole('button', { name: /Sending/ })).toBeDisabled();
  await page.evaluate(() => window.resolveMockTriage());
  await expect(page.getByRole('alert').filter({ hasText: 'Mocked send failure' }).last()).toContainText('Mocked send failure');
  await expect(page.getByRole('heading', { name: 'Review' })).toBeVisible();
  await expect(page.getByText('Test Patient', { exact: true })).toBeVisible();
  await expect(page.getByText('120/80 mmHg', { exact: true })).toBeVisible();
  await expect(page.getByText('Routine check-up', { exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => window.mockTriageCalls.length)).toBe(1);
  expect(await page.evaluate(() => window.mockTriageCalls[0])).toMatchObject({
    patient: 'Test Patient', age: 34, sex: 'Male', bloodPressure: '120/80', weight: '65', heightCm: '170', bloodSugar: '100',
  });
});

test('mapped triage vitals render in the workbench and absent fields are explicitly Not recorded', async ({ page }) => {
  await mount(page, 'mountWorkbench', mappedVisit());
  const dialog = page.getByRole('dialog', { name: 'PHN check-up for Mapped Patient' });
  for (const [label, value] of [
    ['Patient Name', 'Mapped Patient'], ['Age at Triage', '42 yrs'], ['Sex', 'Female'], ['Patient ID', 'resident-1'],
    ['Date of Visit', '2026-11-19'], ['Barangay', 'Test Barangay'], ['Chief Complaint / Reason for Visit', 'Routine check-up'],
  ]) {
    await expectInfoItem(dialog, label, value);
  }
  for (const [label, value] of [
    ['Height', '170 cm'], ['Weight', '65 kg'], ['BMI', '22.5 kg/m²'], ['Blood Pressure', '120/80 mmHg'],
    ['Blood Sugar', '100 mg/dL'], ['Temperature', '36.7 °C'], ['Pulse Rate', '72 bpm'],
    ['Respiratory Rate', '16 /min'], ['O2 Saturation', '98 %'], ['Triage Date and Time', '2026-11-19T09:30:00Z'],
    ['Triage Personnel', 'Mock RHU Clinician'], ['Triage / Encounter ID', 'visit-1'],
  ]) {
    await expectInfoItem(dialog, label, value);
  }

  const missing = mappedVisit({
    id: null, residentId: 'resident-missing',
    resident: { id: 'resident-missing', firstName: 'No', lastName: 'Measurements' },
    triageSnapshot: { residentId: 'resident-missing', resident: { firstName: 'No', lastName: 'Measurements' }, vitals: {} },
  });
  await page.evaluate(visit => window.setMockWorkbenchVisit(visit), missing);
  const emptyDialog = page.getByRole('dialog', { name: 'PHN check-up for No Measurements' });
  for (const label of ['Chief Complaint / Reason for Visit', 'Height', 'Weight', 'BMI', 'Blood Pressure', 'Blood Sugar', 'Temperature', 'Pulse Rate', 'Respiratory Rate', 'O2 Saturation', 'Triage Date and Time', 'Triage Personnel', 'Triage / Encounter ID']) {
    await expectInfoItem(emptyDialog, label, 'Not recorded');
  }
  await expectTriageNotes(emptyDialog, 'Not recorded');
});

test('unfinished consultation hydrates saved medication fields and changing patients clears the draft', async ({ page }) => {
  const visitA = mappedVisit({
    id: 'draft-visit-a', residentId: 'resident-a', resident: { id: 'resident-a', firstName: 'Draft', lastName: 'Patient A' },
    findings: 'Saved assessment A', recommendation: 'Saved recommendation A', phn: { assessment: 'Saved health concern A', notes: 'Saved clinical notes A' },
    medications: [{ medicineId: 'medicine-a', genericName: 'Saved medicine A', dose: '1 tablet', frequency: 'Daily', route: 'Oral', duration: '5 days', quantity: '5', instructions: 'After meals' }],
    triageSnapshot: { residentId: 'resident-a', resident: { firstName: 'Draft', lastName: 'Patient A' }, vitals: {} },
  });
  await mount(page, 'mountWorkbench', visitA);
  const dialogA = page.getByRole('dialog', { name: 'PHN check-up for Draft Patient A' });
  await expect(dialogA.getByLabel('Assessment / Findings')).toHaveValue('Saved assessment A');
  await expect(dialogA.getByLabel('Health Concern')).toHaveValue('Saved health concern A');
  await expect(dialogA.getByLabel('Clinical Notes')).toHaveValue('Saved clinical notes A');
  await expect(dialogA.getByLabel('Recommendations')).toHaveValue('Saved recommendation A');
  await expect(dialogA.getByLabel('Dose')).toHaveValue('1 tablet');
  await expect(dialogA.getByLabel('Frequency')).toHaveValue('Daily');
  await expect(dialogA.getByLabel('Additional instructions')).toHaveValue('After meals');

  const visitB = mappedVisit({
    id: 'draft-visit-b', residentId: 'resident-b', resident: { id: 'resident-b', firstName: 'Draft', lastName: 'Patient B' },
    triageSnapshot: { residentId: 'resident-b', resident: { firstName: 'Draft', lastName: 'Patient B' }, vitals: {} },
  });
  await page.evaluate(visit => window.setMockWorkbenchVisit(visit), visitB);
  const dialogB = page.getByRole('dialog', { name: 'PHN check-up for Draft Patient B' });
  await expect(dialogB.getByLabel('Assessment / Findings')).toHaveValue('');
  await expect(dialogB.getByLabel('Recommendations')).toHaveValue('');
  await expect(dialogB.getByLabel('Dose')).toHaveCount(0);
  await expect(dialogB.getByText('Saved medicine A', { exact: true })).toHaveCount(0);
});

test('new medication entries do not inherit catalog dosage, route, frequency, or duration', async ({ page }) => {
  await mount(page, 'mountWorkbench', mappedVisit({ id: 'medication-visit', medications: [], findings: '' }));
  const dialog = page.getByRole('dialog', { name: 'PHN check-up for Mapped Patient' });
  const search = dialog.getByRole('textbox', { name: 'Search medicine by generic or brand name' });
  await search.fill('Mock medicine');
  await expect.poll(() => page.evaluate(() => window.mockMedicineQueries.length)).toBeGreaterThan(0);
  await expect(dialog.getByText(/Catalog default directions/)).toHaveCount(0);
  await expect(dialog.getByRole('option').getByRole('button')).toBeVisible();
  await dialog.getByRole('option').getByRole('button').click();

  for (const field of ['Dose', 'Route', 'Frequency', 'Duration', 'Quantity', 'Additional instructions']) {
    await expect(dialog.getByLabel(field)).toHaveValue('');
  }
  expect(await page.evaluate(() => window.mockMedicineQueries)).toContain('Mock medicine');
});
