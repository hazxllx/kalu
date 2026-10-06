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
  VALIDATION: 'validation',
  CONFLICT: 'conflict',
  SERVER: 'server',
  MALFORMED: 'malformed',
  STORAGE: 'storage',
  UNKNOWN: 'unknown',
});

/** Errors that should stop retrying and wait for user action. */
export const TERMINAL_ERRORS = new Set([
  SYNC_ERROR.VALIDATION,
  SYNC_ERROR.CONFLICT,
  SYNC_ERROR.FORBIDDEN,
  SYNC_ERROR.MALFORMED,
]);

/** True when the error is worth retrying with backoff. */
export const isRetryable = (code) =>
  code === SYNC_ERROR.NETWORK || code === SYNC_ERROR.SERVER || code === SYNC_ERROR.UNKNOWN;

/**
 * @param {any} error
 * @returns {import('./errors').SyncErrorInfo}
 */
export const classifySyncError = (error) => {
  const status = Number(error?.status || 0);
  const name = error?.name || '';
  const message = String(error?.message || '');

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
      code: SYNC_ERROR.FORBIDDEN,
      status,
      retryable: false,
      message: message || 'You are not authorized to synchronize this record.',
    };
  }
  if (status === 409) {
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
      message: message || 'The server rejected the change.',
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
 */

export default { SYNC_ERROR, classifySyncError, isRetryable, TERMINAL_ERRORS };
