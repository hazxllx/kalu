/**
 * Blood-pressure configuration service — the ONE place the BP classification
 * thresholds are resolved and (for the System Administrator) edited.
 *
 * Resolution order:
 *   1. public.bp_threshold_settings (when applied + populated), otherwise
 *   2. the documented defaults in config/bpThresholds.js.
 *
 * Writes are admin-only, validated (no overlapping/contradictory cut-offs) and
 * recorded in the existing health_audit_logs trail. Classification is screening
 * guidance, never a diagnosis, and the backend is authoritative — a
 * client-supplied classification is recomputed on save.
 */
import repository from '../repositories/index.js';
import ApiError from '../utils/apiError.js';
import {
  DEFAULT_BP_THRESHOLDS,
  BP_CATEGORIES,
  classifyBloodPressure as classify,
  resolveThresholds,
  validateThresholdPayload,
} from '../config/bpThresholds.js';

const safe = async (fn, fallback) => {
  try {
    return await fn();
  } catch {
    return fallback;
  }
};

const assertAdmin = (user) => {
  if (user?.role !== 'admin') {
    throw ApiError.forbidden('Only the System Administrator may change the blood-pressure thresholds.');
  }
};

/**
 * Active thresholds + labels. Falls back to defaults whenever the DB settings
 * are unavailable or invalid, so classification always works.
 */
export const getBpConfig = async ({ repo = repository } = {}) => {
  const row = typeof repo.getBpThresholdSettings === 'function'
    ? await safe(() => repo.getBpThresholdSettings(), null)
    : null;
  const thresholds = resolveThresholds(row);
  const labels = (row && row.labels && typeof row.labels === 'object') ? row.labels : {};
  const categories = Object.values(BP_CATEGORIES).map((c) => ({
    code: c.code,
    label: (typeof labels[c.code] === 'string' && labels[c.code].trim()) ? labels[c.code].trim() : c.label,
    severity: c.severity,
    emergency: Boolean(c.emergency),
  }));
  return {
    thresholds,
    labels,
    categories,
    defaults: { ...DEFAULT_BP_THRESHOLDS },
    source: row ? 'configured' : 'default',
    updatedAt: row?.updatedAt || null,
  };
};

/** Classify a reading using the currently-active configuration. */
export const classifyWithConfig = async (reading, { repo = repository } = {}) => {
  const row = typeof repo.getBpThresholdSettings === 'function'
    ? await safe(() => repo.getBpThresholdSettings(), null)
    : null;
  return classify(reading, row, row?.labels || null);
};

const audit = async ({ user, action, previous, next }) => {
  if (typeof repository.insertHealthAuditLog !== 'function') return;
  await safe(() => repository.insertHealthAuditLog({
    actorId: user?.id || null,
    action,
    entityType: 'bp_threshold_configuration',
    entityId: 'thresholds',
    municipalityId: user?.municipalityId || null,
    barangayId: user?.barangayId || null,
    metadata: { previous: previous ?? null, next: next ?? null },
  }), null);
};

export const updateThresholds = async ({ user, payload = {}, repo = repository } = {}) => {
  assertAdmin(user);
  if (typeof repo.saveBpThresholdSettings !== 'function') {
    throw Object.assign(new Error('Blood-pressure configuration storage is not available.'), { statusCode: 503 });
  }
  const { errors, thresholds } = validateThresholdPayload(payload);
  if (errors.length) throw ApiError.unprocessable('Please correct the blood-pressure thresholds.', errors);
  const before = await safe(() => repo.getBpThresholdSettings?.(), null);
  const labels = payload.labels && typeof payload.labels === 'object' ? payload.labels : (before?.labels || {});
  const saved = await repo.saveBpThresholdSettings({ ...thresholds, labels, updatedBy: user?.id || null });
  await audit({ user, action: 'BP_THRESHOLDS_UPDATED', previous: before, next: saved });
  return getBpConfig({ repo });
};

export default { getBpConfig, classifyWithConfig, updateThresholds };
