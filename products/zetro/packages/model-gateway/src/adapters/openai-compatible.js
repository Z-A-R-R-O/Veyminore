/**
 * @file openai-compatible.js
 * Universal adapter for OpenAI and OpenAI-compatible endpoints
 * (Ollama, vLLM, LM Studio, DeepSeek, Groq, OpenRouter, Mistral, LocalAI).
 */

import {
  createModelProviderPort,
  AdapterTranslationError,
  ProviderTimeoutError
} from '../contracts/model-provider.js';
import {
  compileOpenAITools,
  parseOpenAIComputerAction,
  parseStructuredJsonAction
} from './schema-compiler.js';

/**
 * Creates an OpenAI-compatible ModelProviderPort.
 *
 * @param {Object} options
 * @param {string} [options.id] - Unique adapter instance ID
 * @param {string} options.endpoint - Base URL (e.g., http://localhost:11434/v1 or https://api.openai.com/v1)
 * @param {string} options.model - Model name (e.g., "llama3.2-vision", "gpt-4o", "qwen2.5-vl")
 * @param {string} [options.apiKey=''] - Optional API key
 * @param {Object} [options.capabilities] - Capability flags
 * @param {number} [options.timeoutMs=30000] - Request timeout
 * @param {Function} [options.fetchFn=globalThis.fetch] - Injectable fetch
 * @param {string} [options.toolMode='discrete'] - 'discrete' or 'unified'
 * @returns {import('../contracts/model-provider.js').ModelProviderPort}
 */
export function createOpenAICompatibleAdapter({
  id,
  endpoint,
  model,
  apiKey = '',
  capabilities = {},
  timeoutMs = 30000,
  fetchFn = globalThis.fetch,
  toolMode = 'discrete'
}) {
  if (!endpoint || typeof endpoint !== 'string') {
    throw new Error("createOpenAICompatibleAdapter requires a string 'endpoint'");
  }
  if (!model || typeof model !== 'string') {
    throw new Error("createOpenAICompatibleAdapter requires a string 'model'");
  }

  // Clean trailing slash
  const baseUrl = endpoint.replace(/\/+$/, '');
  const providerId = id || `openai-compat-${model}`;

  return createModelProviderPort({
    profile: {
      id: providerId,
      provider: 'openai-compatible',
      model,
      endpoint: baseUrl,
      capabilities: {
        toolCalling: 'verified',
        ...capabilities
      }
    },
    proposeActionImpl: async ({ prompt, messages = [], screenshotBuffer, mimeType = 'image/png' }) => {
      const chatEndpoint = `${baseUrl}/chat/completions`;
      const tools = compileOpenAITools({ mode: toolMode });

      // Build message array
      const requestMessages = [];

      // System instruction for computer control
      requestMessages.push({
        role: 'system',
        content: 'You are ZETRO, an autonomous computer agent. You observe the screen and take precise actions using tools or structured JSON. When the user task is finished, invoke zetro_finish.'
      });

      // Existing conversation context if any
      for (const msg of messages) {
        requestMessages.push(msg);
      }

      // Current step user message
      const userContent = [];
      if (prompt) {
        userContent.push({ type: 'text', text: prompt });
      }

      // Multimodal vision input
      if (screenshotBuffer) {
        const base64Image = Buffer.isBuffer(screenshotBuffer)
          ? screenshotBuffer.toString('base64')
          : String(screenshotBuffer);
        userContent.push({
          type: 'image_url',
          image_url: {
            url: `data:${mimeType};base64,${base64Image}`
          }
        });
      }

      requestMessages.push({
        role: 'user',
        content: userContent.length === 1 && userContent[0].type === 'text'
          ? userContent[0].text
          : userContent
      });

      const body = {
        model,
        messages: requestMessages,
        tools,
        tool_choice: 'auto'
      };

      const headers = {
        'Content-Type': 'application/json'
      };
      if (apiKey) {
        headers['Authorization'] = `Bearer ${apiKey}`;
      }

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      let response;
      try {
        response = await fetchFn(chatEndpoint, {
          method: 'POST',
          headers,
          body: JSON.stringify(body),
          signal: controller.signal
        });
      } catch (err) {
        if (err.name === 'AbortError') {
          throw new ProviderTimeoutError(providerId, timeoutMs);
        }
        throw new AdapterTranslationError(providerId, `Network error connecting to ${chatEndpoint}: ${err.message}`);
      } finally {
        clearTimeout(timer);
      }

      if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        throw new AdapterTranslationError(providerId, `OpenAI compatible endpoint error (${response.status}): ${errorText}`);
      }

      const json = await response.json();
      const choice = json.choices?.[0];
      if (!choice || !choice.message) {
        throw new AdapterTranslationError(providerId, 'Model returned empty response choices');
      }

      const msg = choice.message;

      // 1. Tool call response
      if (Array.isArray(msg.tool_calls) && msg.tool_calls.length > 0) {
        const primaryToolCall = msg.tool_calls[0];
        try {
          const action = parseOpenAIComputerAction(primaryToolCall);
          return {
            action,
            raw: json,
            usage: {
              promptTokens: json.usage?.prompt_tokens,
              completionTokens: json.usage?.completion_tokens
            }
          };
        } catch (err) {
          throw new AdapterTranslationError(providerId, `Failed to parse tool call: ${err.message}`, primaryToolCall);
        }
      }

      // 2. Structured JSON response in message content
      if (typeof msg.content === 'string' && msg.content.trim()) {
        try {
          const action = parseStructuredJsonAction(msg.content);
          return {
            action,
            raw: json,
            usage: {
              promptTokens: json.usage?.prompt_tokens,
              completionTokens: json.usage?.completion_tokens
            }
          };
        } catch (err) {
          throw new AdapterTranslationError(providerId, `Model replied with text without calling tools: ${msg.content.slice(0, 100)}...`, msg.content);
        }
      }

      throw new AdapterTranslationError(providerId, 'Model response contained neither tool calls nor structured action content', json);
    },

    testConnectionImpl: async () => {
      const modelsEndpoint = `${baseUrl}/models`;
      const headers = {};
      if (apiKey) {
        headers['Authorization'] = `Bearer ${apiKey}`;
      }

      const start = Date.now();
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 10000);

      try {
        const res = await fetchFn(modelsEndpoint, {
          method: 'GET',
          headers,
          signal: controller.signal
        });
        const latencyMs = Date.now() - start;
        return {
          ok: res.ok,
          latencyMs,
          status: res.status
        };
      } catch (err) {
        return {
          ok: false,
          error: err.message
        };
      } finally {
        clearTimeout(timer);
      }
    }
  });
}
