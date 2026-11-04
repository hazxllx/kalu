import { hasControlChars, isUuid, text, valid, invalid } from './common.js';

export const PERSONNEL_ACTIONS = Object.freeze(['approve', 'reject', 'suspend', 'reactivate', 'invite', 'retry_email']);
export const APPROVAL_STATUSES = Object.freeze(['pending', 'approved', 'rejected']);
export const PERSONNEL_STATES = Object.freeze(['active', 'pending', 'rejected', 'awaiting_setup', 'approved_inactive', 'suspended']);

const objectInput = (input) => input && typeof input === 'object' && !Array.isArray(input);
const fieldsValidator = (body, { create = false } = {}) => {
  const input = body?.user ?? body;
  if (!objectInput(input)) return invalid({ user: 'An account object is required.' });
  const errors = {};
  const value = { ...input };
  if (Object.hasOwn(input, 'password')) errors.password = 'Administrators cannot choose or supply an account password.';
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

export const createUserValidator = (input = {}) => fieldsValidator(input, { create: true });
export const updateUserValidator = (input = {}) => fieldsValidator(input);

export const userIdParamValidator = (params = {}) => {
  if (typeof params.id !== 'string' || !isUuid(params.id)) return invalid({ id: 'Use a valid account UUID.' });
  return valid({ ...params, id: text(params.id).toLowerCase() });
};

export const userQueryValidator = (input = {}) => {
  const value = { ...input };
  const errors = {};
  if (input.personnelOnly !== undefined) {
    if (![true, false, 'true', 'false'].includes(input.personnelOnly)) errors.personnelOnly = 'Use true or false.';
    else value.personnelOnly = input.personnelOnly === true || input.personnelOnly === 'true';
  }
  if (input.approvalStatus && !APPROVAL_STATUSES.includes(input.approvalStatus)) errors.approvalStatus = 'Unknown approval status.';
  if (input.lifecycleState && !PERSONNEL_STATES.includes(input.lifecycleState)) errors.lifecycleState = 'Unknown personnel lifecycle state.';
  for (const field of ['municipalityId', 'barangayId']) {
    if (input[field] && (typeof input[field] !== 'string' || !isUuid(input[field]))) errors[field] = 'Use a valid assignment UUID.';
  }
  return Object.keys(errors).length ? invalid(errors) : valid(value);
};

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

export const accessResetValidator = (body = {}) => {
  const input = body?.user ?? body;
  if (!objectInput(input)) return invalid({ operationId: 'Use an account action object.' });
  if (input.operationId !== undefined && (typeof input.operationId !== 'string' || !isUuid(input.operationId))) {
    return invalid({ operationId: 'Use a valid operation UUID.' });
  }
  return valid(input.operationId === undefined ? {} : { operationId: text(input.operationId).toLowerCase() });
};
