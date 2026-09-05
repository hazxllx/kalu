/**
 * Barrel for the real (Express/Supabase-backed) API service layer.
 *
 *   import { api, residentsApi } from '@/services/api';
 *
 * UI components should depend on these feature modules, not on `fetch` or
 * Supabase directly. Mock datasets used during development live separately in
 * `@/services/mock/*` so they are easy to swap out per feature.
 */
export { api, default as apiClient } from './apiClient';
export { authApi } from './authApi';
export { residentsApi } from './residentsApi';
export { healthRecordsApi } from './healthRecordsApi';
export { consultationsApi } from './consultationsApi';
export { referralsApi } from './referralsApi';
export { municipalityOnboardingApi } from './municipalityOnboardingApi';
