/**
 * KALUSAGAP — M1 Maternal Health Monthly Reporting Form (data mapping).
 *
 * This module turns the barangay-scoped `maternal_records` rows the M1 page
 * already loads (via `maternalApi.list()` → mapRecord view shape) into the
 * COMPLETE FHSIS M1 "Maternal Care and Services" monthly reporting form model:
 * every section, every indicator row, every age column, totals and remarks —
 * regardless of whether a value is zero.
 *
 * Design rules (see task spec):
 *  - The form structure is fixed and reproduced in full. Rows are NEVER dropped
 *    because their value happens to be 0.
 *  - Every populated value is DERIVED from real record fields. Nothing is
 *    fabricated. Indicators that have no defensible source in the KALUSAGAP
 *    maternal data model are still printed, at 0, with a "no source field"
 *    remark so the omission is explicit rather than silent.
 *  - Reporting population is the cumulative case-load as of the reporting
 *    period end (cases that existed by then), which is the standard M1
 *    accomplishment/coverage semantics. "Newly registered" and "continuing"
 *    are split by the record's first-recorded date.
 *
 * The output model is consumed by the jsPDF official-form renderer
 * (`m1Report.js`) and is intentionally render-agnostic.
 */

export const AGE_BANDS = ["10-14", "15-19", "20-49"];

const MONTH_LABELS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const NO_SOURCE = "No underlying field in maternal records";

const lower = (v) => String(v ?? "").trim().toLowerCase();
const has = (v) => v !== undefined && v !== null && String(v).trim() !== "";

const toDate = (v) => {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
};

/** Reporting-period boundaries (local dates). month is 0-11; null for annual. */
const periodBounds = ({ period, year, month }) => {
  if (period === "annual" || month == null) {
    return { start: new Date(year, 0, 1), end: new Date(year, 11, 31, 23, 59, 59, 999) };
  }
  return {
    start: new Date(year, month, 1),
    end: new Date(year, month + 1, 0, 23, 59, 59, 999),
  };
};

/** Mother's age (years) as of the reporting-period end. */
const ageAsOf = (birthDate, refDate) => {
  const b = toDate(birthDate);
  if (!b) return null;
  let a = refDate.getFullYear() - b.getFullYear();
  const m = refDate.getMonth() - b.getMonth();
  if (m < 0 || (m === 0 && refDate.getDate() < b.getDate())) a -= 1;
  return a >= 0 ? a : null;
};

/** Map an age to an FHSIS women-of-reproductive-age band. Every case lands in a
 *  band so that TOTAL === sum of the three age columns. */
const bandOf = (age) => {
  if (age == null) return "20-49"; // unknown DOB → default WRA band
  if (age < 15) return "10-14";
  if (age <= 19) return "15-19";
  return "20-49";
};

const bmiOf = (v) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
};

/** Birth weight in kilograms parsed from free text ("3.2 kg", "2500g", "3200"). */
const birthWeightKg = (v) => {
  if (!has(v)) return null;
  const s = String(v).toLowerCase();
  const m = s.match(/[\d.]+/);
  if (!m) return null;
  let n = parseFloat(m[0]);
  if (!Number.isFinite(n)) return null;
  if (/\bg\b|gram|grm/.test(s) && !/kg/.test(s)) n = n / 1000; // grams
  else if (n > 100) n = n / 1000; // bare grams like 3200
  return n;
};

const isDelivery = (r) =>
  lower(r.status) === "delivered" ||
  has(r.typeOfDelivery) || has(r.placeOfDelivery) || has(r.birthAttendant) || has(r.birthWeight);

const ppCheckupCount = (r) =>
  [r.ppCheckup24h, r.ppCheckupDay3, r.ppCheckup7to14d, r.ppCheckup6wk].filter(has).length;

const attendant = (r) => lower(r.birthAttendant);
const place = (r) => lower(r.placeOfDelivery);
const delType = (r) => lower(r.typeOfDelivery);

const isSkilled = (r) => /doctor|physician|\bmd\b|\bob\b|nurse|midwife|\bmw\b/.test(attendant(r));
const isFacility = (r) => /rhu|hospital|health|clinic|center|centre|facility|lying|infirmary|birthing/.test(place(r));
const isHome = (r) => /home|house|residence|bahay/.test(place(r));

/** PRENATAL follow-up target used by the existing M1 page (m1Analytics). */
const PRENATAL_TARGET = 8;

// ---------------------------------------------------------------------------
// Aggregation primitives
// ---------------------------------------------------------------------------

/** Age-banded tally of records matching `pred`. Returns { byAge, total }. */
const tallyByAge = (records, pred) => {
  const byAge = { "10-14": 0, "15-19": 0, "20-49": 0 };
  let total = 0;
  for (const r of records) {
    if (!pred(r)) continue;
    byAge[r._band] = (byAge[r._band] || 0) + 1;
    total += 1;
  }
  return { byAge, total };
};

/** Simple count of records matching `pred`. */
const count = (records, pred) => records.reduce((n, r) => n + (pred(r) ? 1 : 0), 0);

// Row builders --------------------------------------------------------------

const ageRow = (records, code, name, pred, opts = {}) => {
  const { byAge, total } = tallyByAge(records, pred);
  return { code, name, type: "age", byAge, total, remarks: opts.remarks || "", highlight: !!opts.highlight };
};

/** Age-banded row with no defensible source: printed at 0 with an explicit remark. */
const ageZero = (code, name, remarks = NO_SOURCE) => ({
  code, name, type: "age", byAge: { "10-14": 0, "15-19": 0, "20-49": 0 }, total: 0, remarks, highlight: false,
});

const countRow = (records, code, name, pred, opts = {}) => ({
  code, name, type: "count", total: count(records, pred), remarks: opts.remarks || "", highlight: !!opts.highlight,
});

const countZero = (code, name, remarks = NO_SOURCE) => ({
  code, name, type: "count", total: 0, remarks, highlight: false,
});

// ---------------------------------------------------------------------------
// Public builder
// ---------------------------------------------------------------------------

/**
 * Build the complete M1 Maternal Health form model.
 * @param {Array} rawRecords  mapped maternal_records (camelCase view shape)
 * @param {object} ctx { period:'monthly'|'annual', year, month(0-11), barangay, municipality, facility, province }
 */
export const buildM1MaternalForm = (rawRecords, ctx = {}) => {
  const { period = "monthly", year = new Date().getFullYear(), month = new Date().getMonth() } = ctx;
  const { start, end } = periodBounds({ period, year, month });

  // Reporting population: cases that existed by the period end (cumulative
  // caseload). Records with no recorded date are conservatively included.
  const scoped = (Array.isArray(rawRecords) ? rawRecords : []).filter((r) => {
    const d = toDate(r.recordedAt);
    return !d || d <= end;
  });

  // Annotate each record with its age band once.
  const caseload = scoped.map((r) => ({ ...r, _band: bandOf(ageAsOf(r.residentBirthDate, end)) }));

  const isNew = (r) => {
    const d = toDate(r.recordedAt);
    return d && d >= start && d <= end;
  };
  const isContinuing = (r) => {
    const d = toDate(r.recordedAt);
    return !d || d < start;
  };

  // ----- Referral linkage (public.health_referrals) -------------------------
  // A maternal referral is defensibly a referral whose resident is a maternal
  // client in the current caseload (matched by resident_id). This lets the M1
  // populate F1 from the real health_referrals table instead of a hardcoded 0.
  // The maternal record has no direct FK to health_referrals, but resident_id
  // is a stable, unambiguous join key present on both tables.
  const maternalResidentIds = new Set(caseload.map((r) => r.residentId).filter(Boolean));
  const highRiskResidentIds = new Set(
    caseload.filter((r) => lower(r.risk) === "high").map((r) => r.residentId).filter(Boolean),
  );
  const referralsRaw = Array.isArray(ctx.referrals) ? ctx.referrals : [];
  const referralInPeriod = (ref) => {
    const d = toDate(ref.referral_date || ref.referralDate || ref.created_at || ref.createdAt);
    return d && d >= start && d <= end;
  };
  const referralResidentId = (ref) => ref.resident_id ?? ref.residentId ?? ref.resident?.id ?? null;
  const maternalReferrals = referralsRaw.filter(
    (ref) => referralInPeriod(ref) && maternalResidentIds.has(referralResidentId(ref)),
  );
  const maternalReferralsCount = maternalReferrals.length;
  const highRiskReferralsCount = maternalReferrals.filter(
    (ref) => highRiskResidentIds.has(referralResidentId(ref)),
  ).length;
  const referralsAvailable = referralsRaw.length > 0 || ctx.referralsLoaded === true;

  const periodLabel = period === "monthly" ? `${MONTH_LABELS[month]} ${year}` : `Annual ${year}`;

  // ----- Section headers + fillable identification fields -------------------
  const header = {
    title: "Field Health Services Information System (FHSIS)",
    formTitle: "Monthly Form M1 — Maternal Care and Services",
    systemLabel: "KALUSAGAP · Community Health Risk Monitoring and Early Intervention System",
    fields: [
      { label: "Region", value: ctx.region || "" },
      { label: "Province", value: ctx.province || "" },
      { label: "Municipality / City", value: ctx.municipality || "" },
      { label: "Barangay", value: ctx.barangay || "" },
      { label: "Health Facility / BHS", value: ctx.facility || "" },
      { label: "Reporting Month", value: period === "monthly" ? MONTH_LABELS[month] : "January–December" },
      { label: "Reporting Year", value: String(year) },
      { label: "Projected Population", value: ctx.projectedPopulation || "" },
      { label: "Prepared by", value: ctx.preparedBy || "" },
      { label: "Designation", value: ctx.designation || "" },
    ],
    periodLabel,
  };

  // =========================================================================
  // A. MATERNAL / PREGNANCY REGISTRATION AND CASELOAD
  // =========================================================================
  const sectionRegistration = {
    key: "A",
    title: "MATERNAL / PREGNANCY REGISTRATION AND CASELOAD",
    tables: [
      {
        subtitle: "A1. Registration",
        type: "age",
        rows: [
          ageRow(caseload, "A1.1", "Total maternal clients (caseload as of period end)", () => true, { highlight: true }),
          ageRow(caseload, "A1.2", "Newly registered maternal clients this reporting period", isNew),
          ageRow(caseload, "A1.3", "Continuing / previously registered maternal clients", isContinuing),
        ],
      },
      {
        subtitle: "A2. Risk Classification",
        type: "age",
        rows: [
          ageRow(caseload, "A2.1", "Low-risk pregnancies", (r) => lower(r.risk) === "low"),
          ageRow(caseload, "A2.2", "Moderate-risk pregnancies", (r) => lower(r.risk) === "moderate"),
          ageRow(caseload, "A2.3", "High-risk pregnancies identified", (r) => lower(r.risk) === "high", { highlight: true }),
        ],
      },
      {
        subtitle: "A3. Case Status",
        type: "age",
        rows: [
          ageRow(caseload, "A3.1", "Active / under monitoring", (r) => lower(r.status) === "active"),
          ageRow(caseload, "A3.2", "Delivered", (r) => lower(r.status) === "delivered"),
          ageRow(caseload, "A3.3", "Transferred", (r) => lower(r.status) === "transferred"),
          ageRow(caseload, "A3.4", "Inactive", (r) => lower(r.status) === "inactive"),
        ],
      },
    ],
  };

  // =========================================================================
  // B. PRENATAL / ANTENATAL CARE  (FHSIS Section B1)
  // =========================================================================
  const sectionPrenatal = {
    key: "B",
    title: "PRENATAL / ANTENATAL CARE",
    tables: [
      {
        subtitle: "B1. Prenatal Care",
        type: "age",
        rows: [
          ageRow(caseload, "B1.0", "Pregnant women with at least 1 prenatal check-up", (r) => (Number(r.prenatalVisits) || 0) >= 1),
          ageRow(caseload, "B1.1", "Pregnant women with at least 4 prenatal check-ups", (r) => (Number(r.prenatalVisits) || 0) >= 4, { highlight: true }),
          ageRow(caseload, "B1.2", "Pregnant women assessed for nutritional status (BMI recorded)", (r) => bmiOf(r.bmi) != null),
          ageRow(caseload, "B1.2a", "  — with normal BMI (18.5–22.9)", (r) => { const b = bmiOf(r.bmi); return b != null && b >= 18.5 && b < 23; }),
          ageRow(caseload, "B1.2b", "  — with low BMI (<18.5)", (r) => { const b = bmiOf(r.bmi); return b != null && b < 18.5; }),
          ageRow(caseload, "B1.2c", "  — with high BMI (>=23.0)", (r) => { const b = bmiOf(r.bmi); return b != null && b >= 23; }),
          ageZero("B1.3", "Pregnant women (first time) given at least 2 doses of Td"),
          ageZero("B1.4", "Pregnant women given at least 3 doses of Td / Td2 Plus"),
          ageRow(caseload, "B1.5", "Pregnant women who completed iron with folic acid supplementation", (r) => has(r.ironFolicCompletedDate)),
          ageZero("B1.6", "Pregnant women who completed calcium carbonate supplementation"),
          ageZero("B1.7", "Pregnant women given iodine capsules"),
          ageZero("B1.8", "Pregnant women given one dose of deworming tablet"),
          ageZero("B1.9", "Pregnant women screened for syphilis"),
          ageZero("B1.10", "Pregnant women tested positive for syphilis"),
          ageZero("B1.11", "Pregnant women screened for Hepatitis B"),
          ageZero("B1.12", "Pregnant women tested positive for Hepatitis B"),
          ageZero("B1.13", "Pregnant women screened for HIV"),
          ageZero("B1.14", "Pregnant women tested for CBC or Hgb/Hct count"),
          ageZero("B1.15", "Pregnant women diagnosed with anemia"),
          ageZero("B1.16", "Pregnant women screened for gestational diabetes"),
          ageZero("B1.17", "Pregnant women tested positive for gestational diabetes"),
        ],
      },
    ],
  };

  // =========================================================================
  // C. INTRAPARTUM CARE AND DELIVERY OUTCOME  (FHSIS Section B2)
  // =========================================================================
  const deliveries = caseload.filter(isDelivery);
  const sectionDelivery = {
    key: "C",
    title: "INTRAPARTUM CARE AND DELIVERY OUTCOME",
    tables: [
      {
        subtitle: "C1. Deliveries and Birth Outcome",
        type: "count",
        rows: [
          countRow(caseload, "B2.18", "Number of deliveries", isDelivery, { highlight: true, remarks: "Deliveries documented on the maternal record" }),
          { code: "B2.19", name: "Number of live births", type: "count", total: 0, remarks: "No live-birth field; not derivable from deliveries (a delivery may not be a live birth)", highlight: false },
          countRow(deliveries, "B2.20a", "Deliveries with recorded normal birth weight (>=2.5 kg)", (r) => { const w = birthWeightKg(r.birthWeight); return w != null && w >= 2.5; }, { remarks: "Birth-weight distribution of documented deliveries" }),
          countRow(deliveries, "B2.20b", "Deliveries with recorded low birth weight (<2.5 kg)", (r) => { const w = birthWeightKg(r.birthWeight); return w != null && w < 2.5; }, { remarks: "Birth-weight distribution of documented deliveries" }),
          countRow(deliveries, "B2.20c", "Deliveries with unknown birth weight", (r) => birthWeightKg(r.birthWeight) == null),
          countRow(deliveries, "B2.21", "Deliveries attended by skilled health professionals", isSkilled, { highlight: true }),
          countRow(deliveries, "B2.21a", "  — attended by a Doctor", (r) => /doctor|physician|\bmd\b|\bob\b/.test(attendant(r))),
          countRow(deliveries, "B2.21b", "  — attended by a Nurse", (r) => /nurse/.test(attendant(r))),
          countRow(deliveries, "B2.21c", "  — attended by a Midwife", (r) => /midwife|\bmw\b/.test(attendant(r))),
          countRow(deliveries, "B2.22", "Deliveries attended by non-skilled attendants", (r) => has(r.birthAttendant) && !isSkilled(r)),
          countRow(deliveries, "B2.22a", "  — attended by Hilot / TBA", (r) => /hilot|tba|traditional/.test(attendant(r))),
          countRow(deliveries, "B2.22b", "  — attended by others", (r) => has(r.birthAttendant) && !isSkilled(r) && !/hilot|tba|traditional/.test(attendant(r))),
          countRow(deliveries, "B2.23", "Health facility-based deliveries", isFacility, { highlight: true }),
          countRow(deliveries, "B2.24a", "  — in a public health facility", (r) => isFacility(r) && !/private/.test(place(r))),
          countRow(deliveries, "B2.24b", "  — in a private health facility", (r) => isFacility(r) && /private/.test(place(r))),
          countRow(deliveries, "B2.25", "Non-facility-based deliveries", (r) => isHome(r) || (has(r.placeOfDelivery) && !isFacility(r))),
          countRow(deliveries, "B2.26a", "Vaginal deliveries", (r) => /normal|vaginal|nsd|spontaneous|svd/.test(delType(r))),
          countRow(deliveries, "B2.26b", "Deliveries by cesarean section", (r) => /cesarean|caesarean|c-?section|\bcs\b|lscs/.test(delType(r))),
          countZero("B2.27a", "Full-term births", "No gestational-age field in maternal records"),
          countZero("B2.27b", "Pre-term births", "No gestational-age field in maternal records"),
          countZero("B2.27c", "Fetal deaths"),
          countZero("B2.27d", "Abortion / miscarriage"),
        ],
      },
    ],
  };

  // =========================================================================
  // D. POSTPARTUM AND NEWBORN CARE  (FHSIS Section B3)
  // =========================================================================
  const sectionPostpartum = {
    key: "D",
    title: "POSTPARTUM AND NEWBORN CARE",
    tables: [
      {
        subtitle: "D1. Postpartum Care",
        type: "age",
        rows: [
          ageRow(caseload, "B3.28", "Postpartum women who completed at least 2 postpartum check-ups", (r) => ppCheckupCount(r) >= 2, { highlight: true }),
          ageRow(caseload, "B3.29", "Postpartum women who completed iron with folic acid supplementation", (r) => has(r.ironFolicCompletedDate)),
          ageRow(caseload, "B3.30", "Postpartum women with Vitamin A supplementation", (r) => has(r.vitaminAGivenDate)),
        ],
      },
      {
        subtitle: "D2. Postpartum Check-up Coverage (by visit)",
        type: "age",
        rows: [
          ageRow(caseload, "D2.1", "Check-up done within 24 hours after delivery", (r) => has(r.ppCheckup24h)),
          ageRow(caseload, "D2.2", "Check-up done on day 3", (r) => has(r.ppCheckupDay3)),
          ageRow(caseload, "D2.3", "Check-up done between 7–14 days", (r) => has(r.ppCheckup7to14d)),
          ageRow(caseload, "D2.4", "Check-up done at 6 weeks", (r) => has(r.ppCheckup6wk)),
        ],
      },
    ],
  };

  // =========================================================================
  // E. MATERNAL OUTCOMES
  // =========================================================================
  const sectionOutcomes = {
    key: "E",
    title: "MATERNAL OUTCOMES",
    tables: [
      {
        subtitle: "E1. Outcomes",
        type: "count",
        rows: [
          countRow(caseload, "E1.1", "Total deliveries", isDelivery),
          { code: "E1.2", name: "Live births", type: "count", total: 0, remarks: "No live-birth field; not derivable from deliveries", highlight: false },
          countRow(caseload, "E1.3", "Facility-based deliveries", (r) => isDelivery(r) && isFacility(r)),
          countRow(caseload, "E1.4", "Deliveries by skilled attendant", (r) => isDelivery(r) && isSkilled(r)),
          countZero("E1.5", "Maternal deaths"),
          countZero("E1.6", "Fetal deaths"),
          countZero("E1.7", "Abortion / miscarriage"),
        ],
      },
    ],
  };

  // =========================================================================
  // F. REFERRALS / FOLLOW-UP / MONITORING
  // =========================================================================
  const sectionReferrals = {
    key: "F",
    title: "REFERRALS / FOLLOW-UP / MONITORING",
    tables: [
      {
        subtitle: "F1. Referrals and Follow-up",
        type: "count",
        rows: [
          {
            code: "F1.1", name: "Maternal clients referred", type: "count", total: maternalReferralsCount,
            remarks: referralsAvailable
              ? "From health_referrals joined on resident_id (referrals of maternal-caseload residents in period)"
              : "health_referrals not loaded for this view; source table exists",
            highlight: true,
          },
          {
            code: "F1.2", name: "High-risk maternal clients referred", type: "count", total: highRiskReferralsCount,
            remarks: referralsAvailable
              ? "Referred residents whose maternal record risk = High"
              : "health_referrals not loaded for this view; source table exists",
            highlight: false,
          },
          countRow(caseload, "F1.3", "Cases with follow-up due (active, prenatal check-ups < 8)",
            (r) => lower(r.status) === "active" && (Number(r.prenatalVisits) || 0) < PRENATAL_TARGET, { highlight: true }),
          countRow(caseload, "F1.4", "Cases lost to follow-up / inactive", (r) => lower(r.status) === "inactive"),
        ],
      },
    ],
  };

  // =========================================================================
  // G. NATALITY (FHSIS Section H2) — live births by mother's age group
  // =========================================================================
  const sectionNatality = {
    key: "G",
    title: "NATALITY",
    tables: [
      {
        subtitle: "G1. Live Births by Mother's Age Group",
        type: "age",
        rows: [
          ageZero("H2.1", "Live births (by mother's age group)", "No live-birth field; not derivable from deliveries"),
        ],
      },
    ],
  };

  // =========================================================================
  // H. OTHER MATERNAL PROGRAM INDICATORS (health / lifestyle profile)
  // =========================================================================
  const sectionOther = {
    key: "H",
    title: "OTHER MATERNAL PROGRAM INDICATORS",
    tables: [
      {
        subtitle: "H1. Health / Lifestyle Profile of Maternal Clients",
        type: "age",
        rows: [
          ageRow(caseload, "H1.1", "With history of smoking", (r) => r.smokingHistory === true),
          ageRow(caseload, "H1.2", "Binge alcohol drinker", (r) => r.bingeAlcohol === true),
          ageRow(caseload, "H1.3", "Insufficient physical activity", (r) => r.insufficientPhysicalActivity === true),
          ageRow(caseload, "H1.4", "Consumed unhealthy diet", (r) => r.unhealthyDiet === true),
        ],
      },
    ],
  };

  const sections = [
    sectionRegistration,
    sectionPrenatal,
    sectionDelivery,
    sectionPostpartum,
    sectionOutcomes,
    sectionReferrals,
    sectionNatality,
    sectionOther,
  ];

  return {
    header,
    sections,
    meta: {
      caseloadCount: caseload.length,
      generatedAt: new Date(),
      period,
      year,
      month,
      barangay: ctx.barangay || "",
    },
  };
};

export default { buildM1MaternalForm, AGE_BANDS };
