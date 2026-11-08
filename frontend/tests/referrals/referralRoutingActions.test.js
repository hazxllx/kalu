import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { allowedReferralStatuses, canAssignReferral, isOpenReferral, REFERRAL_STATUSES, referralRecipientLabel, referralRoleLabel, referralRouteKey, referralStatusPermission, selectedReferralRoute } from '../../src/features/referrals/lib/referralTrackingActions.js';

test('assigned recipient decisions use row authority plus permission and the canonical transition graph', () => {
  const can = (permission) => ['referrals.approve', 'referrals.reject', 'referrals.status.update'].includes(permission);
  assert.deepEqual(allowedReferralStatuses({ status: 'Pending', capabilities: { allowed_statuses: ['Accepted', 'Rejected'] } }, can), ['Accepted', 'Rejected']);
  assert.deepEqual(allowedReferralStatuses({ status: 'Pending', capabilities: { allowed_statuses: ['Completed', 'In Progress', 'Pending'] } }, can), []);
  assert.deepEqual(allowedReferralStatuses({ status: 'Accepted', capabilities: { allowed_statuses: ['In Progress', 'Completed'] } }, can), ['In Progress']);
  assert.deepEqual(allowedReferralStatuses({ status: 'In Progress', capabilities: { allowed_statuses: ['Completed'] } }, can), ['Completed']);
  assert.deepEqual(allowedReferralStatuses({ status: 'Pending' }, can), []);
  assert.deepEqual(allowedReferralStatuses({ status: 'Pending', capabilities: { allowed_statuses: ['Accepted', 'Rejected'] } }, (permission) => permission === 'referrals.reject'), ['Rejected']);
});

test('rejection differs from sender cancellation, and completed/rejected/cancelled workflows cannot be reopened in the UI', () => {
  assert.equal(referralStatusPermission('Rejected'), 'referrals.reject');
  assert.equal(referralStatusPermission('Cancelled'), 'referrals.status.update');
  assert.equal(referralStatusPermission('Accepted'), 'referrals.approve');
  for (const status of ['Completed', 'Rejected', 'Cancelled']) {
    assert.equal(isOpenReferral({ status }), false);
    assert.deepEqual(allowedReferralStatuses({ status, capabilities: { allowed_statuses: REFERRAL_STATUSES } }), []);
  }
  for (const status of ['Pending', 'Accepted', 'In Progress']) assert.equal(isOpenReferral({ status }), true);
  assert.equal(canAssignReferral({ capabilities: { can_assign: true } }, () => false), false);
  assert.equal(canAssignReferral({ capabilities: { can_assign: false } }, () => true), false);
  assert.equal(canAssignReferral({ capabilities: { can_assign: true } }, (permission) => permission === 'referrals.assign'), true);
});

test('route selection is by real personnel/facility/role/station IDs, never by matching free-text names', () => {
  const routes = [
    { id: 'real-person-1', name: 'Same Name', role: 'rhu_personnel', facility_id: 'real-facility-1', station: 'triage' },
    { id: 'real-person-1', name: 'Same Name', role: 'rhu_personnel', facility_id: 'real-facility-1', station: 'consultation' },
    { id: 'real-person-2', name: 'Same Name', role: 'health_supervisor', facility_id: 'real-bhs-1', station: null },
  ];
  const form = { recipientPersonnelId: 'real-person-1', recipientFacilityId: 'real-facility-1', recipientRole: 'rhu_personnel', recipientStation: 'triage' };
  assert.equal(selectedReferralRoute(routes, form), routes[0]);
  assert.notEqual(referralRouteKey(routes[0]), referralRouteKey(routes[1]));
  for (const patch of [
    { recipientPersonnelId: 'Same Name' }, { recipientFacilityId: 'Unknown facility' },
    { recipientRole: 'bhw' }, { recipientStation: 'registration' }, { recipientStation: '' },
  ]) assert.equal(selectedReferralRoute(routes, { ...form, ...patch }), null);
  assert.equal(selectedReferralRoute(routes, { recipientPersonnelId: 'real-person-2', recipientFacilityId: 'real-bhs-1', recipientRole: 'health_supervisor', recipientStation: '' }), routes[2]);
  assert.match(referralRoleLabel('health_supervisor'), /Midwife/);
});

test('recipient display does not confuse unaddressed historical names with an assigned inbox', () => {
  assert.equal(referralRecipientLabel({ receivingPersonnel: 'Historical name' }), 'Unassigned historical referral');
  assert.match(referralRecipientLabel({ recipient_personnel_id: 'actual-id', recipient: { full_name: 'Actual Recipient' }, recipient_role: 'rhu_personnel', recipient_station: 'consultation' }), /Actual Recipient.*RHU Personnel.*Consultation/);
  assert.match(referralRecipientLabel({ recipientPersonnelId: 'actual-id', recipientName: 'Actual Midwife', recipientRole: 'health_supervisor' }), /Actual Midwife.*Midwife/);
});

test('referral API uses the real assigned inbox and nested canonical status payload, forwarding pinned owner and version', async () => {
  const source = await readFile(new URL('../../src/services/api/referralsApi.js', import.meta.url), 'utf8');
  const calls = [];
  globalThis.__referralApiTransport = Object.fromEntries(['get', 'post', 'put', 'delete'].map((method) => [method, (...args) => { calls.push({ method, args }); return Promise.resolve({ record: { id: 'real-id' } }); }]));
  try {
    const injected = source.replace("import { api } from './apiClient.js';", 'const api = globalThis.__referralApiTransport;');
    const { referralsApi } = await import(`data:text/javascript;base64,${Buffer.from(injected).toString('base64')}`);
    const options = { ownerId: 'authenticated-sender' };
    await referralsApi.inbox({ status: 'Pending' }, options);
    await referralsApi.recipients({ residentId: 'real-resident-id' }, options);
    await referralsApi.create({ recipient_personnel_id: 'real-recipient-id', recipient_facility_id: 'real-facility-id' }, options);
    await referralsApi.updateStatus('real-id', { status: 'Rejected', resolution_notes: 'Actual reason', expected_version: 3 }, options);
    await referralsApi.get('REF / preserved', options);
    assert.equal(calls[0].args[0], '/referrals/incoming');
    assert.equal(calls[0].args[1].ownerId, options.ownerId);
    assert.equal(calls[1].args[0], '/referrals/recipients');
    assert.equal(calls[1].args[1].params.residentId, 'real-resident-id');
    assert.deepEqual(calls[2].args[1], { record: { recipient_personnel_id: 'real-recipient-id', recipient_facility_id: 'real-facility-id' } });
    assert.equal(calls[3].args[0], '/referrals/real-id/status');
    assert.deepEqual(calls[3].args[1], { record: { status: 'Rejected', resolution_notes: 'Actual reason', expected_version: 3 } });
    assert.equal(calls[3].args[2].ownerId, options.ownerId);
    assert.equal(calls[4].args[0], '/referrals/REF%20%2F%20preserved');
  } finally { delete globalThis.__referralApiTransport; }
});

test('page wiring preserves the source ID, history and assigned-only decisions without local persistence or delete UI', async () => {
  const [tracking, incoming] = await Promise.all([
    readFile(new URL('../../src/features/referrals/pages/HealthReferrals.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../../src/features/triage/pages/IncomingReferrals.jsx', import.meta.url), 'utf8'),
  ]);
  assert.match(tracking, /treatmentVisitId: initial\.treatmentVisitId \|\| ""/);
  assert.match(tracking, /recipient_personnel_id: form\.recipientPersonnelId/);
  assert.match(tracking, /recipient_facility_id: form\.recipientFacilityId/);
  assert.match(tracking, /expected_version: editing\.version/);
  assert.match(tracking, /Assigned Inbox/);
  assert.match(tracking, /<ReferralHistory history=\{detail\.history\}/);
  assert.doesNotMatch(tracking, /referralsApi\.remove|Referral deleted|setDeleteTarget|name\.toLowerCase\(\).*draft\.resident/);
  assert.match(tracking, /limit: 100, offset/);
  assert.match(incoming, /referralsApi\.inbox/);
  assert.match(incoming, /expected_version: record\.version/);
  assert.match(incoming, /if \(!canScreen\(details\)\) throw/);
  assert.match(incoming, /<ReferralHistory history=\{selected\.history/);
  assert.doesNotMatch(incoming, /referralsApi\.list\(|result\?\.record \|\| referral|record \|\| row/);
  for (const page of [tracking, incoming]) assert.doesNotMatch(page, /localStorage|useWorkflowStore|workflowStore|service.role/i);
});
