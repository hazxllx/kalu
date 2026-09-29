import React, { useSyncExternalStore } from "react";
import {
  computeHouseholdRisk,
  getRiskConfig,
  RISK_WORKFLOW_STATUSES,
} from "@/lib/householdRisk";
import { householdRiskApi } from "@/services/api/householdRiskApi";

/**
 * Household Risk Cluster store.
 *
 * Contains no demo data: every risk cluster / household record collection
 * starts empty. This is the in-session working set used until the backend
 * endpoint persists to the database; the shape pages expect is preserved
 * (each record is augmented with the computed, explainable `risk` field).
 *
 * Each household profile has a cluster of monitoring indicators detected from
 * existing data (vaccinations, referrals, follow-ups, visits, members, records).
 * The store computes the explainable risk level from the configured rules and
 * tracks follow-up workflow state, escalation, and a monthly risk history so
 * health workers can evaluate whether intervention is reducing risk.
 *
 * The configurable risk rules themselves live in `@/lib/householdRisk` and are
 * settings, not records.
 */

const STORAGE_KEY = "kalusagap.household-risk.v2";

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
  cache = [];
  persist();
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
    return { ...h, risk, history: (h.history || []).map((x) => ({ ...x })) };
  });
};

const getClusters = () => recompute().map((h) => ({ ...h, history: (h.history || []).map((x) => ({ ...x })) }));

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

/**
 * BUG-009: persist the workflow change to PostgreSQL
 * (public.household_risk_workflow) so follow-up/assignment/escalation/
 * resolution survive refresh, logout/login and other devices. The local cache
 * is only an optimistic mirror; the database is authoritative. Failures are
 * surfaced to the console (and the write can be retried) without corrupting the
 * on-screen state.
 */
const persistWorkflow = (id, workflow) => {
  householdRiskApi.saveWorkflow(id, workflow).catch((err) => {
    // eslint-disable-next-line no-console
    console.error(`Failed to persist household risk workflow for ${id}:`, err?.message || err);
  });
};

/** Record a follow-up for a household (updates workflow status + attempt count). */
const recordFollowUp = (id, { status = "Follow-up Scheduled", notes = "" } = {}) => {
  const h = read().find((x) => x.id === id);
  if (!h) return null;
  const followUpCount = (h.followUpCount || 0) + 1;
  const lastFollowUpAt = new Date().toISOString().slice(0, 10);
  updateRecord(id, { workflowStatus: status, followUpCount, lastFollowUpAt, lastNote: notes });
  persistWorkflow(id, { workflowStatus: status, followUpCount, lastFollowUpAt, lastNote: notes });
  return getClusters().find((x) => x.id === id);
};

/** Escalate a household to the next assigned worker level. */
const escalateHousehold = (id, { reason = "", assignment = "Public Health Nurse" } = {}) => {
  const h = read().find((x) => x.id === id);
  if (!h) return null;
  const escalation = { reason, assignment, at: new Date().toISOString() };
  updateRecord(id, { workflowStatus: "Escalated", escalation });
  persistWorkflow(id, { workflowStatus: "Escalated", escalation });
  return getClusters().find((x) => x.id === id);
};

/** Reassign the household to a health worker (permission-controlled). */
const assignWorker = (id, { worker = "", role = "Barangay Health Worker" } = {}) => {
  const h = read().find((x) => x.id === id);
  if (!h) return null;
  const assignedWorker = worker || h.assignedWorker || "";
  const assignmentAt = new Date().toISOString();
  updateRecord(id, { assignedWorker, assignedWorkerRole: role, assignmentAt });
  persistWorkflow(id, { assignedWorker, assignedWorkerRole: role, assignmentAt });
  return getClusters().find((x) => x.id === id);
};

/** Apply a resolved / monitoring outcome and log the monthly history point. */
const resolveHousehold = (id, { outcome = RISK_WORKFLOW_STATUSES[0] } = {}) => {
  const h = read().find((x) => x.id === id);
  if (!h) return null;
  const now = new Date();
  const month = now.toLocaleString("en-US", { month: "long" });
  const risk = computeHouseholdRisk({ indicatorKeys: h.indicatorKeys, config: getRiskConfig() });
  const history = [...(h.history || []), { month, year: now.getFullYear(), level: risk.level, count: risk.count }];
  updateRecord(id, { workflowStatus: outcome, history });
  persistWorkflow(id, { workflowStatus: outcome, history });
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
