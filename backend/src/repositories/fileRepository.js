/**
 * File-backed repository driver. Implements the same repository contract as the
 * Supabase driver (see `supabaseRepository.js`) but persists to the local JSON
 * store, so the full resident -> RHU -> PHN workflow runs without Supabase.
 *
 * All records use the canonical camelCase domain shape. Lists join residents
 * into visit/referral rows under a `resident` field.
 */
import store from './fileStore.js';
import { residentId, healthRecordNo, submissionId, referralId } from './ids.js';

const clone = (value) => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)));

const normalizeText = (value) => String(value ?? '').trim().toLowerCase().replace(/\s+/g, ' ');

const attachResidentToVisit = (visit, residentsById) => ({
  ...visit,
  resident: residentsById[visit.residentId] || null,
});

const attachResidentToReferral = (referral, residentsById) => ({
  ...referral,
  resident: residentsById[referral.residentId] || null,
});

const nextResident = (data) => {
  data.counters.residents += 1;
  const n = data.counters.residents;
  return { id: residentId(n), healthRecordNo: healthRecordNo(n) };
};

const nextSubmission = (data) => {
  data.counters.submissions += 1;
  return { id: submissionId(data.counters.submissions) };
};

const nextReferral = (data) => {
  data.counters.referrals += 1;
  return { id: referralId(data.counters.referrals) };
};

const matchesQuery = (row, q) => {
  const query = normalizeText(q);
  if (!query) return true;
  const haystack = [
    row.healthRecordNo,
    row.lastName,
    row.firstName,
    row.middleName,
    row.suffix,
    row.philhealthNo,
    row.cellphoneNo,
    row.currentAddress,
    row.barangay,
  ]
    .map((v) => normalizeText(v))
    .join(' ');
  return haystack.includes(query);
};

export const fileRepository = {
  driver: 'file',

  // ----- identifiers -------------------------------------------------------
  nextResidentIds: () => store.mutate((data) => nextResident(data)),
  nextSubmissionId: () => store.mutate((data) => nextSubmission(data)),
  nextReferralId: () => store.mutate((data) => nextReferral(data)),

  // ----- residents ---------------------------------------------------------
  searchResidents: async ({ q = '', limit = 20 } = {}) => {
    const residents = store.residents.filter((r) => matchesQuery(r, q)).slice(0, limit);
    return clone(residents);
  },

  findResidentByIdentity: async ({ lastName, firstName, middleName, birthDate } = {}) => {
    const last = normalizeText(lastName);
    const first = normalizeText(firstName);
    const mid = normalizeText(middleName);
    const dob = String(birthDate || '');
    const match = store.residents.find(
      (r) =>
        normalizeText(r.lastName) === last &&
        normalizeText(r.firstName) === first &&
        (mid ? normalizeText(r.middleName) === mid : true) &&
        (dob ? r.birthDate === dob : true),
    );
    return match ? clone(match) : null;
  },

  getResident: async (id) => {
    const found = store.residents.find((r) => r.id === id);
    return found ? clone(found) : null;
  },

  insertResident: async (resident) => {
    return store.mutate((data) => {
      const now = new Date().toISOString();
      const row = {
        id: resident.id,
        healthRecordNo: resident.healthRecordNo,
        createdAt: now,
        updatedAt: now,
        ...resident,
      };
      delete row.age;
      data.residents.push(row);
      return clone(row);
    });
  },

  updateResident: async (id, patch) => {
    return store.mutate((data) => {
      const row = data.residents.find((r) => r.id === id);
      if (!row) return null;
      const next = { ...row, ...patch, updatedAt: new Date().toISOString() };
      delete next.age;
      Object.assign(row, next);
      return clone(row);
    });
  },

  // ----- visits / submissions ----------------------------------------------
  insertVisit: async (visit) => {
    return store.mutate((data) => {
      const now = new Date().toISOString();
      const row = { createdAt: now, updatedAt: now, ...visit };
      data.visits.push(row);
      const residentsById = Object.fromEntries(data.residents.map((r) => [r.id, r]));
      return attachResidentToVisit(clone(row), residentsById);
    });
  },

  getVisit: async (id) => {
    const found = store.visits.find((v) => v.id === id);
    if (!found) return null;
    const residentsById = Object.fromEntries(store.residents.map((r) => [r.id, r]));
    return attachResidentToVisit(clone(found), residentsById);
  },

  listVisits: async ({ q = '', statuses = null, submittedById = null, residentId = null, limit = 100, offset = 0 } = {}) => {
    const residentsById = Object.fromEntries(store.residents.map((r) => [r.id, r]));
    let rows = store.visits.map((v) => attachResidentToVisit(clone(v), residentsById));

    if (statuses && statuses.length) rows = rows.filter((v) => statuses.includes(v.status));
    if (submittedById) rows = rows.filter((v) => v.recordedById === submittedById);
    if (residentId) rows = rows.filter((v) => v.residentId === residentId);
    if (q) {
      const query = normalizeText(q);
      rows = rows.filter(
        (v) =>
          (v.resident && matchesQuery(v.resident, query)) ||
          normalizeText(v.id).includes(query) ||
          normalizeText(v.chiefComplaint).includes(query),
      );
    }

    rows.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
    return { rows: rows.slice(offset, offset + limit), total: rows.length };
  },

  updateVisit: async (id, patch) => {
    return store.mutate((data) => {
      const row = data.visits.find((v) => v.id === id);
      if (!row) return null;
      const residentsById = Object.fromEntries(data.residents.map((r) => [r.id, r]));
      const next = { ...row, ...patch, updatedAt: new Date().toISOString() };
      Object.assign(row, next);
      return attachResidentToVisit(clone(row), residentsById);
    });
  },

  // ----- referrals ----------------------------------------------------------
  insertReferral: async (referral) => {
    return store.mutate((data) => {
      const now = new Date().toISOString();
      const row = { createdAt: now, updatedAt: now, ...referral };
      data.referrals.push(row);
      const residentsById = Object.fromEntries(data.residents.map((r) => [r.id, r]));
      return { ...clone(row), resident: residentsById[row.residentId] || null };
    });
  },

  getReferral: async (id) => {
    const found = store.referrals.find((r) => r.id === id);
    if (!found) return null;
    const residentsById = Object.fromEntries(store.residents.map((r) => [r.id, r]));
    return attachResidentToReferral(clone(found), residentsById);
  },

  getReferralByVisitId: async (visitId) => {
    const found = store.referrals.find((r) => r.visitId === visitId);
    if (!found) return null;
    const residentsById = Object.fromEntries(store.residents.map((r) => [r.id, r]));
    return attachResidentToReferral(clone(found), residentsById);
  },

  updateReferral: async (id, patch) => {
    return store.mutate((data) => {
      const row = data.referrals.find((r) => r.id === id);
      if (!row) return null;
      const next = { ...row, ...patch, updatedAt: new Date().toISOString() };
      Object.assign(row, next);
      const residentsById = Object.fromEntries(data.residents.map((r) => [r.id, r]));
      return { ...clone(row), resident: residentsById[row.residentId] || null };
    });
  },

  listReferrals: async ({ q = '', residentId = null, limit = 100, offset = 0 } = {}) => {
    const residentsById = Object.fromEntries(store.residents.map((r) => [r.id, r]));
    let rows = store.referrals.map((r) => attachResidentToReferral(clone(r), residentsById));
    if (residentId) rows = rows.filter((r) => r.residentId === residentId);
    if (q) {
      const query = normalizeText(q);
      rows = rows.filter((r) => matchesQuery(r.resident || {}, query) || normalizeText(r.id).includes(query));
    }
    rows.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
    return { rows: rows.slice(offset, offset + limit), total: rows.length };
  },
};

export default fileRepository;
