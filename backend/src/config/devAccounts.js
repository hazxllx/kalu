/**
 * DEVELOPMENT-ONLY server accounts used by the local auth fallback
 * (`POST /api/auth/dev-session`). These mirror the frontend mock accounts so
 * the same credentials log in against both the local UI and the API.
 *
 * Barangay-scoped roles carry a `barangay` assignment: a Health Supervisor is
 * assigned to exactly one barangay and every barangay-sensitive query filters
 * on it (see `config/scope.js`).
 *
 * These accounts are NEVER enabled in production and are bypassed whenever
 * Supabase is configured (see env.isDevAuthEnabled). No real resident data is
 * stored here.
 */
export const DEV_ACCOUNTS = Object.freeze([
  { email: 'admin@kalusagap.test', password: 'Admin123!', role: 'admin', name: 'System Administrator', barangay: null },
  { email: 'mho@kalusagap.test', password: 'Mho123!', role: 'mho', name: 'Municipal Health Officer', barangay: null },
  { email: 'phn@kalusagap.test', password: 'Phn123!', role: 'phn', name: 'Ana Villanueva', barangay: null },
  { email: 'supervisor@kalusagap.test', password: 'Supervisor123!', role: 'health_supervisor', name: 'Maria Dela Cruz', barangay: 'San Isidro' },
  { email: 'rhu@kalusagap.test', password: 'Rhu123!', role: 'rhu_personnel', name: 'Antonio Reyes', barangay: null },
  { email: 'bhw@kalusagap.test', password: 'Bhw123!', role: 'bhw', name: 'Maria Cruz', barangay: null },
  { email: 'resident1@kalusagap.test', password: 'Resident123!', role: 'resident', name: 'Maria Santos', barangay: null },
  { email: 'resident2@kalusagap.test', password: 'Resident123!', role: 'resident', name: 'Juan Dela Cruz', barangay: null },
  { email: 'resident3@kalusagap.test', password: 'Resident123!', role: 'resident', name: 'Grace Aquino', barangay: null },
]);

export const findDevAccount = (email) =>
  DEV_ACCOUNTS.find(
    (a) => a.email.toLowerCase() === String(email || '').trim().toLowerCase(),
  ) || null;

export default DEV_ACCOUNTS;
