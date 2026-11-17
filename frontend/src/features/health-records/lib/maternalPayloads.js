export function computeEddFromLmp(lmpValue) {
  if (!lmpValue) return null;
  const parsed = new Date(lmpValue);
  if (Number.isNaN(parsed.getTime())) return null;
  const edd = new Date(parsed.getTime() + 280 * 24 * 60 * 60 * 1000);
  return edd.toISOString().split("T")[0];
}

function normalizeOptionalNumber(value) {
  if (value === "" || value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isNaN(parsed) ? null : parsed;
}

/**
 * Builds the create payload when registering a new maternal pregnancy record.
 */
export function buildCreateMaternalPayload(form) {
  const lmp = form.lmp || null;
  return {
    lmp,
    edd: computeEddFromLmp(lmp),
    prenatal_visits: 0,
    risk: form.risk || "Low",
    status: "Active",
    provider: "",
    notes: form.notes || "",
    date_of_registration: form.dateOfRegistration || null,
    family_serial_no: "",
    socio_economic_status: form.socioEconomicStatus || "",
    gravida: normalizeOptionalNumber(form.gravida),
    para: normalizeOptionalNumber(form.para),
    tt_td_doses: {},
    fim_status: null,
    prenatal_micronutrients: {},
    iodine_given_date: null,
    deworming_date: null,
    syphilis_screen_date: null,
    syphilis_result: "",
    hepb_screen_date: null,
    hepb_result: "",
    hiv_screen_date: null,
    gdm_screen_date: null,
    gdm_result: "",
    cbc_screen_date: null,
    cbc_result: "",
    cbc_iron_given: null,
    pregnancy_outcome: "",
    pregnancy_outcome_date: null,
    newborn_sex: "",
    type_of_delivery: "",
    delivery_date: null,
    delivery_time: "",
    delivery_outcome: "",
    birth_weight: "",
    birth_weight_class: "",
    place_of_delivery: "",
    birth_attendant: "",
    pp_checkup_24h: null,
    pp_checkup_day3: null,
    pp_checkup_7_14d: null,
    pp_checkup_6wk: null,
    iron_folic_completed_date: null,
    vitamin_a_given_date: null,
    smoking_history: null,
    binge_alcohol: null,
    insufficient_physical_activity: null,
    unhealthy_diet: null,
    bmi: null,
  };
}

/**
 * Builds a partial update payload containing ONLY changed pregnancy header
 * fields so existing prenatal visits, TT/Td doses, screenings, delivery,
 * postpartum, and other clinical milestones remain untouched.
 */
export function buildEditMaternalHeaderPatch(form, editingRecord) {
  const patch = {};
  const existing = editingRecord || {};

  const nextLmp = form.lmp || null;
  const prevLmp = existing.lmp || null;
  if (nextLmp !== prevLmp) {
    patch.lmp = nextLmp;
    patch.edd = computeEddFromLmp(nextLmp);
  }

  const nextRisk = form.risk || "Low";
  const prevRisk = existing.risk || "Low";
  if (nextRisk !== prevRisk) {
    patch.risk = nextRisk;
  }

  const nextNotes = form.notes ?? "";
  const prevNotes = existing.notes ?? "";
  if (nextNotes !== prevNotes) {
    patch.notes = nextNotes;
  }

  const nextRegDate = form.dateOfRegistration || null;
  const prevRegDate = existing.dateOfRegistration || null;
  if (nextRegDate !== prevRegDate) {
    patch.date_of_registration = nextRegDate;
  }

  const nextSes = form.socioEconomicStatus || "";
  const prevSes = existing.socioEconomicStatus || "";
  if (nextSes !== prevSes) {
    patch.socio_economic_status = nextSes;
  }

  const nextGravida = normalizeOptionalNumber(form.gravida);
  const prevGravida = normalizeOptionalNumber(existing.gravida);
  if (nextGravida !== prevGravida) {
    patch.gravida = nextGravida;
  }

  const nextPara = normalizeOptionalNumber(form.para);
  const prevPara = normalizeOptionalNumber(existing.para);
  if (nextPara !== prevPara) {
    patch.para = nextPara;
  }

  return patch;
}
