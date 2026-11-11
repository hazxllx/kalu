/**
 * AI Provider Integration - Quick Start Guide
 * 
 * This file demonstrates how to integrate the AI provider module into your application.
 */

// ============================================================================
// STEP 1: Initialize at Application Startup
// ============================================================================

import express from 'express';
import { initializeProviders } from './services/aiProvider/config.js';

const app = express();

// Initialize providers during app startup
const providerFactory = initializeProviders(process.env);
console.log(`AI providers initialized: ${providerFactory.listProviders().join(', ')}`);

// ============================================================================
// STEP 2: Create an API Endpoint That Uses AI Provider
// ============================================================================

import { generateChatCompletion } from './services/aiProvider/service.js';

app.post('/api/ai/chat', async (req, res) => {
  try {
    const { model, messages, temperature, maxTokens } = req.body;

    const response = await generateChatCompletion({
      model: model || 'claude-3-opus-20240229',
      messages,
      temperature: temperature || 0.7,
      maxTokens: maxTokens || 2000,
      providerName: 'anthropic',
    });

    res.json({ success: true, response });
  } catch (error) {
    // Error has classification and user-friendly message
    console.error(`[${error.requestId}] AI request failed:`, {
      provider: error.provider,
      errorType: error.errorType,
      statusCode: error.statusCode,
      message: error.message,
    });

    res.status(503).json({
      success: false,
      error: error.userMessage || 'Failed to generate response',
      type: error.errorType,
      requestId: error.requestId,
    });
  }
});

// ============================================================================
// STEP 3: Manual Error Handling Example
// ============================================================================

import { classifyProviderError, isRetryable } from './services/aiProvider/errors.js';

app.post('/api/ai/advanced', async (req, res) => {
  try {
    const { model, prompt } = req.body;
    const factory = providerFactory;
    const client = factory.getClient('anthropic');

    const response = await client.execute({
      model,
      endpoint: '/v1/messages',
      payload: {
        model,
        prompt,
        max_tokens: 1000,
      },
    });

    res.json({ success: true, response });
  } catch (error) {
    const classification = error.classification;

    if (isRetryable(classification)) {
      // For user: suggest retry
      res.status(503).json({
        success: false,
        error: classification.userMessage,
        type: classification.type,
        suggestion: 'Please try again in a moment',
      });
    } else {
      // Terminal error - user must take action
      res.status(400).json({
        success: false,
        error: classification.userMessage,
        type: classification.type,
        action: 'Please verify your configuration and try again',
      });
    }
  }
});

// ============================================================================
// STEP 4: Batch Processing Example
// ============================================================================

import { batchGenerateText } from './services/aiProvider/service.js';

app.post('/api/ai/batch', async (req, res) => {
  try {
    const { requests } = req.body;

    const results = await batchGenerateText(requests);

    const successful = results.filter((r) => r.success);
    const failed = results.filter((r) => !r.success);

    res.json({
      total: results.length,
      successful: successful.length,
      failed: failed.length,
      results,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================================================
// STEP 5: Environment Configuration
// ============================================================================

/*
Add to your .env file:

# Required: At least one provider API key
ANTHROPIC_API_KEY=sk-ant-...
# OPENAI_API_KEY=sk-...

# Optional: Retry configuration
AI_PROVIDER_MAX_RETRIES=5
AI_PROVIDER_RETRY_BASE_MS=1000
AI_PROVIDER_RETRY_MAX_MS=60000
*/

// ============================================================================
// STEP 6: Testing
// ============================================================================

/*
Example curl commands to test:

# Chat completion
curl -X POST http://localhost:5000/api/ai/chat \
  -H "Content-Type: application/json" \
  -d '{
    "model": "claude-3-opus-20240229",
    "messages": [{"role": "user", "content": "What is 2+2?"}],
    "temperature": 0.7,
    "maxTokens": 100
  }'

# Batch processing
curl -X POST http://localhost:5000/api/ai/batch \
  -H "Content-Type: application/json" \
  -d '{
    "requests": [
      {
        "model": "claude-3-opus-20240229",
        "prompt": "Explain photosynthesis",
        "providerName": "anthropic"
      },
      {
        "model": "claude-3-opus-20240229",
        "prompt": "What is machine learning?",
        "providerName": "anthropic"
      }
    ]
  }'

# Expected response on 503 capacity error:
{
  "success": false,
  "error": "AI service temporarily at capacity. Please try again shortly.",
  "type": "provider_capacity",
  "requestId": "req-12345",
  "suggestion": "Please try again in a moment"
}
*/

export default app;
