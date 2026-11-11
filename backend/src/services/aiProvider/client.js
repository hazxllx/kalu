/**
 * AI Provider Integration
 * 
 * Handles requests to external AI providers (OpenAI, Anthropic, etc.) with:
 * - 503 capacity error detection and retry
 * - Exponential backoff with jitter
 * - Retry-After header respect
 * - Request deduplication (idempotency)
 * - Provider fallback support
 * - Comprehensive error classification
 * - Secure logging without exposing sensitive data
 */

import { v4 as uuidv4 } from 'uuid';
import { classifyProviderError, isRetryable, isFallbackEligible } from './errors.js';
import { RetryConfig, retryWithBackoff } from './retry.js';
import { ProviderLogger, createProviderRequestLog, createRetryLog, createRetryExhaustedLog, createFallbackLog } from './logging.js';

/**
 * Configuration for provider integration
 */
export class ProviderConfig {
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
 * AI Provider Client with retry and error handling
 */
export class AIProviderClient {
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
   * Internal: Execute request with retry and backoff
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
   * Execute fallback to alternative provider
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
   * Make the actual HTTP request to provider
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
 * Factory for creating configured provider clients
 */
export class ProviderClientFactory {
  constructor() {
    this.configs = new Map(); // name -> ProviderConfig
    this.logger = new ProviderLogger('ai-provider-factory');
  }

  /**
   * Register a provider configuration
   */
  register(config) {
    if (!(config instanceof ProviderConfig)) {
      throw new TypeError('Expected ProviderConfig instance');
    }
    this.configs.set(config.name, config);
  }

  /**
   * Get or create a client for the provider
   */
  getClient(providerName) {
    const config = this.configs.get(providerName);
    if (!config) {
      throw new Error(`Provider '${providerName}' not configured`);
    }
    return new AIProviderClient(config, this.logger);
  }

  /**
   * List registered providers
   */
  listProviders() {
    return Array.from(this.configs.keys());
  }
}

export default AIProviderClient;
