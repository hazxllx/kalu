// Household Profiling shared option lists, badge tones and the live risk
// computation used by the Add Household panel and the household list.

export const HH_STATUSES = [
  "Pending",
  "Ongoing",
  "Submitted",
  "Needs Update",
  "Approved",
  "Refused",
  "For Masterlist Update",
  "Non-Eligible",
  "Duplicate",
  "Migrated",
  "Other",
];

export const APPROVAL_STATUSES = ["Not yet approved", "Approved", "Needs revision"];

export const PUROKS = ["Purok 1", "Purok 2", "Purok 3", "Purok 4", "Purok 5", "Purok 6", "Purok 7"];

export const BHW_NAMES = ["Maria Cruz", "Lourdes Ramos", "Grace Aquino"];

export const WATER_SOURCES = [
  { value: "level1", label: "Level I – Point Source (shared well/spring, no distribution pipe)" },
  { value: "level2", label: "Level II – Communal Faucet System (shared piped system)" },
  { value: "level3", label: "Level III – Individual House Connection" },
  { value: "unimproved", label: "Unimproved (open well, unprotected spring, river/lake)" },
];

export const WATER_SOURCE_LABELS = {
  level1: "Level I - Point Source",
  level2: "Level II - Communal",
  level3: "Level III - Piped",
  unimproved: "Unimproved",
};

export const WATER_TYPES = [
  "Deep well",
  "Shallow well",
  "Spring",
  "Piped/Waterworks (local/private)",
  "Rainwater collection",
  "Water refilling station",
  "Peddled/vended water",
];

export const WATER_DISTANCES = ["<100 m", "100–250 m", ">250 m"];

export const WATER_AVAILABILITY = ["Available year-round", "Seasonal/intermittent", "Frequently unavailable"];

export const TREATMENT_METHODS = ["Boiling", "Chlorination", "Filtration", "SODIS", "Other"];

export const TOILET_TYPES = [
  { value: "ws_own", label: "Water-sealed – Own use" },
  { value: "ws_shared", label: "Water-sealed – Shared" },
  { value: "open_pit", label: "Open pit" },
  { value: "antipolo", label: "Antipolo-type/unsanitary" },
  { value: "none", label: "None/Open defecation" },
];

export const TOILET_LABELS = {
  ws_own: "Water-sealed",
  ws_shared: "Water-sealed (Shared)",
  open_pit: "Open pit",
  antipolo: "Antipolo-type",
  none: "None",
};

export const SANITATION_ACCESS = ["Owned", "Shared with other household", "Public/communal", "None"];

export const WASTE_DISPOSAL = ["Collected by garbage truck", "Burning", "Burying", "Composting", "Open dumping"];

export const PHILHEALTH_CATEGORIES = [
  "Formal Economy",
  "Informal Economy",
  "Indigent",
  "Senior Citizen",
  "Sponsored",
  "Lifetime Member",
];

export const CLASSIFICATIONS = [
  { value: "N", label: "N — Newborn (0–28 days)" },
  { value: "I", label: "I — Infant (29 days – <1 yr)" },
  { value: "U", label: "U — Under-5 (1–4 yrs)" },
  { value: "S", label: "S — School age (5–9 yrs)" },
  { value: "A", label: "A — Adolescent (10–19 yrs)" },
  { value: "P", label: "P — Pregnant" },
  { value: "AP", label: "AP — Adult (20–59 yrs)" },
  { value: "PP", label: "PP — Postpartum" },
  { value: "WRA", label: "WRA — Woman of Reproductive Age (15–49)" },
  { value: "SC", label: "SC — Senior Citizen (60+)" },
];

export const QUARTER_STATUSES = ["Updated", "Pending", "Missed", "Declined"];

export const RELATIONSHIPS = [
  "Head",
  "Spouse",
  "Son",
  "Daughter",
  "Son-in-law",
  "Daughter-in-law",
  "Grandchild",
  "Parent",
  "Sibling",
  "Other Relative",
  "Non-relative",
];

export const FP_METHODS = [
  "None",
  "Pill",
  "IUD",
  "Injectable (DMPA)",
  "Implant",
  "Condom",
  "BTL",
  "Vasectomy",
  "NFP/Cycle Tracking",
  "Other",
];

export const SEX_OPTIONS = ["Male", "Female"];

export const MEMBER_PHILHEALTH = [
  { value: "member", label: "Member" },
  { value: "non-member", label: "Non-member" },
];

/* Color-coded badges — blue = Pending, green = Submitted/Approved,
   orange = Needs Update/Sync, red = Refused/Non-Eligible, gray = Ongoing. */
const TONES = {
  Pending: "bg-brand-blue/10 text-brand-blue",
  Ongoing: "bg-slate-100 text-slate-600",
  Submitted: "bg-emerald-50 text-emerald-700",
  Approved: "bg-emerald-50 text-emerald-700",
  "Needs Update": "bg-amber-50 text-amber-700",
  "For Masterlist Update": "bg-amber-50 text-amber-700",
  Refused: "bg-rose-50 text-rose-700",
  "Non-Eligible": "bg-rose-50 text-rose-700",
  Duplicate: "bg-slate-100 text-slate-600",
  Migrated: "bg-slate-100 text-slate-600",
  Other: "bg-slate-100 text-slate-600",
  "Not yet approved": "bg-brand-blue/10 text-brand-blue",
  "Needs revision": "bg-amber-50 text-amber-700",
  "Pending Sync": "bg-amber-100 text-amber-700",
  Low: "bg-emerald-50 text-emerald-700",
  Moderate: "bg-amber-50 text-amber-700",
  High: "bg-rose-50 text-rose-700",
};

export function hhBadgeTone(value) {
  return TONES[value] || "bg-slate-100 text-slate-600";
}

export function riskFromScore(score) {
  if (score >= 60) return "High";
  if (score >= 40) return "Moderate";
  return "Low";
}

/**
 * Live risk classification. Weights: water source level, toilet facility
 * type, sanitation facility access, presence of pregnant/newborn/senior/PWD
 * members, and income level.
 */
export function computeHouseholdRisk({ waterSource, toilet, sanitationAccess, members = [], income }) {
  let score = 0;
  const factors = [];

  if (waterSource === "unimproved") {
    score += 40;
    factors.push("Unimproved water source");
  } else if (waterSource === "level1") {
    score += 30;
    factors.push("Level I water source");
  } else if (waterSource === "level2") {
    score += 15;
    factors.push("Level II communal water source");
  }

  if (toilet === "none") {
    score += 40;
    factors.push("No toilet facility");
  } else if (toilet === "antipolo") {
    score += 30;
    factors.push("Unsanitary toilet facility");
  } else if (toilet === "open_pit") {
    score += 25;
    factors.push("Open pit toilet");
  } else if (toilet === "ws_shared") {
    score += 10;
    factors.push("Shared toilet facility");
  }

  if (sanitationAccess === "None") {
    score += 30;
    factors.push("No sanitation facility access");
  } else if (sanitationAccess === "Public/communal") {
    score += 15;
    factors.push("Public/communal sanitation facility");
  } else if (sanitationAccess === "Shared with other household") {
    score += 10;
    factors.push("Shared sanitation facility");
  }

  const classifications = members.map((m) => m.classification);
  if (classifications.includes("P")) {
    score += 15;
    factors.push("Pregnant member");
  }
  if (classifications.includes("N")) {
    score += 15;
    factors.push("Newborn member");
  }
  if (classifications.includes("SC")) {
    score += 10;
    factors.push("Senior citizen member");
  }
  if (members.some((m) => m.pwd)) {
    score += 10;
    factors.push("Member with disability (PWD)");
  }

  const incomeNum = Number(income);
  if (!Number.isNaN(incomeNum) && incomeNum > 0) {
    if (incomeNum < 5000) {
      score += 20;
      factors.push("Monthly income below ₱5,000");
    } else if (incomeNum < 10000) {
      score += 10;
      factors.push("Monthly income below ₱10,000");
    }
  }

  return { score, level: riskFromScore(score), factors };
}

/**
 * Auto-flags: unsafe water source (Level I/Unimproved) or no toilet facility
 * is tagged "Sanitation Risk"; members 21+ whose PhilHealth enrollment was
 * left unspecified are flagged for verification.
 */
export function householdFlags({ waterSource, toilet, members = [] }) {
  const flags = [];
  if (waterSource === "level1" || waterSource === "unimproved" || toilet === "none") {
    flags.push("Sanitation Risk");
  }
  members.forEach((m) => {
    if (m.name && m.age !== "" && m.age !== undefined && Number(m.age) >= 21 && !m.philhealth) {
      flags.push(`Verify PhilHealth enrollment for ${m.name}`);
    }
  });
  return flags;
}

/** Next sequential household id, e.g. HH-204 -> HH-205. */
export function nextHouseholdId(list) {
  const max = list.reduce((acc, h) => {
    const n = parseInt(String(h.id || "").replace(/\D/g, ""), 10);
    return Number.isNaN(n) ? acc : Math.max(acc, n);
  }, 0);
  return `HH-${String(max + 1).padStart(3, "0")}`;
}
