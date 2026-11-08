import { ALL_ROLES, ROLE } from '../../lib/roles.js';
import { APPROVED_BARANGAYS } from '../../../../shared/barangays.js';
import { PERMISSION_CACHE_TTL_MS, readVerifiedPermissions } from '../accessControl/permissionCache.js';
import { decryptJson, encryptJson } from './crypto.js';
import { assertCurrentOwner, captureOwnerGuard, db, getOfflineOwnerId, openOfflineDb, requireEncryptedPayload, safeWrite } from './db.js';

export const VERIFIED_PROFILE_CACHE_TTL_MS = PERMISSION_CACHE_TTL_MS;
const CACHE_KEY = 'verifiedAuthProfile';
const VERSION = 1;
const nonempty = (value) => typeof value === 'string' && value.trim() === value && value.length > 0 && value.length <= 256;
const optionalText = (value) => value === null || value === undefined || (typeof value === 'string' && value.length <= 256);
const uuid = (value) => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

/** Authorization coverage only, not display/contact fields. Never server RBAC. */
export const verifiedProfileScopeKey = (user) => JSON.stringify([
  user?.role ?? null, user?.status ?? null, user?.municipalityId ?? null,
  user?.barangayId ?? null, user?.barangay ?? null, user?.facilityId ?? null,
  [...(user?.rhuStations || [])].sort(),
]);

const validProfile = (user) => {
  if (!user || !uuid(user.id) || user.status !== 'active' || !ALL_ROLES.includes(user.role) || user.role === ROLE.RESIDENT_LIMITED) return false;
  if (![user.email, user.name, user.barangay, user.municipality, user.facilityId, user.barangayId, user.municipalityId].every(optionalText)) return false;
  if ([user.facilityId, user.barangayId, user.municipalityId].some((id) => id != null && !uuid(id))) return false;
  if (!Array.isArray(user.rhuStations) || user.rhuStations.length > 2 || user.rhuStations.some((station) => !['triage', 'consultation'].includes(station))) return false;
  if (user.role === ROLE.ADMIN) return true;
  if (!nonempty(user.municipalityId)) return false;
  if ([ROLE.MHO, ROLE.PHN].includes(user.role)) return true;
  if (user.role === ROLE.RHU_PERSONNEL) return nonempty(user.facilityId) && user.rhuStations.length > 0;
  if (user.role === ROLE.HEALTH_SUPERVISOR && !user.barangayId) return nonempty(user.facilityId) && user.rhuStations.includes('consultation');
  return uuid(user.barangayId) && APPROVED_BARANGAYS.includes(user.barangay);
};

// Project only fields received from /auth/me. Tokens, metadata roles, account
// secrets and arbitrary server/caller properties never enter the cache.
const minimalProfile = (user) => ({
  id: user.id, email: user.email ?? null, name: user.name ?? user.email ?? '',
  role: user.role, status: user.status,
  assignedBarangay: user.barangay ?? null, barangay: user.barangay ?? null,
  barangayId: user.barangayId ?? null, municipalityId: user.municipalityId ?? null,
  municipality: user.municipality ?? null, facilityId: user.facilityId ?? null,
  rhuStations: [...user.rhuStations],
});

const ownerGuard = (ownerId, isOwnerCurrent) => {
  const guard = captureOwnerGuard(ownerId);
  return () => guard() && getOfflineOwnerId() === ownerId && (!isOwnerCurrent || isOwnerCurrent());
};

const sessionBinding = async (session, now) => {
  if (!nonempty(session?.user?.id) || session.user.is_anonymous === true ||
      typeof session.access_token !== 'string' || !session.access_token ||
      !Number.isInteger(session.expires_at) || session.expires_at * 1000 <= now || !globalThis.crypto?.subtle) return null;
  // Match the exact previously server-verified token, not decoded unsigned JWT
  // claims. A token refresh must be confirmed online before it can be rebound.
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(session.access_token));
  return { sessionKey: Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join(''), sessionExpiresAt: session.expires_at * 1000 };
};

const decode = async (row) => {
  if (row?.value?.enc !== true) return null;
  try {
    const snapshot = await decryptJson(row.value);
    return snapshot?.version === VERSION && snapshot.user?.id === row.ownerId && validProfile(snapshot.user) &&
      snapshot.user.assignedBarangay === (snapshot.user.barangay ?? null) &&
      snapshot.scopeKey === verifiedProfileScopeKey(snapshot.user) ? { ...snapshot, user: minimalProfile(snapshot.user) } : null;
  } catch { return null; }
};

const discard = async (row) => safeWrite(() => db.transaction('rw', db.syncMeta, async () => {
  const current = await db.syncMeta.get(CACHE_KEY);
  if (current?.revision !== row?.revision) return;
  await db.syncMeta.put({ key: CACHE_KEY, ownerId: row?.ownerId ?? null, value: null, revision: (row?.revision || 0) + 1, updatedAt: Date.now() });
}));

/** A single encrypted device-current snapshot; CAS prevents late resurrection. */
export const cacheServerVerifiedProfile = async ({ user, session, isOwnerCurrent, now = Date.now() }) => {
  if (!validProfile(user) || user.id !== session?.user?.id) return null;
  const guard = ownerGuard(user.id, isOwnerCurrent);
  assertCurrentOwner(guard);
  await openOfflineDb();
  const before = await db.syncMeta.get(CACHE_KEY);
  const binding = await sessionBinding(session, now);
  if (!binding) return null;
  assertCurrentOwner(guard);
  const snapshot = {
    version: VERSION, user: minimalProfile(user), scopeKey: verifiedProfileScopeKey(user),
    ...binding, verifiedAt: now,
    expiresAt: Math.min(now + VERIFIED_PROFILE_CACHE_TTL_MS, binding.sessionExpiresAt),
  };
  const encrypted = requireEncryptedPayload(await encryptJson(snapshot));
  assertCurrentOwner(guard);
  const written = await safeWrite(() => db.transaction('rw', db.syncMeta, async () => {
    assertCurrentOwner(guard);
    const current = await db.syncMeta.get(CACHE_KEY);
    if ((current?.revision || 0) !== (before?.revision || 0)) return false;
    await db.syncMeta.put({ key: CACHE_KEY, ownerId: user.id, value: encrypted, revision: (current?.revision || 0) + 1, updatedAt: now });
    assertCurrentOwner(guard);
    return true;
  }));
  return written ? snapshot : null;
};

/** For invalidating known old coverage, never for admitting protected pages. */
export const readStoredVerifiedProfileScope = async (ownerId) => {
  await openOfflineDb();
  const row = await db.syncMeta.get(CACHE_KEY);
  if (row?.ownerId !== ownerId) return null;
  return (await decode(row))?.scopeKey ?? null;
};

/** Only restored live Auth sessions with matching verified permissions qualify. */
export const readServerVerifiedProfile = async ({ session, isOwnerCurrent, now = Date.now() }) => {
  const ownerId = session?.user?.id;
  if (!nonempty(ownerId)) return null;
  const guard = ownerGuard(ownerId, isOwnerCurrent);
  assertCurrentOwner(guard);
  await openOfflineDb();
  const row = await db.syncMeta.get(CACHE_KEY);
  if (!row?.value || row.ownerId !== ownerId) return null;
  const binding = await sessionBinding(session, now);
  const snapshot = await decode(row);
  assertCurrentOwner(guard);
  if (!binding || !snapshot || snapshot.sessionKey !== binding.sessionKey ||
      snapshot.sessionExpiresAt !== binding.sessionExpiresAt ||
      !Number.isFinite(snapshot.verifiedAt) || snapshot.verifiedAt > now ||
      !Number.isFinite(snapshot.expiresAt) ||
      snapshot.expiresAt !== Math.min(snapshot.verifiedAt + VERIFIED_PROFILE_CACHE_TTL_MS, binding.sessionExpiresAt) ||
      snapshot.expiresAt <= now) {
    await discard(row);
    return null;
  }
  // Preserve the permission-cache API/architecture, additionally excluding its
  // legacy plaintext envelopes before any cached profile can admit this owner.
  const permissionRow = await db.syncMeta.get(`verifiedPermissions:${ownerId}`);
  if (permissionRow?.value?.enc !== true) return null;
  const permissions = await readVerifiedPermissions({ userId: ownerId, role: snapshot.user.role, now });
  assertCurrentOwner(guard);
  if (!permissions?.matrix?.[snapshot.user.role]) return null;
  const current = await db.syncMeta.get(CACHE_KEY);
  assertCurrentOwner(guard);
  if (current?.revision !== row.revision || current?.value?.enc !== true) return null;
  return { ...snapshot, expiresAt: Math.min(snapshot.expiresAt, permissions.expiresAt), source: 'cache' };
};

/** Tombstones fence already-started writes without deleting pending work. */
export const invalidateServerVerifiedProfile = async (ownerId = null, { keepOwnerId = null } = {}) => {
  await openOfflineDb();
  return safeWrite(() => db.transaction('rw', db.syncMeta, async () => {
    const current = await db.syncMeta.get(CACHE_KEY);
    if (keepOwnerId && current?.ownerId === keepOwnerId) return null;
    if (ownerId && current?.ownerId && current.ownerId !== ownerId) return null;
    await db.syncMeta.put({ key: CACHE_KEY, ownerId: current?.ownerId ?? ownerId, value: null, revision: (current?.revision || 0) + 1, updatedAt: Date.now() });
    return current?.ownerId ?? ownerId;
  }));
};
