/**
 * Household risk classification — SERVER-AUTHORITATIVE port of the frontend
 * rules in frontend/src/features/households/lib/householdOptions.js.
 *
 * Weights: water source level, toilet facility type, sanitation access,
 * vulnerable members (pregnant / newborn / senior / PWD) and income level.
 * The API recomputes this on every household write; a risk score supplied by
 * the client is never stored.
 */

export const riskLevelFromScore = (score) => {
  if (score >= 60) return 'High';
  if (score >= 40) return 'Moderate';
  return 'Low';
};

export const computeHouseholdRisk = ({ waterSource, toilet, sanitationAccess, members = [], income } = {}) => {
  const factors = [];
  let total = 0;

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

  return { score: total, level: riskLevelFromScore(total), factors };
};

/**
 * Auto-flags: unsafe water source (Level I / Unimproved) or no toilet is
 * tagged "Sanitation Risk"; members 21+ without a specified PhilHealth
 * enrollment are flagged for verification.
 */
export const householdFlags = ({ waterSource, toilet, members = [] } = {}) => {
  const flags = [];
  if (waterSource === 'level1' || waterSource === 'unimproved' || toilet === 'none') {
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
