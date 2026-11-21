import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createActivityValidator, listActivitiesValidator, updateActivityValidator,
} from '../src/validators/calendarActivities.validators.js';
import * as service from '../src/services/calendarActivities.service.js';

const user = {
  id: '00000000-0000-4000-8000-000000000001',
  role: 'health_supervisor',
  barangayId: '00000000-0000-4000-8000-000000000002',
  municipalityId: '00000000-0000-4000-8000-000000000003',
};

function fakeClient({ resident = { id: 'resident-1' }, rows = [], activity = null } = {}) {
  const calls = [];
  return {
    calls,
    from(table) {
      const state = { table, filters: [] };
      const builder = {
        select(fields) { state.select = fields; return this; },
        eq(field, value) { state.filters.push([field, value]); return this; },
        gte(field, value) { state.filters.push([field, value]); return this; },
        lte(field, value) { state.filters.push([field, value]); return this; },
        order(field, options) { state.orders = [...(state.orders || []), [field, options]]; return this; },
        insert(payload) { state.insert = payload; return this; },
        update(payload) { state.update = payload; return this; },
        delete() { state.delete = true; return this; },
        async maybeSingle() {
          calls.push(state);
          return { data: table === 'residents' ? resident : activity || rows[0] || null, error: null };
        },
        async single() {
          calls.push(state);
          return { data: activity || state.insert, error: null };
        },
        then(resolve, reject) {
          calls.push(state);
          return Promise.resolve({ data: rows, error: null }).then(resolve, reject);
        },
      };
      return builder;
    },
  };
}

test('calendar activity validators normalize optional fields and reject invalid dates', () => {
  const created = createActivityValidator({
    title: '  Team huddle ',
    activityType: 'Meeting',
    date: '2026-11-21',
    time: '',
    notes: '  Review weekly tasks  ',
    residentId: '',
  });
  assert.deepEqual(created, {
    value: {
      title: 'Team huddle',
      activity_type: 'Meeting',
      activity_date: '2026-11-21',
      activity_time: null,
      notes: 'Review weekly tasks',
      resident_id: null,
    },
  });

  assert.ok(createActivityValidator({
    title: 'Reminder', activityType: 'Other', date: '2026-02-30',
  }).error.date);
  assert.ok(createActivityValidator({
    title: '', activityType: 'Other', date: '2026-11-21',
  }).error.title);
  assert.deepEqual(updateActivityValidator({ notes: '' }), { value: { notes: null } });
  assert.ok(updateActivityValidator({}).error.activity);
  assert.ok(listActivitiesValidator({ from: '2026-11-22', to: '2026-11-21' }).error.to);
});

test('calendar activity reads are date-filtered and constrained to the authenticated owner', async () => {
  const client = fakeClient({ rows: [{ id: 'activity-1' }] });
  const rows = await service.listActivities({
    user,
    from: '2026-11-01',
    to: '2026-11-30',
    client,
  });
  assert.equal(rows.length, 1);
  assert.equal(client.calls[0].table, 'calendar_activities');
  assert.deepEqual(client.calls[0].filters, [
    ['created_by', user.id],
    ['activity_date', '2026-11-01'],
    ['activity_date', '2026-11-30'],
  ]);
});

test('calendar activity create, edit, and delete use owner-bound records', async () => {
  const activity = {
    id: '00000000-0000-4000-8000-000000000004',
    created_by: user.id,
    title: 'Planning meeting',
    activity_type: 'Meeting',
    activity_date: '2026-11-21',
    activity_time: null,
    notes: null,
    resident_id: null,
  };
  const client = fakeClient({ activity });
  const payload = {
    title: activity.title,
    activity_type: activity.activity_type,
    activity_date: activity.activity_date,
    activity_time: null,
    notes: null,
    resident_id: null,
  };

  assert.equal((await service.createActivity({ user, payload, client })).id, activity.id);
  assert.equal((await service.updateActivity({ user, id: activity.id, payload: { title: 'Updated meeting' }, client })).id, activity.id);
  assert.deepEqual(await service.deleteActivity({ user, id: activity.id, client }), { id: activity.id });
  assert.deepEqual(client.calls[0].insert, { ...payload, created_by: user.id });
  assert.ok(client.calls[1].filters.some(([field, value]) => field === 'created_by' && value === user.id));
  assert.ok(client.calls[2].filters.some(([field, value]) => field === 'created_by' && value === user.id));
});

test('calendar activities reject non-supervisors and residents outside the supervisor barangay', async () => {
  await assert.rejects(
    service.listActivities({ user: { ...user, role: 'phn' }, client: fakeClient() }),
    { statusCode: 403 },
  );

  const client = fakeClient({ resident: null });
  await assert.rejects(
    service.createActivity({
      user,
      client,
      payload: {
        title: 'Visit',
        activity_type: 'Field Visit',
        activity_date: '2026-11-21',
        activity_time: null,
        notes: null,
        resident_id: 'outside-resident',
      },
    }),
    { statusCode: 400 },
  );
  assert.equal(client.calls.length, 1);
  assert.equal(client.calls[0].table, 'residents');
});
