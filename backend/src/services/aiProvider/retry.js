/**
 * Retry and Backoff Utilities
 * 
 * Implements exponential backoff with symmetric jitter to prevent thundering herd
 * and respect Retry-After headers from provider responses.
 */

/**
 * Compute exponential backoff delay with symmetric jitter
 * 
 * Formula: backoff = min(maxMs, baseMs * 2^(attempts-1))
 *          jitter = backoff * jitterRatio * (random() * 2 - 1)
 *          delay = max(0, backoff + jitter)
 * 
 * This creates a realistic exponential progression with randomness to prevent
 * multiple clients from retrying at exactly the same time.
 * 
 * @param {number} attemptNumber - Current attempt (1-indexed)
 * @param {object} options - Configuration
 * @param {number} options.baseMs - Base delay in milliseconds (default 1000)
 * @param {number} options.maxMs - Maximum delay cap in milliseconds (default 60000)
 * @param {number} options.jitterRatio - Jitter amplitude as ratio of backoff (default 0.25)
 * @param {Function} options.random - Random number generator 0..1 (default Math.random)
 * @returns {number} Delay in milliseconds
 */
export const computeBackoffMs = (
  attemptNumber,
  {
    baseMs = 1000,
    maxMs = 60_000,
    jitterRatio = 0.25,
    random = Math.random,
  } = {},
) => {
  if (attemptNumber < 1) return 0;

  // Exponential progression: 1s, 2s, 4s, 8s, 16s, ..., capped at maxMs
  const exponentialMs = Math.min(maxMs, baseMs * (2 ** (attemptNumber - 1)));

  // Symmetric jitter: ±(exponentialMs * jitterRatio)
  const jitterMs = exponentialMs * jitterRatio * (random() * 2 - 1);

  return Math.max(0, Math.round(exponentialMs + jitterMs));
};

/**
 * Retry configuration builder
 */
export class RetryConfig {
  constructor({
    maxAttempts = 5,
    baseDelayMs = 1000,
    maxDelayMs = 60_000,
    jitterRatio = 0.25,
    respectRetryAfter = true,
  } = {}) {
    this.maxAttempts = Math.max(1, Math.min(maxAttempts, 10)); // Clamp 1-10
    this.baseDelayMs = Math.max(100, baseDelayMs);
    this.maxDelayMs = Math.max(this.baseDelayMs, maxDelayMs);
    this.jitterRatio = Math.max(0, Math.min(jitterRatio, 1));
    this.respectRetryAfter = respectRetryAfter;
  }

  /**
   * Compute delay before next retry attempt
   * 
   * @param {number} attemptNumber - Attempt number (1-indexed)
   * @param {object} errorClassification - From classifyProviderError()
   * @returns {number} Delay in milliseconds
   */
  getDelayMs(attemptNumber, errorClassification) {
    // Respect Retry-After header if present
    if (
      this.respectRetryAfter &&
      errorClassification?.retryAfterSeconds &&
      typeof errorClassification.retryAfterSeconds === 'number'
    ) {
      return errorClassification.retryAfterSeconds * 1000;
    }

    return computeBackoffMs(attemptNumber, {
      baseMs: this.baseDelayMs,
      maxMs: this.maxDelayMs,
      jitterRatio: this.jitterRatio,
    });
  }

  /**
   * Check if another attempt should be made
   * 
   * @param {number} attemptNumber - Current attempt number (1-indexed)
   * @param {object} errorClassification - From classifyProviderError()
   * @returns {boolean} True if retry is allowed
   */
  canRetry(attemptNumber, errorClassification) {
    return (
      attemptNumber < this.maxAttempts &&
      errorClassification?.retryable === true
    );
  }
}

/**
 * Retry request with exponential backoff and jitter
 * 
 * @param {Function} executeRequest - Async function that makes the request
 * @param {Function} classifyError - Function to classify errors
 * @param {RetryConfig} config - Retry configuration
 * @param {object} context - Context for logging (provider, requestId, etc)
 * @returns {Promise} Result of successful request
 * @throws {Error} Final error if all retries exhausted or error is terminal
 */
export const retryWithBackoff = async (
  executeRequest,
  classifyError,
  config = new RetryConfig(),
  context = {},
) => {
  let lastError;
  let lastClassification;
  const startTime = Date.now();

  for (let attempt = 1; attempt <= config.maxAttempts; attempt++) {
    try {
      const result = await executeRequest();
      return result;
    } catch (error) {
      lastError = error;
      lastClassification = classifyError(error);

      const isTerminal = !config.canRetry(attempt, lastClassification);

      if (isTerminal) {
        throw lastError;
      }

      const delayMs = config.getDelayMs(attempt, lastClassification);
      const elapsedMs = Date.now() - startTime;

      // Log retry attempt (sensitive data already filtered by classifyError)
      if (context.logger) {
        context.logger.info('retry_attempt', {
          provider: context.provider,
          requestId: context.requestId,
          attemptNumber: attempt,
          totalAttempts: config.maxAttempts,
          errorType: lastClassification?.type,
          delayMs,
          elapsedMs,
          timestamp: new Date().toISOString(),
        });
      }

      // Wait before retry
      await sleep(delayMs);
    }
  }

  // All retries exhausted
  throw Object.assign(lastError || new Error('Request failed after all retries'), {
    retriesExhausted: true,
    totalAttempts: config.maxAttempts,
    classification: lastClassification,
  });
};

/**
 * Promise-based sleep
 */
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
