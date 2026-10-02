# FHSIS M1 — Complete Indicator Source Audit

Generated from the single source of truth, `backend/src/config/m1Catalog.js`
(served at `GET /m1/catalog` as `sourceMapping`). Every one of the
178 M1 indicators is accounted for: each has an authoritative source
(operational table or manual reporting), the exact source fields, and the
aggregation rule. No indicator is left without a source, so a report value of 0
always means "zero qualifying records", never "no way to obtain this".

| # | Indicator | Name | Type | Source Table | Source Fields | Aggregation |
|---|-----------|------|------|--------------|---------------|-------------|
| 1 | A1_1 | Women of reproductive age with unmet need for modern family planning | Operational (FP event) | m1_records | indicator_code, record_date, value, detail.measure, resident_id | count distinct residents |
| 2 | A2_btl | Female Sterilization / BTL | Operational (FP event) | m1_records | indicator_code, record_date, value, detail.measure, resident_id | current users (begin + new + other − dropout, or end-of-month) |
| 3 | A2_nsv | Male Sterilization / NSV | Operational (FP event) | m1_records | indicator_code, record_date, value, detail.measure, resident_id | current users (begin + new + other − dropout, or end-of-month) |
| 4 | A2_condom | Condom | Operational (FP event) | m1_records | indicator_code, record_date, value, detail.measure, resident_id | current users (begin + new + other − dropout, or end-of-month) |
| 5 | A2_pop | Pills — POP | Operational (FP event) | m1_records | indicator_code, record_date, value, detail.measure, resident_id | current users (begin + new + other − dropout, or end-of-month) |
| 6 | A2_coc | Pills — COC | Operational (FP event) | m1_records | indicator_code, record_date, value, detail.measure, resident_id | current users (begin + new + other − dropout, or end-of-month) |
| 7 | A2_dmpa | Injectables — DMPA/POI | Operational (FP event) | m1_records | indicator_code, record_date, value, detail.measure, resident_id | current users (begin + new + other − dropout, or end-of-month) |
| 8 | A2_implant | Implant | Operational (FP event) | m1_records | indicator_code, record_date, value, detail.measure, resident_id | current users (begin + new + other − dropout, or end-of-month) |
| 9 | A2_iud_i | IUD — Interval (IUD-I) | Operational (FP event) | m1_records | indicator_code, record_date, value, detail.measure, resident_id | current users (begin + new + other − dropout, or end-of-month) |
| 10 | A2_iud_pp | IUD — Post-Partum (IUD-PP) | Operational (FP event) | m1_records | indicator_code, record_date, value, detail.measure, resident_id | current users (begin + new + other − dropout, or end-of-month) |
| 11 | A2_lam | NFP — LAM | Operational (FP event) | m1_records | indicator_code, record_date, value, detail.measure, resident_id | current users (begin + new + other − dropout, or end-of-month) |
| 12 | A2_bbt | NFP — BBT | Operational (FP event) | m1_records | indicator_code, record_date, value, detail.measure, resident_id | current users (begin + new + other − dropout, or end-of-month) |
| 13 | A2_cmm | NFP — CMM | Operational (FP event) | m1_records | indicator_code, record_date, value, detail.measure, resident_id | current users (begin + new + other − dropout, or end-of-month) |
| 14 | A2_stm | NFP — STM | Operational (FP event) | m1_records | indicator_code, record_date, value, detail.measure, resident_id | current users (begin + new + other − dropout, or end-of-month) |
| 15 | A2_sdm | NFP — SDM | Operational (FP event) | m1_records | indicator_code, record_date, value, detail.measure, resident_id | current users (begin + new + other − dropout, or end-of-month) |
| 16 | A2_total | Total Current Users (all methods, End of Month) | Operational (FP event) | m1_records | indicator_code, record_date, value, detail.measure, resident_id | current users (begin + new + other − dropout, or end-of-month) |
| 17 | A3_1 | Women 20-49 years old given 2 doses of deworming drugs | Operational (FP event) | m1_records | indicator_code, record_date, value, detail.measure, resident_id | count distinct residents |
| 18 | B1_1 | Pregnant women with at least 4 prenatal check-ups | Manual | m1_manual_entries | value, age_group, sex | sum |
| 19 | B1_2 | Pregnant women assessed for nutritional status during the first trimester | Manual | m1_manual_entries | value, age_group, sex | sum |
| 20 | B1_2a | First-trimester pregnant women with normal BMI | Manual | m1_manual_entries | value, age_group, sex | sum |
| 21 | B1_2b | First-trimester pregnant women with low BMI | Manual | m1_manual_entries | value, age_group, sex | sum |
| 22 | B1_2c | First-trimester pregnant women with high BMI | Manual | m1_manual_entries | value, age_group, sex | sum |
| 23 | B1_3 | Pregnant women (first time) given at least 2 doses of Td | Manual | m1_manual_entries | value, age_group, sex | sum |
| 24 | B1_4 | Pregnant women (second+) given at least 3 doses of Td / Td2 Plus | Manual | m1_manual_entries | value, age_group, sex | sum |
| 25 | B1_5 | Pregnant women who completed iron with folic acid supplementation | Derived | maternal_records | iron_folic_completed_date | count |
| 26 | B1_6 | Pregnant women who completed calcium carbonate supplementation | Manual | m1_manual_entries | value, age_group, sex | sum |
| 27 | B1_7 | Pregnant women given iodine capsules | Manual | m1_manual_entries | value, age_group, sex | sum |
| 28 | B1_8 | Pregnant women given one dose of deworming tablet | Manual | m1_manual_entries | value, age_group, sex | sum |
| 29 | B1_9 | Pregnant women screened for syphilis | Manual | m1_manual_entries | value, age_group, sex | sum |
| 30 | B1_10 | Pregnant women tested positive for syphilis | Manual | m1_manual_entries | value, age_group, sex | count |
| 31 | B1_11 | Pregnant women screened for Hepatitis B | Manual | m1_manual_entries | value, age_group, sex | sum |
| 32 | B1_12 | Pregnant women tested positive for Hepatitis B | Manual | m1_manual_entries | value, age_group, sex | count |
| 33 | B1_13 | Pregnant women screened for HIV | Manual | m1_manual_entries | value, age_group, sex | sum |
| 34 | B1_14 | Pregnant women tested for CBC or Hgb/Hct count | Manual | m1_manual_entries | value, age_group, sex | sum |
| 35 | B1_15 | Pregnant women tested for CBC or Hgb/Hct diagnosed with anemia | Manual | m1_manual_entries | value, age_group, sex | count |
| 36 | B1_16 | Pregnant women screened for gestational diabetes | Manual | m1_manual_entries | value, age_group, sex | sum |
| 37 | B1_17 | Pregnant women tested positive for gestational diabetes | Manual | m1_manual_entries | value, age_group, sex | count |
| 38 | B2_18 | Number of deliveries | Derived | maternal_records | delivery_date | count |
| 39 | B2_19 | Number of live births | Derived | maternal_records | delivery_date, delivery_outcome | count |
| 40 | B2_20a | Live births with normal birth weight | Derived | maternal_records | delivery_date, delivery_outcome, birth_weight | count |
| 41 | B2_20b | Live births with low birth weight | Derived | maternal_records | delivery_date, delivery_outcome, birth_weight | count |
| 42 | B2_20c | Live births with unknown birth weight | Derived | maternal_records | delivery_date, delivery_outcome, birth_weight | count |
| 43 | B2_21 | Deliveries attended by skilled health professionals | Derived | maternal_records | delivery_date, birth_attendant | count |
| 44 | B2_21a | Deliveries attended by a Doctor | Derived | maternal_records | delivery_date, birth_attendant | count |
| 45 | B2_21b | Deliveries attended by a Nurse | Derived | maternal_records | delivery_date, birth_attendant | count |
| 46 | B2_21c | Deliveries attended by a Midwife | Derived | maternal_records | delivery_date, birth_attendant | count |
| 47 | B2_22 | Deliveries attended by non-skilled health professionals | Derived | maternal_records | delivery_date, birth_attendant | count |
| 48 | B2_22a | Deliveries attended by Hilot/TBA | Derived | maternal_records | delivery_date, birth_attendant | count |
| 49 | B2_22b | Deliveries attended by others | Derived | maternal_records | delivery_date, birth_attendant | count |
| 50 | B2_23 | Health facility-based deliveries | Derived | maternal_records | delivery_date, place_of_delivery | count |
| 51 | B2_24a | Deliveries in a public health facility | Derived | maternal_records | delivery_date, place_of_delivery | count |
| 52 | B2_24b | Deliveries in a private health facility | Derived | maternal_records | delivery_date, place_of_delivery | count |
| 53 | B2_25 | Non-facility-based deliveries | Derived | maternal_records | delivery_date, place_of_delivery | count |
| 54 | B2_26a | Vaginal deliveries | Derived | maternal_records | delivery_date, type_of_delivery | count |
| 55 | B2_26b | Deliveries by cesarean section | Derived | maternal_records | delivery_date, type_of_delivery | count |
| 56 | B2_27a | Full-term births | Manual | m1_manual_entries | value, age_group, sex | count |
| 57 | B2_27b | Pre-term births | Manual | m1_manual_entries | value, age_group, sex | count |
| 58 | B2_27c | Fetal deaths | Manual | m1_manual_entries | value, age_group, sex | count |
| 59 | B2_27d | Abortion / miscarriage | Manual | m1_manual_entries | value, age_group, sex | count |
| 60 | B3_28 | Postpartum women + newborn who completed at least 2 postpartum check-ups | Derived | maternal_records | pp_checkup_24h, pp_checkup_day3, pp_checkup_7_14d, pp_checkup_6wk | count |
| 61 | B3_29 | Postpartum women who completed iron with folic acid supplementation | Manual | m1_manual_entries | value, age_group, sex | sum |
| 62 | B3_30 | Postpartum women with Vitamin A supplementation | Derived | maternal_records | vitamin_a_given_date | count |
| 63 | C1_1 | CPAB | Derived | immunizations | vaccine, administered_date, status | count |
| 64 | C1_2 | BCG | Derived | immunizations | vaccine, administered_date, status | count |
| 65 | C1_3 | HepB within 24 hours | Derived | immunizations | vaccine, administered_date, status | count |
| 66 | C1_4 | DPT-Hib-HepB (Penta) 1 | Derived | immunizations | vaccine, administered_date, status | count |
| 67 | C1_5 | DPT-Hib-HepB (Penta) 2 | Derived | immunizations | vaccine, administered_date, status | count |
| 68 | C1_6 | DPT-Hib-HepB (Penta) 3 | Derived | immunizations | vaccine, administered_date, status | count |
| 69 | C1_7 | OPV 1 | Derived | immunizations | vaccine, administered_date, status | count |
| 70 | C1_8 | OPV 2 | Derived | immunizations | vaccine, administered_date, status | count |
| 71 | C1_9 | OPV 3 | Derived | immunizations | vaccine, administered_date, status | count |
| 72 | C1_10 | IPV | Derived | immunizations | vaccine, administered_date, status | count |
| 73 | C1_11 | PCV 1 | Derived | immunizations | vaccine, administered_date, status | count |
| 74 | C1_12 | PCV 2 | Derived | immunizations | vaccine, administered_date, status | count |
| 75 | C1_13 | MCV 1 | Derived | immunizations | vaccine, administered_date, status | count |
| 76 | C1_14 | MCV 2 | Derived | immunizations | vaccine, administered_date, status | count |
| 77 | C1_15 | FIC (Fully Immunized Child) | Derived | immunizations | vaccine, administered_date, status | count |
| 78 | C1_16 | CIC (Completely Immunized Child) | Derived | immunizations | vaccine, administered_date, status | count |
| 79 | C1_17 | Td, Grade 1 (November) | Derived | immunizations | vaccine, administered_date, status | count |
| 80 | C1_18 | MR, Grade 1 (November) | Derived | immunizations | vaccine, administered_date, status | count |
| 81 | C1_19 | Td, Grade 7 (November) | Derived | immunizations | vaccine, administered_date, status | count |
| 82 | C1_20 | MR, Grade 7 (November) | Derived | immunizations | vaccine, administered_date, status | count |
| 83 | C2_21 | Newborns initiated on breastfeeding within 90 minutes of birth | Manual | m1_manual_entries | value, age_group, sex | count |
| 84 | C2_22 | Preterm/LBW infants given iron supplementation | Manual | m1_manual_entries | value, age_group, sex | count |
| 85 | C2_23 | Infants 6 months old seen | Manual | m1_manual_entries | value, age_group, sex | count |
| 86 | C2_24 | Infants exclusively breastfed until the 6th month | Manual | m1_manual_entries | value, age_group, sex | count |
| 87 | C2_25 | Infants 6 months initiated to complementary feeding WITH continued breastfeeding | Manual | m1_manual_entries | value, age_group, sex | count |
| 88 | C2_26 | Infants 6 months initiated to complementary feeding, no longer/never breastfed | Manual | m1_manual_entries | value, age_group, sex | count |
| 89 | C2_27 | Infants 6-11 months old seen | Manual | m1_manual_entries | value, age_group, sex | count |
| 90 | C2_28 | Infants 6-11 months given 1 dose Vitamin A 100,000 IU | Manual | m1_manual_entries | value, age_group, sex | count |
| 91 | C2_29 | Children 12-59 months old seen | Manual | m1_manual_entries | value, age_group, sex | count |
| 92 | C2_30 | Children 12-59 months given 2 doses Vitamin A 200,000 IU | Manual | m1_manual_entries | value, age_group, sex | count |
| 93 | C2_31 | Infants 6-11 months who completed MNP supplementation | Manual | m1_manual_entries | value, age_group, sex | count |
| 94 | C2_32 | Children 12-23 months old seen | Manual | m1_manual_entries | value, age_group, sex | count |
| 95 | C2_33 | Children 12-23 months who completed MNP supplementation | Manual | m1_manual_entries | value, age_group, sex | count |
| 96 | C2_status_mam | Children with Moderate Acute Malnutrition (MAM) | Manual | m1_manual_entries | value, age_group, sex | count |
| 97 | C2_status_sam | Children with Severe Acute Malnutrition (SAM) | Manual | m1_manual_entries | value, age_group, sex | count |
| 98 | C2_status_overweight | Children Overweight/Obese | Manual | m1_manual_entries | value, age_group, sex | count |
| 99 | C2_status_normal | Children with Normal nutritional status | Manual | m1_manual_entries | value, age_group, sex | count |
| 100 | C3_35 | 1-19 year olds given 2 doses of deworming drug | Manual | m1_manual_entries | value, age_group, sex | count |
| 101 | C3_35a | PSAC 1-4 years old dewormed with 2 doses | Manual | m1_manual_entries | value, age_group, sex | count |
| 102 | C3_35b | SAC 5-9 years old dewormed with 2 doses | Manual | m1_manual_entries | value, age_group, sex | count |
| 103 | C3_35c | Adolescents 10-19 years old dewormed with 2 doses | Manual | m1_manual_entries | value, age_group, sex | count |
| 104 | C4_36 | Sick infants 6-11 months old seen | Manual | m1_manual_entries | value, age_group, sex | count |
| 105 | C4_37 | Sick infants 6-11 months old who received Vitamin A | Manual | m1_manual_entries | value, age_group, sex | count |
| 106 | C4_38 | Sick children 12-59 months old seen | Manual | m1_manual_entries | value, age_group, sex | count |
| 107 | C4_39 | Sick children 12-59 months old who received Vitamin A | Manual | m1_manual_entries | value, age_group, sex | count |
| 108 | C4_40 | Diarrhea cases 0-59 months old seen | Manual | m1_manual_entries | value, age_group, sex | count |
| 109 | C4_41 | Diarrhea cases 0-59 months old who received ORS | Manual | m1_manual_entries | value, age_group, sex | count |
| 110 | C4_42 | Diarrhea cases 0-59 months old who received ORS with zinc | Manual | m1_manual_entries | value, age_group, sex | count |
| 111 | C4_43 | Pneumonia cases 0-59 months old seen | Manual | m1_manual_entries | value, age_group, sex | count |
| 112 | C4_44 | Pneumonia cases 0-59 months old who completed treatment | Manual | m1_manual_entries | value, age_group, sex | count |
| 113 | D_1 | Children 12-59 months orally fit upon examination or after rehabilitation | Manual | m1_manual_entries | value, age_group, sex | count |
| 114 | D_2 | Clients 5 years old and above with DMFT (Decayed-Missing-Filled Teeth) | Manual | m1_manual_entries | value, age_group, sex | count |
| 115 | D_3 | Infants 0-11 months who received Basic Oral Health Care (BOHC) | Manual | m1_manual_entries | value, age_group, sex | count |
| 116 | D_4 | Children 1-4 years old who received BOHC | Manual | m1_manual_entries | value, age_group, sex | count |
| 117 | D_5 | Children 5-9 years old who received BOHC | Manual | m1_manual_entries | value, age_group, sex | count |
| 118 | D_6 | Adolescents 10-14 years old who received BOHC | Manual | m1_manual_entries | value, age_group, sex | count |
| 119 | D_7 | Adolescents 15-19 years old who received BOHC | Manual | m1_manual_entries | value, age_group, sex | count |
| 120 | D_8 | Adults 20-59 years old who received BOHC | Manual | m1_manual_entries | value, age_group, sex | count |
| 121 | D_9 | Senior citizens 60 years old and above who received BOHC | Manual | m1_manual_entries | value, age_group, sex | count |
| 122 | D_10 | Pregnant women who received BOHC | Manual | m1_manual_entries | value, age_group, sex | count |
| 123 | E1_1 | Filariasis cases/mass drug administration (annual) | Manual | m1_manual_entries | value, age_group, sex | count |
| 124 | E2_1 | Patients seen | Manual | m1_manual_entries | value, age_group, sex | count |
| 125 | E2_2 | Suspected cases seen | Manual | m1_manual_entries | value, age_group, sex | count |
| 126 | E2_3 | Acute clinically diagnosed cases | Manual | m1_manual_entries | value, age_group, sex | count |
| 127 | E2_4 | Confirmed acute cases | Manual | m1_manual_entries | value, age_group, sex | count |
| 128 | E2_5 | Chronic clinically diagnosed cases | Manual | m1_manual_entries | value, age_group, sex | count |
| 129 | E2_6 | Confirmed chronic cases | Manual | m1_manual_entries | value, age_group, sex | count |
| 130 | E2_7 | Confirmed cases (acute and chronic) | Manual | m1_manual_entries | value, age_group, sex | count |
| 131 | E2_8 | Cases treated | Manual | m1_manual_entries | value, age_group, sex | count |
| 132 | E2_9 | Confirmed chronic cases referred to a hospital facility | Manual | m1_manual_entries | value, age_group, sex | count |
| 133 | E5_1 | Notified TB cases, all forms | Manual | m1_manual_entries | value, age_group, sex | count |
| 134 | E5_2 | Registered bacteriologically-confirmed DR-TB / RR-MDR-TB cases | Manual | m1_manual_entries | value, age_group, sex | count |
| 135 | E5_3 | TB (all forms) cured and completely treated | Manual | m1_manual_entries | value, age_group, sex | count |
| 136 | E5_4 | DR-TB / RR-MDR-TB cases cured and completed treatment | Manual | m1_manual_entries | value, age_group, sex | count |
| 137 | E6_1 | Probable/clinically-diagnosed malaria and confirmed cases | Manual | m1_manual_entries | value, age_group, sex | count |
| 138 | E6_2 | Laboratory-confirmed malaria deaths | Manual | m1_manual_entries | value, age_group, sex | count |
| 139 | E7_1 | Leprosy cases on treatment during the reporting period | Manual | m1_manual_entries | value, age_group, sex | count |
| 140 | E7_2 | Newly detected leprosy cases during the reporting period | Manual | m1_manual_entries | value, age_group, sex | count |
| 141 | E8_1 | Animal bite cases | Manual | m1_manual_entries | value, age_group, sex | count |
| 142 | E8_2 | Deaths due to rabies | Manual | m1_manual_entries | value, age_group, sex | count |
| 143 | F_1 | Adults risk-assessed using the NCD risk-assessment protocol | Manual | m1_manual_entries | value, age_group, sex | count distinct residents |
| 144 | F_2 | Current smokers | Manual | m1_manual_entries | value, age_group, sex | count |
| 145 | F_3 | Alcohol binge drinkers | Manual | m1_manual_entries | value, age_group, sex | count |
| 146 | F_4 | Overweight/Obese | Manual | m1_manual_entries | value, age_group, sex | count |
| 147 | F_5 | Adult women screened for cervical cancer (VIA/Pap smear/approved method) | Manual | m1_manual_entries | value, age_group, sex | count distinct residents |
| 148 | F_6 | Adult women found positive/suspect for cervical cancer | Manual | m1_manual_entries | value, age_group, sex | count |
| 149 | F_7 | Adult women screened for breast mass | Manual | m1_manual_entries | value, age_group, sex | count distinct residents |
| 150 | F_8 | Adult women with suspicious breast mass | Manual | m1_manual_entries | value, age_group, sex | count |
| 151 | F_9 | Newly identified hypertensive adults | Manual | m1_manual_entries | value, age_group, sex | count |
| 152 | F_10 | Newly identified adults with Type 2 Diabetes Mellitus | Manual | m1_manual_entries | value, age_group, sex | count |
| 153 | F_11 | Senior citizens screened for visual acuity | Manual | m1_manual_entries | value, age_group, sex | count distinct residents |
| 154 | F_12 | Senior citizens diagnosed with eye disease(s) | Manual | m1_manual_entries | value, age_group, sex | count |
| 155 | F_13 | Senior citizens who received one dose of PPV | Manual | m1_manual_entries | value, age_group, sex | count |
| 156 | F_14 | Senior citizens who received one dose of influenza vaccine | Manual | m1_manual_entries | value, age_group, sex | count |
| 157 | G_1 | Households with access to basic safe water supply | Derived | households | water_source | count distinct residents |
| 158 | G_1_1 | Households with Level I water supply | Derived | households | water_source | count distinct residents |
| 159 | G_1_2 | Households with Level II water supply | Derived | households | water_source | count distinct residents |
| 160 | G_1_3 | Households with Level III water supply | Derived | households | water_source | count distinct residents |
| 161 | G_2 | Households using safely managed drinking-water services | Derived | households | water_treated, water_source | count distinct residents |
| 162 | G_3 | Households with a basic sanitation facility | Derived | households | toilet_type | count distinct residents |
| 163 | G_3_1 | Households with pour/flush toilet connected to septic tank | Derived | households | toilet_type | count distinct residents |
| 164 | G_3_2 | Households with pour/flush toilet connected to a sewer/approved treatment | Derived | households | toilet_type | count distinct residents |
| 165 | G_3_3 | Households with a ventilated improved pit (VIP) latrine | Derived | households | toilet_type | count distinct residents |
| 166 | G_4 | Households using safely managed sanitation services | Derived | households | toilet_type | count distinct residents |
| 167 | G_5 | Industrial establishments issued with a sanitary permit | Manual | m1_manual_entries | value, age_group, sex | count |
| 168 | G_6 | Barangays declared Zero Open Defecation (ZOD) | Manual | m1_manual_entries | value, age_group, sex | count |
| 169 | H1_1 | Total deaths | Derived | household_member_health_profiles | date_of_death, member.sex | count |
| 170 | H1_2 | Maternal deaths | Manual | m1_manual_entries | value, age_group, sex | count |
| 171 | H1_3 | Under-five deaths | Manual | m1_manual_entries | value, age_group, sex | count |
| 172 | H1_4 | Infant deaths | Manual | m1_manual_entries | value, age_group, sex | count |
| 173 | H1_5 | Neonatal deaths | Manual | m1_manual_entries | value, age_group, sex | count |
| 174 | H1_6 | Fetal deaths | Manual | m1_manual_entries | value, age_group, sex | count |
| 175 | H1_7 | Early neonatal deaths | Manual | m1_manual_entries | value, age_group, sex | count |
| 176 | H1_8 | Perinatal deaths | Manual | m1_manual_entries | value, age_group, sex | count |
| 177 | H1_detail | Mortality by underlying cause (ICD-10) | Manual | m1_manual_entries | value, age_group, sex | count |
| 178 | H2_1 | Live births (by mother's age group) | Manual | m1_manual_entries | value, age_group, sex | count |

## Totals by source

- `m1_records`: 17
- `m1_manual`: 109
- `maternal_records`: 21
- `immunizations`: 20
- `households`: 10
- `household_member_health_profiles`: 1
