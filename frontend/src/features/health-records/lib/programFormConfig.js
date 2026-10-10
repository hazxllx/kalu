/**
 * KALUSAGAP - Frontend schema for the program-specific official TCL / health
 * forms. This MIRRORS backend/src/config/programFormSchemas.js (same field keys
 * and enum codes) and adds presentation metadata: human labels, option labels,
 * grouping, conditional visibility, and list-table columns.
 *
 * Field descriptor:
 *   { key, label, type, options?, required?, help?, placeholder?,
 *     visibleIf?: (form) => boolean, group? }
 *   type: 'text' | 'textarea' | 'date' | 'int' | 'select' | 'checkbox'
 *       | 'service-checklist' (oral services map) | 'bohc' (oral BOHC date)
 *
 * The backend validates independently; these are the official codes/labels so
 * the UI and exports stay faithful to the DOH worksheet.
 */

const YES_NO = [{ value: 'Y', label: 'Yes' }, { value: 'N', label: 'No' }];
const SES = [{ value: 'NHTS', label: '1 - NHTS' }, { value: 'Non-NHTS', label: '2 - Non-NHTS' }];
const SEX = [{ value: 'M', label: 'Male' }, { value: 'F', label: 'Female' }];
const PLUS_MINUS = [{ value: '+', label: '+ Positive' }, { value: '-', label: '- Negative' }];

export const ORAL_SERVICES = [
  ['OE', 'Oral Examination'],
  ['IIOHC', "Instruction on Infant's Oral Health Care"],
  ['AEBF', 'Advised on Exclusive Breastfeeding'],
  ['TFA', 'Topical Fluoride Application'],
  ['STB', 'Supervised Tooth Brushing'],
  ['OHE', 'Oral Health Education'],
  ['E/C', 'Education and Counselling'],
  ['ART', 'Atraumatic Restorative Treatment'],
  ['OPS', 'Oral Prophylaxis/Scaling'],
  ['PFS', 'Pit and Fissure Sealant'],
  ['TF', 'Temporary Filling'],
  ['PF', 'Permanent Filling'],
  ['OUT', 'Oral Urgent Treatment'],
  ['GT', 'Gum Treatment'],
  ['RP', 'Relief of Pain'],
  ['RUT', 'Removal of Unsavable Teeth'],
  ['Ref', 'Referral of complicated cases'],
  ['TPEC', 'Treatment of Post-Extraction Complications'],
  ['Dr', 'Drainage of localized oral abscess'],
];

const ORAL_AGE_GROUPS = [
  { value: '0-11mos', label: '0-11 months' },
  { value: '1-4', label: '1-4 y/o' },
  { value: '5-9', label: '5-9 y/o' },
  { value: '10-19', label: '10-19 y/o' },
  { value: '20-59', label: '20-59 y/o' },
  { value: '>=60', label: '> 60 y/o' },
  { value: 'pregnant', label: 'Pregnant' },
];

const DMFT_GROUPS = ['5-9', '10-19', '20-59', '>=60', 'pregnant'];

// ---------------------------------------------------------------------------
// NCD Part 1 - Risk-Assessed Adults 20 y/o and above
// ---------------------------------------------------------------------------
const ncdRisk = {
  kind: 'ncd-risk',
  scope: 'resident',
  label: 'Part 1 · Risk-Assessed Adults',
  title: 'Target Client List for Risk-Assessed Adults (20 y/o and above)',
  groups: [
    {
      title: 'Client & Assessment',
      fields: ['assessment_date', 'family_serial_no', 'se_status', 'sex', 'age'],
    },
    {
      title: 'Risk Assessment Result',
      fields: ['current_smoker', 'binge_alcohol', 'weight_class'],
    },
    {
      title: 'Risk Screening Result',
      fields: ['htn_screening_date', 'htn_result', 'dm_screening_date', 'dm_result'],
    },
    { title: 'Remarks', fields: ['notes'] },
  ],
  fields: {
    assessment_date: { label: 'Date of Assessment', type: 'date', required: true },
    family_serial_no: { label: 'Family Serial Number', type: 'text' },
    se_status: { label: 'Socio-Economic Status', type: 'select', options: SES },
    sex: { label: 'Sex', type: 'select', options: SEX },
    age: { label: 'Age', type: 'int', help: 'Target population is 20 years old and above.' },
    current_smoker: { label: 'Current Smoker', type: 'select', options: YES_NO },
    binge_alcohol: { label: 'Binge Alcohol Drinker', type: 'select', options: YES_NO },
    weight_class: {
      label: 'Overweight / Obese',
      type: 'select',
      options: [
        { value: '1', label: '1 - Overweight (23.0-24.9 kg/m²)' },
        { value: '2', label: '2 - Obese (≥ 25 kg/m²)' },
      ],
      help: 'Leave blank if neither overweight nor obese.',
    },
    htn_screening_date: { label: 'Hypertension - Date of Screening', type: 'date' },
    htn_result: { label: 'Hypertension - Ave. 2 BP readings', type: 'select', options: [{ value: '+', label: '+ (≥ 140/90 mmHg)' }, { value: '-', label: '- (< 140/90 mmHg)' }] },
    dm_screening_date: { label: 'Diabetes Mellitus - Date of Screening', type: 'date' },
    dm_result: { label: 'Diabetes Mellitus - Result', type: 'select', options: [{ value: '+', label: '+ (FBG ≥126 / RBS ≥200 mg/dL)' }, { value: '-', label: '- (FBG <126 / RBS <200 mg/dL)' }] },
    notes: { label: 'Remarks', type: 'textarea' },
  },
  columns: [
    { key: 'resident', label: 'Client' },
    { key: 'assessment_date', label: 'Date', kind: 'date' },
    { key: 'age', label: 'Age' },
    { key: 'sex', label: 'Sex' },
    { key: 'htn_result', label: 'HTN', path: 'data.htn_result' },
    { key: 'dm_result', label: 'DM', path: 'data.dm_result' },
  ],
};

// ---------------------------------------------------------------------------
// NCD Part 2 - Cervical Cancer Screening & Breast Mass Examination
// ---------------------------------------------------------------------------
const ncdCervical = {
  kind: 'ncd-cervical',
  scope: 'resident',
  label: 'Part 2 · Cervical CA & Breast',
  title: 'Target Client List for Cervical Cancer Screening and Breast Mass Examination',
  groups: [
    { title: 'Client & Assessment', fields: ['assessment_date', 'family_serial_no', 'age', 'se_status'] },
    { title: 'Cervical Cancer Screening', fields: ['risk_status', 'cervical_screening_type', 'cervical_result'] },
    { title: 'Breast Mass Examination', fields: ['breast_mass'] },
    { title: 'Remarks', fields: ['notes'] },
  ],
  fields: {
    assessment_date: { label: 'Date of Assessment', type: 'date', required: true },
    family_serial_no: { label: 'Family Serial Number', type: 'text' },
    age: { label: 'Age', type: 'int' },
    se_status: { label: 'Socio-Economic Status', type: 'select', options: SES },
    risk_status: {
      label: 'Risk Assessment Status',
      type: 'select',
      options: [{ value: 'RISK', label: '√ - Presence of at least one Risk Factor' }, { value: 'NO_RISK', label: 'X - No risk factor' }],
    },
    cervical_screening_type: {
      label: 'Type of Cervical Cancer Screening Done',
      type: 'select',
      options: [{ value: 'V', label: 'V - VIA' }, { value: 'P', label: 'P - Pap Smear' }],
    },
    cervical_result: {
      label: 'Result of Diagnosis / Screening',
      type: 'select',
      options: [{ value: 'N', label: 'N - Negative' }, { value: 'P', label: 'P - Positive' }, { value: 'SC', label: 'SC - Suspicious CA' }],
    },
    breast_mass: {
      label: 'With suspicious breast mass',
      type: 'select',
      options: YES_NO,
    },
    notes: { label: 'Remarks', type: 'textarea' },
  },
  columns: [
    { key: 'resident', label: 'Client' },
    { key: 'assessment_date', label: 'Date', kind: 'date' },
    { key: 'age', label: 'Age' },
    { key: 'cervical_screening_type', label: 'Screening', path: 'data.cervical_screening_type' },
    { key: 'cervical_result', label: 'Result', path: 'data.cervical_result' },
    { key: 'breast_mass', label: 'Breast mass', path: 'data.breast_mass' },
  ],
};

// ---------------------------------------------------------------------------
// NCD Part 3 - Visual Acuity Screening & PPV Immunization (Senior Citizens)
// ---------------------------------------------------------------------------
const ncdVisual = {
  kind: 'ncd-visual',
  scope: 'resident',
  label: 'Part 3 · Visual Acuity & PPV',
  title: 'Target Client List for Visual Acuity Screening and PPV Immunization (Senior Citizens)',
  groups: [
    { title: 'Client & Assessment', fields: ['assessment_date', 'family_serial_no', 'osca_id_no', 'se_status', 'sex', 'age'] },
    { title: 'Visual Acuity Screening', fields: ['eye_complaints', 'va_result', 'va_category', 'with_eye_problem', 'pinhole'] },
    { title: 'Management', fields: ['mgmt_optometrist_date', 'mgmt_ophthalmologist_date', 'mgmt_worse_date'] },
    { title: 'PPV Immunization', fields: ['ppv_date_given'] },
    { title: 'Remarks', fields: ['notes'] },
  ],
  fields: {
    assessment_date: { label: 'Date of Assessment', type: 'date', required: true },
    family_serial_no: { label: 'Family Serial Number', type: 'text' },
    osca_id_no: { label: 'OSCA ID No.', type: 'text' },
    se_status: { label: 'Socio-Economic Status', type: 'select', options: SES },
    sex: { label: 'Sex', type: 'select', options: SEX },
    age: { label: 'Age (in years)', type: 'int' },
    eye_complaints: {
      label: 'Eye Complaints',
      type: 'select',
      options: [{ value: 'WITH', label: '√ - with at least one' }, { value: 'NONE', label: 'X - none of the above' }],
      help: 'Blurred, floaters, tearing, blind spots, redness, photopsia, glare.',
    },
    va_result: { label: 'Visual Acuity (write result as a fraction)', type: 'text', placeholder: 'e.g. 20/40' },
    va_category: {
      label: 'Visual Acuity category',
      type: 'select',
      options: [{ value: '20/40', label: '20/40' }, { value: '>20/40', label: '> 20/40' }],
    },
    with_eye_problem: {
      label: 'With Eye Problem',
      type: 'select',
      options: [{ value: 'WITH', label: '√ - complaint & VA > 20/40' }, { value: 'NONE', label: 'X - no complaint & VA 20/40' }],
    },
    pinhole: {
      label: 'Pinhole Vision (for VA > 20/40)',
      type: 'select',
      options: [{ value: 'IMPROVED', label: 'Improved' }, { value: 'NO_IMPROVEMENT', label: 'No improvement' }],
      visibleIf: (f) => f.with_eye_problem === 'WITH',
    },
    mgmt_optometrist_date: { label: 'Date referred to Optometrist', type: 'date', help: 'If VA is 20/40 to 20/100 but improved with pinhole.' },
    mgmt_ophthalmologist_date: { label: 'Date referred to Ophthalmologist', type: 'date', help: 'If VA is 20/40 to 20/100 but did not improve with pinhole.' },
    mgmt_worse_date: { label: 'Date referred (VA 20/200 or worse)', type: 'date' },
    ppv_date_given: { label: 'PPV Immunization (Date given)', type: 'date' },
    notes: { label: 'Remarks', type: 'textarea' },
  },
  columns: [
    { key: 'resident', label: 'Client' },
    { key: 'assessment_date', label: 'Date', kind: 'date' },
    { key: 'osca_id_no', label: 'OSCA ID' },
    { key: 'va_result', label: 'VA', path: 'data.va_result' },
    { key: 'ppv_date_given', label: 'PPV given', path: 'data.ppv_date_given', kind: 'date' },
  ],
};

// ---------------------------------------------------------------------------
// Oral Health - Target Client List for Oral Health Care and Services
// ---------------------------------------------------------------------------
const oralHealth = {
  kind: 'oral-health',
  scope: 'resident',
  label: 'Oral Health TCL',
  title: 'Target Client List for Oral Health Care and Services',
  groups: [
    { title: 'Client & Consultation', fields: ['consultation_date', 'family_serial_no', 'date_of_birth', 'age', 'age_group', 'pregnant_age_band', 'se_status'] },
    { title: 'Oral Health Status (Children 12-59 mos.)', fields: ['orally_fit_exam_date', 'orally_fit_rehab_date'] },
    { title: 'DMFT (Clients ≥ 5 y/o)', fields: ['dmft_decayed', 'dmft_missing', 'dmft_filled'] },
    { title: 'Oral Health Services Provided (write date given)', fields: ['services'] },
    { title: 'Basic Oral Health Care (BOHC)', fields: ['bohc'] },
    { title: 'Remarks', fields: ['notes'] },
  ],
  fields: {
    consultation_date: { label: 'Date of Consultation', type: 'date', required: true },
    family_serial_no: { label: 'Family Serial No.', type: 'text' },
    date_of_birth: { label: 'Date of Birth', type: 'date' },
    age: { label: 'Age', type: 'int' },
    age_group: { label: 'Age / Risk Group', type: 'select', options: ORAL_AGE_GROUPS, required: true },
    pregnant_age_band: {
      label: 'Pregnant age band',
      type: 'select',
      options: [{ value: '10-14', label: '10-14 y/o' }, { value: '15-19', label: '15-19 y/o' }, { value: '20-49', label: '20-49 y/o' }],
      visibleIf: (f) => f.age_group === 'pregnant',
    },
    se_status: { label: 'SE Status', type: 'select', options: SES },
    orally_fit_exam_date: { label: 'Orally Fit Upon Examination (date)', type: 'date', visibleIf: (f) => f.age_group === '1-4' },
    orally_fit_rehab_date: { label: 'Orally Fit After Rehab (date)', type: 'date', visibleIf: (f) => f.age_group === '1-4' },
    dmft_decayed: { label: 'Decayed Tooth', type: 'checkbox', visibleIf: (f) => DMFT_GROUPS.includes(f.age_group) },
    dmft_missing: { label: 'Missing Tooth', type: 'checkbox', visibleIf: (f) => DMFT_GROUPS.includes(f.age_group) },
    dmft_filled: { label: 'Filled Tooth', type: 'checkbox', visibleIf: (f) => DMFT_GROUPS.includes(f.age_group) },
    services: { label: 'Services', type: 'service-checklist' },
    bohc: { label: 'BOHC date given', type: 'bohc' },
    notes: { label: 'Remarks', type: 'textarea' },
  },
  columns: [
    { key: 'resident', label: 'Client' },
    { key: 'consultation_date', label: 'Date', kind: 'date' },
    { key: 'age_group', label: 'Age/Risk group', render: (v) => (ORAL_AGE_GROUPS.find((g) => g.value === v)?.label || v) },
    { key: 'se_status', label: 'SES' },
  ],
};

// ---------------------------------------------------------------------------
// Environmental Health Masterlist (household-level)
// ---------------------------------------------------------------------------
const environmental = {
  kind: 'environmental',
  scope: 'household',
  label: 'Environmental Masterlist',
  title: 'Environmental Health Masterlist (Household Sanitation Monitoring)',
  groups: [
    { title: 'Household & Assessment', fields: ['assessment_date', 'se_status'] },
    { title: 'Part 1 · Water Supply', fields: ['water_supply_type', 'water_supply_other', 'within_premises', 'available_247', 'water_micro_validation_date', 'water_micro_result', 'water_physico_date', 'water_physico_result'] },
    { title: 'Part 2 · Sanitation Facility', fields: ['sanitary_facility_type', 'unsanitary_facility_type', 'open_defecation', 'toilet_not_shared', 'excreta_disposal'] },
    { title: 'Part 3 · Solid Waste Management', fields: ['waste_segregation', 'waste_backyard_composting', 'waste_recycling', 'waste_collected', 'waste_others'] },
    { title: 'Remarks', fields: ['remarks'] },
  ],
  fields: {
    assessment_date: { label: 'Date accomplished', type: 'date', required: true },
    se_status: { label: 'SE Status', type: 'select', options: SES },
    water_supply_type: {
      label: 'Type of Water Supply',
      type: 'select',
      options: [
        { value: 'level1', label: 'Level I (point source)' },
        { value: 'level2', label: 'Level II (communal faucet)' },
        { value: 'level3', label: 'Level III (individual connection)' },
        { value: 'others', label: 'Others (doubtful source, e.g. open dug well)' },
      ],
    },
    water_supply_other: { label: 'Others, specify', type: 'text', visibleIf: (f) => f.water_supply_type === 'others' },
    within_premises: { label: 'Located within premises', type: 'checkbox' },
    available_247: { label: 'Available 24/7', type: 'checkbox' },
    water_micro_validation_date: { label: 'Microbiological Validation - Date done', type: 'date' },
    water_micro_result: { label: 'Microbiological Validation - Result', type: 'select', options: [{ value: 'ABSENT', label: '√ - absence of E. coli' }, { value: 'PRESENT', label: 'X - presence of E. coli' }] },
    water_physico_date: { label: 'Physico-Chemical Test - Date done', type: 'date' },
    water_physico_result: { label: 'Physico-Chemical Test - Result', type: 'select', options: [{ value: 'WITHIN', label: '√ - within allowable PNSDW limit' }, { value: 'ABOVE', label: 'X - above the allowable PNSDW limit' }] },
    sanitary_facility_type: {
      label: 'Type of Sanitary Facility',
      type: 'select',
      options: [
        { value: 'a', label: '(a) Pour/flush type with septic tank' },
        { value: 'b', label: '(b) Pour flush connected to septic tank AND sewerage' },
        { value: 'c', label: '(c) Ventilated Pit (VIP) Latrine' },
      ],
      help: 'Leave blank if the facility is unsanitary.',
    },
    unsanitary_facility_type: {
      label: 'Type of Unsanitary Facility',
      type: 'select',
      options: [
        { value: 'ws_no_tank', label: 'Water-sealed toilet w/o septic tank' },
        { value: 'overhung', label: 'Over hung latrine' },
        { value: 'open_pit', label: 'Open Pit Latrine' },
        { value: 'none', label: 'Without toilet' },
      ],
      help: 'Leave blank if the facility is sanitary.',
    },
    open_defecation: { label: 'Open Defecation', type: 'checkbox' },
    toilet_not_shared: { label: 'Toilet Not shared (14.1)', type: 'checkbox' },
    excreta_disposal: {
      label: 'Disposal / Treatment of Excreta (14.2)',
      type: 'select',
      options: [
        { value: 'a', label: '(a) Safely disposed in situ' },
        { value: 'b', label: '(b) Collected, transported, treated & disposed off-site' },
      ],
    },
    waste_segregation: { label: 'Waste Segregation (16a)', type: 'checkbox' },
    waste_backyard_composting: { label: 'Backyard Composting (16b)', type: 'checkbox' },
    waste_recycling: { label: 'Recycling / Reuse (16c)', type: 'checkbox' },
    waste_collected: { label: 'Collected by City/Municipal system (16d)', type: 'checkbox' },
    waste_others: { label: 'Others - Burning / Burying (16e)', type: 'checkbox' },
    remarks: { label: 'Remarks', type: 'textarea' },
  },
  columns: [
    { key: 'household', label: 'Household' },
    { key: 'assessment_date', label: 'Date', kind: 'date' },
    { key: 'has_basic_safe_water', label: 'Safe water', kind: 'bool' },
    { key: 'has_sanitary_toilet', label: 'Sanitary toilet', kind: 'bool' },
    { key: 'complete_sanitation', label: 'Complete sanitation', kind: 'bool' },
  ],
};

export const PROGRAM_FORMS = Object.freeze({
  'ncd-risk': ncdRisk,
  'ncd-cervical': ncdCervical,
  'ncd-visual': ncdVisual,
  'oral-health': oralHealth,
  environmental,
});

/** Build a flat API record from form state (resident/household + visible fields). */
export const toRecord = (config, form, entityId) => {
  const record = {};
  if (config.scope === 'household') record.householdId = entityId;
  else record.residentId = entityId;
  for (const group of config.groups) {
    for (const key of group.fields) {
      const field = config.fields[key];
      if (!field) continue;
      if (field.visibleIf && !field.visibleIf(form)) continue; // never submit stale hidden values
      const value = form[key];
      if (value === undefined || value === null || value === '') continue;
      record[key] = value;
    }
  }
  return record;
};

/** Hydrate flat form state from a stored DB row (columns + jsonb data). */
export const fromRow = (config, row) => {
  const form = {};
  const data = row?.data || {};
  for (const group of config.groups) {
    for (const key of group.fields) {
      const field = config.fields[key];
      if (!field) continue;
      let value = row?.[key];
      if (value === undefined || value === null) value = data[key];
      if (value === undefined || value === null) {
        value = field.type === 'checkbox' ? false : (field.type === 'service-checklist' || field.type === 'bohc' ? {} : '');
      }
      form[key] = value;
    }
  }
  return form;
};

export default { PROGRAM_FORMS, ORAL_SERVICES, toRecord, fromRow };
