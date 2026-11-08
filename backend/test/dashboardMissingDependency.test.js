import assert from 'node:assert/strict';
import test from 'node:test';

import {
  attachRiskToResidents,
  getRiskSummary,
  assessResidentById,
} from '../src/services/residentRisk.service.js';
import { getById as getReferralById } from '../src/services/referrals.service.js';

const missingRpc = async () => ({ data: null, error: { code: '42883', message: 'function public.resident_risk_for_ids(text[], uuid) does not exist' } });
const reader = { id: 'user-a', role: 'health_supervisor', municipalityId: 'municipality-a', barangay: 'San Antonio', status: 'active' };
const missingTable = async () => ({ data: null, error: { code: '42P01', message: 'relation "public.health_referrals" does not exist' } });

// The three dashboard sections must surface a real 503 with a diagnosis code,
// NEVER a fabricated zero/empty result, when the backing analytics/referral
// schema objects are absent (the Nov-6 migrations have not been deployed and
// PostgREST has not refreshed its schema cache).

test('resident risk detail surfaces RISK_SOURCE_UNAVAILABLE instead of inventing unassessed data', async () => {
  const repo = { driver: 'supabase', getResident: async () => ({ id: 'resident-a' }) };
  await assert.rejects(
    attachRiskToResidents([{ id: 'resident-a' }], { repo, user: reader, supabase: { rpc: missingRpc } }),
    (error) => error.statusCode === 503 && error.code === 'RISK_SOURCE_UNAVAILABLE' && /20261106030000 and 20261106041000/.test(error.message),
  );
  await assert.rejects(
    assessResidentById({ id: 'resident-a', repo, user: reader, supabase: { rpc: missingRpc } }),
    (error) => error.statusCode === 503 && error.code === 'RISK_SOURCE_UNAVAILABLE',
  );
});

test('resident risk summary never returns zero counts when the summary RPC is missing', async () => {
  const repo = { driver: 'supabase' };
  await assert.rejects(
    getRiskSummary({ user: reader, repo, supabase: { rpc: missingRpc } }),
    (error) => error.statusCode === 503 && error.code === 'RISK_SOURCE_UNAVAILABLE',
  );
});

const missingSchemaTable = () => {
  const error = { code: '42P01', message: 'relation "public.health_referral_legacy_map" does not exist' };
  return { data: null, error };
};
const supabaseChain = () => {
  const chain = {
    select: () => chain,
    eq: () => chain,
    order: () => chain,
    limit: () => chain,
    maybeSingle: async () => missingSchemaTable(),
  };
  return chain;
};

test('referral reads surface REFERRAL_SCHEMA_UNAVAILABLE instead of an empty list', async () => {
  const supabase = { from: () => supabaseChain() };
  await assert.rejects(
    getReferralById({ user: reader, id: '00000000-0000-0000-0000-000000000000', supabase }),
    (error) => error.statusCode === 503 && error.code === 'REFERRAL_SCHEMA_UNAVAILABLE' && /20261106010000/.test(error.message),
  );
});

test('a missing referral table does not masquerade as an authorized empty register', async () => {
  const supabase = { from: () => supabaseChain() };
  await assert.rejects(
    getReferralById({ user: reader, id: '00000000-0000-0000-0000-000000000000', supabase }),
    (error) => error.statusCode === 503 && error.code === 'REFERRAL_SCHEMA_UNAVAILABLE',
  );
});