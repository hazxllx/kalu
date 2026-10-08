export const MUTATION_TIER = Object.freeze({
  SAFE_SYNC: 'SAFE_SYNC',
  OFFLINE_DRAFT: 'OFFLINE_DRAFT',
  ONLINE_ONLY: 'ONLINE_ONLY',
});

export const OFFLINE_ACTION_REQUIRED_MESSAGE = 'This action requires an internet connection.';

export class OfflineActionRequiredError extends Error {
  constructor() {
    super(OFFLINE_ACTION_REQUIRED_MESSAGE);
    this.name = 'OfflineActionRequiredError';
    this.code = MUTATION_TIER.ONLINE_ONLY;
  }
}

export const isKnownMutationTier = (tier) => Object.values(MUTATION_TIER).includes(tier);

export const assertQueueableMutation = (tier = MUTATION_TIER.ONLINE_ONLY) => {
  if (!isKnownMutationTier(tier)) {
    throw new TypeError(`Unknown offline mutation tier: ${tier}`);
  }
  if (tier === MUTATION_TIER.ONLINE_ONLY) {
    throw new OfflineActionRequiredError();
  }
};

export const isBrowserOffline = () =>
  typeof navigator !== 'undefined' && navigator.onLine === false;

export const requireOnlineForMutation = (tier = MUTATION_TIER.ONLINE_ONLY) => {
  if (isBrowserOffline() && tier === MUTATION_TIER.ONLINE_ONLY) {
    throw new OfflineActionRequiredError();
  }
};

export const SAFE_HOUSEHOLD_UPDATE_FIELDS = Object.freeze([
  'headName',
  'purok',
  'streetAddress',
  'contact',
  'families',
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
