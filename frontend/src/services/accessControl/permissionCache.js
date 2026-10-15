import { decryptJson, encryptJson } from '../offline/crypto.js';
import { db, safeWrite } from '../offline/db.js';

export const PERMISSION_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const CACHE_VERSION = 1;
const cacheKey = (userId) => `verifiedPermissions:${userId}`;

const isPermissionMatrix = (matrix) =>
  Boolean(
    matrix &&
      typeof matrix === 'object' &&
      !Array.isArray(matrix) &&
      Object.values(matrix).every(
        (permissions) =>
          permissions &&
          typeof permissions === 'object' &&
          !Array.isArray(permissions) &&
          Object.values(permissions).every((granted) => typeof granted === 'boolean'),
      ),
  );

export const cacheVerifiedPermissions = async ({ userId, role, matrix, now = Date.now() }) => {
  if (!userId || !role || !isPermissionMatrix(matrix)) {
    throw new TypeError('Only a valid server-verified permission matrix can be cached.');
  }
  const snapshot = {
    version: CACHE_VERSION,
    userId,
    role,
    matrix,
    verifiedAt: now,
    expiresAt: now + PERMISSION_CACHE_TTL_MS,
  };
  const encrypted = await encryptJson(snapshot);
  await safeWrite(() =>
    db.syncMeta.put({
      key: cacheKey(userId),
      value: encrypted,
      updatedAt: now,
    }),
  );
  return snapshot;
};

export const readVerifiedPermissions = async ({ userId, role, now = Date.now() }) => {
  if (!userId || !role) return null;
  const key = cacheKey(userId);
  const row = await db.syncMeta.get(key);
  if (!row) return null;

  let snapshot;
  try {
    snapshot = await decryptJson(row.value);
  } catch (error) {
    console.warn('[kalusagap/permissions] Discarding unreadable cached permissions.', error);
    await safeWrite(() => db.syncMeta.delete(key));
    return null;
  }

  const valid =
    snapshot?.version === CACHE_VERSION &&
    snapshot.userId === userId &&
    snapshot.role === role &&
    isPermissionMatrix(snapshot.matrix) &&
    Number.isFinite(snapshot.verifiedAt) &&
    Number.isFinite(snapshot.expiresAt) &&
    snapshot.verifiedAt <= now &&
    snapshot.expiresAt === snapshot.verifiedAt + PERMISSION_CACHE_TTL_MS &&
    now < snapshot.expiresAt;

  if (!valid) {
    await safeWrite(() => db.syncMeta.delete(key));
    return null;
  }
  return snapshot;
};

export const invalidateVerifiedPermissions = async (userId) => {
  if (!userId) return;
  await safeWrite(() => db.syncMeta.delete(cacheKey(userId)));
};

export const invalidateAllVerifiedPermissions = async () => {
  const rows = await db.syncMeta.toCollection().filter((row) =>
    typeof row.key === 'string' && row.key.startsWith('verifiedPermissions:'),
  ).primaryKeys();
  if (rows.length) await safeWrite(() => db.syncMeta.bulkDelete(rows));
};

export default {
  PERMISSION_CACHE_TTL_MS,
  cacheVerifiedPermissions,
  readVerifiedPermissions,
  invalidateVerifiedPermissions,
  invalidateAllVerifiedPermissions,
};
