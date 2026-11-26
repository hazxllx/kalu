// frontend/src/features/health-records/pages/M1NcdDetail.jsx
/**
 * M1 NCD Risk Assessment Program Detail Page
 *
 * Displays program-specific indicators for non-communicable disease screening
 * and risk evaluation from configured disease-program Section E and risk-assessment Section F indicators.
 */

import { createM1ProgramDetailPage } from './M1ProgramDetailTemplate';
import { m1NcdApi } from '@/services/api';

// Create and export the component directly for React.lazy()
export default createM1ProgramDetailPage('ncd', {
  listRecords: (params) => m1NcdApi.list(params),
});
