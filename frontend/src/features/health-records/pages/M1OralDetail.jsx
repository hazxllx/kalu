/**
 * M1 Oral Health Program Detail Page
 *
 * Displays program-specific indicators for dental screening and oral health services
 * according to FHSIS Section D.
 */

import { createM1ProgramDetailPage } from './M1ProgramDetailTemplate';
import { m1OralApi } from '@/services/api';

const M1OralDetail = createM1ProgramDetailPage('oral', {
  listRecords: (params) => m1OralApi.list(params),
});

export default M1OralDetail;
