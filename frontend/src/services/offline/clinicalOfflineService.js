/**
 * Clinical read-cache offline service — Phase 1.
 *
 * Extends the existing offline infrastructure (Dexie records store, AES-GCM
 * encryption, owner-scoped access) to cache clinical records that were
 * previously fetched online. When the network is unavailable the service
 * returns the cached copy so the user can still VIEW records.
 *
 * This module is READ-ONLY. It never creates, edits, deletes, or synchronizes
 * clinical records. Write operations remain online-only until a later phase
 * introduces safe offline mutations with conflict handling.
 *
 * Network functions are injected so this module is testable without HTTP mocks.
 */

import { db, captureOwnerGuard, assertCurrentOwner } from './db.js';
import { cacheRecord, getCachedRecord, listCachedRecords, removeCachedRecord } from './records.js';
import { isNavigatorOnline } from './connectivity.js';
import { classifySyncError, SYNC_ERROR } from './errors.js';

const isNetworkFailure = (error) => classifySyncError(error).code === SYNC_ERROR.NETWORK;

const hasActiveFilterParams = (params) =>
  Boolean(params && typeof params === 'object' && Object.values(params).some((v) => v !== undefined && v !== null && v !== ''));

const latestCachedTimestamp = (rows) => {
  let latest = null;
  for (const row of rows) {
    if (Number.isFinite(row?.cachedAt) && (latest === null || row.cachedAt > latest)) {
      latest = row.cachedAt;
    }
  }
  return latest;
};

// ---------------------------------------------------------------------------
// Generic helpers
// ---------------------------------------------------------------------------

/**
 * Network-first list fetch with IndexedDB fallback.
 *
 * @param {object}   opts
 * @param {string}   opts.ownerId        - Authenticated user id.
 * @param {string}   opts.entity         - Cache entity key.
 * @param {Function} opts.fetchFn        - `(params) => Promise<response>` — the API call.
 * @param {object}   [opts.params]       - Query parameters forwarded to fetchFn.
 * @param {string}   [opts.rowsKey]      - Key in the response that holds the array (default 'rows').
 * @param {Function} [opts.filterCached] - Optional `(recordData) => boolean` applied on cache fallback.
 * @param {Function} [opts.online]       - Override for `isNavigatorOnline`.
 * @returns {Promise<{ rows: object[], source: 'server'|'cache', stale?: boolean, cachedAt?: number|null }>}
 */
export const listWithOfflineFallback = async ({
  ownerId,
  entity,
  fetchFn,
  params = {},
  rowsKey = 'rows',
  filterCached = null,
  online = isNavigatorOnline,
}) => {
  if (!ownerId) throw new Error('A signed-in user is required.');
  const guard = captureOwnerGuard(ownerId);

  if (online() && typeof fetchFn === 'function') {
    try {
      const result = await fetchFn(params);
      assertCurrentOwner(guard);

      // Normalize the rows array from the response shape.
      const rows = Array.isArray(result)
        ? result
        : result?.[rowsKey] ?? result?.records ?? result?.rows;

      if (!Array.isArray(rows)) {
        throw new Error(`The server did not return valid ${entity} records.`);
      }

      const freshIds = new Set(rows.filter((row) => row?.id != null).map((row) => String(row.id)));

      // Cache each row individually.
      await Promise.all(
        rows.filter((row) => row?.id != null).map((row) =>
          cacheRecord({
            entity,
            remoteId: row.id,
            ownerId,
            data: row,
            revision: row.revision ?? null,
          }),
        ),
      );
      assertCurrentOwner(guard);

      // When performing a full unfiltered list fetch, prune stale entries for
      // this entity so deleted or out-of-scope records are removed from cache.
      if (!hasActiveFilterParams(params)) {
        const existing = await db.records.where('ownerId').equals(ownerId).filter((r) => r.entity === entity).toArray();
        assertCurrentOwner(guard);
        for (const staleRow of existing) {
          if (!freshIds.has(String(staleRow.remoteId))) {
            await removeCachedRecord(entity, staleRow.remoteId, ownerId);
          }
        }
      }

      return { rows, source: 'server', stale: false, cachedAt: Date.now() };
    } catch (error) {
      if (!isNetworkFailure(error)) throw error;
      // Fall through to cache.
    }
  }

  // Offline or network failure — serve from cache.
  const cachedAll = await listCachedRecords(ownerId, entity);
  assertCurrentOwner(guard);
  const cached = typeof filterCached === 'function'
    ? cachedAll.filter((row) => row?.data && filterCached(row.data))
    : cachedAll;

  return {
    rows: cached.map((row) => row.data),
    source: 'cache',
    stale: cached.some((row) => row.stale),
    cachedAt: latestCachedTimestamp(cached),
  };
};

/**
 * Network-first single-record fetch with IndexedDB fallback.
 *
 * @param {object}   opts
 * @param {string}   opts.ownerId    - Authenticated user id.
 * @param {string}   opts.entity     - Cache entity key.
 * @param {string}   opts.id         - Record id.
 * @param {Function} opts.fetchFn    - `(id) => Promise<record>` — the API call.
 * @param {Function} [opts.online]   - Override for `isNavigatorOnline`.
 * @returns {Promise<{ record: object, source: 'server'|'cache', stale?: boolean, cachedAt?: number|null }>}
 */
export const getWithOfflineFallback = async ({
  ownerId,
  entity,
  id,
  fetchFn,
  online = isNavigatorOnline,
}) => {
  if (!ownerId) throw new Error('A signed-in user is required.');
  if (!id) throw new Error(`A ${entity} record id is required.`);
  const guard = captureOwnerGuard(ownerId);

  if (online() && typeof fetchFn === 'function') {
    try {
      const result = await fetchFn(id);
      assertCurrentOwner(guard);
      const record = result && typeof result === 'object' && !Array.isArray(result)
        ? (result.record ?? result.referral ?? result)
        : result;

      if (!record || typeof record !== 'object' || !record.id) {
        throw new Error(`The server did not return a valid ${entity} record.`);
      }

      await cacheRecord({
        entity,
        remoteId: record.id,
        ownerId,
        data: record,
        revision: record.revision ?? null,
      });
      assertCurrentOwner(guard);
      return { record, source: 'server', stale: false, cachedAt: Date.now() };
    } catch (error) {
      if (!isNetworkFailure(error)) throw error;
    }
  }

  const cached = await getCachedRecord(entity, id, ownerId);
  assertCurrentOwner(guard);
  if (!cached?.data) {
    throw new Error(
      `This ${entity} record is not available offline. Open it while connected first.`,
    );
  }
  return { record: cached.data, source: 'cache', stale: cached.stale, cachedAt: cached.cachedAt ?? null };
};

/**
 * Network-first aggregate/report fetch with IndexedDB fallback.
 * Uses a composite cache key since aggregates have no row-level id.
 *
 * @param {object}   opts
 * @param {string}   opts.ownerId    - Authenticated user id.
 * @param {string}   opts.entity     - Cache entity key.
 * @param {string}   opts.cacheKey   - Composite key (e.g. 'Monthly-2024-6').
 * @param {Function} opts.fetchFn    - `(params) => Promise<data>` — the API call.
 * @param {object}   [opts.params]   - Query parameters forwarded to fetchFn.
 * @param {Function} [opts.validate] - Optional `(data) => void` to reject incomplete payloads before caching.
 * @param {Function} [opts.online]   - Override for `isNavigatorOnline`.
 * @returns {Promise<{ data: object, source: 'server'|'cache', stale?: boolean, cachedAt?: number|null }>}
 */
export const getAggregateWithOfflineFallback = async ({
  ownerId,
  entity,
  cacheKey,
  fetchFn,
  params = {},
  validate = null,
  online = isNavigatorOnline,
}) => {
  if (!ownerId) throw new Error('A signed-in user is required.');
  if (!cacheKey) throw new Error('A cache key is required for aggregate data.');
  const guard = captureOwnerGuard(ownerId);

  if (online() && typeof fetchFn === 'function') {
    try {
      const data = await fetchFn(params);
      assertCurrentOwner(guard);
      if (!data || typeof data !== 'object') {
        throw new Error(`The server did not return valid ${entity} data.`);
      }
      if (typeof validate === 'function') validate(data);
      await cacheRecord({ entity, remoteId: cacheKey, ownerId, data });
      assertCurrentOwner(guard);
      return { data, source: 'server', stale: false, cachedAt: Date.now() };
    } catch (error) {
      if (!isNetworkFailure(error)) throw error;
    }
  }

  const cached = await getCachedRecord(entity, cacheKey, ownerId);
  assertCurrentOwner(guard);
  if (!cached?.data) {
    throw new Error(
      `This ${entity} report is not available offline. Load it while connected first.`,
    );
  }
  return { data: cached.data, source: 'cache', stale: cached.stale, cachedAt: cached.cachedAt ?? null };
};

// ---------------------------------------------------------------------------
// Module-specific convenience wrappers
// ---------------------------------------------------------------------------

/** TCL records. Entity: 'tcl'. */
export const listTclOffline = (opts) =>
  listWithOfflineFallback({ ...opts, entity: 'tcl' });

/** Maternal records. Entity: 'maternal'. */
export const listMaternalOffline = (opts) =>
  listWithOfflineFallback({ ...opts, entity: 'maternal' });

/**
 * Maternal visits. Entity: 'maternalvisit'.
 * Filters cached visits by `params.residentId` when provided so opening one
 * resident offline never shows another resident's cached visits.
 */
export const listMaternalVisitsOffline = (opts = {}) => {
  const residentId = opts?.params?.residentId;
  return listWithOfflineFallback({
    ...opts,
    entity: 'maternalvisit',
    filterCached: residentId
      ? (row) => String(row.resident_id || row.residentId || '') === String(residentId)
      : null,
  });
};

/** Immunization records. Entity: 'immunization'. */
export const listImmunizationsOffline = (opts) =>
  listWithOfflineFallback({ ...opts, entity: 'immunization' });

/** NCD Risk records. Entity: 'ncd-risk'. */
export const listNcdRiskOffline = (opts) =>
  listWithOfflineFallback({ ...opts, entity: 'ncd-risk' });

/** NCD Cervical records. Entity: 'ncd-cervical'. */
export const listNcdCervicalOffline = (opts) =>
  listWithOfflineFallback({ ...opts, entity: 'ncd-cervical' });

/** NCD Visual records. Entity: 'ncd-visual'. */
export const listNcdVisualOffline = (opts) =>
  listWithOfflineFallback({ ...opts, entity: 'ncd-visual' });

/** Oral Health records. Entity: 'oral-health'. */
export const listOralHealthOffline = (opts) =>
  listWithOfflineFallback({ ...opts, entity: 'oral-health' });

/** Environmental Health Masterlist records. Entity: 'environmental'. */
export const listEnvironmentalOffline = (opts) =>
  listWithOfflineFallback({ ...opts, entity: 'environmental' });

const PROGRAM_FORM_ENTITIES = new Set([
  'ncd-risk',
  'ncd-cervical',
  'ncd-visual',
  'oral-health',
  'environmental',
]);

/** Generic program-form list reader for ProgramFormPage & TclWorkspace. */
export const listProgramFormOffline = ({ kind, ...opts }) => {
  if (!PROGRAM_FORM_ENTITIES.has(kind)) {
    throw new Error(`Unsupported program form entity: ${kind}`);
  }
  return listWithOfflineFallback({ ...opts, entity: kind });
};

/**
 * Oral Health BOHC statistics (aggregate values, NOT individual client rows).
 * Entity: 'oralHealthStatistics'.
 */
export const getOralStatisticsOffline = ({ ownerId, params = {}, fetchFn, online }) => {
  const { from = '', to = '', population = '' } = params;
  const cacheKey = `${from}|${to}|${population}`;
  return getAggregateWithOfflineFallback({
    ownerId,
    entity: 'oralHealthStatistics',
    cacheKey,
    fetchFn,
    params,
    validate: (data) => {
      if (!data || typeof data !== 'object' || (!data.statistics && !data.bohc)) {
        throw new Error('The server did not return valid oral health statistics.');
      }
    },
    online,
  });
};

/** Outgoing / box-scoped referrals. Entity: 'referral' (or 'referral-{box}'). */
export const listReferralsOffline = (opts = {}) => {
  const box = opts?.params?.box;
  const entity = box && box !== 'all' ? `referral-${box}` : 'referral';
  return listWithOfflineFallback({ ...opts, entity });
};

/** Incoming referrals inbox. Entity: 'referralIncoming'. */
export const listReferralInboxOffline = (opts) =>
  listWithOfflineFallback({ ...opts, entity: 'referralIncoming' });

/** Single referral by id. Default entity: 'referral' (pass entity for inbox detail separation). */
export const getReferralOffline = ({ entity = 'referral', ...opts }) =>
  getWithOfflineFallback({ ...opts, entity });

/** M1 period report (aggregate). Entity: 'm1Report'. */
export const getM1ReportOffline = ({ ownerId, params = {}, fetchFn, validate = null, online }) => {
  const { period = '', year = '', month = '', quarter = '' } = params;
  const cacheKey = `${period}-${year}-${month}-${quarter}`;
  return getAggregateWithOfflineFallback({
    ownerId,
    entity: 'm1Report',
    cacheKey,
    fetchFn,
    params,
    validate: (data) => {
      if (!data || typeof data !== 'object' || Array.isArray(data) || Object.keys(data).length === 0) {
        throw new Error('Invalid M1 report response.');
      }
      if ('byCode' in data && (!data.byCode || typeof data.byCode !== 'object' || Array.isArray(data.byCode))) {
        throw new Error('Invalid M1 report response.');
      }
      if (typeof validate === 'function') validate(data);
    },
    online,
  });
};

/** M1 daily participant activity (aggregate payload). Entity: 'm1Daily'. */
export const getM1DailyOffline = ({ ownerId, date = '', fetchFn, online }) =>
  getAggregateWithOfflineFallback({
    ownerId,
    entity: 'm1Daily',
    cacheKey: String(date || ''),
    fetchFn: () => fetchFn(date),
    validate: (data) => {
      if (!Array.isArray(data?.participants)) {
        throw new Error('Invalid M1 daily activity response.');
      }
    },
    online,
  });

/** M1 report header metadata. Entity: 'm1Meta'. */
export const getM1MetaOffline = ({ ownerId, params = {}, fetchFn, online }) => {
  const { year = '', month = '' } = params;
  return getAggregateWithOfflineFallback({
    ownerId,
    entity: 'm1Meta',
    cacheKey: `${year}-${month}`,
    fetchFn,
    params,
    online,
  });
};

/** M1 indicator drilldown records. Entity: 'm1Drilldown'. */
export const getM1DrilldownOffline = ({ ownerId, code, params = {}, fetchFn, online }) => {
  const { period = '', year = '', month = '', quarter = '' } = params;
  const cacheKey = `${code}:${period}-${year}-${month}-${quarter}`;
  return getAggregateWithOfflineFallback({
    ownerId,
    entity: 'm1Drilldown',
    cacheKey,
    fetchFn: () => fetchFn(code, params),
    validate: (data) => {
      if (!Array.isArray(data?.records)) {
        throw new Error('Invalid underlying-record response.');
      }
    },
    online,
  });
};

/**
 * M1 program records + indicator summary bundle. Entity: 'm1Program-{programId}'.
 * Preserves the full period-scoped payload (`program`, `records`, `indicators`,
 * `summary`, `count`) AND returns `rows: records` for convenience.
 */
export const listM1ProgramOffline = async ({ ownerId, programId, params = {}, fetchFn, online }) => {
  const { period = '', year = '', month = '', quarter = '' } = params;
  const cacheKey = `${programId}:${period}-${year}-${month}-${quarter}`;
  const { data, source, stale, cachedAt } = await getAggregateWithOfflineFallback({
    ownerId,
    entity: `m1Program-${programId}`,
    cacheKey,
    fetchFn,
    params,
    validate: (res) => {
      if (!res || typeof res !== 'object' || !Array.isArray(res.records)) {
        throw new Error(`Invalid ${programId} program report response.`);
      }
      if (res.program && res.program !== programId) {
        throw new Error(`Program mismatch for ${programId}.`);
      }
    },
    online,
  });
  return {
    ...data,
    rows: data.records || [],
    source,
    stale,
    cachedAt,
  };
};

/**
 * Load record counts for all M1 programs with offline cache support.
 * Also pre-warms each program's `m1Program-{id}` period cache when online.
 */
export const loadM1ProgramCountsOffline = async ({ ownerId, params = {}, clients, online }) => {
  if (!ownerId) throw new Error('A signed-in user is required.');
  if (!clients || typeof clients !== 'object') throw new Error('M1 program clients are required.');

  let anyCache = false;
  let anyStale = false;
  let latestCachedAt = null;

  const pairs = await Promise.all(
    Object.entries(clients).map(async ([programId, client]) => {
      const response = await listM1ProgramOffline({
        ownerId,
        programId,
        params,
        fetchFn: (p) => client.list(p),
        online,
      });
      const count = response?.count?.records;
      if (!Number.isSafeInteger(count) || count < 0) {
        throw new Error(`Invalid ${programId} program count response.`);
      }
      if (response.source === 'cache') anyCache = true;
      if (response.stale) anyStale = true;
      if (Number.isFinite(response.cachedAt) && (latestCachedAt === null || response.cachedAt > latestCachedAt)) {
        latestCachedAt = response.cachedAt;
      }
      return [programId, count];
    }),
  );

  return {
    counts: Object.fromEntries(pairs),
    source: anyCache ? 'cache' : 'server',
    stale: anyStale,
    cachedAt: latestCachedAt,
  };
};

// ---------------------------------------------------------------------------
// Supported entity registry (for diagnostics / UI indicators)
// ---------------------------------------------------------------------------

export const CLINICAL_ENTITIES = Object.freeze([
  'tcl',
  'maternal',
  'maternalvisit',
  'immunization',
  'ncd-risk',
  'ncd-cervical',
  'ncd-visual',
  'oral-health',
  'oralHealthStatistics',
  'environmental',
  'referral',
  'referral-outgoing',
  'referral-incoming',
  'referralIncoming',
  'referralIncomingDetail',
  'm1Report',
  'm1Daily',
  'm1Meta',
  'm1Drilldown',
  'm1Program-prenatal',
  'm1Program-ncd',
  'm1Program-cervical',
  'm1Program-visual',
  'm1Program-oral',
  'm1Program-environmental',
  'm1Program-enrollment',
]);

export default {
  // Generic helpers
  listWithOfflineFallback,
  getWithOfflineFallback,
  getAggregateWithOfflineFallback,
  // Module wrappers
  listTclOffline,
  listMaternalOffline,
  listMaternalVisitsOffline,
  listImmunizationsOffline,
  listNcdRiskOffline,
  listNcdCervicalOffline,
  listNcdVisualOffline,
  listOralHealthOffline,
  listEnvironmentalOffline,
  listProgramFormOffline,
  getOralStatisticsOffline,
  listReferralsOffline,
  listReferralInboxOffline,
  getReferralOffline,
  getM1ReportOffline,
  getM1DailyOffline,
  getM1MetaOffline,
  getM1DrilldownOffline,
  listM1ProgramOffline,
  loadM1ProgramCountsOffline,
  CLINICAL_ENTITIES,
};
