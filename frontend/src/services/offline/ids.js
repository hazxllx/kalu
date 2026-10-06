/**
 * Stable local identifiers for offline records and synchronization operations.
 *
 * A locally created record is assigned a stable `localId` that never changes
 * when the server later allocates its authoritative id. Each queued write gets a
 * unique `opId`; the operation id doubles as the idempotency key sent to the
 * backend, so replaying an interrupted upload cannot create a duplicate.
 */

const randomUuid = () => {
  const cryptoObj = typeof globalThis !== 'undefined' ? globalThis.crypto : undefined;
  if (cryptoObj && typeof cryptoObj.randomUUID === 'function') {
    return cryptoObj.randomUUID();
  }
  // RFC 4122 v4 fallback for environments without crypto.randomUUID.
  const bytes = new Uint8Array(16);
  if (cryptoObj && typeof cryptoObj.getRandomValues === 'function') {
    cryptoObj.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0'));
  return `${hex.slice(0, 4).join('')}-${hex.slice(4, 6).join('')}-${hex
    .slice(6, 8)
    .join('')}-${hex.slice(8, 10).join('')}-${hex.slice(10, 16).join('')}`;
};

/** A globally unique id (operation ids, local record ids, cache keys). */
export const newId = () => randomUuid();

/** A short, human-recognizable local draft reference (display only). */
export const newLocalRef = (prefix = 'LOCAL') =>
  `${prefix}-${Date.now().toString(36).toUpperCase()}-${Math.random()
    .toString(36)
    .slice(2, 6)
    .toUpperCase()}`;

/** The idempotency key for an operation id. Scoped server-side by user id. */
export const idempotencyKeyFor = (opId) => `kalusagap-op-${opId}`;

export default { newId, newLocalRef, idempotencyKeyFor };
