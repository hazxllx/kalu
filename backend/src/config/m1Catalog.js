/**
 * KALUSAGAP — FHSIS M1 indicator catalog (single source of truth).
 *
 * This module enumerates EVERY M1 indicator required by the FHSIS M1 monthly
 * program-accomplishment/service-coverage report, across all eight sections
 * (A Family Planning, B Maternal Care, C Child Care, D Oral Care, E Infectious
 * Disease, F NCD, G Environmental Health, H Mortality/Natality).
 *
 * The catalog is intentionally data (not code): the backend seeds it into the
 * `public.m1_indicators` table, validates every recorded event against it, and
 * drives aggregation from it. The frontend renders sections/indicators from the
 * same catalog (served over the API) instead of hardcoding hundreds of rows in
 * React components.
 *
 * Each indicator declares WHERE its value comes from (`source`) so the
 * aggregation layer reuses existing KALUSAGAP records where they already exist
 * (immunizations, households WASH, household member mortality) and only stores
 * new underlying event rows in `public.m1_records` for indicators that have no
 * existing source. The report total is ALWAYS computed from underlying records
 * and is fully traceable back to the residents/households that produced it.
 */

// ---------------------------------------------------------------------------
// Enumerations (documented in PART 16 of the spec)
// ---------------------------------------------------------------------------

export const SECTIONS = Object.freeze([
  { key: 'A', title: 'Family Planning Services for Women of Reproductive Age' },
  { key: 'B', title: 'Maternal Care and Services' },
  { key: 'C', title: 'Child Care and Services' },
  { key: 'D', title: 'Oral Care and Services' },
  { key: 'E', title: 'Infectious Disease Prevention and Control Services' },
  { key: 'F', title: 'Non-Communicable Disease Prevention and Control' },
  { key: 'G', title: 'Environmental Health and Sanitation Services' },
  { key: 'H', title: 'Mortality and Natality' },
]);

export const FREQUENCIES = Object.freeze(['monthly', 'quarterly', 'annual', 'november']);

export const AGGREGATIONS = Object.freeze([
  'COUNT_UNIQUE_RESIDENTS',
  'COUNT_EVENTS',
  'COUNT_CASES',
  'SUM',
  'RATE',
  'PERCENTAGE',
  'CURRENT_USERS',
  'NEW_ACCEPTORS',
  'DROPOUTS',
  'TOTAL',
]);

// Where the aggregated value is read from.
export const SOURCES = Object.freeze([
  'm1_records', // dedicated underlying-event store (public.m1_records)
  'immunizations', // reuse public.immunizations
  'households', // reuse public.households WASH fields
  'household_member_health_profiles', // reuse mortality fields
  'maternal_records', // reuse public.maternal_records
]);

// Age-group schemes. Each resolves to an ordered list of buckets.
export const AGE_SCHEMES = Object.freeze({
  none: ['Total'],
  fp: ['10-14', '15-19', '20-49'], // women of reproductive age bands
  malaria: ['<5', '>=5'],
  deworming_child: ['1-4', '5-9', '10-19'],
  mortality_detail: [
    '0-6 days', '7-28 days', '29 days-11 months', '1-4', '5-9', '10-14',
    '15-19', '20-24', '25-29', '30-34', '35-39', '40-44', '45-49', '50-54',
    '55-59', '60-64', '65-69', '70+',
  ],
});

// Family-planning "measure" dimension (stored in m1_records.detail.measure).
export const FP_MEASURES = Object.freeze([
  { key: 'current_begin', label: 'Current Users — Beginning of Month' },
  { key: 'new_prev', label: 'New Acceptors — Previous Month' },
  { key: 'other_present', label: 'Other Acceptors — Present Month' },
  { key: 'dropout_present', label: 'Drop-outs — Present Month' },
  { key: 'new_present', label: 'New Acceptors — Present Month' },
  { key: 'current_end', label: 'Current Users — End of Month' },
]);

// ---------------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------------

let ORDER = 0;
const rows = [];

/**
 * Register one indicator.
 * @param {string} section  section key (A..H)
 * @param {string} subsection short subsection label
 * @param {string} code      globally-unique indicator code
 * @param {string} name      display name (verbatim from the M1 form where possible)
 * @param {object} opts
 */
const ind = (section, subsection, code, name, opts = {}) => {
  const {
    frequency = 'monthly',
    aggregation = 'TOTAL',
    source = 'm1_records',
    ageScheme = 'none',
    sex = false,
    remarks = true,
    dataType = 'count',
    match = null, // adapter hint for non-m1_records sources
    population = null,
  } = opts;
  rows.push({
    code,
    section,
    subsection,
    name,
    frequency,
    aggregation,
    source,
    ageScheme,
    ageGroups: AGE_SCHEMES[ageScheme] || AGE_SCHEMES.none,
    sexBreakdown: Boolean(sex),
    remarksAllowed: Boolean(remarks),
    dataType,
    match,
    population,
    displayOrder: (ORDER += 10),
    active: true,
  });
};

// ===========================================================================
// SECTION A — FAMILY PLANNING
// ===========================================================================
ind('A', 'A1. Modern FP Unmet Need', 'A1_1',
  'Women of reproductive age with unmet need for modern family planning',
  { ageScheme: 'fp', aggregation: 'COUNT_UNIQUE_RESIDENTS' });

// A2 — Use of family planning method. Each method is one indicator; the six
// current-users/acceptor/dropout measures live in m1_records.detail.measure.
const FP_METHODS = [
  ['A2_btl', 'Female Sterilization / BTL'],
  ['A2_nsv', 'Male Sterilization / NSV'],
  ['A2_condom', 'Condom'],
  ['A2_pop', 'Pills — POP'],
  ['A2_coc', 'Pills — COC'],
  ['A2_dmpa', 'Injectables — DMPA/POI'],
  ['A2_implant', 'Implant'],
  ['A2_iud_i', 'IUD — Interval (IUD-I)'],
  ['A2_iud_pp', 'IUD — Post-Partum (IUD-PP)'],
  ['A2_lam', 'NFP — LAM'],
  ['A2_bbt', 'NFP — BBT'],
  ['A2_cmm', 'NFP — CMM'],
  ['A2_stm', 'NFP — STM'],
  ['A2_sdm', 'NFP — SDM'],
];
for (const [code, name] of FP_METHODS) {
  ind('A', 'A2. Use of Family Planning Method', code, name, {
    ageScheme: 'fp', aggregation: 'CURRENT_USERS', dataType: 'fp_method',
  });
}
ind('A', 'A2. Use of Family Planning Method', 'A2_total',
  'Total Current Users (all methods, End of Month)',
  { ageScheme: 'fp', aggregation: 'CURRENT_USERS', dataType: 'fp_total' });

ind('A', 'A3. Deworming (WRA)', 'A3_1',
  'Women 20-49 years old given 2 doses of deworming drugs',
  { aggregation: 'COUNT_UNIQUE_RESIDENTS', population: '20-49 F' });

// ===========================================================================
// SECTION B — MATERNAL CARE
// ===========================================================================
const B1 = 'B1. Prenatal Care';
ind('B', B1, 'B1_1', 'Pregnant women with at least 4 prenatal check-ups', { ageScheme: 'fp' });
ind('B', B1, 'B1_2', 'Pregnant women assessed for nutritional status during the first trimester', { ageScheme: 'fp' });
ind('B', B1, 'B1_2a', 'First-trimester pregnant women with normal BMI', { ageScheme: 'fp' });
ind('B', B1, 'B1_2b', 'First-trimester pregnant women with low BMI', { ageScheme: 'fp' });
ind('B', B1, 'B1_2c', 'First-trimester pregnant women with high BMI', { ageScheme: 'fp' });
ind('B', B1, 'B1_3', 'Pregnant women (first time) given at least 2 doses of Td', { ageScheme: 'fp' });
ind('B', B1, 'B1_4', 'Pregnant women (second+) given at least 3 doses of Td / Td2 Plus', { ageScheme: 'fp' });
ind('B', B1, 'B1_5', 'Pregnant women who completed iron with folic acid supplementation', { ageScheme: 'fp' });
ind('B', B1, 'B1_6', 'Pregnant women who completed calcium carbonate supplementation', { ageScheme: 'fp' });
ind('B', B1, 'B1_7', 'Pregnant women given iodine capsules', { ageScheme: 'fp' });
ind('B', B1, 'B1_8', 'Pregnant women given one dose of deworming tablet', { ageScheme: 'fp' });
ind('B', B1, 'B1_9', 'Pregnant women screened for syphilis', { ageScheme: 'fp' });
ind('B', B1, 'B1_10', 'Pregnant women tested positive for syphilis', { ageScheme: 'fp', aggregation: 'COUNT_CASES' });
ind('B', B1, 'B1_11', 'Pregnant women screened for Hepatitis B', { ageScheme: 'fp' });
ind('B', B1, 'B1_12', 'Pregnant women tested positive for Hepatitis B', { ageScheme: 'fp', aggregation: 'COUNT_CASES' });
ind('B', B1, 'B1_13', 'Pregnant women screened for HIV', { ageScheme: 'fp' });
ind('B', B1, 'B1_14', 'Pregnant women tested for CBC or Hgb/Hct count', { ageScheme: 'fp' });
ind('B', B1, 'B1_15', 'Pregnant women tested for CBC or Hgb/Hct diagnosed with anemia', { ageScheme: 'fp', aggregation: 'COUNT_CASES' });
ind('B', B1, 'B1_16', 'Pregnant women screened for gestational diabetes', { ageScheme: 'fp' });
ind('B', B1, 'B1_17', 'Pregnant women tested positive for gestational diabetes', { ageScheme: 'fp', aggregation: 'COUNT_CASES' });

const B2 = 'B2. Intrapartum Care and Delivery Outcome';
ind('B', B2, 'B2_18', 'Number of deliveries', { aggregation: 'COUNT_EVENTS' });
ind('B', B2, 'B2_19', 'Number of live births', { aggregation: 'COUNT_EVENTS' });
ind('B', B2, 'B2_20a', 'Live births with normal birth weight', { aggregation: 'COUNT_EVENTS' });
ind('B', B2, 'B2_20b', 'Live births with low birth weight', { aggregation: 'COUNT_EVENTS' });
ind('B', B2, 'B2_20c', 'Live births with unknown birth weight', { aggregation: 'COUNT_EVENTS' });
ind('B', B2, 'B2_21', 'Deliveries attended by skilled health professionals', { aggregation: 'COUNT_EVENTS' });
ind('B', B2, 'B2_21a', 'Deliveries attended by a Doctor', { aggregation: 'COUNT_EVENTS' });
ind('B', B2, 'B2_21b', 'Deliveries attended by a Nurse', { aggregation: 'COUNT_EVENTS' });
ind('B', B2, 'B2_21c', 'Deliveries attended by a Midwife', { aggregation: 'COUNT_EVENTS' });
ind('B', B2, 'B2_22', 'Deliveries attended by non-skilled health professionals', { aggregation: 'COUNT_EVENTS' });
ind('B', B2, 'B2_22a', 'Deliveries attended by Hilot/TBA', { aggregation: 'COUNT_EVENTS' });
ind('B', B2, 'B2_22b', 'Deliveries attended by others', { aggregation: 'COUNT_EVENTS' });
ind('B', B2, 'B2_23', 'Health facility-based deliveries', { aggregation: 'COUNT_EVENTS' });
ind('B', B2, 'B2_24a', 'Deliveries in a public health facility', { aggregation: 'COUNT_EVENTS' });
ind('B', B2, 'B2_24b', 'Deliveries in a private health facility', { aggregation: 'COUNT_EVENTS' });
ind('B', B2, 'B2_25', 'Non-facility-based deliveries', { aggregation: 'COUNT_EVENTS' });
ind('B', B2, 'B2_26a', 'Vaginal deliveries', { aggregation: 'COUNT_EVENTS' });
ind('B', B2, 'B2_26b', 'Deliveries by cesarean section', { aggregation: 'COUNT_EVENTS' });
ind('B', B2, 'B2_27a', 'Full-term births', { aggregation: 'COUNT_EVENTS' });
ind('B', B2, 'B2_27b', 'Pre-term births', { aggregation: 'COUNT_EVENTS' });
ind('B', B2, 'B2_27c', 'Fetal deaths', { aggregation: 'COUNT_CASES' });
ind('B', B2, 'B2_27d', 'Abortion / miscarriage', { aggregation: 'COUNT_CASES' });

const B3 = 'B3. Postpartum and Newborn Care';
ind('B', B3, 'B3_28', 'Postpartum women + newborn who completed at least 2 postpartum check-ups', { ageScheme: 'fp' });
ind('B', B3, 'B3_29', 'Postpartum women who completed iron with folic acid supplementation', { ageScheme: 'fp' });
ind('B', B3, 'B3_30', 'Postpartum women with Vitamin A supplementation', { ageScheme: 'fp' });

// ===========================================================================
// SECTION C — CHILD CARE
// ===========================================================================
const C1 = 'C1. Immunization Services';
// Immunization indicators reuse the EXISTING public.immunizations records
// (match by vaccine label, status Completed). No duplicate immunization store.
const VAX = [
  ['C1_1', 'CPAB', ['CPAB']],
  ['C1_2', 'BCG', ['BCG']],
  ['C1_3', 'HepB within 24 hours', ['HepB', 'Hepatitis B', 'HEPB']],
  ['C1_4', 'DPT-Hib-HepB (Penta) 1', ['Penta 1', 'Pentavalent 1', 'DPT-Hib-HepB 1']],
  ['C1_5', 'DPT-Hib-HepB (Penta) 2', ['Penta 2', 'Pentavalent 2', 'DPT-Hib-HepB 2']],
  ['C1_6', 'DPT-Hib-HepB (Penta) 3', ['Penta 3', 'Pentavalent 3', 'DPT-Hib-HepB 3']],
  ['C1_7', 'OPV 1', ['OPV 1', 'OPV1']],
  ['C1_8', 'OPV 2', ['OPV 2', 'OPV2']],
  ['C1_9', 'OPV 3', ['OPV 3', 'OPV3']],
  ['C1_10', 'IPV', ['IPV']],
  ['C1_11', 'PCV 1', ['PCV 1', 'PCV1']],
  ['C1_12', 'PCV 2', ['PCV 2', 'PCV2']],
  ['C1_13', 'MCV 1', ['MCV 1', 'MCV1', 'AMV', 'Measles']],
  ['C1_14', 'MCV 2', ['MCV 2', 'MCV2', 'MMR']],
  ['C1_15', 'FIC (Fully Immunized Child)', ['FIC']],
  ['C1_16', 'CIC (Completely Immunized Child)', ['CIC']],
];
for (const [code, name, aliases] of VAX) {
  ind('C', C1, code, name, {
    source: 'immunizations', aggregation: 'COUNT_EVENTS', sex: true,
    match: { vaccine: name, aliases, status: 'Completed' },
  });
}
// School-based Td/MR are reported in November.
ind('C', C1, 'C1_17', 'Td, Grade 1 (November)', { source: 'immunizations', frequency: 'november', sex: true, aggregation: 'COUNT_EVENTS', match: { vaccine: 'Td Grade 1', aliases: ['Td Grade 1', 'Td G1'], status: 'Completed' } });
ind('C', C1, 'C1_18', 'MR, Grade 1 (November)', { source: 'immunizations', frequency: 'november', sex: true, aggregation: 'COUNT_EVENTS', match: { vaccine: 'MR Grade 1', aliases: ['MR Grade 1', 'MR G1'], status: 'Completed' } });
ind('C', C1, 'C1_19', 'Td, Grade 7 (November)', { source: 'immunizations', frequency: 'november', sex: true, aggregation: 'COUNT_EVENTS', match: { vaccine: 'Td Grade 7', aliases: ['Td Grade 7', 'Td G7'], status: 'Completed' } });
ind('C', C1, 'C1_20', 'MR, Grade 7 (November)', { source: 'immunizations', frequency: 'november', sex: true, aggregation: 'COUNT_EVENTS', match: { vaccine: 'MR Grade 7', aliases: ['MR Grade 7', 'MR G7'], status: 'Completed' } });

const C2 = 'C2. Nutrition Services';
const nutri = (code, name) => ind('C', C2, code, name, { sex: true, aggregation: 'COUNT_EVENTS' });
nutri('C2_21', 'Newborns initiated on breastfeeding within 90 minutes of birth');
nutri('C2_22', 'Preterm/LBW infants given iron supplementation');
nutri('C2_23', 'Infants 6 months old seen');
nutri('C2_24', 'Infants exclusively breastfed until the 6th month');
nutri('C2_25', 'Infants 6 months initiated to complementary feeding WITH continued breastfeeding');
nutri('C2_26', 'Infants 6 months initiated to complementary feeding, no longer/never breastfed');
nutri('C2_27', 'Infants 6-11 months old seen');
nutri('C2_28', 'Infants 6-11 months given 1 dose Vitamin A 100,000 IU');
nutri('C2_29', 'Children 12-59 months old seen');
nutri('C2_30', 'Children 12-59 months given 2 doses Vitamin A 200,000 IU');
nutri('C2_31', 'Infants 6-11 months who completed MNP supplementation');
nutri('C2_32', 'Children 12-23 months old seen');
nutri('C2_33', 'Children 12-23 months who completed MNP supplementation');

const CNS = 'C2b. Child Nutritional Status';
// Nutrition status categories; program outcome (admitted/cured/defaulted/died)
// is carried in m1_records.detail.outcome and shown in the drill-down.
ind('C', CNS, 'C2_status_mam', 'Children with Moderate Acute Malnutrition (MAM)', { sex: true, aggregation: 'COUNT_CASES', dataType: 'nutrition_status' });
ind('C', CNS, 'C2_status_sam', 'Children with Severe Acute Malnutrition (SAM)', { sex: true, aggregation: 'COUNT_CASES', dataType: 'nutrition_status' });
ind('C', CNS, 'C2_status_overweight', 'Children Overweight/Obese', { sex: true, aggregation: 'COUNT_CASES', dataType: 'nutrition_status' });
ind('C', CNS, 'C2_status_normal', 'Children with Normal nutritional status', { sex: true, aggregation: 'COUNT_CASES', dataType: 'nutrition_status' });

const C3 = 'C3. Deworming Services (Children/Adolescents)';
ind('C', C3, 'C3_35', '1-19 year olds given 2 doses of deworming drug', { sex: true, aggregation: 'COUNT_EVENTS' });
ind('C', C3, 'C3_35a', 'PSAC 1-4 years old dewormed with 2 doses', { sex: true, aggregation: 'COUNT_EVENTS' });
ind('C', C3, 'C3_35b', 'SAC 5-9 years old dewormed with 2 doses', { sex: true, aggregation: 'COUNT_EVENTS' });
ind('C', C3, 'C3_35c', 'Adolescents 10-19 years old dewormed with 2 doses', { sex: true, aggregation: 'COUNT_EVENTS' });

const C4 = 'C4. Management of Sick Infants and Children';
ind('C', C4, 'C4_36', 'Sick infants 6-11 months old seen', { sex: true, aggregation: 'COUNT_EVENTS' });
ind('C', C4, 'C4_37', 'Sick infants 6-11 months old who received Vitamin A', { sex: true, aggregation: 'COUNT_EVENTS' });
ind('C', C4, 'C4_38', 'Sick children 12-59 months old seen', { sex: true, aggregation: 'COUNT_EVENTS' });
ind('C', C4, 'C4_39', 'Sick children 12-59 months old who received Vitamin A', { sex: true, aggregation: 'COUNT_EVENTS' });
ind('C', C4, 'C4_40', 'Diarrhea cases 0-59 months old seen', { sex: true, aggregation: 'COUNT_CASES' });
ind('C', C4, 'C4_41', 'Diarrhea cases 0-59 months old who received ORS', { sex: true, aggregation: 'COUNT_CASES' });
ind('C', C4, 'C4_42', 'Diarrhea cases 0-59 months old who received ORS with zinc', { sex: true, aggregation: 'COUNT_CASES' });
ind('C', C4, 'C4_43', 'Pneumonia cases 0-59 months old seen', { sex: true, aggregation: 'COUNT_CASES' });
ind('C', C4, 'C4_44', 'Pneumonia cases 0-59 months old who completed treatment', { sex: true, aggregation: 'COUNT_CASES' });

// ===========================================================================
// SECTION D — ORAL CARE (quarterly)
// ===========================================================================
const D = 'D. Oral Care and Services';
const oral = (code, name) => ind('D', D, code, name, { frequency: 'quarterly', sex: true, aggregation: 'COUNT_EVENTS' });
oral('D_1', 'Children 12-59 months orally fit upon examination or after rehabilitation');
oral('D_2', 'Clients 5 years old and above with DMFT (Decayed-Missing-Filled Teeth)');
oral('D_3', 'Infants 0-11 months who received Basic Oral Health Care (BOHC)');
oral('D_4', 'Children 1-4 years old who received BOHC');
oral('D_5', 'Children 5-9 years old who received BOHC');
oral('D_6', 'Adolescents 10-14 years old who received BOHC');
oral('D_7', 'Adolescents 15-19 years old who received BOHC');
oral('D_8', 'Adults 20-59 years old who received BOHC');
oral('D_9', 'Senior citizens 60 years old and above who received BOHC');
oral('D_10', 'Pregnant women who received BOHC');

// ===========================================================================
// SECTION E — INFECTIOUS DISEASE
// ===========================================================================
ind('E', 'E1. Filariasis', 'E1_1', 'Filariasis cases/mass drug administration (annual)', { frequency: 'annual', aggregation: 'COUNT_CASES', sex: true });

const E2 = 'E2. Schistosomiasis';
ind('E', E2, 'E2_1', 'Patients seen', { aggregation: 'COUNT_EVENTS' });
ind('E', E2, 'E2_2', 'Suspected cases seen', { aggregation: 'COUNT_CASES' });
ind('E', E2, 'E2_3', 'Acute clinically diagnosed cases', { aggregation: 'COUNT_CASES' });
ind('E', E2, 'E2_4', 'Confirmed acute cases', { aggregation: 'COUNT_CASES' });
ind('E', E2, 'E2_5', 'Chronic clinically diagnosed cases', { aggregation: 'COUNT_CASES' });
ind('E', E2, 'E2_6', 'Confirmed chronic cases', { aggregation: 'COUNT_CASES' });
ind('E', E2, 'E2_7', 'Confirmed cases (acute and chronic)', { aggregation: 'COUNT_CASES' });
ind('E', E2, 'E2_8', 'Cases treated', { aggregation: 'COUNT_CASES' });
ind('E', E2, 'E2_9', 'Confirmed chronic cases referred to a hospital facility', { aggregation: 'COUNT_CASES' });

const E5 = 'E5. Tuberculosis';
ind('E', E5, 'E5_1', 'Notified TB cases, all forms', { aggregation: 'COUNT_CASES', sex: true });
ind('E', E5, 'E5_2', 'Registered bacteriologically-confirmed DR-TB / RR-MDR-TB cases', { aggregation: 'COUNT_CASES', sex: true });
ind('E', E5, 'E5_3', 'TB (all forms) cured and completely treated', { aggregation: 'COUNT_CASES', sex: true });
ind('E', E5, 'E5_4', 'DR-TB / RR-MDR-TB cases cured and completed treatment', { aggregation: 'COUNT_CASES', sex: true });

const E6 = 'E6. Malaria';
ind('E', E6, 'E6_1', 'Probable/clinically-diagnosed malaria and confirmed cases', { aggregation: 'COUNT_CASES', ageScheme: 'malaria', sex: true });
ind('E', E6, 'E6_2', 'Laboratory-confirmed malaria deaths', { aggregation: 'COUNT_CASES', ageScheme: 'malaria', sex: true });

const E7 = 'E7. Leprosy';
ind('E', E7, 'E7_1', 'Leprosy cases on treatment during the reporting period', { aggregation: 'COUNT_CASES', sex: true });
ind('E', E7, 'E7_2', 'Newly detected leprosy cases during the reporting period', { aggregation: 'COUNT_CASES', sex: true });

const E8 = 'E8. Rabies';
ind('E', E8, 'E8_1', 'Animal bite cases', { aggregation: 'COUNT_CASES', sex: true });
ind('E', E8, 'E8_2', 'Deaths due to rabies', { aggregation: 'COUNT_CASES', sex: true });

// ===========================================================================
// SECTION F — NCD
// ===========================================================================
const F = 'F. NCD Prevention and Control';
ind('F', F, 'F_1', 'Adults risk-assessed using the NCD risk-assessment protocol', { aggregation: 'COUNT_UNIQUE_RESIDENTS', sex: true });
ind('F', F, 'F_2', 'Current smokers', { aggregation: 'COUNT_CASES', sex: true });
ind('F', F, 'F_3', 'Alcohol binge drinkers', { aggregation: 'COUNT_CASES', sex: true });
ind('F', F, 'F_4', 'Overweight/Obese', { aggregation: 'COUNT_CASES', sex: true });
ind('F', F, 'F_5', 'Adult women screened for cervical cancer (VIA/Pap smear/approved method)', { aggregation: 'COUNT_UNIQUE_RESIDENTS' });
ind('F', F, 'F_6', 'Adult women found positive/suspect for cervical cancer', { aggregation: 'COUNT_CASES' });
ind('F', F, 'F_7', 'Adult women screened for breast mass', { aggregation: 'COUNT_UNIQUE_RESIDENTS' });
ind('F', F, 'F_8', 'Adult women with suspicious breast mass', { aggregation: 'COUNT_CASES' });
ind('F', F, 'F_9', 'Newly identified hypertensive adults', { aggregation: 'COUNT_CASES', sex: true });
ind('F', F, 'F_10', 'Newly identified adults with Type 2 Diabetes Mellitus', { aggregation: 'COUNT_CASES', sex: true });
ind('F', F, 'F_11', 'Senior citizens screened for visual acuity', { aggregation: 'COUNT_UNIQUE_RESIDENTS', sex: true });
ind('F', F, 'F_12', 'Senior citizens diagnosed with eye disease(s)', { aggregation: 'COUNT_CASES', sex: true });
ind('F', F, 'F_13', 'Senior citizens who received one dose of PPV', { aggregation: 'COUNT_EVENTS', sex: true });
ind('F', F, 'F_14', 'Senior citizens who received one dose of influenza vaccine', { aggregation: 'COUNT_EVENTS', sex: true });

// ===========================================================================
// SECTION G — ENVIRONMENTAL HEALTH (reuse public.households WASH fields)
// ===========================================================================
const G = 'G. Environmental Health and Sanitation';
const HH = 'households';
ind('G', G, 'G_1', 'Households with access to basic safe water supply', { source: HH, aggregation: 'COUNT_UNIQUE_RESIDENTS', dataType: 'household', match: { field: 'water_source', in: ['level1', 'level2', 'level3'] } });
ind('G', G, 'G_1_1', 'Households with Level I water supply', { source: HH, aggregation: 'COUNT_UNIQUE_RESIDENTS', dataType: 'household', match: { field: 'water_source', eq: 'level1' } });
ind('G', G, 'G_1_2', 'Households with Level II water supply', { source: HH, aggregation: 'COUNT_UNIQUE_RESIDENTS', dataType: 'household', match: { field: 'water_source', eq: 'level2' } });
ind('G', G, 'G_1_3', 'Households with Level III water supply', { source: HH, aggregation: 'COUNT_UNIQUE_RESIDENTS', dataType: 'household', match: { field: 'water_source', eq: 'level3' } });
ind('G', G, 'G_2', 'Households using safely managed drinking-water services', { source: HH, aggregation: 'COUNT_UNIQUE_RESIDENTS', dataType: 'household', match: { field: 'water_treated', eq: true, and: { field: 'water_source', in: ['level1', 'level2', 'level3'] } } });
ind('G', G, 'G_3', 'Households with a basic sanitation facility', { source: HH, aggregation: 'COUNT_UNIQUE_RESIDENTS', dataType: 'household', match: { field: 'toilet_type', in: ['ws_own', 'ws_shared', 'antipolo'] } });
ind('G', G, 'G_3_1', 'Households with pour/flush toilet connected to septic tank', { source: HH, aggregation: 'COUNT_UNIQUE_RESIDENTS', dataType: 'household', match: { field: 'toilet_type', eq: 'ws_own' } });
ind('G', G, 'G_3_2', 'Households with pour/flush toilet connected to a sewer/approved treatment', { source: HH, aggregation: 'COUNT_UNIQUE_RESIDENTS', dataType: 'household', match: { field: 'toilet_type', eq: 'ws_shared' } });
ind('G', G, 'G_3_3', 'Households with a ventilated improved pit (VIP) latrine', { source: HH, aggregation: 'COUNT_UNIQUE_RESIDENTS', dataType: 'household', match: { field: 'toilet_type', eq: 'antipolo' } });
ind('G', G, 'G_4', 'Households using safely managed sanitation services', { source: HH, aggregation: 'COUNT_UNIQUE_RESIDENTS', dataType: 'household', match: { field: 'toilet_type', eq: 'ws_own' } });
ind('G', G, 'G_5', 'Industrial establishments issued with a sanitary permit', { aggregation: 'COUNT_EVENTS', dataType: 'establishment' });
ind('G', G, 'G_6', 'Barangays declared Zero Open Defecation (ZOD)', { aggregation: 'COUNT_EVENTS', frequency: 'annual', dataType: 'establishment' });

// ===========================================================================
// SECTION H — MORTALITY & NATALITY
// ===========================================================================
const H1 = 'H1. Mortality';
// Total deaths reuse recorded household member mortality; specific death
// categories are recorded events (require clinical classification not in the
// member profile). Rates are NEVER invented without a denominator.
ind('H', H1, 'H1_1', 'Total deaths', { source: 'household_member_health_profiles', aggregation: 'COUNT_EVENTS', sex: true });
ind('H', H1, 'H1_2', 'Maternal deaths', { aggregation: 'COUNT_CASES' });
ind('H', H1, 'H1_3', 'Under-five deaths', { aggregation: 'COUNT_CASES', sex: true });
ind('H', H1, 'H1_4', 'Infant deaths', { aggregation: 'COUNT_CASES', sex: true });
ind('H', H1, 'H1_5', 'Neonatal deaths', { aggregation: 'COUNT_CASES', sex: true });
ind('H', H1, 'H1_6', 'Fetal deaths', { aggregation: 'COUNT_CASES', sex: true });
ind('H', H1, 'H1_7', 'Early neonatal deaths', { aggregation: 'COUNT_CASES', sex: true });
ind('H', H1, 'H1_8', 'Perinatal deaths', { aggregation: 'COUNT_CASES', sex: true });
ind('H', H1, 'H1_detail', 'Mortality by underlying cause (ICD-10)', { aggregation: 'COUNT_CASES', ageScheme: 'mortality_detail', sex: true, dataType: 'mortality_detail' });

const H2 = 'H2. Natality';
ind('H', H2, 'H2_1', 'Live births (by mother\'s age group)', { aggregation: 'COUNT_EVENTS', ageScheme: 'fp' });

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export const M1_INDICATORS = Object.freeze(rows.map((r) => Object.freeze(r)));

const BY_CODE = new Map(M1_INDICATORS.map((r) => [r.code, r]));

export const getIndicator = (code) => BY_CODE.get(code) || null;
export const isValidIndicatorCode = (code) => BY_CODE.has(code);
export const indicatorsBySection = (sectionKey) =>
  M1_INDICATORS.filter((r) => r.section === sectionKey);

/** Group the catalog into { section, title, subsections: [{ subsection, indicators }] }. */
export const catalogTree = () => {
  return SECTIONS.map((s) => {
    const items = indicatorsBySection(s.key);
    const subMap = new Map();
    for (const it of items) {
      if (!subMap.has(it.subsection)) subMap.set(it.subsection, []);
      subMap.get(it.subsection).push(it);
    }
    return {
      section: s.key,
      title: s.title,
      subsections: [...subMap.entries()].map(([subsection, indicators]) => ({ subsection, indicators })),
    };
  });
};

export default {
  SECTIONS,
  FREQUENCIES,
  AGGREGATIONS,
  SOURCES,
  AGE_SCHEMES,
  FP_MEASURES,
  M1_INDICATORS,
  getIndicator,
  isValidIndicatorCode,
  indicatorsBySection,
  catalogTree,
};
