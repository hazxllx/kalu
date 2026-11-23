/**
 * Household Profiling — shared option lists, badge styling and risk computation.
 *
 * This module provides:
 *   - Canonical lists of household demographics (water source, toilet type, etc.)
 *   - Badge color schemes for status and risk levels (blue=pending, green=approved, etc.)
 *   - Live risk scoring algorithm based on environmental and household factors
 *   - Auto-flagging logic for sanitation risks and missing PhilHealth enrollment
 *
 * The risk computation weights multiple factors (water quality, sanitation,
 * vulnerable populations, income) to classify households as Low/Moderate/High
 * risk, driving early intervention and monitoring priorities. The algorithm is
 * designed to be transparent and explainable: each risk factor includes a
 * human-readable description (e.g., "Unimproved water source") so health workers
 * and supervisors understand why a household is flagged.
 *
 * These lists are NOT stored in the database; they are the canonical UI/business
 * logic enumeration. Changes to enumerations require a code update and redeploy.
 */

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

/**
 * Water source classification (WHO/UNICEF JMP standard).
 * Used to assess sanitation risk: unimproved/Level I sources carry higher risk.
 */
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

/**
 * Toilet facility types (WHO/UNICEF JMP standard).
 * Core indicator: water-sealed own use is improved sanitation;
 * everything else (shared, open pit, none) carries increasing risk.
 */
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

/**
 * Household member classifications (age-based and special populations).
 * These drive risk assessment (pregnant, newborn, senior, PWD) and
 * program eligibility (immunization, maternal care, chronic disease management).
 */
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

/**
 * Badge color scheme (Tailwind classes).
 * Color-coded by status and risk level for quick visual identification:
 *   - Blue: Pending (awaiting action)
 *   - Green: Submitted/Approved (completed favorably)
 *   - Orange: Needs Update/Sync (requires attention)
 *   - Red: Refused/Non-Eligible (rejected or ineligible)
 *   - Gray: Ongoing/Duplicate/Migrated (neutral/archival)
 */
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

/**
 * Get the badge color scheme for a household status or risk level.
 * @param {string} value - Status or risk level key
 * @returns {string} Tailwind classes
 */
export function hhBadgeTone(value) {
  return TONES[value] || "bg-slate-100 text-slate-600";
}

/**
 * Convert a risk score (0–100) to a categorical risk level.
 * @param {number} score
 * @returns {'Low'|'Moderate'|'High'}
 */
export function riskFromScore(score) {
  if (score >= 60) return "High";
  if (score >= 40) return "Moderate";
  return "Low";
}

export function isCriticalSanitationRisk({ waterSource, toilet, sanitationAccess } = {}) {
  return waterSource === "unimproved"
    || toilet === "none"
    || toilet === "open_pit"
    || toilet === "antipolo"
    || sanitationAccess === "None";
}

/**
 * Compute live household risk score based on environmental and demographic factors.
 *
 * Algorithm:
 *   - Water source: Unimproved (+40), Level I (+30), Level II (+15), Level III (0)
 *   - Toilet facility: None (+40), Antipolo (+30), Open pit (+25), Shared (+10), Own (0)
 *   - Sanitation access: None (+30), Public/communal (+15), Shared (+10), Owned (0)
 *   - Vulnerable populations: Pregnant (+15), Newborn (+15), Senior (+10), PWD (+10)
 *   - Income: <₱5,000/month (+20), <₱10,000/month (+10), else (0)
 *
 * Score interpretation:
 *   - 0–39: Low risk (basic environmental challenges, generally manageable)
 *   - 40–59: Moderate risk (significant environmental or economic challenges)
 *   - 60+: High risk (multiple serious challenges; requires prioritized intervention)
 *
 * The algorithm is transparent: each contributing factor includes a human-readable
 * description so health workers understand why a household is flagged. This supports
 * trust in the system and evidence-based prioritization.
 *
 * @param {Object} household
 * @param {string} household.waterSource - Key from WATER_SOURCES
 * @param {string} household.toilet - Key from TOILET_TYPES
 * @param {string} household.sanitationAccess - Value from SANITATION_ACCESS
 * @param {Array<Object>} [household.members] - Array of { classification, age, pwd, name }
 * @param {number|string} [household.income] - Monthly income in PHP
 *
 * @returns {{
 *   score: number,
 *   level: 'Low'|'Moderate'|'High',
 *   factors: string[]
 * }}
 *   score: computed risk score (0–100+)
 *   level: categorical risk level
 *   factors: list of contributing factors (for explanation)
 */
export function computeHouseholdRisk({ waterSource, toilet, sanitationAccess, members = [], income }) {
  let score = 0;
  const factors = [];

  // Water source risk: most important factor
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

  // Toilet facility risk: direct indicator of sanitation
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

  // Sanitation facility access: supports hygiene practices
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

  // Vulnerable populations: require closer monitoring and support
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

  // Income level: proxy for access to health services and nutrition
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

  const level = isCriticalSanitationRisk({ waterSource, toilet, sanitationAccess }) && score < 60
    ? "High"
    : riskFromScore(score);
  return { score, level, factors };
}

/**
 * Auto-flag households for health worker attention.
 *
 * Flags generated:
 *   - "Sanitation Risk" if unsafe water source (Level I/Unimproved) OR no toilet
 *   - "Verify PhilHealth enrollment for [Name]" for each member 21+ without
 *     PhilHealth enrollment specified (helps ensure insurance coverage)
 *
 * These flags appear in the household list to prompt action during routine visits.
 *
 * @param {Object} household
 * @param {string} household.waterSource
 * @param {string} household.toilet
 * @param {Array<Object>} [household.members]
 *
 * @returns {string[]} Array of flag descriptions
 */
export function householdFlags({ waterSource, toilet, sanitationAccess, members = [] }) {
  const flags = [];

  // Level I is a service level, not proof that a water source is unsafe.
  // Only an actually unimproved source or an unsafe toilet condition is flagged.
  if (waterSource === "unimproved"
    || toilet === "none"
    || toilet === "open_pit"
    || toilet === "antipolo"
    || sanitationAccess === "None") {
    flags.push("Sanitation Risk");
  }
  
  // PhilHealth verification: adults without recorded enrollment
  members.forEach((m) => {
    if (m.name && m.age !== "" && m.age !== undefined && Number(m.age) >= 21 && !m.philhealth) {
      flags.push(`Verify PhilHealth enrollment for ${m.name}`);
    }
  });
  
  return flags;
}

/**
 * Generate the next sequential household ID.
 *
 * Extracts numeric portions from existing IDs and increments by 1,
 * padding to 3 digits. Examples: HH-001, HH-002, ..., HH-204, HH-205.
 *
 * @param {Array<Object>} list - Existing household records with `id` field
 * @returns {string} Next household ID in sequence
 */
export function nextHouseholdId(list) {
  const max = list.reduce((acc, h) => {
    const n = parseInt(String(h.id || "").replace(/\D/g, ""), 10);
    return Number.isNaN(n) ? acc : Math.max(acc, n);
  }, 0);
  return `HH-${String(max + 1).padStart(3, "0")}`;
}
