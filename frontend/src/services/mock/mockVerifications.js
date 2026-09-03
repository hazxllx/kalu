/**
 * Pending resident verifications (development mock).
 *
 * `resolvePendingVerifications(assignedBarangay)` is the only way the
 * verification page obtains its queue. The barangay argument comes from the
 * signed-in user's assignment (`@/lib/barangayScope`) — the page has no
 * barangay selector and cannot request another barangay's verifications.
 * The API (`/api/verifications/*`) enforces the same scope from the session;
 * this mock mirrors it for local development.
 */

const verification = (fields) => ({
  status: "Pending",
  decision: null,
  ...fields,
});

export const PENDING_VERIFICATIONS = [
  verification({
    ref: "KSG-2026-00428",
    name: "Juan Dela Cruz Reyes",
    barangay: "San Isidro",
    registered: "July 5, 2026",
    contact: "0917 123 4567",
    birthDate: "March 14, 1994",
    age: 32,
    sex: "Male",
    civilStatus: "Married",
    address: "Barangay San Isidro, Pili, Camarines Sur",
    residencyStatus: "Verified Resident",
    lengthOfResidency: "8 years",
    householdId: "HH-2026-0184",
    proofDocument: "Barangay Certificate of Residency",
  }),
  verification({
    ref: "KSG-2026-00427",
    name: "Maria Santos Lopez",
    barangay: "San Isidro",
    registered: "July 4, 2026",
    contact: "0918 234 5678",
    birthDate: "November 2, 1990",
    age: 35,
    sex: "Female",
    civilStatus: "Married",
    address: "Purok 3, Barangay San Isidro, Pili, Camarines Sur",
    residencyStatus: "Verified Resident",
    lengthOfResidency: "12 years",
    householdId: "HH-2026-0184",
    proofDocument: "Barangay Certificate of Residency",
  }),
  verification({
    ref: "KSG-2026-00425",
    name: "Roberto Aguilar Cruz",
    barangay: "San Isidro",
    registered: "July 4, 2026",
    contact: "0919 345 6789",
    birthDate: "May 21, 1978",
    age: 48,
    sex: "Male",
    civilStatus: "Widowed",
    address: "Purok 5, Barangay San Isidro, Pili, Camarines Sur",
    residencyStatus: "Verified Resident",
    lengthOfResidency: "15 years",
    householdId: "HH-2026-0201",
    proofDocument: "Barangay Certificate of Residency",
  }),
  verification({
    ref: "KSG-2026-00421",
    name: "Ana Patricia Lim",
    barangay: "San Isidro",
    registered: "July 3, 2026",
    contact: "0920 456 7890",
    birthDate: "August 17, 1998",
    age: 27,
    sex: "Female",
    civilStatus: "Single",
    address: "Purok 1, Barangay San Isidro, Pili, Camarines Sur",
    residencyStatus: "Verified Resident",
    lengthOfResidency: "4 years",
    householdId: "HH-2026-0212",
    proofDocument: "Barangay Certificate of Residency",
  }),
  verification({
    ref: "KSG-2026-00419",
    name: "Fernando Garcia Jr.",
    barangay: "San Isidro",
    registered: "July 3, 2026",
    contact: "0921 567 8901",
    birthDate: "February 9, 1985",
    age: 41,
    sex: "Male",
    civilStatus: "Married",
    address: "Purok 2, Barangay San Isidro, Pili, Camarines Sur",
    residencyStatus: "Verified Resident",
    lengthOfResidency: "6 years",
    householdId: "HH-2026-0095",
    proofDocument: "Barangay Certificate of Residency",
  }),
  // Belongs to another barangay — never visible to a Health Supervisor
  // assigned to San Isidro (filtered at the data layer, mirroring the API).
  verification({
    ref: "KSG-2026-00416",
    name: "Elena Bautista Ramos",
    barangay: "San Jose",
    registered: "July 2, 2026",
    contact: "0922 678 9012",
    birthDate: "September 30, 1972",
    age: 53,
    sex: "Female",
    civilStatus: "Married",
    address: "Zone 4, Barangay San Jose, Pili, Camarines Sur",
    residencyStatus: "Verified Resident",
    lengthOfResidency: "20 years",
    householdId: "HH-2026-0033",
    proofDocument: "Barangay Certificate of Residency",
  }),
];

/** Previously completed reviews shown in the verification history. */
export const VERIFICATION_HISTORY = [
  {
    ref: "KSG-2026-00412",
    name: "Carmen Reyes Fuentes",
    barangay: "San Isidro",
    status: "Verified",
    decision: "approved",
    reason: "",
    remarks: "Certificate matches household records.",
    reviewedBy: "Maria Dela Cruz",
    reviewedByRole: "health_supervisor",
    reviewedAt: "2026-07-01T09:30:00.000Z",
  },
  {
    ref: "KSG-2026-00408",
    name: "Rodolfo Villanueva Dela Peña",
    barangay: "San Isidro",
    status: "Rejected",
    decision: "rejected",
    reason: "Insufficient proof of residency",
    remarks: "Submitted utility bill is under a different name.",
    reviewedBy: "Maria Dela Cruz",
    reviewedByRole: "health_supervisor",
    reviewedAt: "2026-06-28T14:05:00.000Z",
  },
];

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
