import assert from 'node:assert/strict';
import test from 'node:test';

import { configureLocalTestEnvironment } from './helpers/localEnv.js';
configureLocalTestEnvironment();

const originalFetch = globalThis.fetch;
const requests = [];
globalThis.fetch = async (input, init = {}) => {
  const url = new URL(input);
  if (url.pathname.endsWith('/visits')) {
    const body = JSON.parse(init.body);
    requests.push(body);
    if (requests.length === 1) {
      return new Response(JSON.stringify({
        code: 'PGRST204',
        message: "Could not find the 'health_service_id' column of 'visits' in the schema cache",
        details: null,
        hint: null,
      }), {
        status: 400,
        headers: { 'content-type': 'application/json' },
      });
    }
    return new Response(JSON.stringify({
      ...body,
      resident_id: 'RES-1',
      recorded_by_id: 'staff-1',
      recorded_by_role: 'rhu_personnel',
    }), {
      status: 201,
      headers: { 'content-type': 'application/json' },
    });
  }
  if (url.pathname.endsWith('/residents')) {
    return new Response(JSON.stringify({ id: 'RES-1' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }
  throw new Error(`Unexpected Supabase request: ${url.pathname}`);
};

const { default: repository } = await import('../src/repositories/supabaseRepository.js');

test('insertVisit fails closed on missing clinical columns instead of retrying without prescriptions or service linkage', async () => {
  try {
    await assert.rejects(() => repository.insertVisit({
      id: 'SUB-1',
      residentId: 'RES-1',
      recordedById: 'staff-1',
      recordedByRole: 'rhu_personnel',
      healthServiceId: 'service-1',
      healthServiceName: 'Consultation',
      medications: [{ genericName: 'Synthetic medicine', dose: 'Clinician-entered dose' }],
      bpClassification: 'normal',
      referralRequired: false,
    }), /health_service_id/);

    assert.equal(requests.length, 1);
    assert.equal(requests[0].health_service_id, 'service-1');
    for (const column of [
      'health_service_id',
      'health_service_name',
      'medications',
      'bp_classification',
      'referral_required',
    ]) {
      assert.equal(Object.hasOwn(requests[0], column), true, `${column} must remain in the original failed write`);
    }
    assert.equal(requests[0].medications[0].dose, 'Clinician-entered dose');
  } finally {
    globalThis.fetch = originalFetch;
  }
});
