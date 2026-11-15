import { api } from './apiClient.js';

/**
 * M1 Program-Specific Record Retrieval API
 *
 * Each program has its own endpoint that returns:
 * {
 *   program: programId,
 *   section: fhsis section code,
 *   period: { type, year, month?, quarter? },
 *   records: [...],
 *   indicators: { code: indicatorData, ... },
 *   count: { records, indicators }
 * }
 */

const programResource = (programId) => ({
  list: (params) => api.get(`/m1/programs/${programId}/records`, { params }),
});

export const m1PrenatalApi = programResource('prenatal');
export const m1NcdApi = programResource('ncd');
export const m1CervicalApi = programResource('cervical');
export const m1VisualApi = programResource('visual');
export const m1OralApi = programResource('oral');
export const m1EnvironmentalApi = programResource('environmental');
export const m1EnrollmentApi = programResource('enrollment');

export const m1ProgramsApi = {
  prenatal: m1PrenatalApi,
  ncd: m1NcdApi,
  cervical: m1CervicalApi,
  visual: m1VisualApi,
  oral: m1OralApi,
  environmental: m1EnvironmentalApi,
  enrollment: m1EnrollmentApi,
};

export const loadM1ProgramCounts = async (params, clients = m1ProgramsApi) => {
  const pairs = await Promise.all(Object.entries(clients).map(async ([programId, client]) => {
    const response = await client.list(params);
    const count = response?.count?.records;
    if (!Number.isSafeInteger(count) || count < 0) {
      throw new Error(`Invalid ${programId} program count response.`);
    }
    return [programId, count];
  }));
  return Object.fromEntries(pairs);
};

export default m1ProgramsApi;
