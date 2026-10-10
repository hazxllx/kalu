/**
 * Referral progress stage — the single source of truth for how a barangay
 * referral's progress is DISPLAYED across every module (Health Supervisor and
 * PHN Referral Management, RHU Triage, RHU Consultation).
 *
 * We deliberately do NOT add new values to the health_referrals.status enum
 * (Pending / Accepted / In Progress / Completed / Cancelled). Instead the
 * granular workflow stage is derived from the stored status PLUS the status of
 * the linked RHU encounter visit (visits.referral_id → referral), so completing
 * triage never reads as "consultation completed" — only a completed visit does.
 *
 * Visit statuses: draft, submitted, received, in_review, referred, completed.
 */

export const REFERRAL_STAGE = Object.freeze({
  AWAITING_RHU: 'awaiting_rhu',
  TRIAGE: 'triage',
  AWAITING_CONSULTATION: 'awaiting_consultation',
  CONSULTATION_COMPLETED: 'consultation_completed',
  CANCELLED: 'cancelled',
});

const LABELS = Object.freeze({
  [REFERRAL_STAGE.AWAITING_RHU]: 'Awaiting RHU action',
  [REFERRAL_STAGE.TRIAGE]: 'Resident arrived — triage',
  [REFERRAL_STAGE.AWAITING_CONSULTATION]: 'Triage completed — awaiting consultation',
  [REFERRAL_STAGE.CONSULTATION_COMPLETED]: 'Consultation completed',
  [REFERRAL_STAGE.CANCELLED]: 'Cancelled',
});

/**
 * Derive the display stage from a referral row and its linked visit (or null).
 * Returns { key, label }.
 */
export const deriveStage = (referral, visit = null) => {
  const key = (() => {
    if (referral?.status === 'Cancelled') return REFERRAL_STAGE.CANCELLED;
    if (referral?.status === 'Completed' || visit?.status === 'completed') {
      return REFERRAL_STAGE.CONSULTATION_COMPLETED;
    }
    if (!visit) return REFERRAL_STAGE.AWAITING_RHU;
    if (['draft', 'submitted'].includes(visit.status)) return REFERRAL_STAGE.TRIAGE;
    if (['received', 'in_review', 'referred'].includes(visit.status)) {
      return REFERRAL_STAGE.AWAITING_CONSULTATION;
    }
    return REFERRAL_STAGE.AWAITING_RHU;
  })();
  return { key, label: LABELS[key] };
};

export default { REFERRAL_STAGE, deriveStage };
