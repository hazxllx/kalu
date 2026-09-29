import test from 'node:test';
import assert from 'node:assert/strict';

import {
  mapServerRiskLevel,
  daysSince,
  toRiskCluster,
} from '../src/features/households/lib/riskClusterAdapter.js';
import { RISK_LEVELS } from '../src/lib/householdRisk.js';

/**
 * BUG-009 residue: the retained Household Risk Overview / Detail pages now read
 * the SERVER household record + persisted household_risk_workflow instead of the
 * obsolete client-only sessionStorage store. These tests lock the mapping so the
 * pages render real persisted data (never an incorrect empty state) and never
 * fabricate households.
 */

test('mapServerRiskLevel maps the 3-level server model to the display model', () => {
  assert.equal(mapServerRiskLevel('High'), RISK_LEVELS.PRIORITY);
  assert.equal(mapServerRiskLevel('Moderate'), RISK_LEVELS.INTERVENTION);
  assert.equal(mapServerRiskLevel('Low'), RISK_LEVELS.STABLE);
  // Unknown / missing level defaults to Stable (never throws, never blanks).
  assert.equal(mapServerRiskLevel(undefined), RISK_LEVELS.STABLE);
  assert.equal(mapServerRiskLevel('Nonsense'), RISK_LEVELS.STABLE);
});

test('daysSince returns whole days or null for unset/invalid input', () => {
  assert.equal(daysSince(null), null);
  assert.equal(daysSince(''), null);
  assert.equal(daysSince('not-a-date'), null);
  // Build "today" from LOCAL date parts so it matches how daysSince parses the
  // string (local midnight), independent of the machine timezone.
  const now = new Date();
  const localToday = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  assert.equal(daysSince(localToday), 0);
});

test('toRiskCluster maps a server household + workflow into the display shape', () => {
  const household = {
    id: 'HH-000123',
    headName: 'Juan Dela Cruz',
    barangay: 'San Isidro',
    purok: 'Purok 1',
    streetAddress: 'Sitio Maligaya',
    riskLevel: 'High',
    riskScore: 9,
    riskFactors: ['No improved water source', 'Child under 5 without PhilHealth'],
    updatedAt: '2026-09-20T08:30:00.000Z',
    members: [{ id: 'm1' }, { id: 'm2' }, { id: 'm3' }],
  };
  const workflow = {
    workflowStatus: 'Follow-up Scheduled',
    assignedWorker: 'Nurse Ana',
    assignedWorkerRole: 'Public Health Nurse',
    followUpCount: 2,
    lastFollowUpAt: '2026-09-18',
    escalation: { reason: 'Persistent risk', assignment: 'PHN' },
    history: [{ month: 'September', year: 2026, level: RISK_LEVELS.PRIORITY, count: 2 }],
    lastNote: 'Home visit completed',
  };

  const cluster = toRiskCluster(household, workflow);

  assert.equal(cluster.id, 'HH-000123');
  assert.equal(cluster.head, 'Juan Dela Cruz');
  assert.equal(cluster.surname, 'Cruz');
  assert.equal(cluster.barangay, 'San Isidro');
  assert.equal(cluster.members, 3);
  assert.equal(cluster.risk.level, RISK_LEVELS.PRIORITY);
  assert.equal(cluster.risk.score, 9);
  assert.equal(cluster.risk.count, 2);
  assert.equal(cluster.risk.indicators.length, 2);
  assert.equal(cluster.risk.indicators[0].label, 'No improved water source');
  assert.ok(typeof cluster.risk.recommendedAction === 'string' && cluster.risk.recommendedAction.length > 0);
  // Persisted workflow is surfaced (survives refresh/logout because it is server-side).
  assert.equal(cluster.workflowStatus, 'Follow-up Scheduled');
  assert.equal(cluster.assignedWorker, 'Nurse Ana');
  assert.equal(cluster.followUpCount, 2);
  assert.equal(cluster.lastFollowUpAt, '2026-09-18');
  assert.equal(cluster.escalation.reason, 'Persistent risk');
  assert.equal(cluster.history.length, 1);
  assert.equal(cluster.lastAssessment, '2026-09-20');
});

test('toRiskCluster tolerates a household with no workflow and no members', () => {
  const cluster = toRiskCluster({ id: 'HH-1', headName: 'Maria Santos', riskLevel: 'Low' }, null);
  assert.equal(cluster.risk.level, RISK_LEVELS.STABLE);
  assert.equal(cluster.risk.count, 0);
  assert.deepEqual(cluster.risk.indicators, []);
  assert.equal(cluster.members, 0);
  assert.equal(cluster.workflowStatus, '');
  assert.equal(cluster.followUpCount, 0);
  assert.equal(cluster.escalation, null);
  assert.deepEqual(cluster.history, []);
});

test('toRiskCluster uses memberCount when the full member roster is absent (list view)', () => {
  const cluster = toRiskCluster({ id: 'HH-2', headName: 'Pedro', riskLevel: 'Moderate', memberCount: 5 }, null);
  assert.equal(cluster.members, 5);
  assert.equal(cluster.risk.level, RISK_LEVELS.INTERVENTION);
});
