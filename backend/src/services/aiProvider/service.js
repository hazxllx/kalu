// backend/src/services/aiProvider/service.js
/**
 * High-Level AI Generation Service (`services/aiProvider/service.js`).
 *
 * Fits into KALUSAGAP's backend pipeline (`route -> authenticate -> authorize -> controller -> aiProvider/service -> AIProviderClient`),
 * providing domain-ready helpers for chat completions, single-prompt completions,
 * and fault-isolated batch text generation backed by the singleton `ProviderClientFactory`.
 * Translates low-level provider failures into sanitized `Error` objects carrying
 * `userMessage`, `errorType`, `provider`, `requestId`, and `statusCode`.
 */

import { getProviderFactory } from './config.js';

/**
 * Generate a chat completion using configured AI provider
 * 
 * @param {object} options - Options
 * @param {string} options.model - Model name (e.g., 'gpt-4', 'claude-3-opus')
 * @param {Array} options.messages - Chat messages
 * @param {number} options.temperature - Sampling temperature (0-2)
 * @param {number} options.maxTokens - Max output tokens
 * @param {string} options.providerName - Provider name ('anthropic', 'openai')
 * @returns {Promise<string>} Generated text
 * @throws {Error} With userMessage for display to end user
 */
export const generateChatCompletion = async ({
  model,
  messages,
  temperature = 0.7,
  maxTokens = 2000,
  providerName = 'anthropic',
}) => {
  if (!model || !messages || !Array.isArray(messages) || messages.length === 0) {
    throw new Error('Invalid input: model and messages array required');
  }

  const factory = getProviderFactory();
  const client = factory.getClient(providerName);

  try {
    const response = await client.execute({
      model,
      endpoint: '/v1/messages', // Anthropic endpoint
      method: 'POST',
      payload: {
        model,
        messages,
        temperature,
        max_tokens: maxTokens,
      },
    });

    // Extract text from provider response
    if (response?.content?.[0]?.text) {
      return response.content[0].text;
    }

    throw new Error('Invalid response format from provider');
  } catch (error) {
    // Error already has classification from client
    const classification = error.classification;

    // Format error for API response
    const userMessage = classification?.userMessage ||
      'Failed to generate response. Please try again.';

    const apiError = new Error(userMessage);
    apiError.userMessage = userMessage;
    apiError.errorType = classification?.type;
    apiError.provider = error.provider;
    apiError.requestId = error.requestId;
    apiError.statusCode = error.statusCode;

    throw apiError;
  }
};

/**
 * Generate a single-prompt text completion via the provider's `/v1/complete` endpoint.
 *
 * Wraps provider execution errors into a sanitized `Error` exposing `userMessage`,
 * `errorType`, `provider`, and `requestId` for upstream controllers.
 *
 * @param {Object} options - Completion options
 * @param {string} options.model - Model identifier
 * @param {string} options.prompt - Input prompt text
 * @param {number} [options.maxTokens=1000] - Maximum output tokens
 * @param {string} [options.providerName='anthropic'] - Registered provider key
 * @returns {Promise<string>} Generated completion string
 */
export const generateText = async ({
  model,
  prompt,
  maxTokens = 1000,
  providerName = 'anthropic',
}) => {
  if (!model || !prompt) {
    throw new Error('Invalid input: model and prompt required');
  }

  const factory = getProviderFactory();
  const client = factory.getClient(providerName);

  try {
    const response = await client.execute({
      model,
      endpoint: '/v1/complete',
      method: 'POST',
      payload: {
        model,
        prompt,
        max_tokens: maxTokens,
      },
    });

    // Extract completion text
    if (response?.completion) {
      return response.completion;
    }

    throw new Error('Invalid response format from provider');
  } catch (error) {
    const classification = error.classification;
    const userMessage = classification?.userMessage ||
      'Failed to generate text. Please try again.';

    const apiError = new Error(userMessage);
    apiError.userMessage = userMessage;
    apiError.errorType = classification?.type;
    apiError.provider = error.provider;
    apiError.requestId = error.requestId;

    throw apiError;
  }
};

/**
 * Execute multiple single-prompt generation requests concurrently with per-item
 * fault isolation via `Promise.allSettled`.
 *
 * Individual failures never reject the batch; each item resolves to either
 * `{ ...req, success: true, text }` or `{ ...req, success: false, error, errorType, provider, requestId }`.
 *
 * @param {Array<Object>} requests - Non-empty array of `generateText` option objects
 * @returns {Promise<Array<Object>>} Per-request outcome objects in input order
 */
export const batchGenerateText = async (requests) => {
  if (!Array.isArray(requests) || requests.length === 0) {
    throw new Error('Expected non-empty array of requests');
  }

  const results = await Promise.allSettled(
    requests.map((req) =>
      generateText(req).then((text) => ({ ...req, success: true, text }))
    )
  );

  return results.map((result, index) => {
    if (result.status === 'fulfilled') {
      return result.value;
    }

    const error = result.reason;
    return {
      ...requests[index],
      success: false,
      error: error.userMessage || error.message,
      errorType: error.errorType,
      provider: error.provider,
      requestId: error.requestId,
    };
  });
};

export default {
  generateChatCompletion,
  generateText,
  batchGenerateText,
};
