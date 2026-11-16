import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import env from '../src/config/env.js';
env.isSupabaseConfigured = false;

import { list as listOperational, validateMaternalRecord, validateMaternalVisit } from '../src/services/operational.service.js';

const migrationPath = fileURLToPath(new URL(
  '../../supabase/migrations/20261116110000_maternal_visit_detail_snapshots.sql',
  import.meta.url,
));

test('maternal visits validate and retain measurement and structured encounter history', () => {
  const clinicalData = {
    prenatal: { td1Date: '2026-10-01', syphilisResult: '-' },
  };
  const visit = validateMaternalVisit({
    visit_date: '2026-10-01',
    visit_type: 'prenatal',
    weight: 62.5,
    height_cm: 158,
    clinical_data: clinicalData,
  });

  assert.equal(visit.height_cm, 158);
  assert.deepEqual(visit.clinical_data, clinicalData);
  assert.throws(() => validateMaternalVisit({ visit_date: '2026-10-01', height_cm: 0 }), /positive number/);
  assert.throws(() => validateMaternalVisit({ visit_date: '2026-10-01', clinical_data: [] }), /must be an object/);
  assert.throws(
    () => validateMaternalVisit({ visit_date: '2026-10-01', clinical_data: { notes: 'x'.repeat(30001) } }),
    /too large/,
  );
});

test('maternal case validation accepts unrecorded lifestyle values and rejects invalid clinical data', () => {
  const record = validateMaternalRecord({
    gravida: '2',
    para: 1,
    fim_status: null,
    smoking_history: null,
    tt_td_doses: { td1: '2026-10-01' },
    prenatal_micronutrients: { iron_folic_tablets: 30 },
  });
  assert.equal(record.gravida, 2);
  assert.equal(record.fim_status, null);
  assert.throws(() => validateMaternalRecord({ lmp: '2026-02-31' }), /valid date/);
  assert.throws(() => validateMaternalRecord({ gravida: -1 }), /non-negative whole number/);
  assert.throws(() => validateMaternalRecord({ fim_status: 'no' }), /true or false/);
  assert.throws(() => validateMaternalRecord({ prenatal_micronutrients: { calcium_tablets: -1 } }), /non-negative whole number/);
});

test('maternal visit listing paginates history beyond one API page', async () => {
  const rows = Array.from({ length: 205 }, (_, index) => ({ id: `visit-${index}` }));
  const ranges = [];
  const query = {
    select() { return this; },
    order() { return this; },
    eq() { return this; },
    gte() { return this; },
    lte() { return this; },
    limit() { return this; },
    async range(from, to) {
      ranges.push([from, to]);
      return { data: rows.slice(from, to + 1), error: null };
    },
  };
  const visits = await listOperational({
    user: { id: 'staff-1', role: 'health_supervisor', barangayId: 'barangay-1' },
    kind: 'maternalvisits',
    supabase: { from: () => query },
  });

  assert.equal(visits.length, 205);
  assert.deepEqual(ranges, [[0, 199], [200, 399]]);
});

test('maternal encounter migration adds history fields and makes unrecorded yes/no values nullable', () => {
  const sql = fs.readFileSync(migrationPath, 'utf8');
  assert.match(sql, /add column if not exists height_cm numeric/);
  assert.match(sql, /add column if not exists clinical_data jsonb not null default '\{\}'::jsonb/);
  assert.match(sql, /alter column smoking_history drop not null/);
  assert.match(sql, /alter column fim_status drop default/);
  assert.doesNotMatch(sql, /delete from public\.(maternal_records|maternal_visits)/i);
});
