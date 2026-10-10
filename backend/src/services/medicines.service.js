/**
 * Medicine catalog service — generic-first, admin-managed catalog plus the
 * shared normalizer for medications recorded on a consultation.
 *
 * Backs public.medicines (+ public.medicine_facility_availability). Reads are
 * available to active clinical staff (so the consultation form can search);
 * writes are admin-only, deduplicated on the identity triple (generic name +
 * strength + dosage form), validated and audited in health_audit_logs.
 *
 * Medications on a consultation are stored BY VALUE (see consultations.service
 * `toVisit`), so deactivating or editing a catalog entry never alters a
 * medication already recorded on a visit, and a manually-entered ("custom")
 * medicine is preserved exactly as typed.
 */
import repository from '../repositories/index.js';
import ApiError from '../utils/apiError.js';
import { MEDICINE_SOURCES, medicineIdentityKey } from '../config/medicineCatalog.js';

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
  if (errors.length) throw ApiError.unprocessable('Please correct the medicine entry.', errors);
  return {
    genericName,
    brandName: clip(payload.brandName, 160),
    strength: clip(payload.strength, 80),
    dosageForm: clip(payload.dosageForm, 80),
    category: clip(payload.category, 80),
    source,
    active: payload.active === undefined ? true : Boolean(payload.active),
  };
};

export const listMedicines = async ({
  q = '', source = '', includeInactive = false, facilityId = '', repo = repository,
} = {}) => {
  if (typeof repo.listMedicines !== 'function') return [];
  const rows = await repo.listMedicines({ q: text(q), source: text(source), includeInactive });
  if (facilityId && typeof repo.listMedicineAvailabilityForFacility === 'function') {
    const availability = await safe(() => repo.listMedicineAvailabilityForFacility(text(facilityId)), []);
    const byMedicine = new Map((availability || []).map((a) => [a.medicineId, a]));
    return rows.map((m) => ({
      ...m,
      availability: byMedicine.has(m.id)
        ? { available: byMedicine.get(m.id).available, note: byMedicine.get(m.id).note }
        : null,
    }));
  }
  return rows;
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

export const setAvailability = async ({ user, id, facilityId, available = true, note = '', repo = repository } = {}) => {
  assertAdmin(user);
  const key = text(id);
  const facility = text(facilityId);
  if (!key || !facility) throw ApiError.unprocessable('A medicine id and facility id are required.');
  if (typeof repo.upsertMedicineAvailability !== 'function') {
    throw Object.assign(new Error('Medicine availability storage is not available.'), { statusCode: 503 });
  }
  const saved = await repo.upsertMedicineAvailability({
    medicineId: key,
    facilityId: facility,
    available: Boolean(available),
    note: clip(note, 240),
    updatedBy: user?.id || null,
  });
  await audit({ user, action: 'MEDICINE_AVAILABILITY_UPDATED', entityId: `${key}:${facility}`, previous: null, next: saved });
  return saved;
};

export const listAvailability = async ({ id, repo = repository } = {}) => {
  const key = text(id);
  if (!key || typeof repo.listMedicineAvailability !== 'function') return [];
  return repo.listMedicineAvailability(key);
};

/** Facilities an admin can configure availability against. */
export const listFacilities = async ({ user, repo = repository } = {}) => {
  if (typeof repo.listFacilities !== 'function') return [];
  return repo.listFacilities({ municipalityId: user?.municipalityId || null });
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
  setAvailability,
  listAvailability,
  listFacilities,
  normalizeMedications,
};
