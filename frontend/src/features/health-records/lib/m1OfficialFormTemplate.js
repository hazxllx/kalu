/**
 * KALUSAGAP — FHSIS Monthly Form M1 — OFFICIAL FORM TEMPLATE (STRUCTURE ONLY).
 *
 * Faithful transcription of the official FHSIS M1 reporting sheet supplied as the
 * reference (8 landscape pages): section bars, the two-column side-by-side body,
 * the wide Family-Planning matrix, exact indicator wording/numbering and the
 * parent/child hierarchy, plus the per-section column scheme (age-group,
 * Male/Female, or Total-only). Contains NO values and NO highlight colours.
 *
 * `code` links a row to a KALUSAGAP M1 catalog indicator so the renderer fills it
 * from the live aggregation (`m1Api.monthly` → `byCode`). Rows the official form
 * defines but KALUSAGAP has no backing indicator for print blank (never invented).
 */

// ---- shared column schemes ----------------------------------------------
const WRA_HEADER = [
  [
    { t: "Indicators", rs: 2, c: "ind" },
    { t: "Age Group", cs: 3 },
    { t: "Total", rs: 2 },
    { t: "Remarks", rs: 2 },
  ],
  [{ t: "10-14" }, { t: "15-19" }, { t: "20-49" }],
];
const WRA_COLS = [
  { get: "label" },
  { get: "age:10-14" }, { get: "age:15-19" }, { get: "age:20-49" },
  { get: "total" }, { get: "remarks" },
];
const WRA_WIDTHS = [44, 9, 9, 9, 10, 19];

const SEX_HEADER = [
  [
    { t: "Indicators", rs: 2, c: "ind" },
    { t: "Sex", cs: 3 },
    { t: "Remarks", rs: 2 },
  ],
  [{ t: "Male" }, { t: "Female" }, { t: "Total" }],
];
const SEX_COLS = [
  { get: "label" },
  { get: "sex:Male" }, { get: "sex:Female" }, { get: "total" }, { get: "remarks" },
];
const SEX_WIDTHS = [48, 11, 11, 11, 19];

const TOT_HEADER = [[
  { t: "Indicators", c: "ind" }, { t: "Total" }, { t: "Remarks" },
]];
const TOT_COLS = [{ get: "label" }, { get: "total" }, { get: "remarks" }];
const TOT_WIDTHS = [60, 14, 26];

// ---- builders ------------------------------------------------------------
const section = (label) => ({ type: "section", label });
const group = (label) => ({ type: "group", label });
const twoCol = (left, right) => ({ type: "split", left, right });
const r = (code, label, indent = 0) => ({ code: code || null, label, indent });
const lbl = (label, indent = 0) => ({ code: null, label, indent });
// Pure category-heading row: shows the label but keeps its numeric cells empty
// (matches the merged heading rows on the official sheet).
const hd = (label, indent = 0) => ({ code: null, label, indent, heading: true });

const wra = (rows) => ({ type: "table", headerRows: WRA_HEADER, cols: WRA_COLS, widths: WRA_WIDTHS, rows });
const sex = (rows) => ({ type: "table", headerRows: SEX_HEADER, cols: SEX_COLS, widths: SEX_WIDTHS, rows });
const tot = (rows) => ({ type: "table", headerRows: TOT_HEADER, cols: TOT_COLS, widths: TOT_WIDTHS, rows });

// ===========================================================================
// SECTION A — FAMILY PLANNING SERVICES FOR WOMEN OF REPRODUCTIVE AGE
// ===========================================================================
const FP_GROUPS = [
  ["current_begin", "Current Users (Beginning of the Month)"],
  ["new_prev", "New Acceptors (Previous Month)"],
  ["other_present", "Other Acceptors (Present Month)"],
  ["dropout_present", "Drop-outs (Present Month)"],
  ["current_end", "Current User (End of the Month)"],
  ["new_present", "New Acceptors (Present Month)"],
];
const FP_HEADER = [
  [{ t: "Modern FP Methods", rs: 2, c: "ind" }, ...FP_GROUPS.map(([, t]) => ({ t, cs: 4 }))],
  FP_GROUPS.flatMap(() => [{ t: "10-14" }, { t: "15-19" }, { t: "20-49" }, { t: "TOTAL" }]),
];
const FP_COLS = [
  { get: "label" },
  ...FP_GROUPS.flatMap(([k]) => [
    { get: `measure:${k}:10-14` }, { get: `measure:${k}:15-19` },
    { get: `measure:${k}:20-49` }, { get: `measure:${k}:Total` },
  ]),
];
const FP_WIDTHS = [16, ...FP_GROUPS.flatMap(() => [3.5, 3.5, 3.5, 4])];
const FP_METHODS = [
  r("A2_btl", "1. BTL"),
  r("A2_nsv", "2. NSV"),
  r("A2_condom", "3. Condom"),
  lbl("4. Pills"),
  r("A2_pop", "a. Pills-POP", 1),
  r("A2_coc", "b. Pills-COC", 1),
  r("A2_dmpa", "5. Injectables (DMPA)"),
  r("A2_implant", "6. Implant"),
  lbl("a. Implants-Interval", 1),
  lbl("b. Implants-PP", 1),
  lbl("7. IUD"),
  r("A2_iud_i", "a. IUD-Interval", 1),
  r("A2_iud_pp", "b. IUD-PP", 1),
  r("A2_lam", "8. NFP-LAM"),
  r("A2_bbt", "9. NFP-BBT"),
  r("A2_cmm", "10. NFP-CMM"),
  r("A2_stm", "11. NFP-STM"),
  r("A2_sdm", "12. NFP-SDM"),
  r("A2_total", "Total Current Users"),
];

const sectionA = [
  section("SECTION A. FAMILY PLANNING SERVICES FOR WOMEN OF REPRODUCTIVE AGE"),
  group("Demand Satisfied"),
  wra([r("A1_1", "1. No. of women of reproductive age (WRA) 15-49 years old who have demand for Family Planning")]),
  { type: "table", headerRows: FP_HEADER, cols: FP_COLS, widths: FP_WIDTHS, rows: FP_METHODS },
];

// ===========================================================================
// SECTION B — MATERNAL CARE AND SERVICES
// ===========================================================================
const prenatalLeft = [
  group("PRENATAL CARE SERVICES"),
  wra([
    hd("1. 8ANC"),
    r("B1_1", "1a. No. of women who delivered and completed at least 8ANC = (a1+a2)", 1),
    lbl("a1. No. of women who delivered and provided 1st to 8th ANC on schedule (Resident)", 2),
    lbl("a2. No. of women who delivered and completed at least 8ANC TRANS-IN from other LGUs", 2),
    lbl("1b. No. of women who delivered and who were tracked during pregnancy = (b1+b2)", 1),
    lbl("b1. No. of women who delivered and who were tracked during pregnancy (Resident)", 2),
    lbl("b2. No. of TRANS-IN from other LGUs", 2),
    lbl("b3. No. of TRANS-OUT (with MOV) before completing 8ANC", 2),
    r("B1_2", "2. No. of pregnant women assessed for nutritional status during the first trimester"),
    r("B1_2a", "2a. Normal BMI", 1),
    r("B1_2b", "2b. Low BMI", 1),
    r("B1_2c", "2c. High BMI", 1),
    hd("3. Tetanus diphtheria (Td) Containing Vaccination Status"),
    r("B1_3", "3a. No. of women pregnant for the first time given at least 2 doses of Td vaccination", 1),
    r("B1_4", "3b. No. of pregnant women for the 2nd or more times given at least 3 doses of Td vaccination (Td2 Plus)", 1),
  ]),
];
const prenatalRight = [
  group("Prenatal Supplementation & Screening"),
  wra([
    hd("4. Prenatal Supplementation"),
    r("B1_5", "4a. No. of pregnant women who completed the dose of Iron with Folic Acid supplementation", 1),
    lbl("4b. No. of pregnant women who completed the dose of Multiple Micronutrient Supplementation", 1),
    r("B1_6", "4c. No. of pregnant women who completed the dose of Calcium carbonate", 1),
    hd("5. Anemia Screening"),
    r("B1_14", "5a. No. of pregnant women screened for Anemia", 1),
    r("B1_15", "5b. No. of pregnant women diagnosed with Anemia", 1),
    hd("6. Gestational Diabetes Screening"),
    r("B1_16", "6a. No. of pregnant women screened for Gestational Melitus", 1),
    r("B1_17", "6b. No. of pregnant women tested positive for Gestational Diabetes Melitus", 1),
    hd("7. Deworming"),
    r("B1_8", "7a. No. of pregnant women given one dose of deworming tablet", 1),
    hd("8. BP measurement"),
    lbl("8a. No. of pregnant women who had their BP measured during each of their antenatal care visit", 1),
    lbl("8b. No. of pregnant women with high BP or danger signs who were referred to a higher-level facility", 1),
  ]),
];
const intrapartumLeft = [
  group("INTRAPARTUM AND NEWBORN CARE"),
  wra([
    r("B2_18", "1. Total Deliveries"),
    r("B2_21", "2. No. of deliveries attended by Skilled Health Professionals (SHP) = (2a+2b+2c)"),
    r("B2_21a", "2a. Physicians", 1),
    r("B2_21b", "2b. Nurses", 1),
    r("B2_21c", "2c. Midwives", 1),
    r("B2_23", "3. No. of Facility Based Deliveries (FBD) = (3a+3b)"),
    r("B2_24a", "3a. Public facility", 1),
    r("B2_24b", "3b. Private facility", 1),
    lbl("4. Delivery by Type = (4a+4b+4c)"),
    r("B2_26a", "4a. No. of Vaginal deliveries", 1),
    r("B2_26b", "4b. No. of Cesarean Section", 1),
    lbl("4c. No. of Combined Vaginal-Cesarean deliveries", 1),
  ]),
];
const intrapartumRight = [
  group("Delivery Outcome & Birth Weight"),
  wra([
    lbl("5. Delivery by Outcome = (5a+5b+5c)"),
    r("B2_27a", "5a. No. of Full-Term deliveries", 1),
    r("B2_27b", "5b. No. of Pre-Term deliveries", 1),
    r("B2_27c", "5c. No. of Fetal deaths", 1),
    r("B2_27d", "5d. No. of abortion/miscarriage (counts only)", 1),
  ]),
  sex([
    r("B2_19", "6. No. of Livebirths by birth weight = (6a+6b+6c)"),
    r("B2_20a", "6a. Normal birth weight", 1),
    r("B2_20b", "6b. Low birth weight", 1),
    r("B2_20c", "6c. Unknown birth weight", 1),
  ]),
];
const postpartumLeft = [
  group("POSTPARTUM CARE"),
  wra([
    hd("1. 4PNC"),
    r("B3_28", "1a. Total No. of women who delivered and completed at least 4PNC = (a1+a2)", 1),
    lbl("a1. No. of women who delivered and provided 1st to 4th PNC on schedule (Resident)", 2),
    lbl("a2. No. of women delivered and completed at least 4PNC TRANS-IN from other LGUs", 2),
    lbl("1b. Total No. of women due for PNC = (b1+b2)", 1),
    lbl("b1. No. of women due for PNC (Resident)", 2),
    lbl("b2. No. of TRANS-IN from other LGUs due for PNC", 2),
    lbl("b3. No. of TRANS-OUT (with MOV) before completing 4PNC", 2),
  ]),
];
const postpartumRight = [
  group("Postpartum Supplementation & BP"),
  wra([
    hd("2. Postpartum Supplementation"),
    r("B3_29", "2a. No. of postpartum women who completed the dose of Iron with Folic Acid Supplementation", 1),
    r("B3_30", "2b. No. of postpartum women who completed the dose of Vitamin A supplementation", 1),
    hd("2. BP measurement"),
    lbl("8a. No. of postpartum women who had their BP measured during each of their antenatal care visit", 1),
    lbl("8b. No. of postpartum women with high BP or danger signs who were referred to a higher-level facility", 1),
  ]),
];
const sectionB = [
  section("SECTION B. MATERNAL CARE AND SERVICES"),
  twoCol(prenatalLeft, prenatalRight),
  twoCol(intrapartumLeft, intrapartumRight),
  twoCol(postpartumLeft, postpartumRight),
];

// ===========================================================================
// SECTION C — CHILD CARE AND SERVICES
// ===========================================================================
const immLeft = [
  group("IMMUNIZATION — A.1 Immunization Services (0-11 months old current year)"),
  sex([
    r("C1_1", "1. Children protected at birth (CPAB)"),
    r("C1_2", "2. BCG (within 24 hours)"),
    lbl("3. BCG (24 hours to 11 months and 29 days)"),
    r("C1_3", "4. Hep B antigen within 24 hrs after birth"),
    lbl("5. Hep B antigen more than 24 hrs up to 14 days"),
    r("C1_4", "6. DPT-HIB-HepB 1"),
    r("C1_5", "7. DPT-HIB-HepB 2"),
    r("C1_6", "8. DPT-HIB-HepB 3"),
    r("C1_7", "9. OPV 1"),
  ]),
];
const immRight = [
  group("Immunization (continued)"),
  sex([
    r("C1_8", "10. OPV 2"),
    r("C1_9", "11. OPV 3"),
    r("C1_10", "12. IPV 1"),
    lbl("13. IPV 2"),
    r("C1_11", "14. PCV 1"),
    r("C1_12", "15. PCV 2"),
    lbl("16. PCV 3"),
    r("C1_13", "17. MMR 1"),
  ]),
];
const immPrevLeft = [
  group("A.3 Immunization Services (0-11 months of previous year)"),
  sex([
    lbl("1. DPT-HIB-HepB 1"), lbl("2. DPT-HIB-HepB 2"), lbl("3. DPT-HIB-HepB 3"),
    lbl("4. OPV 1"), lbl("5. OPV 2"), lbl("6. OPV 3"), lbl("7. IPV 1"), lbl("8. IPV 2"),
  ]),
];
const immPrevRight = [
  group("A.3 (continued)"),
  sex([
    lbl("9. PCV 1"), lbl("10. PCV 2"), lbl("11. PCV 3"),
    r("C1_14", "12. MMR 2"), r("C1_15", "14. FIC"), r("C1_16", "15. CIC"),
  ]),
];
const schoolLeft = [
  group("A.4 School and Community-Based Immunization"),
  sex([
    r("C1_17", "1. Grade 1 learners given Td"),
    r("C1_18", "2. Grade 1 learners given MR"),
    r("C1_19", "3. Grade 7 learners given Td"),
    r("C1_20", "4. Grade 7 learners given MR"),
  ]),
];
const schoolRight = [
  group("A.4 (continued)"),
  sex([
    lbl("5. HPV 1 (SBI)"), lbl("6. HPV 1 (CBI)"), lbl("7. HPV 2 (CBI)"),
  ]),
];
const nutriLeft = [
  group("NUTRITION"),
  sex([
    r("C2_21", "1. Newborns who were initiated on breastfeeding within 1 hour after birth"),
    r("C2_22", "2. Infants born with low birth weight (LBW) given complete Iron supplements"),
    lbl("2. Infants born with low birth weight (LBW) given complete Iron supplements"),
    r("C2_28", "3a. Infants aged 6-11 months old who received 1 dose of Vitamin A supplementation"),
    r("C2_30", "3b. Children aged 12-59 months old who completed 2 doses of Vitamin A Supplementation"),
  ]),
];
const nutriRight = [
  group("Nutrition (continued)"),
  sex([
    r("C2_31", "4a. Infants aged 6-11 months old who completed routine MNP supplementation"),
    r("C2_33", "4b. Children aged 12-23 months old who completed routine MNP supplementation"),
    lbl("5a. Infants aged 6-11 months old who completed routine LNS-SQ supplementation"),
    lbl("5b. Children aged 12-23 months old who completed routine LNS-SQ supplementation"),
  ]),
];
const nutriStatusLeft = [
  group("Child Nutritional Status"),
  sex([
    lbl("6. Children 0-59 months old SEEN during the reporting period at health facilities"),
    r("C2_status_mam", "6a. Identified MAM"),
    r("C2_status_sam", "6b. Identified SAM"),
    lbl("7. MAM enrolled to SFP"),
    lbl("7a. Cured", 1), lbl("7b. Non-cured", 1), lbl("7c. Defaulted", 1), lbl("7d. Died", 1),
  ]),
];
const nutriStatusRight = [
  group("Child Nutritional Status (continued)"),
  sex([
    lbl("8. SAM without complication admitted to OTC"),
    lbl("8a. Cured", 1), lbl("8b. Non-cured", 1), lbl("8c. Defaulted", 1), lbl("8d. Died", 1),
  ]),
];
const sickLeft = [
  group("MANAGEMENT OF SICK"),
  sex([
    r("C4_36", "1. Sick infants aged 6-11 months old seen"),
    r("C4_37", "1a. Sick infants aged 6-11 months old who received Vitamin A capsule aside from routine supplementation"),
    r("C4_38", "2. Sick infants aged 12-59 months old seen"),
    r("C4_39", "2a. Sick infants aged 12-59 months old who received Vitamin A capsule aside from routine supplementation"),
    r("C4_40", "3. Acute diarrhea cases 0-59 months old seen"),
  ]),
];
const sickRight = [
  group("Management of Sick (continued)"),
  sex([
    r("C4_41", "3a. 0-59 months old with acute diarrhea who received ORS only"),
    r("C4_42", "3b. 0-59 months old with acute diarrhea who received ORS and Zinc drops/syrup"),
    r("C4_43", "4. Pneumonia cases 0-59 months old seen"),
    r("C4_44", "4a. 0-59 months old with pneumonia who received antibiotic treatment"),
  ]),
];
const sectionC = [
  section("SECTION C. CHILD CARE AND SERVICES"),
  twoCol(immLeft, immRight),
  twoCol(immPrevLeft, immPrevRight),
  twoCol(schoolLeft, schoolRight),
  twoCol(nutriLeft, nutriRight),
  twoCol(nutriStatusLeft, nutriStatusRight),
  twoCol(sickLeft, sickRight),
];

// ===========================================================================
// SECTION D — ORAL HEALTH CARE SERVICES
// ===========================================================================
const oralPop = (visit, prof) => [
  lbl(`Infants 0-11 months old who had their ${visit}`),
  lbl(`Children 1-4 years old who had their ${prof}`),
  lbl("a. facility-based oral health care professional", 1),
  lbl("b. non-facility-based oral health care professional", 1),
  lbl(`Children 5-9 years old who had their ${prof}`),
  lbl(`Adolescents 10-19 years old who had their ${prof}`),
  lbl(`Adults 20-59 years old who had their ${prof}`),
  lbl(`Senior Citizens 60 years old and above who had their ${prof}`),
];
const sectionD = [
  section("SECTION D. ORAL HEALTH CARE SERVICES"),
  twoCol(
    [group("FIRST VISIT TO AN ORAL HEALTH CARE PROFESSIONAL"),
      sex(oralPop("first dental visit", "1st visit to an oral health care professional within a year"))],
    [group("COMPLETED 2 VISITS TO AN ORAL HEALTH CARE PROFESSIONAL"),
      sex(oralPop("completed 2 visits", "2 visits to an oral health care professional within a year"))],
  ),
  twoCol(
    [group("Pregnant Women — First Visit"),
      wra([lbl("Pregnant Women who had their 1st visit to an oral health care professional within a year")])],
    [group("Pregnant Women — Completed 2 Visits"),
      wra([lbl("Pregnant Women who completed 2 visits to an oral health care professional within a year")])],
  ),
];

// ===========================================================================
// SECTION E — NON-COMMUNICABLE DISEASES
// ===========================================================================
const ncdLeft = [
  group("E1. Lifestyle Related"),
  sex([
    r("F_1", "1. Adults 20-59 years old who were risk assessed using the PhilPEN protocol"),
    r("F_2", "1a. Current Smokers"),
    lbl("a. Tobacco Products", 1),
    lbl("b. Vaporized Nicotine Products", 1),
    lbl("c. Both", 1),
    lbl("1b. Provided Brief Tobacco Intervention"),
    r("F_3", "1c. Binge Drinker"),
    lbl("1d. Insufficient physical activities"),
    lbl("1e. Consumed unhealthy diet"),
    r("F_4", "1f. Overweight"),
    lbl("1g. Obese"),
  ]),
];
const ncdRight = [
  group("E1. Lifestyle Related — Senior Citizens"),
  sex([
    lbl("2. Senior Citizens 60 years old and above who were risk assessed using the PhilPEN protocol"),
    lbl("2a. Current Smokers"),
    lbl("a. Tobacco Products", 1),
    lbl("b. Vaporized Nicotine Products", 1),
    lbl("c. Both", 1),
    lbl("2b. Provided Brief Tobacco Intervention"),
    lbl("2c. Binge Drinker"),
    lbl("2d. Insufficient physical activities"),
    lbl("2e. Consumed unhealthy diet"),
    lbl("2f. Overweight"),
    lbl("2g. Obese"),
  ]),
];
const cvdLeft = [
  group("E2. Cardiovascular Disease Prevention and Control"),
  sex([
    lbl("The total number of identified adult (20-59 years old) hypertensives (Sum of January to Previous Month)"),
    lbl("The total number of identified adult (20-59 years old) hypertensives in the current month"),
    r("F_9", "1. Adults 20-59 years old who were identified as hypertensive using the PhilPEN protocol"),
    lbl("2. Hypertensives 20-59 years old provided with antihypertensive medications"),
    lbl("2a. Provided by facility (100%)", 1),
    lbl("2b. Out of pocket", 1),
    lbl("2c. Both", 1),
  ]),
];
const dmRight = [
  group("E3. Diabetes Mellitus Prevention and Control"),
  sex([
    lbl("The total number of identified adult (20-59 years old) with Type II Diabetes (Sum of January to Previous Month)"),
    lbl("The total number of identified adult (20-59 years old) with Type II Diabetes in the current month"),
    r("F_10", "1. Adults 20-59 years old who were identified with Type II Diabetes using the PhilPEN protocol"),
    lbl("2. Type II Diabetics 20-59 years old provided with antidiabetic medications"),
    lbl("2a. Provided by facility (100%)", 1),
    lbl("2b. Out of pocket", 1),
    lbl("2c. Both", 1),
  ]),
];
const eyeLeft = [
  group("E4. Blindness Prevention Program"),
  sex([
    lbl("1. Screened for eye disease/s"),
    lbl("1a. 0-9 years old screened for eye disease/s", 1),
    lbl("1b. 10-19 years old screened for eye disease/s", 1),
    lbl("1c. 20-59 years old screened for eye disease/s", 1),
    lbl("1d. 60 years old and above screened for eye disease/s", 1),
    r("F_12", "2. Screened and identified with eye disease/s"),
    lbl("3. Identified with eye disease/s and referred to an eye health professional"),
  ]),
];
const eyeRight = [
  group("E5. Immunization for Senior Citizens"),
  sex([
    lbl("1. Senior Citizens Seen who had not previously received PPV upon reaching 60 years old"),
    r("F_13", "2. Senior citizens aged 60 years old and above who received one (1) dose of Pneumococcal Polysaccharide Vaccine"),
    r("F_11", "3. Senior Citizens Seen"),
    r("F_14", "4. Senior citizens aged 60 years old and above who received one (1) dose of Influenza Vaccine"),
  ]),
];
const cancerLeft = [
  group("E8. Cervical Cancer Prevention and Control Services"),
  tot([
    r("F_5", "1. Women aged 30-65 years old screened or assessed for cervical cancer"),
    lbl("1a. VIA", 1),
    lbl("2a. PapSmear", 1),
    lbl("3a. HPV DNA", 1),
    lbl("4a. Assessed Only", 1),
    r("F_6", "2. Women aged 30-65 years old found suspicious for cervical cancer"),
    lbl("3. Women aged 30-65 years old found suspicious for cervical cancer and linked to care"),
    lbl("4. Women aged 30-65 years old found positive for precancerous lesions"),
    lbl("5. Women aged 30-65 years old found positive for precancerous lesions and linked to care"),
  ]),
];
const cancerRight = [
  group("E9. Breast Cancer Prevention and Control Services"),
  tot([
    r("F_7", "1. Number of 30-69 years old women seen"),
    r("F_8", "2. Number of high-risk or symptomatic women"),
    lbl("3. High-risk or symptomatic women aged 30-69 provided with Breast Cancer Early Detection Services"),
    lbl("3a. Clinical Breast Examination", 1),
    lbl("3b. Mammogram", 1),
    lbl("6. Asymptomatic women aged 50-69 years old screened for breast cancer"),
    lbl("6a. Clinical Breast Examination", 1),
    lbl("6b. Mammogram", 1),
  ]),
];
const sectionE = [
  section("SECTION E. NON-COMMUNICABLE DISEASES"),
  twoCol(ncdLeft, ncdRight),
  twoCol(cvdLeft, dmRight),
  twoCol(eyeLeft, eyeRight),
  twoCol(cancerLeft, cancerRight),
];

// ===========================================================================
// SECTION F — ENVIRONMENTAL HEALTH AND SANITATION
// ===========================================================================
const sectionF = [
  section("SECTION F. ENVIRONMENTAL HEALTH AND SANITATION"),
  twoCol(
    [group("G1. Water"),
      tot([
        r("G_1", "1. Households (HHs) with access to improved water supply - Total"),
        r("G_1_1", "1a. HH with Level I", 1),
        r("G_1_2", "1b. HH with Level II", 1),
        r("G_1_3", "1c. HH with Level III", 1),
        r("G_2", "2. HH using safely managed drinking water service"),
      ])],
    [group("G1. Sanitation"),
      tot([
        r("G_3", "1. HH with basic sanitation facility - Total"),
        r("G_3_1", "1a. HH with pour/flush toilet connected to a septic tank", 1),
        r("G_3_2", "1b. HHs with pour/flush toilet connected to community sewer/sewerage system or any other approved treatment system", 1),
        r("G_3_3", "1c. HH with Ventilated Improved Pit (VIP) Latrine", 1),
        r("G_4", "2. HH using safely managed sanitation service"),
      ])],
  ),
];

// ===========================================================================
// SECTION G — INFECTIOUS DISEASE PREVENTION AND CONTROL
// ===========================================================================
const rabiesLeft = [
  group("B. Rabies"),
  sex([
    lbl("1. Category I Rabies exposure"),
    lbl("1a. No. of Category I Rabies exposure", 1),
    lbl("2. Category II Rabies exposure"),
    r("E8_1", "2a. No. of Category II Rabies exposure", 1),
    lbl("3. Category II Eligible for Anti-Rabies Vaccine (ARV)"),
    lbl("4. Category II Rabies exposure who received complete dose of Anti-Rabies Vaccine (ARV)"),
    lbl("5. Category III Rabies exposure"),
  ]),
];
const rabiesRight = [
  group("B. Rabies (continued)"),
  sex([
    lbl("6. Category III Rabies exposure who received complete"),
    lbl("6a. complete doses of ARV and RIG", 1),
    lbl("6b. complete doses of anti-rabies vaccines (Booster)", 1),
    lbl("6c. WITHOUT history of complete anti-rabies vaccine", 1),
    lbl("6d. WITH history of complete anti-rabies vaccine", 1),
    lbl("7. Dog-mediated and cat-mediated Rabies exposure"),
    lbl("7a. Dog", 1), lbl("7b. Cat", 1), lbl("7c. Others", 1),
    r("E8_2", "Deaths due to rabies"),
  ]),
];
const filariasisLeft = [
  group("A. Filariasis"),
  sex([
    lbl("1. No. of individual examined and found positive for lymphatic filariasis"),
    lbl("1a. Nocturnal Blood Examination", 1),
    lbl("1b. Rapid Diagnostic Test", 1),
    lbl("2. Lymphedema and/or Elephentiasis"),
    lbl("2a. No. of individuals examined with lymphedema", 1),
    lbl("2b. No. of individuals examined with Elephentiasis", 1),
  ]),
];
const filariasisRight = [
  group("A. Filariasis (continued)"),
  sex([
    lbl("3. Hydrocele"),
    lbl("3a. No. of individuals examined with Hydrocele", 1),
    r("E1_1", "4. Number of individuals who received Mass Drug Administration"),
    lbl("4a. 2-4 years old", 1),
    lbl("4b. 5-14 years old", 1),
    lbl("4c. 15 years old and above", 1),
  ]),
];
const schistoLeft = [
  group("C. Schistosomiasis"),
  sex([
    r("E2_1", "1. Patients Seen"),
    r("E2_2", "2. Clinical/Suspected Schistosomiasis Cases Seen"),
    lbl("3. Clinical/Suspected Schistosomiasis Cases Treated"),
    lbl("4. Clinical/Suspected Schistosomiasis Cases Cured"),
    r("E2_7", "5. Confirmed Schistosomiasis Cases"),
    r("E2_8", "6. Confirmed Schistosomiasis Cases Treated"),
    r("E2_9", "8. Confirmed Schistosomiasis Cases Referred"),
  ]),
];
const sthRight = [
  group("D. Soil-Transmitted Helminthiasis / Deworming"),
  sex([
    lbl("1. Screened for STH"),
    lbl("2. Suspected Cases of STH"),
    lbl("3. Confirmed STH Cases"),
    lbl("4. Confirmed STH Cases Treated"),
    r("C3_35b", "5. 1-4 years old / 5-14 years old who were dewormed during January MDA"),
    lbl("5a. School-Based deworming services", 1),
    lbl("5b. Community Based services", 1),
    r("C3_35c", "9. 15-19 yrs old who were dewormed during January MDA"),
  ]),
];
const leprosyLeft = [
  group("E. Leprosy"),
  sex([
    r("E7_1", "1. No. of Leprosy Cases on treatment"),
    r("E7_2", "2. No. of newly detected case"),
    lbl("3. Confirmed Leprosy Cases"),
    lbl("4. Completed fixed duration Multi-Drug Therapy (MDT)"),
    lbl("5. No. of confirmed leprosy cases treated"),
    lbl("6. Newly Detected Cases with Grade 2 Disabilities"),
  ]),
];
const hivRight = [
  group("F. HIV-AIDS/STI"),
  sex([
    r("B1_9", "1. Pregnant women screened for syphilis - Total"),
    r("B1_10", "2. Pregnant women screened reactive for syphilis - Total"),
    lbl("3. Pregnant women treated for syphilis - Total"),
    r("B1_13", "4. Pregnant women screened for HIV - Total"),
    lbl("5. Pregnant women screened reactive for HIV - Total"),
    r("B1_11", "6. Pregnant women screened for Hepatitis B - Total"),
    r("B1_12", "7. Pregnant women screened reactive for Hepatitis B - Total"),
  ]),
];
const sectionG = [
  section("SECTION G. INFECTIOUS DISEASE PREVENTION AND CONTROL SERVICES"),
  twoCol(filariasisLeft, filariasisRight),
  twoCol(rabiesLeft, rabiesRight),
  twoCol(schistoLeft, sthRight),
  twoCol(leprosyLeft, hivRight),
];

// ===========================================================================
// SECTION H — VITAL STATISTICS (Mortality & Natality)
// ===========================================================================
const vitalLeft = [
  group("Part I. Mortality"),
  wra([
    lbl("1. Maternal Mortality - Total"),
    r("H1_2", "a. Direct", 1),
    lbl("a1. Resident", 2),
    lbl("a2. Non-Resident", 2),
    lbl("b. Indirect", 1),
    lbl("b1. Resident", 2),
    lbl("b2. Non-Resident", 2),
    r("H1_4", "2. Infant Mortality"),
  ]),
];
const vitalRight = [
  group("Part II. Natality"),
  sex([
    r("H2_1", "1. Live births (Total)"),
    lbl("1a. Resident", 1),
    lbl("1b. Non-Resident", 1),
    lbl("2. Adolescent Birth"),
    lbl("2a. <10 years old", 1),
    lbl("2b. 10-14 years old", 1),
    lbl("2c. 15-19 years old", 1),
    lbl("3. Repeat Adolescent Birth"),
    lbl("3a. 10-14 years old", 1),
    lbl("3b. 15-19 years old", 1),
  ]),
];
const sectionVital = [
  section("SECTION H. VITAL STATISTICS"),
  twoCol(vitalLeft, vitalRight),
];

export const M1_FORM_TEMPLATE = [
  ...sectionA,
  ...sectionB,
  ...sectionC,
  ...sectionD,
  ...sectionE,
  ...sectionF,
  ...sectionG,
  ...sectionVital,
];

export default { M1_FORM_TEMPLATE };
