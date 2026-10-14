import assert from 'node:assert/strict';
import test from 'node:test';

process.env.SUPABASE_URL = 'http://127.0.0.1:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';

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

test('insertVisit retries without optional consultation fields when health-service columns are missing', async () => {
  try {
    const result = await repository.insertVisit({
      id: 'SUB-1',
      residentId: 'RES-1',
      recordedById: 'staff-1',
      recordedByRole: 'rhu_personnel',
      healthServiceId: 'service-1',
      healthServiceName: 'Consultation',
      medications: [],
      bpClassification: 'normal',
      referralRequired: false,
    });

    assert.equal(result.id, 'SUB-1');
    assert.equal(requests.length, 2);
    assert.equal(requests[0].health_service_id, 'service-1');
    for (const column of [
      'health_service_id',
      'health_service_name',
      'medications',
      'bp_classification',
      'referral_required',
    ]) {
      assert.equal(Object.hasOwn(requests[1], column), false, `${column} should be omitted on retry`);
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});
