/**
 * Risk configuration service — the ONE place the resident risk CRITERIA and
 * THRESHOLDS are resolved and (for the System Administrator) edited.
 *
 * Resolution order for the active configuration:
 *   1. the database tables `public.risk_criteria` / `public.risk_settings`
 *      (when applied and populated), otherwise
 *   2. the documented defaults in `config/riskConfig.js`, which reproduce the
 *      project's pre-existing resident risk behavior.
 *
 * Administrators change the configuration here; every change is written to the
 * existing `health_audit_logs` audit trail (who / what / previous / new /
 * timestamp) and triggers a recalculation of affected residents so the new
 * classification propagates everywhere resident risk is shown. The backend is
 * authoritative: client-supplied risk scores/levels are never accepted.
 */
import repository from '../repositories/index.js';
import ApiError from '../utils/apiError.js';
import {
  DEFAULT_RISK_CRITERIA,
  DEFAULT_RISK_THRESHOLDS,
  RISK_FIELDS,
  RISK_OPERATORS,
} from '../config/riskConfig.js';

const ALLOWED_FIELDS = new Set(RISK_FIELDS.map((f) => f.field));

const num = (value) => {
  if (value === null || value === undefined || String(value).trim() === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

const safe = async (fn, fallback) => {
  try {
    const result = await fn();
    return result;
  } catch {
    return fallback;
  }
};

/**
 * The active configuration: { thresholds:{moderateMin,highMin},
 * criteria:[...] }. Falls back to the documented defaults whenever the DB
 * configuration is unavailable or empty, so risk assessment always works.
 */
export const getRiskConfig = async ({ repo = repository } = {}) => {
  const criteria = typeof repo.listRiskCriteria === 'function'
    ? await safe(() => repo.listRiskCriteria(), null)
    : null;
  const settings = typeof repo.getRiskSettings === 'function'
    ? await safe(() => repo.getRiskSettings(), null)
    : null;

  const thresholds = settings && num(settings.moderateMin) !== null && num(settings.highMin) !== null
    ? { moderateMin: num(settings.moderateMin), highMin: num(settings.highMin) }
    : { ...DEFAULT_RISK_THRESHOLDS };

  const resolvedCriteria = Array.isArray(criteria) && criteria.length
    ? criteria.map((c) => ({ ...c, value: num(c.value), value2: num(c.value2), weight: Number(c.weight) || 0 }))
    : DEFAULT_RISK_CRITERIA.map((c) => ({ ...c }));

  return { thresholds, criteria: resolvedCriteria };
};

/** Admin guard. */
const assertAdmin = (user) => {
  if (user?.role !== 'admin') {
    throw ApiError.forbidden('Only the System Administrator may change the risk configuration.');
  }
};

const audit = async ({ user, action, entityId, previous, next }) => {
  if (typeof repository.insertHealthAuditLog !== 'function') return;
  await safe(() => repository.insertHealthAuditLog({
    actorId: user?.id || null,
    action,
    entityType: 'risk_configuration',
    entityId: String(entityId),
    municipalityId: user?.municipalityId || null,
    barangayId: user?.barangayId || null,
    metadata: { previous: previous ?? null, next: next ?? null },
  }), null);
};

/** Validate + normalize an incoming criterion payload. */
const normalizeCriterion = (payload = {}) => {
  const code = String(payload.code ?? '').trim().toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '');
  const name = String(payload.name ?? '').trim();
  const field = String(payload.field ?? '').trim();
  const operator = String(payload.operator ?? '').trim();
  const value = num(payload.value);
  const value2 = num(payload.value2);
  const weight = num(payload.weight);
  const errors = [];
  if (!code) errors.push('A criterion code is required.');
  if (!name) errors.push('A criterion name is required.');
  if (!ALLOWED_FIELDS.has(field)) errors.push(`Field must be one of: ${[...ALLOWED_FIELDS].join(', ')}.`);
  if (!RISK_OPERATORS.includes(operator)) errors.push(`Operator must be one of: ${RISK_OPERATORS.join(', ')}.`);
  if (value === null) errors.push('A numeric threshold value is required.');
  if (operator === 'between' && value2 === null) errors.push('A second value is required for a "between" criterion.');
  if (weight === null || weight < 0) errors.push('Weight must be a non-negative number.');
  if (errors.length) throw ApiError.unprocessable('Please correct the risk criterion.', errors);
  return {
    code,
    name,
    description: String(payload.description ?? '').trim(),
    field,
    operator,
    value,
    value2: operator === 'between' ? value2 : null,
    weight,
    enabled: payload.enabled === undefined ? true : Boolean(payload.enabled),
    priority: num(payload.priority) ?? 100,
  };
};

const assertRepoSupport = (repo) => {
  if (typeof repo.upsertRiskCriterion !== 'function' || typeof repo.saveRiskSettings !== 'function') {
    throw Object.assign(
      new Error('Risk configuration storage is not available on this deployment.'),
      { statusCode: 503 },
    );
  }
};

export const listCriteria = async ({ repo = repository } = {}) => {
  const cfg = await getRiskConfig({ repo });
  return cfg.criteria;
};

export const upsertCriterion = async ({ user, payload = {}, repo = repository, recalc = defaultRecalc } = {}) => {
  assertAdmin(user);
  assertRepoSupport(repo);
  const criterion = normalizeCriterion(payload);
  const before = await safe(() => repo.getRiskCriterion?.(criterion.code), null);
  const saved = await repo.upsertRiskCriterion(criterion);
  await audit({
    user,
    action: before ? 'RISK_CRITERION_UPDATED' : 'RISK_CRITERION_CREATED',
    entityId: criterion.code,
    previous: before,
    next: saved,
  });
  await safe(() => recalc({ user }), null);
  return saved;
};

export const deleteCriterion = async ({ user, code, repo = repository, recalc = defaultRecalc } = {}) => {
  assertAdmin(user);
  assertRepoSupport(repo);
  const key = String(code ?? '').trim();
  if (!key) throw ApiError.unprocessable('A criterion code is required.');
  const before = await safe(() => repo.getRiskCriterion?.(key), null);
  if (typeof repo.deleteRiskCriterion !== 'function') {
    throw Object.assign(new Error('Delete is not supported on this deployment.'), { statusCode: 503 });
  }
  await repo.deleteRiskCriterion(key);
  await audit({ user, action: 'RISK_CRITERION_DELETED', entityId: key, previous: before, next: null });
  await safe(() => recalc({ user }), null);
  return { code: key, deleted: true };
};

export const updateThresholds = async ({ user, payload = {}, repo = repository, recalc = defaultRecalc } = {}) => {
  assertAdmin(user);
  assertRepoSupport(repo);
  const moderateMin = num(payload.moderateMin);
  const highMin = num(payload.highMin);
  const errors = [];
  if (moderateMin === null || moderateMin < 0) errors.push('Moderate threshold must be a non-negative number.');
  if (highMin === null || highMin < 0) errors.push('High threshold must be a non-negative number.');
  if (moderateMin !== null && highMin !== null && highMin <= moderateMin) {
    errors.push('The High threshold must be greater than the Moderate threshold.');
  }
  if (errors.length) throw ApiError.unprocessable('Please correct the risk thresholds.', errors);
  const before = await safe(() => repo.getRiskSettings?.(), null);
  const saved = await repo.saveRiskSettings({ moderateMin, highMin });
  await audit({ user, action: 'RISK_THRESHOLDS_UPDATED', entityId: 'thresholds', previous: before, next: saved });
  await safe(() => recalc({ user }), null);
  return saved;
};

// Recalculation is injected to avoid a circular import with residentRisk.service.
let defaultRecalc = async () => {};
export const setRecalcHandler = (fn) => { defaultRecalc = typeof fn === 'function' ? fn : defaultRecalc; };

export default {
  getRiskConfig,
  listCriteria,
  upsertCriterion,
  deleteCriterion,
  updateThresholds,
  setRecalcHandler,
};
