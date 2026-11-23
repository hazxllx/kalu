import { test, expect } from '@playwright/test';
import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import postcss from 'postcss';
import tailwindcss from 'tailwindcss';

test.use({ video: 'off', serviceWorkers: 'block' });

const frontend = fileURLToPath(new URL('../../', import.meta.url));
const emptyChild = 'export default function EmptyChild() { return null; }';
// Keep the consultation form, its event handlers, and both classifiers real.
const modules = {
  '@/components/common/PageHeader': `
    import React from 'react';
    export default function PageHeader({ title, action }) {
      return <header><h1>{title}</h1>{action}</header>;
    }
  `,
  '@/components/common/Card': `
    import React from 'react';
    export const Card = ({ children, ...props }) => <section {...props}>{children}</section>;
  `,
  '@/components/common/StatCard': emptyChild,
  '@/components/common/ErrorState': emptyChild,
  '@/components/common/StatusBadge': emptyChild,
  '@/components/common/RiskBadge': `import React from 'react'; export default function RiskBadge({ level }) { return <span>{level}</span>; }`,
  '@/components/tables/DataTable': `
    import React from 'react';
    import RealDataTable from './src/components/tables/DataTable.jsx';
    export default function DataTable(props) {
      if (window.testActionMenu) return <RealDataTable {...props} />;
      const { rows, renderCell } = props;
      return <table><tbody>{rows.map(row => <tr key={row.id} data-testid={row.id}>
        {['resident', 'risk', 'actions'].map(key => <td key={key}>{renderCell(key, row)}</td>)}
      </tr>)}</tbody></table>;
    }
  `,
  '@/components/tables/TablePagination': emptyChild,
  '@/features/consultations/components/DateRangePicker': emptyChild,
  '@/features/health-records/components/LabResultsPanel': emptyChild,
  '@/context/AuthContext': `export const useAuth = () => ({ user: window.testUser || { id: 'mock-clinician', role: 'rhu_personnel' } });`,
  '@/context/PermissionsContext': `export const usePermissions = () => ({ can: permission => window.testUser || permission === 'consultation.conduct' });`,
  '@/hooks/useAuthorizedData': `export default function useAuthorizedData() { return { data: null, loading: false, error: null }; }`,
  '@/hooks/useSyncStatus': `export const useSyncStatus = () => ({ counts: { pending: 0, failed: 0, conflict: 0 }, syncing: false });`,
  '@/services/api': `
    export const api = {};
    export const consultationsApi = {
      async clinicalContext() {
        if (window.delayClinicalContext) await new Promise(resolve => { (window.releaseClinicalContexts ||= []).push(resolve); });
        return { pregnancy: null, existingConditions: [], previousAssessment: null, age: 35, sourceStatus: 'available', canReviewRisk: false };
      },
      async get(id) {
        const consultation = window.testRecords.find(record => record.id === id)
          || Object.entries(window.testHistory || {}).flatMap(([residentId, rows]) => rows.map(row => ({
            ...row,
            residentId,
            resident: { id: residentId, name: residentId + ' Resident', barangay: window.testUser?.barangay },
            consultationDate: row.consultationDate || row.date,
          }))).find(record => record.id === id);
        if (window.delayedId === id) await new Promise(resolve => { window.releaseDetail = resolve; });
        return { consultation };
      },
      async list({ residentId, status, limit = 100, offset = 0 }) {
        const rows = (window.testHistory?.[residentId] || []).map(row => ({
          ...row,
          residentId,
          resident: { id: residentId, name: residentId + ' Resident', barangay: window.testUser?.barangay },
          consultationDate: row.consultationDate || row.date,
          serviceName: row.serviceName || 'General Consultation',
          status: row.status || 'completed',
        })).filter(row => row.status === status);
        return { rows: rows.slice(offset, offset + limit), total: rows.length };
      },
      async update(id, payload) {
        window.savedConsultation = { id, ...payload };
        const consultation = window.testRecords.find(record => record.id === id);
        Object.assign(consultation, { adviceGiven: payload.adviceGiven });
        if (!window.replayExistingConsultations) Object.assign(consultation, { riskLevel: 'Medium', clinicalAssessment: { level: 'Medium' } });
        return { consultation };
      },
    };
    export const residentsApi = { async healthHistory(id) {
      const rows = window.testHistory?.[id] || [];
      if (window.delayHistory === id) await new Promise(resolve => { window.releaseHistory = resolve; });
      return { residentId: id, consultations: rows, referrals: [], followUps: [], pregnancies: [], maternalRecords: [], vaccinations: [], deliveries: [], screenings: [] };
    } };
    export const healthServicesApi = {};
    export const medicinesApi = { async list({ q }) { return { medicines: [
      { id: '00000000-0000-4000-8000-000000000001', genericName: 'Medicine One', strength: '100 mg', dosageForm: 'Tablet', source: 'local' },
      { id: '00000000-0000-4000-8000-000000000002', genericName: 'Medicine Two', strength: '5 mg/ml', dosageForm: 'Drops', source: 'local' },
    ].filter(medicine => medicine.genericName.toLowerCase().includes(q.toLowerCase())) }; } };
  `,
  '@/services/offline/consultationOfflineService': `
    export const listConsultationDrafts = async () => [];
    export const listConsultationsOffline = async () => structuredClone(window.testRecords || []).map(record => ({ ...record, findings: '' }));
    export const listConsultationResidentsOffline = async () => window.testDirectory || [{ id: 'test-resident', firstName: 'Test', lastName: 'Resident' }];
    export const saveConsultationOffline = async ({ payload }) => {
      window.savedConsultation = payload;
      window.testHistory?.[payload.residentId]?.unshift({ id: 'saved-consultation', date: payload.consultationDate, chiefComplaint: payload.chiefComplaint, vitals: {} });
      return { source: 'server', record: { id: 'saved-consultation' } };
    };
    function unexpectedWrite() { throw new Error('Unexpected consultation write in BP fixture'); }
    export { unexpectedWrite as submitConsultationDraft,
      unexpectedWrite as restoreConsultationDraft, unexpectedWrite as deleteConsultationDraft };
  `,
  '@/services/offline/clinicalOfflineService': `export const listWithOfflineFallback = async () => ({ rows: [] });`,
  '@/services/offline/db': `export const captureOwnerGuard = () => () => true;`,
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
          import React from 'react';
          import { createRoot } from 'react-dom/client';
          import { MemoryRouter } from 'react-router-dom';
          import TreatmentConsultation from './src/features/consultations/pages/TreatmentConsultation.jsx';

          createRoot(document.getElementById('root')).render(<MemoryRouter><TreatmentConsultation /></MemoryRouter>);
        `,
      },
      plugins: [{
        name: 'bp-browser-fixture',
        setup(builder) {
          builder.onResolve({ filter: /^@\// }, ({ path }) =>
            Object.hasOwn(modules, path) ? { path, namespace: 'bp-fixture' } : null,
          );
          builder.onLoad({ filter: /.*/, namespace: 'bp-fixture' }, ({ path }) => ({
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

test.beforeEach(async ({ page }, testInfo) => {
  await page.route('**/*', route => route.abort());
  await page.setContent('<!doctype html><main class="p-3"><div id="root"></div></main>');
  await page.addStyleTag({ content: stylesheet });
  if (testInfo.title.startsWith('supervisor')) {
    await page.evaluate(() => {
      window.testUser = { id: 'mock-clinician', role: 'health_supervisor', barangay: 'San Isidro' };
      window.testRecords = [
        ['one', 'Low', '110/70'], ['two', 'Medium', '135/85'], ['three', 'High', '185/125'], ['four', 'Unassessed', ''],
      ].map(([id, riskLevel, bp]) => ({ id, riskLevel, vitals: { bp },
        resident: { id: `resident-${id}`, name: `Resident ${id}`, barangay: window.testUser.barangay, riskLevel: 'High' },
        consultationDate: '2026-11-20', chiefComplaint: `Complaint ${id}`, findings: `Finding ${id}`,
        consultationTime: '09:15', clinicalIndicators: { dangerSignsReviewed: true },
        diagnosis: `Diagnosis ${id}`, treatmentGiven: `Treatment ${id}`, clinicalAssessment: { level: riskLevel },
        ...(id === 'two' ? { followUpRequired: 'Yes', nextVisitDate: '2026-11-24', referrals: [{ reason: 'Linked referral' }] } : {}),
      }));
    });
  }
  if (testInfo.title.startsWith('supervisor actions menu')) {
    await page.evaluate(() => {
      window.testActionMenu = true;
      document.querySelector('main').classList.add('supervisor-shell');
    });
    await page.addStyleTag({ content: `
      body { padding-bottom: 400px; }
      @media (min-width: 768px) { .consultation-records-table { max-height: 220px; } }
    ` });
  }
  if (testInfo.title === 'supervisor replays each historical record' && process.env.CONSULTATION_REPLAY_ROWS) {
    await page.evaluate((rows) => {
      window.replayExistingConsultations = true;
      window.testUser.barangay = rows[0].resident.barangay;
      window.testRecords = rows;
    }, JSON.parse(process.env.CONSULTATION_REPLAY_ROWS));
  }
  await page.addScriptTag({ content: fixture });
  if (!testInfo.title.startsWith('supervisor')) await page.getByRole('button', { name: 'Add Treatment Consultation', exact: true }).click();
});

test('supervisor history switches residents, ignores late replies, and refreshes after save', async ({ page }) => {
  await page.evaluate(() => {
    window.testDirectory = ['First', 'Second', 'Third'].map(firstName => ({ id: firstName, firstName, lastName: 'Resident', barangay: 'San Isidro' }));
    window.testHistory = { First: [{ id: 'first-visit', date: '2026-11-17', chiefComplaint: 'First private complaint', vitals: {} }],
      Second: [], Third: [{ id: 'third-visit', date: '2026-11-18', chiefComplaint: 'Third private complaint', vitals: {} }] };
    window.delayHistory = 'First';
  });
  // Re-open the fixture with the directory populated before its initial load.
  await page.evaluate(() => { document.getElementById('root').replaceWith(Object.assign(document.createElement('div'), { id: 'root' })); });
  await page.addScriptTag({ content: fixture });
  await page.getByRole('button', { name: 'Add Treatment Consultation', exact: true }).click();
  const select = (name) => page.getByText(`${name} Resident`, { exact: true }).first().click();
  await select('First');
  await expect.poll(() => page.evaluate(() => Boolean(window.releaseHistory))).toBe(true);
  await select('Second');
  await expect(page.getByRole('region', { name: 'Health history summary for Second Resident' })).toContainText('None recorded');
  await page.evaluate(() => window.releaseHistory());
  await expect(page.getByText(/First private complaint/)).toHaveCount(0);
  await select('Third');
  await expect(page.getByText(/Third private complaint/)).toBeVisible();
  await page.locator('input[type=date]').first().fill('2026-11-20');
  await fillRequiredClinical(page);
  await page.getByPlaceholder('e.g. Fever, headache, prenatal check-up').fill('New chart complaint');
  await page.getByRole('button', { name: 'Save Consultation', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Add Treatment Consultation', exact: true })).toBeVisible();
  expect(await page.evaluate(() => window.savedConsultation)).toMatchObject({ residentId: 'Third', chiefComplaint: 'New chart complaint' });
  await page.getByRole('button', { name: 'Add Treatment Consultation', exact: true }).click();
  await select('Third');
  await expect(page.getByText(/New chart complaint/)).toBeVisible();
  await expect(page.getByText(/Third private complaint/)).toBeVisible();
});

test('supervisor replays each historical record', async ({ page }) => {
  test.skip(!process.env.CONSULTATION_REPLAY_ROWS, 'Requires sanitized historical DTOs to replay in the browser fixture');
  const records = JSON.parse(process.env.CONSULTATION_REPLAY_ROWS);
  await expect(page.getByRole('row')).toHaveCount(records.length);
  for (const { id, resident, vitals, riskLevel, findings, treatmentGiven } of records) {
    const actions = page.getByRole('button', { name: `Actions for ${resident.name}` });
    await actions.click();
    await page.getByRole('menuitem', { name: 'View Details', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Consultation details' });
    await expect(dialog).toContainText(resident.name);
    await expect(dialog).toContainText(riskLevel);
    await expect(dialog).toContainText(findings);
    if (vitals.bp) await expect(dialog).toContainText(vitals.bp);
    await dialog.getByRole('button', { name: 'Close consultation details' }).click();
    await actions.click();
    await page.getByRole('menuitem', { name: 'Edit Consultation', exact: true }).click();
    const formHeading = page.getByRole('heading', { name: 'Edit Treatment Consultation' });
    await expect(formHeading.locator('..')).toContainText(riskLevel);
    await expect(bloodPressureField(page).input).toHaveValue(vitals.bp ?? '');
    await expect(page.getByText('Treatment Provided', { exact: true }).locator('..').getByRole('textbox')).toHaveValue(treatmentGiven);
    await page.getByRole('button', { name: 'Update Consultation', exact: true }).click();
    await expect(page.getByTestId(id)).toContainText(riskLevel);
    expect(await page.evaluate(() => window.savedConsultation)).toMatchObject({ id, residentId: resident.id });
  }
});

test('supervisor opens and edits each encounter by ID and filters by encounter risk', async ({ page }) => {
  const filter = page.getByRole('combobox', { name: 'Risk level filter' });
  const rows = page.getByRole('row');
  const open = async (id, action) => {
    await page.getByRole('button', { name: `Actions for Resident ${id}` }).click();
    await page.getByRole('menuitem', { name: action, exact: true }).click();
  };
  await expect(rows).toHaveCount(4);
  for (const [id, risk, bp] of [['one', 'Low', '110/70'], ['two', 'Medium', '135/85'], ['three', 'High', '185/125'], ['four', 'Unassessed', '']]) {
    await filter.selectOption(risk);
    await expect(rows).toHaveCount(id === 'two' ? 2 : 1);
    await expect(page.getByTestId(id)).toContainText(risk);
    await open(id, 'View Details');
    const dialog = page.getByRole('dialog', { name: 'Consultation details' });
    await expect(dialog).toContainText(`Finding ${id}`);
    await expect(dialog).toContainText(risk);
    if (bp) await expect(dialog).toContainText(bp);
    if (id === 'two') {
      await expect(dialog).toContainText('Linked referral');
      await expect(dialog).toContainText('Required');
    }
    await dialog.getByRole('button', { name: 'Close consultation details' }).click();
    await open(id, 'Edit Consultation');
    await expect(page.getByRole('heading', { name: 'Edit Treatment Consultation' }).locator('..')).toContainText(risk);
    await expect(bloodPressureField(page).input).toHaveValue(bp);
    await expect(page.getByText('Treatment Provided', { exact: true }).locator('..').getByRole('textbox')).toHaveValue(`Treatment ${id}`);
    await fillRequiredClinical(page, { bloodPressure: bp || '118/76', findings: `Finding ${id}` });
    await page.getByRole('button', { name: 'Update Consultation', exact: true }).click();
    await expect(filter).toBeVisible();
    expect(await page.evaluate(() => window.savedConsultation)).toMatchObject({ id, residentId: `resident-${id}`, bloodPressure: bp || '118/76' });
    await filter.selectOption('Medium');
    await expect(page.getByTestId(id)).toContainText('Medium');
  }
  await filter.selectOption('All');
  await expect(rows).toHaveCount(4);
  await page.evaluate(() => { window.delayedId = 'one'; });
  await open('one', 'View Details');
  await open('three', 'View Details');
  const dialog = page.getByRole('dialog', { name: 'Consultation details' });
  await expect(dialog).toContainText('Resident three');
  await page.evaluate(() => window.releaseDetail());
  await expect(dialog).toContainText('Resident three');
});

function consultationActions(page, id) {
  return page.getByRole('button', { name: `Actions for Resident ${id}`, exact: true });
}

async function expectMenuPlacement(page, anchor, side) {
  const menu = page.getByRole('menu');
  await expect(menu).toBeVisible();
  await expect.poll(async () => {
    const [{ x, y, width, height }, trigger] = await Promise.all([menu.boundingBox(), anchor.boundingBox()]);
    const { width: vw, height: vh } = page.viewportSize();
    const expectedLeft = Math.max(4, Math.min(trigger.x + trigger.width, vw - 4) - width);
    return {
      inViewport: x >= 0 && y >= 0 && x + width <= vw && y + height <= vh,
      aligned: Math.abs(x - expectedLeft) < 1,
      gap: Math.round(side === 'below' ? y - trigger.y - trigger.height : trigger.y - y - height),
    };
  }).toEqual({ inViewport: true, aligned: true, gap: 4 });
  for (const name of ['View Details', 'Edit Consultation']) {
    const item = menu.getByRole('menuitem', { name, exact: true });
    await expect(item).toBeVisible();
    await expect(item).toBeInViewport({ ratio: 1 });
    await item.click({ trial: true });
  }
}

test('supervisor actions menu escapes the table and tracks both scroll containers', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 950 });
  const table = page.locator('.consultation-records-table');
  const [first, middle, last] = ['two', 'one', 'four'].map(id => consultationActions(page, id));
  await expect(first).toBeVisible();
  const triggers = table.getByRole('button', { name: /^Actions for / });
  await expect(triggers.first()).toHaveAccessibleName('Actions for Resident two');
  await expect(triggers.last()).toHaveAccessibleName('Actions for Resident four');
  await first.click();
  await expectMenuPlacement(page, first, 'below');
  await first.click();
  await expect(page.getByRole('menu')).toHaveCount(0);
  await first.click();
  await middle.click();
  await expect(first).toHaveAttribute('aria-expanded', 'false');
  await expectMenuPlacement(page, middle, 'below');
  await table.evaluate(element => { element.scrollTop = element.scrollHeight; });
  await expectMenuPlacement(page, middle, 'below');
  await table.evaluate(element => { element.scrollTop = 0; });
  await expectMenuPlacement(page, middle, 'below');
  await page.evaluate(() => window.scrollBy(0, 24));
  await expectMenuPlacement(page, middle, 'below');
  await page.getByRole('heading', { name: 'Treatment Consultation', exact: true }).click();
  await expect(page.getByRole('menu')).toHaveCount(0);
  await table.evaluate(element => { element.scrollTop = element.scrollHeight; });
  await last.click();
  await expectMenuPlacement(page, last, 'below');
  expect((await page.getByRole('menu').boundingBox()).y).toBeGreaterThanOrEqual((await table.boundingBox()).y + (await table.boundingBox()).height - 20);
  await page.getByRole('menuitem', { name: 'View Details' }).click();
  await expect(page.getByRole('menu')).toHaveCount(0);
  const dialog = page.getByRole('dialog', { name: 'Consultation details' });
  await expect(dialog).toContainText('Finding four');
  await dialog.getByRole('button', { name: 'Close consultation details' }).click();
  await last.click();
  await page.getByRole('menuitem', { name: 'Edit Consultation' }).click();
  await expect(page.getByRole('menu')).toHaveCount(0);
  await expect(page.getByText('Treatment Provided', { exact: true }).locator('..').getByRole('textbox')).toHaveValue('Treatment four');
});

for (const width of [1024, 375]) {
  test(`supervisor actions menu flips up in a short ${width}px viewport`, async ({ page }) => {
    await page.setViewportSize({ width, height: 360 });
    const anchor = consultationActions(page, 'four');
    await anchor.scrollIntoViewIfNeeded();
    await anchor.evaluate(element => window.scrollBy(0, element.getBoundingClientRect().bottom - window.innerHeight + 20));
    await anchor.click();
    await expectMenuPlacement(page, anchor, 'above');
    await anchor.evaluate(element => window.scrollBy(0, element.getBoundingClientRect().top - 75));
    await expectMenuPlacement(page, anchor, 'below');
    await page.keyboard.press('Escape');
    await expect(page.getByRole('menu')).toHaveCount(0);
    await expect(anchor).toBeFocused();
  });
}

const inputClass = 'min-w-0 flex-1 bg-transparent text-sm font-medium text-slate-900 outline-none placeholder:text-slate-400';
const inputWrapperClass = 'flex w-full min-w-0 items-center rounded-btn border bg-white px-3 py-2 focus-within:border-brand-blue border-brand-border';
const badgeClass = 'inline-flex max-w-full shrink-0 whitespace-normal rounded px-1.5 py-0.5 text-[10px] font-medium leading-tight';

const normal = ['Normal Blood Pressure', 'bg-green-100 text-green-800'];
const elevated = ['Elevated Blood Pressure', 'bg-yellow-100 text-yellow-800'];
const stage1 = ['Stage 1 Hypertension', 'bg-orange-100 text-orange-800'];
const stage2 = ['Stage 2 Hypertension', 'bg-red-100 text-red-800'];
const severe = ['Hypertensive Urgency or Emergency', 'bg-red-900 text-white'];

async function fillRequiredClinical(page, { bloodPressure = '118/76', findings = 'Normal clinical examination' } = {}) {
  for (const [id, value] of [['vital-blood-pressure', bloodPressure], ['vital-temperature', '36.7'], ['vital-pulse', '70'], ['vital-respiratory', '18'], ['vital-height', '160'], ['vital-weight', '60'], ['vital-oxygen', '98'], ['clinical-findings', findings]]) {
    await page.locator(`#${id}`).fill(value);
  }
  await page.getByRole('checkbox', { name: /Clinical history, pregnancy status and warning signs reviewed/ }).check();
}

function bloodPressureField(page) {
  const input = page.getByRole('textbox', { name: 'Blood Pressure (mmHg)', exact: true });
  const wrapper = input.locator('..');
  const field = wrapper.locator('..');
  return {
    input,
    wrapper,
    field,
    badge: field.locator('[aria-label^="Blood pressure category:"]'),
    alert: field.getByRole('alert'),
  };
}

async function expectBadge({ input, wrapper, badge }, [label, colors]) {
  await expect(badge).toHaveCount(1);
  await expect(badge).toBeVisible();
  await expect(badge).toHaveText(label);
  await expect(badge).toHaveAttribute('aria-label', `Blood pressure category: ${label}`);
  await expect(badge).toHaveClass(`${badgeClass} ${colors}`);
  await expect(input).toHaveClass(inputClass);
  await expect(wrapper).toHaveClass(inputWrapperClass);
}

test('formats compact BP and removes the previous badge on invalid or empty edits', async ({ page }) => {
  const bp = bloodPressureField(page);
  await expect(bp.input).toHaveValue('');
  await expect(bp.input).toHaveClass(inputClass);
  await expect(bp.wrapper).toHaveClass(inputWrapperClass);
  await expect(bp.badge).toHaveCount(0);

  await bp.input.focus();
  await page.keyboard.insertText('12080');
  await expect(bp.input).toHaveValue('120/80');
  await expectBadge(bp, stage1);

  await bp.input.fill('120/');
  await expect(bp.input).toHaveValue('120/');
  await expect(bp.badge).toHaveCount(0);

  await bp.input.fill('110/70');
  await expectBadge(bp, normal);
  await bp.input.fill('-120/80');
  await expect(bp.input).toHaveValue('-120/80');
  await expect(bp.badge).toHaveCount(0);
  await bp.input.clear();
  await expect(bp.input).toHaveValue('');
  await expect(bp.badge).toHaveCount(0);
  await expect(bp.input).toHaveClass(inputClass);
  await expect(bp.wrapper).toHaveClass(inputWrapperClass);
});

for (const treatment of ['', 'Rest']) {
  test(`saves required findings and vitals with ${treatment ? 'treatment' : 'no treatment'} and no diagnosis`, async ({ page }) => {
    const findingsLabel = page.getByRole('heading', { name: 'Clinical Findings & Diagnosis', exact: true });
    const treatmentLabel = page.getByText('Treatment Provided', { exact: true });
    await expect(findingsLabel).toBeVisible();
    await expect(treatmentLabel).toBeVisible();
    await page.getByText('Test Resident', { exact: true }).click();
    const save = page.getByRole('button', { name: 'Save Consultation', exact: true });
    await save.click();
    await expect(page.getByText('Chief complaint is required.')).toBeVisible();
    await expect(page.getByText('Record the clinical findings from this consultation.')).toBeVisible();
    await page.getByPlaceholder('e.g. Fever, headache, prenatal check-up').fill('Routine check-up');
    await fillRequiredClinical(page);
    await treatmentLabel.locator('..').getByRole('textbox').fill(treatment);
    await save.click();
    await expect(page.getByText('Consultation saved successfully.')).toBeVisible();
    const payload = await page.evaluate(() => window.savedConsultation);
    expect(payload).toMatchObject({ residentId: 'test-resident', findings: 'Normal clinical examination', diagnosis: '', treatmentGiven: treatment });
    expect(payload).not.toHaveProperty('clinicalFindingsDiagnosis');
  });
}

test('BMI immediately recalculates, invalid required measurements block submission, and edited Manila date/time survive context loading', async ({ page }) => {
  await page.evaluate(() => { window.delayClinicalContext = true; });
  await page.getByText('Test Resident', { exact: true }).click();
  await page.locator('#consultation-date').fill('2026-11-20');
  await page.locator('#consultation-time').fill('13:25');
  await page.getByPlaceholder('e.g. Fever, headache, prenatal check-up').fill('Routine follow-up');
  await fillRequiredClinical(page);
  const bmi = page.locator('#vital-bmi');
  await expect(bmi).toHaveValue('23.4');
  await expect(bmi).toHaveAttribute('readonly', '');
  await page.locator('#vital-height').fill('150');
  await expect(bmi).toHaveValue('26.7');
  await page.locator('#vital-weight').fill('50');
  await expect(bmi).toHaveValue('22.2');
  await page.locator('#vital-temperature').fill('101');
  await page.getByRole('button', { name: 'Save Consultation', exact: true }).click();
  await expect(page.getByText(/Temperature.*between/)).toBeVisible();
  expect(await page.evaluate(() => window.savedConsultation)).toBeUndefined();
  await page.evaluate(() => { window.delayClinicalContext = false; window.releaseClinicalContexts?.forEach(resolve => resolve()); });
  await expect(page.locator('#consultation-date')).toHaveValue('2026-11-20');
  await expect(page.locator('#consultation-time')).toHaveValue('13:25');
  await page.locator('#vital-temperature').fill('36.7');
  await page.getByRole('button', { name: 'Save Consultation', exact: true }).click();
  await expect(page.getByText('Consultation saved successfully.')).toBeVisible();
  expect(await page.evaluate(() => window.savedConsultation)).toMatchObject({ consultationDate: '2026-11-20', consultationTime: '13:25', height: '150', weight: '50' });
});

test('prescription dropdowns support every option, unique accessible IDs, keyboard selection and independent medication regimens', async ({ page }) => {
  await page.getByText('Test Resident', { exact: true }).click();
  await page.getByPlaceholder('e.g. Fever, headache, prenatal check-up').fill('Prescription review');
  await fillRequiredClinical(page);
  const search = page.getByRole('textbox', { name: 'Search medicine by generic or brand name', exact: true });
  for (const medicine of ['Medicine One', 'Medicine Two']) {
    await search.fill(medicine);
    await page.getByRole('option', { name: new RegExp(medicine) }).click();
  }
  const routes = page.getByRole('combobox', { name: 'Route', exact: true });
  const frequencies = page.getByRole('combobox', { name: 'Frequency', exact: true });
  await routes.nth(0).focus();
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await expect(routes.nth(0)).toHaveValue('Other / As prescribed');
  await routes.nth(0).fill('invalid arbitrary route');
  await page.keyboard.press('Tab');
  await expect(routes.nth(0)).toHaveValue('Other / As prescribed');
  await routes.nth(1).click();
  await page.getByRole('option', { name: 'Ophthalmic', exact: true }).click();
  await frequencies.nth(0).fill('Every 12 hours');
  await page.keyboard.press('Enter');
  await expect(frequencies.nth(0)).toHaveValue('Every 12 hours');
  await frequencies.nth(1).focus();
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await expect(frequencies.nth(1)).toHaveValue('As prescribed');
  for (const [field, values] of [['Dose', ['1 tablet', '2 drops']], ['Duration', ['3 days', '5 days']], ['Quantity', ['6', '1']], ['Additional instructions', ['After food', 'Left eye only']]]) {
    for (const [index, value] of values.entries()) await page.getByRole('textbox', { name: field, exact: true }).nth(index).fill(value);
  }
  const ids = await page.getByRole('combobox').evaluateAll(inputs => inputs.map(input => input.id));
  expect(new Set(ids).size).toBe(ids.length);
  await page.setViewportSize({ width: 375, height: 360 });
  await frequencies.nth(1).scrollIntoViewIfNeeded();
  await frequencies.nth(1).evaluate(input => window.scrollBy(0, input.getBoundingClientRect().bottom - window.innerHeight + 16));
  await frequencies.nth(1).click();
  const menu = page.getByRole('listbox', { name: 'Frequency', exact: true });
  await expect(menu).toBeVisible();
  const box = await menu.boundingBox();
  const trigger = await frequencies.nth(1).boundingBox();
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(375);
  expect(box.y + box.height).toBeLessThan(trigger.y);
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Save Consultation', exact: true }).click();
  await expect(page.getByText('Consultation saved successfully.')).toBeVisible();
  const { medications } = await page.evaluate(() => window.savedConsultation);
  expect(medications).toHaveLength(2);
  expect(medications[0]).toMatchObject({ genericName: 'Medicine One', dose: '1 tablet', route: 'Other / As prescribed', frequency: 'Every 12 hours', duration: '3 days', quantity: '6', instructions: 'After food' });
  expect(medications[1]).toMatchObject({ genericName: 'Medicine Two', dose: '2 drops', route: 'Ophthalmic', frequency: 'As prescribed', duration: '5 days', quantity: '1', instructions: 'Left eye only' });
});

test('classifies reference readings in the consultation form', async ({ page }) => {
  const bp = bloodPressureField(page);
  const readings = [
    ['110/70', normal], ['119/79', normal],
    ['120/75', elevated], ['125/79', elevated], ['129/79', elevated],
    ['120/80', stage1], ['120/89', stage1], ['130/75', stage1], ['135/85', stage1], ['139/89', stage1],
    ['140/80', stage2], ['130/90', stage2], ['150/95', stage2],
    ['180/100', severe], ['130/120', severe], ['180/120', severe],
    ['181/80', severe], ['150/121', severe], ['185/125', severe],
  ];

  for (const [reading, category] of readings) {
    await test.step(`${reading} shows ${category[0]}`, async () => {
      await bp.input.fill(reading);
      await expect(bp.input).toHaveValue(reading);
      await expectBadge(bp, category);
    });
  }
});

test('keeps BP guidance below the badge and within the responsive field', async ({ page }) => {
  const readings = [
    ['120/80', 'Stage 1 Hypertension', false],
    ['140/90', 'Stage 2 Hypertension', false],
    ['180/100', 'Hypertensive Urgency or Emergency', true],
    ['181/90', 'Hypertensive Urgency or Emergency', true],
    ['220/90', 'Hypertensive Urgency or Emergency', true],
  ];

  for (const viewport of [
    { width: 1280, height: 900 },
    { width: 900, height: 1100 },
    { width: 390, height: 844 },
  ]) {
    await test.step(`${viewport.width}px layout`, async () => {
      await page.setViewportSize(viewport);
      const bp = bloodPressureField(page);
      const temperatureField = page.locator('#vital-temperature').locator('..');

      for (const [reading, category, hasGuidance] of readings) {
        await test.step(`${reading} layout`, async () => {
          await bp.input.fill(reading);
          await expect(bp.badge).toHaveText(category);
          await expect(bp.badge).toBeVisible();

          if (!hasGuidance) {
            await expect(bp.alert).toHaveCount(0);
            return;
          }

          await expect(bp.alert).toContainText('Arrange prompt clinical evaluation');
           await expect(bp.alert).toContainText('assess for emergency symptoms');
           await expect(bp.alert).toContainText('not a diagnosis');
          const geometry = await Promise.all([
            bp.field.boundingBox(),
            bp.badge.boundingBox(),
            bp.alert.boundingBox(),
            temperatureField.boundingBox(),
          ]);
          const [fieldBox, badgeBox, alertBox, temperatureBox] = geometry;
          expect(fieldBox).not.toBeNull();
          expect(badgeBox).not.toBeNull();
          expect(alertBox).not.toBeNull();
          expect(temperatureBox).not.toBeNull();
          expect(alertBox.y).toBeGreaterThanOrEqual(badgeBox.y + badgeBox.height);
          expect(alertBox.x).toBeGreaterThanOrEqual(fieldBox.x);
          expect(alertBox.x + alertBox.width).toBeLessThanOrEqual(fieldBox.x + fieldBox.width + 1);
          expect(alertBox.width).toBeGreaterThan(fieldBox.width - 2);
          expect(alertBox.height).toBeGreaterThan(16);

          const style = await bp.alert.evaluate((element) => ({
            clientWidth: element.clientWidth,
            scrollWidth: element.scrollWidth,
            overflowWrap: getComputedStyle(element).overflowWrap,
            whiteSpace: getComputedStyle(element).whiteSpace,
          }));
          expect(style.clientWidth).toBe(style.scrollWidth);
          expect(style.overflowWrap).toBe('break-word');
          expect(style.whiteSpace).toBe('normal');
          expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

          if (viewport.width < 640) {
            expect(temperatureBox.y).toBeGreaterThanOrEqual(fieldBox.y + fieldBox.height);
          } else {
            expect(Math.abs(temperatureBox.y - fieldBox.y)).toBeLessThanOrEqual(1);
          }
        });
      }
    });
  }
});

test('chief complaint and findings update emergency status at a fixed BP', async ({ page }) => {
  const bp = bloodPressureField(page);
  const chiefComplaint = page.getByPlaceholder('e.g. Fever, headache, prenatal check-up');
  const findings = page.locator('#clinical-findings');

  await bp.input.fill('185/125');
  await expectBadge(bp, severe);
  await expect(bp.alert).toContainText('Arrange prompt clinical evaluation');

  await chiefComplaint.fill('Chest pain');
  await expectBadge(bp, emergency);
  await expect(bp.alert).toContainText('immediate emergency evaluation');

  await chiefComplaint.fill('No chest pain');
  await expectBadge(bp, severe);
  await expect(bp.alert).toContainText('Arrange prompt clinical evaluation');

  await findings.fill('Shortness of breath');
  await expectBadge(bp, emergency);
  await expect(bp.alert).toContainText('immediate emergency evaluation');

  await findings.fill('Denies chest pain and shortness of breath');
  await expectBadge(bp, severe);
  await expect(bp.alert).toContainText('Arrange prompt clinical evaluation');

  await findings.fill('Shortness of breath');
  await expectBadge(bp, emergency);
  await expect(bp.input).toHaveValue('185/125');
  await bp.input.fill('180/120');
  await expectBadge(bp, stage2);
  await expect(bp.alert).toHaveCount(0);
});
