import repository from '../repositories/index.js';
import { getServiceClient } from '../config/supabase.js';
import ApiError from '../utils/apiError.js';

// Copy is server-owned. Never render audit metadata, clinical values or names.
const ACTIVITY_COPY = new Map([
  ['resident_created', ['Resident registered', 'A resident registration was recorded.']],
  ['visit_created', ['Visit recorded', 'A health visit was recorded.']],
  ['assessment_recorded', ['Clinical assessment recorded', 'An encounter assessment was recorded.']],
  ['follow_up_created', ['Follow-up scheduled', 'A follow-up record was created.']],
  ['follow_up_completed', ['Follow-up completed', 'A follow-up completion was recorded.']],
  ['referral_created', ['Referral created', 'A referral was recorded.']],
  ['referral_updated', ['Referral updated', 'A referral record was updated.']],
  ['referral_reassigned', ['Referral reassigned', 'A referral assignment was changed.']],
  ['referral_status_changed', ['Referral status changed', 'A referral status transition was recorded.']],
  ['household_visit_created', ['Household visit recorded', 'A household monitoring visit was recorded.']],
  ['record_updated', ['Health record updated', 'An update to a health monitoring record was recorded.']],
  ['assessment_form_created', ['Health assessment form recorded', 'A program health assessment form was created.']],
  ['assessment_form_updated', ['Health assessment form updated', 'An update to a program health assessment form was recorded.']],
  ['tcl_created', ['Program enrollment recorded', 'A target client list entry was recorded.']],
  ['immunization_created', ['Immunization record created', 'An immunization record was created.']],
]);
const REFERRAL_STATUSES = new Set(['Pending', 'Accepted', 'In Progress', 'Completed', 'Rejected', 'Cancelled']);
const ASSESSMENT_STATUSES = new Set(['assessed', 'incomplete', 'pending_clinical_approval']);
const COMPLETION_STATUS = new Set(['Completed']);
const NO_STATUS = new Set();
const activityError = (error) => {
  if (error?.code === '42501') return ApiError.forbidden('Your account cannot access these monitoring activities.');
  if (error?.code === '22023') return ApiError.unprocessable('The selected barangay is not supported.');
  return new ApiError(503, 'Recent monitoring activities could not be loaded.');
};

export const getRecentActivities = async ({ actorId, barangay = null } = {}, {
  repo = repository,
  rpc = (name, params) => getServiceClient().rpc(name, params),
} = {}) => {
  if (!actorId) throw ApiError.unauthorized('An authenticated analytics actor is required.');
  // The file driver has no authoritative append-only activity source.
  if ((repo.mode ?? repo.driver) === 'file') return { activities: [] };
  let result;
  try {
    result = await rpc('scoped_recent_monitoring_activities', { p_actor_id: actorId, p_barangay: barangay || null });
  } catch (error) { throw activityError(error); }
  if (result?.error) throw activityError(result.error);
  const rows = result?.data?.activities;
  if (!Array.isArray(rows) || rows.length > 5) throw activityError();
  const activities = rows.map((row) => {
    const copy = ACTIVITY_COPY.get(row?.kind);
    if (!copy) throw activityError();
    const statusAllowed = row?.kind === 'assessment_recorded' ? ASSESSMENT_STATUSES
      : row?.kind?.startsWith('referral_') ? REFERRAL_STATUSES
        : row?.kind === 'follow_up_completed' ? COMPLETION_STATUS : NO_STATUS;
    if (typeof row.id !== 'string' || !/^[a-f0-9]{32}$/.test(row.id)
      || typeof row.occurredAt !== 'string' || !Number.isFinite(Date.parse(row.occurredAt))
      || (row.status != null && !statusAllowed.has(row.status))) throw activityError();
    let target;
    if (row.target != null) {
      const type = row.kind.startsWith('referral_') ? 'referral'
        : ['follow_up_created', 'follow_up_completed'].includes(row.kind) ? 'follow_up'
          : ['household_visit_created', 'record_updated'].includes(row.kind) ? 'household' : null;
      const idPattern = type === 'household' ? /^[A-Za-z0-9_-]{1,32}$/
        : /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
      if (!type || row.target.type !== type || typeof row.target.id !== 'string' || !idPattern.test(row.target.id)) {
        throw activityError();
      }
      target = { type, id: row.target.id };
    }
    return {
      id: row.id, kind: row.kind, title: copy[0], description: copy[1], occurredAt: row.occurredAt,
      ...(row.status != null ? { status: row.status } : {}),
      ...(target ? { target } : {}),
    };
  });
  return { activities };
};
