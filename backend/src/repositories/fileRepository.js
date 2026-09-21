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

/** Canonical dev barangays (single-municipality file driver). */
const DEV_BARANGAYS = Object.freeze(['San Isidro', 'San Antonio', 'Old San Roque']);

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
  /**
   * Scope-aware directory listing (mirrors the Supabase driver). The file
   * driver is single-municipality dev data, so `municipalityId` is ignored and
   * barangay filtering uses the stored text. Returns { rows, total }.
   */
  listResidents: async ({ q = '', limit = 50, offset = 0, barangay = null, municipalityId = null } = {}) => {
    let rows = store.residents.filter((r) => matchesQuery(r, q));
    if (barangay) rows = rows.filter((r) => r.barangay === barangay);
    const total = rows.length;
    return { rows: clone(rows.slice(offset, offset + limit)), total };
  },

  findBarangayByName: async (name) => {
    const match = DEV_BARANGAYS.find(
      (b) => b.toLowerCase() === String(name || '').trim().toLowerCase(),
    );
    return match ? { id: `dev-${match}`, name: match, municipalityId: null, municipality: null } : null;
  },

  // ----- households ---------------------------------------------------------
  // Household records are Supabase-backed only (Phase 5 schema); the local
  // file driver has no household store, so these fail closed with a clear
  // message instead of returning fake data.
  householdsUnsupported: async () => {
    throw Object.assign(new Error('Household records require the Supabase data driver. Configure SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in backend/.env.'), { statusCode: 503 });
  },

  listHouseholds: async function () { return this.householdsUnsupported(); },
  getHousehold: async function () { return this.householdsUnsupported(); },
  insertHousehold: async function () { return this.householdsUnsupported(); },
  updateHousehold: async function () { return this.householdsUnsupported(); },
  findHouseholdDuplicate: async function () { return this.householdsUnsupported(); },
  addHouseholdMember: async function () { return this.householdsUnsupported(); },
  removeHouseholdMember: async function () { return this.householdsUnsupported(); },

  searchResidents: async ({ q = '', limit = 20 } = {}) => {
    const residents = store.residents.filter((r) => matchesQuery(r, q)).slice(0, limit);
    return clone(residents);
  },

  findResidentByIdentity: async ({ lastName, firstName, middleName, birthDate, identityNo } = {}) => {
    if (identityNo) {
      const match = store.residents.find((r) => r.identityNo && r.identityNo === String(identityNo).trim());
      return match ? clone(match) : null;
    }
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

  // ----- manual resident verification --------------------------------------
  /** Verification queue (mirrors the Supabase driver). Returns { rows, total }. */
  listResidentsByVerificationStatus: async ({
    statuses = null,
    q = '',
    barangay = null,
    municipalityId = null,
    limit = 100,
    offset = 0,
  } = {}) => {
    let rows = store.residents.slice();
    if (statuses && statuses.length) {
      rows = rows.filter((r) => statuses.includes(r.verificationStatus || 'pending'));
    }
    if (q) rows = rows.filter((r) => matchesQuery(r, q));
    if (barangay) rows = rows.filter((r) => r.barangay === barangay);
    rows.sort((a, b) =>
      String(a.submittedForVerificationAt || a.createdAt || '').localeCompare(
        String(b.submittedForVerificationAt || b.createdAt || ''),
      ),
    );
    const total = rows.length;
    return { rows: clone(rows.slice(offset, offset + limit)), total };
  },

  /** The file driver has no accounts, so there is no profile status to sync. */
  setProfileStatus: async () => null,

  insertResidentVerificationLog: async (log) => {
    return store.mutate((data) => {
      const row = {
        id: `RVL-${String(data.residentVerificationLogs.length + 1).padStart(6, '0')}`,
        residentId: log.residentId,
        reviewedBy: log.reviewedBy ?? null,
        action: log.action,
        reason: log.reason || '',
        previousStatus: log.previousStatus ?? null,
        newStatus: log.newStatus,
        createdAt: new Date().toISOString(),
      };
      data.residentVerificationLogs.push(row);
      return clone(row);
    });
  },

  listResidentVerificationLogs: async (residentId, { limit = 50 } = {}) => {
    const rows = store.residentVerificationLogs
      .filter((l) => l.residentId === residentId)
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
      .slice(0, limit);
    return clone(rows);
  },

  listRecentResidentVerificationLogs: async ({ actions = null, barangay = null, municipalityId = null, limit = 100, offset = 0 } = {}) => {
    const residentsById = Object.fromEntries(store.residents.map((r) => [r.id, r]));
    let rows = store.residentVerificationLogs.map((l) => {
      const resident = residentsById[l.residentId] || {};
      return {
        ...clone(l),
        residentName: [resident.firstName, resident.lastName].filter(Boolean).join(' ').trim(),
        residentRef: resident.id || l.residentId,
        barangay: resident.barangay || '',
        residentStatus: resident.verificationStatus || '',
      };
    });
    if (actions && actions.length) rows = rows.filter((l) => actions.includes(l.action));
    if (barangay) rows = rows.filter((l) => l.barangay === barangay);
    rows.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    return { rows: rows.slice(offset, offset + limit), total: rows.length };
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

  // ----- resident account link ---------------------------------------------
  /**
   * The resident record linked to a signed-in account. Residents are linked by
   * `authUserId` (set during registration), never by a client-supplied id.
   */
  getResidentByAuthUserId: async (authUserId) => {
    const found = store.residents.find((r) => r.authUserId && r.authUserId === authUserId);
    return found ? clone(found) : null;
  },

  claimResidentForAccount: async ({ authUserId, identityNo, birthDate }) => {
    return store.mutate((data) => {
      const found = data.residents.find(
        (r) => !r.authUserId && r.identityNo && r.identityNo === String(identityNo || '').trim() && r.birthDate === birthDate,
      );
      if (!found) return null;
      found.authUserId = authUserId;
      found.updatedAt = new Date().toISOString();
      return clone(found);
    });
  },

  createTransferRequest: async ({ authUserId, otpHash, otpExpiresAt }) => store.mutate((data) => {
    const row = { id: crypto.randomUUID(), authUserId, auth_user_id: authUserId, status: 'pending', otpHash, otp_hash: otpHash, otpExpiresAt, otp_expires_at: otpExpiresAt, otpAttempts: 0, otp_attempts: 0, otpVerifiedAt: null, otp_verified_at: null, createdAt: new Date().toISOString(), created_at: new Date().toISOString() };
    data.transferRequests.push(row);
    return clone(row);
  }),
  getTransferRequest: async (id, authUserId = null) => {
    const row = store.transferRequests.find((item) => item.id === id && (!authUserId || item.authUserId === authUserId));
    return row ? clone(row) : null;
  },
  getLatestTransferRequest: async (authUserId) => {
    const rows = store.transferRequests.filter((item) => item.authUserId === authUserId);
    return rows.length ? clone(rows[rows.length - 1]) : null;
  },
  updateTransferRequest: async (id, patch) => store.mutate((data) => {
    const row = data.transferRequests.find((item) => item.id === id);
    if (!row) return null;
    Object.assign(row, patch, { updatedAt: new Date().toISOString() });
    return clone(row);
  }),
  listTransferRequests: async ({ status = null, limit = 100, offset = 0 } = {}) => {
    let rows = store.transferRequests.slice();
    if (status) rows = rows.filter((row) => row.status === status);
    return { rows: clone(rows.slice(offset, offset + limit)), total: rows.length };
  },
  approveTransferRequest: async ({ requestId, reviewerId, residentId }) => store.mutate((data) => {
    const request = data.transferRequests.find((row) => row.id === requestId);
    const resident = data.residents.find((row) => row.id === residentId && !row.authUserId);
    if (!request || !resident || !request.otpVerifiedAt || !['pending', 'under_review'].includes(request.status)) return null;
    resident.authUserId = request.authUserId;
    request.status = 'approved';
    request.targetResidentId = resident.id;
    request.reviewedBy = reviewerId;
    request.reviewedAt = new Date().toISOString();
    return clone(request);
  }),
  insertTransferAuditLog: async ({ transferRequestId, actorId, action, metadata = {} }) => store.mutate((data) => {
    const row = { id: crypto.randomUUID(), transferRequestId, actorId, action, metadata, createdAt: new Date().toISOString() };
    data.transferRequestAuditLogs.push(row);
    return clone(row);
  }),
  listDocumentsByTransferRequest: async () => [],
  deleteDocument: async () => true,

};

export default fileRepository;
