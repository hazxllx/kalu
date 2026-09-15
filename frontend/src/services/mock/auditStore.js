import React, { useSyncExternalStore } from "react";

/**
 * Shared frontend audit store (demo only).
 *
 * Central place where admin-side actions (user management, staff requests,
 * supervisor verification, certificate decisions, resident edits) record audit
 * events. The Admin Audit Trail page renders this store merged with the
 * permission-change trail.
 *
 * Backend preparation note: this store mirrors the future audit-events
 * service — see docs/backend/README.md. Backend implementation is
 * intentionally NOT included.
 */

const STORAGE_KEY = "kalusagap.audit.v1";

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

/** Seed events covering every required mock action (timestamps relative to now). */
const isoFromToday = (offsetDays, hours) => {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  d.setHours(hours, 0, 0, 0);
  return d.toISOString();
};

const event = (f) => ({
  id: f.id,
  user: f.user,
  role: f.role,
  action: f.action,
  description: f.description,
  status: f.status || "Success",
  timestamp: f.timestamp,
});

const SEED = [
  event({ id: 1, user: "Jose Ramirez", role: "Admin", action: "Login", description: "Signed in to KALUSAGAP.", timestamp: isoFromToday(0, 8) }),
  event({ id: 2, user: "Jose Ramirez", role: "Admin", action: "User created", description: "Created user account (Nurse L. Ramos).", timestamp: isoFromToday(0, 9) }),
  event({ id: 3, user: "Jose Ramirez", role: "Admin", action: "Role changed", description: "Changed role of Lourdes Ramos to Barangay Health Worker.", status: "Warning", timestamp: isoFromToday(0, 9) }),
  event({ id: 4, user: "Jose Ramirez", role: "Admin", action: "Barangay assigned", description: "Assigned Lourdes Ramos to Barangay San Isidro.", timestamp: isoFromToday(0, 9) }),
  event({ id: 5, user: "Dr. Maria L. Santos", role: "Municipal Health Officer", action: "Certificate status changed", description: "Set certificate MC-2026-0002 to For Review.", timestamp: isoFromToday(0, 10) }),
  event({ id: 6, user: "Maria Dela Cruz", role: "Health Supervisor", action: "Resident updated", description: "Updated resident record R-1024.", timestamp: isoFromToday(0, 11) }),
  event({ id: 7, user: "Jose Ramirez", role: "Admin", action: "Staff request approved", description: "Approved staff request of Nurse Ana Villanueva.", timestamp: isoFromToday(-1, 15) }),
  event({ id: 8, user: "Jose Ramirez", role: "Admin", action: "Staff request rejected", description: "Rejected staff request — incomplete credentials.", status: "Warning", timestamp: isoFromToday(-1, 16) }),
  event({ id: 9, user: "Ana Villanueva", role: "Public Health Nurse", action: "Logout", description: "Signed out of KALUSAGAP.", status: "Info", timestamp: isoFromToday(-1, 17) }),
  event({ id: 10, user: "Jose Ramirez", role: "Admin", action: "User disabled", description: "Disabled account of Roberto Lim.", status: "Warning", timestamp: isoFromToday(-2, 10) }),
  event({ id: 11, user: "Jose Ramirez", role: "Admin", action: "Password reset", description: "Reset password for Maria Cruz.", timestamp: isoFromToday(-2, 11) }),
  event({ id: 12, user: "Jose Ramirez", role: "Admin", action: "User updated", description: "Updated contact details of Maria Cruz.", timestamp: isoFromToday(-2, 11) }),
  event({ id: 13, user: "Jose Ramirez", role: "Admin", action: "Health Supervisor verified", description: "Verified Health Supervisor account of Maria Dela Cruz (San Isidro).", timestamp: isoFromToday(-3, 9) }),
  event({ id: 14, user: "Maria Santos", role: "Resident", action: "Login", description: "Signed in to KALUSAGAP.", timestamp: isoFromToday(-3, 12) }),
];

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
  cache = SEED.map((e) => ({ ...e }));
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
