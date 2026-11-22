/**
 * Account notification helpers (server side).
 *
 * Notifications belong to an authenticated account. Staff recipients are
 * resolved from their active profile role and geographic assignment; resident
 * recipients are resolved from their linked Auth user ID.
 *
 * The recipient is always an authenticated resident's `auth.users` id — never
 * a value taken from the request body. Notification text intentionally avoids
 * clinical detail so sensitive health information is not leaked into the feed.
 *
 * Notifications are best-effort: a failure here is logged but never rolls back
 * the decision that triggered it (the audit log remains the source of truth).
 * When Supabase is not configured (local file-driver dev), this is a no-op.
 */
import env from '../config/env.js';
import { getServiceClient } from '../config/supabase.js';

const NOTIFICATION_PRIORITIES = new Set(['emergency', 'critical']);

/**
 * Create a notification for an account.
 *
 * @param {object} params
 * @param {string} params.recipientAuthUserId  authenticated account ID
 * @param {string} [params.category]           'information' | 'reminder' | 'alert'
 * @param {string} params.title
 * @param {string} [params.message]
 * @param {string} [params.relatedType]
 * @param {string} [params.relatedId]
 * @param {'emergency'|'critical'} [params.priority] reserved for explicitly classified high-priority events
 * @returns {Promise<boolean>} true when a row was written
 */
export const notifyResident = async ({
  recipientAuthUserId,
  category = 'information',
  title,
  message = '',
  relatedType = '',
  relatedId = null,
  priority = null,
}) => {
  if (!env.isSupabaseConfigured) return false;
  if (!recipientAuthUserId || !title) return false;
  if (priority !== null && !NOTIFICATION_PRIORITIES.has(priority)) {
    console.error(`notifyResident: unsupported notification priority: ${priority}`);
    return false;
  }
  try {
    const supabase = getServiceClient();
    const { error } = await supabase.from('notifications').insert({
      recipient_id: recipientAuthUserId,
      category,
      title,
      message,
      related_type: relatedType,
      related_id: relatedId,
      ...(priority ? { priority } : {}),
    });
    if (error) {
      console.error(`notifyResident: could not write notification: ${error.message}`);
      return false;
    }
    return true;
  } catch (err) {
    console.error(`notifyResident: could not write notification: ${err.message}`);
    return false;
  }
};

/**
 * Persist one account-scoped notification for a stable source event.
 *
 * The database event key is unique per recipient, so concurrent retries cannot
 * create duplicate rows. `recipientAuthUserId` is always resolved server-side.
 */
export const notifyAccountOnce = async ({
  recipientAuthUserId,
  category = 'information',
  title,
  message = '',
  relatedType = '',
  relatedId = null,
  priority = null,
  eventKey,
  supabase = null,
} = {}) => {
  if (!env.isSupabaseConfigured) return false;
  if (!recipientAuthUserId || !title || !eventKey) return false;
  if (priority !== null && !NOTIFICATION_PRIORITIES.has(priority)) {
    console.error(`notifyAccountOnce: unsupported notification priority: ${priority}`);
    return false;
  }
  try {
    const client = supabase || getServiceClient();
    const { data, error } = await client.from('notifications').upsert({
      recipient_id: recipientAuthUserId,
      event_key: String(eventKey),
      category,
      title,
      message,
      related_type: relatedType,
      related_id: relatedId === null ? null : String(relatedId),
      ...(priority ? { priority } : {}),
    }, { onConflict: 'recipient_id,event_key', ignoreDuplicates: true })
      .select('id')
      .maybeSingle();
    if (error) {
      console.error(`notifyAccountOnce: could not write notification: ${error.message}`);
      return false;
    }
    return Boolean(data?.id);
  } catch (err) {
    console.error(`notifyAccountOnce: could not write notification: ${err.message}`);
    return false;
  }
};

/** Send an event to active Health Supervisors assigned to its barangay only. */
export const notifyHealthSupervisorsOnce = async ({
  barangayId,
  municipalityId = null,
  actorId = null,
  category = 'information',
  title,
  message = '',
  relatedType = '',
  relatedId = null,
  eventKey,
  supabase = null,
} = {}) => {
  if (!env.isSupabaseConfigured || !barangayId || !title || !relatedId) return 0;
  try {
    const client = supabase || getServiceClient();
    let query = client.from('profiles')
      .select('id')
      .eq('role', 'health_supervisor')
      .eq('status', 'active')
      .eq('barangay_id', barangayId);
    if (municipalityId) query = query.eq('municipality_id', municipalityId);
    const { data, error } = await query;
    if (error) {
      console.error(`notifyHealthSupervisorsOnce: could not resolve recipients: ${error.message}`);
      return 0;
    }
    const recipients = [...new Set((data || []).map((profile) => profile.id).filter((id) => id && id !== actorId))];
    const results = await Promise.all(recipients.map((recipientAuthUserId) => notifyAccountOnce({
      recipientAuthUserId,
      category,
      title,
      message,
      relatedType,
      relatedId,
      eventKey: eventKey || `${relatedType}:${relatedId}`,
      supabase: client,
    })));
    return results.filter(Boolean).length;
  } catch (err) {
    console.error(`notifyHealthSupervisorsOnce: could not deliver notification: ${err.message}`);
    return 0;
  }
};

/**
 * Idempotent variant of {@link notifyResident}.
 *
 * Creates the notification only when no notification with the same
 * stable source event key already exists for the recipient.
 *
 * A pre-check recognizes older rows using the related record columns. The
 * unique `(recipient_id, event_key)` index is the authoritative concurrency
 * guard. When no dedup key is supplied this falls back to a plain insert.
 *
 * @param {object} params same shape as {@link notifyResident}
 * @returns {Promise<boolean>} true when a new row was written
 */
export const notifyResidentOnce = async (params = {}) => {
  const { recipientAuthUserId, title, relatedType = '', relatedId = null } = params;
  if (!env.isSupabaseConfigured) return false;
  if (!recipientAuthUserId || !title) return false;

  const hasDedupKey =
    relatedType && relatedId !== null && relatedId !== undefined && String(relatedId) !== '';
  // Nothing to dedupe against — behave exactly like notifyResident.
  if (!hasDedupKey) return notifyResident(params);

  const supabase = getServiceClient();
  try {
    const { data: existing, error } = await supabase
      .from('notifications')
      .select('id')
      .eq('recipient_id', recipientAuthUserId)
      .eq('related_type', relatedType)
      .eq('related_id', String(relatedId))
      .limit(1);
    // If the pre-check succeeds and a row already exists, this is a duplicate.
    if (!error && Array.isArray(existing) && existing.length > 0) return false;
    // Otherwise insert. If the pre-check errored, we still attempt the insert;
    // the DB unique index remains the final guard against a true duplicate.
  } catch (err) {
    console.error(`notifyResidentOnce: dedup check failed: ${err.message}`);
    // Fall through to the insert; the unique index guards against duplicates.
  }

  return notifyAccountOnce({
    ...params,
    eventKey: `${relatedType}:${relatedId}`,
    supabase,
  });
};

export default {
  notifyResident,
  notifyResidentOnce,
  notifyAccountOnce,
  notifyHealthSupervisorsOnce,
};
