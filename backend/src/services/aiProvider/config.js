/**
 * AI Provider Configuration
 * 
 * Sets up provider configurations with fallback support and environment variables.
 * This file should be imported during application initialization.
 */

import { ProviderConfig, ProviderClientFactory } from './client.js';

/**
 * Initialize provider configurations from environment
 * 
 * Expected environment variables:
 * - OPENAI_API_KEY: OpenAI API key
 * - ANTHROPIC_API_KEY: Anthropic API key
 * - GOOGLE_API_KEY: Google API key
 * 
 * Optional:
 * - AI_PROVIDER_MAX_RETRIES: Max retry attempts (1-10, default 5)
 * - AI_PROVIDER_RETRY_BASE_MS: Base backoff delay in ms (default 1000)
 * - AI_PROVIDER_RETRY_MAX_MS: Max backoff delay in ms (default 60000)
 */
export const initializeProviders = (env = process.env) => {
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
 * Export singleton instance (initialized once at app startup)
 */
let _providerFactory = null;

export const getProviderFactory = () => {
  if (!_providerFactory) {
    _providerFactory = initializeProviders();
  }
  return _providerFactory;
};

/**
 * Reset provider factory (useful for testing)
 */
export const resetProviderFactory = () => {
  _providerFactory = null;
};
