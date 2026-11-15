/**
 * M1 Program Enrollment Register Detail Page
 *
 * Displays program enrollment records for community health program tracking
 * and management.
 */

import { createM1ProgramDetailPage } from './M1ProgramDetailTemplate';
import { m1EnrollmentApi } from '@/services/api';

const M1EnrollmentDetail = createM1ProgramDetailPage('enrollment', {
  listRecords: (params) => m1EnrollmentApi.list(params),
});

export default M1EnrollmentDetail;
