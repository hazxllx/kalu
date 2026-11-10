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
import { APPROVED_BARANGAYS } from '../config/barangays.js';
import { randomUUID } from 'node:crypto';
import ApiError from '../utils/apiError.js';

const clone = (value) => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)));

/** Approved dev barangays (single-municipality file driver). */
const DEV_BARANGAYS = APPROVED_BARANGAYS;

const normalizeText = (value) => String(value ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
const zoneFromResidentAddress = (resident) => {
  const text = `${resident?.currentAddress || ''} ${resident?.permanentAddress || ''}`;
  const match = text.match(/\b(?:purok|zone)\s+(?:(?:purok|zone)\s+)*([1-8])\b/i);
  return match ? Number(match[1]) : null;
};
const matchesZone = (resident, zone) => {
  if (zone === 'unassigned') return (resident.zone === null || resident.zone === undefined || resident.zone === '') && !zoneFromResidentAddress(resident);
  return Number(resident.zone) === Number(zone) || zoneFromResidentAddress(resident) === Number(zone);
};

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
  listResidents: async ({ q = '', limit = 50, offset = 0, barangay = null, barangayId = null, zone = null, ids = null, municipalityId = null, verificationStatuses = null } = {}) => {
    let rows = store.residents.filter((r) => matchesQuery(r, q));
    if (barangay) rows = rows.filter((r) => r.barangay === barangay);
    if (barangayId) rows = rows.filter((r) => r.barangayId === barangayId);
    if (zone !== null && zone !== undefined && zone !== '') rows = rows.filter((r) => matchesZone(r, zone));
    if (Array.isArray(ids)) rows = rows.filter((r) => ids.includes(r.id));
    if (Array.isArray(verificationStatuses) && verificationStatuses.length) rows = rows.filter((r) => verificationStatuses.includes(r.verificationStatus));
    const total = rows.length;
    return { rows: clone(rows.slice(offset, offset + limit)), total };
  },

  verifiedHouseholdResidentIds: async () => [],

  listResidentsByIds: async ({ ids = [], q = '', barangay = null, barangayId = null, zone = null, municipalityId = null } = {}) => {
    let rows = store.residents.filter((r) => ids.includes(r.id) && matchesQuery(r, q));
    if (barangay) rows = rows.filter((r) => r.barangay === barangay);
    if (barangayId) rows = rows.filter((r) => r.barangayId === barangayId);
    if (zone !== null && zone !== undefined && zone !== '') rows = rows.filter((r) => matchesZone(r, zone));
    if (municipalityId) rows = rows.filter((r) => r.municipalityId === municipalityId);
    return clone(rows);
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

  listResidentZoneOptions: async ({ barangayId, municipalityId } = {}) => {
    const rows = store.residents.filter((r) =>
      (!barangayId || r.barangayId === barangayId)
      && (!municipalityId || r.municipalityId === municipalityId),
    );
    return {
      zones: [...new Set(rows.flatMap((r) => [r.zone, zoneFromResidentAddress(r)]).filter((zone) => zone !== null && zone !== undefined && zone !== '').map(Number))].sort((a, b) => a - b),
      hasUnassigned: rows.some((r) => matchesZone(r, 'unassigned')),
    };
  },

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
    return found ? clone({ ...found, revision: found.revision ?? 1 }) : null;
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
        revision: 1,
      };
      delete row.age;
      data.residents.push(row);
      return clone(row);
    });
  },

  updateResident: async (id, patch, { expectedRevision = null, expectedUpdatedAt = null } = {}) => {
    return store.mutate((data) => {
      const row = data.residents.find((r) => r.id === id);
      if (!row) return null;
      if (expectedRevision !== null && (row.revision ?? 1) !== expectedRevision) return null;
      if (expectedUpdatedAt && row.updatedAt !== expectedUpdatedAt) return null;
      const next = { ...row, ...patch, revision: (row.revision ?? 1) + 1, updatedAt: new Date().toISOString() };
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
      if (data.visits.some((row) => row.id === visit.id
        || (visit.clientOperationKey && String(row.clientOperationKey).toLowerCase() === String(visit.clientOperationKey).toLowerCase()))) {
        throw Object.assign(new Error('A visit for this consultation operation already exists.'), { code: '23505' });
      }
      const now = new Date().toISOString();
      const row = { createdAt: now, updatedAt: now, ...visit,
        ...(visit.clientOperationKey ? { clientOperationKey: visit.clientOperationKey.toLowerCase() } : {}) };
      data.visits.push(row);
      const residentsById = Object.fromEntries(data.residents.map((r) => [r.id, r]));
      return attachResidentToVisit(clone(row), residentsById);
    });
  },

  findVisitByOperationKey: async (key) => {
    const found = store.visits.find((visit) => visit.clientOperationKey?.toLowerCase() === key.toLowerCase());
    if (!found) return null;
    const residentsById = Object.fromEntries(store.residents.map((resident) => [resident.id, resident]));
    return attachResidentToVisit(clone(found), residentsById);
  },

  hasUnkeyedVisitsForResident: async (residentId) => store.visits.some((visit) =>
    visit.residentId === residentId && !visit.clientOperationKey),

  completeConsultationOperation: async ({ id, creatorId }) => store.mutate((data) => {
    const visit = data.visits.find((row) => row.id === id);
    if (!visit || !visit.clientOperationKey || visit.recordedById !== creatorId) {
      throw ApiError.conflict('The consultation operation does not belong to this author.');
    }
    if (visit.consultationEffectsCompletedAt) return { completed: true, consultationId: id };
    const resident = data.residents.find((row) => row.id === visit.residentId);
    if (!resident) throw ApiError.notFound('Resident record not found.');
    const details = visit.consultationDetails || {};
    const now = new Date().toISOString();
    const followUps = data.followUps || [];
    const notifications = data.notifications || [];
    let followUp = null;
    if (details.nextVisitDate) {
      const key = `consultation-followup:${id}:${details.nextVisitDate}`;
      followUp = followUps.find((row) => row.client_operation_key === key);
      if (followUp && (followUp.resident_id !== resident.id || followUp.created_by !== creatorId
        || followUp.consultation_id !== id)) {
        throw ApiError.conflict('The follow-up operation belongs to a different author or resident.');
      }
      if (!followUp) {
        followUp = {
          id: randomUUID(), resident_id: resident.id, consultation_id: id,
          municipality_id: resident.municipalityId || null, barangay_id: resident.barangayId || null,
          created_by: creatorId, created_at: now, updated_at: now, client_operation_key: key,
          purpose: `${details.chiefComplaint || details.diagnosis || 'Consultation'} follow-up`,
          scheduled_date: details.nextVisitDate, notes: details.adviceGiven || '',
          assigned_provider: visit.recordedByName || '', status: 'Pending',
          requires_resident_response: true, resident_decision: 'pending',
          resident_decision_at: null, resident_decision_reason: '',
        };
        followUps.push(followUp);
        data.healthAuditLogs.push({ id: randomUUID(), actor_id: creatorId, action: 'FOLLOWUPS_CREATED',
          entity_type: 'follow_ups', entity_id: followUp.id, created_at: now });
      }
    }
    if (resident.authUserId) {
      const notifyOnce = (relatedType, relatedId, title, message, category) => {
        if (!notifications.some((row) => row.recipient_id === resident.authUserId
          && row.related_type === relatedType && row.related_id === relatedId && row.title === title)) {
          notifications.push({ id: randomUUID(), recipient_id: resident.authUserId,
            related_type: relatedType, related_id: relatedId, title, message, category, created_at: now });
        }
      };
      if (followUp) notifyOnce('follow_ups', followUp.id, 'New follow-up requires your response',
        `A health worker requested a follow-up on ${details.nextVisitDate}. Please review it and confirm or reject it in your Follow-ups.`, 'reminder');
      notifyOnce('consultation', id, 'New consultation record',
        `A new consultation record from ${details.consultationDate} is now available in My Health Records.`, 'information');
    }
    data.followUps = followUps;
    data.notifications = notifications;
    data.healthAuditLogs.push({ id: randomUUID(), actor_id: creatorId, action: 'CONSULTATION_CREATED',
      entity_type: 'visits', entity_id: id, created_at: now });
    visit.consultationEffectsCompletedAt = now;
    return { completed: true, consultationId: id, followUpId: followUp?.id || null };
  }),

  getVisit: async (id) => {
    const found = store.visits.find((v) => v.id === id);
    if (!found) return null;
    const residentsById = Object.fromEntries(store.residents.map((r) => [r.id, r]));
    return attachResidentToVisit(clone(found), residentsById);
  },

  listVisits: async ({ q = '', statuses = null, submittedById = null, residentId = null, from = null, to = null, serviceId = null,
    municipalityId = null, barangayId = null, barangay = null, limit = 100, offset = 0 } = {}) => {
    const residentsById = Object.fromEntries(store.residents.map((r) => [r.id, r]));
    let rows = store.visits.map((v) => attachResidentToVisit(clone(v), residentsById));

    if (statuses && statuses.length) rows = rows.filter((v) => statuses.includes(v.status));
    if (submittedById) rows = rows.filter((v) => v.recordedById === submittedById);
    if (residentId) rows = rows.filter((v) => v.residentId === residentId);
    if (municipalityId) rows = rows.filter((v) => v.resident?.municipalityId === municipalityId);
    if (barangayId) rows = rows.filter((v) => v.resident?.barangayId === barangayId);
    if (barangay) rows = rows.filter((v) => normalizeText(v.resident?.barangay) === normalizeText(barangay));
    if (from) rows = rows.filter((v) => (v.consultationDetails?.consultationDate || String(v.visitDate || '').slice(0, 10)) >= from);
    if (to) rows = rows.filter((v) => (v.consultationDetails?.consultationDate || String(v.visitDate || '').slice(0, 10)) <= to);
    if (serviceId) rows = rows.filter((v) => v.healthServiceId === serviceId);
    if (q) {
      const query = normalizeText(q);
      rows = rows.filter(
        (v) =>
          (v.resident && matchesQuery(v.resident, query)) ||
          normalizeText(v.id).includes(query) ||
          normalizeText(v.chiefComplaint).includes(query),
      );
    }

    rows.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)) || String(b.id).localeCompare(String(a.id)));
    return { rows: rows.slice(offset, offset + limit), total: rows.length };
  },

  listTclEntries: async () => ({ rows: [], total: 0 }),

  updateVisit: async (id, patch) => {
    return store.mutate((data) => {
      const row = data.visits.find((v) => v.id === id);
      if (!row) return null;
      if (row.clientOperationKey && ['clientOperationKey', 'clientOperationPayloadHash', 'residentId',
        'recordedById', 'recordedByRole', 'recordedByName', 'recordedAt'].some((field) =>
        patch[field] !== undefined && patch[field] !== row[field])) {
        throw ApiError.conflict('The original consultation operation, resident, and recorder are immutable.');
      }
      const residentsById = Object.fromEntries(data.residents.map((r) => [r.id, r]));
      const next = { ...row, ...patch, updatedAt: new Date().toISOString() };
      Object.assign(row, next);
      return attachResidentToVisit(clone(row), residentsById);
    });
  },

  // ----- referrals ----------------------------------------------------------
  insertReferral: async () => {
    throw ApiError.conflict('Historical referrals are read-only. Use the canonical referral service.');
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

  updateReferral: async () => {
    throw ApiError.conflict('Historical referrals are read-only. Use the canonical referral service.');
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

  // Dev-driver parity for the existing-resident activation RPC
  // (activate_resident_by_id). Links an UNLINKED record by Resident ID when the
  // date of birth matches; returns null otherwise.
  activateResidentById: async ({ authUserId, residentId, birthDate }) => {
    return store.mutate((data) => {
      const found = data.residents.find(
        (r) => r.id === String(residentId || '').trim()
          && !r.authUserId
          && String(r.birthDate || '') === String(birthDate || ''),
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
      resubmissionInstructions: '', resubmission_instructions: '',
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
  updateTransferRequestForReview: async (id, patch) => store.mutate((data) => {
    const row = data.transferRequests.find((item) => item.id === id);
    if (!row || !['pending', 'under_review'].includes(row.status)) return null;
    Object.assign(row, patch, { updatedAt: new Date().toISOString() });
    return clone(row);
  }),
  updateTransferRequestForSubmission: async (id, patch) => store.mutate((data) => {
    const row = data.transferRequests.find((item) => item.id === id);
    if (!row || !['draft', 'resubmission_required'].includes(row.status)) return null;
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
    // Record the resident's actual previous barangay for durable transfer history.
    request.fromBarangayId = resident.barangayId || request.fromBarangayId || null;
    request.from_barangay_id = request.fromBarangayId;
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
  listTransferAuditLogs: async (transferRequestId) => clone(
    store.transferRequestAuditLogs
      .filter((row) => row.transferRequestId === transferRequestId)
      .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt))),
  ),
  listDocumentsByTransferRequest: async () => [],
  deleteDocument: async () => true,
  // Dev driver has no staff profiles; the receiving-supervisor notification is a
  // no-op here (notifications require a configured Supabase backend anyway).
  listActiveHealthSupervisorsByBarangay: async () => [],

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
        indication: m.indication || '',
        safetyNotes: m.safetyNotes || '',
        contraindications: m.contraindications || '',
        prescriptionRequirement: m.prescriptionRequirement || 'rx',
        dosageInstructions: m.dosageInstructions || '',
        dosageVerifiedBy: null,
        dosageVerifiedAt: null,
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
      indication: medicine.indication || '',
      safetyNotes: medicine.safetyNotes || '',
      contraindications: medicine.contraindications || '',
      prescriptionRequirement: medicine.prescriptionRequirement || 'rx',
      dosageInstructions: medicine.dosageInstructions || '',
      dosageVerifiedBy: medicine.dosageVerifiedBy ?? null,
      dosageVerifiedAt: medicine.dosageVerifiedAt ?? null,
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

  // The file (dev) driver has no facilities registry.
  listFacilities: async () => [],

};

export default fileRepository;
