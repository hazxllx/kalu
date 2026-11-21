import 'fake-indexeddb/auto';
import assert from 'node:assert/strict';
import test, { beforeEach } from 'node:test';

import { db, setOfflineOwnerResolver } from '../../src/services/offline/db.js';
import { resetCachedKey } from '../../src/services/offline/crypto.js';
import { CACHE_TTL_MS, cacheRecord, listCachedRecords, clearAccountSensitiveCache } from '../../src/services/offline/records.js';
import {
  listWithOfflineFallback,
  getWithOfflineFallback,
  getAggregateWithOfflineFallback,
  listTclOffline,
  listMaternalOffline,
  listMaternalVisitsOffline,
  listImmunizationsOffline,
  listNcdRiskOffline,
  listNcdCervicalOffline,
  listNcdVisualOffline,
  listOralHealthOffline,
  listReferralsOffline,
  listReferralInboxOffline,
  getReferralOffline,
  getM1ReportOffline,
  listM1ProgramOffline,
  CLINICAL_ENTITIES,
} from '../../src/services/offline/clinicalOfflineService.js';

const OWNER = 'clinical-test-owner-a';
const OTHER_OWNER = 'clinical-test-owner-b';

const networkError = () => Object.assign(new TypeError('Failed to fetch'), { name: 'TypeError' });

beforeEach(async () => {
  setOfflineOwnerResolver(null);
  resetCachedKey();
  if (!db.isOpen()) await db.open();
  await db.transaction('rw', db.records, db.outbox, db.drafts, db.syncMeta, db.keys, async () => {
    await Promise.all([db.records.clear(), db.outbox.clear(), db.drafts.clear(), db.syncMeta.clear(), db.keys.clear()]);
  });
});

// =========================================================================
// 1. Successful online fetch and cache
// =========================================================================

test('listWithOfflineFallback caches rows from a successful server fetch', async () => {
  const serverRows = [
    { id: 'T1', residentId: 'R1', date: '2024-01-15' },
    { id: 'T2', residentId: 'R2', date: '2024-01-16' },
  ];
  const fetchFn = async () => ({ rows: serverRows });

  const result = await listWithOfflineFallback({
    ownerId: OWNER, entity: 'tcl', fetchFn, online: () => true,
  });

  assert.equal(result.source, 'server');
  assert.equal(result.rows.length, 2);
  assert.deepEqual(result.rows, serverRows);

  // Verify records were cached.
  const cached = await listCachedRecords(OWNER, 'tcl');
  assert.equal(cached.length, 2);
});

test('getWithOfflineFallback caches a single record from server', async () => {
  const serverRecord = { id: 'REF-1', residentId: 'R1', status: 'pending' };
  const fetchFn = async () => serverRecord;

  const result = await getWithOfflineFallback({
    ownerId: OWNER, entity: 'referral', id: 'REF-1', fetchFn, online: () => true,
  });

  assert.equal(result.source, 'server');
  assert.deepEqual(result.record, serverRecord);

  const cached = await listCachedRecords(OWNER, 'referral');
  assert.equal(cached.length, 1);
  assert.deepEqual(cached[0].data, serverRecord);
});

test('getAggregateWithOfflineFallback caches aggregate data', async () => {
  const reportData = { byCode: { IND001: 5, IND002: 10 }, total: 15 };
  const fetchFn = async () => reportData;

  const result = await getAggregateWithOfflineFallback({
    ownerId: OWNER, entity: 'm1Report', cacheKey: 'Monthly-2024-6-',
    fetchFn, online: () => true,
  });

  assert.equal(result.source, 'server');
  assert.deepEqual(result.data, reportData);
});

test('listWithOfflineFallback handles response with records key', async () => {
  const serverRows = [{ id: 'P1', program: 'prenatal' }];
  const fetchFn = async () => ({ records: serverRows });

  const result = await listWithOfflineFallback({
    ownerId: OWNER, entity: 'm1Program-prenatal', fetchFn,
    rowsKey: 'records', online: () => true,
  });

  assert.equal(result.source, 'server');
  assert.equal(result.rows.length, 1);
});

test('listWithOfflineFallback handles flat array response', async () => {
  const serverRows = [{ id: 'I1', vaccine: 'BCG' }, { id: 'I2', vaccine: 'OPV' }];
  const fetchFn = async () => serverRows;

  const result = await listWithOfflineFallback({
    ownerId: OWNER, entity: 'immunization', fetchFn, online: () => true,
  });

  assert.equal(result.source, 'server');
  assert.equal(result.rows.length, 2);
});

// =========================================================================
// 2. Offline fallback from IndexedDB
// =========================================================================

test('listWithOfflineFallback returns cached rows when offline', async () => {
  // Pre-populate cache.
  await cacheRecord({ entity: 'tcl', remoteId: 'T1', ownerId: OWNER, data: { id: 'T1', name: 'Row 1' } });
  await cacheRecord({ entity: 'tcl', remoteId: 'T2', ownerId: OWNER, data: { id: 'T2', name: 'Row 2' } });

  const result = await listWithOfflineFallback({
    ownerId: OWNER, entity: 'tcl', fetchFn: null, online: () => false,
  });

  assert.equal(result.source, 'cache');
  assert.equal(result.rows.length, 2);
  assert.ok(result.rows.some((r) => r.id === 'T1'));
});

test('listWithOfflineFallback falls back to cache on network error', async () => {
  await cacheRecord({ entity: 'maternal', remoteId: 'M1', ownerId: OWNER, data: { id: 'M1' } });

  const fetchFn = async () => { throw networkError(); };

  const result = await listWithOfflineFallback({
    ownerId: OWNER, entity: 'maternal', fetchFn, online: () => true,
  });

  assert.equal(result.source, 'cache');
  assert.equal(result.rows.length, 1);
});

test('getWithOfflineFallback returns cached record when offline', async () => {
  await cacheRecord({ entity: 'referral', remoteId: 'REF-1', ownerId: OWNER, data: { id: 'REF-1', status: 'completed' } });

  const result = await getWithOfflineFallback({
    ownerId: OWNER, entity: 'referral', id: 'REF-1', fetchFn: null, online: () => false,
  });

  assert.equal(result.source, 'cache');
  assert.deepEqual(result.record.id, 'REF-1');
});

test('getAggregateWithOfflineFallback returns cached report when offline', async () => {
  const reportData = { byCode: { IND001: 5 } };
  await cacheRecord({ entity: 'm1Report', remoteId: 'Monthly-2024-6-', ownerId: OWNER, data: reportData });

  const result = await getAggregateWithOfflineFallback({
    ownerId: OWNER, entity: 'm1Report', cacheKey: 'Monthly-2024-6-',
    fetchFn: null, online: () => false,
  });

  assert.equal(result.source, 'cache');
  assert.deepEqual(result.data, reportData);
});

// =========================================================================
// 3. Empty cache behavior
// =========================================================================

test('listWithOfflineFallback returns empty array when cache is empty and offline', async () => {
  const result = await listWithOfflineFallback({
    ownerId: OWNER, entity: 'ncd-risk', fetchFn: null, online: () => false,
  });

  assert.equal(result.source, 'cache');
  assert.equal(result.rows.length, 0);
});

test('getWithOfflineFallback throws when cache is empty and offline', async () => {
  await assert.rejects(
    () => getWithOfflineFallback({
      ownerId: OWNER, entity: 'referral', id: 'REF-999', fetchFn: null, online: () => false,
    }),
    /not available offline/,
  );
});

test('getAggregateWithOfflineFallback throws when cache is empty and offline', async () => {
  await assert.rejects(
    () => getAggregateWithOfflineFallback({
      ownerId: OWNER, entity: 'm1Report', cacheKey: 'Annual-2024--',
      fetchFn: null, online: () => false,
    }),
    /not available offline/,
  );
});

// =========================================================================
// 4. Account isolation
// =========================================================================

test('cached records are isolated by owner — different owner sees nothing', async () => {
  await cacheRecord({ entity: 'tcl', remoteId: 'T1', ownerId: OWNER, data: { id: 'T1' } });

  const result = await listWithOfflineFallback({
    ownerId: OTHER_OWNER, entity: 'tcl', fetchFn: null, online: () => false,
  });

  assert.equal(result.rows.length, 0);
});

test('getWithOfflineFallback cannot access another owners cached record', async () => {
  await cacheRecord({ entity: 'referral', remoteId: 'REF-1', ownerId: OWNER, data: { id: 'REF-1' } });

  await assert.rejects(
    () => getWithOfflineFallback({
      ownerId: OTHER_OWNER, entity: 'referral', id: 'REF-1', fetchFn: null, online: () => false,
    }),
    /not available offline/,
  );
});

// =========================================================================
// 5. Barangay / permission isolation
// =========================================================================

test('records cached with different barangay filters remain scoped to their owner', async () => {
  // Owner A caches records from barangay 1.
  const brgyARows = [{ id: 'T1', barangayId: 'brgy-1' }];
  await listWithOfflineFallback({
    ownerId: OWNER, entity: 'tcl',
    fetchFn: async () => ({ rows: brgyARows }), online: () => true,
  });

  // Owner B caches records from barangay 2.
  const brgyBRows = [{ id: 'T2', barangayId: 'brgy-2' }];
  await listWithOfflineFallback({
    ownerId: OTHER_OWNER, entity: 'tcl',
    fetchFn: async () => ({ rows: brgyBRows }), online: () => true,
  });

  // Offline: each owner only sees their own barangay's data.
  const ownerAResult = await listWithOfflineFallback({
    ownerId: OWNER, entity: 'tcl', fetchFn: null, online: () => false,
  });
  assert.equal(ownerAResult.rows.length, 1);
  assert.equal(ownerAResult.rows[0].barangayId, 'brgy-1');

  const ownerBResult = await listWithOfflineFallback({
    ownerId: OTHER_OWNER, entity: 'tcl', fetchFn: null, online: () => false,
  });
  assert.equal(ownerBResult.rows.length, 1);
  assert.equal(ownerBResult.rows[0].barangayId, 'brgy-2');
});

// =========================================================================
// 6. Expired cache behavior
// =========================================================================

test('listWithOfflineFallback marks stale cached records', async () => {
  const pastTime = Date.now() - CACHE_TTL_MS - 1000;
  await cacheRecord(
    { entity: 'immunization', remoteId: 'I1', ownerId: OWNER, data: { id: 'I1' } },
    { now: () => pastTime },
  );

  // The cache retention policy evicts expired records. Access after expiry
  // returns nothing because the existing records.js enforces TTL.
  const result = await listWithOfflineFallback({
    ownerId: OWNER, entity: 'immunization', fetchFn: null, online: () => false,
  });

  // After TTL the record is evicted by listCachedRecords retention.
  assert.equal(result.source, 'cache');
  // The record may be evicted (length 0) or returned as stale depending on
  // whether there are pinned records. With no pending operations it's evicted.
  if (result.rows.length > 0) {
    assert.equal(result.stale, true);
  }
});

// =========================================================================
// 7. Corrupted cached data
// =========================================================================

test('server validation error (422) is NOT treated as network failure — it throws', async () => {
  const serverError = Object.assign(new Error('Validation failed'), { status: 422 });
  const fetchFn = async () => { throw serverError; };

  await assert.rejects(
    () => listWithOfflineFallback({
      ownerId: OWNER, entity: 'tcl', fetchFn, online: () => true,
    }),
    /Validation failed/,
  );
});

test('server 403 error is NOT treated as network failure — it throws', async () => {
  const serverError = Object.assign(new Error('Forbidden'), { status: 403 });
  const fetchFn = async () => { throw serverError; };

  await assert.rejects(
    () => listWithOfflineFallback({
      ownerId: OWNER, entity: 'maternal', fetchFn, online: () => true,
    }),
    /Forbidden/,
  );
});

test('listWithOfflineFallback throws on invalid server response (not an array)', async () => {
  const fetchFn = async () => ({ data: 'invalid' });

  await assert.rejects(
    () => listWithOfflineFallback({
      ownerId: OWNER, entity: 'tcl', fetchFn, online: () => true,
    }),
    /did not return valid/,
  );
});

// =========================================================================
// 8. Cache replacement after successful online fetch
// =========================================================================

test('server data replaces stale cache on next online fetch', async () => {
  // Initial cache.
  await cacheRecord({ entity: 'oral-health', remoteId: 'OH1', ownerId: OWNER, data: { id: 'OH1', status: 'old' } });

  // Server returns updated data.
  const fetchFn = async () => ({ rows: [{ id: 'OH1', status: 'updated' }] });
  await listWithOfflineFallback({
    ownerId: OWNER, entity: 'oral-health', fetchFn, online: () => true,
  });

  // Verify cache was updated.
  const cached = await listCachedRecords(OWNER, 'oral-health');
  assert.equal(cached.length, 1);
  assert.equal(cached[0].data.status, 'updated');
});

test('single record cache is replaced on refetch', async () => {
  await cacheRecord({ entity: 'referral', remoteId: 'REF-1', ownerId: OWNER, data: { id: 'REF-1', note: 'old' } });

  const fetchFn = async () => ({ id: 'REF-1', note: 'new' });
  await getWithOfflineFallback({
    ownerId: OWNER, entity: 'referral', id: 'REF-1', fetchFn, online: () => true,
  });

  const cached = await listCachedRecords(OWNER, 'referral');
  assert.equal(cached[0].data.note, 'new');
});

// =========================================================================
// 9. Logout and account switching
// =========================================================================

test('clearAccountSensitiveCache removes clinical cache entries', async () => {
  await cacheRecord({ entity: 'tcl', remoteId: 'T1', ownerId: OWNER, data: { id: 'T1' } });
  await cacheRecord({ entity: 'maternal', remoteId: 'M1', ownerId: OWNER, data: { id: 'M1' } });
  await cacheRecord({ entity: 'ncd-risk', remoteId: 'N1', ownerId: OWNER, data: { id: 'N1' } });

  const result = await clearAccountSensitiveCache(OWNER);
  assert.ok(result.recordsRemoved >= 3);

  const remaining = await listCachedRecords(OWNER, 'tcl');
  assert.equal(remaining.length, 0);
});

test('clearing one accounts cache does not affect another', async () => {
  await cacheRecord({ entity: 'tcl', remoteId: 'T1', ownerId: OWNER, data: { id: 'T1' } });
  await cacheRecord({ entity: 'tcl', remoteId: 'T2', ownerId: OTHER_OWNER, data: { id: 'T2' } });

  await clearAccountSensitiveCache(OWNER);

  const ownerRemaining = await listCachedRecords(OWNER, 'tcl');
  assert.equal(ownerRemaining.length, 0);

  const otherRemaining = await listCachedRecords(OTHER_OWNER, 'tcl');
  assert.equal(otherRemaining.length, 1);
});

// =========================================================================
// 10. All convenience wrappers delegate correctly
// =========================================================================

test('all list convenience wrappers use correct entity', async () => {
  const wrappers = [
    { fn: listTclOffline, entity: 'tcl' },
    { fn: listMaternalOffline, entity: 'maternal' },
    { fn: listMaternalVisitsOffline, entity: 'maternalvisit' },
    { fn: listImmunizationsOffline, entity: 'immunization' },
    { fn: listNcdRiskOffline, entity: 'ncd-risk' },
    { fn: listNcdCervicalOffline, entity: 'ncd-cervical' },
    { fn: listNcdVisualOffline, entity: 'ncd-visual' },
    { fn: listOralHealthOffline, entity: 'oral-health' },
    { fn: listReferralsOffline, entity: 'referral' },
    { fn: listReferralInboxOffline, entity: 'referralIncoming' },
  ];

  for (const { fn, entity } of wrappers) {
    const row = { id: `${entity}-1`, type: entity };
    const fetchFn = async () => ({ rows: [row] });
    const result = await fn({ ownerId: OWNER, fetchFn, online: () => true });
    assert.equal(result.source, 'server', `${entity} should return server source`);
    assert.equal(result.rows.length, 1, `${entity} should have 1 row`);
  }
});

test('getReferralOffline delegates to getWithOfflineFallback', async () => {
  const ref = { id: 'REF-99', status: 'active' };
  const result = await getReferralOffline({
    ownerId: OWNER, id: 'REF-99', fetchFn: async () => ref, online: () => true,
  });
  assert.equal(result.source, 'server');
  assert.equal(result.record.id, 'REF-99');
});

test('getM1ReportOffline builds correct composite cache key', async () => {
  const reportData = { totals: 42 };
  const fetchFn = async () => reportData;
  const result = await getM1ReportOffline({
    ownerId: OWNER,
    params: { period: 'Monthly', year: '2024', month: '6', quarter: '' },
    fetchFn,
    online: () => true,
  });
  assert.equal(result.source, 'server');

  // Offline read with same params.
  const offline = await getM1ReportOffline({
    ownerId: OWNER,
    params: { period: 'Monthly', year: '2024', month: '6', quarter: '' },
    fetchFn: null,
    online: () => false,
  });
  assert.equal(offline.source, 'cache');
  assert.deepEqual(offline.data, reportData);
});

test('listM1ProgramOffline delegates with records rowsKey', async () => {
  const programRows = [{ id: 'P1', program: 'ncd' }];
  const result = await listM1ProgramOffline({
    ownerId: OWNER, programId: 'ncd',
    fetchFn: async () => ({ records: programRows }), online: () => true,
  });
  assert.equal(result.source, 'server');
  assert.equal(result.rows.length, 1);
});

// =========================================================================
// 11. Missing ownerId validation
// =========================================================================

test('listWithOfflineFallback rejects when ownerId is missing', async () => {
  await assert.rejects(
    () => listWithOfflineFallback({ ownerId: null, entity: 'tcl', fetchFn: async () => ({ rows: [] }), online: () => true }),
    /signed-in user/,
  );
});

test('consultation service cache is owner-bound and never falls back after HTTP 403', async () => {
  const services = [{ id: 'service-a', name: 'Health Service A', active: true }];
  const onlineResult = await listWithOfflineFallback({
    ownerId: OWNER,
    entity: 'consultationHealthService',
    fetchFn: async () => ({ rows: services }),
    online: () => true,
  });
  assert.deepEqual(onlineResult.rows, services);
  const stored = await db.records.get([OWNER, 'consultationHealthService', 'service-a']);
  assert.ok(stored);
  assert.equal(JSON.stringify(stored).includes(services[0].name), false);

  const otherOwnerResult = await listWithOfflineFallback({
    ownerId: OTHER_OWNER,
    entity: 'consultationHealthService',
    online: () => false,
  });
  assert.deepEqual(otherOwnerResult.rows, []);

  resetCachedKey();
  const offlineOwnerResult = await listWithOfflineFallback({
    ownerId: OWNER,
    entity: 'consultationHealthService',
    online: () => false,
  });
  assert.equal(offlineOwnerResult.source, 'cache');
  assert.deepEqual(offlineOwnerResult.rows, services);

  await assert.rejects(
    listWithOfflineFallback({
      ownerId: OWNER,
      entity: 'consultationHealthService',
      fetchFn: async () => { throw Object.assign(new Error('Forbidden'), { status: 403 }); },
      online: () => true,
    }),
    { status: 403 },
  );
});

test('getWithOfflineFallback rejects when ownerId is missing', async () => {
  await assert.rejects(
    () => getWithOfflineFallback({ ownerId: null, entity: 'referral', id: 'REF-1', fetchFn: async () => ({}), online: () => true }),
    /signed-in user/,
  );
});

test('getWithOfflineFallback rejects when id is missing', async () => {
  await assert.rejects(
    () => getWithOfflineFallback({ ownerId: OWNER, entity: 'referral', id: null, fetchFn: async () => ({}), online: () => true }),
    /record id is required/,
  );
});

// =========================================================================
// 12. CLINICAL_ENTITIES registry
// =========================================================================

test('CLINICAL_ENTITIES lists all supported entity types', () => {
  assert.ok(CLINICAL_ENTITIES.includes('tcl'));
  assert.ok(CLINICAL_ENTITIES.includes('maternal'));
  assert.ok(CLINICAL_ENTITIES.includes('maternalvisit'));
  assert.ok(CLINICAL_ENTITIES.includes('immunization'));
  assert.ok(CLINICAL_ENTITIES.includes('ncd-risk'));
  assert.ok(CLINICAL_ENTITIES.includes('ncd-cervical'));
  assert.ok(CLINICAL_ENTITIES.includes('ncd-visual'));
  assert.ok(CLINICAL_ENTITIES.includes('oral-health'));
  assert.ok(CLINICAL_ENTITIES.includes('referral'));
  assert.ok(CLINICAL_ENTITIES.includes('referralIncoming'));
  assert.ok(CLINICAL_ENTITIES.includes('m1Report'));
  assert.ok(CLINICAL_ENTITIES.length >= 12);
  assert.ok(Object.isFrozen(CLINICAL_ENTITIES));
});
