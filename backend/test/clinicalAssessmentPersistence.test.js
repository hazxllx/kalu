import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { buildEncounterAssessment, indicatorsFromFindings } from '../src/services/clinicalAssessment.service.js';
import { DEFAULT_CLINICAL_ASSESSMENT_CONFIG } from '../src/utils/clinicalAssessment.js';
import { approveClinicalAssessmentProtocol } from '../src/services/clinicalAssessmentProtocol.service.js';

const user = { id: 'clinician', municipalityId: 'municipality' };
const visit = { residentId: 'resident', visitDate: '2026-11-20T09:00:00+08:00', vitals: { bp: '140/90' }, findings: 'Severe headache' };
const protocol = { version: 'reviewed-v1', thresholds: DEFAULT_CLINICAL_ASSESSMENT_CONFIG.thresholds,
  approved_by: 'reviewer', approved_at: '2026-11-19T00:00:00Z', review_reference: 'Reviewed municipal referral protocol' };
const client = (approved = protocol, maternalError = null) => ({ from(table) {
  const query = { select() { return query; }, eq() { return query; }, lte() { return query; }, order() { return query; }, limit() { return query; },
    async maybeSingle() { return table === 'clinical_assessment_protocols' ? { data: approved } : table === 'ncd_risk_assessments' ? { data: null } : {
      data: { status: 'active', edd_date: '2027-03-01' }, error: maternalError,
    }; } };
  return query;
} });

test('unapproved rules and unavailable configuration never activate classifications', async () => {
  for (const supabase of [null, client(null), client({ ...protocol, thresholds: {} })]) {
    const details = await buildEncounterAssessment({ visit, user, supabase });
    assert.equal(details.clinicalAssessment.level, null);
    assert.equal(details.clinicalAssessment.status, 'pending_clinical_approval');
    assert.equal(details.clinicalAssessment.referralEvaluationRequired, null);
    assert.equal(details.clinicalAssessmentHistory.length, 1);
  }
});

test('approved maternal risk retains reference, inputs and append-only server history', async () => {
  const first = await buildEncounterAssessment({ visit, user, supabase: client() });
  const risk = first.clinicalAssessment;
  assert.equal(risk.level, 'High');
  assert.equal(risk.referralEvaluationRequired, true);
  assert.equal(risk.destination, null);
  assert.equal(risk.ruleVersion, 'reviewed-v1');
  assert.ok(risk.inputs.pregnancy.gestationalAgeWeeks > 0);
  assert.ok(risk.reasons.some((reason) => reason.field === 'severeHeadache'));
  const second = await buildEncounterAssessment({ visit, user, supabase: client(), previous: first });
  assert.deepEqual(second.clinicalAssessmentHistory[0], first.clinicalAssessment);
  assert.equal(second.clinicalAssessmentHistory.length, 2);
});

test('negative narrative does not create positive danger signs and actual positives win over stale negatives', async () => {
  assert.deepEqual(indicatorsFromFindings('No severe bleeding; mother had suspected stroke; denies convulsions; Patient reports blurred vision and severe headache'), { visualDisturbance: true, severeHeadache: true });
  const details = await buildEncounterAssessment({ visit: { ...visit, findings: 'Severe bleeding',
    consultationDetails: { clinicalIndicators: { severeBleeding: false } } }, user, supabase: client() });
  assert.equal(details.clinicalAssessment.inputs.indicators.severeBleeding, true);
  assert.equal(details.clinicalAssessment.urgency, 'immediate');
});

test('BP safety remains actionable without approved protocol or maternal data', async () => {
  for (const supabase of [null, client(null), client(protocol, new Error('unavailable'))]) {
    for (const [findings, indicators, urgency] of [
      ['Chest pain', { chestPain: false }, 'immediate'],
      ['Denies chest pain and shortness of breath', {}, 'prompt'],
      ['Denies chest pain and visual disturbance', {}, 'prompt'],
      ['Alert', { chestPain: true }, 'immediate'],
    ]) {
      const result = await buildEncounterAssessment({ visit: { ...visit, vitals: { bp: '190/125' },
        findings, consultationDetails: { clinicalIndicators: indicators } }, user, supabase });
      const assessment = result.clinicalAssessment;
      assert.equal(assessment.level, 'High');
      assert.equal(assessment.urgency, urgency);
      assert.equal(assessment.referralEvaluationRequired, true);
      if (urgency === 'immediate') assert.ok(!assessment.followUpRequirements.some((value) => value.includes('repeat')));
    }
  }
  const result = await buildEncounterAssessment({ visit: { ...visit, vitals: {}, findings: 'Unresponsive' }, user });
  assert.equal(result.clinicalAssessment.status, 'pending_clinical_approval');
  assert.equal(result.clinicalAssessment.urgency, null);
});

test('protocol approval requires scoped clinical role, cited protocol and complete ordered thresholds', async () => {
  const payload = { version: 'municipal-v2', reviewReference: 'DOH OHG p. 158 and local referral protocol v2',
    thresholds: DEFAULT_CLINICAL_ASSESSMENT_CONFIG.thresholds };
  const writes = [];
  const supabase = { from() { const query = { upsert(row) { writes.push(row); return query; }, select() { return query; },
    single: async () => ({ data: { municipality_id: user.municipalityId, version: 'municipal-v2', thresholds: payload.thresholds,
      approved_by: user.id, active: true }, error: null }) }; return query; } };
  await assert.rejects(approveClinicalAssessmentProtocol({ user: { ...user, role: 'health_supervisor' }, payload, supabase }), /municipal MHO or PHN/);
  await assert.rejects(approveClinicalAssessmentProtocol({ user: { ...user, municipalityId: null, role: 'phn' }, payload, supabase }), /municipal MHO or PHN/);
  await assert.rejects(approveClinicalAssessmentProtocol({ user: { ...user, role: 'phn' }, payload: { ...payload, thresholds: {} }, supabase }), /Clinical protocol approval is incomplete/);
  const result = await approveClinicalAssessmentProtocol({ user: { ...user, role: 'phn' }, payload, supabase, now: '2026-11-20T00:00:00Z' });
  assert.equal(writes[0].approved_by, user.id);
  assert.equal(writes[0].municipality_id, user.municipalityId);
  assert.equal(writes[0].review_reference, payload.reviewReference);
  assert.equal(result.active, true);
});

test('database enforces clinical approval role and preserves assessment history', async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role;
      create table municipalities(id uuid primary key);
      create table profiles(id uuid primary key, role text, status text, municipality_id uuid);
      create table visits(id text primary key, consultation_details jsonb default '{}');
      insert into municipalities values ('00000000-0000-0000-0000-000000000001');
      insert into profiles values ('00000000-0000-0000-0000-000000000002','mho','active','00000000-0000-0000-0000-000000000001');`);
    await db.exec(await readFile(new URL('../../supabase/migrations/20261120190000_clinical_assessment_protocols.sql', import.meta.url), 'utf8'));
    await assert.rejects(db.exec(`insert into clinical_assessment_protocols(municipality_id,version,active)
      values ('00000000-0000-0000-0000-000000000001','v1',true)`));
    await db.exec(`insert into clinical_assessment_protocols(municipality_id,version,thresholds,active,approved_by,approved_at,review_reference)
      values ('00000000-0000-0000-0000-000000000001','v1','{"adultElevated":{"systolic":140,"diastolic":90},"adultSevere":{"systolic":180,"diastolic":110},"pregnancyElevated":{"systolic":140,"diastolic":90},"pregnancySevere":{"systolic":160,"diastolic":110}}',true,'00000000-0000-0000-0000-000000000002',now(),'Reviewed municipal protocol v1');`);
    assert.equal((await db.query('select * from clinical_assessment_protocol_history')).rows.length, 1);
    await db.exec(`insert into visits values ('visit','{"clinicalAssessmentHistory":[{"level":"High"}]}');`);
    await assert.rejects(db.exec(`update visits set consultation_details='{}' where id='visit'`), /append-only/);
    await db.exec(`update visits set consultation_details='{"clinicalAssessmentHistory":[{"level":"High"},{"level":"Medium"}]}' where id='visit'`);
    await assert.rejects(db.exec(`update visits set consultation_details='{"clinicalAssessmentHistory":[{"level":"Low"},{"level":"Medium"}]}' where id='visit'`), /append-only/);
  } finally { await db.close(); }
});
