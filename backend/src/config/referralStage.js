/**
 * Referral progress stage — the single source of truth for how a barangay
 * referral's progress is DISPLAYED across every module (Health Supervisor and
 * PHN Referral Management, RHU Triage, RHU Consultation).
 *
 * Architectural role: used in the `route -> authenticate -> authorize ->
 * controller -> service -> repository/Supabase` pipeline when serializing
 * `public.health_referrals` alongside linked `public.visits` encounter records.
 *
 * We deliberately do NOT add new values to the health_referrals.status enum
 * (Pending / Accepted / In Progress / Completed / Cancelled). Instead the
 * granular workflow stage is derived from the stored status PLUS the status of
 * the linked RHU encounter visit (visits.referral_id → referral), so completing
 * triage never reads as "consultation completed" — only a completed visit does.
 *
 * Visit statuses: draft, submitted, received, in_review, referred, completed.
 */

/** Canonical referral progress stage keys exposed to API consumers. */
export const REFERRAL_STAGE = Object.freeze({
  AWAITING_RHU: 'awaiting_rhu',
  TRIAGE: 'triage',
  AWAITING_CONSULTATION: 'awaiting_consultation',
  CONSULTATION_COMPLETED: 'consultation_completed',
  CANCELLED: 'cancelled',
});

/** Human-readable display labels paired with each `REFERRAL_STAGE` key. */
const LABELS = Object.freeze({
  [REFERRAL_STAGE.AWAITING_RHU]: 'Awaiting RHU action',
  [REFERRAL_STAGE.TRIAGE]: 'Resident arrived — triage',
  [REFERRAL_STAGE.AWAITING_CONSULTATION]: 'Triage completed — awaiting consultation',
  [REFERRAL_STAGE.CONSULTATION_COMPLETED]: 'Consultation completed',
  [REFERRAL_STAGE.CANCELLED]: 'Cancelled',
});

/**
 * Derive the granular display stage from a `health_referrals` row and its
 * linked RHU `visits` encounter row (if any).
 *
 * Precedence:
 * 1. `referral.status === 'Cancelled'` -> `cancelled`
 * 2. `referral.status === 'Completed'` or `visit.status === 'completed'` -> `consultation_completed`
 * 3. No linked visit -> `awaiting_rhu`
 * 4. Visit in `'draft'` or `'submitted'` -> `triage`
 * 5. Visit in `'received'`, `'in_review'`, or `'referred'` -> `awaiting_consultation`
 *
 * @param {Object} referral - Stored referral record (`{ status, ... }`)
 * @param {Object|null} [visit] - Linked RHU encounter visit (`{ status, ... }`), if started
 * @returns {{ key: string, label: string }}
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
