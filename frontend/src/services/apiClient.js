/**
 * Backwards-compatible re-export.
 *
 * The centralized HTTP client now lives at `@/services/api/apiClient`. This
 * file remains so existing imports of `@/services/apiClient` keep working.
 */
export { api, default } from '@/services/api/apiClient';
