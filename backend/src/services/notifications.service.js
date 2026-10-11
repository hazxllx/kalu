/**
 * Resident notification helper (server side).
 *
 * A single place that writes rows to the `notifications` table so every
 * Health Supervisor action that should reach a resident (verification
 * decisions, household verification, follow-up changes, ...) creates the
 * notification the same way.
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

/**
 * Create a notification for a resident.
 *
 * @param {object} params
 * @param {string} params.recipientAuthUserId  auth.users id of the resident
 * @param {string} [params.category]           'information' | 'reminder' | 'alert'
 * @param {string} params.title
 * @param {string} [params.message]
 * @param {string} [params.relatedType]
 * @param {string} [params.relatedId]
 * @returns {Promise<boolean>} true when a row was written
 */
export const notifyResident = async ({
  recipientAuthUserId,
  category = 'information',
  title,
  message = '',
  relatedType = '',
  relatedId = null,
}) => {
  if (!env.isSupabaseConfigured) return false;
  if (!recipientAuthUserId || !title) return false;
  try {
    const supabase = getServiceClient();
    const { error } = await supabase.from('notifications').insert({
      recipient_id: recipientAuthUserId,
      category,
      title,
      message,
      related_type: relatedType,
      related_id: relatedId,
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
 * Idempotent variant of {@link notifyResident}.
 *
 * Creates the notification only when no notification with the same
 * (recipient_id, related_type, related_id) already exists. This makes
 * event-driven notifications safe against retries, repeated save requests and
 * page refreshes: a given source record (identified by `relatedType` +
 * `relatedId`) produces at most one notification per recipient.
 *
 * The pre-check avoids the common sequential duplicate; a matching partial
 * unique index on the `notifications` table is the authoritative guard for the
 * rare concurrent race (a duplicate insert then fails harmlessly and is
 * swallowed by {@link notifyResident}). When no dedup key is supplied this
 * falls back to a plain insert. Best-effort, like {@link notifyResident}.
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

  try {
    const supabase = getServiceClient();
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

  return notifyResident(params);
};

export default { notifyResident, notifyResidentOnce };
