/**
 * KALUSAGAP canonical application roles (single source of truth for the API).
 *
 * These roles are stored on `profiles.role`. Supabase Auth metadata may carry
 * a copy, but backend authorization resolves the profile from the database.
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
  // Verification sub-state of a resident account. `authenticate` serves a
  // resident whose profile status is `pending_verification` under this role so
  // self-service endpoints (e.g. resubmitting a registration) can recognise
  // them, and so route access stays limited until a Health Supervisor approves.
  RESIDENT_LIMITED: 'resident-limited',
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

  // Resident risk assessment configuration (criteria + thresholds). Only the
  // System Administrator may change it; the clinical/monitoring roles may read
  // it so the Resident Detail breakdown and dashboards can label criteria.
  riskConfig: [ROLES.ADMIN],
  riskConfigRead: [ROLES.ADMIN, ROLES.MHO, ROLES.PHN, ROLES.HEALTH_SUPERVISOR],

  // Operational account verification queue. The gate is deliberately NOT the
  // admin list: PHN reviews Health Supervisor + RHU Personnel requests and the
  // Health Supervisor reviews BHW + Resident requests (see
  // config/staffApprovals.js and public.can_approve_staff_role()).
  staffAccounts: [ROLES.PHN, ROLES.HEALTH_SUPERVISOR],

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
  // RHU Consultation Station: after triage submits an encounter, the RHU
  // consultation personnel pick it up from the shared queue, view the triage
  // data, record findings/assessment/treatment/recommendations and complete the
  // consultation. The PHN keeps the SAME capability (its assessment feature is
  // unchanged). A Health Supervisor may ALSO be admitted here, but only when
  // explicitly assigned the Consultation station — the `authorizeStation`
  // middleware (and the service re-check) enforce that; the role alone does not
  // grant it. Barangay Consultation (`consultations`) is a separate feature and
  // is unaffected. Referral generation stays PHN-only (enforced per-route + in
  // the service).
  consultationProcessing: [ROLES.PHN, ROLES.RHU_PERSONNEL, ROLES.HEALTH_SUPERVISOR],
  referralRecords: [ROLES.HEALTH_SUPERVISOR, ROLES.PHN, ROLES.MHO],

  // Medical certificates are PREPARED/REVIEWED/ISSUED by PHN/MHO. A Triage-station
  // RHU Personnel may additionally INITIATE a certificate REQUEST (status
  // 'For Review'); the station is enforced by `authorizeStation(TRIAGE)` on the
  // read/create routes, and the service forces the request status + withholds the
  // signatory. RHU Personnel can never approve/issue/reject (those routes stay on
  // `certificates`).
  certificates: [ROLES.PHN, ROLES.MHO],
  certificateRequest: [ROLES.PHN, ROLES.MHO, ROLES.RHU_PERSONNEL],
  certificateReview: [ROLES.PHN, ROLES.MHO],

  // Monitoring / aggregate information
  reports: [ROLES.HEALTH_SUPERVISOR, ROLES.PHN, ROLES.MHO],

  // Health services catalog. Managed (create/assign) by PHN, MHO and the
  // barangay-scoped Health Supervisor. Read by staff who can be assigned a
  // service. RHU Personnel are intentionally NOT here: Health Programs is not an
  // RHU Personnel feature (removed from their navigation AND authorization).
  // Scope is re-enforced in the service and by RLS.
  healthServices: [ROLES.MHO, ROLES.PHN, ROLES.HEALTH_SUPERVISOR],
  healthServicesRead: [ROLES.MHO, ROLES.PHN, ROLES.HEALTH_SUPERVISOR, ROLES.BHW],
  // Community Health Monitoring / map analytics. MHO + PHN are municipality-wide
  // (they see every authorised barangay in Pili); a Health Supervisor is scoped
  // by the session to their assigned barangay only. RHU Personnel is NOT here:
  // its role does not include community monitoring.
  analytics: [ROLES.MHO, ROLES.PHN, ROLES.HEALTH_SUPERVISOR],

  // FHSIS M1 monthly report. Read: barangay + municipality monitoring roles.
  // Write (record underlying events / remarks / header): barangay-scoped staff
  // plus PHN. Scope is re-enforced in the service and by Supabase RLS.
  m1Read: [ROLES.HEALTH_SUPERVISOR, ROLES.PHN, ROLES.MHO, ROLES.RHU_PERSONNEL],
  m1Write: [ROLES.HEALTH_SUPERVISOR, ROLES.PHN, ROLES.BHW],

  // Cross-cutting
  notifications: ALL_ROLES,
  // Resident self-service (a resident only ever sees their own data; that is
  // enforced in the service layer + Supabase RLS, not by this list). A resident
  // awaiting manual verification is served as 'resident-limited' and may view
  // their own status and resubmit their own registration.
  residentSelf: [ROLES.RESIDENT, ROLES.RESIDENT_LIMITED],
});

export const isValidRole = (role) => ALL_ROLES.includes(role);

export default { ROLES, ALL_ROLES, FEATURE_ROLES, isValidRole };
