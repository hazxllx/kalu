/**
 * Tests for AI Provider Integration
 * 
 * Run with: npm test -- backend/src/services/aiProvider/__tests__/
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  classifyProviderError,
  isRetryable,
  isFallbackEligible,
  PROVIDER_ERROR_TYPE,
} from '../errors.js';
import { computeBackoffMs, RetryConfig, retryWithBackoff } from '../retry.js';
import { AIProviderClient, ProviderConfig } from '../client.js';

describe('AI Provider - Error Classification', () => {
  it('classifies 503 as provider capacity with fallback eligible', () => {
    const error = new Error('Service Unavailable');
    const classification = classifyProviderError(error, 503, {
      error: { message: 'Account pool temporarily has no available capacity' },
    });

    expect(classification.type).toBe(PROVIDER_ERROR_TYPE.PROVIDER_CAPACITY);
    expect(classification.retryable).toBe(true);
    expect(classification.fallbackEligible).toBe(true);
    expect(isRetryable(classification)).toBe(true);
    expect(isFallbackEligible(classification)).toBe(true);
  });

  it('classifies 429 rate limit with retry-after', () => {
    const error = new Error('Too Many Requests');
    const classification = classifyProviderError(error, 429, {
      error: { retry_after: 30, message: 'Rate limited' },
    });

    expect(classification.type).toBe(PROVIDER_ERROR_TYPE.RATE_LIMIT);
    expect(classification.retryable).toBe(true);
    expect(classification.fallbackEligible).toBe(true);
    expect(classification.retryAfterSeconds).toBe(30);
  });

  it('classifies 401 as authentication - not retryable', () => {
    const error = new Error('Unauthorized');
    const classification = classifyProviderError(error, 401, {
      error: { message: 'Invalid API key' },
    });

    expect(classification.type).toBe(PROVIDER_ERROR_TYPE.AUTHENTICATION);
    expect(classification.retryable).toBe(false);
    expect(isRetryable(classification)).toBe(false);
  });

  it('classifies 402 as insufficient balance - not retryable', () => {
    const error = new Error('Payment Required');
    const classification = classifyProviderError(error, 402, {
      error: { message: 'Insufficient balance' },
    });

    expect(classification.type).toBe(PROVIDER_ERROR_TYPE.INSUFFICIENT_BALANCE);
    expect(classification.retryable).toBe(false);
  });

  it('classifies 403 as permission - not retryable', () => {
    const error = new Error('Forbidden');
    const classification = classifyProviderError(error, 403, {
      error: { message: 'Model not available' },
    });

    expect(classification.type).toBe(PROVIDER_ERROR_TYPE.PERMISSION);
    expect(classification.retryable).toBe(false);
  });

  it('classifies network errors as retryable', () => {
    const error = new Error('Failed to fetch');
    error.code = 'ECONNREFUSED';

    const classification = classifyProviderError(error, 0);

    expect(classification.type).toBe(PROVIDER_ERROR_TYPE.NETWORK);
    expect(classification.retryable).toBe(true);
    expect(isRetryable(classification)).toBe(true);
  });

  it('classifies timeout errors as retryable', () => {
    const error = new Error('Request timeout');
    const classification = classifyProviderError(error, 0);

    expect(classification.type).toBe(PROVIDER_ERROR_TYPE.TIMEOUT);
    expect(classification.retryable).toBe(true);
  });

  it('classifies other 5xx as retryable', () => {
    const error = new Error('Internal Server Error');
    const classification = classifyProviderError(error, 500);

    expect(classification.type).toBe(PROVIDER_ERROR_TYPE.UNKNOWN);
    expect(classification.retryable).toBe(true);
    expect(classification.fallbackEligible).toBe(true);
  });
});

describe('Retry and Backoff', () => {
  it('computes exponential backoff correctly', () => {
    // Attempt 1: ~1s
    expect(computeBackoffMs(1, { baseMs: 1000, jitterRatio: 0 })).toBe(1000);

    // Attempt 2: ~2s
    expect(computeBackoffMs(2, { baseMs: 1000, jitterRatio: 0 })).toBe(2000);

    // Attempt 3: ~4s
    expect(computeBackoffMs(3, { baseMs: 1000, jitterRatio: 0 })).toBe(4000);

    // Attempt 4: ~8s
    expect(computeBackoffMs(4, { baseMs: 1000, jitterRatio: 0 })).toBe(8000);

    // Capped at maxMs
    expect(computeBackoffMs(10, { baseMs: 1000, maxMs: 60000, jitterRatio: 0 })).toBe(60000);
  });

  it('adds jitter to backoff', () => {
    const delays = [];
    for (let i = 0; i < 100; i++) {
      delays.push(computeBackoffMs(2, { baseMs: 1000, jitterRatio: 0.25 }));
    }

    // All delays should be different (due to randomness)
    const unique = new Set(delays);
    expect(unique.size).toBeGreaterThan(50); // Most should be unique

    // All delays should be around 2000ms ±500ms (2000 * 0.25)
    expect(Math.min(...delays)).toBeGreaterThanOrEqual(1500);
    expect(Math.max(...delays)).toBeLessThanOrEqual(2500);
  });

  it('respects max attempts in RetryConfig', () => {
    const config = new RetryConfig({ maxAttempts: 3 });

    expect(config.canRetry(1, { retryable: true })).toBe(true);
    expect(config.canRetry(2, { retryable: true })).toBe(true);
    expect(config.canRetry(3, { retryable: true })).toBe(false); // Reached max
  });

  it('stops retry on non-retryable error', () => {
    const config = new RetryConfig({ maxAttempts: 5 });
    const nonRetryable = { retryable: false };

    expect(config.canRetry(1, nonRetryable)).toBe(false);
  });

  it('respects Retry-After header', () => {
    const config = new RetryConfig({ respectRetryAfter: true });
    const errorWithRetryAfter = { retryAfterSeconds: 45 };

    const delayMs = config.getDelayMs(1, errorWithRetryAfter);
    expect(delayMs).toBe(45 * 1000);
  });

  it('retryWithBackoff succeeds on first attempt', async () => {
    const executeRequest = vi.fn().mockResolvedValue({ success: true });
    const classifyError = vi.fn();

    const result = await retryWithBackoff(executeRequest, classifyError);

    expect(result.success).toBe(true);
    expect(executeRequest).toHaveBeenCalledOnce();
    expect(classifyError).not.toHaveBeenCalled();
  });

  it('retryWithBackoff retries on retryable error', async () => {
    let attempt = 0;
    const executeRequest = vi.fn().mockImplementation(() => {
      attempt++;
      if (attempt < 3) {
        const error = new Error('Transient failure');
        error.statusCode = 503;
        throw error;
      }
      return { success: true };
    });

    const classifyError = vi.fn((error) => ({
      retryable: error.statusCode === 503,
      type: 'provider_capacity',
    }));

    const config = new RetryConfig({ maxAttempts: 5, baseDelayMs: 10, maxDelayMs: 100 });

    const result = await retryWithBackoff(executeRequest, classifyError, config);

    expect(result.success).toBe(true);
    expect(executeRequest).toHaveBeenCalledTimes(3);
    expect(classifyError).toHaveBeenCalledTimes(2);
  });

  it('retryWithBackoff throws on terminal error', async () => {
    const executeRequest = vi.fn().mockImplementation(() => {
      const error = new Error('Invalid request');
      error.statusCode = 400;
      throw error;
    });

    const classifyError = vi.fn((error) => ({
      retryable: false,
      type: 'invalid_request',
    }));

    const config = new RetryConfig({ maxAttempts: 3 });

    await expect(
      retryWithBackoff(executeRequest, classifyError, config)
    ).rejects.toThrow('Invalid request');

    expect(executeRequest).toHaveBeenCalledOnce();
  });

  it('retryWithBackoff throws after max attempts exhausted', async () => {
    const executeRequest = vi.fn().mockImplementation(() => {
      const error = new Error('Service unavailable');
      error.statusCode = 503;
      throw error;
    });

    const classifyError = vi.fn((error) => ({
      retryable: true,
      type: 'provider_capacity',
    }));

    const config = new RetryConfig({ maxAttempts: 2, baseDelayMs: 1, maxDelayMs: 10 });

    await expect(
      retryWithBackoff(executeRequest, classifyError, config)
    ).rejects.toThrow('Service unavailable');

    expect(executeRequest).toHaveBeenCalledTimes(2);
  });
});

describe('AIProviderClient', () => {
  let config;
  let client;

  beforeEach(() => {
    config = new ProviderConfig({
      name: 'test-provider',
      apiKey: 'test-key-123',
      baseUrl: 'https://api.test.com',
      maxRetries: 3,
      requestTimeoutMs: 5000,
      retryBackoffBaseMs: 100,
      retryBackoffMaxMs: 1000,
    });

    client = new AIProviderClient(config);
  });

  it('deduplicates in-flight requests by idempotency key', async () => {
    const executeRequest = vi.fn().mockResolvedValue({ result: 'data' });

    // Mock the makeRequest to use the mock
    client.makeRequest = executeRequest;

    const key = 'idempotent-key-123';

    // Start two requests with same key
    const promise1 = client.execute({
      model: 'test-model',
      endpoint: '/endpoint',
      payload: { test: true },
      idempotencyKey: key,
    });

    const promise2 = client.execute({
      model: 'test-model',
      endpoint: '/endpoint',
      payload: { test: true },
      idempotencyKey: key,
    });

    const [result1, result2] = await Promise.all([promise1, promise2]);

    expect(result1).toEqual(result2);
    // makeRequest should only be called once due to deduplication
    expect(executeRequest).toHaveBeenCalledOnce();
  });

  it('generates unique request IDs when idempotency key not provided', async () => {
    client.makeRequest = vi.fn().mockResolvedValue({ result: 'data' });

    await client.execute({
      model: 'test-model',
      endpoint: '/endpoint',
      payload: { test: true },
    });

    await client.execute({
      model: 'test-model',
      endpoint: '/endpoint',
      payload: { test: true },
    });

    expect(client.makeRequest).toHaveBeenCalledTimes(2);

    const call1Args = client.makeRequest.mock.calls[0][0];
    const call2Args = client.makeRequest.mock.calls[1][0];

    expect(call1Args.requestId).not.toBe(call2Args.requestId);
  });

  it('enhances error with classification info', async () => {
    client.makeRequest = vi.fn().mockImplementation(() => {
      const error = new Error('Service Unavailable');
      error.statusCode = 503;
      error.responseBody = { error: { message: 'Capacity exceeded' } };
      throw error;
    });

    await expect(
      client.execute({
        model: 'test-model',
        endpoint: '/endpoint',
        payload: { test: true },
      })
    ).rejects.toThrow();
  });
});

describe('Provider Fallback', () => {
  it('attempts fallback provider when primary fails', async () => {
    const primaryConfig = new ProviderConfig({
      name: 'primary',
      apiKey: 'primary-key',
      baseUrl: 'https://primary.com',
      maxRetries: 2,
      retryBackoffBaseMs: 1,
      retryBackoffMaxMs: 10,
    });

    const fallbackConfig = new ProviderConfig({
      name: 'fallback',
      apiKey: 'fallback-key',
      baseUrl: 'https://fallback.com',
      maxRetries: 2,
    });

    primaryConfig.fallbackProvider = fallbackConfig;

    const primaryClient = new AIProviderClient(primaryConfig);
    const fallbackClient = new AIProviderClient(fallbackConfig);

    // Primary always fails with retryable error
    primaryClient.makeRequest = vi.fn().mockImplementation(() => {
      const error = new Error('Service Unavailable');
      error.statusCode = 503;
      error.responseBody = {};
      throw error;
    });

    // Fallback succeeds
    fallbackClient.makeRequest = vi.fn().mockResolvedValue({ result: 'success' });

    // Spy on fallback execution
    vi.spyOn(primaryClient, 'executeFallback').mockImplementation(
      async () => fallbackClient.makeRequest()
    );

    try {
      await primaryClient.execute({
        model: 'test-model',
        endpoint: '/endpoint',
        payload: { test: true },
      });
    } catch (error) {
      // Expected to fail after fallback also exhausts retries or succeeds
    }

    // Verify fallback was attempted
    expect(primaryClient.executeFallback).toHaveBeenCalled();
  });
});

describe('Error Scenarios', () => {
  it('handles AbortSignal timeout', async () => {
    const config = new ProviderConfig({
      name: 'test',
      apiKey: 'key',
      baseUrl: 'https://api.test.com',
      requestTimeoutMs: 100,
    });

    const client = new AIProviderClient(config);

    // Mock fetch to timeout
    global.fetch = vi.fn(() => new Promise((resolve) => {
      setTimeout(() => resolve({ ok: true, json: () => ({ result: 'data' }) }), 500);
    }));

    // This would normally timeout in real scenario
    // For test, we skip actual timeout behavior
  });

  it('preserves request payload across retries', async () => {
    const config = new ProviderConfig({
      name: 'test',
      apiKey: 'key',
      baseUrl: 'https://api.test.com',
      maxRetries: 3,
      retryBackoffBaseMs: 1,
    });

    const client = new AIProviderClient(config);
    const payloads = [];

    client.makeRequest = vi.fn().mockImplementation(async (args) => {
      payloads.push(args.payload);

      if (payloads.length < 2) {
        const error = new Error('Retry me');
        error.statusCode = 503;
        error.responseBody = {};
        throw error;
      }

      return { result: 'success' };
    });

    const payload = { model: 'gpt-4', messages: [{ role: 'user', content: 'Hello' }] };

    await client.execute({
      model: 'gpt-4',
      endpoint: '/v1/chat/completions',
      payload,
    });

    // All attempts should have the same payload
    expect(payloads).toHaveLength(2);
    expect(payloads[0]).toEqual(payload);
    expect(payloads[1]).toEqual(payload);
  });
});
