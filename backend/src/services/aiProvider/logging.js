/**
 * Secure Logging for AI Provider Operations
 * 
 * Logs provider, HTTP status, request ID, retry count, and timestamp
 * WITHOUT exposing API keys, tokens, or sensitive request data.
 */

export const LOG_LEVEL = Object.freeze({
  DEBUG: 'debug',
  INFO: 'info',
  WARN: 'warn',
  ERROR: 'error',
});

/**
 * Sanitize data for logging - removes sensitive fields
 * 
 * @param {object} data - Data to sanitize
 * @returns {object} Sanitized copy
 */
const sanitizeData = (data) => {
  if (!data || typeof data !== 'object') return data;

  const sanitized = {};
  const sensitiveFields = [
    'apiKey', 'api_key', 'token', 'accessToken', 'access_token',
    'refreshToken', 'refresh_token', 'secret', 'password', 'Authorization',
    'authorization', 'x-api-key', 'authorization-key',
  ];

  for (const [key, value] of Object.entries(data)) {
    if (sensitiveFields.includes(key)) {
      sanitized[key] = '[REDACTED]';
    } else if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      sanitized[key] = sanitizeData(value);
    } else if (Array.isArray(value)) {
      sanitized[key] = value.map((item) =>
        typeof item === 'object' ? sanitizeData(item) : item
      );
    } else {
      sanitized[key] = value;
    }
  }

  return sanitized;
};

/**
 * Logger instance for AI provider operations
 */
export class ProviderLogger {
  constructor(name = 'ai-provider', minLevel = LOG_LEVEL.INFO, logFn = console.log) {
    this.name = name;
    this.minLevel = minLevel;
    this.logFn = logFn;
    this.levelOrder = [LOG_LEVEL.DEBUG, LOG_LEVEL.INFO, LOG_LEVEL.WARN, LOG_LEVEL.ERROR];
  }

  /**
   * Check if level should be logged
   */
  isEnabled(level) {
    return this.levelOrder.indexOf(level) >= this.levelOrder.indexOf(this.minLevel);
  }

  /**
   * Format and log message with sanitized context
   */
  log(level, message, context = {}) {
    if (!this.isEnabled(level)) return;

    const sanitized = sanitizeData(context);
    const entry = {
      timestamp: new Date().toISOString(),
      level,
      logger: this.name,
      message,
      ...sanitized,
    };

    this.logFn(JSON.stringify(entry));
  }

  debug(message, context) {
    this.log(LOG_LEVEL.DEBUG, message, context);
  }

  info(message, context) {
    this.log(LOG_LEVEL.INFO, message, context);
  }

  warn(message, context) {
    this.log(LOG_LEVEL.WARN, message, context);
  }

  error(message, context) {
    this.log(LOG_LEVEL.ERROR, message, context);
  }
}

/**
 * Create structured log entry for provider request
 * 
 * @param {object} options - Log options
 * @returns {object} Structured log entry
 */
export const createProviderRequestLog = ({
  provider,
  requestId,
  model,
  action = 'request',
  statusCode,
  errorType,
  attemptNumber,
  totalAttempts,
  responseTimeMs,
  retryAfterSeconds,
} = {}) => {
  return {
    event: 'ai_provider_request',
    provider,
    requestId,
    model,
    action,
    statusCode,
    errorType,
    attemptNumber,
    totalAttempts,
    responseTimeMs,
    retryAfterSeconds,
    timestamp: new Date().toISOString(),
  };
};

/**
 * Create structured log entry for retry attempt
 * 
 * @param {object} options - Log options
 * @returns {object} Structured log entry
 */
export const createRetryLog = ({
  provider,
  requestId,
  model,
  attemptNumber,
  totalAttempts,
  errorType,
  delayMs,
  elapsedMs,
  reason,
} = {}) => {
  return {
    event: 'ai_provider_retry',
    provider,
    requestId,
    model,
    attemptNumber,
    totalAttempts,
    errorType,
    delayMs,
    elapsedMs,
    reason,
    timestamp: new Date().toISOString(),
  };
};

/**
 * Create structured log entry for retry exhaustion
 * 
 * @param {object} options - Log options
 * @returns {object} Structured log entry
 */
export const createRetryExhaustedLog = ({
  provider,
  requestId,
  model,
  totalAttempts,
  totalElapsedMs,
  finalErrorType,
  finalUserMessage,
} = {}) => {
  return {
    event: 'ai_provider_retries_exhausted',
    provider,
    requestId,
    model,
    totalAttempts,
    totalElapsedMs,
    finalErrorType,
    finalUserMessage,
    timestamp: new Date().toISOString(),
  };
};

/**
 * Create structured log entry for fallback to alternative provider
 * 
 * @param {object} options - Log options
 * @returns {object} Structured log entry
 */
export const createFallbackLog = ({
  provider,
  fallbackProvider,
  requestId,
  model,
  reason,
  errorType,
} = {}) => {
  return {
    event: 'ai_provider_fallback',
    provider,
    fallbackProvider,
    requestId,
    model,
    reason,
    errorType,
    timestamp: new Date().toISOString(),
  };
};
