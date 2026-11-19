import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

test('dosage cleanup removes only unchanged unverified seeds and preserves prescriptions and reviewed/custom catalog entries', async () => {
  const db = new PGlite();
  const migration = await readFile(new URL('../../supabase/migrations/20261119020000_clear_unverified_seeded_dosage_references.sql', import.meta.url), 'utf8');
  const seeded = 'Adults: 5 mg once daily; up to 10 mg as prescribed.';
  try {
    await db.exec(`create table public.medicines (
      id text, source text, generic_name text, strength text, dosage_form text,
      dosage_instructions text, created_by text, dosage_verified_by text, dosage_verified_at timestamptz
    ); create table public.visits(id text, medications jsonb);`);
    for (const row of [
      ['seed', seeded, null, null, null],
      ['verified', seeded, null, 'reviewer', '2026-11-01T00:00:00Z'],
      ['edited', 'Individually curated reference', null, null, null],
      ['admin', seeded, 'administrator', null, null],
    ]) {
      await db.query("insert into public.medicines values($1,'yakap','Amlodipine','5 mg','Tablet',$2,$3,$4,$5)", row);
    }
    const prescriptions = [{ genericName: 'Synthetic medicine', instructions: seeded, dose: 'Recorded historical dose' }];
    await db.query('insert into public.visits values($1,$2)', ['history', JSON.stringify(prescriptions)]);
    await db.exec(migration);
    await db.exec(migration);
    const rows = Object.fromEntries((await db.query('select id,dosage_instructions from public.medicines')).rows.map((row) => [row.id, row.dosage_instructions]));
    assert.deepEqual(rows, { seed: '', verified: seeded, edited: 'Individually curated reference', admin: seeded });
    assert.deepEqual((await db.query('select medications from public.visits')).rows[0].medications, prescriptions);
  } finally { await db.close(); }
});
