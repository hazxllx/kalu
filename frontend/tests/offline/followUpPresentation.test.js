import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { mapFollowUpEvent } from '../../src/features/dashboards/components/scheduleCalendarUtils.js';

// Exercise the actual pure presentation/transport helpers without booting Auth,
// an outbox worker, or making requests while testing queued record metadata.
const source = await readFile(new URL('../../src/services/offline/followUpOfflineService.js', import.meta.url), 'utf8');
const helpers = source.slice(source.indexOf('const localSchedule ='), source.indexOf('const queueOptions ='));
const { localSchedule, serverPayload } = await import(`data:text/javascript;base64,${Buffer.from(`${helpers}\nexport { localSchedule, serverPayload };`).toString('base64')}`);
const handlersSource = await readFile(new URL('../../src/services/offline/handlers.js', import.meta.url), 'utf8');
const handlerStart = handlersSource.indexOf('const serverPayload =');
const handlerEnd = handlersSource.indexOf('\n};', handlerStart) + 3;
const { serverPayload: syncPayload } = await import(`data:text/javascript;base64,${Buffer.from(`${handlersSource.slice(handlerStart, handlerEnd)}\nexport { serverPayload };`).toString('base64')}`);

const record = () => ({ residentId: 'resident-1', _offlineResidentName: 'Recorded Resident', _offlineBarangay: 'San Antonio', scheduled_date: '2026-11-07', purpose: 'Recorded follow-up', status: 'Scheduled', requires_resident_response: true });

test('queued confirmation-required follow-ups keep the actual resident and pending decision', () => {
  const row = localSchedule(record(), 'local:followup-1', 'draft-1');
  const event = mapFollowUpEvent(row);
  assert.equal(row.id, 'local:followup-1');
  assert.equal(row.localId, 'draft-1');
  assert.equal(event.residentName, 'Recorded Resident');
  assert.equal(event.residentBarangay, 'San Antonio');
  assert.equal(event.status, 'Pending');
  assert.equal(event.residentDecision, 'pending');
  assert.equal(event.confirmationStatus, 'Awaiting Confirmation');
  assert.equal(event.offline, true);
  assert.equal(event.syncStatus, 'Pending Sync');
});

test('client-provided approval cannot manufacture confirmation for an unsynchronized create', () => {
  const event = mapFollowUpEvent(localSchedule({ ...record(), resident_decision: 'approved' }, 'local:followup-1', 'draft-1'));
  assert.equal(event.residentDecision, 'pending');
  assert.equal(event.confirmationStatus, 'Awaiting Confirmation');
});

test('local-only identity/geography never enter either direct or queued API payloads', () => {
  const expected = { residentId: 'resident-1', scheduled_date: '2026-11-07', purpose: 'Recorded follow-up', status: 'Scheduled', requires_resident_response: true };
  assert.deepEqual(serverPayload(record()), expected);
  assert.deepEqual(syncPayload(record()), expected);
});

test('ordinary scheduling stays unconfirmed and missing identity is explicit', () => {
  const row = localSchedule({ scheduled_date: '2026-11-07', status: 'Scheduled', requires_resident_response: false }, 'local:followup-1', 'draft-1');
  assert.equal(row.residentName, 'Resident name unavailable');
  assert.equal(row.status, 'Scheduled');
  assert.equal(row.residentDecision, '');
  assert.notEqual(mapFollowUpEvent(row).confirmationStatus, 'Confirmed');
});
