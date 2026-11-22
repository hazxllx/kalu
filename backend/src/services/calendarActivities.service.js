import { getUserClient } from '../config/supabase.js';
import ApiError from '../utils/apiError.js';

const TABLE = 'calendar_activities';
const selectFields = 'id, created_by, title, activity_type, activity_date, activity_time, notes, resident_id, created_at, updated_at';
const fail = (error, message) => {
  if (error) throw Object.assign(new Error(error.message || message), { statusCode: 500, details: error });
};

const clientFor = (user, client) => {
  if (user?.role !== 'health_supervisor' || !user?.id) {
    throw ApiError.forbidden('Only an authorized Health Supervisor can manage personal calendar activities.');
  }
  if (!client && !user.accessToken) throw ApiError.unauthorized();
  return client || getUserClient(user.accessToken);
};

const verifyResidentScope = async (client, user, residentId) => {
  if (!residentId) return;
  if (!user.barangayId || !user.municipalityId) {
    throw ApiError.forbidden('Your account requires an active barangay assignment.');
  }
  const { data, error } = await client
    .from('residents')
    .select('id')
    .eq('id', residentId)
    .eq('barangay_id', user.barangayId)
    .eq('municipality_id', user.municipalityId)
    .maybeSingle();
  fail(error, 'Could not verify the linked resident.');
  if (!data) throw ApiError.badRequest('Select a resident in your assigned barangay.');
};

export const listActivities = async ({ user, from, to, client }) => {
  const supabase = clientFor(user, client);
  let query = supabase.from(TABLE).select(selectFields)
    .eq('created_by', user.id)
    .order('activity_date', { ascending: true })
    .order('activity_time', { ascending: true, nullsFirst: false })
    .order('created_at', { ascending: true });
  if (from) query = query.gte('activity_date', from);
  if (to) query = query.lte('activity_date', to);
  const { data, error } = await query;
  fail(error, 'Could not load calendar activities.');
  return data || [];
};

export const createActivity = async ({ user, payload, client }) => {
  const supabase = clientFor(user, client);
  await verifyResidentScope(supabase, user, payload.resident_id);
  const { data, error } = await supabase.from(TABLE)
    .insert({ ...payload, created_by: user.id })
    .select(selectFields)
    .single();
  fail(error, 'Could not save calendar activity.');
  return data;
};

export const updateActivity = async ({ user, id, payload, client }) => {
  const supabase = clientFor(user, client);
  if (Object.hasOwn(payload, 'resident_id')) {
    await verifyResidentScope(supabase, user, payload.resident_id);
  }
  const { data, error } = await supabase.from(TABLE)
    .update(payload)
    .eq('id', id)
    .eq('created_by', user.id)
    .select(selectFields)
    .maybeSingle();
  fail(error, 'Could not update calendar activity.');
  if (!data) throw ApiError.notFound('Calendar activity not found.');
  return data;
};

export const deleteActivity = async ({ user, id, client }) => {
  const supabase = clientFor(user, client);
  const { data, error } = await supabase.from(TABLE)
    .delete()
    .eq('id', id)
    .eq('created_by', user.id)
    .select('id')
    .maybeSingle();
  fail(error, 'Could not delete calendar activity.');
  if (!data) throw ApiError.notFound('Calendar activity not found.');
  return { id: data.id };
};

export default { listActivities, createActivity, updateActivity, deleteActivity };
