/**
 * M1 PROGRAM-TO-INDICATOR MAPPING AND AGGREGATION RULES
 *
 * This document defines the correct indicator aggregation and counting logic for each M1 program.
 * Each program's indicators are aggregated from their respective data sources according to
 * official FHSIS definitions, with no double-counting or incorrect derivations.
 */

// ===========================================================================
// SECTION B: PRENATAL AND POSTPARTUM (Program: prenatal)
// ===========================================================================

/**
 * PRENATAL AND POSTPARTUM INDICATORS
 *
 * Source: maternal_records table
 * Aggregation method: COUNT_UNIQUE_RESIDENTS, COUNT_EVENTS
 *
 * Key fields:
 * - lmp: Last menstrual period
 * - delivery_date: Delivery date
 * - delivery_outcome: Live Birth, Fetal Death
 * - type_of_delivery: Vaginal, Cesarean
 * - place_of_delivery: Public Facility, Private Facility, Home / Non-Facility
 * - birth_attendant: Doctor, Nurse, Midwife, Hilot/TBA, Other
 * - birth_weight_class: low, normal, unknown
 * - pp_checkup_24h, pp_checkup_day3, pp_checkup_7_14d, pp_checkup_6wk: Postpartum visit dates
 *
 * B1: Prenatal Care Services
 *   B1_1: Women who delivered and completed at least 8 ANC
 *         → COUNT distinct resident_id WHERE prenatal_visits >= 8 AND status = 'Delivered'
 *
 *   B1_2: Women with 1st to 8th ANC on schedule (Resident)
 *         → COUNT events from maternal_records WHERE prenatal_visit_dates are on schedule
 *
 *   B1_3: Women completed 8 ANC transferred in from other LGUs
 *         → COUNT distinct resident_id WHERE transfer_status = 'transferred_in' AND prenatal_visits >= 8
 *
 *   B1_4: Women tracked during pregnancy (Resident)
 *         → COUNT distinct resident_id WHERE status = 'Active' AND date_of_registration NOT NULL
 *
 *   B1_5: Women tracked during pregnancy (Transferred In)
 *         → COUNT distinct resident_id WHERE transfer_status = 'transferred_in' AND date_of_registration NOT NULL
 *
 *   B1_6: Women transferred out with MOV before completing 8 ANC
 *         → COUNT distinct resident_id WHERE transfer_status = 'transferred_out' AND prenatal_visits < 8
 *
 *   B1_7: Pregnant women assessed for nutritional status during first trimester
 *         → COUNT distinct resident_id WHERE nutritional_assessment_date IS NOT NULL
 *
 *   B1_8: Pregnant women screened for anemia
 *         → COUNT distinct resident_id WHERE cbc_screen_date IS NOT NULL
 *
 * B2: Intrapartum and Newborn Care
 *   B2_1: Total Deliveries
 *         → COUNT maternal_records WHERE delivery_date IS NOT NULL
 *
 *   B2_2: Deliveries attended by Skilled Health Professional
 *         → COUNT maternal_records WHERE birth_attendant IN ('Doctor', 'Nurse', 'Midwife')
 *                                   AND delivery_date IS NOT NULL
 *
 *   B2_3: Facility-Based Deliveries
 *         → COUNT maternal_records WHERE place_of_delivery IN ('Public Facility', 'Private Facility')
 *                                   AND delivery_date IS NOT NULL
 *
 *   B2_4: Vaginal Deliveries
 *         → COUNT maternal_records WHERE type_of_delivery = 'Vaginal' AND delivery_date IS NOT NULL
 *
 *   B2_5: Cesarean Section Deliveries
 *         → COUNT maternal_records WHERE type_of_delivery = 'Cesarean' AND delivery_date IS NOT NULL
 *
 *   B2_6: Live Births - Normal Birth Weight
 *         → COUNT maternal_records WHERE delivery_outcome = 'Live Birth'
 *                                   AND birth_weight_class = 'normal'
 *
 *   B2_7: Live Births - Low Birth Weight
 *         → COUNT maternal_records WHERE delivery_outcome = 'Live Birth'
 *                                   AND birth_weight_class = 'low'
 *
 * B3: Postpartum Care
 *   B3_1: Women who completed at least 4 PNC
 *         → COUNT distinct resident_id WHERE pp_checkup_24h IS NOT NULL
 *                                        AND pp_checkup_day3 IS NOT NULL
 *                                        AND pp_checkup_7_14d IS NOT NULL
 *                                        AND pp_checkup_6wk IS NOT NULL
 *
 *   B3_2: Women received 1st to 4th PNC on schedule (Resident)
 *         → COUNT events WHERE postpartum_visit_dates are within expected ranges
 *
 *   B3_3: Women completed 4 PNC transferred in from other LGUs
 *         → COUNT distinct resident_id WHERE transfer_status = 'transferred_in' AND 4 PNC completed
 *
 *   B3_4: Postpartum women who completed Iron + Folic Acid supplementation
 *         → COUNT distinct resident_id WHERE iron_folic_completed_date IS NOT NULL
 *
 *   B3_5: Postpartum women who completed Vitamin A supplementation
 *         → COUNT distinct resident_id WHERE vitamin_a_given_date IS NOT NULL
 *
 * COUNTING RULES:
 *  - Prenatal indicators count UNIQUE residents, not visits
 *  - Do not count the same resident multiple times if she has multiple pregnancies in the period
 *  - Intrapartum indicators count delivery EVENTS, not unique residents
 *  - Postpartum indicators count unique residents who completed visits in the period
 *  - Do NOT add Vaginal + Cesarean deliveries to get Total Deliveries
 *  - Do NOT add all subsection totals; they represent distinct counts
 */

// ===========================================================================
// SECTION E1-E3: NCD RISK ASSESSMENT (Program: ncd)
// ===========================================================================

/**
 * NCD RISK ASSESSMENT INDICATORS
 *
 * Source: tcl_entries table (for diabetes, hypertension), ncd_risk_assessments table
 * Aggregation method: COUNT_UNIQUE_RESIDENTS (adults vs seniors distinguished)
 *
 * E1: Lifestyle-Related Risk Assessment
 *   E1_1 to E1_8: Adults aged 20-59 risk-assessed and lifestyle factors
 *   E1_9 to E1_16: Senior citizens aged 60+ risk-assessed and lifestyle factors
 *
 *   → COUNT distinct resident_id WHERE age_group IN ('20-59', '60+') AND risk_assessment_date IS NOT NULL
 *   → For each risk factor (smoking, alcohol, physical activity, diet, BMI):
 *      COUNT distinct resident_id WHERE factor = true AND risk_assessment_date IS NOT NULL
 *
 * E2: Cardiovascular Disease Prevention and Control
 *   E2_1 to E2_8: Adults aged 20-59 hypertension identification and treatment
 *   E2_9 to E2_16: Senior citizens aged 60+ hypertension identification and treatment
 *
 *   → Previously identified hypertensives (accumulated Jan through prev month)
 *   → New cases identified in current month
 *   → On antihypertensive medication (by facility, out-of-pocket, both)
 *   → COUNT distinct resident_id per age group and treatment status
 *
 * E3: Diabetes Mellitus Prevention and Control
 *   E3_1 to E3_8: Adults aged 20-59 diabetes identification and control
 *   E3_9 to E3_16: Senior citizens aged 60+ diabetes identification and control
 *
 *   → Previously identified diabetics (accumulated Jan through prev month)
 *   → New cases identified in current month
 *   → On antidiabetic medication (by facility, out-of-pocket, both)
 *   → COUNT distinct resident_id per age group and treatment status
 *
 * COUNTING RULES:
 *  - Count adults (20-59) and seniors (60+) SEPARATELY
 *  - Do NOT combine age groups
 *  - Do NOT count the same resident twice if they have both hypertension and diabetes
 *  - Cumulative indicators (previously identified) are year-to-date from January
 *  - Current month indicators show NEW cases identified only in the current month
 *  - Total = previous cumulative + new current month (no double-counting)
 */

// ===========================================================================
// SECTION E8-E9: CERVICAL AND BREAST CANCER SCREENING (Program: cervical)
// ===========================================================================

/**
 * CERVICAL CANCER AND BREAST MASS SCREENING INDICATORS
 *
 * Source: ncd_cervical_api, ncd_breast_api
 * Aggregation method: COUNT_UNIQUE_RESIDENTS, COUNT_EVENTS
 *
 * E8: Cervical Cancer Prevention and Control
 *   E8_1: Women aged 30-65 screened or assessed for cervical cancer
 *         → COUNT distinct resident_id WHERE age 30-65 AND cervical_screening_date IS NOT NULL
 *         → Break down by screening method: VIA, Pap Smear, HPV DNA, Assessed Only
 *
 *   E8_2: Women aged 30-65 found suspicious for cervical cancer
 *         → COUNT distinct resident_id WHERE cervical_result = 'suspicious'
 *
 *   E8_3: Women found suspicious and linked to care (treated or referred)
 *         → COUNT distinct resident_id WHERE cervical_result = 'suspicious'
 *                                        AND (referred = true OR treated = true)
 *
 *   E8_4: Women found positive for precancerous lesions
 *         → COUNT distinct resident_id WHERE cervical_result = 'precancerous_lesion'
 *
 *   E8_5: Women with precancerous lesions linked to care
 *         → COUNT distinct resident_id WHERE cervical_result = 'precancerous_lesion'
 *                                        AND (referred = true OR treated = true)
 *
 * E9: Breast Cancer Prevention and Control
 *   E9_1: Number of women aged 30-69 seen
 *         → COUNT distinct resident_id WHERE age 30-69 AND encounter_date IS NOT NULL
 *
 *   E9_2: Number of high-risk or symptomatic women
 *         → COUNT distinct resident_id WHERE breast_risk_status IN ('high_risk', 'symptomatic')
 *
 *   E9_3: High-risk women provided with breast examination
 *         → COUNT distinct resident_id WHERE breast_risk_status IN ('high_risk', 'symptomatic')
 *                                        AND (clinical_breast_exam = true OR mammogram = true)
 *
 *   E9_4: High-risk women found with remarkable results
 *         → COUNT distinct resident_id WHERE breast_risk_status IN ('high_risk', 'symptomatic')
 *                                        AND (cbe_result = 'remarkable' OR mammogram_result = 'remarkable')
 *
 *   E9_5: High-risk women with remarkable results linked to care
 *         → COUNT distinct resident_id WHERE breast_risk_status IN ('high_risk', 'symptomatic')
 *                                        AND (cbe_result = 'remarkable' OR mammogram_result = 'remarkable')
 *                                        AND (referred = true OR treated = true)
 *
 *   E9_6: Asymptomatic women aged 50-69 screened
 *         → COUNT distinct resident_id WHERE age 50-69 AND breast_risk_status = 'asymptomatic'
 *                                        AND (clinical_breast_exam = true OR mammogram = true)
 *
 *   E9_7: Asymptomatic women aged 50-69 found with remarkable results
 *         → COUNT distinct resident_id WHERE age 50-69 AND breast_risk_status = 'asymptomatic'
 *                                        AND (cbe_result = 'remarkable' OR mammogram_result = 'remarkable')
 *
 *   E9_8: Asymptomatic women aged 50-69 with remarkable results linked to care
 *         → COUNT distinct resident_id WHERE age 50-69 AND breast_risk_status = 'asymptomatic'
 *                                        AND (cbe_result = 'remarkable' OR mammogram_result = 'remarkable')
 *                                        AND (referred = true OR treated = true)
 *
 * COUNTING RULES:
 *  - Count unique residents screened
 *  - Do NOT combine cervical and breast indicators
 *  - Do NOT count a resident in both E8_2 (suspicious) and E8_4 (precancerous)
 *  - Each woman should appear in only one category per indicator
 *  - Screening method breakdown (VIA, Pap, HPV, Assessed) should be mutually exclusive
 */

// ===========================================================================
// SECTION E4-E5: VISUAL ACUITY AND PPV (Program: visual)
// ===========================================================================

/**
 * VISUAL ACUITY AND PPV INDICATORS
 *
 * Source: ncd_visual_api, immunizations table (for PPV)
 * Aggregation method: COUNT_UNIQUE_RESIDENTS (by age group)
 *
 * E4: Blindness Prevention Program
 *   Age groups: 0-9, 10-19, 20-59, 60+
 *
 *   E4_1: Individuals screened for eye diseases (by age group)
 *         → COUNT distinct resident_id WHERE age_group IN (0-9, 10-19, 20-59, 60+)
 *                                        AND eye_screening_date IS NOT NULL
 *
 *   E4_2: Individuals identified with eye diseases (by age group)
 *         → COUNT distinct resident_id WHERE age_group IN (0-9, 10-19, 20-59, 60+)
 *                                        AND eye_condition IS NOT NULL
 *
 *   E4_3: Identified eye conditions (classified)
 *         → COUNT distinct resident_id per condition type:
 *            - At least one eye ailment
 *            - Changes in vision
 *            - Changes in appearance
 *            - Eye and orbital injury
 *            - Routine eye examination
 *
 *   E4_4: Individuals identified with eye diseases and referred to professional (by age group)
 *         → COUNT distinct resident_id WHERE age_group IN (0-9, 10-19, 20-59, 60+)
 *                                        AND eye_condition IS NOT NULL
 *                                        AND referred_to_professional = true
 *
 * E5: Immunization for Senior Citizens (PPV and Influenza)
 *   E5_1: Senior citizens seen who had NOT received PPV at age 60
 *         → COUNT distinct resident_id WHERE age >= 60
 *                                        AND ppv_received_at_60 = false
 *                                        AND encounter_date IS NOT NULL
 *
 *   E5_2: Senior citizens aged 60+ who received one dose of PPV
 *         → COUNT distinct resident_id WHERE age >= 60
 *                                        AND ppv_dose_date IS NOT NULL
 *
 *   E5_3: Senior citizens seen (total)
 *         → COUNT distinct resident_id WHERE age >= 60
 *                                        AND encounter_date IS NOT NULL
 *
 *   E5_4: Senior citizens aged 60+ who received one dose of Influenza vaccine
 *         → COUNT distinct resident_id WHERE age >= 60
 *                                        AND influenza_dose_date IS NOT NULL
 *
 * COUNTING RULES:
 *  - Eye screening and immunization should NOT be combined
 *  - Count residents by age group separately
 *  - Do NOT count a resident in both E4 (eye) and E5 (immunization)
 *  - A resident receiving both PPV and Influenza should be counted in both indicators
 *  - E5_3 (seniors seen) is the union of all senior encounters, not a sum
 */

// ===========================================================================
// SECTION D: ORAL HEALTH (Program: oral)
// ===========================================================================

/**
 * ORAL HEALTH INDICATORS
 *
 * Source: oral_health_records, oralHealthApi
 * Aggregation method: COUNT_UNIQUE_RESIDENTS, COUNT_ENCOUNTERS
 *
 * Age groups: 0-11 months, 1-4, 5-9, 10-19, 20-59, 60+, Pregnant women
 *
 * D1: First Visit to an Oral Health Care Professional
 *   D1_1: Infants aged 0-11 months who had their first dental visit
 *         → COUNT distinct resident_id WHERE age_group = '0-11 months' AND first_visit_date IS NOT NULL
 *
 *   D1_2: Children aged 1-4 who had their first visit
 *         → COUNT distinct resident_id WHERE age_group = '1-4' AND first_visit_date IS NOT NULL
 *
 *   D1_3: Children aged 5-9 who had their first visit
 *         → COUNT distinct resident_id WHERE age_group = '5-9' AND first_visit_date IS NOT NULL
 *
 *   D1_4: Adolescents aged 10-19 who had their first visit
 *         → COUNT distinct resident_id WHERE age_group = '10-19' AND first_visit_date IS NOT NULL
 *
 *   D1_5: Adults aged 20-59 who had their first visit
 *         → COUNT distinct resident_id WHERE age_group = '20-59' AND first_visit_date IS NOT NULL
 *
 *   D1_6: Senior citizens aged 60+ who had their first visit
 *         → COUNT distinct resident_id WHERE age_group = '60+' AND first_visit_date IS NOT NULL
 *
 *   D1_7: Pregnant women who had their first visit
 *         → COUNT distinct resident_id WHERE pregnancy_status = 'pregnant' AND first_visit_date IS NOT NULL
 *
 * D2: Completion of Two Oral Health Visits
 *   D2_1: Children aged 1-4 who completed two visits
 *         → COUNT distinct resident_id WHERE age_group = '1-4' AND visit_count >= 2
 *
 *   D2_2: Children aged 5-9 who completed two visits
 *         → COUNT distinct resident_id WHERE age_group = '5-9' AND visit_count >= 2
 *
 *   D2_3: Adolescents aged 10-19 who completed two visits
 *         → COUNT distinct resident_id WHERE age_group = '10-19' AND visit_count >= 2
 *
 *   D2_4: Adults aged 20-59 who completed two visits
 *         → COUNT distinct resident_id WHERE age_group = '20-59' AND visit_count >= 2
 *
 *   D2_5: Senior citizens aged 60+ who completed two visits
 *         → COUNT distinct resident_id WHERE age_group = '60+' AND visit_count >= 2
 *
 *   D2_6: Pregnant women who completed two visits
 *         → COUNT distinct resident_id WHERE pregnancy_status = 'pregnant' AND visit_count >= 2
 *
 * COUNTING RULES:
 *  - First visit indicators count unique residents with first visit_date
 *  - Do NOT count a resident in both D1 (first visit) and D2 (completion) for the same period
 *  - Each resident should appear in one age group only
 *  - visit_count is cumulative for the resident during the period
 *  - Do NOT sum D1 age groups to get total first visits; each is distinct
 *  - Do NOT count the same visit twice if it satisfies multiple criteria
 */

// ===========================================================================
// SECTION G: HOUSEHOLD ENVIRONMENTAL MASTERLIST (Program: environmental)
// ===========================================================================

/**
 * HOUSEHOLD ENVIRONMENTAL INDICATORS
 *
 * Source: households table
 * Aggregation method: COUNT_UNIQUE_HOUSEHOLDS (not members)
 *
 * G1: Water Supply
 *   G1_1: Households with access to improved water supply (Total)
 *         → COUNT DISTINCT household_id WHERE water_source IN ('piped', 'borehole', 'protected_spring', 'rainwater')
 *
 *   G1_2: Households with Level I water supply
 *         → COUNT DISTINCT household_id WHERE water_supply_level = 'level_1'
 *
 *   G1_3: Households with Level II water supply
 *         → COUNT DISTINCT household_id WHERE water_supply_level = 'level_2'
 *
 *   G1_4: Households with Level III water supply
 *         → COUNT DISTINCT household_id WHERE water_supply_level = 'level_3'
 *
 *   G1_5: Households using safely managed drinking water service
 *         → COUNT DISTINCT household_id WHERE water_safely_managed = true
 *
 * G2: Sanitation
 *   G2_1: Households with basic sanitation facility (Total)
 *         → COUNT DISTINCT household_id WHERE toilet_type IN ('pour_flush', 'pit_latrine', 'vip_latrine')
 *
 *   G2_2: Households with pour/flush toilet connected to septic tank
 *         → COUNT DISTINCT household_id WHERE toilet_type = 'pour_flush' AND septic_tank = true
 *
 *   G2_3: Households with pour/flush toilet connected to sewer system
 *         → COUNT DISTINCT household_id WHERE toilet_type = 'pour_flush' AND sewer_system = true
 *
 *   G2_4: Households with VIP Latrine
 *         → COUNT DISTINCT household_id WHERE toilet_type = 'vip_latrine'
 *
 *   G2_5: Households using safely managed sanitation service
 *         → COUNT DISTINCT household_id WHERE sanitation_safely_managed = true
 *
 * COUNTING RULES:
 *  - COUNT unique HOUSEHOLDS, not household members
 *  - Each household appears in only ONE water level category
 *  - Each household appears in only ONE toilet type category
 *  - Do NOT count household members as separate households
 *  - Do NOT add Level I + II + III to get total improved water (they should sum to total)
 *  - Do NOT add toilet types to get total sanitation (they should sum to total)
 *  - Prevent duplicate household counting by enforcing DISTINCT household_id
 */

export const PROGRAM_AGGREGATION_RULES = {
  prenatal: {
    source: 'maternal_records',
    countUnit: 'unique_residents',
    ageDisaggregation: false,
    countingRules: [
      'Count unique residents, not visits',
      'No duplicate counting for same resident across indicators',
      'Delivery indicators count events, not unique residents',
      'Do not add subsection totals',
    ],
  },
  ncd: {
    source: 'tcl_entries, ncd_risk_assessments',
    countUnit: 'unique_residents',
    ageDisaggregation: true,
    ageGroups: ['20-59', '60+'],
    countingRules: [
      'Count adults and seniors separately',
      'No double-counting of same resident',
      'Cumulative indicators are year-to-date',
      'Current month shows only NEW cases',
    ],
  },
  cervical: {
    source: 'ncd_cervical_api',
    countUnit: 'unique_residents',
    ageDisaggregation: true,
    ageGroups: ['30-65'],
    countingRules: [
      'Count unique residents screened',
      'Keep cervical and breast separate',
      'No overlap between suspicious and precancerous',
      'Screening methods mutually exclusive',
    ],
  },
  visual: {
    source: 'ncd_visual_api, immunizations',
    countUnit: 'unique_residents',
    ageDisaggregation: true,
    ageGroups: ['0-9', '10-19', '20-59', '60+'],
    countingRules: [
      'Count by age group separately',
      'Keep eye screening and immunization separate',
      'No overlap between indicators',
      'A resident can appear in both PPV and Influenza',
    ],
  },
  oral: {
    source: 'oral_health_records',
    countUnit: 'unique_residents',
    ageDisaggregation: true,
    ageGroups: ['0-11 months', '1-4', '5-9', '10-19', '20-59', '60+', 'pregnant'],
    countingRules: [
      'Count unique residents with visits',
      'First visit and completion are different indicators',
      'Each resident in one age group only',
      'Do not sum age groups',
    ],
  },
  environmental: {
    source: 'households',
    countUnit: 'unique_households',
    ageDisaggregation: false,
    countingRules: [
      'Count unique HOUSEHOLDS, not members',
      'Each household in one water level only',
      'Each household in one toilet type only',
      'No double-counting by distinct household_id',
    ],
  },
  enrollment: {
    source: 'tcl_entries',
    countUnit: 'unique_enrollments',
    ageDisaggregation: false,
    countingRules: [
      'Count active enrollments only',
      'Track enrollment status and follow-up',
      'Community program, separate from FHSIS sections',
    ],
  },
};

export default PROGRAM_AGGREGATION_RULES;
