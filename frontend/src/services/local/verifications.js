/**
 * Local (non-demo) pending resident verifications.
 *
 * This module carries no demo data. The pending queue and history start empty
 * and the UI shows an empty/loading state until the backend
 * (`/api/verifications/*`) supplies real records. Export names and return
 * shapes are preserved from the previous development module so the verification page
 * keeps compiling and consumers never read `undefined`.
 *
 * `resolvePendingVerifications(assignedBarangay)` remains the only way the
 * page obtains its queue; the barangay argument comes from the signed-in
 * user's assignment (`@/lib/barangayScope`).
 */

export const PENDING_VERIFICATIONS = [];

/** Previously completed reviews shown in the verification history. */
export const VERIFICATION_HISTORY = [];

export const REJECTION_REASONS = [
  "Invalid information",
  "Insufficient proof of residency",
  "Duplicate registration",
  "Information does not match",
  "Other",
];

/** Only the caller's assigned barangay is ever returned. */
export const resolvePendingVerifications = (assignedBarangay) =>
  PENDING_VERIFICATIONS.filter(
    (v) => v.status === "Pending" && (!assignedBarangay || v.barangay === assignedBarangay)
  );

export const resolveVerificationHistory = (assignedBarangay) =>
  VERIFICATION_HISTORY.filter((v) => !assignedBarangay || v.barangay === assignedBarangay);

export default {
  PENDING_VERIFICATIONS,
  VERIFICATION_HISTORY,
  REJECTION_REASONS,
  resolvePendingVerifications,
  resolveVerificationHistory,
};
