import React, { useSyncExternalStore } from "react";

import { nextHouseholdId } from "@/features/households/lib/householdOptions";

/**
 * Session-scoped household registry.
 *
 * Contains no demo data: the household collection starts empty. This is the
 * in-session working set used until the backend endpoint persists to the
 * database; the shape pages expect is preserved, including the
 * `syncStatus: "Pending Sync"` offline tag on newly created records, so no
 * separate household model is introduced.
 */

const STORAGE_KEY = "kalusagap.households.session.v2";

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
    /* fall through to empty working set */
  }
  cache = [];
  persist();
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

const SYNC_KEY = "kalusagap.households.sync.v2";

let syncCache = null;

const readSync = () => {
  if (syncCache) return syncCache;
  try {
    const raw = window.sessionStorage.getItem(SYNC_KEY);
    if (raw) {
      syncCache = raw;
      return syncCache;
    }
  } catch {
    /* ignore */
  }
  // No connection established yet in this session.
  syncCache = "offline";
  return syncCache;
};

const setSync = (value) => {
  syncCache = value;
  try {
    window.sessionStorage.setItem(SYNC_KEY, value);
  } catch {
    /* storage may be unavailable */
  }
  listeners.forEach((cb) => cb());
};

const getSnapshot = () => read();
const getSyncStatus = () => readSync();

const getHouseholds = () => read().map((h) => ({ ...h }));

const addHousehold = (household) => {
  const list = read();
  // New snapshot array so subscribers (useSyncExternalStore) re-render.
  cache = [household, ...list];
  emit();
  return household;
};

const markAllSynced = () => {
  const list = read();
  cache = list.map((h) => ({ ...h, syncStatus: null }));
  emit();
};

/**
 * Apply a Health Supervisor verification outcome to a household record so the
 * BHW household list shows the same result (verification status, reviewer,
 * review date, and correction reason). Shared by both roles — one store.
 */
const applyVerification = (householdId, { status, reviewer, reviewedAt, reason = "" }) => {
  const list = read();
  cache = list.map((h) =>
    h.id === householdId
      ? { ...h, verificationStatus: status, verifiedBy: reviewer, verifiedAt: reviewedAt, correctionReason: reason }
      : h
  );
  emit();
};

const clearSession = () => {
  cache = [];
  persist();
  emit();
};

/** React hook returning the live household list. */
export const useHouseholds = () => useSyncExternalStore(subscribe, getSnapshot);

/** React hook returning the shared session sync status (offline/syncing/connected). */
export const useHouseholdSyncStatus = () => useSyncExternalStore(subscribe, getSyncStatus);

export const householdStore = {
  getHouseholds,
  getSnapshot,
  subscribe,
  addHousehold,
  markAllSynced,
  applyVerification,
  clearSession,
  getSyncStatus,
  setSync,
  nextId: (list) => nextHouseholdId(list || read()),
};

export default householdStore;
