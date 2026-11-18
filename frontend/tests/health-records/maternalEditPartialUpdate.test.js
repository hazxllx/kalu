import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  buildCreateMaternalPayload,
  buildEditMaternalHeaderPatch,
  computeEddFromLmp,
} from '../../src/features/health-records/lib/maternalPayloads.js';

const existingRecordWithMilestones = {
  id: 'mat-001',
  residentId: 'res-001',
  lmp: '2026-01-10',
  edd: '2026-10-17',
  prenatalVisits: 4,
  risk: 'Moderate',
  status: 'Delivered',
  provider: 'Midwife Santos',
  notes: 'Initial notes',
  dateOfRegistration: '2026-02-01',
  familySerialNo: 'FSN-100',
  socioEconomicStatus: 'NHTS',
  gravida: 2,
  para: 0,
  tt_td_doses: { td1: '2026-02-15', td2: '2026-03-15' },
  fim_status: true,
  prenatal_micronutrients: { iron_folic_tablets: 90, calcium_tablets: 60 },
  syphilis_screen_date: '2026-02-20',
  syphilis_result: '-',
  delivery_date: '2026-10-15',
  delivery_outcome: 'Live Birth',
  pp_checkup_24h: '2026-10-16',
};

test('P0-2: buildEditMaternalHeaderPatch returns only changed pregnancy header fields', () => {
  const form = {
    lmp: '2026-01-10',
    gravida: '2',
    para: '0',
    dateOfRegistration: '2026-02-01',
    risk: 'High',
    socioEconomicStatus: 'NHTS',
    notes: 'Updated risk after checkup',
  };

  const patch = buildEditMaternalHeaderPatch(form, existingRecordWithMilestones);

  assert.deepEqual(patch, {
    risk: 'High',
    notes: 'Updated risk after checkup',
  });

  // Never include clinical milestone fields in the partial update patch.
  for (const forbiddenKey of [
    'prenatal_visits',
    'status',
    'provider',
    'family_serial_no',
    'tt_td_doses',
    'fim_status',
    'prenatal_micronutrients',
    'iodine_given_date',
    'deworming_date',
    'syphilis_screen_date',
    'syphilis_result',
    'hepb_screen_date',
    'gdm_screen_date',
    'cbc_screen_date',
    'pregnancy_outcome',
    'type_of_delivery',
    'delivery_date',
    'delivery_outcome',
    'pp_checkup_24h',
    'pp_checkup_day3',
    'pp_checkup_7_14d',
    'pp_checkup_6wk',
    'smoking_history',
    'bmi',
  ]) {
    assert.equal(
      Object.prototype.hasOwnProperty.call(patch, forbiddenKey),
      false,
      `Edit patch must not overwrite ${forbiddenKey}`,
    );
  }
});

test('P0-2: editing LMP recomputes EDD without wiping clinical milestones', () => {
  const form = {
    lmp: '2026-01-15',
    gravida: 2,
    para: 0,
    dateOfRegistration: '2026-02-01',
    risk: 'Moderate',
    socioEconomicStatus: 'NHTS',
    notes: 'Initial notes',
  };

  const patch = buildEditMaternalHeaderPatch(form, existingRecordWithMilestones);
  assert.deepEqual(patch, {
    lmp: '2026-01-15',
    edd: computeEddFromLmp('2026-01-15'),
  });

  // Simulate DB partial update preserving untouched columns
  const persisted = {
    prenatal_visits: 4,
    status: 'Delivered',
    tt_td_doses: { td1: '2026-02-15', td2: '2026-03-15' },
    fim_status: true,
    prenatal_micronutrients: { iron_folic_tablets: 90, calcium_tablets: 60 },
    syphilis_screen_date: '2026-02-20',
    syphilis_result: '-',
    delivery_date: '2026-10-15',
    delivery_outcome: 'Live Birth',
    pp_checkup_24h: '2026-10-16',
    lmp: '2026-01-10',
    edd: '2026-10-17',
  };
  const updated = { ...persisted, ...patch };
  assert.equal(updated.prenatal_visits, 4);
  assert.equal(updated.status, 'Delivered');
  assert.deepEqual(updated.tt_td_doses, { td1: '2026-02-15', td2: '2026-03-15' });
  assert.equal(updated.fim_status, true);
  assert.deepEqual(updated.prenatal_micronutrients, { iron_folic_tablets: 90, calcium_tablets: 60 });
  assert.equal(updated.syphilis_screen_date, '2026-02-20');
  assert.equal(updated.delivery_date, '2026-10-15');
  assert.equal(updated.pp_checkup_24h, '2026-10-16');
  assert.equal(updated.lmp, '2026-01-15');
});

test('P0-2: buildCreateMaternalPayload still initializes defaults for new registrations', () => {
  const payload = buildCreateMaternalPayload({
    lmp: '2026-03-01',
    gravida: '1',
    para: '0',
    dateOfRegistration: '2026-04-01',
    risk: 'Low',
    socioEconomicStatus: 'Non-NHTS',
    notes: 'First pregnancy',
  });
  assert.equal(payload.prenatal_visits, 0);
  assert.equal(payload.status, 'Active');
  assert.equal(payload.gravida, 1);
  assert.equal(payload.para, 0);
});

test('P0-2: M1Records and MaternalRecordWorkflow wire partial edit update and preserve para=0', () => {
  const m1Src = fs.readFileSync(
    path.resolve('src/features/health-records/pages/M1Records.jsx'),
    'utf8',
  );
  const wfSrc = fs.readFileSync(
    path.resolve('src/features/health-records/components/MaternalRecordWorkflow.jsx'),
    'utf8',
  );
  assert.match(m1Src, /buildEditMaternalHeaderPatch\(form, editingRecord\)/);
  assert.match(wfSrc, /gravida:\s*initial\.gravida\s*\?\?\s*""/);
  assert.match(wfSrc, /para:\s*initial\.para\s*\?\?\s*""/);
});
