/**
 * KALUSAGAP - Program-specific TCL / health-form field schemas.
 *
 * One schema per official worksheet. These are the AUTHORITATIVE field
 * definitions used by programForms.service.js to:
 *   - whitelist which keys a client may send (anything else is dropped),
 *   - validate data types and enumerated values server-side,
 *   - decide which fields are stored as first-class table columns vs. inside
 *     the `data` jsonb payload.
 *
 * Field descriptor shape:
 *   { key, label, where: 'column'|'data', type, enum?, required?, note? }
 *   type: 'date' (YYYY-MM-DD) | 'string' | 'int' | 'bool' | 'enum' | 'json'
 *
 * Enum values use the official workbook codes. The frontend renders the
 * human-readable labels; the stored value is the canonical code so exports and
 * reports stay faithful to the DOH form.
 */

const NHTS = ['NHTS', 'Non-NHTS'];
const YN = ['Y', 'N'];
const SEX = ['M', 'F'];
const PLUS_MINUS = ['+', '-'];

// NCD Part 1 - Risk-Assessed Adults 20 y/o and above
const ncdRisk = {
  kind: 'ncd-risk',
  table: 'ncd_risk_assessments',
  scope: 'resident',
  title: 'NCD Part 1 - Target Client List for Risk-Assessed Adults (20 y/o and above)',
  fields: [
    { key: 'assessment_date', label: 'Date of Assessment', where: 'column', type: 'date' },
    { key: 'family_serial_no', label: 'Family Serial Number', where: 'column', type: 'string' },
    { key: 'se_status', label: 'SES', where: 'column', type: 'enum', enum: NHTS },
    { key: 'sex', label: 'Sex', where: 'column', type: 'enum', enum: SEX },
    { key: 'age', label: 'Age', where: 'column', type: 'int' },
    { key: 'current_smoker', label: 'Current Smoker', where: 'data', type: 'enum', enum: YN },
    { key: 'binge_alcohol', label: 'Binge Alcohol Drinker', where: 'data', type: 'enum', enum: YN },
    // 1 = overweight 23.0-24.9 kg/m2 ; 2 = obese >= 25 kg/m2
    { key: 'weight_class', label: 'Overweight/Obese', where: 'data', type: 'enum', enum: ['1', '2'] },
    { key: 'htn_screening_date', label: 'Hypertension - Date of Screening', where: 'data', type: 'date' },
    { key: 'htn_result', label: 'Hypertension - Ave. 2 BP readings (+ >=140/90 / - <140/90)', where: 'data', type: 'enum', enum: PLUS_MINUS },
    { key: 'dm_screening_date', label: 'Diabetes Mellitus - Date of Screening', where: 'data', type: 'date' },
    { key: 'dm_result', label: 'Diabetes Mellitus - Result (+ FBG>=126/RBS>=200 / -)', where: 'data', type: 'enum', enum: PLUS_MINUS },
    { key: 'notes', label: 'Remarks', where: 'column', type: 'string' },
  ],
};

// NCD Part 2 - Cervical Cancer Screening & Breast Mass Examination
const ncdCervical = {
  kind: 'ncd-cervical',
  table: 'ncd_cervical_breast',
  scope: 'resident',
  title: 'NCD Part 2 - Target Client List for Cervical Cancer Screening and Breast Mass Examination',
  fields: [
    { key: 'assessment_date', label: 'Date of Assessment', where: 'column', type: 'date' },
    { key: 'family_serial_no', label: 'Family Serial Number', where: 'column', type: 'string' },
    { key: 'age', label: 'Age', where: 'column', type: 'int' },
    { key: 'se_status', label: 'SES', where: 'column', type: 'enum', enum: NHTS },
    // √ Presence of at least one Risk Factor / X No risk factor
    { key: 'risk_status', label: 'Risk Assessment Status', where: 'data', type: 'enum', enum: ['RISK', 'NO_RISK'] },
    // V - VIA ; P - Pap Smear
    { key: 'cervical_screening_type', label: 'Type of Cervical Cancer Screening Done', where: 'data', type: 'enum', enum: ['V', 'P'] },
    // N - Negative ; P - Positive ; SC - Suspicious CA
    { key: 'cervical_result', label: 'Result of Diagnosis/Screening', where: 'data', type: 'enum', enum: ['N', 'P', 'SC'] },
    // Y - with suspicious breast mass ; N - none
    { key: 'breast_mass', label: 'Breast Mass Examination (suspicious mass)', where: 'data', type: 'enum', enum: YN },
    { key: 'notes', label: 'Remarks', where: 'column', type: 'string' },
  ],
};

// NCD Part 3 - Visual Acuity Screening & PPV Immunization (Senior Citizens)
const ncdVisual = {
  kind: 'ncd-visual',
  table: 'ncd_visual_ppv',
  scope: 'resident',
  title: 'NCD Part 3 - Target Client List for Visual Acuity Screening and PPV Immunization for Senior Citizens',
  fields: [
    { key: 'assessment_date', label: 'Date of Assessment', where: 'column', type: 'date' },
    { key: 'family_serial_no', label: 'Family Serial Number', where: 'column', type: 'string' },
    { key: 'osca_id_no', label: 'OSCA ID No.', where: 'column', type: 'string' },
    { key: 'se_status', label: 'SES', where: 'column', type: 'enum', enum: NHTS },
    { key: 'sex', label: 'Sex', where: 'column', type: 'enum', enum: SEX },
    { key: 'age', label: 'Age (in years)', where: 'column', type: 'int' },
    // √ with at least one eye complaint / X none
    { key: 'eye_complaints', label: 'Eye Complaints', where: 'data', type: 'enum', enum: ['WITH', 'NONE'] },
    { key: 'va_result', label: 'Visual Acuity (fraction)', where: 'data', type: 'string' },
    // 20/40 vs > 20/40 bucket
    { key: 'va_category', label: 'Visual Acuity category', where: 'data', type: 'enum', enum: ['20/40', '>20/40'] },
    { key: 'with_eye_problem', label: 'With Eye Problem', where: 'data', type: 'enum', enum: ['WITH', 'NONE'] },
    // Pinhole vision (for VA > 20/40)
    { key: 'pinhole', label: 'Pinhole Vision', where: 'data', type: 'enum', enum: ['IMPROVED', 'NO_IMPROVEMENT'] },
    { key: 'mgmt_optometrist_date', label: 'Date referred to Optometrist (VA 20/40-20/100 improved w/ pinhole)', where: 'data', type: 'date' },
    { key: 'mgmt_ophthalmologist_date', label: 'Date referred to Ophthalmologist (VA 20/40-20/100 not improved)', where: 'data', type: 'date' },
    { key: 'mgmt_worse_date', label: 'Date referred (VA 20/200 or worse)', where: 'data', type: 'date' },
    { key: 'ppv_date_given', label: 'PPV Immunization (Date given)', where: 'data', type: 'date' },
    { key: 'notes', label: 'Remarks', where: 'column', type: 'string' },
  ],
};

// Oral Health - Target Client List for Oral Health Care and Services
export const ORAL_SERVICE_CODES = Object.freeze({
  OE: 'Oral Examination',
  IIOHC: "Instruction on Infant's Oral Health Care",
  AEBF: 'Advised on Exclusive Breastfeeding',
  TFA: 'Topical Fluoride Application',
  STB: 'Supervised Tooth Brushing',
  OHE: 'Oral Health Education',
  'E/C': 'Education and Counselling',
  ART: 'Atraumatic Restorative Treatment',
  OPS: 'Oral Prophylaxis/Scaling',
  PFS: 'Pit and Fissure Sealant',
  TF: 'Temporary Filling',
  PF: 'Permanent Filling',
  OUT: 'Oral Urgent Treatment',
  GT: 'Gum Treatment',
  RP: 'Relief of Pain',
  RUT: 'Removal of Unsavable Teeth',
  Ref: 'Referral of complicated cases',
  TPEC: 'Treatment of Post-Extraction Complications',
  Dr: 'Drainage of localized oral abscess',
});

const oralHealth = {
  kind: 'oral-health',
  table: 'oral_health_records',
  scope: 'resident',
  title: 'Target Client List for Oral Health Care and Services',
  fields: [
    { key: 'consultation_date', label: 'Date of Consultation', where: 'column', type: 'date' },
    { key: 'family_serial_no', label: 'Family Serial No.', where: 'column', type: 'string' },
    { key: 'date_of_birth', label: 'Date of Birth', where: 'column', type: 'date' },
    { key: 'age', label: 'Age', where: 'column', type: 'int' },
    { key: 'age_group', label: 'Age/Risk Group', where: 'column', type: 'enum', enum: ['0-11mos', '1-4', '5-9', '10-19', '20-59', '>=60', 'pregnant'] },
    { key: 'pregnant_age_band', label: 'Pregnant age band', where: 'column', type: 'enum', enum: ['10-14', '15-19', '20-49'] },
    { key: 'se_status', label: 'SE Status', where: 'column', type: 'enum', enum: NHTS },
    // Oral Health Status for Children 12-59 mos (dates)
    { key: 'orally_fit_exam_date', label: 'Orally Fit Upon Examination (date)', where: 'data', type: 'date' },
    { key: 'orally_fit_rehab_date', label: 'Orally Fit After Rehab (date)', where: 'data', type: 'date' },
    // DMFT (clients >= 5 y/o) - place a check
    { key: 'dmft_decayed', label: 'Decayed Tooth', where: 'data', type: 'bool' },
    { key: 'dmft_missing', label: 'Missing Tooth', where: 'data', type: 'bool' },
    { key: 'dmft_filled', label: 'Filled Tooth', where: 'data', type: 'bool' },
    // Services provided: map of code -> date string
    { key: 'services', label: 'Oral Health Services Provided (date given)', where: 'data', type: 'json' },
    // BOHC provided per age bucket: map of bucket -> date
    { key: 'bohc', label: 'Provided with Basic Oral Health Care (date)', where: 'data', type: 'json' },
    { key: 'notes', label: 'Remarks', where: 'column', type: 'string' },
  ],
};

// Environmental Health Masterlist (household-level)
const environmental = {
  kind: 'environmental',
  table: 'environmental_masterlist',
  scope: 'household',
  title: 'Environmental Health Masterlist (Household Sanitation Monitoring)',
  fields: [
    { key: 'assessment_date', label: 'Date accomplished', where: 'column', type: 'date' },
    { key: 'se_status', label: 'SE Status', where: 'column', type: 'enum', enum: NHTS },
    // Part 1 - Water supply
    { key: 'water_supply_type', label: 'Type of Water Supply', where: 'column', type: 'enum', enum: ['level1', 'level2', 'level3', 'others'] },
    { key: 'water_supply_other', label: 'Water supply - others, specify', where: 'column', type: 'string' },
    { key: 'within_premises', label: 'Located within premises', where: 'column', type: 'bool' },
    { key: 'available_247', label: 'Available 24/7', where: 'column', type: 'bool' },
    { key: 'water_micro_validation_date', label: 'Microbiological Validation - Date', where: 'data', type: 'date' },
    { key: 'water_micro_result', label: 'Microbiological Validation - Result', where: 'data', type: 'enum', enum: ['ABSENT', 'PRESENT'] },
    { key: 'water_physico_date', label: 'Physico-Chemical Test - Date', where: 'data', type: 'date' },
    { key: 'water_physico_result', label: 'Physico-Chemical Test - Result', where: 'data', type: 'enum', enum: ['WITHIN', 'ABOVE'] },
    // Part 2 - Sanitation facility
    { key: 'sanitary_facility_type', label: 'Type of Sanitary Facility', where: 'column', type: 'enum', enum: ['a', 'b', 'c'] },
    { key: 'unsanitary_facility_type', label: 'Type of Unsanitary Facility', where: 'column', type: 'enum', enum: ['ws_no_tank', 'overhung', 'open_pit', 'none'] },
    { key: 'open_defecation', label: 'Open Defecation', where: 'column', type: 'bool' },
    { key: 'toilet_not_shared', label: 'Toilet Not shared (14.1)', where: 'data', type: 'bool' },
    { key: 'excreta_disposal', label: 'Disposal/Treatment of Excreta (14.2 a/b)', where: 'data', type: 'enum', enum: ['a', 'b'] },
    // Part 3 - Solid Waste Management (16 a-e)
    { key: 'waste_segregation', label: 'Waste Segregation (16a)', where: 'data', type: 'bool' },
    { key: 'waste_backyard_composting', label: 'Backyard Composting (16b)', where: 'data', type: 'bool' },
    { key: 'waste_recycling', label: 'Recycling/Reuse (16c)', where: 'data', type: 'bool' },
    { key: 'waste_collected', label: 'Collected by City/Municipal Collection (16d)', where: 'data', type: 'bool' },
    { key: 'waste_others', label: 'Others - Burning/Burying (16e)', where: 'data', type: 'bool' },
    { key: 'remarks', label: 'Remarks', where: 'column', type: 'string' },
  ],
};

export const SCHEMAS = Object.freeze({
  'ncd-risk': ncdRisk,
  'ncd-cervical': ncdCervical,
  'ncd-visual': ncdVisual,
  'oral-health': oralHealth,
  environmental,
});

export const PROGRAM_KINDS = Object.freeze(Object.keys(SCHEMAS));

export default { SCHEMAS, PROGRAM_KINDS, ORAL_SERVICE_CODES };
