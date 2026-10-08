import { db, safeWrite } from './db.js';
import { encryptJson } from './crypto.js';
import { newId, newLocalRef } from './ids.js';
import { buildOperation, OUTBOX_STATUS } from './outbox.js';
import { DRAFT_STATUS } from './drafts.js';
import { MUTATION_TIER, assertQueueableMutation } from './mutationPolicy.js';

/**
 * High-level queueing: write a local draft and its synchronization operation
 * together, atomically, so a queued change can never exist without its draft or
 * vice versa.
 *
 * Feature services call these helpers; components never touch IndexedDB.
 */

const nowMs = () => Date.now();

/**
 * Queue a locally created record.
 *
 * @param {{entity:string, ownerId:string, data:any, dependsOn?:string[], maxAttempts?:number}} input
 */
export const queueCreate = async ({
  entity,
  ownerId,
  data,
  dependsOn = [],
  maxAttempts,
  mutationType = MUTATION_TIER.ONLINE_ONLY,
  opId,
}) => {
  assertQueueableMutation(mutationType);
  if (mutationType !== MUTATION_TIER.SAFE_SYNC) {
    throw new Error('Offline drafts must be saved with queueOfflineDraft and cannot be auto-synchronized.');
  }
  const localId = newId();
  const encrypted = await encryptJson(data);
  const op = buildOperation(
    { entity, opType: 'create', ownerId, payload: data, localRecordId: localId, dependsOn, baseRevision: null, maxAttempts, mutationType, opId },
    encrypted,
  );
  const createdAt = nowMs();
  const draft = {
    localId,
    entity,
    ownerId,
    data: encrypted,
    status: DRAFT_STATUS.PENDING,
    serverId: null,
    revision: null,
    localRef: newLocalRef('LOCAL'),
    createdAt,
    updatedAt: createdAt,
  };
  await safeWrite(() =>
    db.transaction('rw', db.drafts, db.outbox, async () => {
      await db.outbox.put(op);
      await db.drafts.put(draft);
    }),
  );
  return { localId, operation: op, draft: { ...draft, data } };
};

/**
 * Queue an update to an existing record (identified by its server id) with the
 * revision the client last saw, enabling server-side optimistic concurrency.
 */
export const queueUpdate = async ({
  entity,
  ownerId,
  serverId,
  data,
  baseRevision = null,
  dependsOn = [],
  mutationType = MUTATION_TIER.ONLINE_ONLY,
  opId,
}) => {
  assertQueueableMutation(mutationType);
  if (mutationType !== MUTATION_TIER.SAFE_SYNC) {
    throw new Error('Offline drafts must be saved with queueOfflineDraft and cannot be auto-synchronized.');
  }
  const localId = newId();
  const encrypted = await encryptJson(data);
  const op = buildOperation(
    { entity, opType: 'update', ownerId, payload: data, localRecordId: localId, dependsOn, baseRevision, targetServerId: serverId, mutationType, opId },
    encrypted,
  );
  const createdAt = nowMs();
  const draft = {
    localId,
    entity,
    ownerId,
    data: encrypted,
    status: DRAFT_STATUS.PENDING,
    serverId,
    revision: baseRevision,
    localRef: newLocalRef('EDIT'),
    targetServerId: serverId,
    createdAt,
    updatedAt: createdAt,
  };
  await safeWrite(() =>
    db.transaction('rw', db.drafts, db.outbox, async () => {
      await db.outbox.put(op);
      await db.drafts.put(draft);
    }),
  );
  return { localId, operation: op, draft: { ...draft, data } };
};

/**
 * Save work locally for later review without putting it in the automatic-sync
 * outbox. A feature may only promote it through its existing authorized draft
 * workflow; this helper never finalizes the underlying operation.
 */
export const queueOfflineDraft = async ({ entity, ownerId, data }) => {
  if (!ownerId) throw new Error('A signed-in user is required to save an offline draft.');
  const localId = newId();
  const encrypted = await encryptJson(data);
  const createdAt = nowMs();
  const draft = {
    localId,
    entity,
    ownerId,
    data: encrypted,
    status: DRAFT_STATUS.OFFLINE_DRAFT,
    serverId: null,
    revision: null,
    localRef: newLocalRef('DRAFT'),
    mutationType: MUTATION_TIER.OFFLINE_DRAFT,
    createdAt,
    updatedAt: createdAt,
  };
  await safeWrite(() => db.drafts.put(draft));
  return { localId, draft: { ...draft, data } };
};

/** Pending (not yet server-confirmed) drafts for display, newest first. */
export const listPendingDrafts = async (ownerId, entity = null) => {
  let rows = await db.drafts.where('ownerId').equals(ownerId).toArray();
  if (entity) rows = rows.filter((row) => row.entity === entity);
  return rows
    .filter((row) => row.status !== DRAFT_STATUS.SYNCED)
    .sort((a, b) => b.createdAt - a.createdAt);
};

export const getLocalCounts = async (ownerId) => {
  if (!ownerId) return { pending: 0, failed: 0, conflict: 0, offlineDraft: 0 };
  const rows = await db.drafts.where('ownerId').equals(ownerId).toArray();
  return rows.reduce(
    (acc, row) => {
      if (row.status === DRAFT_STATUS.PENDING) acc.pending += 1;
      else if (row.status === DRAFT_STATUS.FAILED) acc.failed += 1;
      else if (row.status === DRAFT_STATUS.CONFLICT) acc.conflict += 1;
      else if (row.status === DRAFT_STATUS.OFFLINE_DRAFT) acc.offlineDraft += 1;
      return acc;
    },
    { pending: 0, failed: 0, conflict: 0, offlineDraft: 0 },
  );
};

export { OUTBOX_STATUS, DRAFT_STATUS };
export default { queueCreate, queueUpdate, queueOfflineDraft, listPendingDrafts, getLocalCounts };
