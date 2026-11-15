/**
 * M1 Prenatal and Postpartum Program Detail Page
 *
 * Displays program-specific indicators for maternal pregnancy registration
 * and postpartum follow-up according to FHSIS Section B.
 */

import { createM1ProgramDetailPage } from './M1ProgramDetailTemplate';
import { m1PrenatalApi } from '@/services/api';

// Create and export the component directly for React.lazy()
export default createM1ProgramDetailPage('prenatal', {
  listRecords: (params) => m1PrenatalApi.list(params),
});
