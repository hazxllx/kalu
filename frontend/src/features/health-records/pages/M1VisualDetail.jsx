// frontend/src/features/health-records/pages/M1VisualDetail.jsx
/**
 * M1 Visual Acuity and PPV Program Detail Page
 *
 * Displays program-specific indicators for vision screening and senior citizen immunization
 * according to the configured FHSIS Section F visual and PPV indicators.
 */

import { createM1ProgramDetailPage } from './M1ProgramDetailTemplate';
import { m1VisualApi } from '@/services/api';

const M1VisualDetail = createM1ProgramDetailPage('visual', {
  listRecords: (params) => m1VisualApi.list(params),
});

export default M1VisualDetail;
