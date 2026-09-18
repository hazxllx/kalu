import { api } from './apiClient';

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
};

export default intakeApi;
