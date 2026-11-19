import { CERT_PURPOSES, CERT_STATUSES } from '../services/medicalCertificates.service.js';
import { invalid, isUuid, text, valid } from './common.js';

/**
 * @file Medical certificate request & clinical status validators (server-authoritative).
 *
 * Executed by `middleware/validate.js` in the KALUSAGAP request pipeline
 * (`route -> authenticate -> authorize/authorizeStation -> validate -> controller -> service -> Supabase`).
 *
 * The target resident is referenced strictly by ID (`residentId` / `resident_id`);
 * resident name, sex, age, and barangay/municipality scope are resolved from the
 * database in `medicalCertificates.service.js` so callers cannot forge demographics
 * or file certificates outside their authorized coverage area.
 */

const LIMITS = { short: 120, notes: 2000 };

/**
 * Extracts and validates shared clinical/metadata fields for certificate creation and edits.
 *
 * @param {Object} input - Raw request body.
 * @param {Object} errors - Mutable field-error accumulator.
 * @param {Object} options - `{ requireClinical: boolean }` toggle for mandatory findings/officer checks.
 * @returns {Object} Sanitized certificate field map.
 */
const certificateFields = (input, errors, { requireClinical }) => {
  const row = {};

  if (input?.purpose !== undefined) {
    const purpose = text(input.purpose);
    if (purpose && !CERT_PURPOSES.includes(purpose)) errors.purpose = 'Select a valid certificate purpose.';
    row.purpose = purpose || CERT_PURPOSES[0];
  }

  if (input?.findings !== undefined) {
    const findings = text(input.findings);
    if (requireClinical && !findings) errors.findings = 'Clinical findings are required.';
    if (findings.length > LIMITS.notes) errors.findings = 'Clinical findings are too long.';
    row.findings = findings;
  }

  if (input?.dateOfExamination !== undefined) {
    const value = text(input.dateOfExamination);
    if (value && !/^\d{4}-\d{2}-\d{2}$/.test(value)) errors.dateOfExamination = 'Enter a valid date.';
    row.dateOfExamination = value;
  }

  if (input?.medicalOfficer !== undefined) {
    const officer = text(input.medicalOfficer);
    if (requireClinical && !officer) errors.medicalOfficer = 'The medical officer name is required.';
    if (officer.length > LIMITS.short) errors.medicalOfficer = 'That name is too long.';
    row.medicalOfficer = officer;
  }

  if (input?.licenseNumber !== undefined) row.licenseNumber = text(input.licenseNumber).slice(0, LIMITS.short);
  if (input?.civilStatus !== undefined) row.civilStatus = text(input.civilStatus).slice(0, LIMITS.short);
  if (input?.recommendation !== undefined) row.recommendation = text(input.recommendation).slice(0, LIMITS.notes);
  if (input?.remarks !== undefined) row.remarks = text(input.remarks).slice(0, LIMITS.notes);
  if (input?.notes !== undefined) row.notes = text(input.notes).slice(0, LIMITS.notes);

  return row;
};

/**
 * Validates `POST /medical-certificates` creation payloads.
 * Requires `residentId` while keeping `findings` and `medicalOfficer` optional at the
 * validator gate so Triage-station RHU Personnel can lodge an intake request that
 * PHN/MHO clinicians subsequently complete.
 *
 * @param {Object} [input] - Raw request body.
 * @returns {Object} Validation result `{ value }` or `{ error }`.
 */
export const createCertificateValidator = (input = {}) => {
  const errors = {};
  const residentId = text(input?.residentId || input?.resident_id);
  if (!residentId) errors.residentId = 'Select the resident this certificate is for.';
  else if (!residentId) errors.residentId = 'The resident reference is not valid.';

  // Clinical completeness (findings + medical officer) is enforced in the
  // service for the PHN/MHO preparation path. A Triage-station RHU Personnel may
  // submit a REQUEST without those fields (the PHN/MHO complete them on review),
  // so the validator does not require them here.
  const row = certificateFields(input, errors, { requireClinical: false });
  if (Object.keys(errors).length) return invalid(errors);
  return valid({ ...row, residentId });
};

/**
 * Validates `PUT`/`PATCH /medical-certificates/:id` partial clinical content updates.
 *
 * @param {Object} [input] - Raw request body.
 * @returns {Object} Validation result `{ value }` or `{ error }`.
 */
export const updateCertificateValidator = (input = {}) => {
  const errors = {};
  const row = certificateFields(input, errors, { requireClinical: false });
  if (Object.keys(errors).length) return invalid(errors);
  return valid(row);
};

/**
 * Validates `:id` route parameters for medical certificate endpoints as UUIDs.
 *
 * @param {Object} [params] - Route params object.
 * @returns {Object} Validation result `{ value }` or `{ error }`.
 */
export const certificateIdParamValidator = (params = {}) => {
  const id = text(params.id);
  if (!id) return invalid({ id: 'A certificate reference is required.' });
  if (!isUuid(id)) return invalid({ id: 'The certificate reference is not valid.' });
  return valid({ ...params, id });
};

/**
 * Validates medical certificate lifecycle status transitions (`CERT_STATUSES`).
 * Requires non-empty explanatory `notes` whenever `status === 'Rejected'`.
 *
 * @param {Object} [input] - Raw request body.
 * @returns {Object} Validation result `{ value: { status, notes } }` or `{ error }`.
 */
export const changeStatusValidator = (input = {}) => {
  const errors = {};
  const status = text(input?.status);
  if (!CERT_STATUSES.includes(status)) errors.status = 'Select a valid certificate status.';

  const notes = text(input?.notes).slice(0, LIMITS.notes);
  if (status === 'Rejected' && !notes) errors.notes = 'Please provide a reason for rejecting this certificate.';

  if (Object.keys(errors).length) return invalid(errors);
  return valid({ status, notes });
};

export default {
  createCertificateValidator,
  updateCertificateValidator,
  certificateIdParamValidator,
  changeStatusValidator,
};
