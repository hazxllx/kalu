import { db, safeWrite, captureOwnerGuard, assertCurrentOwner } from './db.js';
import { encryptJson } from './crypto.js';
import { getOperation, buildOperation, OUTBOX_STATUS } from './outbox.js';
import { DRAFT_STATUS } from './drafts.js';
import { newId, newLocalRef } from './ids.js';
import { MUTATION_TIER } from './mutationPolicy.js';
import { residentsApi } from '../api/residentsApi.js';
import { cacheRecord } from './records.js';
import { refreshSyncState, requestSync } from './syncEngine.js';
import { EDITABLE_RESIDENT_FIELDS } from './residentOfflineService.js';

const requireResidentConflict = async (ownerId, opId) => {
  if (!ownerId) throw new Error('Sign in before reviewing offline changes.');
  const row = await db.outbox.get(opId);
  if (!row || row.ownerId !== ownerId || row.entity !== 'resident' || row.opType !== 'update' || row.status !== OUTBOX_STATUS.CONFLICT) {
    throw new Error('This resident conflict is not available to this account.');
  }
  return getOperation(opId, ownerId);
};

const fetchCurrent = async (ownerId, residentId) => {
  const result = await residentsApi.get(residentId, { ownerId });
  const resident = result?.resident ?? result;
  if (!resident?.id || !Number.isInteger(resident.revision) || resident.revision < 1) {
    throw new Error('The server did not return a current resident version. Reconnect after the revision migration is deployed.');
  }
  return resident;
};

/** No clinical values are put into notifications or plaintext queue metadata. */
export const reviewResidentConflict = async ({ ownerId, opId }) => {
  const guard = captureOwnerGuard(ownerId);
  assertCurrentOwner(guard);
  const operation = await requireResidentConflict(ownerId, opId);
  const serverResident = await fetchCurrent(ownerId, operation.targetServerId || operation.serverId);
  assertCurrentOwner(guard);
  const fields = Object.entries(operation.payload || {})
    .filter(([field]) => EDITABLE_RESIDENT_FIELDS.has(field))
    .map(([field, localValue]) => ({ field, localValue, serverValue: serverResident[field] ?? '' }));
  return { opId, residentId: serverResident.id, revision: serverResident.revision, serverResident, fields };
};

/** Explicitly retain the server version or resubmit only the fields reviewed. */
export const resolveResidentConflict = async ({ ownerId, opId, reviewedRevision, selectedFields = [], useServer = false }) => {
  const guard = captureOwnerGuard(ownerId);
  assertCurrentOwner(guard);
  const operation = await requireResidentConflict(ownerId, opId);
  const current = await fetchCurrent(ownerId, operation.targetServerId || operation.serverId);
  assertCurrentOwner(guard);
  if (current.revision !== reviewedRevision) {
    throw new Error('The server record changed again. Reload the conflict comparison before deciding.');
  }
  const fields = [...new Set(selectedFields)];
  if (!useServer && (!fields.length || fields.some((field) => !EDITABLE_RESIDENT_FIELDS.has(field) || !Object.hasOwn(operation.payload, field)))) {
    throw new Error('Select at least one of the saved local fields to apply.');
  }
  const now = Date.now();
  const localId = useServer ? null : newId();
  const payload = Object.fromEntries(fields.map((field) => [field, operation.payload[field]]));
  const encrypted = useServer ? null : await encryptJson(payload);
  assertCurrentOwner(guard);
  const replacement = useServer ? null : buildOperation({
    entity: 'resident', opType: 'update', ownerId, localRecordId: localId,
    targetServerId: current.id, baseRevision: current.revision,
    mutationType: MUTATION_TIER.SAFE_SYNC,
  }, encrypted);

  // Retire the original and create its replacement in one transaction. The old
  // encrypted payload remains available until the account clears settled work.
  await safeWrite(() => db.transaction('rw', db.outbox, db.drafts, async () => {
    assertCurrentOwner(guard);
    const original = await db.outbox.get(opId);
    const originalDraft = original && await db.drafts.get(original.localRecordId);
    assertCurrentOwner(guard);
    if (original?.ownerId !== ownerId || original.status !== OUTBOX_STATUS.CONFLICT || originalDraft?.ownerId !== ownerId) {
      throw new Error('The conflict was already resolved or belongs to another account.');
    }
    const resolution = { action: useServer ? 'keep-server' : 'resubmit-reviewed-fields', replacementOpId: replacement?.opId ?? null, revision: current.revision, at: now };
    await db.outbox.update(opId, { status: OUTBOX_STATUS.RESOLVED, resolution, lastError: null, updatedAt: now });
    await db.drafts.update(original.localRecordId, { status: DRAFT_STATUS.RESOLVED, resolution, updatedAt: now });
    if (replacement) {
      await db.outbox.put(replacement);
      await db.drafts.put({
        localId, entity: 'resident', ownerId, data: encrypted,
        serverId: current.id, targetServerId: current.id, revision: current.revision,
        status: DRAFT_STATUS.PENDING, mutationType: MUTATION_TIER.SAFE_SYNC,
        localRef: newLocalRef('EDIT'), createdAt: now, updatedAt: now,
      });
      const dependents = await db.outbox.where('ownerId').equals(ownerId).toArray();
      for (const dependent of dependents) {
        if ((dependent.dependsOn || []).includes(opId) && dependent.status !== OUTBOX_STATUS.SYNCED && dependent.status !== OUTBOX_STATUS.RESOLVED) {
          await db.outbox.update(dependent.opId, { dependsOn: dependent.dependsOn.map((id) => id === opId ? replacement.opId : id), updatedAt: now });
        }
      }
    }
    assertCurrentOwner(guard);
  }));
  assertCurrentOwner(guard);
  await cacheRecord({ entity: 'resident', remoteId: current.id, ownerId, data: current, revision: current.revision });
  await refreshSyncState();
  if (replacement) await requestSync('resident-conflict-resolved');
  return { queued: Boolean(replacement), serverResident: current };
};
