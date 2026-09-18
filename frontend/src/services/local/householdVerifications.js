/**
 * Local (non-demo) pending household verification records.
 *
 * This module carries no demo data. The pending queue and history start empty
 * and the UI shows an empty/loading state until the backend supplies real
 * records. Export names and return shapes are preserved from the previous development
 * module so the household verification page keeps compiling and consumers
 * never read `undefined`.
 *
 * `resolvePendingHouseholdVerifications(assignedBarangay)` remains the only
 * entry point; the barangay argument comes from the signed-in user's
 * assignment (`@/lib/barangayScope`).
 */

export const PENDING_HOUSEHOLDS = [];

/** Household verification records already reviewed by the supervisor. */
export const HOUSEHOLD_VERIFICATION_HISTORY = [];

export const HOUSEHOLD_RETURN_REASONS = [
  "Incomplete household information",
  "Incorrect household head name",
  "Member information incomplete or incorrect",
  "Address / purok does not match records",
  "Duplicate household profile",
  "Other",
];

/** Only the caller's assigned barangay is ever returned. */
export const resolvePendingHouseholdVerifications = (assignedBarangay) =>
  PENDING_HOUSEHOLDS.filter(
    (h) => h.status === "Pending" && (!assignedBarangay || h.barangay === assignedBarangay)
  );

export const resolveHouseholdVerificationHistory = (assignedBarangay) =>
  HOUSEHOLD_VERIFICATION_HISTORY.filter((h) => !assignedBarangay || h.barangay === assignedBarangay);

export default {
  PENDING_HOUSEHOLDS,
  HOUSEHOLD_VERIFICATION_HISTORY,
  HOUSEHOLD_RETURN_REASONS,
  resolvePendingHouseholdVerifications,
  resolveHouseholdVerificationHistory,
};
