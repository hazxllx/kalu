import assert from 'node:assert/strict';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import fileRepository from '../src/repositories/fileRepository.js';
import store from '../src/repositories/fileStore.js';
import { annualSummary, drilldown, getRecordsByProgram, periodReport } from '../src/services/m1.service.js';
import { maternalServiceDay, sameMaternalEpisode } from '../src/services/m1MaternalSources.js';

const staff = { id: 'staff', role: 'health_supervisor', barangayId: 'b1', municipalityId: 'm1' };
const serviceId = '11111111-1111-4111-8111-111111111111';
const pregnancyId = '22222222-2222-4222-8222-222222222222';
const secondPregnancyId = '33333333-3333-4333-8333-333333333333';
const resident = (id = 'RES-1', extra = {}) => ({ id, first_name: 'Ana', last_name: 'Cruz', birth_date: '2000-06-15', sex: 'Female', ...extra });
const pregnancy = (extra = {}) => ({ id: pregnancyId, resident_id: 'RES-1', barangay_id: 'b1', municipality_id: 'm1', lmp_date: '2025-10-01', edd_date: '2026-07-08', resident: resident(), ...extra });
const consultation = (id, day, extra = {}) => ({
  id, resident_id: 'RES-1', resident: resident(), barangay_id: 'b1', municipality_id: 'm1',
  health_service_id: serviceId, status: 'completed', visit_date: `${day}T08:00:00+08:00`,
  created_at: '2027-01-01T00:00:00Z',
  consultation_details: { consultationDate: day, maternal: {
    careType: 'prenatal', pregnancyId, lmpDate: '2025-10-01', eddDate: '2026-07-08', gestationalAgeWeeks: null,
  } }, ...extra,
});
const service = { id: serviceId, name: 'Prenatal care', category: 'Maternal' };

// Exercise filtering, actual catalog/resident joins and page boundaries, not
// just method-call assertions. Providers also permit in-memory PostgreSQL rows.
const database = (tables = {}, errors = {}, providers = {}) => {
  const calls = [];
  const db = {
    calls,
    from(table) {
      const predicates = [];
      let projection = '';
      let page = null;
      let order = null;
      const result = async () => {
        let rows = providers[table] ? await providers[table]() : tables[table] || [];
        rows = rows.filter((row) => predicates.every((predicate) => predicate(row)));
        if (order) rows = rows.slice().sort((a, b) => String(a[order] ?? '').localeCompare(String(b[order] ?? '')));
        if (page) rows = rows.slice(page[0], page[1] + 1);
        rows = rows.map((row) => ({ ...row,
          ...(projection.includes('resident:residents') ? { resident: row.resident || (tables.residents || []).find((item) => item.id === row.resident_id) || null } : {}),
          ...(projection.includes('health_service:health_services') ? { health_service: Object.hasOwn(row, 'health_service') ? row.health_service : (tables.health_services || [service]).find((item) => item.id === row.health_service_id) || null } : {}),
        }));
        return { data: rows, error: errors[table] || null };
      };
      const query = {
        select(value) { projection = value; calls.push({ table, method: 'select', value }); return query; },
        eq(field, value) { predicates.push((row) => row[field] === value); calls.push({ table, method: 'eq', field, value }); return query; },
        in(field, values) { predicates.push((row) => values.includes(row[field])); calls.push({ table, method: 'in', field, values }); return query; },
        gte(field, value) { predicates.push((row) => row[field] != null && row[field] >= value); return query; },
        lte(field, value) { predicates.push((row) => row[field] != null && row[field] <= value); return query; },
        lt(field, value) { predicates.push((row) => row[field] != null && row[field] < value); return query; },
        order(field) { order = field; return query; },
        range(start, end) { page = [start, end]; calls.push({ table, method: 'range', start, end }); return query; },
        limit() { return query; },
        async maybeSingle() { const value = await result(); return { ...value, data: value.data[0] || null }; },
        then(resolve, reject) { return result().then(resolve, reject); },
      };
      return query;
    },
  };
  return db;
};
const program = (db, extra = {}) => getRecordsByProgram({ user: staff, programId: 'prenatal', year: 2026, month: 6, period: 'monthly', ...extra }, db);
const report = (db, extra = {}) => periodReport({ user: staff, year: 2026, month: 6, period: 'monthly', supabase: db, ...extra });

test('repeated visits remain raw visits while a fourth distinct day qualifies one resident once', async () => {
  const visits = ['01', '02', '03', '04', '04', '05'].map((day, index) => consultation(`visit-${index}`, `2026-06-${day}`));
  const db = database({ visits, maternal_pregnancies: [pregnancy()] });
  const result = await program(db);
  assert.equal(result.indicators.B1_1.total, 1);
  assert.equal(result.summary.total, 1);
  assert.equal(result.summary.visitCount, 6);
  assert.deepEqual(result.summary.byMonth, { '2026-06': { residents: 1, visits: 6 } });
  assert.equal(result.count.visits, 6);
  assert.equal(result.records.length, 1);
  assert.equal(result.records[0].prenatal_visits, 5);
  assert.deepEqual(result.visits.map((visit) => visit.id).sort(), visits.map((visit) => visit.id).sort());
  const detail = await drilldown({ user: staff, indicatorCode: 'B1_1', year: 2026, month: 6, supabase: db });
  assert.equal(detail.count, 1);
  assert.equal(detail.records[0].date, '2026-06-04');
  assert.equal(detail.records[0].detail.reporting_contacts.length, 6);
  assert.deepEqual(detail.records[0].detail.reporting_contacts[0].record, { ...visits[0], health_service: service });
  assert.deepEqual(visits, ['01', '02', '03', '04', '04', '05'].map((day, index) => consultation(`visit-${index}`, `2026-06-${day}`)), 'reporting does not mutate source records');
});

test('prior-month contacts determine attainment and later-month visits never repeat that event', async () => {
  const visits = ['2025-12-01', '2026-01-10', '2026-05-20', '2026-06-15', '2026-07-01', '2026-07-02'].map((day, index) => consultation(`visit-${index}`, day));
  const db = database({ visits, maternal_pregnancies: [pregnancy()] });
  assert.equal((await report(db, { month: 5 })).byCode.B1_1.total, 0);
  assert.equal((await report(db)).byCode.B1_1.total, 1);
  const july = await program(db, { month: 7 });
  assert.equal(july.indicators.B1_1.total, 0);
  assert.equal(july.summary.total, 1);
  assert.equal(july.visits.length, 2);
  const annual = await annualSummary({ user: staff, year: 2026, supabase: db });
  const indicator = annual.indicators.find((row) => row.code === 'B1_1');
  assert.equal(indicator.annual, 1);
  assert.equal(indicator.months[5], 1);
  assert.equal(indicator.months[6], 0);
  assert.equal((await report(db, { period: 'quarterly', quarter: 2, month: null })).byCode.B1_1.total, 1);
});

test('canonical, duplicate legacy/TCL and consultation sources reconcile the same episode without losing contacts', async () => {
  const legacy = { id: 'legacy', resident_id: 'RES-1', resident: resident(), barangay_id: 'b1', municipality_id: 'm1', pregnancy_id: pregnancyId, lmp: '2025-10-01', edd: '2026-07-08' };
  const tables = {
    maternal_records: [{ ...legacy, id: 'legacy-old', updated_at: '2026-05-01', socio_economic_status: 'Old value' }, { ...legacy, updated_at: '2026-06-01', socio_economic_status: 'Updated value' }],
    maternal_pregnancies: [pregnancy()],
    maternal_visits: ['01', '02', '03'].map((day, index) => ({ id: `legacy-${index}`, maternal_case_id: 'legacy', resident_id: 'RES-1', visit_type: 'prenatal', visit_date: `2026-06-${day}` })),
    pregnancy_encounters: ['01', '02', '03'].map((day, index) => ({ id: `canonical-${index}`, pregnancy_id: pregnancyId, encounter_type: 'prenatal', encounter_date: `2026-06-${day}` })),
    visits: ['01', '04', '04'].map((day, index) => consultation(`consultation-${index}`, `2026-06-${day}`)),
    tcl_entries: [{ id: 'tcl', resident_id: 'RES-1', program: 'Prenatal', barangay_id: 'b1', municipality_id: 'm1', created_at: '2026-06-01T00:00:00Z' }],
  };
  const result = await program(database(tables));
  assert.equal(result.indicators.B1_1.total, 1);
  assert.equal(result.records.length, 1);
  assert.equal(result.records[0].prenatal_visits, 4);
  assert.equal(result.records[0].reporting_contacts.length, 9);
  assert.equal(result.records[0].source_records.length, 3);
  assert.equal(result.records[0].socio_economic_status, 'Updated value');
  assert.equal(result.summary.total, 1);
  assert.equal(tables.visits.length, 3);
  assert.equal(tables.maternal_records.length, 2);
});

test('different pregnancies and stale legacy dates are never pooled into four check-ups', async () => {
  const oldCase = { id: 'old', resident_id: 'RES-1', resident: resident(), barangay_id: 'b1', municipality_id: 'm1', lmp: '2025-09-01', edd: '2026-06-08' };
  const db = database({
    maternal_records: [oldCase], maternal_pregnancies: [pregnancy()],
    maternal_visits: ['01', '02'].map((day) => ({ id: `old-${day}`, maternal_case_id: 'old', visit_type: 'prenatal', visit_date: `2026-06-${day}` })),
    visits: ['03', '04'].map((day) => consultation(`new-${day}`, `2026-06-${day}`)),
  });
  const result = await program(db);
  assert.equal(result.indicators.B1_1.total, 0);
  assert.equal(result.records.length, 2);
  assert.deepEqual(result.records.map((row) => row.prenatal_visits).sort(), [2, 2]);
  assert.equal(sameMaternalEpisode({ resident_id: 'RES-1', lmp: '2025-09-01', edd: '2026-07-08' }, { resident_id: 'RES-1', lmp: '2025-10-01', edd: '2026-07-08' }), false, 'an EDD match does not override a conflicting LMP');
});

test('two confirmed episodes for the same resident retain separate visits but one person per reporting period', async () => {
  const second = pregnancy({ id: secondPregnancyId, lmp_date: '2026-05-01', edd_date: '2027-02-05' });
  const visits = ['01', '02', '03', '04'].map((day) => consultation(`first-${day}`, `2026-06-${day}`));
  visits.push(...['10', '11', '12', '13'].map((day) => consultation(`second-${day}`, `2026-06-${day}`, {
    consultation_details: { consultationDate: `2026-06-${day}`, maternal: { careType: 'prenatal', pregnancyId: secondPregnancyId, lmpDate: second.lmp_date, eddDate: second.edd_date } },
  })));
  const db = database({ visits, maternal_pregnancies: [pregnancy(), second] });
  const result = await program(db);
  assert.equal(result.indicators.B1_1.total, 1);
  assert.equal(result.summary.total, 1);
  assert.equal(result.visits.length, 8);
  assert.deepEqual(result.records.map((row) => row.prenatal_visits), [4, 4]);
  assert.equal((await report(db, { period: 'annual', month: null })).byCode.B1_1.total, 1);
});

test('confirmed canonical consultation identity survives dating changes without merging stale legacy pregnancies', async () => {
  const updatedPregnancy = pregnancy({ lmp_date: '2025-10-05', edd_date: '2026-07-12' });
  const visits = ['01', '02', '03', '04'].map((day) => consultation(`confirmed-${day}`, `2026-06-${day}`));
  for (const visit of visits) visit.consultation_details.clinicalIntegrityVersion = 'consultation-clinical-v1';
  visits[3].consultation_details.maternal.lmpDate = updatedPregnancy.lmp_date;
  visits[3].consultation_details.maternal.eddDate = updatedPregnancy.edd_date;
  const db = database({ maternal_pregnancies: [updatedPregnancy], visits,
    maternal_records: [{ id: 'stale-legacy', resident_id: 'RES-1', resident: resident(), barangay_id: 'b1', municipality_id: 'm1', pregnancy_id: pregnancyId, lmp: '2025-09-01', edd: '2026-06-08' }],
    maternal_visits: ['01', '02'].map((day) => ({ id: `stale-${day}`, maternal_case_id: 'stale-legacy', visit_type: 'prenatal', visit_date: `2026-06-${day}` })),
  });
  const result = await program(db);
  assert.equal(result.indicators.B1_1.total, 1);
  assert.equal(result.records.find((row) => row.id === `canonical-pregnancy-${pregnancyId}`).prenatal_visits, 4);
  assert.equal(result.records.find((row) => row.id === 'stale-legacy').prenatal_visits, 2);
  assert.equal(result.visits.length, 6);
  assert.equal(result.visits.find((visit) => visit.id === 'confirmed-01').record.consultation_details.maternal.eddDate, '2026-07-08');
});

test('partial episode snapshots cannot bind to the first of conflicting complete signatures', async () => {
  const first = { lmpDate: '2026-05-01', eddDate: '2027-02-05', pregnancyId: null, careType: 'prenatal' };
  const second = { ...first, eddDate: '2027-02-12' };
  const visits = [
    consultation('a-partial-1', '2026-06-01', { consultation_details: { consultationDate: '2026-06-01', maternal: { ...first, eddDate: null } } }),
    consultation('a-partial-2', '2026-06-02', { consultation_details: { consultationDate: '2026-06-02', maternal: { ...first, eddDate: null } } }),
    ...['03', '04'].map((day) => consultation(`z-complete-${day}`, `2026-06-${day}`, { consultation_details: { consultationDate: `2026-06-${day}`, maternal: first } })),
    consultation('z-other-episode', '2026-06-05', { consultation_details: { consultationDate: '2026-06-05', maternal: second } }),
  ];
  const result = await program(database({ visits }));
  assert.equal(result.indicators.B1_1.total, 0);
  assert.equal(result.visits.length, 5);
  assert.match(result.warnings.join(' '), /Ambiguous or conflicting pregnancy linkage/);
});

test('a mismatched legacy pregnancy FK does not erase the resident case or borrow another resident encounters', async () => {
  const db = database({
    maternal_pregnancies: [pregnancy({ resident_id: 'RES-other', resident: resident('RES-other') })],
    maternal_records: [{ id: 'own-case', resident_id: 'RES-1', resident: resident(), barangay_id: 'b1', municipality_id: 'm1', pregnancy_id: pregnancyId, lmp: '2025-10-01', edd: '2026-07-08' }],
    maternal_visits: ['01', '02'].map((day) => ({ id: `own-${day}`, maternal_case_id: 'own-case', resident_id: 'RES-1', visit_type: 'prenatal', visit_date: `2026-06-${day}` })),
    pregnancy_encounters: ['03', '04'].map((day) => ({ id: `other-${day}`, pregnancy_id: pregnancyId, resident_id: 'RES-other', encounter_type: 'prenatal', encounter_date: `2026-06-${day}` })),
  });
  const result = await program(db);
  assert.equal(result.indicators.B1_1.total, 0);
  assert.equal(result.records.find((row) => row.resident_id === 'RES-1').id, 'own-case');
  assert.equal(result.records.find((row) => row.resident_id === 'RES-1').prenatal_visits, 2);
});

test('resident Td doses in a later known pregnancy are not reused by an older unresolved pregnancy', async () => {
  const db = database({ maternal_pregnancies: [pregnancy({ gravida: 1 }), pregnancy({ id: secondPregnancyId, lmp_date: '2026-05-01', edd_date: '2027-02-05', gravida: 2 })],
    immunizations: ['01', '10', '20'].map((day, index) => ({ id: `td-${index}`, resident_id: 'RES-1', barangay_id: 'b1', municipality_id: 'm1', vaccine: 'Td', dose: `Td${index + 1}`, status: 'Completed', administered_date: `2026-06-${day}` })),
  });
  const result = await program(db);
  assert.equal(result.indicators.B1_3.total, 0);
  assert.equal(result.indicators.B1_4.total, 1);
  assert.equal(result.records.find((row) => row.pregnancy_id === secondPregnancyId).td_dose_count, 3);
});

test('same-episode legacy and canonical deliveries are one event and keep authoritative source provenance', async () => {
  const db = database({
    maternal_pregnancies: [pregnancy()],
    maternal_records: [{ id: 'legacy-delivery', resident_id: 'RES-1', resident: resident(), barangay_id: 'b1', municipality_id: 'm1', pregnancy_id: pregnancyId, lmp: '2025-10-01', edd: '2026-07-08', delivery_date: '2026-06-15', delivery_outcome: 'Live Birth', birth_weight: '0' }],
    delivery_records: [{ id: 'delivery', pregnancy_id: pregnancyId, resident_id: 'RES-1', barangay_id: 'b1', municipality_id: 'm1', delivery_date: '2026-06-15', delivery_outcome: 'live_birth', birth_weight_kg: 3.2 }],
  });
  const result = await program(db);
  assert.equal(result.indicators.B2_18.total, 1);
  assert.equal(result.indicators.B2_19.total, 1);
  assert.equal(result.indicators.B2_20a.total, 1);
  assert.equal(result.indicators.B2_20c.total, 0);
  assert.equal(result.records[0].source_records.filter((source) => source.source === 'delivery_records').length, 1);
});

test('separate residents with identical names count by ID and age on the attainment date', async () => {
  const visits = ['RES-1', 'RES-2'].flatMap((residentId) => ['01', '02', '03', '15'].map((day) => consultation(`${residentId}-${day}`, `2026-06-${day}`, {
    resident_id: residentId, resident: resident(residentId, { birth_date: '2006-06-15' }),
    consultation_details: { consultationDate: `2026-06-${day}`, maternal: { careType: 'prenatal', lmpDate: '2025-10-01', eddDate: '2026-07-08' } },
  })));
  const result = await program(database({ visits }));
  assert.equal(result.summary.total, 2);
  assert.equal(result.indicators.B1_1.total, 2);
  assert.equal(result.indicators.B1_1.byAge['20-49'], 2);
  assert.equal(result.indicators.B1_1.byAge['15-19'], 0);
});

test('unknown or ambiguous episode identity preserves visits without invented GA, supplements or attainment', async () => {
  const visits = ['01', '02', '03', '04'].map((day) => consultation(`unknown-${day}`, `2026-06-${day}`, {
    weight_kg: 55, height_cm: 160, chief_complaint: 'Prenatal first trimester, iron and calcium completed',
    consultation_details: { consultationDate: `2026-06-${day}`, maternal: { careType: 'prenatal', pregnancyId: null, lmpDate: null, eddDate: null, gestationalAgeWeeks: null } },
  }));
  const result = await program(database({ visits }));
  assert.equal(result.summary.total, 1);
  assert.equal(result.visits.length, 4);
  for (const code of ['B1_1', 'B1_2', 'B1_5', 'B1_6', 'B2_18']) assert.equal(result.indicators[code].total, 0, code);
  const ambiguous = await program(database({ maternal_pregnancies: [pregnancy(), pregnancy({ id: secondPregnancyId })], visits: visits.map((visit) => ({ ...visit,
    consultation_details: { ...visit.consultation_details, maternal: { careType: 'prenatal', pregnancyId: null, lmpDate: '2025-10-01', eddDate: '2026-07-08' } },
  })) }));
  assert.equal(ambiguous.indicators.B1_1.total, 0);
  assert.equal(ambiguous.visits.length, 4);
});

test('explicit postpartum wins and broad Maternal without prenatal evidence does not become ANC', async () => {
  const visits = ['01', '02', '03'].map((day) => consultation(`anc-${day}`, `2026-06-${day}`));
  visits.push(...['04', '05'].map((day) => consultation(`pp-${day}`, `2026-06-${day}`, {
    consultation_details: { consultationDate: `2026-06-${day}`, maternal: { pregnancyId, careType: 'postpartum' } },
  })));
  visits.push(consultation('broad', '2026-06-06', { health_service_name: 'Maternal care', consultation_details: { consultationDate: '2026-06-06' } }));
  const result = await program(database({ visits, maternal_pregnancies: [pregnancy()] }));
  assert.equal(result.indicators.B1_1.total, 0);
  assert.equal(result.indicators.B3_28.total, 1, 'preserves the existing legacy two-contact definition');
  assert.equal(result.summary.visitCount, 3);
  assert.equal(result.visits.length, 6);
  assert.equal(result.visits.find((visit) => visit.id === 'broad').visit_type, 'maternal');
});

test('actual service FK/catalog category classifies historical consultations, never complaint text', async () => {
  const otherId = '44444444-4444-4444-8444-444444444444';
  const visits = [
    consultation('actual', '2026-06-01', { consultation_details: { consultationDate: '2026-06-01' } }),
    consultation('complaint-only', '2026-06-02', { health_service_id: otherId, chief_complaint: 'Prenatal visit', consultation_details: { consultationDate: '2026-06-02' } }),
    consultation('no-fk', '2026-06-03', { health_service_id: null, health_service_name: 'Prenatal care' }),
  ];
  const db = database({ visits, health_services: [service, { id: otherId, name: 'General consultation', category: 'Consultation' }] });
  const result = await program(db);
  assert.deepEqual(result.visits.map((visit) => visit.id), ['actual']);
  assert.equal(result.summary.total, 1);
  assert.ok(db.calls.some((call) => call.table === 'visits' && call.method === 'select' && /health_service:health_services\(id, name, category\)/.test(call.value)));
});

test('barangay attribution uses the fourth actual contact and hides other-barangay raw history', async () => {
  const visits = ['01', '02', '03'].map((day) => consultation(`first-${day}`, `2026-05-${day}`));
  visits.push(consultation('fourth', '2026-06-01', { barangay_id: 'b2' }), consultation('later', '2026-07-01'));
  const db = database({ visits, maternal_pregnancies: [pregnancy()] });
  const otherBarangay = await program(db, { user: { ...staff, barangayId: 'b2' } });
  assert.equal(otherBarangay.indicators.B1_1.total, 1);
  assert.deepEqual(otherBarangay.visits.map((visit) => visit.id), ['fourth']);
  assert.deepEqual(otherBarangay.records[0].reporting_contacts.map((visit) => visit.id), ['fourth']);
  assert.equal(otherBarangay.records[0].source_records.length, 0);
  assert.equal((await program(db)).indicators.B1_1.total, 0);
  assert.equal((await program(db, { month: 7 })).indicators.B1_1.total, 0);
  const outside = consultation('outside', '2026-06-01', { resident_id: 'RES-other', barangay_id: 'b3', municipality_id: 'm2' });
  assert.equal((await program(database({ visits: [outside] }))).visits.length, 0);
});

test('clinical dates use Asia/Manila month boundaries, not UTC slicing or created_at', async () => {
  const visits = [
    consultation('midnight', '2026-05-31', { visit_date: '2026-05-31T16:05:00Z', consultation_details: {} }),
    consultation('before', '2026-05-31', { visit_date: '2026-05-31T15:59:00Z', consultation_details: {} }),
    consultation('july', '2026-06-30', { visit_date: '2026-06-30T16:00:00Z', consultation_details: {} }),
    consultation('explicit', '2026-06-15', { visit_date: '2026-05-15T00:00:00Z' }),
    consultation('undated', '2026-06-20', { visit_date: null, consultation_details: {}, created_at: '2026-06-20T00:00:00Z' }),
  ];
  const result = await program(database({ visits }));
  assert.deepEqual(result.visits.map((visit) => visit.id).sort(), ['explicit', 'midnight']);
  assert.equal(result.visits.find((visit) => visit.id === 'midnight').visit_date, '2026-06-01');
  assert.deepEqual(result.unattributedVisits.map((visit) => visit.id), ['undated']);
  assert.equal(maternalServiceDay('2026-06-01'), '2026-06-01');
  assert.equal(maternalServiceDay('2026-06-01T00:00:00+08:00'), '2026-06-01');
  assert.equal(maternalServiceDay('invalid'), '');
});

test('first-trimester nutrition uses actual complete measurements across duplicate source days', async () => {
  const currentPregnancy = pregnancy({ lmp_date: '2026-06-01', edd_date: '2027-03-08' });
  const db = database({ maternal_pregnancies: [currentPregnancy],
    pregnancy_encounters: [{ id: 'empty-first', pregnancy_id: pregnancyId, encounter_type: 'prenatal', encounter_date: '2026-06-10', gestational_age_weeks: 2 }],
    visits: [consultation('measured', '2026-06-10', { height_cm: 160, weight_kg: 55, consultation_details: {
      consultationDate: '2026-06-10', maternal: { careType: 'prenatal', pregnancyId, lmpDate: '2026-06-01', eddDate: '2027-03-08', gestationalAgeWeeks: 2 },
    } })],
  });
  const result = await program(db);
  assert.equal(result.indicators.B1_2.total, 1);
  assert.equal(result.indicators.B1_2a.total, 1);
  assert.equal(result.records[0].prenatal_visits, 1);
  assert.equal(result.visits.length, 2);
});

test('required source errors fail reporting rather than becoming misleading empty figures', async () => {
  for (const table of ['visits', 'maternal_records', 'maternal_pregnancies', 'pregnancy_encounters', 'prenatal_services']) {
    for (const code of ['PGRST205', '42501']) {
      await assert.rejects(program(database({ maternal_pregnancies: [pregnancy()] }, { [table]: { code, message: `${table} unavailable` } })),
        (error) => error.statusCode === 500 && error.details.code === code);
    }
  }
});

test('consultation history is paginated past the default Supabase row cap without collapsing visits', async () => {
  const visits = Array.from({ length: 1005 }, (_, index) => consultation(`visit-${String(index).padStart(4, '0')}`, `2026-06-0${index % 4 + 1}`));
  const db = database({ visits, maternal_pregnancies: [pregnancy()] });
  const result = await program(db);
  assert.equal(result.visits.length, 1005);
  assert.equal(result.summary.total, 1);
  assert.equal(result.indicators.B1_1.total, 1);
  assert.ok(db.calls.some((call) => call.table === 'visits' && call.method === 'range' && call.start === 1000));
});

test('saved file-driver consultation DTOs feed M1 without copied maternal/TCL records', async () => {
  const originalPersist = store.persist;
  const originalData = store.data;
  store.persist = async () => {};
  store.chain = Promise.resolve();
  store.data = { counters: { residents: 1, submissions: 0 }, residents: [{ id: 'RES-1', firstName: 'Ana', lastName: 'Cruz', birthDate: '2000-06-15', sex: 'Female', barangayId: 'b1', municipalityId: 'm1' }], visits: [], referrals: [], followUps: [], healthAuditLogs: [] };
  try {
    for (const day of ['01', '02', '03', '04', '04']) await fileRepository.insertVisit({
      id: `saved-${day}-${store.data.visits.length}`, residentId: 'RES-1', status: 'completed', visitDate: `2026-06-${day}T00:00:00+08:00`,
      barangayId: 'b1', municipalityId: 'm1',
      healthServiceId: serviceId, healthServiceName: service.name,
      consultationDetails: { consultationDate: `2026-06-${day}`, healthServiceCategory: service.category, maternal: { careType: 'prenatal', pregnancyId: null, lmpDate: '2025-10-01', eddDate: '2026-07-08', gestationalAgeWeeks: null } },
    });
    const result = await program(null, { repo: fileRepository });
    assert.equal(result.indicators.B1_1.total, 1);
    assert.equal(result.summary.total, 1);
    assert.equal(result.visits.length, 5);
    assert.equal(result.visits[0].resident.birth_date, '2000-06-15');
    assert.match(result.warnings.join(' '), /File-driver activity uses saved consultation snapshots only/);
    assert.equal(store.data.visits.length, 5);
    assert.equal(store.data.maternal_records, undefined);
    assert.equal(store.data.tcl_entries, undefined);
    store.data.residents[0].barangayId = 'b2';
    store.data.residents[0].municipalityId = 'm2';
    const historical = await program(null, { repo: fileRepository });
    assert.equal(historical.indicators.B1_1.total, 1, 'a current address transfer cannot reattribute actual visits');
    assert.equal(historical.visits.length, 5);
  } finally {
    store.persist = originalPersist;
    store.data = originalData;
  }
});

test('file-driver historical visits without service geography remain unattributed, not assigned to current barangay', async () => {
  const rows = ['01', '02', '03', '04'].map((day) => ({
    id: `unverified-${day}`, residentId: 'RES-1', status: 'completed', visitDate: `2026-06-${day}T08:00:00+08:00`,
    resident: { id: 'RES-1', firstName: 'Ana', lastName: 'Cruz', birthDate: '2000-06-15', barangayId: 'b1', municipalityId: 'm1' },
    healthServiceId: serviceId, healthServiceName: service.name,
    consultationDetails: { healthServiceCategory: service.category, maternal: { careType: 'prenatal', pregnancyId: null, lmpDate: '2025-10-01', eddDate: '2026-07-08' } },
  }));
  const repo = { driver: 'file', async listVisits({ offset, limit }) { return { rows: rows.slice(offset, offset + limit), total: rows.length }; } };
  const result = await program(null, { repo });
  assert.equal(result.indicators.B1_1.total, 0);
  assert.equal(result.summary.total, 0);
  assert.equal(result.visits.length, 0);
  assert.equal(result.unattributedVisits.length, 4);
  assert.ok(result.unattributedVisits.every((visit) => visit.attributionStatus === 'service_scope_unverified'));
  assert.match(result.warnings.join(' '), /location is not inferred from a resident current address/);
});

test('PostgreSQL saved FK/category and timestamptz consultations report on their Manila clinical days', async () => {
  const pg = new PGlite();
  try {
    await pg.exec(`
      create table residents (id text primary key, first_name text, last_name text, birth_date date, sex text);
      create table health_services (id uuid primary key, name text, category text);
      create table visits (id text primary key, resident_id text references residents(id), barangay_id text, municipality_id text,
        health_service_id uuid references health_services(id), visit_date timestamptz,
        consultation_details jsonb, status text, created_at timestamptz default now());
    `);
    await pg.query('insert into residents values ($1, $2, $3, $4, $5)', ['RES-1', 'Ana', 'Cruz', '2000-06-15', 'Female']);
    await pg.query('insert into health_services values ($1, $2, $3)', [serviceId, service.name, service.category]);
    for (const day of ['01', '02', '03', '04']) {
      await pg.query('insert into visits (id, resident_id, barangay_id, municipality_id, health_service_id, visit_date, consultation_details, status) values ($1,$2,$3,$4,$5,$6,$7,$8)',
        [`pg-${day}`, 'RES-1', 'b1', 'm1', serviceId, `2026-06-${day}T00:05:00+08:00`, JSON.stringify({ maternal: { careType: 'prenatal', pregnancyId: null, lmpDate: '2025-10-01', eddDate: '2026-07-08' } }), 'completed']);
    }
    const db = database({}, {}, { visits: async () => (await pg.query('select v.*, row_to_json(r) as resident, row_to_json(s) as health_service from visits v join residents r on r.id=v.resident_id join health_services s on s.id=v.health_service_id')).rows });
    const result = await program(db);
    assert.equal(result.indicators.B1_1.total, 1);
    assert.deepEqual(result.visits.map((visit) => visit.visit_date), ['2026-06-01', '2026-06-02', '2026-06-03', '2026-06-04']);
    assert.equal((await pg.query('select count(*)::int as count from visits')).rows[0].count, 4);
    await assert.rejects(pg.query('insert into visits (id, health_service_id) values ($1,$2)', ['invalid', '99999999-9999-4999-8999-999999999999']), /foreign key/);
  } finally { await pg.close(); }
});
