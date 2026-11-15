import assert from 'node:assert/strict';
import { before, describe, test } from 'node:test';
import 'dotenv/config';

const enabled = process.env.RUN_M1_DATABASE_VALIDATION === '1';

describe('M1 database validation (explicit read-only target)', { skip: !enabled }, () => {
  let db;
  let getRecordsByProgram;
  let drilldown;
  let supervisors = [];

  before(async () => {
    const configuredUrl = String(process.env.SUPABASE_URL || '').trim();
    const expectedProjectRef = String(process.env.M1_DATABASE_VALIDATION_EXPECTED_PROJECT_REF || '').trim();
    assert.ok(configuredUrl, 'SUPABASE_URL is required for database validation.');
    assert.ok(expectedProjectRef, 'M1_DATABASE_VALIDATION_EXPECTED_PROJECT_REF is required.');

    const host = new URL(configuredUrl).hostname;
    const actualProjectRef = host.split('.')[0];
    assert.equal(actualProjectRef, expectedProjectRef, 'Configured Supabase target does not match the explicit validation target.');

    const local = ['localhost', '127.0.0.1', '::1'].includes(host);
    if (!local) {
      assert.equal(
        process.env.M1_DATABASE_VALIDATION_ALLOW_PRODUCTION_READ_ONLY,
        '1',
        'A non-local database requires explicit read-only production validation approval.',
      );
    }

    const [{ getServiceClient }, m1Service] = await Promise.all([
      import('../src/config/supabase.js'),
      import('../src/services/m1.service.js'),
    ]);
    db = getServiceClient();
    getRecordsByProgram = m1Service.getRecordsByProgram;
    drilldown = m1Service.drilldown;

    const profileResult = await db
      .from('profiles')
      .select('id, barangay_id, municipality_id')
      .eq('role', 'health_supervisor');
    assert.ifError(profileResult.error);
    supervisors = [...new Map(
      (profileResult.data || [])
        .filter((row) => row.barangay_id)
        .map((row) => [row.barangay_id, row]),
    ).values()];
  });

  test('required M1 source tables are readable', async () => {
    for (const table of ['m1_indicators', 'm1_records', 'm1_manual_entries', 'barangays', 'households']) {
      const result = await db.from(table).select('*', { count: 'exact', head: true });
      assert.ifError(result.error);
      assert.equal(Number.isInteger(result.count), true, `${table} did not return an exact count.`);
    }
  });

  test('stored indicator codes are unique and source mappings are present', async () => {
    const result = await db.from('m1_indicators').select('code, source').limit(1000);
    assert.ifError(result.error);
    const rows = result.data || [];
    assert.equal(new Set(rows.map((row) => row.code)).size, rows.length);
    assert.equal(rows.every((row) => row.code && row.source), true);
  });

  test('scoped M1 records and manual entries have barangay assignments', async () => {
    for (const table of ['m1_records', 'm1_manual_entries']) {
      const result = await db
        .from(table)
        .select('*', { count: 'exact', head: true })
        .is('barangay_id', null);
      assert.ifError(result.error);
      assert.equal(result.count, 0, `${table} contains records without barangay scope.`);
    }
  });

  test('environmental summaries match every traceable drilldown in each supervisor scope', async () => {
    assert.ok(supervisors.length > 0, 'No assigned Health Supervisor scope is available for validation.');
    const now = new Date();
    const year = now.getUTCFullYear();
    const month = now.getUTCMonth() + 1;
    const derivedCodes = ['G_1', 'G_1_1', 'G_1_2', 'G_1_3', 'G_2', 'G_3', 'G_3_1', 'G_3_2', 'G_3_3', 'G_4'];

    for (const profile of supervisors) {
      const user = {
        id: profile.id,
        role: 'health_supervisor',
        barangayId: profile.barangay_id,
        municipalityId: profile.municipality_id,
      };
      const report = await getRecordsByProgram({
        user,
        programId: 'environmental',
        period: 'monthly',
        year,
        month,
      }, db);

      assert.equal(Object.keys(report.indicators).length, 12);
      assert.ok(report.summary.total <= report.count.records);
      for (const indicatorCode of derivedCodes) {
        const view = await drilldown({
          user,
          indicatorCode,
          period: 'monthly',
          year,
          month,
          supabase: db,
        });
        assert.equal(view.count, report.indicators[indicatorCode].total, `${indicatorCode} summary/drilldown mismatch.`);
      }
    }
  });

  test('a supervisor cannot request another assigned barangay', async () => {
    if (supervisors.length < 2) return;
    const own = supervisors[0];
    const other = supervisors[1];
    await assert.rejects(
      drilldown({
        user: {
          id: own.id,
          role: 'health_supervisor',
          barangayId: own.barangay_id,
          municipalityId: own.municipality_id,
        },
        indicatorCode: 'G_1_1',
        period: 'monthly',
        year: new Date().getUTCFullYear(),
        month: new Date().getUTCMonth() + 1,
        barangayId: other.barangay_id,
        supabase: db,
      }),
      (error) => error.statusCode === 403,
    );
  });
});
