import test from 'node:test';
import assert from 'node:assert/strict';

import { buildDayMap, mapFollowUpEvent, mapHealthServiceEvent, monthRange } from '../src/features/dashboards/components/scheduleCalendarUtils.js';

test('monthRange covers the active month using local date components', () => {
  const range = monthRange(new Date(2026, 8, 15));
  assert.deepEqual(range, { from: '2026-09-01', to: '2026-09-30' });
});

test('buildDayMap groups multiple events per date and sorts by time', () => {
  const events = [
    mapFollowUpEvent({ id: 'f-2', scheduled_date: '2026-09-15', scheduled_time: '14:00', purpose: 'Medication review', resident: { first_name: 'Maria', last_name: 'Dela Cruz' } }),
    mapFollowUpEvent({ id: 'f-1', scheduled_date: '2026-09-15', scheduled_time: '09:00', purpose: 'Vitals check', resident: { first_name: 'Maria', last_name: 'Dela Cruz' } }),
    mapHealthServiceEvent({ id: 's-1', scheduled_date: '2026-09-15', service: { name: 'Vaccination', category: 'Immunization' }, resident: { first_name: 'Jose', last_name: 'Reyes' } }),
  ];

  const grouped = buildDayMap(events);
  assert.deepEqual(Object.keys(grouped), ['2026-09-15']);
  assert.deepEqual(grouped['2026-09-15'].map((event) => event.id), ['f-1', 'f-2', 's-1']);
});

test('mapFollowUpEvent and mapHealthServiceEvent keep the required schedule fields', () => {
  const followUp = mapFollowUpEvent({
    id: 'follow-1',
    scheduled_date: '2026-09-17',
    scheduled_time: '10:30',
    purpose: 'Prenatal review',
    resident: { first_name: 'Ana', middle_name: 'M.', last_name: 'Santos', barangay: 'Barangay 1' },
    status: 'Scheduled',
    location: 'RHU',
    assigned_provider: 'Midwife',
    notes: 'Bring results',
  });

  const service = mapHealthServiceEvent({
    id: 'attendance-1',
    scheduled_date: '2026-09-17',
    attendance_status: 'scheduled',
    resident: { first_name: 'Ana', middle_name: 'M.', last_name: 'Santos', barangay: 'Barangay 1' },
    service: { name: 'Family Planning', category: 'Family Planning' },
    notes: 'Consultation slot',
  });

  assert.equal(followUp.type, 'follow-up');
  assert.equal(followUp.date, '2026-09-17');
  assert.equal(followUp.time, '10:30');
  assert.equal(followUp.residentName, 'Ana M. Santos');
  assert.equal(service.type, 'health-service');
  assert.equal(service.label, 'Family Planning');
  assert.equal(service.status, 'scheduled');
});
