/**
 * Resident verification service.
 *
 * Pending registration verifications submitted by residents, reviewed by the
 * Health Supervisor (or PHN). Barangay scoping is enforced HERE, at the data
 * layer: a Health Supervisor assigned to one barangay only ever sees and
 * decides on that barangay's verification requests. Out-of-scope references
 * read as "not found" so the API never confirms another barangay's records.
 */
import ApiError from '../utils/apiError.js';
import store from '../repositories/fileStore.js';
import { assignedBarangay } from '../config/scope.js';

const DECISIONS = Object.freeze(['approved', 'rejected']);

const REJECTION_REASONS = Object.freeze([
  'Invalid information',
  'Insufficient proof of residency',
  'Duplicate registration',
  'Information does not match',
  'Other',
]);

const sameBarangay = (record, barangay) =>
  String(record?.barangay ?? '').trim().toLowerCase() === String(barangay).trim().toLowerCase();

/** Pending verifications visible to this caller (barangay-scoped). */
export const listPending = async ({ user }) => {
  const scope = assignedBarangay(user);
  return store.verifications
    .filter((v) => v.status === 'Pending')
    .filter((v) => (scope ? sameBarangay(v, scope) : true));
};

/** Decided verifications visible to this caller, most recent first. */
export const listHistory = async ({ user }) => {
  const scope = assignedBarangay(user);
  return store.verifications
    .filter((v) => v.status !== 'Pending' && v.decision)
    .filter((v) => (scope ? sameBarangay(v, scope) : true))
    .sort((a, b) => String(b.decision.reviewedAt).localeCompare(String(a.decision.reviewedAt)));
};

/**
 * Record an approve/reject decision. The reviewer and timestamp are taken
 * from the authenticated session — never from the request body.
 */
export const decide = async ({ ref, decision, reason = '', remarks = '', user }) => {
  if (!DECISIONS.includes(decision)) {
    throw ApiError.badRequest('Decision must be "approved" or "rejected"');
  }
  if (decision === 'rejected') {
    const trimmedReason = String(reason).trim();
    if (!trimmedReason) {
      throw ApiError.badRequest('A rejection reason is required');
    }
    if (trimmedReason === 'Other' && !String(remarks).trim()) {
      throw ApiError.badRequest('Please provide remarks when choosing "Other"');
    }
    if (trimmedReason !== 'Other' && !REJECTION_REASONS.includes(trimmedReason)) {
      throw ApiError.badRequest('Invalid rejection reason');
    }
  }

  return store.mutate((data) => {
    const record = data.verifications.find((v) => v.ref === ref);
    const scope = assignedBarangay(user);
    // Out-of-scope or unknown references are indistinguishable: not found.
    if (!record) return null;
    if (scope && !sameBarangay(record, scope)) return null;

    if (record.status !== 'Pending') {
      return { ...record, alreadyDecided: true };
    }

    record.status = decision === 'approved' ? 'Verified' : 'Rejected';
    record.decision = {
      decision,
      reason: decision === 'rejected' ? String(reason).trim() : '',
      remarks: String(remarks || '').trim(),
      reviewedBy: user?.name || user?.email || 'Health Supervisor',
      reviewedByRole: user?.role || '',
      reviewedAt: new Date().toISOString(),
    };
    return record;
  });
};

export const REJECTION_REASON_OPTIONS = REJECTION_REASONS;

export default { listPending, listHistory, decide, REJECTION_REASON_OPTIONS };
