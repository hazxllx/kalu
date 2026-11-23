// Resolve and persist the authorized thresholds used by the shared classifier.
import repository from '../repositories/index.js';
import ApiError from '../utils/apiError.js';
import {
  DEFAULT_BP_THRESHOLDS,
  BP_CATEGORIES,
  classifyBloodPressure as classify,
  resolveThresholds,
  setBloodPressureConfig,
  validateThresholdPayload,
} from '../config/bpThresholds.js';

/** Execute an async repository read, returning `fallback` on any storage failure. */
const safe = async (fn, fallback) => {
  try {
    return await fn();
  } catch {
    return fallback;
  }
};

/** Enforce System Administrator (`admin`) role before mutating BP threshold settings. */
const assertAdmin = (user) => {
  if (user?.role !== 'admin') {
    throw ApiError.forbidden('Only the System Administrator may change the blood-pressure thresholds.');
  }
};

/**
 * Report the active BP thresholds and fixed clinical category labels.
 *
 * @param {Object} [options] - Service options
 * @param {Object} [options.repo=repository] - Injectable data repository
 * @returns {Promise<Object>} Active thresholds, category metadata, defaults, and `source` (`'configured'` | `'default'`)
 */
export const getBpConfig = async ({ repo = repository } = {}) => {
  if (typeof repo.getBpThresholdSettings !== 'function') {
    throw Object.assign(new Error('Blood-pressure configuration storage is not available.'), { statusCode: 503 });
  }
  const row = await repo.getBpThresholdSettings();
  const resolved = resolveThresholds(row);
  const validation = validateThresholdPayload(resolved);
  const configured = Boolean(row?.updatedBy) && !validation.errors.length;
  const thresholds = configured ? validation.thresholds : { ...DEFAULT_BP_THRESHOLDS };
  const labels = {};
  const categories = Object.values(BP_CATEGORIES).map((c) => ({
    code: c.code,
    label: (typeof labels[c.code] === 'string' && labels[c.code].trim()) ? labels[c.code].trim() : c.label,
    severity: c.severity,
    emergency: Boolean(c.emergency),
  }));
  const config = {
    thresholds,
    labels,
    categories,
    defaults: { ...DEFAULT_BP_THRESHOLDS },
    source: configured ? 'configured' : 'default',
    updatedAt: row?.updatedAt || null,
  };
  if (repo === repository) setBloodPressureConfig(config);
  return config;
};

/**
 * Classify a systolic/diastolic reading with the shared clinical rules and symptoms.
 *
 * @param {Object} reading - Blood-pressure reading (`{ systolic, diastolic }`)
 * @param {Object} [options] - Service options
 * @param {Object} [options.context] - Current complaint, findings and boolean indicators
 * @returns {Promise<Object>} Resolved BP category, label, severity, and emergency flag
 */
export const classifyWithConfig = async (reading, { context = {}, repo = repository } = {}) => {
  const config = await getBpConfig({ repo });
  return classify(reading, context, config);
};

/** Best-effort audit logger recording before/after threshold snapshots in `health_audit_logs`. */
const audit = async ({ repo = repository, user, action, previous, next }) => {
  if (typeof repo.insertHealthAuditLog !== 'function') return;
  await safe(() => repo.insertHealthAuditLog({
    actorId: user?.id || null,
    action,
    entityType: 'bp_threshold_configuration',
    entityId: 'thresholds',
    municipalityId: user?.municipalityId || null,
    barangayId: user?.barangayId || null,
    metadata: { previous: previous ?? null, next: next ?? null },
  }), null);
};

/**
 * Validate and persist updated blood-pressure thresholds (System Administrator only).
 *
 * Rejects overlapping or non-monotonic cut-offs with `422 Unprocessable Entity`,
 * preserves existing category labels when `payload.labels` is omitted, logs
 * `BP_THRESHOLDS_UPDATED` to `health_audit_logs`, and returns the refreshed config.
 *
 * @param {Object} [options] - Update parameters
 * @param {Object} options.user - Authenticated session user (must have `role === 'admin'`)
 * @param {Object} [options.payload={}] - Proposed threshold cut-offs and optional custom `labels`
 * @param {Object} [options.repo=repository] - Injectable data repository
 * @returns {Promise<Object>} Updated BP configuration payload from `getBpConfig`
 */
export const updateThresholds = async ({ user, payload = {}, repo = repository } = {}) => {
  assertAdmin(user);
  if (typeof repo.saveBpThresholdSettings !== 'function') {
    throw Object.assign(new Error('Blood-pressure configuration storage is not available.'), { statusCode: 503 });
  }
  const { errors, thresholds } = validateThresholdPayload(payload);
  if (errors.length) throw ApiError.unprocessable('Please correct the blood-pressure thresholds.', errors);
  if (payload.labels && Object.entries(payload.labels).some(([code, label]) => label && label !== BP_CATEGORIES[code]?.label)) {
    throw ApiError.unprocessable('Clinical blood-pressure category labels must use the shared reference labels.');
  }
  const before = await safe(() => repo.getBpThresholdSettings?.(), null);
  const labels = {};
  const saved = await repo.saveBpThresholdSettings({ ...thresholds, labels, updatedBy: user?.id || null });
  await audit({ repo, user, action: 'BP_THRESHOLDS_UPDATED', previous: before, next: saved });
  const config = await getBpConfig({ repo });
  if (repo === repository) setBloodPressureConfig(config);
  return config;
};

export default { getBpConfig, classifyWithConfig, updateThresholds };
