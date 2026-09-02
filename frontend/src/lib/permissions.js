/**
 * KALUSAGAP — Role & Permission registry (frontend source of truth).
 *
 * This file is a DATA-DRIVEN access-control catalogue. The administrator's
 * "Role & Permissions" screen renders itself entirely from the structures
 * below, so a new module, a new permission or a new action column only has to
 * be declared here — no screen, table or dialog has to be edited.
 *
 * Layout of this module
 *   ACTION / ACTION_ORDER  the canonical verbs rendered as matrix columns.
 *   PERMISSION_MODULES     the modules, each owning its list of permissions.
 *   MANAGED_ROLES          the roles an administrator is allowed to configure.
 *   DEFAULT_GRANTS         least-privilege defaults per role (never "all on").
 *   ROLE_POLICY            hard guard-rails the administrator cannot cross:
 *                            • essential Admin access can never be removed
 *                            • Resident accounts stay self-service only
 *
 * Nothing here changes the existing KALUSAGAP workflow. Route-level RBAC still
 * lives in `@/lib/roles` (`ROUTE_ROLES` + `<ProtectedRoute>`); this registry is
 * the finer-grained *action* layer layered on top of it.
 */
import { ROLE } from '@/lib/roles';

/* ------------------------------------------------------------------------- */
/* Actions — the matrix columns                                              */
/* ------------------------------------------------------------------------- */

export const ACTION = Object.freeze({
  VIEW: 'view',
  CREATE: 'create',
  EDIT: 'edit',
  APPROVE: 'approve',
  DELETE: 'delete',
});

/** Column order of the role/module matrix. Append here to add a column. */
export const ACTION_ORDER = Object.freeze([
  ACTION.VIEW,
  ACTION.CREATE,
  ACTION.EDIT,
  ACTION.APPROVE,
  ACTION.DELETE,
]);

export const ACTION_LABEL = Object.freeze({
  [ACTION.VIEW]: 'View',
  [ACTION.CREATE]: 'Create',
  [ACTION.EDIT]: 'Edit',
  [ACTION.APPROVE]: 'Approve',
  [ACTION.DELETE]: 'Delete',
});

/* ------------------------------------------------------------------------- */
/* Permission catalogue                                                      */
/* ------------------------------------------------------------------------- */

/**
 * Permission shape
 *   id          stable identifier, persisted — never rename an existing one
 *   label       exactly what the administrator reads in the list
 *   action      which matrix column this permission rolls up into
 *   description one line of plain-language help
 *   sensitive   true → toggling it asks for confirmation first
 *   impact      verb phrase used to build the confirmation sentence, e.g.
 *               "This will allow Health Supervisors to <impact>."
 */
export const PERMISSION_MODULES = Object.freeze([
  {
    id: 'residents',
    label: 'Resident Management',
    short: 'Residents',
    icon: 'Users',
    description: 'Resident directory, profiles, registration review and transfer of residency.',
    permissions: [
      {
        id: 'residents.directory.view',
        label: 'View resident directory',
        action: ACTION.VIEW,
        description: 'Browse and search the barangay resident directory.',
      },
      {
        id: 'residents.profile.view',
        label: 'View resident profile',
        action: ACTION.VIEW,
        description: 'Open an individual resident profile and health summary.',
      },
      {
        id: 'residents.create',
        label: 'Add resident',
        action: ACTION.CREATE,
        description: 'Encode a new resident record while gathering community data.',
      },
      {
        id: 'residents.edit',
        label: 'Edit resident information',
        action: ACTION.EDIT,
        description: 'Correct demographic, contact and household information.',
      },
      {
        id: 'residents.registration.approve',
        label: 'Approve resident registration',
        action: ACTION.APPROVE,
        description: 'Review submitted identity documents and admit a new resident account.',
        sensitive: true,
        impact: 'approve or reject new resident registrations',
      },
      {
        id: 'residents.transfer.approve',
        label: 'Approve transfer of residency',
        action: ACTION.APPROVE,
        description: 'Accept a resident transferring in from another barangay or municipality.',
        sensitive: true,
        impact: 'approve transfer of residency requests',
      },
      {
        id: 'residents.archive',
        label: 'Archive/deactivate resident record',
        action: ACTION.DELETE,
        description: 'Retire a resident record while keeping its history intact.',
        sensitive: true,
        impact: 'archive or deactivate resident records',
      },
    ],
  },
  {
    id: 'consultation',
    label: 'Consultation',
    short: 'Consultation',
    icon: 'Stethoscope',
    description: 'Consultation requests, encounters and the official consultation record.',
    permissions: [
      {
        id: 'consultation.requests.view',
        label: 'View consultation requests',
        action: ACTION.VIEW,
        description: 'See the queue of consultation requests submitted by residents.',
      },
      {
        id: 'consultation.requests.approve',
        label: 'Approve consultation requests',
        action: ACTION.APPROVE,
        description: 'Accept or decline a resident’s request for a consultation.',
        sensitive: true,
        impact: 'approve or decline consultation requests',
      },
      {
        id: 'consultation.conduct',
        label: 'Conduct consultation',
        action: ACTION.CREATE,
        description: 'Open and carry out a consultation encounter.',
      },
      {
        id: 'consultation.findings.record',
        label: 'Record consultation findings',
        action: ACTION.CREATE,
        description: 'Enter assessment, diagnosis and treatment notes for an encounter.',
      },
      {
        id: 'consultation.records.update',
        label: 'Update consultation records',
        action: ACTION.EDIT,
        description: 'Amend a consultation record after it has been filed.',
        sensitive: true,
        impact: 'edit official consultation records',
      },
      {
        id: 'consultation.history.view',
        label: 'View consultation history',
        action: ACTION.VIEW,
        description: 'Review past consultations and their recorded findings.',
      },
    ],
  },
  {
    id: 'triage',
    label: 'Triage',
    short: 'Triage',
    icon: 'Siren',
    description: 'Triage intake, priority assessment and routing to a Health Supervisor.',
    permissions: [
      {
        id: 'triage.view',
        label: 'View triage records',
        action: ACTION.VIEW,
        description: 'See the triage queue and completed triage records.',
      },
      {
        id: 'triage.perform',
        label: 'Perform triage',
        action: ACTION.CREATE,
        description: 'Take vitals and assign a priority level to a walk-in patient.',
      },
      {
        id: 'triage.assessment.update',
        label: 'Update triage assessment',
        action: ACTION.EDIT,
        description: 'Revise a recorded triage assessment or priority level.',
        sensitive: true,
        impact: 'change recorded triage assessments',
      },
      {
        id: 'triage.forward',
        label: 'Forward patient to Health Supervisor',
        action: ACTION.APPROVE,
        description: 'Route a triaged patient onward for consultation.',
      },
    ],
  },
  {
    id: 'referrals',
    label: 'Referrals',
    short: 'Referrals',
    icon: 'Send',
    description: 'Referral requests, approval, assignment and status tracking.',
    permissions: [
      {
        id: 'referrals.view',
        label: 'View referrals',
        action: ACTION.VIEW,
        description: 'See incoming and outgoing referrals.',
      },
      {
        id: 'referrals.create',
        label: 'Create referral',
        action: ACTION.CREATE,
        description: 'Refer a patient to a higher level of care.',
      },
      {
        id: 'referrals.approve',
        label: 'Approve referral',
        action: ACTION.APPROVE,
        description: 'Accept a referral request and release it to the receiving facility.',
        sensitive: true,
        impact: 'approve or reject referral requests',
      },
      {
        id: 'referrals.reject',
        label: 'Reject referral',
        action: ACTION.APPROVE,
        description: 'Decline a referral request and return it with a reason.',
        sensitive: true,
        impact: 'reject referral requests',
      },
      {
        id: 'referrals.assign',
        label: 'Assign referral',
        action: ACTION.EDIT,
        description: 'Assign a referral to a facility or a specific health worker.',
      },
      {
        id: 'referrals.status.update',
        label: 'Update referral status',
        action: ACTION.EDIT,
        description: 'Move a referral through received, in-progress and completed.',
      },
      {
        id: 'referrals.history.view',
        label: 'View referral history',
        action: ACTION.VIEW,
        description: 'Review the full referral trail for a patient.',
      },
    ],
  },
  {
    id: 'followups',
    label: 'Follow-up Management',
    short: 'Follow-up',
    icon: 'CalendarClock',
    description: 'Follow-up scheduling, completion and resident reminders.',
    permissions: [
      {
        id: 'followups.view',
        label: 'View follow-up schedules',
        action: ACTION.VIEW,
        description: 'See upcoming and overdue follow-up visits.',
      },
      {
        id: 'followups.create',
        label: 'Create follow-up schedule',
        action: ACTION.CREATE,
        description: 'Schedule a follow-up visit for a resident.',
        sensitive: true,
        impact: 'create follow-up schedules for residents',
      },
      {
        id: 'followups.edit',
        label: 'Edit follow-up schedule',
        action: ACTION.EDIT,
        description: 'Reschedule or amend an existing follow-up.',
        sensitive: true,
        impact: 'change existing follow-up schedules',
      },
      {
        id: 'followups.complete',
        label: 'Mark follow-up as completed',
        action: ACTION.EDIT,
        description: 'Close out a follow-up once the visit has taken place.',
      },
      {
        id: 'followups.history.view',
        label: 'View follow-up history',
        action: ACTION.VIEW,
        description: 'Review completed and missed follow-ups.',
      },
      {
        id: 'followups.notify',
        label: 'Send follow-up notification',
        action: ACTION.CREATE,
        description: 'Send a reminder to a resident about an upcoming follow-up.',
        sensitive: true,
        impact: 'send follow-up notifications to residents',
      },
    ],
  },
  {
    id: 'reports',
    label: 'Reports',
    short: 'Reports',
    icon: 'BarChart3',
    description: 'Official reports, data exports and community health analytics.',
    permissions: [
      {
        id: 'reports.view',
        label: 'View reports',
        action: ACTION.VIEW,
        description: 'Open reports that have already been produced.',
      },
      {
        id: 'reports.generate',
        label: 'Generate reports',
        action: ACTION.CREATE,
        description: 'Compile a new official report for a period or barangay.',
        sensitive: true,
        impact: 'generate official health reports',
      },
      {
        id: 'reports.export',
        label: 'Export reports',
        action: ACTION.CREATE,
        description: 'Download report data as PDF or spreadsheet.',
        sensitive: true,
        impact: 'export report data out of the system',
      },
      {
        id: 'reports.analytics.view',
        label: 'View analytics',
        action: ACTION.VIEW,
        description: 'Open community health trends, maps and early-warning analytics.',
      },
    ],
  },
  {
    id: 'accounts',
    label: 'User / Account Management',
    short: 'Accounts',
    icon: 'UserCog',
    description: 'System accounts, health personnel approval and access recovery.',
    permissions: [
      {
        id: 'accounts.view',
        label: 'View user accounts',
        action: ACTION.VIEW,
        description: 'See the list of system accounts and their status.',
      },
      {
        id: 'accounts.create',
        label: 'Create user accounts',
        action: ACTION.CREATE,
        description: 'Issue a new account to health personnel or staff.',
        sensitive: true,
        impact: 'create new system user accounts',
      },
      {
        id: 'accounts.personnel.approve',
        label: 'Approve health personnel accounts',
        action: ACTION.APPROVE,
        description: 'Admit a pending health personnel account request.',
        sensitive: true,
        impact: 'approve health personnel account requests',
      },
      {
        id: 'accounts.edit',
        label: 'Edit user accounts',
        action: ACTION.EDIT,
        description: 'Change another user’s details, assignment or role.',
        sensitive: true,
        impact: 'edit other user accounts',
      },
      {
        id: 'accounts.deactivate',
        label: 'Deactivate user accounts',
        action: ACTION.DELETE,
        description: 'Suspend an account so it can no longer sign in.',
        sensitive: true,
        impact: 'deactivate system user accounts',
      },
      {
        id: 'accounts.access.reset',
        label: 'Reset user access',
        action: ACTION.EDIT,
        description: 'Trigger a password reset and revoke active sessions.',
        sensitive: true,
        impact: 'reset passwords and revoke active sessions',
      },
      {
        id: 'accounts.roles.manage',
        label: 'Manage roles and permissions',
        action: ACTION.APPROVE,
        description: 'Open this page and change what every role is allowed to do.',
        sensitive: true,
        impact: 'change what every other role is allowed to do',
      },
    ],
  },
  {
    id: 'system',
    label: 'System Management',
    short: 'System',
    icon: 'Server',
    description: 'Activity and audit logs, system settings and notification settings.',
    permissions: [
      {
        id: 'system.activity.view',
        label: 'View system activity logs',
        action: ACTION.VIEW,
        description: 'Inspect sign-ins, requests and background activity.',
      },
      {
        id: 'system.audit.view',
        label: 'View audit logs',
        action: ACTION.VIEW,
        description: 'Read the tamper-evident record of who changed what, and when.',
      },
      {
        id: 'system.settings.manage',
        label: 'Manage system settings',
        action: ACTION.EDIT,
        description: 'Change system-wide configuration.',
        sensitive: true,
        impact: 'change system-wide settings',
      },
      {
        id: 'system.notifications.manage',
        label: 'Manage notification settings',
        action: ACTION.EDIT,
        description: 'Configure which notifications are sent and through which channel.',
        sensitive: true,
        impact: 'change how system notifications are sent',
      },
    ],
  },
]);

/* ------------------------------------------------------------------------- */
/* Derived lookups                                                           */
/* ------------------------------------------------------------------------- */

export const ALL_PERMISSIONS = Object.freeze(
  PERMISSION_MODULES.flatMap((mod) =>
    mod.permissions.map((perm) => Object.freeze({ ...perm, moduleId: mod.id, moduleLabel: mod.label })),
  ),
);

export const ALL_PERMISSION_IDS = Object.freeze(ALL_PERMISSIONS.map((perm) => perm.id));

const PERMISSION_INDEX = new Map(ALL_PERMISSIONS.map((perm) => [perm.id, perm]));
const MODULE_INDEX = new Map(PERMISSION_MODULES.map((mod) => [mod.id, mod]));

export const getPermission = (permissionId) => PERMISSION_INDEX.get(permissionId) || null;
export const getModule = (moduleId) => MODULE_INDEX.get(moduleId) || null;

export const SENSITIVE_PERMISSION_IDS = Object.freeze(
  ALL_PERMISSIONS.filter((perm) => perm.sensitive).map((perm) => perm.id),
);

/** Permissions of a module that belong to one matrix column. */
export const permissionsForAction = (moduleId, action) => {
  const mod = getModule(moduleId);
  if (!mod) return [];
  return mod.permissions.filter((perm) => perm.action === action);
};

/* ------------------------------------------------------------------------- */
/* Roles the administrator may configure                                     */
/* ------------------------------------------------------------------------- */

/**
 * `plural` is used to build confirmation copy, e.g.
 *   "This will allow Health Supervisors to approve or reject referral requests."
 *
 * `resident-limited` is deliberately absent: it is a verification sub-state of
 * a resident account, not a separate privilege level. Its access is governed by
 * verification status, exactly as it is today.
 */
export const MANAGED_ROLES = Object.freeze([
  {
    id: ROLE.ADMIN,
    label: 'Administrator',
    plural: 'Administrators',
    icon: 'ShieldCheck',
    description: 'Full system management: accounts, roles, permissions, settings and audit.',
  },
  {
    id: ROLE.MHO,
    label: 'Municipal Health Office',
    plural: 'Municipal Health Officers',
    icon: 'Building2',
    description: 'Municipal oversight: monitoring, analytics, reports and referral approval.',
  },
  {
    id: ROLE.HEALTH_SUPERVISOR,
    label: 'Health Supervisor',
    plural: 'Health Supervisors',
    icon: 'Stethoscope',
    description: 'Barangay midwife/nurse: triage, consultation, referrals and follow-ups.',
  },
  {
    id: ROLE.PHN,
    label: 'Public Health Nurse',
    plural: 'Public Health Nurses',
    icon: 'HeartPulse',
    description: 'Health records, assessments, referrals and follow-up management.',
  },
  {
    id: ROLE.RHU_PERSONNEL,
    label: 'RHU Personnel',
    plural: 'RHU Personnel',
    icon: 'Siren',
    description: 'Triage intake and case routing at the rural health unit.',
  },
  {
    id: ROLE.BHW,
    label: 'Barangay Health Worker',
    plural: 'Barangay Health Workers',
    icon: 'Home',
    description: 'Community data gathering and basic household health activities.',
  },
  {
    id: ROLE.RESIDENT,
    label: 'Resident',
    plural: 'Residents',
    icon: 'User',
    description: 'Self-service access to their own health information only.',
  },
]);

export const MANAGED_ROLE_IDS = Object.freeze(MANAGED_ROLES.map((role) => role.id));

const ROLE_INDEX = new Map(MANAGED_ROLES.map((role) => [role.id, role]));

export const getManagedRole = (roleId) => ROLE_INDEX.get(roleId) || null;
export const roleLabel = (roleId) => getManagedRole(roleId)?.label || roleId || 'Unknown role';
export const rolePlural = (roleId) => getManagedRole(roleId)?.plural || roleLabel(roleId);

/* ------------------------------------------------------------------------- */
/* Guard-rails                                                               */
/* ------------------------------------------------------------------------- */

/**
 * Administrator access that can never be switched off. Without these the
 * administrator would lock themselves — and everybody else — out of access
 * management.
 */
export const ADMIN_ESSENTIAL_PERMISSIONS = Object.freeze([
  'accounts.view',
  'accounts.roles.manage',
  'system.audit.view',
  'system.settings.manage',
]);

/** The only permissions a Resident account may ever hold. */
const RESIDENT_SELF_SERVICE = Object.freeze([
  'residents.profile.view',
  'consultation.requests.view',
  'consultation.history.view',
  'referrals.view',
  'referrals.history.view',
  'followups.view',
  'followups.history.view',
]);

/**
 * Per-role hard limits.
 *   lockedOn   always granted, the toggle is disabled
 *   grantable  when present, ONLY these ids may ever be granted to the role
 */
export const ROLE_POLICY = Object.freeze({
  [ROLE.ADMIN]: {
    lockedOn: ADMIN_ESSENTIAL_PERMISSIONS,
    lockedOnReason:
      'Essential administrator access. Removing it would leave no one able to manage accounts, roles or system settings.',
  },
  [ROLE.RESIDENT]: {
    grantable: RESIDENT_SELF_SERVICE,
    deniedReason:
      'Resident accounts are limited to their own health information. Administrative and clinical actions can never be granted to this role.',
  },
});

export const isPermissionLockedOn = (roleId, permissionId) =>
  Boolean(ROLE_POLICY[roleId]?.lockedOn?.includes(permissionId));

export const isPermissionGrantable = (roleId, permissionId) => {
  const policy = ROLE_POLICY[roleId];
  if (!policy) return true;
  if (policy.grantable && !policy.grantable.includes(permissionId)) return false;
  if (policy.denied?.includes(permissionId)) return false;
  return true;
};

/** A permission is locked when its value is fixed by policy, either way. */
export const isPermissionLocked = (roleId, permissionId) =>
  isPermissionLockedOn(roleId, permissionId) || !isPermissionGrantable(roleId, permissionId);

export const permissionLockReason = (roleId, permissionId) => {
  const policy = ROLE_POLICY[roleId];
  if (!policy) return '';
  if (isPermissionLockedOn(roleId, permissionId)) return policy.lockedOnReason || '';
  if (!isPermissionGrantable(roleId, permissionId)) return policy.deniedReason || '';
  return '';
};

/** Applies the guard-rails to a raw on/off value. */
export const normalizePermissionValue = (roleId, permissionId, value) => {
  if (isPermissionLockedOn(roleId, permissionId)) return true;
  if (!isPermissionGrantable(roleId, permissionId)) return false;
  return Boolean(value);
};

/* ------------------------------------------------------------------------- */
/* Defaults                                                                  */
/* ------------------------------------------------------------------------- */

/**
 * Least-privilege defaults. `'*'` means "every permission" and is used only for
 * the Administrator, which holds full system management privileges by default.
 * Every other role starts with the narrow set its mandate requires; anything
 * else has to be switched on deliberately by an administrator.
 */
const DEFAULT_GRANTS = Object.freeze({
  [ROLE.ADMIN]: '*',

  // Higher-level monitoring, reports, analytics and referral oversight.
  [ROLE.MHO]: [
    'residents.directory.view',
    'residents.profile.view',
    'consultation.history.view',
    'triage.view',
    'referrals.view',
    'referrals.approve',
    'referrals.reject',
    'referrals.assign',
    'referrals.history.view',
    'followups.view',
    'followups.history.view',
    'reports.view',
    'reports.generate',
    'reports.export',
    'reports.analytics.view',
  ],

  // Barangay midwife/nurse: triage, consultation, referrals, follow-ups.
  [ROLE.HEALTH_SUPERVISOR]: [
    'residents.directory.view',
    'residents.profile.view',
    'residents.create',
    'residents.edit',
    'residents.registration.approve',
    'residents.transfer.approve',
    'consultation.requests.view',
    'consultation.conduct',
    'consultation.findings.record',
    'consultation.records.update',
    'consultation.history.view',
    'triage.view',
    'triage.perform',
    'triage.assessment.update',
    'triage.forward',
    'referrals.view',
    'referrals.create',
    'referrals.approve',
    'referrals.reject',
    'referrals.assign',
    'referrals.status.update',
    'referrals.history.view',
    'followups.view',
    'followups.create',
    'followups.edit',
    'followups.complete',
    'followups.history.view',
    'followups.notify',
    'reports.view',
    'reports.analytics.view',
  ],

  // Health records, assessments, referrals, follow-ups (mirrors the API's
  // FEATURE_ROLES map for `phn`).
  [ROLE.PHN]: [
    'residents.directory.view',
    'residents.profile.view',
    'residents.edit',
    'residents.registration.approve',
    'consultation.requests.view',
    'consultation.conduct',
    'consultation.findings.record',
    'consultation.records.update',
    'consultation.history.view',
    'triage.view',
    'referrals.view',
    'referrals.create',
    'referrals.status.update',
    'referrals.history.view',
    'followups.view',
    'followups.create',
    'followups.edit',
    'followups.complete',
    'followups.history.view',
    'followups.notify',
    'reports.view',
  ],

  // Triage and case routing.
  [ROLE.RHU_PERSONNEL]: [
    'residents.directory.view',
    'residents.profile.view',
    'consultation.requests.view',
    'consultation.history.view',
    'triage.view',
    'triage.perform',
    'triage.assessment.update',
    'triage.forward',
    'referrals.view',
    'referrals.create',
    'referrals.history.view',
    'followups.view',
    'followups.history.view',
    'reports.view',
  ],

  // DATA GATHERING ONLY. No consultation, no referral approval, no resident
  // directory management, no reports and no follow-up management unless an
  // administrator explicitly switches those on.
  [ROLE.BHW]: ['residents.create', 'residents.edit'],

  // Own information only.
  [ROLE.RESIDENT]: [...RESIDENT_SELF_SERVICE],
});

/** Full default permission map for one role. */
export const defaultPermissionsForRole = (roleId) => {
  const grants = DEFAULT_GRANTS[roleId];
  const grantAll = grants === '*';
  const granted = new Set(grantAll ? [] : grants || []);

  return ALL_PERMISSIONS.reduce((acc, perm) => {
    acc[perm.id] = normalizePermissionValue(roleId, perm.id, grantAll || granted.has(perm.id));
    return acc;
  }, {});
};

/** Full default matrix for every managed role. */
export const defaultPermissionMatrix = () =>
  MANAGED_ROLE_IDS.reduce((acc, roleId) => {
    acc[roleId] = defaultPermissionsForRole(roleId);
    return acc;
  }, {});

/* ------------------------------------------------------------------------- */
/* Small computations shared by the UI                                       */
/* ------------------------------------------------------------------------- */

export const countGranted = (permissionMap = {}) =>
  ALL_PERMISSION_IDS.reduce((total, id) => (permissionMap[id] ? total + 1 : total), 0);

export const countGrantedInModule = (moduleId, permissionMap = {}) => {
  const mod = getModule(moduleId);
  if (!mod) return { on: 0, total: 0 };
  const total = mod.permissions.length;
  const on = mod.permissions.reduce((sum, perm) => (permissionMap[perm.id] ? sum + 1 : sum), 0);
  return { on, total };
};

/**
 * State of one matrix cell.
 *   'na'      the module has no permission for that action
 *   'off'     none granted
 *   'partial' some granted
 *   'on'      all granted
 */
export const moduleActionState = (moduleId, action, permissionMap = {}) => {
  const perms = permissionsForAction(moduleId, action);
  if (perms.length === 0) return { state: 'na', on: 0, total: 0, permissions: perms };
  const on = perms.reduce((sum, perm) => (permissionMap[perm.id] ? sum + 1 : sum), 0);
  const state = on === 0 ? 'off' : on === perms.length ? 'on' : 'partial';
  return { state, on, total: perms.length, permissions: perms };
};

/** Ids that differ between two permission maps. */
export const diffPermissionMaps = (previous = {}, next = {}) =>
  ALL_PERMISSION_IDS.filter((id) => Boolean(previous[id]) !== Boolean(next[id]));

export default {
  ACTION,
  ACTION_ORDER,
  ACTION_LABEL,
  PERMISSION_MODULES,
  ALL_PERMISSIONS,
  ALL_PERMISSION_IDS,
  MANAGED_ROLES,
  MANAGED_ROLE_IDS,
  ADMIN_ESSENTIAL_PERMISSIONS,
  ROLE_POLICY,
  defaultPermissionsForRole,
  defaultPermissionMatrix,
};
