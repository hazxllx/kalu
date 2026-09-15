import React, { useSyncExternalStore } from "react";

import { residents as SEED_RESIDENTS } from "@/services/mock/mockData";
import { BARANGAYS } from "@/lib/barangays";

/**
 * Session-scoped resident registry (frontend demo store).
 *
 * Mirrors the existing mock-data architecture: it is seeded from the shared
 * `mockData.residents` directory list and remembers residents created during
 * the current browser session (kept in `sessionStorage` so new residents also
 * survive a page refresh within the same tab). The record shape is the SAME
 * shape the resident directory already renders:
 *
 *   { id, name, age, gender, risk, barangay, status, program }
 *
 * plus a few extra profile fields captured by the Add Resident form (DOB,
 * contact number, address, civil status) that are displayed by the resident
 * detail view. No separate or duplicated resident model is introduced.
 *
 * Other features that read the shared directory list keep using the seed
 * module directly; this store only manages directory additions made from the
 * Resident Directory page.
 */

const STORAGE_KEY = "kalusagap.residents.session.v1";

const PROGRAM_OPTIONS = [
  "Maternal Care",
  "Child Health",
  "Hypertension",
  "Diabetes",
  "Senior Care",
  "TB Monitoring",
  "Family Planning",
  "General",
];

const cloneSeed = () => SEED_RESIDENTS.map((r) => ({ ...r }));

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
    /* fall through to seed */
  }
  cache = cloneSeed();
  return cache;
};

const persist = () => {
  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(cache || []));
  } catch {
    /* storage may be unavailable */
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

/** Latest resident list (stable array reference for useSyncExternalStore). */
const getSnapshot = () => read();

const getResidents = () => read().map((r) => ({ ...r }));

const initialsOf = (name) =>
  String(name || "")
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

const nextId = () => {
  const list = read();
  const max = list.reduce((acc, r) => {
    const match = String(r.id || "").match(/(\d+)\s*$/);
    return match ? Math.max(acc, parseInt(match[1], 10)) : acc;
  }, 1023);
  return `R-${String(max + 1).padStart(4, "0")}`;
};

/**
 * Demo risk classification for newly registered residents.
 *
 * Resident risk is NOT a manual entry — it is derived automatically when the
 * record is created. This mirrors the pattern already present in the seeded
 * directory (e.g. hypertension/diabetes/senior clients carry a higher risk)
 * and keeps newly added residents consistent with the directory's risk filter
 * and display. It is intentionally a transparent, deterministic heuristic; a
 * clinical ruleset can replace it later.
 *
 * @returns {"Low" | "Medium" | "High"}
 */
const classifyRisk = (program = "", age) => {
  const p = String(program || "").toLowerCase();
  const HIGH = ["hypertension", "diabetes", "stroke", "heart", "cancer"];
  const MEDIUM = ["senior care", "tb", "tuberculosis", "maternal", "child health", "family planning", "mental"];
  const n = Number(age);
  if (HIGH.some((k) => p.includes(k)) || (n >= 60)) return "High";
  if (MEDIUM.some((k) => p.includes(k)) || (n >= 45)) return "Medium";
  return "Low";
};

/**
 * Create a resident from a flat add-form payload:
 *   firstName, middleName, lastName, suffix, dob, age, gender, contact,
 *   address, barangay, civilStatus, program, status
 * Risk is classified automatically (never taken from the form).
 * Returns the created record (and makes it visible immediately).
 */
const addResident = (input) => {
  const list = read();
  const firstName = String(input.firstName || "").trim();
  const middleName = String(input.middleName || "").trim();
  const lastName = String(input.lastName || "").trim();
  const suffix = String(input.suffix || "").trim();

  const nameParts = [firstName, middleName, lastName, suffix].filter(Boolean);
  const age = Number(input.age) || "";
  const houseNo = String(input.houseNo || "").trim();
  const street = String(input.street || "").trim();
  const purok = input.purok || "";
  const addressLine = [houseNo, street, purok].filter(Boolean).join(", ");
  const record = {
    id: nextId(),
    name: nameParts.join(" "),
    age,
    gender: input.gender || "",
    risk: classifyRisk(input.program, age),
    barangay: input.barangay || "",
    status: input.status || "Active",
    program: input.program || "General",
    // Structured address (kept separate so purok/street/house can be shown
    // individually), plus a composed line for the summary display.
    purok,
    street,
    houseNo,
    address: addressLine,
    // Extended profile fields (shown by the resident detail view).
    birthdate: input.dob || "",
    contact: String(input.contact || "").trim(),
    civilStatus: input.civilStatus || "",
  };
  // New snapshot array so subscribers (useSyncExternalStore) re-render.
  cache = [record, ...list];
  emit();
  return record;
};

/**
 * Update an existing resident's editable profile fields (Health Supervisor
 * edit action). Barangay scope is enforced by the calling page — the store
 * only persists the patch. Risk is reclassified automatically when the
 * program or age changes.
 */
const updateResident = (id, patch = {}) => {
  const list = read();
  const existing = list.find((r) => r.id === id);
  if (!existing) return null;
  const next = { ...existing, ...patch, id };
  // Recompose the display address line from structured parts when provided.
  const houseNo = patch.houseNo !== undefined ? patch.houseNo : existing.houseNo;
  const street = patch.street !== undefined ? patch.street : existing.street;
  const purok = patch.purok !== undefined ? patch.purok : existing.purok;
  next.address = [houseNo, street, purok].filter(Boolean).join(", ");
  // Keep risk in sync with the (possibly changed) program / age.
  next.risk = classifyRisk(next.program, next.age);
  cache = list.map((r) => (r.id === id ? next : r));
  emit();
  return { ...next };
};

/** React hook returning the live resident list. */
export const useResidents = () => useSyncExternalStore(subscribe, getSnapshot);

export const residentStore = {
  getResidents,
  getSnapshot,
  subscribe,
  addResident,
  updateResident,
  initialsOf,
};

export { PROGRAM_OPTIONS, BARANGAYS };
export default residentStore;
