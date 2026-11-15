/**
 * M1 Household Environmental Masterlist Program Detail Page
 *
 * Displays program-specific indicators for water supply, sanitation, and environmental health
 * according to FHSIS Section G.
 */

import { createM1ProgramDetailPage } from './M1ProgramDetailTemplate';
import { m1EnvironmentalApi } from '@/services/api';

const M1EnvironmentalDetail = createM1ProgramDetailPage('environmental', {
  listRecords: (params) => m1EnvironmentalApi.list(params),
});

export default M1EnvironmentalDetail;
