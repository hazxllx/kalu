/**
 * Consultation-location helpers for the RHU → PHN workflow.
 *
 * Consultation Location describes where the ACTUAL encounter/service happened
 * and is stored on the patient's visit/triage/check-up object. It must never
 * be derived from the PHN's coverage.
 *
 * The helper only supplies a sensible location when a row has no recorded
 * location: patients with a resident barangay normally receive care at that
 * barangay's health center; only genuine RHU-level rows (no barangay) fall
 * back to "RHU".
 */

export const CONSULTATION_LOCATIONS = [
  "RHU",
  "San Isidro Barangay Health Center",
  "San Antonio Barangay Health Center",
  "Old San Roque Barangay Health Center",
];

/** Name of the barangay health center for a barangay ("RHU" when no barangay). */
export const barangayHealthCenter = (barangay) =>
  barangay ? `${barangay} Barangay Health Center` : "RHU";

/** Location of an encounter: recorded value first, then a sensible default. */
export const consultationLocationFor = (patient = {}) =>
  patient?.consultationLocation || barangayHealthCenter(patient?.barangay);

export default consultationLocationFor;
