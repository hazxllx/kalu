/**
 * Household Risk Clustering — configurable early-intervention rules.
 *
 * Decision-support / early-warning only. It does NOT diagnose residents. The
 * engine clusters household-level monitoring indicators into an explainable
 * risk level with a recommended action. All weights / thresholds / escalation
 * rules come from configuration (editable by an authorized administrator) and
 * are never permanently hardcoded.
 */

export const RISK_LEVELS = {
  STABLE: "stable",
  MONITOR: "monitor",
  INTERVENTION: "intervention",
  PRIORITY: "priority",
};

export const RISK_LEVEL_LABELS = {
  [RISK_LEVELS.STABLE]: "Stable",
  [RISK_LEVELS.MONITOR]: "Monitor",
  [RISK_LEVELS.INTERVENTION]: "Needs Intervention",
  [RISK_LEVELS.PRIORITY]: "Priority Review",
};

/**
 * Semantic dot tone key per level (no emojis). The actual dot color is defined
 * in the components via the existing semantic status palette so it stays
 * consistent in Light and Dark Mode.
 */
export const RISK_LEVEL_DOT = {
  [RISK_LEVELS.STABLE]: "green",
  [RISK_LEVELS.MONITOR]: "gold",
  [RISK_LEVELS.INTERVENTION]: "accent",
  [RISK_LEVELS.PRIORITY]: "danger",
};

/** Professional level descriptions + basis copy (no emojis, no diagnosis). */
export const RISK_CLASSIFICATION_BASIS = {
  [RISK_LEVELS.STABLE]: {
    summary:
      "No significant unresolved household risk indicators are currently identified.",
    typicalState: [
      "No active priority indicators",
      "No overdue critical follow-ups",
      "No significant unresolved referrals",
      "Routine monitoring only",
    ],
    examples: [],
    recommendedResponse: "Continue routine household monitoring.",
  },
  [RISK_LEVELS.MONITOR]: {
    summary:
      "One or more lower-priority indicators are present and require continued observation or routine follow-up.",
    typicalState: [
      "Upcoming or recently missed routine service",
      "Incomplete monitoring information",
      "Household due for routine follow-up",
      "Single lower-priority indicator",
    ],
    examples: [
      "Upcoming or recently missed routine service",
      "Incomplete monitoring information",
      "Household due for routine follow-up",
      "Single lower-priority indicator",
    ],
    recommendedResponse: "Continue monitoring and schedule routine follow-up when appropriate.",
  },
  [RISK_LEVELS.INTERVENTION]: {
    summary:
      "Multiple relevant risk indicators are present, or a configured indicator requires active follow-up.",
    typicalState: [
      "Multiple overdue services",
      "Unresolved referral combined with another risk indicator",
      "Repeated missed follow-ups",
      "Child requiring monitoring combined with another household concern",
      "Multiple members requiring follow-up",
    ],
    examples: [
      "Multiple overdue services",
      "Unresolved referral combined with another risk indicator",
      "Repeated missed follow-ups",
      "Child requiring monitoring combined with another household concern",
      "Multiple members requiring follow-up",
    ],
    recommendedResponse: "Initiate household follow-up or assessment.",
  },
  [RISK_LEVELS.PRIORITY]: {
    summary:
      "Multiple significant indicators are present, risk indicators are persistent, or configured escalation criteria have been reached.",
    typicalState: [
      "Multiple unresolved significant indicators",
      "Persistent risk despite previous intervention",
      "Repeated unsuccessful follow-up attempts",
      "Multiple household members requiring priority assessment",
      "Configured escalation condition reached",
    ],
    examples: [
      "Multiple unresolved significant indicators",
      "Persistent risk despite previous intervention",
      "Repeated unsuccessful follow-up attempts",
      "Multiple household members requiring priority assessment",
      "Configured escalation condition reached",
    ],
    recommendedResponse: "Prompt review by the appropriate authorized health personnel.",
  },
};

/**
 * Data-driven basis for a household's classification.
 *
 * The basis is generated from the household's ACTUAL contributing indicators
 * (labels + configured weights) and the configured level copy. It never claims
 * a medical diagnosis — it describes monitoring indicators and workflow rules.
 */
export const householdRiskBasis = ({ level, count, indicators = [] }) => {
  const basis = RISK_CLASSIFICATION_BASIS[level] || RISK_CLASSIFICATION_BASIS[RISK_LEVELS.STABLE];
  return {
    level,
    headline: count === 0
      ? "No significant risk indicators detected."
      : `${count} relevant risk ${count === 1 ? "indicator" : "indicators"} detected`,
    contributing: indicators.map((i) => i.label),
    summary: basis.summary,
    typicalState: basis.typicalState,
    recommendedResponse: basis.recommendedResponse,
  };
};

/** Human note appended anywhere risk scores appear (keeps score context clear). */
export const RISK_SCORE_NOTE =
  "Risk Score reflects the configured household monitoring criteria — it is not a clinical diagnosis.";

/** Follow-up workflow states used by the risk-cluster store. */
export const RISK_WORKFLOW_STATUSES = [
  "Monitoring",
  "Follow-up Scheduled",
  "Intervention Initiated",
  "Resolved",
  "Escalated",
  "Unable to Contact",
  "Requires Further Assessment",
];

export const DEFAULT_RISK_CONFIG = Object.freeze({
  indicators: [
    { key: "multiple_members_followup", label: "Multiple members requiring follow-up", weight: 2 },
    { key: "missed_vaccination", label: "Missed vaccination", weight: 2 },
    { key: "overdue_vaccination", label: "Overdue vaccination", weight: 2 },
    { key: "missed_appointments", label: "Missed appointments", weight: 1 },
    { key: "unresolved_referrals", label: "Unresolved referral", weight: 2 },
    { key: "repeated_missed_followups", label: "Repeated missed follow-ups", weight: 2 },
    { key: "child_growth_concern", label: "Child growth monitoring concern", weight: 2 },
    { key: "nutrition_concern", label: "Nutrition monitoring concern", weight: 2 },
    { key: "maternal_followup", label: "Maternal health follow-up required", weight: 1 },
    { key: "multiple_monitoring_flags", label: "Multiple active monitoring flags", weight: 1 },
    { key: "long_no_visit", label: "Long period without household visit", weight: 1 },
    { key: "repeated_encounters", label: "Repeated health-service encounters for same concern", weight: 1 },
    { key: "incomplete_records", label: "Incomplete health records", weight: 1 },
    { key: "environmental_concern", label: "Environmental / community health concern", weight: 2, escalation: true },
  ],
  thresholds: {
    priorityScore: 8,
    priorityCount: 3,
    interventionScore: 5,
    monitorScore: 2,
  },
  followUpTimeframeDays: 14,
  escalationAfterFollowUps: 3,
});

const CONFIG_KEY = "kalusagap.risk.config.v1";

// Module-level cache so the config reference is stable across reads (required
// for `useSyncExternalStore` snapshot caching) and only changes on save/reset.
let cfgCache = null;

export const getRiskConfig = () => {
  if (cfgCache) return cfgCache;
  try {
    const raw = window.sessionStorage.getItem(CONFIG_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && Array.isArray(parsed.indicators) && parsed.indicators.length > 0) {
        cfgCache = parsed;
        return cfgCache;
      }
    }
  } catch {
    /* ignore */
  }
  cfgCache = { ...DEFAULT_RISK_CONFIG, indicators: DEFAULT_RISK_CONFIG.indicators.map((i) => ({ ...i })) };
  return cfgCache;
};

export const saveRiskConfig = (config) => {
  cfgCache = config;
  try {
    window.sessionStorage.setItem(CONFIG_KEY, JSON.stringify(config));
  } catch {
    /* ignore */
  }
};

export const resetRiskConfig = () => {
  try {
    window.sessionStorage.removeItem(CONFIG_KEY);
  } catch {
    /* ignore */
  }
  cfgCache = { ...DEFAULT_RISK_CONFIG, indicators: DEFAULT_RISK_CONFIG.indicators.map((i) => ({ ...i })) };
  return cfgCache;
};

/** Resolve an indicator definition from config by key. */
export const indicatorDef = (config, key) =>
  (config.indicators || []).find((i) => i.key === key) || null;

/**
 * Score + classify a household from its present indicator keys.
 *
 * Returns { level, score, count, indicators, hasEscalation, recommendedAction }.
 * The level comes from configured thresholds; a configured escalation indicator
 * combined with the priority-count threshold promotes to Priority Review.
 */
export const computeHouseholdRisk = ({ indicatorKeys = [], config }) => {
  const cfg = config || getRiskConfig();
  const defs = cfg.indicators || [];
  const indicators = indicatorKeys
    .map((key) => ({ key, def: defs.find((d) => d.key === key) }))
    .filter((x) => x.def)
    .map((x) => ({
      key: x.key,
      label: x.def.label,
      weight: Number(x.def.weight) || 0,
      escalation: Boolean(x.def.escalation),
    }));

  const score = indicators.reduce((acc, i) => acc + i.weight, 0);
  const count = indicators.length;
  const hasEscalation = indicators.some((i) => i.escalation);
  const t = cfg.thresholds || {};

  let level;
  if (score >= (t.priorityScore ?? 8) || (count >= (t.priorityCount ?? 3) && hasEscalation)) {
    level = RISK_LEVELS.PRIORITY;
  } else if (score >= (t.interventionScore ?? 5)) {
    level = RISK_LEVELS.INTERVENTION;
  } else if (score >= (t.monitorScore ?? 2)) {
    level = RISK_LEVELS.MONITOR;
  } else {
    level = RISK_LEVELS.STABLE;
  }

  return {
    level,
    score,
    count,
    indicators,
    hasEscalation,
    recommendedAction: recommendedActionFor(level, cfg),
  };
};

const recommendedActionFor = (level, cfg) => {
  switch (level) {
    case RISK_LEVELS.PRIORITY:
      return "Conduct a household assessment promptly and coordinate with the assigned PHN. Review within the configured timeframe.";
    case RISK_LEVELS.INTERVENTION:
      return "Initiate household follow-up and coordinate with the assigned health worker within the configured timeframe.";
    case RISK_LEVELS.MONITOR:
      return "Continue monitoring the identified indicators and schedule the next household follow-up.";
    default:
      return "No significant risk cluster detected. Maintain routine household monitoring.";
  }
};
