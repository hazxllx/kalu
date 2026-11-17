import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  getHouseholdDetailAccess,
  loadHouseholdDetailData,
} from '../../src/features/households/lib/riskDetailAccess.js';

const bhwCan = (perm) => perm === 'households.view' || perm === 'households.create';
const phnCan = (perm) => ['households.view', 'followups.view', 'followups.edit'].includes(perm);

test('P0-7: BHW access separates household visit viewing from follow-up workflow permissions', () => {
  const bhwAccess = getHouseholdDetailAccess({ user: { role: 'bhw' }, can: bhwCan });
  assert.equal(bhwAccess.canViewWorkflow, false);
  assert.equal(bhwAccess.canEditWorkflow, false);
  assert.equal(bhwAccess.canViewVisits, true);
  assert.equal(bhwAccess.canCreateVisits, true);

  const phnAccess = getHouseholdDetailAccess({ user: { role: 'phn' }, can: phnCan });
  assert.equal(phnAccess.canViewWorkflow, true);
  assert.equal(phnAccess.canEditWorkflow, true);
  assert.equal(phnAccess.canViewVisits, false);
});

test('P0-7: BHW loadHouseholdDetailData loads household and visit history without calling risk-workflow endpoint', async () => {
  const bhwAccess = getHouseholdDetailAccess({ user: { role: 'bhw' }, can: bhwCan });
  let workflowCalled = false;
  const loaded = await loadHouseholdDetailData({
    id: 'HH-001',
    access: bhwAccess,
    getHousehold: async () => ({ household: { id: 'HH-001', headName: 'Maria Cruz', riskLevel: 'Low' } }),
    getWorkflow: async () => {
      workflowCalled = true;
      throw Object.assign(new Error('Forbidden'), { status: 403 });
    },
    listVisits: async () => ({ visits: [{ id: 'v1', visitNumber: 1, visitDate: '2026-06-15' }] }),
  });

  assert.equal(workflowCalled, false);
  assert.equal(loaded.record.id, 'HH-001');
  assert.equal(loaded.workflow, null);
  assert.equal(loaded.visits.length, 1);
});

test('P0-7: PHN loadHouseholdDetailData still fetches persisted workflow', async () => {
  const phnAccess = getHouseholdDetailAccess({ user: { role: 'phn' }, can: phnCan });
  let workflowCalled = false;
  const loaded = await loadHouseholdDetailData({
    id: 'HH-001',
    access: phnAccess,
    getHousehold: async () => ({ household: { id: 'HH-001', headName: 'Maria Cruz', riskLevel: 'High' } }),
    getWorkflow: async () => {
      workflowCalled = true;
      return { workflowStatus: 'Monitoring', assignedWorker: 'PHN Reyes' };
    },
    listVisits: async () => ({ visits: [] }),
  });

  assert.equal(workflowCalled, true);
  assert.equal(loaded.workflow.workflowStatus, 'Monitoring');
});

test('P0-7: HouseholdRiskDetail gates workflow API and action controls on followups.view / followups.edit', () => {
  const src = fs.readFileSync(
    path.resolve('src/features/households/pages/HouseholdRiskDetail.jsx'),
    'utf8',
  );
  assert.match(src, /usePermissions/);
  assert.match(src, /canEditWorkflow &&/);
  assert.match(src, /loadHouseholdDetailData/);
});
