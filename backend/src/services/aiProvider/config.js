// backend/src/services/aiProvider/config.js
/**
 * AI Provider Environment Configuration & Factory Singleton (`services/aiProvider/config.js`).
 *
 * Fits into KALUSAGAP's AI service layer (`controller -> aiProvider/service -> getProviderFactory() -> AIProviderClient`),
 * resolving external LLM credentials and retry policies from environment variables.
 * Registers Anthropic as primary (with automatic failover to OpenAI when both keys
 * are configured), or OpenAI standalone when only `OPENAI_API_KEY` is present.
 */

import { ProviderConfig, ProviderClientFactory } from './client.js';

/**
 * Build and register `ProviderConfig` instances from environment variables.
 *
 * Provider selection & failover rules:
 * - When `ANTHROPIC_API_KEY` is present, registers `'anthropic'` as primary; if
 *   `OPENAI_API_KEY` is also present, registers `'openai'` and attaches it as
 *   Anthropic's `fallbackProvider`.
 * - When only `OPENAI_API_KEY` is present, registers `'openai'` standalone.
 * - Throws if neither API key is configured.
 *
 * Environment variables read:
 * - `ANTHROPIC_API_KEY`: Anthropic bearer API key
 * - `OPENAI_API_KEY`: OpenAI bearer API key
 * - `AI_PROVIDER_MAX_RETRIES`: Max retry attempts, clamped to 1..10 (default `5`)
 * - `AI_PROVIDER_RETRY_BASE_MS`: Base backoff delay in ms, min `100` (default `1000`)
 * - `AI_PROVIDER_RETRY_MAX_MS`: Max backoff cap in ms, min `retryBaseMs` (default `60000`)
 *
 * @param {Object} [env=process.env] - Environment dictionary (injectable for tests)
 * @returns {ProviderClientFactory} Populated provider client factory
 */
export const initializeProviders = (env = process.env) => {
  if ((env.NODE_ENV || 'development') !== 'production') {
    throw new Error('External AI providers are disabled in local development.');
  }
  const factory = new ProviderClientFactory();

  const maxRetries = Math.min(10, Math.max(1, Number(env.AI_PROVIDER_MAX_RETRIES) || 5));
  const retryBaseMs = Math.max(100, Number(env.AI_PROVIDER_RETRY_BASE_MS) || 1000);
  const retryMaxMs = Math.max(retryBaseMs, Number(env.AI_PROVIDER_RETRY_MAX_MS) || 60_000);

  // Configure Anthropic as primary (faster, more reliable)
  if (env.ANTHROPIC_API_KEY) {
    const anthropicConfig = new ProviderConfig({
      name: 'anthropic',
      apiKey: env.ANTHROPIC_API_KEY,
      baseUrl: 'https://api.anthropic.com',
      maxRetries,
      requestTimeoutMs: 30_000,
      retryBackoffBaseMs: retryBaseMs,
      retryBackoffMaxMs: retryMaxMs,
      respectRetryAfter: true,
      fallbackProvider: null, // Set below if OpenAI available
    });

    // If OpenAI is available, use it as fallback for Anthropic
    if (env.OPENAI_API_KEY) {
      const openaiConfig = new ProviderConfig({
        name: 'openai',
        apiKey: env.OPENAI_API_KEY,
        baseUrl: 'https://api.openai.com',
        maxRetries,
        requestTimeoutMs: 30_000,
        retryBackoffBaseMs: retryBaseMs,
        retryBackoffMaxMs: retryMaxMs,
        respectRetryAfter: true,
        fallbackProvider: null, // No fallback for OpenAI
      });

      anthropicConfig.fallbackProvider = openaiConfig;
      factory.register(openaiConfig);
    }

    factory.register(anthropicConfig);
  } else if (env.OPENAI_API_KEY) {
    // Fallback to OpenAI only if Anthropic not available
    const openaiConfig = new ProviderConfig({
      name: 'openai',
      apiKey: env.OPENAI_API_KEY,
      baseUrl: 'https://api.openai.com',
      maxRetries,
      requestTimeoutMs: 30_000,
      retryBackoffBaseMs: retryBaseMs,
      retryBackoffMaxMs: retryMaxMs,
      respectRetryAfter: true,
      fallbackProvider: null,
    });

    factory.register(openaiConfig);
  }

  if (!factory.listProviders().length) {
    throw new Error(
      'No AI provider API keys configured. ' +
      'Set ANTHROPIC_API_KEY or OPENAI_API_KEY environment variable.'
    );
  }

  return factory;
};

/**
 * Lazily-initialized singleton `ProviderClientFactory` instance shared across the process.
 */
let _providerFactory = null;

/**
 * Retrieve the process-wide `ProviderClientFactory`, initializing it from
 * `process.env` on first access.
 *
 * @returns {ProviderClientFactory} Singleton factory instance
 */
export const getProviderFactory = () => {
  if (!_providerFactory) {
    _providerFactory = initializeProviders();
  }
  return _providerFactory;
};

/**
 * Clear the cached `ProviderClientFactory` singleton so subsequent calls to
 * `getProviderFactory()` re-read environment variables (used for test isolation).
 */
export const resetProviderFactory = () => {
  _providerFactory = null;
};
