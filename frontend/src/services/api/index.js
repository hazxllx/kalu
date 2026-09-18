/**
 * Barrel for the real (Express/Supabase-backed) API service layer.
 *
 *   import { api, residentsApi } from '@/services/api';
 *
 * UI components should depend on these feature modules, not on `fetch` or
 * Supabase directly. Client-side session stores that hold a user's in-session
 * working set (before a domain endpoint persists it) live separately in
 * `@/services/local/*`; they start empty and carry no demo data.
 */
export { api, default as apiClient } from './apiClient';
export { authApi } from './authApi';
export { residentsApi } from './residentsApi';
export { registrationApi } from './registrationApi';
export { householdsApi } from './householdsApi';
export { intakeApi } from './intakeApi';
export { healthRecordsApi } from './healthRecordsApi';
export { consultationsApi } from './consultationsApi';
export { referralsApi } from './referralsApi';
