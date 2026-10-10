import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

/**
 * The program-form clinical tables must enforce the same write boundary as the
 * Express API: BHW (data-collection only) and resident/rhu_personnel may not
 * INSERT/UPDATE clinical program records directly via PostgREST. These tests
 * assert the RLS write policies in the new migrations exclude BHW and restrict
 * writes to mho/phn (municipality) and health_supervisor (barangay).
 */

const read = (name) => fs.readFileSync(
  fileURLToPath(new URL(`../../supabase/migrations/${name}`, import.meta.url)),
  'utf8',
);

const ncdOral = read('20261011000000_ncd_oral_health_tcl.sql');
const envi = read('20261011000100_environmental_masterlist.sql');

for (const [label, sql] of [['ncd/oral', ncdOral], ['environmental', envi]]) {
  test(`${label} RLS write policies exclude BHW and enforce clinical roles`, () => {
    // Isolate the insert/update policy region (ignore the broader select policy,
    // which may legitimately allow municipality-wide read for rhu_personnel).
    const insertIdx = sql.indexOf('_insert');
    const writeRegion = sql.slice(insertIdx);
    assert.match(writeRegion, /profile_role\(\) in \('mho','phn'\)/);
    assert.match(writeRegion, /profile_role\(\) = 'health_supervisor'/);
    assert.match(writeRegion, /profile_covers_barangay\(barangay_id\)/);
    assert.match(writeRegion, /municipality_id = public\.profile_municipality_id\(\)/);
    // BHW must never appear in a write policy.
    assert.doesNotMatch(writeRegion, /'bhw'/);
    // rhu_personnel is not a program-form writer either.
    assert.doesNotMatch(writeRegion, /rhu_personnel/);
  });
}

test('new program tables enable row level security', () => {
  for (const t of ['ncd_risk_assessments', 'ncd_cervical_breast', 'ncd_visual_ppv', 'oral_health_records']) {
    assert.ok(ncdOral.includes(t), `migration references ${t}`);
  }
  assert.match(ncdOral, /enable row level security/);
  assert.match(envi, /alter table public\.environmental_masterlist enable row level security/);
});
