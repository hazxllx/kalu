import {
  TEXT_LIMITS,
  inEnum,
  isFiniteNumber,
  isPhonePH,
  invalid,
  text,
  valid,
} from './common.js';
import { isApprovedBarangayName } from '../config/barangays.js';

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
export const VERIFICATION_STATUSES = Object.freeze(['Pending Verification', 'Verified', 'Returned for Correction']);
export const WATER_SOURCES = Object.freeze(['level1', 'level2', 'level3', 'unimproved']);
export const TOILET_TYPES = Object.freeze(['ws_own', 'ws_shared', 'open_pit', 'antipolo', 'none']);
export const PHILHEALTH_VALUES = Object.freeze(['member', 'non-member']);
export const HOUSEHOLD_VISIT_REASONS = Object.freeze(['Initial Profiling', 'Updating Household Information', 'Verification', 'Follow-up', 'Monitoring', 'Other']);
export const HOUSEHOLD_UPDATE_SECTIONS = Object.freeze(['Household Information', 'Household Details', 'Respondent Information', 'HH Head PhilHealth Information', 'Water Source and Sanitation Details', 'Household Members']);
export const SEX_VALUES = Object.freeze(['Male', 'Female']);

const SAFE_HH_ID = /^[A-Za-z0-9_-]{1,32}$/;
// Household member ids are database UUIDs (gen_random_uuid, 36 chars), which are
// longer than the short HH- household id, so they need their own pattern.
const UUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

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
    else if (!UUID.test(memberId) && !SAFE_HH_ID.test(memberId)) errors.memberId = 'The member id is not valid.';
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

  const normalized = {
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
  const newResident = member?.newResident || member?.new_resident;
  if (newResident !== undefined) {
    const firstName = text(newResident?.firstName || newResident?.first_name);
    const lastName = text(newResident?.lastName || newResident?.last_name);
    const birthDate = text(newResident?.birthDate || newResident?.birth_date);
    if (!firstName) errors[`${prefix}.newResident.firstName`] = `Member ${index + 1}: resident first name is required.`;
    if (!lastName) errors[`${prefix}.newResident.lastName`] = `Member ${index + 1}: resident last name is required.`;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(birthDate) || Number.isNaN(Date.parse(`${birthDate}T00:00:00.000Z`))) {
      errors[`${prefix}.newResident.birthDate`] = `Member ${index + 1}: resident birthdate must be a valid date.`;
    }
    normalized.newResident = {
      firstName,
      lastName,
      birthDate,
      sex: text(newResident?.sex),
      birthPlace: text(newResident?.birthPlace || newResident?.birth_place),
    };
  }
  return normalized;
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
  if (out.barangay && !isApprovedBarangayName(out.barangay)) {
    errors.barangay = 'Select one of the approved barangays.';
  }

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

  for (const [field, label, max] of [
    ['nhts', 'NHTS status', TEXT_LIMITS.medium],
    ['ip', 'IP status', TEXT_LIMITS.medium],
    ['philhealthId', 'PhilHealth ID', TEXT_LIMITS.medium],
    ['philhealthCategory', 'PhilHealth category', TEXT_LIMITS.medium],
    ['waterType', 'Water source type', TEXT_LIMITS.medium],
    ['waterDistance', 'Water source distance', TEXT_LIMITS.medium],
    ['waterAvailability', 'Water availability', TEXT_LIMITS.medium],
    ['sanitationAccess', 'Sanitation access', TEXT_LIMITS.medium],
    ['wasteDisposal', 'Waste disposal', TEXT_LIMITS.medium],
    ['wasteSegregation', 'Waste segregation', TEXT_LIMITS.medium],
  ]) {
    if (body[field] !== undefined) out[field] = optionalText(body[field], max, field, label, errors);
  }

  for (const field of ['philhealthMember', 'waterTreated']) {
    if (body[field] !== undefined) {
      if (typeof body[field] !== 'boolean') errors[field] = `${field} must be true or false.`;
      else out[field] = body[field];
    }
  }
  if (body.treatmentMethods !== undefined) {
    if (!Array.isArray(body.treatmentMethods) || body.treatmentMethods.some((method) => typeof method !== 'string' || method.length > TEXT_LIMITS.medium)) {
      errors.treatmentMethods = 'Treatment methods must be a list of text values.';
    } else {
      out.treatmentMethods = [...new Set(body.treatmentMethods.map((method) => text(method)).filter(Boolean))];
    }
  }
  if (body.quarterVisits !== undefined) {
    if (!body.quarterVisits || typeof body.quarterVisits !== 'object' || Array.isArray(body.quarterVisits)) {
      errors.quarterVisits = 'Quarter visit tracking must be an object.';
    } else {
      const quarterVisits = {};
      for (const quarter of ['q1', 'q2', 'q3', 'q4']) {
        const date = text(body.quarterVisits[quarter]);
        if (date && (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00.000Z`)))) {
          errors[`quarterVisits.${quarter}`] = `${quarter.toUpperCase()} must be a valid date.`;
        }
        quarterVisits[quarter] = date;
      }
      out.quarterVisits = quarterVisits;
    }
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

  // Health Supervisor verification outcome. The validator only passes the
  // outcome and its reason through; the reviewer identity (verifiedBy) and
  // timestamp (verifiedAt) are always derived server-side from the session in
  // the service layer and are never accepted from the client.
  if (body.verificationStatus !== undefined) {
    if (body.verificationStatus !== '' && !inEnum(body.verificationStatus, VERIFICATION_STATUSES)) {
      errors.verificationStatus = 'Invalid verification status.';
    } else {
      out.verificationStatus = text(body.verificationStatus);
    }
  }
  if (body.correctionReason !== undefined) {
    out.correctionReason = optionalText(body.correctionReason, TEXT_LIMITS.long, 'correctionReason', 'Correction reason', errors);
  }

  if (body.respondentLast !== undefined) out.respondentLast = optionalText(body.respondentLast, TEXT_LIMITS.medium, 'respondentLast', 'Respondent last name', errors);
  if (body.respondentFirst !== undefined) out.respondentFirst = optionalText(body.respondentFirst, TEXT_LIMITS.medium, 'respondentFirst', 'Respondent first name', errors);
  if (body.respondentMaiden !== undefined) out.respondentMaiden = optionalText(body.respondentMaiden, TEXT_LIMITS.medium, 'respondentMaiden', "Respondent mother's maiden name", errors);
  if (body.collectorName !== undefined) out.collectorName = optionalText(body.collectorName, TEXT_LIMITS.medium, 'collectorName', 'Collector name', errors);

  if (!partial && body.initialVisitDate !== undefined) {
    const value = text(body.initialVisitDate);
    const parsed = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T00:00:00.000Z`) : null;
    if (!parsed || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
      errors.initialVisitDate = 'Visit date must be a valid calendar date.';
    } else {
      out.initialVisitDate = value;
    }
  }
  if (!partial && body.initialVisitRequestId !== undefined) {
    const value = text(body.initialVisitRequestId);
    if (!UUID.test(value)) errors.initialVisitRequestId = 'Visit request id must be a valid UUID.';
    else out.initialVisitRequestId = value;
  }

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

export const householdVisitValidator = (input = {}) => {
  const body = input && typeof input.visit === 'object' && input.visit !== null ? input.visit : input || {};
  const errors = {};
  const visitDate = text(body.visitDate);
  const parsedDate = /^\d{4}-\d{2}-\d{2}$/.test(visitDate) ? new Date(`${visitDate}T00:00:00.000Z`) : null;
  if (!parsedDate || Number.isNaN(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== visitDate) {
    errors.visitDate = 'Visit date must be a valid calendar date.';
  }
  const requestId = text(body.requestId);
  if (!UUID.test(requestId)) errors.requestId = 'A valid request id is required.';
  const visitReason = text(body.visitReason);
  if (!HOUSEHOLD_VISIT_REASONS.includes(visitReason)) errors.visitReason = 'Select a valid reason for this visit.';
  const updatedSections = Array.isArray(body.updatedSections) ? body.updatedSections : [];
  if (updatedSections.some((section) => !HOUSEHOLD_UPDATE_SECTIONS.includes(text(section)))) {
    errors.updatedSections = 'One or more updated sections are invalid.';
  }
  if (Object.keys(errors).length) return invalid(errors);
  return valid({ visit: { visitDate, requestId, visitReason, updatedSections: [...new Set(updatedSections.map(text))] } });
};

export default {
  householdParamsValidator,
  createHouseholdValidator,
  updateHouseholdValidator,
  householdMemberValidator,
  householdVisitValidator,
};
