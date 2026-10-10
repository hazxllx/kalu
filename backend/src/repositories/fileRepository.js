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
import { DEFAULT_RISK_CRITERIA } from '../config/riskConfig.js';
import { DEFAULT_MEDICINES, medicineIdentityKey } from '../config/medicineCatalog.js';

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

  /** Canonical dev barangays as id/name rows for selection lists. */
  listBarangays: async () => DEV_BARANGAYS.map((name) => ({
    id: `dev-${name}`, name, municipality_id: null, status: 'active',
  })),

  // The file driver is single-municipality and has no municipalities store, so
  // there is no centre coordinate to return; the map falls back to framing the
  // plotted barangays.
  getMunicipality: async () => null,

  // ----- households ---------------------------------------------------------
  // Household records are Supabase-backed only; the local
  // file driver has no household store, so these fail closed with a clear
  // message instead of returning fake data.
  householdsUnsupported: async () => {
    throw Object.assign(new Error('Household records require the Supabase data driver. Configure SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in backend/.env.'), { statusCode: 503 });
  },

  listHouseholds: async function () { return this.householdsUnsupported(); },
  listHouseholdsForMap: async function () { return this.householdsUnsupported(); },
  getHousehold: async function () { return this.householdsUnsupported(); },
  insertHousehold: async function () { return this.householdsUnsupported(); },
  updateHousehold: async function () { return this.householdsUnsupported(); },
  findHouseholdDuplicate: async function () { return this.householdsUnsupported(); },
  addHouseholdMember: async function () { return this.householdsUnsupported(); },
  removeHouseholdMember: async function () { return this.householdsUnsupported(); },
  getMemberHealthProfile: async function () { return this.householdsUnsupported(); },
  upsertMemberHealthProfile: async function () { return this.householdsUnsupported(); },
  searchResidents: async ({ q = '', limit = 20, barangay = null, municipalityId = null } = {}) => {
    const residents = store.residents
      .filter((r) => matchesQuery(r, q))
      .filter((r) => !barangay || String(r.barangay || '').toLowerCase() === String(barangay).toLowerCase())
      .filter((r) => !municipalityId || r.municipalityId === municipalityId)
      .slice(0, limit);
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

  listTclEntries: async () => ({ rows: [], total: 0 }),

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

  createTransferRequest: async ({
    authUserId, residentId = null, fromBarangayId = null, toBarangayId = null,
    reason = '', status = 'draft', otpHash = null, otpExpiresAt = null,
  }) => store.mutate((data) => {
    const now = new Date().toISOString();
    const row = {
      id: crypto.randomUUID(), authUserId, auth_user_id: authUserId,
      residentId, resident_id: residentId,
      fromBarangayId, from_barangay_id: fromBarangayId,
      toBarangayId, to_barangay_id: toBarangayId,
      reason, status,
      otpHash, otp_hash: otpHash, otpExpiresAt, otp_expires_at: otpExpiresAt,
      otpAttempts: 0, otp_attempts: 0, otpVerifiedAt: null, otp_verified_at: null,
      createdAt: now, created_at: now, updatedAt: now, updated_at: now,
    };
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
  listTransferRequestsByUser: async (authUserId) => {
    const rows = store.transferRequests
      .filter((item) => item.authUserId === authUserId)
      .slice()
      .reverse();
    return clone(rows);
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
  approveTransferRequest: async ({ requestId, reviewerId }) => store.mutate((data) => {
    const request = data.transferRequests.find((row) => row.id === requestId);
    if (!request || !['pending', 'under_review'].includes(request.status)) return null;
    if (!request.residentId || !request.toBarangayId) return null;
    const resident = data.residents.find((row) => row.id === request.residentId);
    if (!resident) return null;
    // Change ONLY the resident's current barangay; keep id, account link, records.
    // The Supabase driver relies on the residents_sync_scope trigger to copy the
    // canonical barangay NAME from barangay_id into the free-text `barangay`
    // column. The file driver has no trigger, so resolve the destination name
    // here — otherwise the resident's displayed "Current Barangay" would show the
    // raw id (e.g. "dev-San Antonio") instead of "San Antonio" after approval.
    const destinationName = DEV_BARANGAYS.find((name) => `dev-${name}` === request.toBarangayId)
      || request.toBarangayId;
    resident.barangayId = request.toBarangayId;
    resident.barangay = destinationName;
    request.status = 'approved';
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

  // ----- risk configuration (dev driver) -----------------------------------
  // Mirrors the Supabase risk_criteria / risk_settings tables. The config
  // service falls back to the documented defaults when these are empty, so the
  // store only needs to persist administrator overrides.
  listRiskCriteria: async () => clone(store.riskCriteria),

  getRiskCriterion: async (code) => {
    const found = store.riskCriteria.find((c) => c.code === code);
    return found ? clone(found) : null;
  },

  upsertRiskCriterion: async (criterion) => store.mutate((data) => {
    // Seed the defaults on first edit so a single change does not drop the rest.
    if (!data.riskCriteria.length) {
      data.riskCriteria = DEFAULT_RISK_CRITERIA.map((c) => ({ ...c }));
    }
    const now = new Date().toISOString();
    const idx = data.riskCriteria.findIndex((c) => c.code === criterion.code);
    if (idx >= 0) {
      data.riskCriteria[idx] = { ...data.riskCriteria[idx], ...criterion, updatedAt: now };
      return clone(data.riskCriteria[idx]);
    }
    const row = { ...criterion, createdAt: now, updatedAt: now };
    data.riskCriteria.push(row);
    return clone(row);
  }),

  deleteRiskCriterion: async (code) => store.mutate((data) => {
    if (!data.riskCriteria.length) {
      data.riskCriteria = DEFAULT_RISK_CRITERIA.map((c) => ({ ...c }));
    }
    const before = data.riskCriteria.length;
    data.riskCriteria = data.riskCriteria.filter((c) => c.code !== code);
    return before !== data.riskCriteria.length;
  }),

  getRiskSettings: async () => (store.riskSettings ? clone(store.riskSettings) : null),

  saveRiskSettings: async ({ moderateMin, highMin }) => store.mutate((data) => {
    const now = new Date().toISOString();
    data.riskSettings = {
      moderateMin: Number(moderateMin),
      highMin: Number(highMin),
      updatedAt: now,
    };
    return clone(data.riskSettings);
  }),

  insertHealthAuditLog: async (log) => store.mutate((data) => {
    const row = {
      id: `HAL-${String(data.healthAuditLogs.length + 1).padStart(6, '0')}`,
      actorId: log.actorId ?? null,
      action: log.action,
      entityType: log.entityType,
      entityId: log.entityId,
      municipalityId: log.municipalityId ?? null,
      barangayId: log.barangayId ?? null,
      metadata: log.metadata || {},
      createdAt: new Date().toISOString(),
    };
    data.healthAuditLogs.push(row);
    return clone(row);
  }),

  // ----- blood-pressure thresholds (dev driver) ----------------------------
  getBpThresholdSettings: async () => (store.bpThresholdSettings ? clone(store.bpThresholdSettings) : null),

  saveBpThresholdSettings: async (settings) => store.mutate((data) => {
    data.bpThresholdSettings = { ...settings, updatedAt: new Date().toISOString() };
    return clone(data.bpThresholdSettings);
  }),

  // ----- medicine catalog (dev driver) --------------------------------------
  // Seeds the documented default catalog on first access so the dev/test
  // backend behaves like a freshly-migrated database.
  listMedicines: async ({ q = '', source = '', includeInactive = false } = {}) => store.mutate((data) => {
    if (!data.medicines.length) {
      const now = new Date().toISOString();
      data.medicines = DEFAULT_MEDICINES.map((m) => ({
        id: crypto.randomUUID(),
        genericName: m.genericName,
        brandName: m.brandName || '',
        strength: m.strength || '',
        dosageForm: m.dosageForm || '',
        category: m.category || '',
        source: m.source || 'local',
        active: true,
        createdBy: null,
        createdAt: now,
        updatedAt: now,
      }));
    }
    const query = normalizeText(q);
    return data.medicines
      .filter((m) => (includeInactive ? true : m.active !== false))
      .filter((m) => (source ? m.source === source : true))
      .filter((m) => {
        if (!query) return true;
        return [m.genericName, m.brandName, m.strength, m.dosageForm, m.category]
          .some((field) => normalizeText(field).includes(query));
      })
      .sort((a, b) => String(a.genericName).localeCompare(String(b.genericName)))
      .map((m) => clone(m));
  }),

  getMedicine: async (id) => {
    const found = store.medicines.find((m) => m.id === id);
    return found ? clone(found) : null;
  },

  findMedicineByIdentity: async (entry) => {
    const key = medicineIdentityKey(entry);
    const found = store.medicines.find((m) => medicineIdentityKey(m) === key);
    return found ? clone(found) : null;
  },

  insertMedicine: async (medicine) => store.mutate((data) => {
    const now = new Date().toISOString();
    const row = {
      id: crypto.randomUUID(),
      genericName: medicine.genericName,
      brandName: medicine.brandName || '',
      strength: medicine.strength || '',
      dosageForm: medicine.dosageForm || '',
      category: medicine.category || '',
      source: medicine.source || 'local',
      active: medicine.active === undefined ? true : Boolean(medicine.active),
      createdBy: medicine.createdBy ?? null,
      createdAt: now,
      updatedAt: now,
    };
    data.medicines.push(row);
    return clone(row);
  }),

  updateMedicine: async (id, patch) => store.mutate((data) => {
    const idx = data.medicines.findIndex((m) => m.id === id);
    if (idx < 0) return null;
    data.medicines[idx] = { ...data.medicines[idx], ...patch, id, updatedAt: new Date().toISOString() };
    return clone(data.medicines[idx]);
  }),

  listMedicineAvailability: async (medicineId) =>
    store.medicineAvailability.filter((a) => a.medicineId === medicineId).map((a) => clone(a)),

  listMedicineAvailabilityForFacility: async (facilityId) =>
    store.medicineAvailability.filter((a) => a.facilityId === facilityId).map((a) => clone(a)),

  upsertMedicineAvailability: async ({ medicineId, facilityId, available, note, updatedBy }) => store.mutate((data) => {
    const idx = data.medicineAvailability.findIndex((a) => a.medicineId === medicineId && a.facilityId === facilityId);
    const row = {
      medicineId,
      facilityId,
      available: Boolean(available),
      note: note || '',
      updatedBy: updatedBy ?? null,
      updatedAt: new Date().toISOString(),
    };
    if (idx >= 0) data.medicineAvailability[idx] = row;
    else data.medicineAvailability.push(row);
    return clone(row);
  }),

  // The file (dev) driver has no facilities registry.
  listFacilities: async () => [],

};

export default fileRepository;
