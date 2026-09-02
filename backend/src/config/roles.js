/**
 * KALUSAGAP canonical application roles (single source of truth for the API).
 *
 * These are the *application* roles. They are expected to be stored on each
 * user (e.g. in a `profiles` table column or in the Supabase Auth user's
 * `app_metadata.role`) once the verified database structure is available.
 *
 * IMPORTANT: role -> feature mapping below reflects the KALUSAGAP role brief.
 * It is used by the `authorize()` middleware. It intentionally follows
 * least-privilege: a role is only listed on a feature group it is responsible
 * for.
 */
export const ROLES = Object.freeze({
  ADMIN: 'admin',
  MHO: 'mho',
  PHN: 'phn',
  HEALTH_SUPERVISOR: 'health_supervisor',
  RHU_PERSONNEL: 'rhu_personnel',
  BHW: 'bhw',
  RESIDENT: 'resident',
});

export const ALL_ROLES = Object.values(ROLES);

/**
 * Feature-group -> allowed roles. Route files reference these lists via
 * `authorize(FEATURE_ROLES.xxx)` so permissions live in one place instead of
 * being duplicated across route definitions.
 *
 * NOTE: BHW is DATA-COLLECTION ONLY. It never appears on clinical / resident
 * record / consultation / triage / referral / follow-up groups.
 */
export const FEATURE_ROLES = Object.freeze({
  // Account/access administration
  users: [ROLES.ADMIN],
  system: [ROLES.ADMIN],

  // Household / community data collection (BHW's domain)
  households: [ROLES.BHW, ROLES.HEALTH_SUPERVISOR, ROLES.PHN],
  dataCollection: [ROLES.BHW],

  // Resident directory + clinical records (NOT BHW)
  residents: [ROLES.HEALTH_SUPERVISOR, ROLES.PHN, ROLES.MHO],
  healthRecords: [ROLES.HEALTH_SUPERVISOR, ROLES.PHN],
  assessments: [ROLES.HEALTH_SUPERVISOR, ROLES.PHN],
  verification: [ROLES.HEALTH_SUPERVISOR, ROLES.PHN],
  consultations: [ROLES.HEALTH_SUPERVISOR, ROLES.PHN],
  triage: [ROLES.RHU_PERSONNEL, ROLES.HEALTH_SUPERVISOR],
  referrals: [ROLES.HEALTH_SUPERVISOR, ROLES.PHN, ROLES.MHO],
  followUps: [ROLES.HEALTH_SUPERVISOR, ROLES.PHN],

  // Resident -> RHU -> PHN submission workflow.
  //
  // `intake` lets community/RHU staff drive the intake form: search an existing
  // resident (identity only), create a new resident record when none exists,
  // record the current visit, and submit the record to the PHN queue. Once
  // submitted the clinical content is locked to the submitting role; only the
  // PHN processing group may act on it.
  //
  // NOTE: BHW stays out of the clinical resident directory (`residents`); its
  // intake rights are scoped through the dedicated intake endpoints below,
  // never through the full resident/clinical record groups.
  intake: [ROLES.BHW, ROLES.RHU_PERSONNEL, ROLES.HEALTH_SUPERVISOR],
  intakeSubmit: [ROLES.BHW, ROLES.RHU_PERSONNEL, ROLES.HEALTH_SUPERVISOR],
  phnProcessing: [ROLES.PHN],
  referralRecords: [ROLES.HEALTH_SUPERVISOR, ROLES.PHN, ROLES.MHO],

  // Monitoring / aggregate information
  reports: [ROLES.HEALTH_SUPERVISOR, ROLES.PHN, ROLES.MHO, ROLES.RHU_PERSONNEL],
  analytics: [ROLES.MHO, ROLES.HEALTH_SUPERVISOR],

  // Cross-cutting
  notifications: ALL_ROLES,
  // Resident self-service (a resident only ever sees their own data; that is
  // enforced in the service layer + Supabase RLS, not by this list).
  residentSelf: [ROLES.RESIDENT],
});

export const isValidRole = (role) => ALL_ROLES.includes(role);

export default { ROLES, ALL_ROLES, FEATURE_ROLES, isValidRole };
