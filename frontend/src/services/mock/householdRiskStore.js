import React, { useSyncExternalStore } from "react";
import {
  computeHouseholdRisk,
  getRiskConfig,
  RISK_LEVELS,
  RISK_WORKFLOW_STATUSES,
} from "@/lib/householdRisk";

/**
 * Household Risk Cluster store (frontend demo).
 *
 * Each household profile has a cluster of monitoring indicators detected from
 * existing data (vaccinations, referrals, follow-ups, visits, members, records).
 * The store computes the explainable risk level from the configured rules and
 * tracks follow-up workflow state, escalation, and a monthly risk history so
 * health workers can evaluate whether intervention is reducing risk.
 */

const STORAGE_KEY = "kalusagap.household-risk.v1";

const SEED = [
  {
    id: "HH-201",
    head: "Juanito Santos",
    surname: "Santos",
    barangay: "San Isidro",
    purok: "Purok 1",
    address: "12 Mabini St.",
    members: 5,
    assignedWorker: "Maria Cruz",
    lastHouseholdVisit: "2026-08-01",
    lastAssessment: "2026-09-05",
    indicatorKeys: [
      "overdue_vaccination",
      "unresolved_referrals",
      "child_growth_concern",
      "repeated_missed_followups",
    ],
    workflowStatus: "Intervention Initiated",
    followUpCount: 1,
    lastFollowUpAt: "2026-08-20",
    createdAt: "2026-08-01T00:00:00.000Z",
    history: [
      { month: "June", year: 2026, level: RISK_LEVELS.STABLE, count: 0 },
      { month: "July", year: 2026, level: RISK_LEVELS.MONITOR, count: 2 },
      { month: "August", year: 2026, level: RISK_LEVELS.INTERVENTION, count: 4 },
    ],
  },
  {
    id: "HH-205",
    head: "Norma Villanueva",
    surname: "Villanueva",
    barangay: "San Isidro",
    purok: "Purok 3",
    address: "8 Rizal Ave.",
    members: 7,
    assignedWorker: "Grace Aquino",
    lastHouseholdVisit: "2026-06-25",
    lastAssessment: "2026-09-01",
    indicatorKeys: [
      "missed_vaccination",
      "overdue_vaccination",
      "unresolved_referrals",
      "child_growth_concern",
      "nutrition_concern",
      "long_no_visit",
      "environmental_concern",
    ],
    workflowStatus: "Follow-up Scheduled",
    followUpCount: 3,
    lastFollowUpAt: "2026-07-10",
    createdAt: "2026-06-25T00:00:00.000Z",
    history: [
      { month: "June", year: 2026, level: RISK_LEVELS.INTERVENTION, count: 3 },
      { month: "July", year: 2026, level: RISK_LEVELS.INTERVENTION, count: 4 },
      { month: "August", year: 2026, level: RISK_LEVELS.PRIORITY, count: 6 },
    ],
  },
  {
    id: "HH-206",
    head: "Lito Fernandez",
    surname: "Fernandez",
    barangay: "San Isidro",
    purok: "Purok 2",
    address: "45 Bonifacio St.",
    members: 3,
    assignedWorker: "Lourdes Ramos",
    lastHouseholdVisit: "2026-08-28",
    lastAssessment: "2026-08-28",
    indicatorKeys: ["maternal_followup", "multiple_monitoring_flags"],
    workflowStatus: "Monitoring",
    followUpCount: 0,
    lastFollowUpAt: "",
    createdAt: "2026-06-01T00:00:00.000Z",
    history: [
      { month: "July", year: 2026, level: RISK_LEVELS.MONITOR, count: 2 },
    ],
  },
  {
    id: "HH-207",
    head: "Ramon Aguilar",
    surname: "Aguilar",
    barangay: "San Antonio",
    purok: "Purok 4",
    address: "3 Luna St.",
    members: 6,
    assignedWorker: "Maria Cruz",
    lastHouseholdVisit: "2026-07-20",
    lastAssessment: "2026-08-20",
    indicatorKeys: ["unresolved_referrals", "repeated_missed_followups", "long_no_visit"],
    workflowStatus: "Monitoring",
    followUpCount: 1,
    lastFollowUpAt: "2026-08-01",
    createdAt: "2026-06-10T00:00:00.000Z",
    history: [
      { month: "July", year: 2026, level: RISK_LEVELS.MONITOR, count: 2 },
      { month: "August", year: 2026, level: RISK_LEVELS.MONITOR, count: 3 },
    ],
  },
  {
    id: "HH-210",
    head: "Cecilia Domingo",
    surname: "Domingo",
    barangay: "San Isidro",
    purok: "Purok 5",
    address: "19 Quezon St.",
    members: 4,
    assignedWorker: "Maria Cruz",
    lastHouseholdVisit: "2026-08-15",
    lastAssessment: "2026-08-15",
    indicatorKeys: [],
    workflowStatus: "Monitoring",
    followUpCount: 0,
    lastFollowUpAt: "",
    createdAt: "2026-05-20T00:00:00.000Z",
    history: [
      { month: "July", year: 2026, level: RISK_LEVELS.STABLE, count: 0 },
    ],
  },
];

const cloneSeed = () => SEED.map((h) => ({ ...h, history: h.history.map((x) => ({ ...x })) }));

let cache = null;
let computedCache = null;

const read = () => {
  if (cache) return cache;
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        cache = parsed;
        return cache;
      }
    }
  } catch {
    /* ignore */
  }
  cache = cloneSeed();
  return cache;
};

/** Recompute the risk-augmented snapshot (stable reference between changes). */
const recompute = () => {
  computedCache = withRisk(read());
  return computedCache;
};

const persist = () => {
  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(cache || []));
  } catch {
    /* ignore */
  }
};
const listeners = new Set();
const emit = () => {
  persist();
  recompute();
  listeners.forEach((cb) => cb());
};
const subscribe = (cb) => {
  listeners.add(cb);
  return () => listeners.delete(cb);
};

// The hook's snapshot MUST contain the computed `risk` field — raw records
// without it cause `h.risk.level` to throw and blank the page.
const getSnapshot = () => computedCache || recompute();

/** Augment raw records with the computed explainable risk cluster. */
const withRisk = (raw) => {
  const cfg = getRiskConfig();
  return raw.map((h) => {
    const risk = computeHouseholdRisk({ indicatorKeys: h.indicatorKeys, config: cfg });
    return { ...h, risk, history: h.history.map((x) => ({ ...x })) };
  });
};

const getClusters = () => recompute().map((h) => ({ ...h, history: h.history.map((x) => ({ ...x })) }));

/** Recompute after a risk-config change so open pages reflect new rules. */
const refresh = () => {
  persist();
  recompute();
  listeners.forEach((cb) => cb());
};

const daysSince = (iso) => {
  if (!iso) return null;
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return null;
  return Math.max(0, Math.floor((Date.now() - d.getTime()) / 86400000));
};

const updateRecord = (id, patch) => {
  cache = read().map((h) => (h.id === id ? { ...h, ...patch } : h));
  emit();
};

/** Record a follow-up for a household (updates workflow status + attempt count). */
const recordFollowUp = (id, { status = "Follow-up Scheduled", notes = "" } = {}) => {
  const h = read().find((x) => x.id === id);
  if (!h) return null;
  updateRecord(id, {
    workflowStatus: status,
    followUpCount: (h.followUpCount || 0) + 1,
    lastFollowUpAt: new Date().toISOString().slice(0, 10),
    lastNote: notes,
  });
  return getClusters().find((x) => x.id === id);
};

/** Escalate a household to the next assigned worker level. */
const escalateHousehold = (id, { reason = "", assignment = "Public Health Nurse" } = {}) => {
  const h = read().find((x) => x.id === id);
  if (!h) return null;
  updateRecord(id, {
    workflowStatus: "Escalated",
    escalation: { reason, assignment, at: new Date().toISOString() },
  });
  return getClusters().find((x) => x.id === id);
};

/** Reassign the household to a health worker (permission-controlled). */
const assignWorker = (id, { worker = "", role = "Barangay Health Worker" } = {}) => {
  const h = read().find((x) => x.id === id);
  if (!h) return null;
  updateRecord(id, {
    assignedWorker: worker || h.assignedWorker || "",
    assignedWorkerRole: role,
    assignmentAt: new Date().toISOString(),
  });
  return getClusters().find((x) => x.id === id);
};

/** Apply a resolved / monitoring outcome and log the monthly history point. */
const resolveHousehold = (id, { outcome = RISK_WORKFLOW_STATUSES[0] } = {}) => {
  const h = read().find((x) => x.id === id);
  if (!h) return null;
  const now = new Date();
  const month = now.toLocaleString("en-US", { month: "long" });
  const risk = computeHouseholdRisk({ indicatorKeys: h.indicatorKeys });
  updateRecord(id, {
    workflowStatus: outcome,
    history: [...(h.history || []), { month, year: now.getFullYear(), level: risk.level, count: risk.count }],
  });
  return getClusters().find((x) => x.id === id);
};

export const useHouseholdRiskClusters = () => useSyncExternalStore(subscribe, getSnapshot);

export const householdRiskStore = {
  getClusters,
  getSnapshot,
  subscribe,
  recordFollowUp,
  escalateHousehold,
  resolveHousehold,
  assignWorker,
  refresh,
  daysSince,
  statuses: RISK_WORKFLOW_STATUSES,
};

export default householdRiskStore;
