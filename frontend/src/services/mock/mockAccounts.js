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
    description: 'System administration: accounts, roles, and access management.',
  },
  {
    role: ROLE.MHO,
    label: 'Municipal Health Officer',
    name: 'Dr. Maria L. Santos',
    email: 'mho@kalusagap.test',
    password: 'Mho123!',
    description: 'Municipal Health Officer demo account — municipality-wide reporting, analytics, and oversight for Pili, Camarines Sur.',
  },
  {
    role: ROLE.PHN,
    label: 'Public Health Nurse (RHU)',
    name: 'Ana Villanueva',
    email: 'phn@kalusagap.test',
    password: 'phn123',
    // No barangay assignment — PHNs are RHU-based personnel only.
    assignedBarangay: null,
    description: 'RHU-level public health nursing: records, assessments, referrals, and follow-ups (no barangay assignment).',
  },
  {
    role: ROLE.HEALTH_SUPERVISOR,
    label: 'Barangay Health Supervisor',
    name: 'Maria Dela Cruz',
    email: 'supervisor@kalusagap.test',
    password: 'Supervisor123!',
    barangay: 'San Isidro',
    description: 'Barangay-level health supervision for San Isidro: resident monitoring, consultation, referrals, and follow-up management.',
  },
  {
    role: ROLE.RHU_PERSONNEL,
    label: 'RHU Personnel',
    name: 'Antonio Reyes',
    email: 'rhu@kalusagap.test',
    password: 'Rhu123!',
    description: 'Triage and case routing.',
  },
  {
    role: ROLE.BHW,
    label: 'Barangay Health Worker',
    name: 'Barangay Health Worker',
    email: 'bhw@kalusagap.test',
    password: 'Bhw123!',
    description: 'Data collection and household/community profiling.',
  },
  {
    role: ROLE.RESIDENT_LIMITED,
    label: 'Resident — Unverified',
    name: 'Grace Aquino',
    email: 'resident.unverified@kalusagap.test',
    password: 'Resident123!',
    description: 'Resident demo with a pending verification state — identity review is required before full resident access.',
  },
  {
    role: ROLE.RESIDENT,
    label: 'Resident — Verified',
    name: 'Maria Santos',
    email: 'resident.verified@kalusagap.test',
    password: 'Resident123!',
    description: 'Resident demo with a verified identity — full resident self-service access.',
  },
];

/** Find a dev account by email (case-insensitive). */
export const findMockAccount = (email) =>
  MOCK_ACCOUNTS.find((a) => a.email.toLowerCase() === String(email || '').trim().toLowerCase()) || null;

export default MOCK_ACCOUNTS;
