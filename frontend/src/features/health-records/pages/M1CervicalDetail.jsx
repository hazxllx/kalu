/**
 * M1 Cervical Cancer and Breast Mass Program Detail Page
 *
 * Displays program-specific indicators for cervical cancer and breast cancer screening
 * according to the configured FHSIS Section F screening indicators.
 */

import { createM1ProgramDetailPage } from './M1ProgramDetailTemplate';
import { m1CervicalApi } from '@/services/api';

// Create and export the component directly for React.lazy()
export default createM1ProgramDetailPage('cervical', {
  listRecords: (params) => m1CervicalApi.list(params),
});
