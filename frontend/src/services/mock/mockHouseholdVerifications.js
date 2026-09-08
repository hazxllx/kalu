/**
 * Pending household verification records (development mock).
 *
 * Health Supervisors verify household profiling information for households in
 * their OWN assigned barangay. `resolvePendingHouseholdVerifications(barangay)`
 * is the only entry point and only ever returns households from that barangay —
 * the page has no barangay selector and cannot request another barangay's
 * records. The API enforces the same scope from the session; this mock mirrors
 * it for local development.
 */

const household = (fields) => ({
  status: "Pending",
  decision: null,
  ...fields,
});

export const PENDING_HOUSEHOLDS = [
  household({
    ref: "HV-2026-0101",
    householdId: "HH-201",
    head: "Juanito Santos",
    barangay: "San Isidro",
    purok: "Purok 1",
    address: "12 Mabini St.",
    contact: "0917 555 0201",
    families: 1,
    members: 5,
    membersList: [
      { name: "Juanito Santos", relationship: "Household Head", sex: "Male", age: 58, classification: "Senior Citizen" },
      { name: "Luz Santos", relationship: "Spouse", sex: "Female", age: 54, classification: "Adult" },
      { name: "Miguel Santos", relationship: "Son", sex: "Male", age: 22, classification: "Adult" },
      { name: "Aira Santos", relationship: "Daughter", sex: "Female", age: 17, classification: "Child" },
      { name: "Jose Santos", relationship: "Father", sex: "Male", age: 81, classification: "Senior Citizen" },
    ],
    income: "₱9,500/mo",
    water: "Level II - Communal",
    toilet: "Water-sealed",
    riskLevel: "Medium Risk",
    collector: "Maria Cruz",
    collectedOn: "July 1, 2026",
    lastUpdated: "2026-07-01",
  }),
  household({
    ref: "HV-2026-0102",
    householdId: "HH-205",
    head: "Norma Villanueva",
    barangay: "San Isidro",
    purok: "Purok 3",
    address: "8 Rizal Ave.",
    contact: "0918 555 0102",
    families: 2,
    members: 7,
    membersList: [
      { name: "Norma Villanueva", relationship: "Household Head", sex: "Female", age: 47, classification: "Adult" },
      { name: "Ricardo Villanueva", relationship: "Spouse", sex: "Male", age: 50, classification: "Adult" },
      { name: "Celine Villanueva", relationship: "Daughter", sex: "Female", age: 12, classification: "Child" },
      { name: "Andres Villanueva", relationship: "Son", sex: "Male", age: 8, classification: "Child" },
    ],
    income: "₱7,200/mo",
    water: "Level II - Communal",
    toilet: "Water-sealed",
    riskLevel: "High Risk",
    collector: "Grace Aquino",
    collectedOn: "June 28, 2026",
    lastUpdated: "2026-06-28",
  }),
  household({
    ref: "HV-2026-0103",
    householdId: "HH-206",
    head: "Lito Fernandez",
    barangay: "San Isidro",
    purok: "Purok 2",
    address: "45 Bonifacio St.",
    contact: "0919 555 0303",
    families: 1,
    members: 3,
    membersList: [
      { name: "Lito Fernandez", relationship: "Household Head", sex: "Male", age: 62, classification: "Senior Citizen" },
      { name: "Aida Fernandez", relationship: "Spouse", sex: "Female", age: 58, classification: "Adult" },
    ],
    income: "₱11,000/mo",
    water: "Level III - Piped",
    toilet: "Water-sealed",
    riskLevel: "Low Risk",
    collector: "Lourdes Ramos",
    collectedOn: "July 2, 2026",
    lastUpdated: "2026-07-02",
  }),
  // Household in another barangay — never visible to a Health Supervisor
  // assigned to San Isidro (filtered at the data layer, mirroring the API).
  household({
    ref: "HV-2026-0104",
    householdId: "HH-207",
    head: "Ramon Aguilar",
    barangay: "San Antonio",
    purok: "Purok 4",
    address: "3 Luna St.",
    contact: "0920 555 0404",
    families: 2,
    members: 6,
    membersList: [{ name: "Ramon Aguilar", relationship: "Household Head", sex: "Male", age: 44, classification: "Adult" }],
    income: "₱8,400/mo",
    water: "Level II - Communal",
    toilet: "Shared",
    riskLevel: "Medium Risk",
    collector: "Maria Cruz",
    collectedOn: "July 1, 2026",
    lastUpdated: "2026-07-01",
  }),
];

/** Household verification records already reviewed by the supervisor. */
export const HOUSEHOLD_VERIFICATION_HISTORY = [
  {
    ref: "HV-2026-0098",
    householdId: "HH-198",
    head: "Celia Ramos",
    barangay: "San Isidro",
    status: "Verified",
    decision: "approved",
    remarks: "Household information matches the profiling data collected on site.",
    reviewedBy: "Maria Dela Cruz",
    reviewedByRole: "health_supervisor",
    reviewedAt: "2026-07-01T09:30:00.000Z",
  },
  {
    ref: "HV-2026-0095",
    householdId: "HH-195",
    head: "Domingo Salazar",
    barangay: "San Isidro",
    status: "Returned for Correction",
    decision: "returned",
    reason: "Incomplete member information",
    remarks: "One member's date of birth is missing. Please complete before re-submitting.",
    reviewedBy: "Maria Dela Cruz",
    reviewedByRole: "health_supervisor",
    reviewedAt: "2026-06-28T14:05:00.000Z",
  },
];

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
