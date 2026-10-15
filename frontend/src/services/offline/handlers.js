import { api } from '@/services/api/apiClient';
import { MUTATION_TIER } from './mutationPolicy.js';

/**
 * Entity synchronization handlers.
 *
 * Each handler sends ONE queued operation through the existing authorized
 * backend API and returns the server's authoritative result. Handlers must:
 *   - attach the operation's idempotency key so a retried upload is deduplicated
 *     server-side and cannot create a duplicate record;
 *   - attach the last-seen revision for updates so the server can reject a
 *     conflicting concurrent edit (optimistic concurrency);
 *   - return `{ serverId, serverRecord }` so the engine can reconcile local ids
 *     and authoritative values.
 *
 * Only entities with an audited, authorized create/update workflow are
 * registered here. Registering a new entity is an explicit, reviewable step.
 */

const idempotencyHeaders = (op) => ({ headers: { 'Idempotency-Key': op.idempotencyKey } });

const revisionHeaders = (op) =>
  op.baseRevision === null || op.baseRevision === undefined
    ? {}
    : { headers: { 'If-Match': String(op.baseRevision) } };

const unwrap = (result, key) => {
  if (result && typeof result === 'object' && key in result) return result[key];
  return result;
};
const requireConfirmedRecord = (record, entity) => {
  if (!record || typeof record !== 'object' || record.id === undefined || record.id === null) {
    throw Object.assign(
      new Error(`The server did not confirm a durable ${entity} record.`),
      { code: 'malformed' },
    );
  }
  return record;
};
const serverPayload = (payload = {}) => {
  const { _offlineBarangay, ...record } = payload;
  return record;
};

/** @typedef {((op: any) => Promise<{serverId: string|number, serverRecord: Record<string, any>}>) & {mutationType?: string}} SyncHandler */

/** @type {Record<string, Record<string, SyncHandler>>} */
export const SYNC_HANDLERS = {
  household: {
    async create(op) {
      const result = await api.post(
        '/households',
        { household: op.payload },
        { ...idempotencyHeaders(op), offlineMutationType: MUTATION_TIER.SAFE_SYNC },
      );
      const household = requireConfirmedRecord(unwrap(result, 'household'), 'household');
      return { serverId: household.id, serverRecord: household };
    },
    async update(op) {
      const id = op.targetServerId || op.serverId;
      const headers = { ...idempotencyHeaders(op).headers, ...revisionHeaders(op).headers };
      const result = await api.put(`/households/${id}`, { household: op.payload }, {
        headers,
        offlineMutationType: MUTATION_TIER.SAFE_SYNC,
      });
      const household = requireConfirmedRecord(unwrap(result, 'household'), 'household');
      return { serverId: household.id ?? id, serverRecord: household };
    },
  },
  householdMemberHealth: {
    async update(op) {
      const { householdId, memberId, health } = op.payload;
      const result = await api.put(
        `/households/${householdId}/members/${memberId}/health`,
        { health },
        {
          ...idempotencyHeaders(op),
          offlineMutationType: MUTATION_TIER.SAFE_SYNC,
        },
      );
      const profile = requireConfirmedRecord(unwrap(result, 'profile'), 'household member health profile');
      return { serverId: memberId, serverRecord: profile };
    },
  },
  followup: {
    async create(op) {
      const result = await api.post('/operational/followups',       { record: serverPayload(op.payload) }, {
        ...idempotencyHeaders(op),
        offlineMutationType: MUTATION_TIER.SAFE_SYNC,
      });
      const record = requireConfirmedRecord(unwrap(result, 'record'), 'follow-up');
      return { serverId: record.id, serverRecord: record };
    },
    async update(op) {
      const id = op.targetServerId || op.serverId;
      const result = await api.put(`/operational/followups/${id}`, { record: serverPayload(op.payload) }, {
        ...idempotencyHeaders(op),
        offlineMutationType: MUTATION_TIER.SAFE_SYNC,
      });
      const record = requireConfirmedRecord(unwrap(result, 'record'), 'follow-up');
      return { serverId: record.id ?? id, serverRecord: record };
    },
  },
  resident: {
    async create(op) {
      const result = await api.post(
        '/residents',
        { resident: op.payload },
        { ...idempotencyHeaders(op), offlineMutationType: MUTATION_TIER.SAFE_SYNC },
      );
      const resident = requireConfirmedRecord(unwrap(result, 'resident'), 'resident');
      return { serverId: resident.id, serverRecord: resident };
    },
    async update(op) {
      const id = op.targetServerId || op.serverId;
      const headers = {
        ...idempotencyHeaders(op).headers,
        ...revisionHeaders(op).headers,
      };
      const result = await api.put(`/residents/${id}`, { resident: op.payload }, {
        headers,
        offlineMutationType: MUTATION_TIER.SAFE_SYNC,
      });
      const resident = requireConfirmedRecord(unwrap(result, 'resident'), 'resident');
      return { serverId: resident.id ?? id, serverRecord: resident };
    },
  },
};

for (const entityHandlers of Object.values(SYNC_HANDLERS)) {
  for (const handler of Object.values(entityHandlers)) {
    handler.mutationType = MUTATION_TIER.SAFE_SYNC;
  }
}

export const getSyncHandler = (entity, opType) => {
  const entityHandlers = SYNC_HANDLERS[entity];
  if (!entityHandlers) return null;
  return entityHandlers[opType] || null;
};

export default { SYNC_HANDLERS, getSyncHandler };
