/**
 * @module utils/householdRisk
 * @description Server-authoritative household environmental and socio-demographic risk
 * scoring and auto-flagging engine.
 *
 * Architectural layer:
 *   `route -> authenticate -> authorize -> controller -> service (uses utils/householdRisk) -> repository/Supabase`
 *
 * Mirrors the domain rules in `frontend/src/features/households/lib/householdOptions.js`.
 * Evaluates five weighted domains — water source level, toilet facility type,
 * sanitation facility access, vulnerable household members (pregnant, newborn,
 * senior citizen, PWD), and monthly income — whenever a household profile is
 * created or updated. Client-supplied risk scores or levels are never persisted;
 * the backend always recomputes them here before writing to Supabase.
 */

/**
 * Maps an aggregate household risk score to a qualitative risk tier:
 *   - `>= 60` -> `'High'`
 *   - `40–59` -> `'Moderate'`
 *   - `< 40`  -> `'Low'`
 *
 * @param {number} score - Computed household risk score.
 * @returns {string} `'High'`, `'Moderate'`, or `'Low'`.
 */
export const riskLevelFromScore = (score) => {
  if (score >= 60) return 'High';
  if (score >= 40) return 'Moderate';
  return 'Low';
};

export const isCriticalSanitationRisk = ({ waterSource, toilet, sanitationAccess } = {}) =>
  waterSource === 'unimproved'
  || toilet === 'none'
  || toilet === 'open_pit'
  || toilet === 'antipolo'
  || sanitationAccess === 'None';

/**
 * Computes the additive risk score, qualitative risk level, and human-readable
 * contributing factor labels for a household profile.
 *
 * @param {Object} [params={}] - Household environmental, member, and income attributes.
 * @param {string} [params.waterSource] - Water supply classification (`'unimproved'`, `'level1'`, `'level2'`, `'level3'`).
 * @param {string} [params.toilet] - Toilet facility code (`'none'`, `'antipolo'`, `'open_pit'`, `'ws_shared'`, `'ws_exclusive'`).
 * @param {string} [params.sanitationAccess] - Sanitation access level (`'None'`, `'Public/communal'`, `'Shared with other household'`, etc.).
 * @param {Array<Object>} [params.members=[]] - Household member roster entries (`{ classification, pwd, ... }`).
 * @param {number|string|null} [params.income] - Reported monthly household income in PHP.
 * @returns {Object} `{ score: number, level: string, factors: Array<string> }`.
 */
export const computeHouseholdRisk = ({ waterSource, toilet, sanitationAccess, members = [], income } = {}) => {
  const factors = [];
  let total = 0;

  // 1. Water supply quality (FHSIS environmental health tiers: Level III safest -> unimproved highest risk)
  if (waterSource === 'unimproved') {
    total += 40;
    factors.push('Unimproved water source');
  } else if (waterSource === 'level1') {
    total += 30;
    factors.push('Level I water source');
  } else if (waterSource === 'level2') {
    total += 15;
    factors.push('Level II communal water source');
  }

  // 2. Toilet facility type (zero-open-defecation & sanitary toilet indicators)
  if (toilet === 'none') {
    total += 40;
    factors.push('No toilet facility');
  } else if (toilet === 'antipolo') {
    total += 30;
    factors.push('Unsanitary toilet facility');
  } else if (toilet === 'open_pit') {
    total += 25;
    factors.push('Open pit toilet');
  } else if (toilet === 'ws_shared') {
    total += 10;
    factors.push('Shared toilet facility');
  }

  // 3. Household sanitation access arrangement
  if (sanitationAccess === 'None') {
    total += 30;
    factors.push('No sanitation facility access');
  } else if (sanitationAccess === 'Public/communal') {
    total += 15;
    factors.push('Public/communal sanitation facility');
  } else if (sanitationAccess === 'Shared with other household') {
    total += 10;
    factors.push('Shared sanitation facility');
  }

  // 4. Vulnerable household member presence (applied once per category present in the roster)
  const classifications = members.map((m) => m.classification);
  if (classifications.includes('P')) {
    total += 15;
    factors.push('Pregnant member');
  }
  if (classifications.includes('N')) {
    total += 15;
    factors.push('Newborn member');
  }
  if (classifications.includes('SC')) {
    total += 10;
    factors.push('Senior citizen member');
  }
  if (members.some((m) => m.pwd)) {
    total += 10;
    factors.push('Member with disability (PWD)');
  }

  // 5. Monthly household income (only positive numeric values are scored; blank/0 is treated as unreported)
  const incomeNum = Number(income);
  if (!Number.isNaN(incomeNum) && incomeNum > 0) {
    if (incomeNum < 5000) {
      total += 20;
      factors.push('Monthly income below ₱5,000');
    } else if (incomeNum < 10000) {
      total += 10;
      factors.push('Monthly income below ₱10,000');
    }
  }

  const level = isCriticalSanitationRisk({ waterSource, toilet, sanitationAccess }) && total < 60
    ? 'High'
    : riskLevelFromScore(total);
  return { score: total, level, factors };
};

/**
 * Generates actionable follow-up flags for BHWs and midwives on a household record:
 *   - `'Sanitation Risk'` when water source is Level I / unimproved or there is no toilet.
 *   - Per-member PhilHealth verification prompts for named adults (`age >= 21`, where
 *     dependent coverage normally ends) who have no recorded PhilHealth status.
 *
 * @param {Object} [params={}] - Household water, toilet, and member roster data.
 * @param {string} [params.waterSource] - Water supply classification.
 * @param {string} [params.toilet] - Toilet facility code.
 * @param {Array<Object>} [params.members=[]] - Household members (`{ name, age, philhealth }`).
 * @returns {Array<string>} List of warning/follow-up flag strings.
 */
export const householdFlags = ({ waterSource, toilet, sanitationAccess, members = [] } = {}) => {
  const flags = [];
  // Level I describes service level and is not itself an unsafe-water determination.
  if (waterSource === 'unimproved'
    || toilet === 'none'
    || toilet === 'open_pit'
    || toilet === 'antipolo'
    || sanitationAccess === 'None') {
    flags.push('Sanitation Risk');
  }
  members.forEach((m) => {
    if (m.name && m.age !== '' && m.age !== undefined && Number(m.age) >= 21 && !m.philhealth) {
      flags.push(`Verify PhilHealth enrollment for ${m.name}`);
    }
  });
  return flags;
};

export default { computeHouseholdRisk, householdFlags, riskLevelFromScore };
