import React, { useSyncExternalStore } from "react";

import { systemUsers } from "@/services/mock/mockData";

/**
 * Admin user management store (frontend demo).
 *
 * Seeds from the shared `systemUsers` mock list and remembers admin actions
 * (create/edit/disable/enable/reset/delete, role and barangay assignment) for
 * the current browser session. Backend implementation is intentionally NOT
 * included — see docs/backend/README.md.
 */

const STORAGE_KEY = "kalusagap.admin-users.v1";

/** Roles an admin may assign (existing project roles only). */
export const ASSIGNABLE_ROLES = [
  "System Administrator",
  "Municipal Health Officer",
  "Public Health Nurse",
  "Health Supervisor",
  "RHU Personnel",
  "Barangay Health Worker",
  "Resident",
];

/** Barangay-scoped roles require a barangay; others must have none. */
export const BARANGAY_SCOPED_ROLES = ["Health Supervisor", "Barangay Health Worker"];

export const USER_STATUSES = ["Active", "Disabled"];

/** Roles that must NOT carry a barangay assignment. */
const roleExpectsBarangay = (role) => BARANGAY_SCOPED_ROLES.includes(role);

/** Validate a role + barangay combination. Returns an error string or "". */
export const validateAssignment = (role, barangay) => {
  if (roleExpectsBarangay(role) && !barangay) {
    return `${role} accounts require an assigned barangay.`;
  }
  if (!roleExpectsBarangay(role) && barangay) {
    return `${role} accounts are not assigned to a barangay.`;
  }
  return "";
};

const buildSeed = () =>
  systemUsers.map((u, i) => ({
    id: `USR-${String(1000 + i)}`,
    name: u.name,
    email: `${u.name.toLowerCase().replace(/[^a-z ]/g, "").replace(/ /g, ".")}@kalusagap.test`,
    contact: "0917 000 0000",
    role: u.role,
    barangay: u.barangay || "",
    status: u.status || "Active",
    createdAt: "2026-01-15T09:00:00.000Z",
  }));

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
  cache = buildSeed();
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
const getUsers = () => read().map((u) => ({ ...u }));

/** Create a user. `validateAssignment` must be checked by the caller. */
const addUser = (payload) => {
  const record = {
    id: `USR-${Date.now().toString().slice(-6)}`,
    name: payload.name.trim(),
    email: payload.email.trim(),
    contact: payload.contact.trim(),
    role: payload.role,
    barangay: roleExpectsBarangay(payload.role) ? payload.barangay : "",
    status: payload.status || "Active",
    createdAt: new Date().toISOString(),
  };
  cache = [record, ...read()];
  emit();
  return record;
};

/** Update a user's editable fields (name, contact, role, barangay, status). */
const updateUser = (id, payload) => {
  cache = read().map((u) =>
    u.id === id ? { ...u, ...payload, id, barangay: roleExpectsBarangay(payload.role ?? u.role) ? payload.barangay ?? u.barangay : "" } : u
  );
  emit();
  return read().find((u) => u.id === id) || null;
};

/** Enable or disable an account (soft status change, never a delete). */
const setUserStatus = (id, status) => {
  cache = read().map((u) => (u.id === id ? { ...u, status } : u));
  emit();
};

/** Frontend-only password reset flag (no email is sent). */
const resetPassword = (id) => {
  cache = read().map((u) => (u.id === id ? { ...u, passwordResetAt: new Date().toISOString() } : u));
  emit();
};

/** Delete a user. Only disabled accounts may be deleted (enforced by the UI). */
const deleteUser = (id) => {
  cache = read().filter((u) => u.id !== id);
  emit();
};

export const useAdminUsers = () => useSyncExternalStore(subscribe, getSnapshot);

export const adminUserStore = {
  getUsers,
  getSnapshot,
  subscribe,
  addUser,
  updateUser,
  setUserStatus,
  resetPassword,
  deleteUser,
  assignableRoles: ASSIGNABLE_ROLES,
  validateAssignment,
};

export default adminUserStore;
