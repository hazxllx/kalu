export const mergePendingHouseholdUpdates = (household, operations) =>
  operations.reduce((current, operation) => {
    if (
      operation.entity !== 'household' ||
      operation.opType !== 'update' ||
      String(operation.targetServerId || operation.serverId) !== String(current.id) ||
      operation.status === 'synced' ||
      !operation.payload ||
      typeof operation.payload !== 'object'
    ) return current;
    return {
      ...current,
      ...operation.payload,
      offline: true,
      syncStatus: operation.status === 'failed'
        ? operation.lastError?.code === 'permission_changed'
          ? 'Sync failed — permission changed'
          : 'Sync failed — review required'
        : 'Pending Sync',
    };
  }, household);

export default { mergePendingHouseholdUpdates };
