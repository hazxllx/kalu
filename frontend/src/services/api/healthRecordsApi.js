import { consultationsApi } from './consultationsApi.js';

/**
 * Retained clinical-record API delegates to canonical PostgreSQL visits. It
 * shares consultation validation, permissions and idempotency, not a second
 * local or fabricated record model. Clinical history is not hard-deletable.
 */
export const healthRecordsApi = {
  list: (params, options) => consultationsApi.list(params, options),
  get: (id, options) => consultationsApi.get(id, options),
  create: (payload, options) => consultationsApi.create(payload, options),
  update: (id, payload, options) => consultationsApi.update(id, payload, options),
  remove: () => Promise.reject(Object.assign(new Error('Clinical records cannot be deleted. Corrections must preserve their history.'), { status: 405 })),
};

export default healthRecordsApi;
