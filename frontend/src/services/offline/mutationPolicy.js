// frontend/src/services/offline/mutationPolicy.js
/**
 * Offline mutation policy — determines which write operations can be queued
 * for sync and which require immediate online connectivity.
 *
 * MUTATION_TIER classifications:
 *   SAFE_SYNC       — can be queued offline and synchronized when online
 *                     (household updates, resident demographics, etc.)
 *   OFFLINE_DRAFT   — can be created offline as a draft but NOT automatically
 *                     synced; requires explicit user action to submit
 *                     (consultation/referral creation, registration)
 *   ONLINE_ONLY     — must happen online; throws immediately if offline
 *                     (account approval, permission changes, critical ops)
 *
 * Each operation's tier is declared in the mutation (e.g., api.post(...,
 * { offlineMutationType: MUTATION_TIER.SAFE_SYNC })). The apiClient enforces
 * it by checking the browser's online status and the operation's tier, then
 * either queuing or rejecting the operation.
 *
 * BHW household updates are SAFE_SYNC — only the allowed demographic fields
 * can be updated (see SAFE_HOUSEHOLD_UPDATE_FIELDS); any other field triggers
 * a validation error server-side so a malicious/buggy client cannot bypass
 * permission checks.
 */

/**
 * Offline mutation operation classification.
 * @enum {string}
 */
export const MUTATION_TIER = Object.freeze({
  /**
   * Can be queued offline and automatically synced when the device reconnects.
   * Used for safe demographic/data-entry operations (household updates,
   * resident registration, etc.) where offline queuing improves UX and does
   * not compromise data integrity.
   */
  SAFE_SYNC: 'SAFE_SYNC',
  
  /**
   * Can be created offline as a draft but NOT automatically synced. The user
   * must explicitly choose to submit. Used for significant operations
   * (consultation, referral creation) where auto-sync could be unexpected.
   */
  OFFLINE_DRAFT: 'OFFLINE_DRAFT',
  
  /**
   * Must happen online immediately. Throws an error if the browser is offline.
   * Used for operations that require immediate server verification or carry
   * security implications (account approval, permission changes).
   */
  ONLINE_ONLY: 'ONLINE_ONLY',
});

export const OFFLINE_ACTION_REQUIRED_MESSAGE = 'This action requires an internet connection.';

/**
 * Error thrown when an operation requires online connectivity but the browser
 * is offline. Caught by the UI to show a user-friendly message.
 */
export class OfflineActionRequiredError extends Error {
  constructor() {
    super(OFFLINE_ACTION_REQUIRED_MESSAGE);
    this.name = 'OfflineActionRequiredError';
    this.code = MUTATION_TIER.ONLINE_ONLY;
  }
}

/**
 * Check if a string is a known mutation tier.
 * @param {*} tier
 * @returns {boolean}
 */
export const isKnownMutationTier = (tier) => Object.values(MUTATION_TIER).includes(tier);

/**
 * Assert that a mutation can be queued offline (not ONLINE_ONLY).
 * Throws OfflineActionRequiredError if the tier is ONLINE_ONLY.
 *
 * Used by the sync engine to filter which queued operations are safe to retry.
 * ONLINE_ONLY operations never enter the queue in the first place.
 *
 * @param {'SAFE_SYNC' | 'OFFLINE_DRAFT' | 'ONLINE_ONLY'} [tier]
 * @throws {TypeError} if tier is not a known value
 * @throws {OfflineActionRequiredError} if tier is ONLINE_ONLY
 */
export const assertQueueableMutation = (tier = MUTATION_TIER.ONLINE_ONLY) => {
  if (!isKnownMutationTier(tier)) {
    throw new TypeError(`Unknown offline mutation tier: ${tier}`);
  }
  if (tier === MUTATION_TIER.ONLINE_ONLY) {
    throw new OfflineActionRequiredError();
  }
};

/**
 * Check if the browser is currently offline.
 * @returns {boolean}
 */
export const isBrowserOffline = () =>
  typeof navigator !== 'undefined' && navigator.onLine === false;

/**
 * Require online connectivity for a mutation. If the browser is offline and
 * the tier is ONLINE_ONLY, throw immediately.
 *
 * Called by the apiClient for every mutation to enforce the tier policy.
 *
 * @param {'SAFE_SYNC' | 'OFFLINE_DRAFT' | 'ONLINE_ONLY'} [tier]
 * @throws {OfflineActionRequiredError} if browser is offline and tier is ONLINE_ONLY
 */
export const requireOnlineForMutation = (tier = MUTATION_TIER.ONLINE_ONLY) => {
  if (isBrowserOffline() && tier === MUTATION_TIER.ONLINE_ONLY) {
    throw new OfflineActionRequiredError();
  }
};

/**
 * Whitelist of household fields that are safe for BHW (Barangay Health Worker)
 * to update offline. Any other field in a household update is rejected
 * server-side as a validation error.
 *
 * This list enforces the permission boundary: BHW can edit demographics and
 * health-related data but NOT sensitive fields like status, verification state,
 * or risk scores (which only supervisors/admins can set).
 *
 * The server duplicates this check (authorization + field validation) so
 * a malicious/buggy client cannot bypass permissions.
 */
export const SAFE_HOUSEHOLD_UPDATE_FIELDS = Object.freeze([
  'headName',
  'purok',
  'streetAddress',
  'contact',
  'families',
  'hhStatus',
  'monthlyIncome',
  'respondentLast',
  'respondentFirst',
  'respondentMaiden',
  'nhts',
  'ip',
  'philhealthMember',
  'philhealthId',
  'philhealthCategory',
  'waterSource',
  'waterType',
  'waterDistance',
  'waterAvailability',
  'waterTreated',
  'treatmentMethods',
  'toiletType',
  'sanitationAccess',
  'wasteDisposal',
  'wasteSegregation',
  'quarterVisits',
  'latitude',
  'longitude',
]);

/**
 * Validate that a household update payload contains only safe fields.
 *
 * Returns true if the payload contains only fields from SAFE_HOUSEHOLD_UPDATE_FIELDS.
 * Used by offline draft/queueing logic to reject unsafe updates before syncing.
 * The server performs its own validation.
 *
 * @param {Object} [payload]
 * @returns {boolean}
 */
export const isSafeHouseholdUpdate = (payload = {}) => {
  const household = payload?.household && typeof payload.household === 'object'
    ? payload.household
    : payload;
  return Boolean(
    household &&
      typeof household === 'object' &&
      Object.keys(household).length > 0 &&
      Object.keys(household).every((field) => SAFE_HOUSEHOLD_UPDATE_FIELDS.includes(field)),
  );
};

export default {
  MUTATION_TIER,
  OFFLINE_ACTION_REQUIRED_MESSAGE,
  OfflineActionRequiredError,
  isKnownMutationTier,
  assertQueueableMutation,
  isBrowserOffline,
  requireOnlineForMutation,
  SAFE_HOUSEHOLD_UPDATE_FIELDS,
  isSafeHouseholdUpdate,
};
