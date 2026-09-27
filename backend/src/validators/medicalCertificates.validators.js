import { CERT_PURPOSES, CERT_STATUSES } from '../services/medicalCertificates.service.js';
import { invalid, isUuid, text, valid } from './common.js';

/**
 * Medical certificate request validation.
 *
 * The resident is referenced by id only — its scope, name and sex are resolved
 * from the database by the service, so a client cannot file a certificate
 * against a resident it is not allowed to see.
 */

const LIMITS = { short: 120, notes: 2000 };

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

export const createCertificateValidator = (input = {}) => {
  const errors = {};
  const residentId = text(input?.residentId || input?.resident_id);
  if (!residentId) errors.residentId = 'Select the resident this certificate is for.';
  else if (!residentId) errors.residentId = 'The resident reference is not valid.';

  const row = certificateFields(input, errors, { requireClinical: true });
  if (Object.keys(errors).length) return invalid(errors);
  return valid({ ...row, residentId });
};

export const updateCertificateValidator = (input = {}) => {
  const errors = {};
  const row = certificateFields(input, errors, { requireClinical: false });
  if (Object.keys(errors).length) return invalid(errors);
  return valid(row);
};

export const certificateIdParamValidator = (params = {}) => {
  const id = text(params.id);
  if (!id) return invalid({ id: 'A certificate reference is required.' });
  if (!isUuid(id)) return invalid({ id: 'The certificate reference is not valid.' });
  return valid({ ...params, id });
};

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
