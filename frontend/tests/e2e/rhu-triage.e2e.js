// Real-account acceptance checks. These require a disposable local Supabase
// stack and an explicitly identified synthetic resident, never production data.
import { test, expect } from '@playwright/test';
import { requireIsolatedEnv, ROUTES } from './helpers/env.js';
import { loginAs } from './helpers/auth.js';

const patientName = process.env.E2E_RHU_RESIDENT_NAME;
const handoffPost = /\/api\/intake\/visits$/;
const successMessage = /patient sent to the consultation queue/i;

async function reviewTriage(page, complaint) {
  await page.goto(ROUTES.rhuTriage);
  await page.getByRole('button', { name: /search existing patient/i }).click();
  await page.getByPlaceholder('Search for a registered patient...').fill(patientName);
  await page.getByRole('button').filter({ has: page.getByText(patientName, { exact: true }) }).click();
  await page.getByRole('button', { name: /continue to triage|continue to visit details/i }).click();
  await page.getByLabel(/^height/i).fill('170');
  await page.getByLabel(/^weight/i).fill('65');
  await page.getByLabel(/^blood pressure/i).fill('120/80');
  await page.getByLabel(/^blood sugar/i).fill('100');
  await page.getByRole('button', { name: 'Other', exact: true }).click();
  await page.getByLabel(/describe the reason/i).fill(complaint);
  await page.getByRole('button', { name: /^continue$|review/i }).last().click();
  await expect(page.getByRole('heading', { name: /^review$/i })).toBeVisible();
}

test.describe('B. RHU Triage: real saved handoff', () => {
  requireIsolatedEnv();
  test.skip(!patientName, 'BLOCKED: E2E_RHU_RESIDENT_NAME must identify a synthetic registered resident.');

  test('B1: three-step triage persists and the corresponding consultation matches after refresh', async ({ page }) => {
    await loginAs(page, 'rhu_personnel');
    const complaint = `Synthetic RHU handoff verification ${Date.now()}`;
    await reviewTriage(page, complaint);
    const [response] = await Promise.all([
      page.waitForResponse((r) => handoffPost.test(r.url()) && r.request().method() === 'POST'),
      page.getByRole('button', { name: /send to consultation/i }).click(),
    ]);
    expect(response.ok()).toBeTruthy();
    const responseBody = await response.json();
    const saved = responseBody.data?.submission;
    expect(saved?.id).toBeTruthy();
    expect(saved.status).toBe('submitted');
    expect(saved.chiefComplaint).toBe(complaint);
    expect(saved.vitals).toMatchObject({ heightCm: 170, weightKg: 65, bp: '120/80', bloodSugar: 100, bmi: 22.5 });
    expect(saved.triageSnapshot.residentId).toBe(saved.residentId);
    expect(saved.triageSnapshot.recordedBy).toBeTruthy();
    await expect(page.getByText(successMessage)).toBeVisible();

    // Read the persisted encounter through the consultation API with the actual
    // authenticated request headers. No service-role token or fixture response.
    const headers = await response.request().allHeaders();
    const detail = await page.request.get(`${process.env.E2E_API_URL.replace(/\/$/, '').replace(/\/api$/, '')}/api/phn/submissions/${saved.id}/consultation`, {
      headers: { Authorization: headers.authorization },
    });
    expect(detail.ok()).toBeTruthy();
    const consultation = (await detail.json()).data?.submission;
    expect(consultation.id).toBe(saved.id);
    expect(consultation.residentId).toBe(saved.residentId);
    expect(consultation.triageSnapshot).toEqual(saved.triageSnapshot);

    await page.goto(ROUTES.rhuConsultation);
    await page.reload();
    const row = page.getByRole('row').filter({ hasText: complaint });
    await row.getByRole('button', { name: /open consultation|continue consultation/i }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText(complaint);
    await expect(dialog).toContainText('170 cm');
    await expect(dialog).toContainText('65 kg');
    await expect(dialog).toContainText('120/80 mmHg');
    await expect(dialog).toContainText('100 mg/dL');
    await expect(dialog).toContainText(saved.residentId);
    await expect(dialog).toContainText(saved.id);
    await dialog.getByLabel(/assessment \/ findings/i).fill('Synthetic acceptance test findings.');
    await dialog.getByLabel(/health concern/i).fill('Synthetic acceptance test concern');
    await dialog.getByLabel(/treatment \/ recommendations/i).fill('Synthetic acceptance test plan; no prescription issued.');
    const [completedResponse] = await Promise.all([
      page.waitForResponse((r) => r.url().endsWith(`/phn/submissions/${saved.id}/complete`) && r.request().method() === 'POST'),
      dialog.getByRole('button', { name: /complete check-up|complete consultation/i }).click(),
    ]);
    expect(completedResponse.ok()).toBeTruthy();
    const completed = (await completedResponse.json()).data?.submission;
    expect(completed.status).toBe('completed');
    expect(completed.id).toBe(saved.id);
    expect(completed.residentId).toBe(saved.residentId);
    expect(completed.triageSnapshot).toEqual(saved.triageSnapshot);
    await page.reload();
    const persistedResponse = await page.request.get(`${process.env.E2E_API_URL.replace(/\/$/, '').replace(/\/api$/, '')}/api/phn/submissions/${saved.id}/consultation`, {
      headers: { Authorization: headers.authorization },
    });
    expect(persistedResponse.ok()).toBeTruthy();
    const persisted = (await persistedResponse.json()).data?.submission;
    expect(persisted.status).toBe('completed');
    expect(persisted.triageSnapshot).toEqual(saved.triageSnapshot);
  });

  test('B2: rejected handoff preserves the reviewed form and retry operation identity', async ({ page }) => {
    await loginAs(page, 'rhu_personnel');
    const complaint = `Synthetic failure verification ${Date.now()}`;
    await reviewTriage(page, complaint);
    const bodies = [];
    await page.route(handoffPost, async (route) => {
      if (route.request().method() !== 'POST') return route.fallback();
      bodies.push(route.request().postDataJSON());
      return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { message: 'The database is temporarily unavailable. Retry this triage.' } }) });
    });
    const send = page.getByRole('button', { name: /send to consultation/i });
    await send.click();
    await expect(page.getByText(/database is temporarily unavailable/i)).toBeVisible();
    await expect(page.getByRole('heading', { name: /^review$/i })).toBeVisible();
    await expect(page.getByText(complaint, { exact: true })).toBeVisible();
    await expect(page.getByText(successMessage)).toHaveCount(0);
    await send.click();
    await expect.poll(() => bodies.length).toBe(2);
    expect(bodies[1].clientSubmissionId).toBe(bodies[0].clientSubmissionId);
    expect(bodies[1].visit).toEqual(bodies[0].visit);
  });
});
