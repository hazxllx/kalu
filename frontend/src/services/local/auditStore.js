import React, { useSyncExternalStore } from "react";

/**
 * Shared frontend audit store (local work set).
 *
 * No demo data: the audit event collection starts empty, and an audit trail
 * must never contain fabricated entries. Events recorded here are the
 * in-session working set used until the backend endpoint persists to the
 * database. The shape pages expect is preserved from the previous store.
 *
 * Central place where admin-side actions (user management, staff requests,
 * supervisor verification, certificate decisions, resident edits) record audit
 * events. Backend implementation is intentionally NOT included — see
 * docs/backend/README.md.
 */

const STORAGE_KEY = "kalusagap.audit.v2";
const LEGACY_STORAGE_KEYS = ["kalusagap.audit.v1"];

/** Standard audit actions used across the app. */
export const AUDIT_ACTIONS = [
  "Login",
  "Logout",
  "User created",
  "User updated",
  "User disabled",
  "User enabled",
  "User deleted",
  "Password reset",
  "Role changed",
  "Barangay assigned",
  "Staff request approved",
  "Staff request rejected",
  "Staff request documents requested",
  "Health Supervisor verified",
  "Health Supervisor rejected",
  "Certificate status changed",
  "Resident updated",
];

const STATUS_TONES = {
  Success: "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400",
  Info: "bg-brand-blue/10 text-brand-blue dark:bg-brand-blue/15",
  Warning: "bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400",
};

let cache = null;

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
  return cache;
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
  listeners.forEach((cb) => cb());
};
const subscribe = (cb) => {
  listeners.add(cb);
  return () => listeners.delete(cb);
};
const getSnapshot = () => read();
const getEvents = () => read().map((e) => ({ ...e }));

/** Append an audit event. `by` is the acting user's name/role label. */
const addEvent = ({ user = "Admin", role = "Admin", action, description = "", status = "Success" }) => {
  if (!action) return null;
  const record = {
    id: `evt-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    user,
    role,
    action,
    description,
    status,
    timestamp: new Date().toISOString(),
  };
  cache = [record, ...read()];
  emit();
  return record;
};

export const useAuditEvents = () => useSyncExternalStore(subscribe, getSnapshot);

export const auditStore = {
  getEvents,
  getSnapshot,
  subscribe,
  addEvent,
  actions: AUDIT_ACTIONS,
  statusTones: STATUS_TONES,
};

export default auditStore;

// Ignore and purge any previously persisted demo events, then persist the
// empty snapshot so the session starts with no fabricated entries.
try {
  LEGACY_STORAGE_KEYS.forEach((key) => window.sessionStorage.removeItem(key));
} catch {
  /* ignore */
}
read();
persist();
