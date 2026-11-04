/**
 * Error classification for synchronization operations.
 *
 * The sync engine must never confuse a temporary network drop with a rejected
 * authorization or a validation failure: they need different retry behavior and
 * different messages. This module maps a thrown error (from the HTTP client or
 * the offline layer) to one of these stable codes.
 */

export const SYNC_ERROR = Object.freeze({
  NETWORK: 'network',
  AUTH: 'auth',
  FORBIDDEN: 'forbidden',
  PERMISSION_CHANGED: 'permission_changed',
  VALIDATION: 'validation',
  CONFLICT: 'conflict',
  DUPLICATE: 'duplicate',
  SERVER: 'server',
  MALFORMED: 'malformed',
  STORAGE: 'storage',
  UNKNOWN: 'unknown',
});

/** Errors that should stop retrying and wait for user action. */
export const TERMINAL_ERRORS = new Set([
  SYNC_ERROR.VALIDATION,
  SYNC_ERROR.CONFLICT,
  SYNC_ERROR.DUPLICATE,
  SYNC_ERROR.FORBIDDEN,
  SYNC_ERROR.PERMISSION_CHANGED,
  SYNC_ERROR.MALFORMED,
]);

/** True when the error is worth retrying with backoff. */
export const isRetryable = (code) =>
  code === SYNC_ERROR.NETWORK || code === SYNC_ERROR.SERVER || code === SYNC_ERROR.UNKNOWN;

/**
 * True when a user-triggered retry can plausibly succeed without anyone editing
 * the record: transient failures, plus an expired session (retry works after the
 * user signs in again). Validation, duplicate, conflict, permission and malformed
 * failures need a human decision, so no retry action is offered for them.
 *
 * @param {{code?: string, retryable?: boolean} | null | undefined} info
 */
export const isRecoverableFailure = (info) =>
  Boolean(info) && (info.retryable === true || info.code === SYNC_ERROR.AUTH);

const MAX_VALIDATION_MESSAGE = 160;

/** Fixed, record-free wording for outcomes whose server text can carry identifiers. */
export const DUPLICATE_MESSAGE =
  'A matching record already exists on the server. Review it before deciding what to do with this offline record.';
export const STALE_REVISION_MESSAGE =
  'This record was changed on the server after it was saved on this device. Review the newer version before applying your change.';

/** Machine code the backend attaches to a 409 (see backend ApiError.duplicate/staleRevision). */
const serverErrorCode = (error) => {
  const code = error?.payload?.error?.code;
  return typeof code === 'string' ? code : '';
};

/**
 * @param {any} error
 * @returns {import('./errors').SyncErrorInfo}
 */
export const classifySyncError = (error) => {
  const status = Number(error?.status || 0);
  const name = error?.name || '';
  const message = String(error?.message || '');

  // IndexedDB / Dexie storage & migration failures must not be treated as
  // server or network errors; they need a storage-specific retry/message.
  if (/UpgradeError/i.test(name) || /Not yet support for changing primary key/i.test(message)) {
    return { code: SYNC_ERROR.STORAGE, status, retryable: false, message: message || 'Device storage migration failed. Reload to retry.' };
  }
  if (name === 'OpenFailedError' || /VersionError|AbortError/i.test(name)) {
    // Dexie wraps upgrade failures as OpenFailedError; surface as storage.
    if (/Upgrade|primary key|version/i.test(message)) {
      return { code: SYNC_ERROR.STORAGE, status, retryable: false, message: message || 'Device storage error.' };
    }
  }

  if (error?.code === SYNC_ERROR.MALFORMED || name === 'MalformedOperationError') {
    return { code: SYNC_ERROR.MALFORMED, status, retryable: false, message: message || 'The queued change is malformed.' };
  }
  if (error?.code === SYNC_ERROR.STORAGE || name === 'OfflineStorageError') {
    return { code: SYNC_ERROR.STORAGE, status, retryable: false, message: message || 'Device storage error.' };
  }
  if (status === 401) {
    return { code: SYNC_ERROR.AUTH, status, retryable: false, message: 'Your session expired. Sign in again to synchronize.' };
  }
  if (status === 403) {
    return {
      code: SYNC_ERROR.PERMISSION_CHANGED,
      status,
      retryable: false,
      message: 'Sync failed — permission changed',
    };
  }
  if (status === 409) {
    const serverCode = serverErrorCode(error);
    // Duplicate and stale-revision messages from the server can name people or
    // record numbers, so they are replaced with fixed wording before they are
    // stored in the outbox or shown in a notification.
    if (serverCode === 'DUPLICATE_RECORD') {
      return { code: SYNC_ERROR.DUPLICATE, status, retryable: false, message: DUPLICATE_MESSAGE };
    }
    if (serverCode === 'STALE_REVISION') {
      return {
        code: SYNC_ERROR.CONFLICT,
        status,
        retryable: false,
        reason: 'stale_revision',
        message: STALE_REVISION_MESSAGE,
      };
    }
    return {
      code: SYNC_ERROR.CONFLICT,
      status,
      retryable: false,
      message: message || 'This record changed on the server and needs review.',
    };
  }
  if (status === 422 || status === 400) {
    return {
      code: SYNC_ERROR.VALIDATION,
      status,
      retryable: false,
      message: (message || 'The server rejected the change.').slice(0, MAX_VALIDATION_MESSAGE),
    };
  }
  if (status >= 500) {
    return { code: SYNC_ERROR.SERVER, status, retryable: true, message: 'The server is temporarily unavailable.' };
  }
  // No HTTP status: fetch/transport failure (offline, DNS, CORS, abort).
  const isNetwork =
    !status &&
    (/failed to fetch|networkerror|network request failed|load failed|fetch failed|aborted|timeout/i.test(message) ||
      name === 'TypeError' ||
      name === 'AbortError');
  if (isNetwork) {
    return { code: SYNC_ERROR.NETWORK, status: 0, retryable: true, message: 'No connection to the server.' };
  }
  return { code: SYNC_ERROR.UNKNOWN, status, retryable: true, message: message || 'Synchronization failed.' };
};

/**
 * @typedef {Object} SyncErrorInfo
 * @property {string} code
 * @property {number} status
 * @property {boolean} retryable
 * @property {string} message
 * @property {string} [reason]
 */

export default {
  SYNC_ERROR,
  classifySyncError,
  isRetryable,
  isRecoverableFailure,
  TERMINAL_ERRORS,
};
