# AI Provider Integration - 503 Capacity Error Handling

This module provides robust retry and error handling for AI provider integrations with comprehensive support for HTTP 503 Service Unavailable responses.

## Features

✅ **HTTP 503 Detection** - Automatically detects and classifies provider capacity errors  
✅ **Exponential Backoff** - Implements exponential backoff with symmetric jitter to prevent thundering herd  
✅ **Retry-After Respect** - Honors `Retry-After` response headers from providers  
✅ **Configurable Retries** - Retry limits from 1-10 attempts (default 5)  
✅ **Error Classification** - Distinguishes capacity from auth, rate limit, permission, and balance errors  
✅ **Request Deduplication** - Prevents duplicate processing via idempotency keys  
✅ **Provider Fallback** - Gracefully falls back to alternative providers on failure  
✅ **Secure Logging** - Logs provider, status, request ID, and retry count without exposing secrets  
✅ **User-Friendly Errors** - Provides clear error messages for end users  
✅ **Payload Preservation** - Maintains request payload across all retry attempts  

## Installation & Setup

### 1. Environment Configuration

Add to your `.env`:

```bash
# Primary AI provider (Anthropic recommended)
ANTHROPIC_API_KEY=sk-ant-...

# Optional fallback provider
OPENAI_API_KEY=sk-...

# Optional retry configuration
AI_PROVIDER_MAX_RETRIES=5              # 1-10, default 5
AI_PROVIDER_RETRY_BASE_MS=1000         # Base backoff in ms, default 1000
AI_PROVIDER_RETRY_MAX_MS=60000         # Max backoff in ms, default 60000
```

### 2. Application Initialization

Initialize providers at application startup:

```javascript
import { initializeProviders } from './services/aiProvider/config.js';

// During app initialization
const providerFactory = initializeProviders(process.env);

// Or use the singleton getter
import { getProviderFactory } from './services/aiProvider/config.js';
const factory = getProviderFactory();
```

## Usage

### Basic Chat Completion

```javascript
import { generateChatCompletion } from './services/aiProvider/service.js';

try {
  const response = await generateChatCompletion({
    model: 'claude-3-opus-20240229',
    messages: [
      { role: 'user', content: 'What is 2+2?' }
    ],
    temperature: 0.7,
    maxTokens: 1000,
    providerName: 'anthropic', // or 'openai'
  });

  console.log(response);
} catch (error) {
  // error.userMessage - Display to end user
  // error.errorType - Machine-readable error type
  // error.provider - Which provider failed
  // error.requestId - For debugging
  res.status(503).json({
    error: error.userMessage,
    type: error.errorType,
    requestId: error.requestId,
  });
}
```

### Direct Client Usage

```javascript
import { getProviderFactory } from './services/aiProvider/config.js';

const factory = getProviderFactory();
const client = factory.getClient('anthropic');

try {
  const response = await client.execute({
    model: 'claude-3-opus-20240229',
    endpoint: '/v1/messages',
    payload: {
      model: 'claude-3-opus-20240229',
      messages: [{ role: 'user', content: 'Hello!' }],
      max_tokens: 1000,
    },
    // Optional: custom idempotency key for deduplication
    idempotencyKey: 'unique-operation-id',
  });
} catch (error) {
  // error.classification contains:
  // - type: error type (PROVIDER_CAPACITY, RATE_LIMIT, AUTHENTICATION, etc)
  // - retryable: whether error is retryable
  // - userMessage: user-friendly error message
  // - category: 'retryable', 'terminal', or 'fallback_eligible'
}
```

### Batch Operations

```javascript
import { batchGenerateText } from './services/aiProvider/service.js';

const requests = [
  { model: 'claude-3-opus-20240229', prompt: 'Prompt 1', providerName: 'anthropic' },
  { model: 'claude-3-opus-20240229', prompt: 'Prompt 2', providerName: 'anthropic' },
  { model: 'gpt-4', prompt: 'Prompt 3', providerName: 'openai' },
];

const results = await batchGenerateText(requests);

results.forEach((result) => {
  if (result.success) {
    console.log(`✓ Request succeeded: ${result.text}`);
  } else {
    console.log(`✗ Request failed: ${result.error}`);
    console.log(`  Type: ${result.errorType}`);
    console.log(`  Provider: ${result.provider}`);
    console.log(`  Request ID: ${result.requestId}`);
  }
});
```

## Error Handling

### Error Classification

Errors are classified into distinct types:

| Type | Status | Retryable | Fallback | User Message |
|------|--------|-----------|----------|--------------|
| `PROVIDER_CAPACITY` | 503 | ✅ | ✅ | "AI service temporarily at capacity" |
| `RATE_LIMIT` | 429 | ✅ | ✅ | "Rate limit exceeded. Please wait..." |
| `NETWORK` | 0 | ✅ | ✅ | "Connection temporarily unavailable" |
| `TIMEOUT` | 0 | ✅ | ✅ | "Request timed out" |
| `AUTHENTICATION` | 401 | ❌ | ❌ | "Authentication failed" |
| `PERMISSION` | 403 | ❌ | ❌ | "Access denied to model" |
| `INSUFFICIENT_BALANCE` | 402 | ❌ | ❌ | "Insufficient balance" |
| `INVALID_REQUEST` | 4xx | ❌ | ❌ | "Invalid request" |
| `UNKNOWN` | 5xx | ✅ | ✅ | "Unexpected error" |

### Manual Error Classification

```javascript
import { classifyProviderError, isRetryable, isFallbackEligible } from './services/aiProvider/errors.js';

try {
  // Make request
} catch (error) {
  const classification = classifyProviderError(error, error.statusCode, error.responseBody);

  if (isRetryable(classification)) {
    // Retry logic
  }

  if (isFallbackEligible(classification)) {
    // Try alternative provider
  }

  console.log(`Error type: ${classification.type}`);
  console.log(`User message: ${classification.userMessage}`);
}
```

## Retry Strategy

### Exponential Backoff with Jitter

The retry mechanism implements exponential backoff to prevent thundering herd:

```
Attempt 1: ~1s delay
Attempt 2: ~2s delay
Attempt 3: ~4s delay
Attempt 4: ~8s delay
Attempt 5: ~16s delay
Attempt 6+: ~60s delay (capped)
```

Each delay includes ±25% symmetric jitter to randomize retry timing across clients.

### Respecting Retry-After Headers

When a provider returns a `Retry-After` header, the client automatically uses that delay instead of computed backoff:

```javascript
// If server returns: Retry-After: 45
// Client will wait exactly 45 seconds before next attempt
```

### Configuration

```javascript
import { RetryConfig } from './services/aiProvider/retry.js';

const config = new RetryConfig({
  maxAttempts: 5,              // 1-10 attempts
  baseDelayMs: 1000,           // Base backoff in ms
  maxDelayMs: 60_000,          // Cap backoff at 60s
  jitterRatio: 0.25,           // ±25% jitter
  respectRetryAfter: true,     // Honor Retry-After header
});

const delayMs = config.getDelayMs(attemptNumber, errorClassification);
```

## Request Deduplication

Prevent duplicate processing via idempotency keys:

```javascript
const client = factory.getClient('anthropic');

// Two concurrent requests with same key deduplicate to one
const idempotencyKey = 'operation-user-123-task-456';

const promise1 = client.execute({
  model: 'claude-3-opus-20240229',
  endpoint: '/v1/messages',
  payload: { ... },
  idempotencyKey,
});

const promise2 = client.execute({
  model: 'claude-3-opus-20240229',
  endpoint: '/v1/messages',
  payload: { ... },
  idempotencyKey,
});

// Both promises resolve to the same result
// Only one request sent to provider
const [result1, result2] = await Promise.all([promise1, promise2]);
```

## Provider Fallback

Automatically fall back to alternative providers on capacity errors:

```javascript
// In config initialization:
const anthropic = new ProviderConfig({
  name: 'anthropic',
  apiKey: process.env.ANTHROPIC_API_KEY,
  baseUrl: 'https://api.anthropic.com',
  maxRetries: 3,
  fallbackProvider: openai, // Configure fallback
});

// When anthropic exhausts retries with capacity error,
// automatically attempts openai as fallback
```

## Logging

### Secure Logging

Sensitive fields are automatically redacted:

```javascript
import { ProviderLogger } from './services/aiProvider/logging.js';

const logger = new ProviderLogger('ai-service');

// Logs with [REDACTED] for sensitive fields:
logger.info('request_attempt', {
  provider: 'anthropic',
  requestId: 'req-123',
  apiKey: 'sk-ant-...', // Redacted to [REDACTED]
  model: 'claude-3-opus-20240229',
  attemptNumber: 2,
});
```

### Log Structures

**Request Success:**
```json
{
  "event": "ai_provider_request",
  "provider": "anthropic",
  "requestId": "req-123",
  "model": "claude-3-opus-20240229",
  "action": "request",
  "statusCode": 200,
  "responseTimeMs": 1245,
  "timestamp": "2024-01-15T10:30:45Z"
}
```

**Retry Attempt:**
```json
{
  "event": "ai_provider_retry",
  "provider": "anthropic",
  "requestId": "req-123",
  "model": "claude-3-opus-20240229",
  "attemptNumber": 2,
  "totalAttempts": 5,
  "errorType": "provider_capacity",
  "delayMs": 2048,
  "elapsedMs": 1523,
  "timestamp": "2024-01-15T10:30:47Z"
}
```

**Retries Exhausted:**
```json
{
  "event": "ai_provider_retries_exhausted",
  "provider": "anthropic",
  "requestId": "req-123",
  "model": "claude-3-opus-20240229",
  "totalAttempts": 5,
  "totalElapsedMs": 65000,
  "finalErrorType": "provider_capacity",
  "finalUserMessage": "AI service temporarily at capacity",
  "timestamp": "2024-01-15T10:31:50Z"
}
```

**Fallback Attempt:**
```json
{
  "event": "ai_provider_fallback",
  "provider": "anthropic",
  "fallbackProvider": "openai",
  "requestId": "req-123",
  "model": "gpt-4",
  "reason": "primary_exhausted",
  "errorType": "provider_capacity",
  "timestamp": "2024-01-15T10:31:51Z"
}
```

## Testing

Run the test suite:

```bash
npm test -- backend/src/services/aiProvider/__tests__/
```

Tests cover:
- Error classification for all HTTP status codes
- Exponential backoff computation and jitter
- Retry logic and max attempt limits
- Request deduplication
- Provider fallback behavior
- Payload preservation across retries
- Terminal vs retryable errors

## Requirements Fulfilled

| # | Requirement | Implementation |
|---|-------------|-----------------|
| 1 | Detect HTTP 503 responses | `classifyProviderError()` detects 503 status |
| 2 | Respect Retry-After header | `RetryConfig.getDelayMs()` checks `retryAfterSeconds` |
| 3 | Exponential backoff with jitter | `computeBackoffMs()` implements with symmetric jitter |
| 4 | Limit retries to 3-5 attempts | `maxAttempts` configurable 1-10, default 5 |
| 5 | Avoid infinite retry loops | `canRetry()` checks attempt count, max retries enforced |
| 6 | Preserve request payload | `executeWithRetry()` maintains payload across attempts |
| 7 | Prevent duplicate processing | `idempotencyKey` prevents duplicate requests |
| 8 | User-friendly error messages | `classification.userMessage` for end users |
| 9 | Distinguish error types | `PROVIDER_ERROR_TYPE` enum distinguishes all error categories |
| 10 | Log provider, status, request ID, retry count, timestamp | `createRetryLog()` and structured logging |
| 11 | Don't expose API keys/tokens | `sanitizeData()` redacts sensitive fields from logs |
| 12 | Provider fallback on explicit support | `fallbackProvider` configuration enables automatic fallback |

## API Reference

### Core Classes

- `ProviderConfig` - Configuration for a provider
- `AIProviderClient` - Client for executing requests with retry
- `ProviderClientFactory` - Registry and factory for providers
- `RetryConfig` - Retry configuration and decision logic
- `ProviderLogger` - Secure logger for provider operations

### Functions

- `initializeProviders(env)` - Initialize providers from environment
- `getProviderFactory()` - Get singleton provider factory
- `classifyProviderError(error, statusCode, responseBody)` - Classify errors
- `computeBackoffMs(attempt, options)` - Compute backoff delay
- `retryWithBackoff(execute, classify, config, context)` - Execute with retry
- `generateChatCompletion(options)` - Generate chat completion
- `generateText(options)` - Generate text
- `batchGenerateText(requests)` - Batch text generation

## Troubleshooting

### "No AI provider API keys configured"

Ensure environment variables are set:
```bash
export ANTHROPIC_API_KEY=sk-ant-...
# or
export OPENAI_API_KEY=sk-...
```

### Request keeps retrying

Check the error classification:
```javascript
const classification = classifyProviderError(error, statusCode, responseBody);
console.log(classification.type); // See what type of error
console.log(classification.retryable); // Is it retryable?
```

### Too many retries timing out

Adjust configuration:
```bash
AI_PROVIDER_MAX_RETRIES=3              # Reduce from 5 to 3
AI_PROVIDER_RETRY_MAX_MS=30000         # Cap backoff at 30s instead of 60s
```

### Logging contains sensitive data

Verify data is being passed through `sanitizeData()`. Check field names against the `sensitiveFields` list in `logging.js`.
