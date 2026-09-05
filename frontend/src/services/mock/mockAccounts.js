import { ROLE } from '@/lib/roles';

/**
 * DEVELOPMENT / DEMO accounts (single source of truth).
 *
 * These are FAKE accounts for local development and capstone presentations —
 * no real personal information. They power two things:
 *   1. The "Demo Accounts" switcher on the login page (autofills email +
 *      password; it does NOT auto-submit).
 *   2. The local dev-auth fallback in `@/context/AuthContext`, used only when
 *      Supabase is not configured. The role is always derived from the matched
 *      account — never chosen by the user.
 *
 * When Supabase IS configured (VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY),
 * authentication goes through Supabase Auth. To use these same demo logins
 * there, create matching users in the Supabase dashboard with the role set in
 * their `app_metadata`. These are intentionally committed development
 * credentials — never reuse them for production.
 */
export const MOCK_ACCOUNTS = [
  {
    role: ROLE.ADMIN,
    label: 'Administrator',
    name: 'System Administrator',
    email: 'admin@kalusagap.test',
    password: 'Admin123!',
    municipalityId: 'mun-pili',
    description: 'System administration: accounts, roles, and access management.',
  },
  {
    role: ROLE.MHO,
    label: 'Pili Development MHO',
    name: 'Dr. Maria Santos',
    password: 'PiliMhoDev-2026!',
    email: 'mho-pili-dev@kalusagap.test',
    municipalityId: 'mun-pili',
    description: 'Municipal monitoring, reports, health statistics, and referral oversight.',
  },
  {
    role: ROLE.PHN,
    label: 'Pili Development PHN',
    name: 'Ana Reyes, RN',
    password: 'PiliPhnDev-2026!',
    email: 'phn-pili-dev@kalusagap.test',
    municipalityId: 'mun-pili',
    description: 'Health records, assessments, referrals, and follow-ups.',
  },
  {
    role: ROLE.HEALTH_SUPERVISOR,
    label: 'Health Supervisor',
    name: 'Barangay Health Supervisor',
    password: 'Supervisor123!',
    email: 'supervisor@kalusagap.test',
    barangay: 'San Isidro',
    description: 'Barangay-level health supervision for San Isidro: resident monitoring, consultation, referrals, and follow-up management.',
  },
  {
    role: ROLE.RHU_PERSONNEL,
    label: 'RHU Personnel',
    name: 'RHU Personnel',
    email: 'rhu@kalusagap.test',
    password: 'Rhu123!',
    description: 'Triage and case routing.',
  },
  {
    role: ROLE.BHW,
    label: 'Barangay Health Worker',
    name: 'Barangay Health Worker',
    password: 'Bhw123!',
    email: 'bhw@kalusagap.test',
    description: 'Data collection and household/community profiling.',
  },
  {
    role: ROLE.RESIDENT,
    label: 'Resident 1',
    name: 'Maria Santos',
    email: 'resident1@kalusagap.test',
    password: 'Resident123!',
    description: 'Resident self-service: own profile, records, services, and notifications.',
  },
  {
    role: ROLE.RESIDENT,
    label: 'Resident 2',
    name: 'Juan Dela Cruz',
    email: 'resident2@kalusagap.test',
    password: 'Resident123!',
    description: 'Resident self-service: own profile, records, services, and notifications.',
  },
  {
    role: ROLE.RESIDENT,
    label: 'Resident 3',
    name: 'Grace Aquino',
    email: 'resident3@kalusagap.test',
    password: 'Resident123!',
    description: 'Resident self-service: own profile, records, services, and notifications.',
  },
];

/** Find a dev account by email (case-insensitive). */
export const findMockAccount = (email) =>
  MOCK_ACCOUNTS.find((a) => a.email.toLowerCase() === String(email || '').trim().toLowerCase()) || null;

export default MOCK_ACCOUNTS;
