/**
 * Medicine catalog service — generic-first, admin-managed catalog plus the
 * shared normalizer for medications recorded on a consultation.
 *
 * Backs public.medicines. Each entry carries generic/brand names, strength,
 * dosage form, category, intended use/indication, basic safety notes and
 * contraindications, the prescription requirement (OTC vs prescription-only)
 * and standard dosage instructions. Reads are available to active clinical
 * staff (so the consultation form can search by generic OR brand name); writes
 * are admin-only, deduplicated on the identity triple (generic name + strength
 * + dosage form), validated and audited in health_audit_logs. There is NO
 * stock/inventory tracking or availability indicator on medicines.
 *
 * Dosage instructions are entered/verified by an authorized System
 * Administrator; the verifier id and timestamp are recorded on the entry
 * (dosageVerifiedBy / dosageVerifiedAt) whenever the instructions are set.
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
const clip = (v, max) => text(v).slice(0, max);

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
  const genericName = clip(payload.genericName, 160);
  const errors = [];
  if (!genericName) errors.push('A generic medicine name is required.');
  const source = MEDICINE_SOURCES.includes(text(payload.source)) ? text(payload.source) : 'local';
  const prescriptionRequirement = PRESCRIPTION_REQUIREMENTS.includes(text(payload.prescriptionRequirement))
    ? text(payload.prescriptionRequirement)
    : 'rx';
  if (errors.length) throw ApiError.unprocessable('Please correct the medicine entry.', errors);
  return {
    genericName,
    brandName: clip(payload.brandName, 160),
    strength: clip(payload.strength, 80),
    dosageForm: clip(payload.dosageForm, 80),
    category: clip(payload.category, 80),
    source,
    indication: clip(payload.indication, 400),
    safetyNotes: clip(payload.safetyNotes, 600),
    contraindications: clip(payload.contraindications, 600),
    prescriptionRequirement,
    dosageInstructions: clip(payload.dosageInstructions, 600),
    active: payload.active === undefined ? true : Boolean(payload.active),
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
  // Dosage instructions are verified by the authorized administrator entering them.
  if (entry.dosageInstructions) {
    entry.dosageVerifiedBy = user?.id || null;
    entry.dosageVerifiedAt = new Date().toISOString();
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
  // Re-stamp verification whenever the dosage instructions change (verified by
  // the authorized administrator making the edit). Clear it when emptied.
  if (!entry.dosageInstructions) {
    entry.dosageVerifiedBy = null;
    entry.dosageVerifiedAt = null;
  } else if (entry.dosageInstructions !== (before.dosageInstructions || '')) {
    entry.dosageVerifiedBy = user?.id || null;
    entry.dosageVerifiedAt = new Date().toISOString();
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
 * carry a non-empty generic name; everything else is optional free text. Custom
 * (non-catalog) entries are flagged and preserved verbatim. Returns a clean,
 * length-bounded array safe to persist by value.
 */
export const normalizeMedications = (medications) => {
  if (!Array.isArray(medications)) return [];
  const out = [];
  for (const raw of medications.slice(0, 50)) {
    if (!raw || typeof raw !== 'object') continue;
    const genericName = clip(raw.genericName ?? raw.name, 160);
    if (!genericName) continue;
    const medicineId = raw.medicineId != null && text(raw.medicineId) ? text(raw.medicineId) : null;
    const source = MEDICINE_SOURCES.includes(text(raw.source)) ? text(raw.source) : (medicineId ? 'local' : 'custom');
    out.push({
      medicineId,
      genericName,
      brandName: clip(raw.brandName, 160),
      strength: clip(raw.strength, 80),
      dosageForm: clip(raw.dosageForm, 80),
      dose: clip(raw.dose, 120),
      route: clip(raw.route, 80),
      frequency: clip(raw.frequency, 120),
      duration: clip(raw.duration, 120),
      quantity: clip(raw.quantity, 80),
      instructions: clip(raw.instructions, 400),
      custom: medicineId ? false : true,
      source: medicineId ? (MEDICINE_SOURCES.includes(source) ? source : 'local') : 'custom',
    });
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
