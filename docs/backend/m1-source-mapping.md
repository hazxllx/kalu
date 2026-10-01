# FHSIS M1 — Indicator Source Mapping

Every indicator shown in the KALUSAGAP M1 report has exactly **one** documented
data source. Monthly, Quarterly and Annual reports are reporting **views** over
the same underlying records: a quarter aggregates its three months and a year
aggregates its twelve, through a single aggregation path
(`backend/src/services/m1.service.js` → `aggregateOverRange`). The on-screen
official form and the exported PDF both read the same `GET /m1/report`
(`byCode`) result, so they can never diverge.

## Data flow

```
OPERATIONAL RECORDS                         MANUAL M1 DATA
(maternal_records, immunizations,           (m1_manual_entries,
 households, member mortality)               m1_records FP events)
        \                                          /
         \________________  _____________________/
                          \/
             INDICATOR SOURCE MAPPING  (config/m1Catalog.js: `source` + `derive`)
                          |
             REPORTING PERIOD FILTER   (month / quarter / year range)
                          |
          MONTHLY / QUARTERLY / ANNUAL AGGREGATION  (m1.service.js)
                          |
                     M1 SUMMARY (byCode)
                          |
                   FHSIS M1 PDF (official form renderer)
```

The machine-readable mapping is served at `GET /m1/catalog` as `sourceMapping`
(and `manual` lists the manual indicators). It is generated from the single
source of truth, `backend/src/config/m1Catalog.js`.

## Source types (178 indicators)

| Source | Count | Meaning | Populated by |
| --- | ---: | --- | --- |
| `maternal_records` | 21 | Derived from the maternal case record | New / Edit Maternal Record |
| `immunizations` | 20 | Derived from recorded immunizations | Immunization records |
| `households` | 10 | Derived from household WASH fields | Household profiling |
| `household_member_health_profiles` | 1 | Derived from recorded member mortality | Member health profile |
| `m1_records` | 17 | Per-event store (Section A family planning) | FP service events |
| `m1_manual` | 109 | Manual aggregate M1 figures | **Record M1 Data** screen |

No indicator has two sources, so an event is never counted twice (SOURCE
PRIORITY / NO DUPLICATE DATA ENTRY). The manual-entry API refuses any indicator
that is derived from an operational table.

## Section B (Maternal) mapping

Derived indicators are computed from `maternal_records` and must **not** be
entered on the M1 Data Entry screen; the maternal case is the single input.

| Indicator | Source | Rule |
| --- | --- | --- |
| B1_5 iron/folic (prenatal) | `maternal_records` | `iron_folic_completed_date` in the month; by mother's age band |
| B2_18 deliveries | `maternal_records` | `delivery_date` in the month |
| B2_19 live births | `maternal_records` | `delivery_date` + `delivery_outcome = Live Birth` |
| B2_20a/b/c birth weight | `maternal_records` | live births split by `birth_weight` (≥2.5 / <2.5 / unknown) |
| B2_21 / 21a-c skilled attendant | `maternal_records` | `birth_attendant` ∈ Doctor/Nurse/Midwife |
| B2_22 / 22a-b non-skilled | `maternal_records` | `birth_attendant` ∈ Hilot(TBA)/Other |
| B2_23 / 24a / 24b / 25 place | `maternal_records` | `place_of_delivery` public / private / non-facility |
| B2_26a / 26b type | `maternal_records` | `type_of_delivery` Vaginal / Cesarean |
| B3_28 ≥2 postpartum check-ups | `maternal_records` | 2nd postpartum check-up date in the month |
| B3_30 postpartum Vitamin A | `maternal_records` | `vitamin_a_given_date` in the month |
| B1_1..B1_4, B1_2a-c, B1_6..B1_17 | `m1_manual` | screenings / Td / supplementation not in the maternal case |
| B2_27a-d (full/pre-term, fetal death, abortion) | `m1_manual` | not stored in the maternal case |
| B3_29 postpartum iron/folic | `m1_manual` | no maternal field distinct from the prenatal one |

The remaining prenatal/clinical maternal input indicators required by the M1
form (Td vaccination, calcium, iodine, deworming, syphilis / Hep B / HIV /
anemia / gestational-diabetes screening and results) are `m1_manual`, so the
Health Supervisor has a real place to enter them on the **Record M1 Data**
screen.

## Manual M1 data entry

`Record M1 Data` (on the Maternal Record page, separate from New Maternal
Record) writes to `public.m1_manual_entries`, one row per
`(barangay, indicator, year, month, age_group, sex)`. Re-saving a value updates
the row in place (unique key) instead of duplicating it, so an edit immediately
changes the Monthly report and the Quarter / Year totals that include that
month. Values are stored by the indicator's age bands (10–14 / 15–19 / 20–49),
by sex (Male / Female), or as a single Total; the report Total is always the sum
of the stored buckets. Remarks are stored in `m1_indicator_remarks` (shared with
the derived indicators).

Empty indicators report `0` — no value is fabricated or inferred from unrelated
fields.
