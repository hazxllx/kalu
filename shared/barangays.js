export const APPROVED_BARANGAYS = Object.freeze([
  "San Antonio",
  "San Isidro",
  "Old San Roque",
]);

const approvedBarangayLookup = new Set(
  APPROVED_BARANGAYS.map((name) => name.toLocaleLowerCase("en")),
);

export const isApprovedBarangayName = (value) =>
  typeof value === "string" &&
  approvedBarangayLookup.has(value.trim().toLocaleLowerCase("en"));

export default APPROVED_BARANGAYS;
