import { getServiceClient } from '../config/supabase.js';
import ApiError from '../utils/apiError.js';

/**
 * Resident-safe follow-up access + confirmation workflow.
 *
 * A resident may ONLY ever see and act on follow-ups that belong to their own
 * resident record. Ownership is derived from the authenticated session
 * (auth.uid() -> residents.auth_user_id) and NEVER from any client-supplied
 * resident id, follow-up id in isolation, query parameter or body field. Every
 * read and write re-resolves the caller's resident row and matches it against
 * the follow-up's resident_id, so changing the :id in the URL only ever yields
 * a 404. Writes run on the service-role client but only touch the resident
 * decision columns; the staff-owned schedule (date/time/location/provider/
 * instructions/priority) is never editable by the resident.
 */

const text = (v) => String(v ?? '').trim();
const throwOnError = (error, fallback) => {
  if (error) throw Object.assign(new Error(error.message || fallback), { statusCode: 500, details: error });
};

/** Resolve the follow-up statuses that still allow a resident response. */
const RESPONDABLE_STATUSES = new Set(['Pending', 'Scheduled']);
const CONSULTATION_EMBED = 'consultation:visits!follow_ups_consultation_id_fkey(id, visit_date, chief_complaint, status)';

/** Confirmation label derived from the stored decision (frontend vocabulary). */
const confirmationOf = (row) => {
  if (row.resident_decision === 'approved') return 'Confirmed';
  if (row.resident_decision === 'rejected') return 'Rejected';
  // Any still-open follow-up scheduled for the resident awaits their response
  // (confirm/reject) — regardless of whether it was flagged
  // requires_resident_response at creation time.
  if (RESPONDABLE_STATUSES.has(row.status)) return 'Awaiting Confirmation';
  return null;
};

/**
 * Resident-safe projection. Deliberately omits audit metadata, created_by,
 * municipality/barangay ids and any staff-only field — only what a resident
 * needs to understand and act on their own follow-up.
 */
const toSafe = (row) => ({
  id: row.id,
  purpose: row.purpose || '',
  scheduledDate: row.scheduled_date || '',
  scheduledTime: row.scheduled_time ? String(row.scheduled_time).slice(0, 5) : '',
  location: row.location || '',
  assignedProvider: row.assigned_provider || '',
  priority: row.priority || 'Medium',
  status: row.status || 'Scheduled',
  instructions: row.notes || '',
  requiresResidentResponse: Boolean(row.requires_resident_response),
  confirmationStatus: confirmationOf(row),
  respondedAt: row.resident_decision_at || '',
  rejectionReason: row.resident_decision === 'rejected' ? (row.resident_decision_reason || '') : '',
  createdAt: row.created_at || '',
  consultation: row.consultation
    ? {
      id: row.consultation.id,
      date: row.consultation.visit_date || '',
      chiefComplaint: row.consultation.chief_complaint || '',
      status: row.consultation.status || '',
    }
    : null,
});

/** Load the caller's own resident record from the authenticated session. */
const ownResident = async (supabase, user) => {
  const { data, error } = await supabase
    .from('residents')
    .select('id, auth_user_id')
    .eq('auth_user_id', user.id)
    .maybeSingle();
  throwOnError(error, 'Could not load your resident record');
  if (!data) throw ApiError.notFound('No resident record is linked to your account.');
  return data;
};

/** Load one follow-up and assert it belongs to the caller (404 otherwise). */
const ownFollowUp = async (supabase, resident, id) => {
  const { data, error } = await supabase.from('follow_ups').select(`*, ${CONSULTATION_EMBED}`).eq('id', id).maybeSingle();
  throwOnError(error, 'Could not load the follow-up');
  // Report any not-found OR not-owned record identically so ids cannot be probed.
  if (!data || data.resident_id !== resident.id) throw ApiError.notFound('Follow-up not found.');
  return data;
};

export const listOwn = async ({ user, supabase = getServiceClient() }) => {
  const resident = await ownResident(supabase, user);
  const { data, error } = await supabase
    .from('follow_ups')
    .select(`*, ${CONSULTATION_EMBED}`)
    .eq('resident_id', resident.id)
    .order('scheduled_date', { ascending: true })
    .limit(200);
  throwOnError(error, 'Could not load your follow-ups');
  return (data || []).map(toSafe);
};

export const getOwn = async ({ user, id, supabase = getServiceClient() }) => {
  const resident = await ownResident(supabase, user);
  const row = await ownFollowUp(supabase, resident, id);
  return toSafe(row);
};

/** Notify the staff member who created the follow-up of the resident decision. */
const notifyStaff = async (supabase, row, decision) => {
  if (!row.created_by) return; // legacy rows without a creator: nothing to notify
  const approved = decision === 'approved';
  await supabase.from('notifications').insert({
    recipient_id: row.created_by,
    category: approved ? 'information' : 'reminder',
    title: approved ? 'Resident approved follow-up' : 'Resident rejected follow-up',
    message: approved
      ? `The resident confirmed the follow-up scheduled on ${row.scheduled_date}. It now appears on the schedule calendar.`
      : `The resident rejected the follow-up requested on ${row.scheduled_date}.`,
    related_type: 'follow_ups',
    related_id: row.id,
  });
};

/**
 * Apply a resident decision (approve | reject).
 *   approve -> resident_decision 'approved', status 'Scheduled' (calendar-visible)
 *   reject  -> resident_decision 'rejected', status 'Cancelled' (not an approved event)
 * Guards duplicate/late decisions with a 409.
 */
const decide = async ({ user, id, decision, reason, supabase = getServiceClient() }) => {
  const resident = await ownResident(supabase, user);
  const row = await ownFollowUp(supabase, resident, id);

  // A resident may respond to any of their OWN follow-ups that are still open
  // (Scheduled/Pending) and that they have not already decided. The
  // requires_resident_response flag is no longer a hard gate — a health-team
  // scheduled follow-up can be confirmed or rejected by the resident it belongs
  // to. Terminal (Completed/Cancelled/Rejected) and already-decided follow-ups
  // are rejected below.
  if (row.resident_decision === 'approved' || row.resident_decision === 'rejected') {
    throw ApiError.conflict('You have already responded to this follow-up.');
  }
  if (!RESPONDABLE_STATUSES.has(row.status)) {
    throw ApiError.conflict('This follow-up can no longer be updated.');
  }

  const cleanReason = text(reason);
  if (decision === 'rejected' && !cleanReason) {
    throw ApiError.unprocessable('A reason is required to reject a follow-up.');
  }

  const patch = {
    resident_decision: decision,
    resident_decision_at: new Date().toISOString(),
    resident_decision_reason: decision === 'rejected' ? cleanReason : '',
    status: decision === 'approved' ? 'Scheduled' : 'Cancelled',
  };
  const { data, error } = await supabase
    .from('follow_ups')
    .update(patch)
    .eq('id', id)
    .eq('resident_id', resident.id) // ownership re-asserted at the write itself
    .select('*')
    .maybeSingle();
  throwOnError(error, 'Could not save your response');
  if (!data) throw ApiError.conflict('You have already responded to this follow-up.');

  // Best-effort audit + staff notification (never rolls back the decision).
  await supabase.from('health_audit_logs').insert({
    actor_id: user.id,
    action: decision === 'approved' ? 'FOLLOWUP_RESIDENT_APPROVED' : 'FOLLOWUP_RESIDENT_REJECTED',
    entity_type: 'follow_ups',
    entity_id: id,
    municipality_id: data.municipality_id || null,
    barangay_id: data.barangay_id || null,
  }).then(() => {}, () => {});
  await notifyStaff(supabase, data, decision).catch(() => {});

  return toSafe(data);
};

export const approveOwn = ({ user, id, supabase }) => decide({ user, id, decision: 'approved', supabase });
export const rejectOwn = ({ user, id, reason, supabase }) => decide({ user, id, decision: 'rejected', reason, supabase });

export default { listOwn, getOwn, approveOwn, rejectOwn };
