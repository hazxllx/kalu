import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveScope } from '../src/services/m1.service.js';

const phn = { id: 'user-a', role: 'phn', municipalityId: 'municipality-a' };
const mho = { id: 'user-a', role: 'mho', municipalityId: 'municipality-a' };
const rhu = { id: 'user-a', role: 'rhu_personnel', municipalityId: 'municipality-a' };
const hs = { id: 'user-a', role: 'health_supervisor', barangayId: 'barangay-a', municipalityId: 'municipality-a' };

const supabase = (overrides = {}) => ({
  from: (table) => {
    if (table !== 'barangays') throw new Error('Only barangay scope lookup is expected.');
    const query = { select: () => query, eq: () => query, maybeSingle: () => overrides.result ?? Promise.resolve({ data: null, error: null }) };
    return query;
  },
});

test('municipal callers may drill into their own active barangay only', async () => {
  const same = await resolveScope(phn, 'barangay-a', supabase({
    result: Promise.resolve({ data: { id: 'barangay-a', municipality_id: 'municipality-a', status: 'Active' }, error: null }),
  }));
  assert.equal(same.level, 'municipality');
  assert.equal(same.barangayId, 'barangay-a');
  assert.equal(same.municipalityId, 'municipality-a');
});

test('a barangay from another municipality is rejected before any report data is read', async () => {
  for (const user of [phn, mho, rhu]) {
    await assert.rejects(
      resolveScope(user, 'barangay-other', supabase({
        result: Promise.resolve({ data: { id: 'barangay-other', municipality_id: 'municipality-b', status: 'Active' }, error: null }),
      })),
      (error) => error.statusCode === 403,
    );
  }
});

test('unknown, inactive, and unresolvable barangays fail closed for municipal callers', async () => {
  for (const result of [
    Promise.resolve({ data: null, error: null }),
    Promise.resolve({ data: { id: 'barangay-a', municipality_id: 'municipality-a', status: 'Inactive' }, error: null }),
    Promise.resolve({ data: { id: 'barangay-a', municipality_id: null, status: 'Active' }, error: null }),
    Promise.reject(new Error('lookup failed')),
  ]) {
    await assert.rejects(resolveScope(phn, 'barangay-a', supabase({ result })), (error) => error.statusCode === 403 || error.statusCode === 503);
  }
});

test('municipal callers still report their own whole municipality when no barangay is requested', async () => {
  const whole = await resolveScope(phn, null, supabase());
  assert.equal(whole.level, 'municipality');
  assert.equal(whole.barangayId, null);
  assert.equal(whole.municipalityId, 'municipality-a');
});

test('barangay-scoped callers are always pinned to their own barangay without a scope lookup', async () => {
  const pinned = await resolveScope(hs, null, supabase());
  assert.equal(pinned.level, 'barangay');
  assert.equal(pinned.barangayId, 'barangay-a');
  await assert.rejects(resolveScope(hs, 'barangay-other', supabase()), (error) => error.statusCode === 403);
});