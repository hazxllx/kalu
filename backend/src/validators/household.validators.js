import {
  TEXT_LIMITS,
  inEnum,
  isFiniteNumber,
  isPhonePH,
  invalid,
  text,
  valid,
} from './common.js';

/**
 * Household profiling input validation (shared by create/update/member routes).
 *
 * Server-side rules mirror the database CHECK constraints and the service's
 * semantic checks. The risk classification is never accepted from the client —
 * `riskScore`/`riskLevel`/`riskFactors`/`flags` are dropped here as well as in
 * the service.
 */

export const HH_STATUSES = Object.freeze([
  'Pending', 'Ongoing', 'Submitted', 'Needs Update', 'Approved', 'Refused',
  'For Masterlist Update', 'Non-Eligible', 'Duplicate', 'Migrated', 'Other',
]);
export const APPROVAL_STATUSES = Object.freeze(['Not yet approved', 'Approved', 'Needs revision']);
export const WATER_SOURCES = Object.freeze(['level1', 'level2', 'level3', 'unimproved']);
export const TOILET_TYPES = Object.freeze(['ws_own', 'ws_shared', 'open_pit', 'antipolo', 'none']);
export const PHILHEALTH_VALUES = Object.freeze(['member', 'non-member']);
export const SEX_VALUES = Object.freeze(['Male', 'Female']);

const SAFE_HH_ID = /^[A-Za-z0-9_-]{1,32}$/;

/**
 * Validates the household route params in one step and returns ALL params so
 * `validate(..., 'params')` never drops `memberId`.
 */
export const householdParamsValidator = (params = {}) => {
  const errors = {};
  const id = text(params.id);
  if (!id) errors.id = 'A household id is required.';
  else if (!SAFE_HH_ID.test(id)) errors.id = 'The household id is not valid.';

  const memberId = params.memberId === undefined ? undefined : text(params.memberId);
  if (memberId !== undefined) {
    if (!memberId) errors.memberId = 'A member id is required.';
    else if (!SAFE_HH_ID.test(memberId)) errors.memberId = 'The member id is not valid.';
  }

  if (Object.keys(errors).length) return invalid(errors);
  return valid(memberId === undefined ? { id } : { id, memberId });
};

const optionalText = (value, max, field, label, errors) => {
  const out = text(value);
  if (out.length > max) errors[field] = `${label} is too long (max ${max} characters).`;
  return out;
};

const validateMember = (member, index, errors) => {
  const prefix = `members[${index}]`;
  const name = text(member?.name);
  if (!name) errors[prefix] = `Member ${index + 1}: name is required.`;
  else if (name.length > TEXT_LIMITS.medium) errors[prefix] = `Member ${index + 1}: name is too long.`;

  if (member?.age !== undefined && member.age !== null && member.age !== '') {
    if (!isFiniteNumber(member.age)) errors.age = `Member ${index + 1}: age must be a number.`;
    else if (Number(member.age) < 0 || Number(member.age) > 120) {
      errors.age = `Member ${index + 1}: age must be between 0 and 120.`;
    }
  }
  if (member?.sex !== undefined && member.sex !== '' && !inEnum(member.sex, SEX_VALUES)) {
    errors.sex = `Member ${index + 1}: sex must be "Male" or "Female".`;
  }
  if (member?.philhealth !== undefined && member.philhealth !== '' && !inEnum(member.philhealth, PHILHEALTH_VALUES)) {
    errors.philhealth = `Member ${index + 1}: PhilHealth value is invalid.`;
  }
  const contact = text(member?.contact);
  if (contact && !isPhonePH(contact)) errors[`${prefix}.contact`] = `Member ${index + 1}: contact number must be a valid PH mobile number.`;

  return {
    name,
    birthday: optionalText(member?.birthday, 10, `${prefix}.birthday`, `Member ${index + 1} birthday`, errors),
    age: member?.age === '' || member?.age === null || member?.age === undefined ? null : Number(member.age),
    sex: text(member?.sex),
    classification: text(member?.classification),
    relationship: text(member?.relationship),
    contact: contact || null,
    isPwd: Boolean(member?.isPwd ?? member?.pwd),
    philhealth: text(member?.philhealth),
    fpMethod: text(member?.fpMethod),
    quarterStatus: text(member?.quarterStatus),
    ...(member?.residentId ? { residentId: text(member.residentId) } : {}),
  };
};

/** Shared field extraction for create (full) and update (partial) payloads. */
const runHouseholdValidator = (input, { partial }) => {
  const body = input && typeof input.household === 'object' && input.household !== null ? input.household : input || {};
  const errors = {};
  const out = {};

  const setRequired = (field, label, max) => {
    const value = text(body[field]);
    if (!value) {
      if (!partial) errors[field] = `${label} is required.`;
    } else if (value.length > max) {
      errors[field] = `${label} is too long (max ${max} characters).`;
    }
    if (value || !partial) out[field] = value;
  };

  setRequired('headName', 'Household head name', TEXT_LIMITS.medium);
  setRequired('purok', 'Purok/Zone', 60);
  setRequired('streetAddress', 'Street address / sitio', TEXT_LIMITS.long);
  setRequired('barangay', 'Barangay', TEXT_LIMITS.medium);

  if (body.contact !== undefined) {
    const contact = text(body.contact);
    if (contact && !isPhonePH(contact)) errors.contact = 'Contact number must be a valid PH mobile number.';
    out.contact = contact;
  }

  if (body.families !== undefined && body.families !== '' && body.families !== null) {
    if (!isFiniteNumber(body.families) || !Number.isInteger(Number(body.families))) {
      errors.families = 'Number of families must be a whole number.';
    } else if (Number(body.families) < 1 || Number(body.families) > 50) {
      errors.families = 'Number of families must be between 1 and 50.';
    } else {
      out.families = Number(body.families);
    }
  } else if (!partial) {
    out.families = 1;
  }

  if (body.monthlyIncome !== undefined && body.monthlyIncome !== '' && body.monthlyIncome !== null) {
    if (!isFiniteNumber(body.monthlyIncome) || Number(body.monthlyIncome) < 0) {
      errors.monthlyIncome = 'Monthly income must be zero or a positive number.';
    } else if (Number(body.monthlyIncome) > 100000000) {
      errors.monthlyIncome = 'Monthly income is unrealistically large.';
    } else {
      out.monthlyIncome = Number(body.monthlyIncome);
    }
  } else if (!partial) {
    out.monthlyIncome = null;
  }

  if (body.hhStatus !== undefined && body.hhStatus !== '' && !inEnum(body.hhStatus, HH_STATUSES)) {
    errors.hhStatus = 'Invalid household status.';
  } else if (body.hhStatus !== undefined) {
    out.hhStatus = text(body.hhStatus);
  }

  if (body.approvalStatus !== undefined && body.approvalStatus !== '' && !inEnum(body.approvalStatus, APPROVAL_STATUSES)) {
    errors.approvalStatus = 'Invalid approval status.';
  } else if (body.approvalStatus !== undefined) {
    out.approvalStatus = text(body.approvalStatus);
  }

  if (body.waterSource !== undefined && body.waterSource !== '' && !inEnum(body.waterSource, WATER_SOURCES)) {
    errors.waterSource = 'Invalid water source.';
  } else if (body.waterSource !== undefined) {
    out.waterSource = text(body.waterSource);
  }

  if (body.toiletType !== undefined && body.toiletType !== '' && !inEnum(body.toiletType, TOILET_TYPES)) {
    errors.toiletType = 'Invalid toilet facility type.';
  } else if (body.toiletType !== undefined) {
    out.toiletType = text(body.toiletType);
  }

  if (body.respondentLast !== undefined) out.respondentLast = optionalText(body.respondentLast, TEXT_LIMITS.medium, 'respondentLast', 'Respondent last name', errors);
  if (body.respondentFirst !== undefined) out.respondentFirst = optionalText(body.respondentFirst, TEXT_LIMITS.medium, 'respondentFirst', 'Respondent first name', errors);
  if (body.respondentMaiden !== undefined) out.respondentMaiden = optionalText(body.respondentMaiden, TEXT_LIMITS.medium, 'respondentMaiden', "Respondent mother's maiden name", errors);
  if (body.collectorName !== undefined) out.collectorName = optionalText(body.collectorName, TEXT_LIMITS.medium, 'collectorName', 'Collector name', errors);

  if (body.members !== undefined && body.members !== null) {
    if (!Array.isArray(body.members)) {
      errors.members = 'Members must be a list.';
    } else {
      out.members = body.members.map((member, index) => validateMember(member, index, errors));
    }
  }

  if (Object.keys(errors).length) return invalid(errors);
  return valid({ household: out });
};

export const createHouseholdValidator = (input = {}) => runHouseholdValidator(input, { partial: false });
export const updateHouseholdValidator = (input = {}) => runHouseholdValidator(input, { partial: true });

export const householdMemberValidator = (input = {}) => {
  const body = input && typeof input.member === 'object' && input.member !== null ? input.member : input || {};
  const errors = {};
  const member = validateMember(body, 0, errors);
  if (Object.keys(errors).length) return invalid(errors);
  return valid({ member });
};

export default {
  householdParamsValidator,
  createHouseholdValidator,
  updateHouseholdValidator,
  householdMemberValidator,
};
