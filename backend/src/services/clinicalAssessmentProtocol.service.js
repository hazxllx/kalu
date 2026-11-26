// backend/src/services/clinicalAssessmentProtocol.service.js
import ApiError from '../utils/apiError.js';
import { getServiceClient } from '../config/supabase.js';

const groups = ['adult', 'pregnancy'];
const fields = ['systolic', 'diastolic'];

export const validateClinicalProtocol = ({ version, thresholds, reviewReference } = {}) => {
  const errors = {};
  if (typeof version !== 'string' || !/^[A-Za-z0-9._-]{1,80}$/.test(version.trim())) errors.version = 'Enter a protocol version.';
  if (typeof reviewReference !== 'string' || reviewReference.trim().length < 12 || reviewReference.trim().length > 500) {
    errors.reviewReference = 'Provide the approved clinical guideline and local protocol reference.';
  }
  if (!thresholds || typeof thresholds !== 'object' || Array.isArray(thresholds)) errors.thresholds = 'Supply reviewed BP thresholds.';
  else for (const group of groups) {
    for (const tier of ['Elevated', 'Severe']) {
      for (const field of fields) {
        const key = `${group}${tier}`;
        const value = thresholds[key]?.[field];
        if (!Number.isInteger(value) || value < 1 || value > 300) errors[`thresholds.${key}.${field}`] = 'Threshold must be an integer from 1 to 300 mmHg.';
      }
    }
    for (const field of fields) {
      if (Number.isInteger(thresholds[`${group}Elevated`]?.[field])
        && Number.isInteger(thresholds[`${group}Severe`]?.[field])
        && thresholds[`${group}Elevated`][field] >= thresholds[`${group}Severe`][field]) {
        errors[`thresholds.${group}${field}`] = 'Elevated must be lower than severe for each BP component.';
      }
    }
  }
  if (Object.keys(errors).length) throw ApiError.unprocessable('Clinical protocol approval is incomplete.', errors);
  return { version: version.trim(), thresholds: Object.fromEntries(groups.flatMap((group) =>
    ['Elevated', 'Severe'].map((tier) => [`${group}${tier}`, Object.fromEntries(fields.map((field) => [field, thresholds[`${group}${tier}`][field]]))]))) };
};

export const approveClinicalAssessmentProtocol = async ({ user, payload = {}, supabase = getServiceClient(), now = new Date().toISOString() }) => {
  if (!['mho', 'phn'].includes(user?.role) || !user?.municipalityId) throw ApiError.forbidden('A municipal MHO or PHN assignment is required to approve this protocol.');
  const normalized = validateClinicalProtocol(payload);
  const row = {
    municipality_id: user.municipalityId,
    ...normalized,
    active: true,
    approved_by: user.id,
    approved_at: now,
    review_reference: payload.reviewReference.trim(),
  };
  const { data, error } = await supabase.from('clinical_assessment_protocols')
    .upsert(row, { onConflict: 'municipality_id' })
    .select('municipality_id,version,thresholds,approved_by,approved_at,review_reference,active').single();
  if (error || !data?.active || data.approved_by !== user.id) {
    throw new ApiError(503, 'The reviewed clinical protocol could not be recorded.');
  }
  return data;
};
