import { api } from './apiClient';
import { cacheRecord, listCachedRecords } from '@/services/offline/records';
import { classifySyncError, SYNC_ERROR } from '@/services/offline/errors';

/**
 * Intake API — the identity-lookup surface the intake form and household
 * member pickers use. Searchable by BHW / RHU personnel / Health Supervisor;
 * results are identity-only and barangay-scoped by the backend.
 */
export const intakeApi = {
  searchResidents: async (q) => {
    const payload = await api.get('/intake/residents/search', { params: { q } });
    return payload?.residents || [];
  },
  searchResidentsOffline: async (q, ownerId) => {
    if (!ownerId) throw new Error('A signed-in user is required.');
    try {
      const rows = await intakeApi.searchResidents(q);
      await Promise.all(rows.filter((row) => row?.id).map((row) =>
        cacheRecord({
          entity: 'rhuResidentIdentity',
          remoteId: row.id,
          ownerId,
          data: row,
        }),
      ));
      return rows;
    } catch (error) {
      if (classifySyncError(error).code !== SYNC_ERROR.NETWORK) throw error;
    }
    const query = String(q || '').trim().toLowerCase();
    return (await listCachedRecords(ownerId, 'rhuResidentIdentity'))
      .map((row) => row.data)
      .filter((row) => {
        const name = [row.firstName, row.middleName, row.lastName, row.name]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        return !query || name.includes(query);
      });
  },
};

export default intakeApi;
