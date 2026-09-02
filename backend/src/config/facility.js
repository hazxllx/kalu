/**
 * KALUSAGAP facility + referral reference data for RHU Pili (Pili, Camarines Sur).
 *
 * Single source of truth used when rendering intake records and RHU referral
 * documents. Referral data is stored against the snapshot at the time the PHN
 * processes the record, so later edits to these constants never silently
 * rewrite a finalized/printed referral.
 */
export const FACILITY = Object.freeze({
  name: 'Rural Health Unit 1',
  shortName: 'RHU Pili',
  municipality: 'Local Government Unit of Pili',
  address: 'San Isidro (Pob.), Pili, Camarines Sur',
  province: 'Camarines Sur',
  contactNumber: '(054) 477-1234',
  email: 'health@pili.gov.ph',
});

/**
 * Receiving facilities offered when building a referral. Every referral out of
 * RHU Pili must name one of these (or a custom facility supplied by the PHN);
 * Bicol Medical Center is NOT hard-coded as the receiver.
 */
export const RECEIVING_FACILITIES = Object.freeze([
  { name: 'RHU Pili (Main)', address: 'San Isidro (Pob.), Pili, Camarines Sur' },
  { name: 'RHU Pili – San Jose Health Station', address: 'San Jose, Pili, Camarines Sur' },
  { name: 'RHU Pili – Cadlan Health Station', address: 'Cadlan, Pili, Camarines Sur' },
  { name: 'RHU Pili – Himaao Health Station', address: 'Himaao, Pili, Camarines Sur' },
  { name: 'Bicol Regional Training and Teaching Hospital', address: 'San Agustin, Pili, Camarines Sur' },
  { name: 'Bicol Medical Center', address: 'Naga City, Camarines Sur' },
  { name: 'Other Facility', address: '' },
]);

export const REFERRAL_CATEGORIES = Object.freeze([
  'Medical',
  'Surgical',
  'OB-Gyne',
  'Pediatric',
  'Dental',
  'Laboratory / Diagnostic',
  'Other',
]);

export const OUTPATIENT_SERVICES = Object.freeze([
  'General Outpatient',
  'Prenatal / Maternal Care',
  'Postpartum / Newborn Care',
  'Child Health / Immunization',
  'TB DOTS',
  'Family Planning',
  'Non-Communicable Disease',
  'Wound Care / Minor Procedure',
  'Other',
]);

/**
 * Submission state machine for the resident -> RHU -> PHN workflow. Mirrors the
 * lifecycle used by the UI and enforced by the API:
 *
 *   draft    – intake form in progress (submitting user only)
 *   submitted– BHW/RHU personnel has locked + transferred the record
 *   received – the PHN queue has picked the record up for processing
 *   in_review– PHN is actively working the record
 *   referred – PHN finalized an RHU referral (record holds a referral)
 *   completed– closed by the PHN
 */
export const SUBMISSION_STATUS = Object.freeze({
  DRAFT: 'draft',
  SUBMITTED: 'submitted',
  RECEIVED: 'received',
  IN_REVIEW: 'in_review',
  REFERRED: 'referred',
  COMPLETED: 'completed',
});

export const SUBMISSION_STATUS_LABELS = Object.freeze({
  draft: 'DRAFT',
  submitted: 'SUBMITTED',
  received: 'RECEIVED BY PHN',
  in_review: 'IN REVIEW',
  referred: 'PROCESSED / REFERRED',
  completed: 'COMPLETED',
});

export const SUBMISSION_STATUS_ORDER = Object.freeze([
  SUBMISSION_STATUS.DRAFT,
  SUBMISSION_STATUS.SUBMITTED,
  SUBMISSION_STATUS.RECEIVED,
  SUBMISSION_STATUS.IN_REVIEW,
  SUBMISSION_STATUS.REFERRED,
  SUBMISSION_STATUS.COMPLETED,
]);

/**
 * Statuses that lock the clinical content of a submission against the original
 * submitting user. Once a record leaves `draft`, the intake worker can no
 * longer edit it — the PHN owns the lifecycle from `received` onward.
 */
export const PHN_EDITABLE_STATUSES = Object.freeze([
  SUBMISSION_STATUS.SUBMITTED,
  SUBMISSION_STATUS.RECEIVED,
  SUBMISSION_STATUS.IN_REVIEW,
  SUBMISSION_STATUS.REFERRED,
]);

export default {
  FACILITY,
  RECEIVING_FACILITIES,
  REFERRAL_CATEGORIES,
  OUTPATIENT_SERVICES,
  SUBMISSION_STATUS,
  SUBMISSION_STATUS_LABELS,
  SUBMISSION_STATUS_ORDER,
  PHN_EDITABLE_STATUSES,
};
