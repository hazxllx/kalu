/**
 * AI Provider Error Classification
 * 
 * Classifies provider errors into distinct categories:
 * - PROVIDER_CAPACITY: 503 Service Unavailable (retryable with backoff)
 * - RATE_LIMIT: 429 Too Many Requests (retryable with Retry-After)
 * - INSUFFICIENT_BALANCE: Payment/quota exhausted (non-retryable)
 * - INVALID_REQUEST: 4xx validation errors (non-retryable)
 * - AUTHENTICATION: Invalid API key/token (non-retryable)
 * - PERMISSION: Access denied / model not available (non-retryable)
 * - NETWORK: Connection failure (retryable)
 * - UNKNOWN: Unclassified error (retryable with caution)
 */

export const PROVIDER_ERROR_TYPE = Object.freeze({
  PROVIDER_CAPACITY: 'provider_capacity',
  RATE_LIMIT: 'rate_limit',
  INSUFFICIENT_BALANCE: 'insufficient_balance',
  INVALID_REQUEST: 'invalid_request',
  AUTHENTICATION: 'authentication',
  PERMISSION: 'permission',
  NETWORK: 'network',
  TIMEOUT: 'timeout',
  UNKNOWN: 'unknown',
});

export const PROVIDER_ERROR_CATEGORY = Object.freeze({
  RETRYABLE: 'retryable',
  TERMINAL: 'terminal',
  FALLBACK_ELIGIBLE: 'fallback_eligible',
});

/**
 * Classify an AI provider error response
 * 
 * @param {Error} error - The error object
 * @param {number} statusCode - HTTP status code (if available)
 * @param {object} responseBody - Parsed response body
 * @returns {object} Classification with type, category, retryable flag, and user message
 */
export const classifyProviderError = (error, statusCode = 0, responseBody = {}) => {
  // Network/connectivity errors
  if (!statusCode || statusCode === 0) {
    const message = String(error?.message || '').toLowerCase();
    const code = error?.code;

    const networkCodes = [
      'ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED', 'ECONNRESET',
      'ETIMEDOUT', 'ENETUNREACH', 'EHOSTUNREACH', 'EPROTO',
    ];

    const isNetwork = networkCodes.includes(code) ||
      /failed to fetch|network|timeout|connection refused|no such host|getaddrinfo/i.test(message) ||
      error?.name === 'AbortError';

    if (isNetwork) {
      return {
        type: PROVIDER_ERROR_TYPE.NETWORK,
        category: PROVIDER_ERROR_CATEGORY.RETRYABLE,
        retryable: true,
        userMessage: 'Connection to AI provider temporarily unavailable. Please try again.',
        details: { code, message },
      };
    }

    if (/timeout/.test(message)) {
      return {
        type: PROVIDER_ERROR_TYPE.TIMEOUT,
        category: PROVIDER_ERROR_CATEGORY.RETRYABLE,
        retryable: true,
        userMessage: 'Request to AI provider timed out. Please try again.',
        details: { message },
      };
    }
  }

  // 503 Service Unavailable / Provider Capacity
  if (statusCode === 503) {
    return {
      type: PROVIDER_ERROR_TYPE.PROVIDER_CAPACITY,
      category: PROVIDER_ERROR_CATEGORY.RETRYABLE,
      retryable: true,
      fallbackEligible: true,
      userMessage: 'AI service temporarily at capacity. Please try again shortly.',
      details: {
        statusCode,
        message: responseBody?.error?.message || 'Service temporarily unavailable',
      },
    };
  }

  // 429 Too Many Requests / Rate Limit
  if (statusCode === 429) {
    const retryAfter = responseBody?.error?.retry_after ||
      responseBody?.error?.retryAfter ||
      responseBody?.retryAfter ||
      60; // Default 60 seconds if not specified

    return {
      type: PROVIDER_ERROR_TYPE.RATE_LIMIT,
      category: PROVIDER_ERROR_CATEGORY.RETRYABLE,
      retryable: true,
      fallbackEligible: true,
      retryAfterSeconds: Number(retryAfter) || 60,
      userMessage: 'Rate limit exceeded. Please wait a moment and try again.',
      details: {
        statusCode,
        retryAfter,
        message: responseBody?.error?.message || 'Too many requests',
      },
    };
  }

  // 401 Unauthorized / Authentication failure
  if (statusCode === 401) {
    return {
      type: PROVIDER_ERROR_TYPE.AUTHENTICATION,
      category: PROVIDER_ERROR_CATEGORY.TERMINAL,
      retryable: false,
      userMessage: 'AI provider authentication failed. Please verify API configuration.',
      details: {
        statusCode,
        message: responseBody?.error?.message || 'Unauthorized',
      },
    };
  }

  // 403 Forbidden / Permission denied
  if (statusCode === 403) {
    return {
      type: PROVIDER_ERROR_TYPE.PERMISSION,
      category: PROVIDER_ERROR_CATEGORY.TERMINAL,
      retryable: false,
      userMessage: 'Access to requested AI model denied. Please verify model availability.',
      details: {
        statusCode,
        message: responseBody?.error?.message || 'Forbidden',
      },
    };
  }

  // 402 Payment Required / Insufficient balance
  if (statusCode === 402) {
    return {
      type: PROVIDER_ERROR_TYPE.INSUFFICIENT_BALANCE,
      category: PROVIDER_ERROR_CATEGORY.TERMINAL,
      retryable: false,
      userMessage: 'Insufficient balance with AI provider. Please check account.',
      details: {
        statusCode,
        message: responseBody?.error?.message || 'Insufficient balance',
      },
    };
  }

  // 400 Bad Request / Invalid request
  if (statusCode === 400) {
    return {
      type: PROVIDER_ERROR_TYPE.INVALID_REQUEST,
      category: PROVIDER_ERROR_CATEGORY.TERMINAL,
      retryable: false,
      userMessage: 'Invalid request to AI provider. Please check your input.',
      details: {
        statusCode,
        message: responseBody?.error?.message || 'Bad request',
      },
    };
  }

  // Other 4xx errors
  if (statusCode >= 400 && statusCode < 500) {
    return {
      type: PROVIDER_ERROR_TYPE.INVALID_REQUEST,
      category: PROVIDER_ERROR_CATEGORY.TERMINAL,
      retryable: false,
      userMessage: 'Invalid request to AI provider.',
      details: {
        statusCode,
        message: responseBody?.error?.message || 'Client error',
      },
    };
  }

  // Other 5xx errors (server errors)
  if (statusCode >= 500) {
    return {
      type: PROVIDER_ERROR_TYPE.UNKNOWN,
      category: PROVIDER_ERROR_CATEGORY.RETRYABLE,
      retryable: true,
      fallbackEligible: true,
      userMessage: 'AI provider encountered an error. Please try again.',
      details: {
        statusCode,
        message: responseBody?.error?.message || 'Server error',
      },
    };
  }

  // Unknown error
  return {
    type: PROVIDER_ERROR_TYPE.UNKNOWN,
    category: PROVIDER_ERROR_CATEGORY.RETRYABLE,
    retryable: true,
    userMessage: 'An unexpected error occurred with AI provider. Please try again.',
    details: {
      statusCode,
      message: String(error?.message || 'Unknown error'),
    },
  };
};

/**
 * Check if error is retryable
 */
export const isRetryable = (classification) => {
  return classification?.retryable === true;
};

/**
 * Check if error is eligible for provider fallback
 */
export const isFallbackEligible = (classification) => {
  return classification?.fallbackEligible === true;
};
