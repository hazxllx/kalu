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

export const SYNC_HANDLERS = {
  household: {
    async create(op) {
      const result = await api.post(
        '/households',
        { household: op.payload },
        { ...idempotencyHeaders(op), offlineMutationType: MUTATION_TIER.SAFE_SYNC },
      );
      const household = unwrap(result, 'household');
      return { serverId: household?.id ?? null, serverRecord: household ?? null };
    },
    async update(op) {
      const id = op.targetServerId || op.serverId;
      const headers = { ...idempotencyHeaders(op).headers, ...revisionHeaders(op).headers };
      const result = await api.put(`/households/${id}`, { household: op.payload }, {
        headers,
        offlineMutationType: MUTATION_TIER.SAFE_SYNC,
      });
      const household = unwrap(result, 'household');
      return { serverId: household?.id ?? id, serverRecord: household ?? null };
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
      const profile = unwrap(result, 'profile');
      return { serverId: memberId, serverRecord: profile ?? null };
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
