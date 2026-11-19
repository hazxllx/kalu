import { getServiceClient } from '../config/supabase.js';
import ApiError from '../utils/apiError.js';

const text = (value) => String(value ?? '').trim();
const throwOnError = (error, message) => { if (error) throw Object.assign(new Error(error.message || message), { statusCode: 500, details: error }); };
const RESIDENT_ROLES = new Set(['resident', 'resident-limited']);
const REVIEW_ROLES = new Set(['health_supervisor', 'rhu_personnel']);

const ownResident = async (db, user) => {
  const { data, error } = await db.from('residents').select('id, municipality_id, barangay_id').eq('auth_user_id', user.id).maybeSingle();
  throwOnError(error, 'Could not load resident');
  if (!data) throw ApiError.notFound('No resident record is linked to this account.');
  return data;
};

const futureDate = (value) => {
  const raw = text(value);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(raw)) return null;
  const date = new Date(`${raw}:00+08:00`);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
};

const notify = async (db, recipient, category, title, message, type, id) => {
  if (!recipient) return;
  await db.from('notifications').insert({ recipient_id: recipient, category, title, message, related_type: type, related_id: id }).then(() => {}, () => {});
};

export const submit = async ({ user, targetType, targetId, requestType, proposedSchedule, reason, supabase = getServiceClient() }) => {
  if (!RESIDENT_ROLES.has(user?.role)) throw ApiError.forbidden();
  const resident = await ownResident(supabase, user);
  if (!['referral', 'follow_up'].includes(targetType) || !['attendance', 'reschedule', 'cancellation'].includes(requestType)) throw ApiError.unprocessable('Invalid schedule request.');
  const table = targetType === 'referral' ? 'health_referrals' : 'follow_ups';
  const { data: target, error } = await supabase.from(table).select('*').eq('id', targetId).maybeSingle();
  throwOnError(error, 'Could not load schedule');
  if (!target || target.resident_id !== resident.id) throw ApiError.notFound('Schedule not found.');
  if (targetType === 'referral') {
    const destination = `${target.destination_facility || ''} ${target.external_receiving_facility || ''}`;
    if (!target.recipient_facility_id || /hospital/i.test(destination)) {
      throw ApiError.unprocessable('For external facilities and hospitals, please contact the receiving facility directly.');
    }
    const { data: facility, error: facilityError } = await supabase.from('facilities')
      .select('id, type, municipality_id').eq('id', target.recipient_facility_id).maybeSingle();
    throwOnError(facilityError, 'Could not verify the referral destination');
    if (!facility || !['rhu', 'barangay_health_station'].includes(facility.type)
      || facility.municipality_id !== resident.municipality_id) {
      throw ApiError.unprocessable('Schedule requests are available for RHU and barangay health station referrals within your municipality. Please contact other facilities directly.');
    }
  }
  const proposed = requestType === 'reschedule' ? futureDate(proposedSchedule) : null;
  if (requestType === 'reschedule' && !proposed) throw ApiError.unprocessable('Choose a valid future date and time in Manila time.');
  if (requestType !== 'attendance' && !text(reason)) throw ApiError.unprocessable('A reason is required.');
  const { data, error: rpcError } = await supabase.rpc('health_schedule_request_submit', {
    p_actor_id: user.id, p_resident_id: resident.id, p_target_type: targetType, p_target_id: targetId,
    p_request_type: requestType, p_proposed_scheduled_at: proposed, p_reason: text(reason),
  });
  if (rpcError) {
    const message = rpcError.message || 'Could not submit schedule request.';
    if (rpcError.code === '42501') throw ApiError.notFound('Schedule not found.');
    if (rpcError.code === '23505') throw ApiError.conflict(message);
    if (['22023', '23514'].includes(rpcError.code)) throw ApiError.unprocessable(message);
    throwOnError(rpcError, message);
  }
  if (targetType === 'follow_up') {
    await notify(supabase, target.created_by, 'reminder', requestType === 'attendance' ? 'Resident confirmed attendance' : 'Resident schedule request',
      requestType === 'attendance' ? 'A resident confirmed attendance for a scheduled service.' : 'A resident submitted a schedule change request for review.',
      'follow_ups', targetId);
  }
  return data;
};

const canReviewFacility = (user, facility) => {
  if (user.role === 'health_supervisor') return facility.type === 'barangay_health_station' && facility.barangay_id === user.barangayId;
  if (user.role === 'rhu_personnel') return facility.type === 'rhu' && facility.id === user.facilityId && (user.rhuStations || []).includes('triage');
  return false;
};

export const listForStaff = async ({ user, supabase = getServiceClient() }) => {
  if (RESIDENT_ROLES.has(user?.role)) {
    const resident = await ownResident(supabase, user);
    const { data, error } = await supabase.from('health_schedule_requests')
      .select('*, facility:facilities!health_schedule_requests_facility_id_fkey(id,name,type,barangay_id)')
      .eq('resident_id', resident.id).order('created_at', { ascending: false }).limit(200);
    throwOnError(error, 'Could not load your schedule requests');
    return data || [];
  }
  if (!REVIEW_ROLES.has(user?.role)) throw ApiError.forbidden();
  const { data: facilities, error: facilityError } = await supabase.from('facilities').select('id, name, type, barangay_id, municipality_id');
  throwOnError(facilityError, 'Could not load facilities');
  const allowedFacilities = (facilities || []).filter((facility) => canReviewFacility(user, facility));
  if (!allowedFacilities.length) return [];
  const { data: requests, error } = await supabase.from('health_schedule_requests')
    .select('*, facility:facilities!health_schedule_requests_facility_id_fkey(id,name,type,barangay_id), resident:residents!health_schedule_requests_resident_id_fkey(id,first_name,middle_name,last_name,barangay)')
    .in('facility_id', allowedFacilities.map((f) => f.id)).order('created_at', { ascending: false }).limit(200);
  throwOnError(error, 'Could not load schedule requests');
  return Promise.all((requests || []).map(async (request) => {
    if (request.referral_id) {
      const { data: referral } = await supabase.from('health_referrals').select('reason,scheduled_at,status,destination_facility').eq('id', request.referral_id).maybeSingle();
      return { ...request, target: referral, targetType: 'referral' };
    }
    const { data: followUp } = await supabase.from('follow_ups').select('purpose,scheduled_date,scheduled_time,status,location,assigned_provider').eq('id', request.follow_up_id).maybeSingle();
    return { ...request, target: followUp, targetType: 'follow_up' };
  }));
};

export const decide = async ({ user, id, decision, reviewReason = '', supabase = getServiceClient() }) => {
  if (!REVIEW_ROLES.has(user?.role)) throw ApiError.forbidden();
  if (!['Approved', 'Rejected'].includes(decision)) throw ApiError.unprocessable('Choose approve or reject.');
  const { data: request, error } = await supabase.from('health_schedule_requests').select('*, facility:facilities!health_schedule_requests_facility_id_fkey(id,name,type,barangay_id)').eq('id', id).maybeSingle();
  throwOnError(error, 'Could not load schedule request');
  if (!request || !canReviewFacility(user, request.facility)) throw ApiError.notFound('Schedule request not found.');
  if (decision === 'Rejected' && !text(reviewReason)) throw ApiError.unprocessable('Provide a reason for rejecting this request.');
  const { data, error: rpcError } = await supabase.rpc('health_schedule_request_decide', {
    p_request_id: id, p_actor_id: user.id, p_decision: decision, p_review_reason: text(reviewReason),
  });
  if (rpcError) {
    if (rpcError.code === '42501' || rpcError.code === 'P0002') throw ApiError.notFound('Schedule request not found.');
    if (rpcError.code === '23514') throw ApiError.conflict(rpcError.message);
    throwOnError(rpcError, 'Could not process request');
  }
  if (request.follow_up_id) {
    const { data: resident } = await supabase.from('residents').select('auth_user_id').eq('id', request.resident_id).maybeSingle();
    await notify(supabase, resident?.auth_user_id, decision === 'Approved' ? 'information' : 'reminder',
      `Schedule request ${decision.toLowerCase()}`, decision === 'Approved' ? 'Your schedule request was approved.' : `Your schedule request was declined. ${text(reviewReason)}`,
      'follow_ups', request.follow_up_id);
  }
  return data;
};

export default { submit, listForStaff, decide };
