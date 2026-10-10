import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildProgramCsv, buildOralStatisticsCsv,
} from '../../frontend/src/features/health-records/lib/programFormExport.js';

/**
 * Regression tests for the official-format CSV export builders (pure functions;
 * the browser download helper is not exercised here). These guard worksheet
 * column order/headings and that no record is dropped.
 */

test('ncd-risk CSV: official header order + one row per record, codes preserved', () => {
  const rows = [
    { assessment_date: '2026-01-10', family_serial_no: 'FS-1', se_status: 'NHTS', age: 45, sex: 'F',
      resident: { first_name: 'Maria', last_name: 'Santos', current_address: 'Purok 1' },
      data: { current_smoker: 'Y', binge_alcohol: 'N', weight_class: '2', htn_result: '+' } },
    { assessment_date: '2026-01-11', family_serial_no: 'FS-2', se_status: 'Non-NHTS', age: 52, sex: 'M',
      resident: { first_name: 'Jose', last_name: 'Cruz', current_address: 'Purok 2' }, data: {} },
  ];
  const csv = buildProgramCsv('ncd-risk', rows);
  const lines = csv.split('\r\n');
  assert.equal(lines.length, 3); // header + 2 records (no record dropped)
  assert.ok(lines[0].startsWith('No.,Date of Assessment,Family Serial No.,Name (FN, MI, LN)'.replace('Name (FN, MI, LN)', '"Name (FN, MI, LN)"')));
  assert.match(lines[1], /Maria Santos/);
  assert.match(lines[1], /,Y,N,2,/); // smoker/alcohol/weight codes preserved in order
  assert.match(lines[1], /1,2026-01-10/); // row number + date
});

test('oral-health CSV includes all 19 official service code columns', () => {
  const csv = buildProgramCsv('oral-health', []);
  const header = csv.split('\r\n')[0];
  for (const code of ['OE', 'IIOHC', 'AEBF', 'TFA', 'STB', 'OHE', 'E/C', 'ART', 'OPS', 'PFS', 'TF', 'PF', 'OUT', 'GT', 'RP', 'RUT', 'Ref', 'TPEC', 'Dr']) {
    assert.ok(header.split(',').includes(code), `missing service column ${code}`);
  }
});

test('environmental CSV exports derived indicators as check marks', () => {
  const rows = [{
    household: { head_name: 'Dela Cruz' }, se_status: 'NHTS', water_supply_type: 'level3',
    has_basic_safe_water: true, has_sanitary_toilet: true, complete_sanitation: false,
    data: { safely_managed_water: true },
  }];
  const csv = buildProgramCsv('environmental', rows);
  const line = csv.split('\r\n')[1];
  assert.match(line, /Dela Cruz/);
  assert.match(line, /√/); // derived indicator rendered as a check
});

test('oral ST CSV has indicator rows and sex columns', () => {
  const stats = {
    indicator_1_orally_fit_12_59: { label: 'Orally fit 12-59', counts: { nhts: 1, non_nhts: 0, total: 1, m: 1, f: 0 } },
    indicator_2_dmft_new: { label: 'DMFT new', counts: { nhts: 0, non_nhts: 1, total: 1, m: 0, f: 1 } },
    bohc: {
      bohc_0_11: { label: 'Infants 0-11 BOHC', counts: { nhts: 0, non_nhts: 0, total: 0, m: 0, f: 0 }, target_basis: 'x', target: 62 },
    },
  };
  const csv = buildOralStatisticsCsv(stats);
  const lines = csv.split('\r\n');
  assert.ok(lines[0].includes('Male') && lines[0].includes('Female') && lines[0].includes('Target'));
  assert.equal(lines.length, 4); // header + 2 indicators + 1 bohc
  assert.match(lines[3], /62$/);
});
