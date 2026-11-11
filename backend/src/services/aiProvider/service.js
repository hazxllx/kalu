/**
 * Example AI Service
 * 
 * Demonstrates how to use the AIProviderClient with proper error handling
 * and user-friendly error messages.
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
 * Generate text using AI provider with streaming support
 * 
 * @param {object} options - Options
 * @param {string} options.model - Model name
 * @param {string} options.prompt - Input prompt
 * @param {number} options.maxTokens - Max output tokens
 * @param {string} options.providerName - Provider name
 * @returns {Promise<string>} Generated text
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
 * Batch text generation with fallback provider support
 * 
 * @param {Array<object>} requests - Array of generation requests
 * @returns {Promise<Array<object>>} Results with success/error for each
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
