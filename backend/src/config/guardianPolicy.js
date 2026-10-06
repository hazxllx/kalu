/**
 * KALUSAGAP — minor / guardian linking policy.
 *
 * One place for the rules that decide WHO is a minor and WHAT a valid
 * minor-to-guardian relationship looks like. Used by:
 *   - registration validation (a minor's application must carry guardian info)
 *   - guardian link service (self-referencing, duplicates, minor-only rules)
 *   - frontend registration form (show/hide the guardian section)
 *
 * The 18-year threshold is the standard Philippine age of majority and is the
 * only part of this policy that is a legal constant; everything else here
 * (relationship types, consent flags, access policy) is deliberately
 * configurable so the Municipal Health Office can adjust it without code
 * changes. Guardian ACCESS to a minor's records is NOT granted by any link
 * here: that policy is explicit (see GUARDIAN_ACCESS_NOT_GRANTED) and remains
 * pending health-office confirmation.
 */
import { ageFromDateOnly } from '../validators/common.js';

/** Applicant is a minor when their age in whole years is strictly below this. */
export const MINOR_AGE_THRESHOLD = 18;

/**
 * Relationship types an authorized user may record for a guardian link.
 * These are descriptive categories for review, not custody determinations:
 * the system stores what the registrant/worker declared and lets authorized
 * staff correct it. No type implies legal authority on its own.
 */
export const GUARDIAN_RELATIONSHIP_TYPES = Object.freeze([
  'father',
  'mother',
  'legal_guardian',
  'grandparent',
  'other_family_member',
  'other',
]);

/** Verification lifecycle of a guardian link. */
export const GUARDIAN_LINK_STATUSES = Object.freeze([
  'pending_guardian_acceptance',
  'pending_verification',
  'verified', // an authorized staff member confirmed the relationship
  'rejected', // an authorized staff member recorded it as incorrect
  'cancelled',
]);

/** Staff roles that may create guardian links (aligned with household workflows). */
export const GUARDIAN_LINK_CREATE_ROLES = Object.freeze([
  'bhw',
  'health_supervisor',
  'phn',
]);

/** Staff roles that may review (verify/reject) or correct a link. */
export const GUARDIAN_LINK_REVIEW_ROLES = Object.freeze([
  'health_supervisor',
  'phn',
]);

/**
 * Deliberate default: recording a relationship does NOT give the guardian
 * access to the minor's medical history. Guardian record access requires a
 * separate, explicitly approved authorization policy (Phase 12 clarification
 * item). The service and RLS therefore treat every link as informational
 * until that policy exists.
 */
export const GUARDIAN_ACCESS_NOT_GRANTED = true;

/** Resident-facing consent wording flag (no legal effect until confirmed). */
export const GUARDIAN_CONSENT_FLAG_DEFAULT = false;

export const isMinorAge = (birthDate, now = new Date()) => {
  const age = ageFromDateOnly(birthDate, now);
  return age !== null && age >= 0 && age < MINOR_AGE_THRESHOLD;
};

export default {
  MINOR_AGE_THRESHOLD,
  GUARDIAN_RELATIONSHIP_TYPES,
  GUARDIAN_LINK_STATUSES,
  GUARDIAN_LINK_CREATE_ROLES,
  GUARDIAN_LINK_REVIEW_ROLES,
  GUARDIAN_ACCESS_NOT_GRANTED,
  GUARDIAN_CONSENT_FLAG_DEFAULT,
  isMinorAge,
};
