// frontend/src/features/consultations/lib/consultationForm.js
const hasText = (value) => value !== null && value !== undefined && String(value).trim() !== "";

export const isMaternalHealthService = (service = {}) =>
  /\b(maternal|prenatal|postpartum)\b/i.test(`${service.name || ""} ${service.category || ""}`);

export const hasMaternalDetails = (maternal) => Boolean(maternal && [
  "pregnancyId", "maternalRecordId", "lmpDate", "eddDate", "gestationalAgeWeeks",
].some((field) => hasText(maternal[field])));

export const hasMaternalInformation = (maternal) =>
  hasMaternalDetails(maternal);

const normalized = (value) => String(value || "").trim().toLowerCase();
const medicineNames = (medicine) => new Set([
  normalized(medicine?.genericName || medicine?.name),
  normalized(medicine?.brandName),
].filter(Boolean));
const sameMedicine = (left, right) => {
  const leftNames = medicineNames(left);
  const sharesName = [...medicineNames(right)].some((name) => leftNames.has(name));
  const sameStrength = !normalized(left?.strength) || !normalized(right?.strength)
    || normalized(left.strength) === normalized(right.strength);
  const sameForm = !normalized(left?.dosageForm) || !normalized(right?.dosageForm)
    || normalized(left.dosageForm) === normalized(right.dosageForm);
  return sharesName && sameStrength && sameForm;
};

export const isDuplicateMedicine = (medications, candidate) =>
  medications.some((medicine) => candidate?.medicineId && medicine?.medicineId
    ? String(medicine.medicineId) === String(candidate.medicineId)
    : sameMedicine(medicine, candidate));
