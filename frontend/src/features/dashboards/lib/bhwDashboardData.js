const HOUSEHOLD_PAGE_SIZE = 100;

export async function fetchBhwHouseholds(listHouseholds) {
  const firstPage = await listHouseholds({ limit: HOUSEHOLD_PAGE_SIZE, offset: 0 });
  if (
    !Array.isArray(firstPage?.rows) ||
    !Number.isInteger(firstPage?.total) ||
    firstPage.total < 0
  ) {
    throw new Error("The household service returned an invalid list response.");
  }

  const rows = [...firstPage.rows];
  while (rows.length < firstPage.total) {
    const page = await listHouseholds({ limit: HOUSEHOLD_PAGE_SIZE, offset: rows.length });
    if (!Array.isArray(page?.rows) || page.rows.length === 0) {
      throw new Error("The household list was incomplete. Please retry.");
    }
    rows.push(...page.rows);
  }

  return rows.slice(0, firstPage.total);
}

const severity = { Low: 0, Moderate: 1, Medium: 1, High: 2 };

export function householdRiskLevel(household) {
  if (Object.hasOwn(severity, household.riskLevel)) return household.riskLevel;
  const score = Number(household.riskScore);
  if (!Number.isFinite(score)) return "Unclassified";
  if (score >= 60) return "High";
  if (score >= 40) return "Moderate";
  return "Low";
}

function householdRiskFactors(household) {
  const factors = Array.isArray(household.riskFactors)
    ? household.riskFactors.filter((factor) => typeof factor === "string" && factor.trim())
    : [];

  const waterRisks = {
    unimproved: "Unimproved water source",
    level1: "Level I water source",
    level2: "Level II communal water source",
  };
  const toiletRisks = {
    none: "No toilet facility",
    antipolo: "Unsanitary toilet facility",
    open_pit: "Open pit toilet",
    ws_shared: "Shared toilet facility",
  };
  const sanitationRisks = {
    None: "No sanitation facility access",
    "Public/communal": "Public/communal sanitation facility",
    "Shared with other household": "Shared sanitation facility",
  };

  for (const [value, label] of [
    [household.waterSource, waterRisks[household.waterSource]],
    [household.toiletType, toiletRisks[household.toiletType]],
    [household.sanitationAccess, sanitationRisks[household.sanitationAccess]],
  ]) {
    if (label && value) factors.push(label);
  }

  const income = Number(household.monthlyIncome);
  if (Number.isFinite(income) && income > 0 && income < 5000) {
    factors.push("Monthly income below ₱5,000");
  } else if (Number.isFinite(income) && income >= 5000 && income < 10000) {
    factors.push("Monthly income below ₱10,000");
  }

  return [...new Set(factors)];
}

export function summarizeHouseholdConcerns(households, limit = 4) {
  const summaries = new Map();

  households.forEach((household) => {
    const riskLevel = householdRiskLevel(household);
    householdRiskFactors(household).forEach((concern) => {
      const summary = summaries.get(concern) || { concern, count: 0, riskLevel };
      summary.count += 1;
      if ((severity[riskLevel] ?? -1) > (severity[summary.riskLevel] ?? -1)) {
        summary.riskLevel = riskLevel;
      }
      summaries.set(concern, summary);
    });
  });

  return [...summaries.values()]
    .sort((a, b) => b.count - a.count || a.concern.localeCompare(b.concern))
    .slice(0, limit);
}
