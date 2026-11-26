// backend/src/services/medicines.service.js
/**
 * Medicine catalog service — generic-first, admin-managed catalog plus the
 * shared normalizer for medications recorded on a consultation.
 *
 * Backs public.medicines. Each entry carries generic/brand names, strength,
 * dosage form, category, intended use/indication, basic safety notes and
 * contraindications, the prescription requirement (OTC vs prescription-only)
 * and optional catalog reference text. Reads are available to active clinical
 * staff (so the consultation form can search by generic OR brand name); writes
 * are admin-only, deduplicated on the identity triple (generic name + strength
 * + dosage form), validated and audited in health_audit_logs. There is NO
 * stock/inventory tracking or availability indicator on medicines.
 *
 * Catalog reference text is not evidence of a verified regimen and is never
 * copied into a patient-specific prescription.
 *
 * Medications on a consultation are stored BY VALUE (see consultations.service
 * `toVisit`), so deactivating or editing a catalog entry never alters a
 * medication already recorded on a visit, and a manually-entered ("custom")
 * medicine is preserved exactly as typed.
 */
import repository from '../repositories/index.js';
import ApiError from '../utils/apiError.js';
import { MEDICINE_SOURCES, PRESCRIPTION_REQUIREMENTS, medicineIdentityKey } from '../config/medicineCatalog.js';

const text = (v) => String(v ?? '').trim();
const CATALOG_FIELDS = Object.freeze({
  genericName: 160,
  brandName: 160,
  strength: 80,
  dosageForm: 80,
  category: 80,
  indication: 400,
  safetyNotes: 600,
  contraindications: 600,
  dosageInstructions: 600,
});
const MEDICATION_FIELDS = Object.freeze({
  genericName: 160,
  brandName: 160,
  strength: 80,
  dosageForm: 80,
  dose: 120,
  route: 80,
  frequency: 120,
  duration: 120,
  quantity: 80,
  instructions: 400,
  medicineId: 160,
});
const MEDICATION_KEYS = new Set([
  ...Object.keys(MEDICATION_FIELDS), 'name', 'source', 'custom',
]);

const validatedText = (value, max, field, errors, { required = false, preserve = false } = {}) => {
  if (value === undefined || value === null) {
    if (required) errors[field] = 'This field is required.';
    return '';
  }
  if (typeof value !== 'string') {
    errors[field] = 'Use a text value.';
    return '';
  }
  const normalized = preserve ? value : value.trim();
  if (normalized.length > max) errors[field] = `Use ${max} characters or fewer.`;
  if (required && !normalized.trim()) errors[field] = 'This field is required.';
  return normalized;
};

const safe = async (fn, fallback) => {
  try {
    return await fn();
  } catch {
    return fallback;
  }
};

const assertAdmin = (user) => {
  if (user?.role !== 'admin') {
    throw ApiError.forbidden('Only the System Administrator may manage the medicine catalog.');
  }
};

const audit = async ({ user, action, entityId, previous, next }) => {
  if (typeof repository.insertHealthAuditLog !== 'function') return;
  await safe(() => repository.insertHealthAuditLog({
    actorId: user?.id || null,
    action,
    entityType: 'medicine_catalog',
    entityId: String(entityId),
    municipalityId: user?.municipalityId || null,
    barangayId: user?.barangayId || null,
    metadata: { previous: previous ?? null, next: next ?? null },
  }), null);
};

/** Validate + normalize an incoming catalog entry. */
export const normalizeCatalogEntry = (payload = {}) => {
  const isObject = payload && typeof payload === 'object' && !Array.isArray(payload);
  const input = isObject ? payload : {};
  const errors = {};
  if (!isObject) errors.medicine = 'Use a medicine object.';
  const entry = Object.fromEntries(Object.entries(CATALOG_FIELDS).map(([field, max]) => [
    field,
    validatedText(input[field], max, field, errors, { required: field === 'genericName' }),
  ]));
  const source = input.source === undefined ? 'local' : text(input.source);
  const prescriptionRequirement = input.prescriptionRequirement === undefined
    ? 'rx'
    : text(input.prescriptionRequirement);
  if (!MEDICINE_SOURCES.includes(source)) errors.source = 'Choose a supported medicine source.';
  if (!PRESCRIPTION_REQUIREMENTS.includes(prescriptionRequirement)) {
    errors.prescriptionRequirement = 'Choose a supported prescription requirement.';
  }
  if (input.active !== undefined && typeof input.active !== 'boolean') {
    errors.active = 'Use true or false.';
  }
  if (Object.keys(errors).length) throw ApiError.unprocessable('Please correct the medicine entry.', errors);
  return {
    ...entry,
    source,
    prescriptionRequirement,
    active: input.active === undefined ? true : input.active,
  };
};

export const listMedicines = async ({
  q = '', source = '', includeInactive = false, repo = repository,
} = {}) => {
  if (typeof repo.listMedicines !== 'function') return [];
  return repo.listMedicines({ q: text(q), source: text(source), includeInactive });
};

export const createMedicine = async ({ user, payload = {}, repo = repository } = {}) => {
  assertAdmin(user);
  if (typeof repo.insertMedicine !== 'function') {
    throw Object.assign(new Error('Medicine catalog storage is not available.'), { statusCode: 503 });
  }
  const entry = normalizeCatalogEntry(payload);
  if (typeof repo.findMedicineByIdentity === 'function') {
    const existing = await safe(() => repo.findMedicineByIdentity(entry), null);
    if (existing) {
      throw ApiError.conflict('A medicine with the same generic name, strength and dosage form already exists.');
    }
  }
  const saved = await repo.insertMedicine({ ...entry, createdBy: user?.id || null });
  await audit({ user, action: 'MEDICINE_CREATED', entityId: saved.id, previous: null, next: saved });
  return saved;
};

export const updateMedicine = async ({ user, id, payload = {}, repo = repository } = {}) => {
  assertAdmin(user);
  const key = text(id);
  if (!key) throw ApiError.unprocessable('A medicine id is required.');
  if (typeof repo.updateMedicine !== 'function') {
    throw Object.assign(new Error('Medicine catalog storage is not available.'), { statusCode: 503 });
  }
  const before = typeof repo.getMedicine === 'function' ? await safe(() => repo.getMedicine(key), null) : null;
  if (!before) throw ApiError.notFound('Medicine not found.');
  const entry = normalizeCatalogEntry({ ...before, ...payload });
  // Only block a duplicate when the identity triple changed onto another row.
  if (medicineIdentityKey(entry) !== medicineIdentityKey(before) && typeof repo.findMedicineByIdentity === 'function') {
    const clash = await safe(() => repo.findMedicineByIdentity(entry), null);
    if (clash && clash.id !== key) {
      throw ApiError.conflict('Another medicine with the same generic name, strength and dosage form already exists.');
    }
  }
  // Editing reference text does not establish clinical provenance. Clear any
  // prior verification metadata if the text changes; leave unchanged metadata
  // untouched so an unrelated catalog edit does not discard its audit trail.
  if (entry.dosageInstructions !== (before.dosageInstructions || '')) {
    entry.dosageVerifiedBy = null;
    entry.dosageVerifiedAt = null;
  }
  const saved = await repo.updateMedicine(key, entry);
  await audit({ user, action: 'MEDICINE_UPDATED', entityId: key, previous: before, next: saved });
  return saved;
};

export const setMedicineActive = async ({ user, id, active, repo = repository } = {}) => {
  assertAdmin(user);
  const key = text(id);
  if (!key) throw ApiError.unprocessable('A medicine id is required.');
  if (typeof repo.updateMedicine !== 'function') {
    throw Object.assign(new Error('Medicine catalog storage is not available.'), { statusCode: 503 });
  }
  const before = typeof repo.getMedicine === 'function' ? await safe(() => repo.getMedicine(key), null) : null;
  if (!before) throw ApiError.notFound('Medicine not found.');
  const saved = await repo.updateMedicine(key, { active: Boolean(active) });
  await audit({
    user,
    action: Boolean(active) ? 'MEDICINE_ACTIVATED' : 'MEDICINE_DEACTIVATED',
    entityId: key,
    previous: before,
    next: saved,
  });
  return saved;
};

/**
 * Normalize the medications array recorded on a consultation. Each entry must
 * carry a non-empty generic name; everything else is optional free text. Invalid
 * or overlong content is rejected with per-field errors rather than dropped or
 * truncated. Prescription text is preserved verbatim and bounded before save.
 */
export const normalizeMedications = (medications) => {
  if (medications === undefined) return [];
  if (!Array.isArray(medications)) {
    throw ApiError.unprocessable('Please correct the medication details.', {
      medications: 'Use a list of prescription entries.',
    });
  }
  if (medications.length > 50) {
    throw ApiError.unprocessable('Please correct the medication details.', {
      medications: 'Add no more than 50 medication entries.',
    });
  }

  const errors = {};
  const out = [];
  for (const [index, raw] of medications.entries()) {
    const prefix = `medications[${index}]`;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      errors[prefix] = 'Use a medication object.';
      continue;
    }
    for (const key of Object.keys(raw)) {
      if (!MEDICATION_KEYS.has(key)) errors[`${prefix}.${key}`] = 'This prescription field is not supported.';
    }

    const entry = Object.fromEntries(Object.entries(MEDICATION_FIELDS).map(([field, max]) => {
      const value = field === 'genericName' ? (raw.genericName ?? raw.name) : raw[field];
      return [field, validatedText(value, max, `${prefix}.${field}`, errors, {
        required: field === 'genericName',
        preserve: !['genericName', 'medicineId'].includes(field),
      })];
    }));
    const medicineId = entry.medicineId || null;
    const source = raw.source === undefined ? '' : raw.source;
    if (source !== '' && (typeof source !== 'string' || ![...MEDICINE_SOURCES, 'custom'].includes(source))) {
      errors[`${prefix}.source`] = 'Choose a supported medicine source.';
    }
    if ((medicineId && source === 'custom') || (!medicineId && source && source !== 'custom')) {
      errors[`${prefix}.source`] = 'The source must match whether the medicine is a catalog entry.';
    }
    if (raw.custom !== undefined && typeof raw.custom !== 'boolean') {
      errors[`${prefix}.custom`] = 'Use true or false.';
    }
    out.push({
      ...entry,
      medicineId,
      custom: medicineId ? false : true,
      source: medicineId
        ? (MEDICINE_SOURCES.includes(source) ? source : 'local')
        : 'custom',
    });
  }
  if (Object.keys(errors).length) {
    throw ApiError.unprocessable('Please correct the medication details.', errors);
  }
  return out;
};

export default {
  normalizeCatalogEntry,
  listMedicines,
  createMedicine,
  updateMedicine,
  setMedicineActive,
  normalizeMedications,
};
