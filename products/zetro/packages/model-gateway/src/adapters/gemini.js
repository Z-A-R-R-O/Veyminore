/**
 * @file gemini.js
 * Google Gemini adapter for ZETRO Universal Agent 2.0.
 *
 * Supports Gemini 1.5 Pro / Flash and Gemini 2.0 Flash multimodal function calling.
 */

import {
  createModelProviderPort,
  AdapterTranslationError,
  ProviderTimeoutError
} from '../contracts/model-provider.js';
import {
  compileGeminiTools,
  parseGeminiComputerAction,
  parseStructuredJsonAction
} from './schema-compiler.js';

/**
 * Creates a Google Gemini ModelProviderPort.
 *
 * @param {Object} options
 * @param {string} [options.id]
 * @param {string} [options.endpoint='https://generativelanguage.googleapis.com/v1beta']
 * @param {string} options.model - e.g. "gemini-2.0-flash", "gemini-1.5-pro"
 * @param {string} [options.apiKey='']
 * @param {Object} [options.capabilities]
 * @param {number} [options.timeoutMs=35000]
 * @param {Function} [options.fetchFn=globalThis.fetch]
 * @returns {import('../contracts/model-provider.js').ModelProviderPort}
 */
export function createGeminiAdapter({
  id,
  endpoint = 'https://generativelanguage.googleapis.com/v1beta',
  model,
  apiKey = '',
  capabilities = {},
  timeoutMs = 35000,
  fetchFn = globalThis.fetch
}) {
  if (!model || typeof model !== 'string') {
    throw new Error("createGeminiAdapter requires a string 'model'");
  }

  const baseUrl = endpoint.replace(/\/+$/, '');
  const providerId = id || `gemini-${model}`;

  return createModelProviderPort({
    profile: {
      id: providerId,
      provider: 'gemini',
      model,
      endpoint: baseUrl,
      capabilities: {
        vision: 'verified',
        toolCalling: 'verified',
        structuredOutput: 'verified',
        streaming: 'verified',
        ...capabilities
      }
    },
    proposeActionImpl: async ({ prompt, messages = [], screenshotBuffer, mimeType = 'image/png' }) => {
      const url = `${baseUrl}/models/${model}:generateContent${apiKey ? `?key=${apiKey}` : ''}`;
      const functionDeclarations = compileGeminiTools();

      const parts = [];

      // Multimodal vision inline data
      if (screenshotBuffer) {
        const base64Data = Buffer.isBuffer(screenshotBuffer)
          ? screenshotBuffer.toString('base64')
          : String(screenshotBuffer);
        parts.push({
          inlineData: {
            mimeType,
            data: base64Data
          }
        });
      }

      if (prompt) {
        parts.push({ text: prompt });
      }

      const contents = [];
      for (const msg of messages) {
        contents.push(msg);
      }
      contents.push({
        role: 'user',
        parts
      });

      const body = {
        contents,
        tools: [
          { functionDeclarations }
        ],
        systemInstruction: {
          parts: [{ text: 'You are ZETRO, an autonomous computer agent. Control the screen using function calls or structured actions.' }]
        }
      };

      const headers = {
        'Content-Type': 'application/json'
      };

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      let response;
      try {
        response = await fetchFn(url, {
          method: 'POST',
          headers,
          body: JSON.stringify(body),
          signal: controller.signal
        });
      } catch (err) {
        if (err.name === 'AbortError') {
          throw new ProviderTimeoutError(providerId, timeoutMs);
        }
        throw new AdapterTranslationError(providerId, `Network error connecting to Gemini endpoint: ${err.message}`);
      } finally {
        clearTimeout(timer);
      }

      if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        throw new AdapterTranslationError(providerId, `Gemini API error (${response.status}): ${errorText}`);
      }

      const json = await response.json();
      const candidate = json.candidates?.[0];
      if (!candidate || !candidate.content || !Array.isArray(candidate.content.parts)) {
        throw new AdapterTranslationError(providerId, 'Gemini model returned empty candidate response');
      }

      // Look for functionCall part
      for (const part of candidate.content.parts) {
        if (part.functionCall) {
          try {
            const action = parseGeminiComputerAction(part.functionCall);
            return {
              action,
              raw: json,
              usage: {
                promptTokens: json.usageMetadata?.promptTokenCount,
                completionTokens: json.usageMetadata?.candidatesTokenCount
              }
            };
          } catch (err) {
            throw new AdapterTranslationError(providerId, `Failed to parse Gemini functionCall: ${err.message}`, part.functionCall);
          }
        }
      }

      // Look for text containing structured JSON
      for (const part of candidate.content.parts) {
        if (part.text && part.text.trim()) {
          try {
            const action = parseStructuredJsonAction(part.text);
            return {
              action,
              raw: json,
              usage: {
                promptTokens: json.usageMetadata?.promptTokenCount,
                completionTokens: json.usageMetadata?.candidatesTokenCount
              }
            };
          } catch {
            throw new AdapterTranslationError(providerId, `Gemini returned plain text without function invocation: ${part.text.slice(0, 100)}...`, part.text);
          }
        }
      }

      throw new AdapterTranslationError(providerId, 'Gemini response contained neither functionCall nor valid JSON action', json);
    },

    testConnectionImpl: async () => {
      const url = `${baseUrl}/models/${model}${apiKey ? `?key=${apiKey}` : ''}`;
      const start = Date.now();
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 10000);

      try {
        const res = await fetchFn(url, {
          method: 'GET',
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
