import { hasControlChars, isStrictMobile, isUuid, text, valid, invalid } from './common.js';

/**
 * @file Admin User & Personnel Account Lifecycle validators (server-authoritative).
 *
 * Executed by `middleware/validate.js` in the KALUSAGAP request pipeline
 * (`route -> authenticate -> authorize -> validate -> controller -> service -> Supabase`).
 *
 * Enforces strict separation between profile attribute edits (`updateUserValidator`)
 * and audited lifecycle transitions (`personnelLifecycleValidator`), prevents
 * administrator-chosen passwords (credentials are generated/emailed by the service),
 * and requires client-supplied `operationId` UUIDs for idempotent account actions.
 */

/** Explicit lifecycle transitions supported by the personnel management endpoint. */
export const PERSONNEL_ACTIONS = Object.freeze(['approve', 'reject', 'suspend', 'reactivate', 'invite', 'retry_email']);
export const APPROVAL_STATUSES = Object.freeze(['pending', 'approved', 'rejected']);
/** Operational lifecycle states filterable in admin personnel listings. */
export const PERSONNEL_STATES = Object.freeze(['active', 'pending', 'rejected', 'awaiting_setup', 'approved_inactive', 'suspended']);

const objectInput = (input) => input && typeof input === 'object' && !Array.isArray(input);

/**
 * Shared validator for admin user creation (`create: true`) and profile edits (`create: false`).
 *
 * Security & lifecycle invariants:
 * - Unwraps `{ user }` or flat payloads and rejects administrator-supplied `password`
 *   or `temporaryPassword` fields so admins never know a staff member's credentials.
 * - Requires an `operationId` UUID on create (and validates it whenever supplied on update).
 * - Normalizes organizational assignment UUIDs (`municipalityId`, `barangayId`, `facilityId`).
 * - On create, enforces strict 11-digit PH mobile (`09XXXXXXXXX`) for operational health roles
 *   (`mho`, `phn`, `health_supervisor`, `rhu_personnel`, `bhw`).
 * - On update, blocks lifecycle state columns (`approvalStatus`, `activate`, `suspendedAt`, etc.)
 *   so state changes must flow through `personnelLifecycleValidator`.
 *
 * @param {Object} body - Raw request body.
 * @param {Object} [options] - `{ create?: boolean }` mode flag.
 * @returns {Object} Validation result `{ value }` or `{ error }`.
 */
const fieldsValidator = (body, { create = false } = {}) => {
  const input = body?.user ?? body;
  if (!objectInput(input)) return invalid({ user: 'An account object is required.' });
  const errors = {};
  const value = { ...input };
  if (Object.hasOwn(input, 'password')) errors.password = 'Administrators cannot choose or supply an account password.';
  if (!create && (Object.hasOwn(input, 'temporaryPassword') || Object.hasOwn(input, 'mustChangePassword'))) {
    errors.temporaryPassword = 'Password assignment is available only during personnel account creation.';
  }
  for (const field of ['email', 'name', 'fullName', 'contact', 'position', 'licenseNo', 'role', 'status', 'suspensionReason']) {
    if (input[field] !== undefined && typeof input[field] !== 'string') errors[field] = 'Use a text value.';
    else if (input[field] !== undefined && field !== 'suspensionReason' && hasControlChars(input[field])) errors[field] = 'Control characters are not allowed.';
  }
  for (const field of ['municipalityId', 'barangayId', 'facilityId']) {
    if (input[field] !== undefined && input[field] !== null && input[field] !== ''
        && (typeof input[field] !== 'string' || !isUuid(input[field]))) {
      errors[field] = 'Use a valid assignment UUID.';
    } else if (input[field] !== undefined) value[field] = input[field] ? text(input[field]).toLowerCase() : null;
  }
  if ((create || input.operationId !== undefined) && (typeof input.operationId !== 'string' || !isUuid(input.operationId))) {
    errors.operationId = 'A valid operation UUID is required.';
  } else if (input.operationId !== undefined) value.operationId = text(input.operationId).toLowerCase();
  if (input.rhuStations !== undefined && (!Array.isArray(input.rhuStations)
      || input.rhuStations.some((station) => typeof station !== 'string'))) {
    errors.rhuStations = 'Use an array of RHU station identifiers.';
  }
  if (create) {
    value.approvalStatus = input.approvalStatus === undefined ? 'approved' : input.approvalStatus;
    if (!['pending', 'approved'].includes(value.approvalStatus)) errors.approvalStatus = 'Choose pending or approved.';
    if (input.activate !== undefined && typeof input.activate !== 'boolean') errors.activate = 'Use true or false.';
    if (['mho', 'phn', 'health_supervisor', 'rhu_personnel', 'bhw'].includes(input.role)
        && !isStrictMobile(input.contact)) {
      errors.contact = 'Enter an 11-digit mobile number starting with 09 (e.g. 09171234567).';
    }
    if (Object.hasOwn(input, 'temporaryPassword')) errors.temporaryPassword = 'Temporary passwords are generated automatically by the account service.';
    if (Object.hasOwn(input, 'confirmTemporaryPassword')) {
      errors.confirmTemporaryPassword = 'Only the temporary password may be submitted.';
    }
  } else {
    for (const field of ['approvalStatus', 'activationRequested', 'activate', 'setupRequired', 'setupCompletedAt', 'suspendedAt', 'decisionReason']) {
      if (Object.hasOwn(input, field)) errors[field] = 'Use an explicit personnel lifecycle action for this field.';
    }
  }
  if (input.suspensionReason !== undefined && text(input.suspensionReason).length > 1000) {
    errors.suspensionReason = 'Use a reason of at most 1000 characters.';
  }
  return Object.keys(errors).length ? invalid(errors) : valid(value);
};

/**
 * Validates `POST /users` admin-provisioned account creation payloads.
 *
 * @param {Object} [input] - Raw request body (`{ user }` or flat).
 * @returns {Object} Validation result `{ value }` or `{ error }`.
 */
export const createUserValidator = (input = {}) => fieldsValidator(input, { create: true });

/**
 * Validates `PATCH`/`PUT /users/:id` admin profile update payloads (excluding lifecycle transitions).
 *
 * @param {Object} [input] - Raw request body (`{ user }` or flat).
 * @returns {Object} Validation result `{ value }` or `{ error }`.
 */
export const updateUserValidator = (input = {}) => fieldsValidator(input);

/**
 * Validates and lowercases `:id` route parameters for user management endpoints as UUIDs.
 *
 * @param {Object} [params] - Route params object.
 * @returns {Object} Validation result `{ value }` or `{ error }`.
 */
export const userIdParamValidator = (params = {}) => {
  if (typeof params.id !== 'string' || !isUuid(params.id)) return invalid({ id: 'Use a valid account UUID.' });
  return valid({ ...params, id: text(params.id).toLowerCase() });
};

/**
 * Validates `GET /users` filter query parameters (`personnelOnly`, `approvalStatus`,
 * `lifecycleState`, `municipalityId`, `barangayId`), coercing `personnelOnly` to boolean.
 *
 * @param {Object} [input] - Raw query parameters.
 * @returns {Object} Validation result `{ value }` or `{ error }`.
 */
export const userQueryValidator = (input = {}) => {
  const value = { ...input };
  const errors = {};
  if (input.personnelOnly !== undefined) {
    if (![true, false, 'true', 'false'].includes(input.personnelOnly)) errors.personnelOnly = 'Use true or false.';
    else value.personnelOnly = input.personnelOnly === true || input.personnelOnly === 'true';
  }
  if (input.approvalStatus && !APPROVAL_STATUSES.includes(input.approvalStatus)) errors.approvalStatus = 'Unknown approval status.';
  if (input.lifecycleState && !PERSONNEL_STATES.includes(input.lifecycleState)) errors.lifecycleState = 'Unknown personnel lifecycle state.';
  for (const field of ['municipalityId', 'barangayId', 'facilityId']) {
    if (input[field] && (typeof input[field] !== 'string' || !isUuid(input[field]))) errors[field] = 'Use a valid assignment UUID.';
  }
  if (input.rhuStation && !['triage', 'consultation'].includes(input.rhuStation)) errors.rhuStation = 'Choose a valid RHU station.';
  return Object.keys(errors).length ? invalid(errors) : valid(value);
};

/**
 * Validates explicit personnel lifecycle action payloads (`approve`, `reject`, `suspend`,
 * `reactivate`, `invite`, `retry_email`). Requires a non-empty `reason` for `reject` and
 * `suspend` actions and a mandatory `operationId` UUID for idempotency.
 *
 * @param {Object} [input] - Raw request body.
 * @returns {Object} Validation result `{ value }` or `{ error }`.
 */
export const personnelLifecycleValidator = (input = {}) => {
  if (!objectInput(input)) return invalid({ action: 'A lifecycle action object is required.' });
  const errors = {};
  const action = text(input.action);
  const reason = text(input.reason);
  if (typeof input.action !== 'string' || !PERSONNEL_ACTIONS.includes(action)) errors.action = 'Unknown personnel lifecycle action.';
  if (input.reason !== undefined && typeof input.reason !== 'string') errors.reason = 'Use a text reason.';
  if (['reject', 'suspend'].includes(action) && !reason) errors.reason = 'A reason is required for this action.';
  if (reason.length > 1000) errors.reason = 'Use a reason of at most 1000 characters.';
  if (input.activate !== undefined && typeof input.activate !== 'boolean') errors.activate = 'Use true or false.';
  if (typeof input.operationId !== 'string' || !isUuid(input.operationId)) errors.operationId = 'A valid operation UUID is required.';
  return Object.keys(errors).length ? invalid(errors) : valid({
    action,
    reason,
    activate: input.activate ?? true,
    operationId: text(input.operationId).toLowerCase(),
  });
};

/**
 * Validates administrator-triggered account access/password reset payloads (`{ user }` or flat),
 * optionally normalizing an idempotency `operationId` UUID.
 *
 * @param {Object} [body] - Raw request body.
 * @returns {Object} Validation result `{ value }` or `{ error }`.
 */
export const accessResetValidator = (body = {}) => {
  const input = body?.user ?? body;
  if (!objectInput(input)) return invalid({ operationId: 'Use an account action object.' });
  if (input.operationId !== undefined && (typeof input.operationId !== 'string' || !isUuid(input.operationId))) {
    return invalid({ operationId: 'Use a valid operation UUID.' });
  }
  return valid(input.operationId === undefined ? {} : { operationId: text(input.operationId).toLowerCase() });
};
