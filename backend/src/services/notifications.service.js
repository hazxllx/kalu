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

export default { notifyResident };
