/**
 * KALUSAGAP - Official-format CSV export for the program-specific TCL / health
 * forms. Columns follow each official worksheet's order and headings; stored
 * values keep the official codes (e.g. V/P, +/-, NHTS). Derived environmental
 * indicators are exported from the server-computed columns, not recomputed.
 *
 * The export always receives the FULL record set passed in (the caller must not
 * pre-slice by pagination) so no record is silently omitted.
 */

const ORAL_SERVICE_CODES = ['OE', 'IIOHC', 'AEBF', 'TFA', 'STB', 'OHE', 'E/C', 'ART', 'OPS', 'PFS', 'TF', 'PF', 'OUT', 'GT', 'RP', 'RUT', 'Ref', 'TPEC', 'Dr'];

const val = (row, key) => {
  const v = row?.[key];
  if (v !== undefined && v !== null) return v;
  const d = row?.data?.[key];
  return d === undefined || d === null ? '' : d;
};
const residentName = (row) => {
  const r = row.resident || {};
  return [r.first_name, r.middle_name, r.last_name].filter(Boolean).join(' ').trim();
};
const residentAddress = (row) => row.resident?.current_address || row.resident?.barangay || '';
const householdName = (row) => row.household?.head_name || '';
const bool = (v) => (v === true ? '√' : v === false ? 'X' : '');

/** Column definitions per kind: [header, accessor(row, index)]. */
const COLUMNS = {
  'ncd-risk': [
    ['No.', (_r, i) => i + 1],
    ['Date of Assessment', (r) => val(r, 'assessment_date')],
    ['Family Serial No.', (r) => val(r, 'family_serial_no')],
    ['Name (FN, MI, LN)', residentName],
    ['Complete Address', residentAddress],
    ['SES', (r) => val(r, 'se_status')],
    ['Age', (r) => val(r, 'age')],
    ['Sex', (r) => val(r, 'sex')],
    ['Current Smoker', (r) => val(r, 'current_smoker')],
    ['Binge Alcohol Drinker', (r) => val(r, 'binge_alcohol')],
    ['Overweight/Obese', (r) => val(r, 'weight_class')],
    ['Hypertension - Date of Screening', (r) => val(r, 'htn_screening_date')],
    ['Hypertension - Result', (r) => val(r, 'htn_result')],
    ['Diabetes - Date of Screening', (r) => val(r, 'dm_screening_date')],
    ['Diabetes - Result', (r) => val(r, 'dm_result')],
    ['Remarks', (r) => val(r, 'notes')],
  ],
  'ncd-cervical': [
    ['No.', (_r, i) => i + 1],
    ['Date of Assessment', (r) => val(r, 'assessment_date')],
    ['Family Serial No.', (r) => val(r, 'family_serial_no')],
    ['Name (FN, MI, LN)', residentName],
    ['Age', (r) => val(r, 'age')],
    ['Complete Address', residentAddress],
    ['SES', (r) => val(r, 'se_status')],
    ['Risk Assessment Status', (r) => (val(r, 'risk_status') === 'RISK' ? '√' : val(r, 'risk_status') === 'NO_RISK' ? 'X' : '')],
    ['Type of Cervical Cancer Screening', (r) => val(r, 'cervical_screening_type')],
    ['Result of Diagnosis/Screening', (r) => val(r, 'cervical_result')],
    ['Breast Mass Exam (suspicious mass)', (r) => val(r, 'breast_mass')],
    ['Remarks', (r) => val(r, 'notes')],
  ],
  'ncd-visual': [
    ['No.', (_r, i) => i + 1],
    ['Date of Assessment', (r) => val(r, 'assessment_date')],
    ['Family Serial No.', (r) => val(r, 'family_serial_no')],
    ['OSCA ID No.', (r) => val(r, 'osca_id_no')],
    ['Name (FN, MI, LN)', residentName],
    ['Complete Address', residentAddress],
    ['SES', (r) => val(r, 'se_status')],
    ['Sex', (r) => val(r, 'sex')],
    ['Age', (r) => val(r, 'age')],
    ['Eye Complaints', (r) => (val(r, 'eye_complaints') === 'WITH' ? '√' : val(r, 'eye_complaints') === 'NONE' ? 'X' : '')],
    ['Visual Acuity', (r) => val(r, 'va_result')],
    ['Visual Acuity Category', (r) => val(r, 'va_category')],
    ['With Eye Problem', (r) => (val(r, 'with_eye_problem') === 'WITH' ? '√' : val(r, 'with_eye_problem') === 'NONE' ? 'X' : '')],
    ['Pinhole Vision', (r) => val(r, 'pinhole')],
    ['Date referred to Optometrist', (r) => val(r, 'mgmt_optometrist_date')],
    ['Date referred to Ophthalmologist', (r) => val(r, 'mgmt_ophthalmologist_date')],
    ['Date referred (VA 20/200 or worse)', (r) => val(r, 'mgmt_worse_date')],
    ['PPV Immunization (Date given)', (r) => val(r, 'ppv_date_given')],
    ['Remarks', (r) => val(r, 'notes')],
  ],
  'oral-health': [
    ['No.', (_r, i) => i + 1],
    ['Date of Consultation', (r) => val(r, 'consultation_date')],
    ['Family Serial No.', (r) => val(r, 'family_serial_no')],
    ['Name of Client', residentName],
    ['Complete Address', residentAddress],
    ['Date of Birth', (r) => val(r, 'date_of_birth')],
    ['Age', (r) => val(r, 'age')],
    ['Age/Risk Group', (r) => val(r, 'age_group')],
    ['Pregnant age band', (r) => val(r, 'pregnant_age_band')],
    ['SE Status', (r) => val(r, 'se_status')],
    ['Orally Fit Upon Examination', (r) => val(r, 'orally_fit_exam_date')],
    ['Orally Fit After Rehab', (r) => val(r, 'orally_fit_rehab_date')],
    ['Decayed', (r) => bool(val(r, 'dmft_decayed') || false)],
    ['Missing', (r) => bool(val(r, 'dmft_missing') || false)],
    ['Filled', (r) => bool(val(r, 'dmft_filled') || false)],
    ...ORAL_SERVICE_CODES.map((code) => [code, (r) => {
      const s = r.data?.services || {};
      return code in s ? (s[code] || '√') : '';
    }]),
    ['BOHC (date given)', (r) => {
      const b = r.data?.bohc || {};
      const bucket = r.age_group === 'pregnant' ? 'pregnant' : r.age_group;
      return b[bucket] || '';
    }],
    ['Remarks', (r) => val(r, 'notes')],
  ],
  environmental: [
    ['No.', (_r, i) => i + 1],
    ['Name of HH Head', householdName],
    ['SE Status', (r) => val(r, 'se_status')],
    ['Type of Water Supply', (r) => val(r, 'water_supply_type')],
    ['Others, specify', (r) => val(r, 'water_supply_other')],
    ['Access to basic safe water', (r) => bool(val(r, 'has_basic_safe_water'))],
    ['Located within premises', (r) => bool(val(r, 'within_premises'))],
    ['Available 24/7', (r) => bool(val(r, 'available_247'))],
    ['Microbiological Validation - Date', (r) => val(r, 'water_micro_validation_date')],
    ['Microbiological Validation - Result', (r) => val(r, 'water_micro_result')],
    ['Physico-Chemical Test - Date', (r) => val(r, 'water_physico_date')],
    ['Physico-Chemical Test - Result', (r) => val(r, 'water_physico_result')],
    ['Safely-managed drinking water', (r) => bool(val(r, 'safely_managed_water'))],
    ['Type of Sanitary Facility', (r) => val(r, 'sanitary_facility_type')],
    ['Type of Unsanitary Facility', (r) => val(r, 'unsanitary_facility_type')],
    ['Sanitary Facility status', (r) => bool(val(r, 'has_sanitary_toilet'))],
    ['Open Defecation', (r) => bool(val(r, 'open_defecation'))],
    ['Toilet Not shared (14.1)', (r) => bool(val(r, 'toilet_not_shared'))],
    ['Disposal/Treatment of Excreta (14.2)', (r) => val(r, 'excreta_disposal')],
    ['Safely managed sanitation', (r) => bool(val(r, 'safely_managed_sanitation'))],
    ['Waste Segregation (16a)', (r) => bool(val(r, 'waste_segregation'))],
    ['Backyard Composting (16b)', (r) => bool(val(r, 'waste_backyard_composting'))],
    ['Recycling/Reuse (16c)', (r) => bool(val(r, 'waste_recycling'))],
    ['Collected by City/Municipal (16d)', (r) => bool(val(r, 'waste_collected'))],
    ['Others - Burning/Burying (16e)', (r) => bool(val(r, 'waste_others'))],
    ['Solid Waste Mgmt practice (17)', (r) => bool(val(r, 'waste_practice_ok'))],
    ['With access to basic safe water (18)', (r) => bool(val(r, 'has_basic_safe_water'))],
    ['With sanitation facility (19)', (r) => bool(val(r, 'has_sanitary_toilet'))],
    ['Complete Sanitation (20)', (r) => bool(val(r, 'complete_sanitation'))],
    ['Remarks', (r) => val(r, 'remarks')],
  ],
};

const escapeCsv = (value) => {
  const s = value === null || value === undefined ? '' : String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** Build a CSV string for a kind from the full record set. */
export const buildProgramCsv = (kind, rows) => {
  const cols = COLUMNS[kind];
  if (!cols) throw new Error(`No export columns defined for ${kind}`);
  const header = cols.map(([h]) => escapeCsv(h)).join(',');
  const body = (rows || []).map((row, i) => cols.map(([, get]) => escapeCsv(get(row, i))).join(','));
  return [header, ...body].join('\r\n');
};

/** Build the Oral Health ST (statistical table) CSV from the statistics payload. */
export const buildOralStatisticsCsv = (stats) => {
  const header = ['Indicator', 'NHTS', 'Non-NHTS', 'Total', 'Male', 'Female', 'Target basis', 'Target'];
  const line = (label, c, basis = '', target = '') => [label, c.nhts, c.non_nhts, c.total, c.m ?? '', c.f ?? '', basis, target];
  const rows = [header];
  rows.push(line(stats.indicator_1_orally_fit_12_59.label, stats.indicator_1_orally_fit_12_59.counts, 'Total Pop X 8.658% X 20%'));
  rows.push(line(stats.indicator_2_dmft_new.label, stats.indicator_2_dmft_new.counts, 'Total no. 5 y/o and above examined'));
  for (const def of Object.values(stats.bohc)) rows.push(line(def.label, def.counts, def.target_basis, def.target ?? ''));
  return rows.map((r) => r.map(escapeCsv).join(',')).join('\r\n');
};

/** Trigger a browser download of a CSV string. */
export const downloadCsv = (filename, csv) => {
  const blob = new Blob([`\ufeff${csv}`], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
};

export default { buildProgramCsv, buildOralStatisticsCsv, downloadCsv };
