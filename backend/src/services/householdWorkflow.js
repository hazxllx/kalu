/**
 * Household profiling lifecycle: audit trail + notifications.
 *
 * The household verification workflow already lives in households.service.js
 * (BHW collects -> submits; Health Supervisor verifies / returns for
 * correction). This module adds the two cross-cutting concerns the workflow was
 * missing, reusing the EXISTING infrastructure rather than inventing new
 * systems:
 *
 *   - audit  -> the shared `health_audit_logs` table (same shape referrals and
 *               operational records use);
 *   - notify -> the shared `notifications` table (via notifyResident, whose
 *               recipient is always an auth.users id — profiles.id === the
 *               auth.users id, so a collector/supervisor profile id is a valid
 *               recipient).
 *
 * Both are best-effort side effects: a failure here is logged but never rolls
 * back the household write that triggered it, and everything is a no-op when
 * Supabase is not configured (local file-driver dev / unit tests). That keeps
 * the service tests — which run without Supabase — unaffected while giving the
 * real deployment a complete audit + notification trail.
 */
import env from '../config/env.js';
import { getServiceClient } from '../config/supabase.js';
import { notifyResident } from './notifications.service.js';

const text = (v) => String(v ?? '').trim();

/**
 * Classify a household update into a lifecycle event, from the PREVIOUS stored
 * household and the incoming (already validated) patch. Pure — no side effects,
 * so it can be unit-tested directly.
 *
 * @returns {{ action: string, audience: 'collector'|'supervisor' }|null}
 *   null when the patch is an ordinary edit, not a lifecycle transition.
 */
export const classifyHouseholdEvent = (previous = {}, patch = {}) => {
  const prevHh = text(previous.hhStatus);
  const prevVerification = text(previous.verificationStatus);

  // Health Supervisor verification outcomes take priority: they always notify
  // the household's collector (the BHW who submitted it).
  if (patch.verificationStatus === 'Verified') {
    return { action: 'HOUSEHOLD_VERIFIED', audience: 'collector' };
  }
  if (patch.verificationStatus === 'Returned for Correction') {
    return { action: 'HOUSEHOLD_RETURNED', audience: 'collector' };
  }

  // BHW submission / resubmission: hh_status transitions to 'Submitted'. When
  // the profile had previously been returned for correction, treat it as a
  // resubmission so the audit trail is unambiguous.
  if (patch.hhStatus === 'Submitted' && prevHh !== 'Submitted') {
    const resubmit = prevVerification === 'Returned for Correction';
    return {
      action: resubmit ? 'HOUSEHOLD_RESUBMITTED' : 'HOUSEHOLD_SUBMITTED',
      audience: 'supervisor',
    };
  }

  return null;
};

/**
 * Append a household lifecycle event to the shared health audit log.
 * Best-effort: never throws, no-op without Supabase.
 */
export const recordHouseholdAudit = async ({ user, action, household, reason = '' } = {}) => {
  if (!env.isSupabaseConfigured) return false;
  if (!user?.id || !action || !household?.id) return false;
  try {
    const supabase = getServiceClient();
    const { error } = await supabase.from('health_audit_logs').insert({
      actor_id: user.id,
      action,
      entity_type: 'households',
      entity_id: household.id,
      municipality_id: household.municipalityId || null,
      barangay_id: household.barangayId || null,
      // Only non-sensitive workflow context is logged — never credentials,
      // tokens, or clinical values.
      metadata: text(reason) ? { reason: text(reason) } : {},
    });
    if (error) {
      console.error(`recordHouseholdAudit: could not write audit log: ${error.message}`);
      return false;
    }
    return true;
  } catch (err) {
    console.error(`recordHouseholdAudit: could not write audit log: ${err.message}`);
    return false;
  }
};

/**
 * Send the notification(s) for a classified household event, reusing the
 * existing notifications table. Best-effort: never throws, no-op without
 * Supabase.
 *
 *   - collector audience  -> notify the household collector (BHW) directly
 *                            (household.collectorId is a profiles.id === auth id).
 *   - supervisor audience -> notify every active Health Supervisor assigned to
 *                            the household's barangay.
 */
export const notifyHouseholdEvent = async ({ event, household, reason = '' } = {}) => {
  if (!env.isSupabaseConfigured || !event || !household?.id) return;
  const label = household.headName ? `${household.headName}'s household` : `Household ${household.id}`;
  try {
    if (event.audience === 'collector') {
      const recipient = household.collectorId || household.createdBy;
      if (!recipient) return;
      const info = event.action === 'HOUSEHOLD_VERIFIED'
        ? {
            category: 'information',
            title: 'Household profile verified',
            message: `${label} (${household.id}) has been verified by the Health Supervisor.`,
          }
        : {
            category: 'alert',
            title: 'Household returned for correction',
            message: `${label} (${household.id}) was returned for correction${text(reason) ? `: ${text(reason)}` : '.'}`,
          };
      await notifyResident({
        recipientAuthUserId: recipient,
        ...info,
        relatedType: 'households',
        relatedId: household.id,
      });
      return;
    }

    if (event.audience === 'supervisor') {
      if (!household.barangayId) return;
      const supabase = getServiceClient();
      const { data, error } = await supabase
        .from('profiles')
        .select('id')
        .eq('role', 'health_supervisor')
        .eq('status', 'active')
        .eq('barangay_id', household.barangayId);
      if (error) {
        console.error(`notifyHouseholdEvent: could not load supervisors: ${error.message}`);
        return;
      }
      const resubmit = event.action === 'HOUSEHOLD_RESUBMITTED';
      const title = resubmit
        ? 'Household resubmitted for verification'
        : 'New household profile awaiting verification';
      const message = `${label} (${household.id}) is awaiting your verification.`;
      for (const row of data || []) {
        await notifyResident({
          recipientAuthUserId: row.id,
          category: 'information',
          title,
          message,
          relatedType: 'households',
          relatedId: household.id,
        });
      }
    }
  } catch (err) {
    console.error(`notifyHouseholdEvent: could not send notification: ${err.message}`);
  }
};

/**
 * Convenience wrapper used by the household service after a successful write:
 * classify + audit + notify in one best-effort call.
 */
export const emitHouseholdWorkflow = async ({ user, previous, patch, household, reason = '' } = {}) => {
  const event = classifyHouseholdEvent(previous, patch);
  if (!event) return null;
  await recordHouseholdAudit({ user, action: event.action, household, reason });
  await notifyHouseholdEvent({ event, household, reason });
  return event;
};

export default {
  classifyHouseholdEvent,
  recordHouseholdAudit,
  notifyHouseholdEvent,
  emitHouseholdWorkflow,
};
