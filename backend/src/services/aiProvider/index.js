/**
 * AI Provider Subsystem Barrel (`services/aiProvider/index.js`).
 *
 * Re-exports the public surface of KALUSAGAP's external AI integration module
 * (`route -> authenticate -> authorize -> controller -> aiProvider -> External LLM API`):
 * - `errors.js`: HTTP/network error classification, retryability, and fallback eligibility predicates.
 * - `retry.js`: Exponential backoff with symmetric jitter and `Retry-After` handling.
 * - `logging.js`: Credential-redacted JSON structured logging and telemetry event builders.
 * - `client.js`: Idempotent HTTP client (`AIProviderClient`), config (`ProviderConfig`), and factory.
 * - `config.js`: Environment-driven provider initialization and lazy factory singleton.
 * - `service.js`: High-level chat completion, single-prompt text, and batch generation helpers.
 */

export { classifyProviderError, isRetryable, isFallbackEligible, PROVIDER_ERROR_TYPE, PROVIDER_ERROR_CATEGORY } from './errors.js';

export { computeBackoffMs, RetryConfig, retryWithBackoff } from './retry.js';

export { ProviderLogger, LOG_LEVEL, createProviderRequestLog, createRetryLog, createRetryExhaustedLog, createFallbackLog } from './logging.js';

export { AIProviderClient, ProviderConfig, ProviderClientFactory } from './client.js';

export { initializeProviders, getProviderFactory, resetProviderFactory } from './config.js';

export { generateChatCompletion, generateText, batchGenerateText } from './service.js';
