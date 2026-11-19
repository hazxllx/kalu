/**
 * AI Provider HTTP Client & Factory (`services/aiProvider/client.js`).
 *
 * Fits into KALUSAGAP's backend architecture beneath domain/AI services:
 *   `route -> authenticate -> authorize -> controller -> service -> AIProviderClient -> External LLM API`
 *
 * Responsibilities:
 * - Executes authenticated JSON requests against external AI providers (Anthropic, OpenAI).
 * - Deduplicates concurrent identical requests in memory via idempotency keys.
 * - Retries transient failures (503 capacity, 429 rate limits, 5xx, network/timeouts)
 *   using exponential backoff with symmetric jitter and `Retry-After` header support.
 * - Automatically fails over to a secondary `fallbackProvider` when primary retries
 *   are exhausted on fallback-eligible errors.
 * - Emits structured, credential-redacted telemetry logs via `ProviderLogger`.
 */

import { v4 as uuidv4 } from 'uuid';
import { classifyProviderError, isRetryable, isFallbackEligible } from './errors.js';
import { RetryConfig, retryWithBackoff } from './retry.js';
import { ProviderLogger, createProviderRequestLog, createRetryLog, createRetryExhaustedLog, createFallbackLog } from './logging.js';

/**
 * Immutable-style configuration container for a single external AI provider.
 * Clamps retry counts and timeout/backoff bounds to safe operational ranges.
 */
export class ProviderConfig {
  /**
   * @param {Object} [options] - Provider configuration parameters
   * @param {string} options.name - Logical provider identifier (e.g., `'anthropic'`, `'openai'`)
   * @param {string} options.apiKey - Secret bearer token (never written to logs)
   * @param {string} options.baseUrl - Base origin URL (e.g., `'https://api.anthropic.com'`)
   * @param {number} [options.maxRetries=5] - Total attempts allowed per request (clamped to 1..10)
   * @param {number} [options.requestTimeoutMs=30000] - Per-attempt HTTP abort timeout in ms (min 1000)
   * @param {number} [options.retryBackoffBaseMs=1000] - Initial backoff delay in ms (min 100)
   * @param {number} [options.retryBackoffMaxMs=60000] - Upper bound on backoff delay in ms
   * @param {boolean} [options.respectRetryAfter=true] - Whether to honor provider `Retry-After` delays
   * @param {ProviderConfig|null} [options.fallbackProvider=null] - Secondary provider used if primary exhausts retries
   */
  constructor({
    name,
    apiKey,
    baseUrl,
    maxRetries = 5,
    requestTimeoutMs = 30_000,
    retryBackoffBaseMs = 1000,
    retryBackoffMaxMs = 60_000,
    respectRetryAfter = true,
    fallbackProvider = null,
  } = {}) {
    if (!name || !apiKey || !baseUrl) {
      throw new Error('Provider config requires name, apiKey, and baseUrl');
    }

    this.name = name;
    this.apiKey = apiKey; // Do not log this
    this.baseUrl = baseUrl;
    this.maxRetries = Math.max(1, Math.min(maxRetries, 10));
    this.requestTimeoutMs = Math.max(1000, requestTimeoutMs);
    this.retryBackoffBaseMs = Math.max(100, retryBackoffBaseMs);
    this.retryBackoffMaxMs = Math.max(this.retryBackoffBaseMs, retryBackoffMaxMs);
    this.respectRetryAfter = respectRetryAfter;
    this.fallbackProvider = fallbackProvider; // Another ProviderConfig instance
  }

  /**
   * Build a `RetryConfig` instance derived from this provider's backoff settings.
   *
   * @returns {RetryConfig} Retry policy configuration
   */
  getRetryConfig() {
    return new RetryConfig({
      maxAttempts: this.maxRetries,
      baseDelayMs: this.retryBackoffBaseMs,
      maxDelayMs: this.retryBackoffMaxMs,
      respectRetryAfter: this.respectRetryAfter,
    });
  }
}

/**
 * Resilient HTTP client for a configured AI provider with in-flight request
 * deduplication, exponential backoff retries, and secondary provider failover.
 */
export class AIProviderClient {
  /**
   * @param {ProviderConfig} config - Validated provider configuration
   * @param {ProviderLogger|null} [logger=null] - Optional custom logger; defaults to provider-scoped logger
   */
  constructor(config, logger = null) {
    if (!(config instanceof ProviderConfig)) {
      throw new TypeError('Expected config to be ProviderConfig instance');
    }
    this.config = config;
    this.logger = logger || new ProviderLogger(`ai-provider:${config.name}`);
    this.inFlightRequests = new Map(); // Track in-flight by idempotency key
  }

  /**
   * Execute a request to the AI provider with retry logic
   * 
   * @param {object} options - Request options
   * @param {string} options.model - Model name/ID
   * @param {string} options.endpoint - API endpoint path (e.g., '/v1/chat/completions')
   * @param {string} options.method - HTTP method (GET, POST, etc)
   * @param {object} options.payload - Request body
   * @param {string} options.idempotencyKey - Optional key for deduplication; generated if not provided
   * @param {AbortSignal} options.signal - Optional abort signal
   * @returns {Promise<object>} API response
   * @throws {Error} With classification info if all retries fail
   */
  async execute({
    model,
    endpoint,
    method = 'POST',
    payload,
    idempotencyKey = null,
    signal = null,
  } = {}) {
    if (!model || !endpoint || !payload) {
      throw new Error('Missing required options: model, endpoint, payload');
    }

    const requestId = idempotencyKey || uuidv4();
    const logContext = {
      provider: this.config.name,
      requestId,
      model,
      endpoint,
    };

    // Check for in-flight duplicate request
    if (this.inFlightRequests.has(requestId)) {
      this.logger.info('duplicate_request_detected', {
        ...logContext,
        action: 'deduplicated',
      });
      return this.inFlightRequests.get(requestId);
    }

    // Create the request promise
    const requestPromise = this.executeWithRetry({
      model,
      endpoint,
      method,
      payload,
      requestId,
      signal,
    });

    // Track in-flight request
    this.inFlightRequests.set(requestId, requestPromise);

    try {
      const result = await requestPromise;
      return result;
    } finally {
      // Clean up in-flight tracking
      this.inFlightRequests.delete(requestId);
    }
  }

  /**
   * Internal: Execute a provider request wrapped in `retryWithBackoff`.
   *
   * If all retry attempts fail (or a terminal error occurs), classifies the final
   * error. When the classification is fallback-eligible (503, 429, 5xx) and a
   * `fallbackProvider` is configured, delegates to `executeFallback`. Otherwise
   * throws an enriched `Error` carrying `classification`, `statusCode`, `provider`,
   * and `requestId` for upstream service error mapping.
   *
   * @param {Object} options - Internal execution parameters
   * @returns {Promise<Object>} Parsed JSON response body
   */
  async executeWithRetry({
    model,
    endpoint,
    method,
    payload,
    requestId,
    signal,
  }) {
    const logContext = {
      provider: this.config.name,
      requestId,
      model,
      endpoint,
    };

    const startTime = Date.now();
    let lastClassification = null;

    const executeRequest = async () => {
      return this.makeRequest({
        model,
        endpoint,
        method,
        payload,
        requestId,
        signal,
      });
    };

    const classifyError = (error) => {
      const statusCode = error?.statusCode || 0;
      const responseBody = error?.responseBody || {};
      return classifyProviderError(error, statusCode, responseBody);
    };

    try {
      const result = await retryWithBackoff(
        executeRequest,
        classifyError,
        this.config.getRetryConfig(),
        {
          provider: this.config.name,
          requestId,
          logger: this.logger,
        }
      );

      const elapsedMs = Date.now() - startTime;
      this.logger.info('request_success', {
        ...logContext,
        responseTimeMs: elapsedMs,
      });

      return result;
    } catch (error) {
      lastClassification = classifyError(error);
      const elapsedMs = Date.now() - startTime;
      const attemptCount = error.totalAttempts || this.config.maxRetries;

      // Log retry exhaustion
      this.logger.error('retries_exhausted', {
        ...logContext,
        totalAttempts: attemptCount,
        elapsedMs,
        errorType: lastClassification?.type,
        userMessage: lastClassification?.userMessage,
      });

      // Try fallback provider if eligible
      if (
        isFallbackEligible(lastClassification) &&
        this.config.fallbackProvider
      ) {
        return this.executeFallback({
          ...logContext,
          originalError: error,
          originalClassification: lastClassification,
          model,
          endpoint,
          method,
          payload,
          signal,
        });
      }

      // Attach classification to error for caller
      const enhancedError = new Error(lastClassification?.userMessage || error.message);
      enhancedError.statusCode = error.statusCode;
      enhancedError.classification = lastClassification;
      enhancedError.retriesExhausted = true;
      enhancedError.provider = this.config.name;
      enhancedError.requestId = requestId;

      throw enhancedError;
    }
  }

  /**
   * Fail over to the configured secondary `fallbackProvider` after primary retries
   * are exhausted on a capacity, rate-limit, or server error.
   *
   * Preserves the original `requestId` as `idempotencyKey` for end-to-end tracing.
   * Re-throws `originalError` if the fallback provider also fails so callers see
   * the primary failure context.
   *
   * @param {Object} options - Fallback execution context and original failure metadata
   * @returns {Promise<Object>} Parsed JSON response from the fallback provider
   */
  async executeFallback({
    provider,
    requestId,
    model,
    endpoint,
    method,
    payload,
    signal,
    originalError,
    originalClassification,
  }) {
    this.logger.info('fallback_attempt', {
      provider,
      requestId,
      model,
      fallbackProvider: this.config.fallbackProvider.name,
      originalErrorType: originalClassification?.type,
    });

    const fallbackClient = new AIProviderClient(this.config.fallbackProvider, this.logger);

    try {
      const result = await fallbackClient.execute({
        model,
        endpoint,
        idempotencyKey: requestId, // Preserve idempotency key
        method,
        payload,
        signal,
      });

      this.logger.info('fallback_success', {
        provider,
        requestId,
        fallbackProvider: this.config.fallbackProvider.name,
      });

      return result;
    } catch (fallbackError) {
      this.logger.error('fallback_failed', {
        provider,
        requestId,
        fallbackProvider: this.config.fallbackProvider.name,
        originalErrorType: originalClassification?.type,
        fallbackErrorType: fallbackError.classification?.type,
      });

      // Throw original error since fallback also failed
      throw originalError;
    }
  }

  /**
   * Perform a single raw HTTP request attempt to the provider endpoint.
   *
   * Enforces `config.requestTimeoutMs` via `AbortController` (unless an external
   * `signal` is supplied), attaches bearer auth and `X-Request-ID` headers, and
   * normalizes non-2xx responses and abort timeouts into structured `Error` objects
   * with `statusCode`, `responseBody`, and `headers` for `classifyProviderError`.
   *
   * @param {Object} options - Single HTTP attempt options
   * @returns {Promise<Object>} Parsed JSON body on 2xx response
   */
  async makeRequest({
    model,
    endpoint,
    method,
    payload,
    requestId,
    signal,
  }) {
    const url = `${this.config.baseUrl}${endpoint}`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.config.requestTimeoutMs);
    const effectiveSignal = signal || controller.signal;

    try {
      const response = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.config.apiKey}`,
          'User-Agent': 'KALUSAGAP/1.0',
          'X-Request-ID': requestId,
        },
        body: JSON.stringify(payload),
        signal: effectiveSignal,
      });

      const responseBody = await response.json().catch(() => ({}));

      // Success
      if (response.ok) {
        return responseBody;
      }

      // Error response from provider
      const error = new Error(
        responseBody?.error?.message || `HTTP ${response.status}`
      );
      error.statusCode = response.status;
      error.responseBody = responseBody;
      error.headers = Object.fromEntries(response.headers.entries());

      throw error;
    } catch (error) {
      // Network or timeout error
      if (error?.name === 'AbortError') {
        const timeoutError = new Error('Request timeout');
        timeoutError.statusCode = 0;
        timeoutError.code = 'ETIMEDOUT';
        throw timeoutError;
      }

      // Re-throw with status code info
      if (!error.statusCode) {
        error.statusCode = 0;
      }
      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  }
}

/**
 * Registry and factory for named `ProviderConfig` definitions and `AIProviderClient` instances.
 */
export class ProviderClientFactory {
  constructor() {
    this.configs = new Map(); // name -> ProviderConfig
    this.logger = new ProviderLogger('ai-provider-factory');
  }

  /**
   * Register or overwrite a provider configuration by `config.name`.
   *
   * @param {ProviderConfig} config - Validated provider configuration
   */
  register(config) {
    if (!(config instanceof ProviderConfig)) {
      throw new TypeError('Expected ProviderConfig instance');
    }
    this.configs.set(config.name, config);
  }

  /**
   * Create a new `AIProviderClient` bound to the named provider configuration.
   *
   * @param {string} providerName - Registered provider key (e.g., `'anthropic'`, `'openai'`)
   * @returns {AIProviderClient} Configured client instance
   */
  getClient(providerName) {
    const config = this.configs.get(providerName);
    if (!config) {
      throw new Error(`Provider '${providerName}' not configured`);
    }
    return new AIProviderClient(config, this.logger);
  }

  /**
   * Return the names of all currently registered AI providers.
   *
   * @returns {Array<string>} Registered provider names
   */
  listProviders() {
    return Array.from(this.configs.keys());
  }
}

export default AIProviderClient;
