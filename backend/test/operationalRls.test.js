import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const migrationPath = fileURLToPath(new URL(
  '../../supabase/migrations/20261009090000_harden_operational_clinical_rls.sql',
  import.meta.url,
));
const sql = fs.readFileSync(migrationPath, 'utf8');

test('operational RLS write policies exclude BHW and enforce clinical roles', () => {
  assert.match(sql, /profile_role\(\) in \('mho', 'phn', 'rhu_personnel'\)/);
  assert.match(sql, /profile_role\(\) = 'health_supervisor'/);
  assert.doesNotMatch(sql, /profile_role\(\).*'bhw'/);
  assert.match(sql, /municipality_id = public\.profile_municipality_id\(\)/);
  assert.match(sql, /public\.profile_covers_barangay\(barangay_id\)/);
  assert.match(sql, /for insert to authenticated/);
  assert.match(sql, /for update to authenticated/);
});
